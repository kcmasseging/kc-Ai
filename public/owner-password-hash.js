/* Browser-local implementation of Node scryptSync(password, salt, 64). */
const ownerPasswordHash = (() => {
  const rounds = 16384;
  const rowWords = 16;

  function rotate(value, bits) { return (value << bits) | (value >>> (32 - bits)); }
  function salsa8(input) {
    const x = new Uint32Array(input);
    const quarter = (a, b, c, d) => {
      x[b] ^= rotate((x[a] + x[d]) >>> 0, 7); x[c] ^= rotate((x[b] + x[a]) >>> 0, 9);
      x[d] ^= rotate((x[c] + x[b]) >>> 0, 13); x[a] ^= rotate((x[d] + x[c]) >>> 0, 18);
    };
    for (let round = 0; round < 8; round += 2) {
      quarter(0, 4, 8, 12); quarter(5, 9, 13, 1); quarter(10, 14, 2, 6); quarter(15, 3, 7, 11);
      quarter(0, 1, 2, 3); quarter(5, 6, 7, 4); quarter(10, 11, 8, 9); quarter(15, 12, 13, 14);
    }
    return new Uint32Array(input.map((value, index) => (value + x[index]) >>> 0));
  }
  function blockMix(input) {
    const output = new Uint32Array(input.length);
    let x = input.slice(input.length - rowWords);
    for (let index = 0; index < input.length / rowWords; index++) {
      x = salsa8(x.map((value, offset) => value ^ input[index * rowWords + offset]));
      output.set(x, (index % 2) * (input.length / 2) + Math.floor(index / 2) * rowWords);
    }
    return output;
  }
  async function derive(password, salt) {
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);
    const saltBytes = encoder.encode(salt);
    const key = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
    const initial = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: 1, hash: 'SHA-256' }, key, 1024 * 8));
    let block = new Uint32Array(initial.buffer);
    const memory = new Uint32Array(block.length * rounds);
    for (let index = 0; index < rounds; index++) { memory.set(block, index * block.length); block = blockMix(block); }
    for (let index = 0; index < rounds; index++) {
      const selected = block[block.length - 16] % rounds;
      const memoryBlock = memory.subarray(selected * block.length, (selected + 1) * block.length);
      block = blockMix(block.map((value, offset) => value ^ memoryBlock[offset]));
    }
    const finalKey = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(block.buffer), iterations: 1, hash: 'SHA-256' }, finalKey, 64 * 8));
    return `scrypt$${salt}$${Array.from(derived, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return async (password, providedSalt) => {
    if (!password || password.length < 12) throw new Error('Owner password must be at least 12 characters');
    const saltBytes = providedSalt ? null : crypto.getRandomValues(new Uint8Array(16));
    const salt = providedSalt || Array.from(saltBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return derive(password, salt);
  };
})();