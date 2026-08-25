(function (global) {
  function createVoiceController(options) {
    const speechSynthesis = options.speechSynthesis;
    const Utterance = options.Utterance;
    const requestTts = options.requestTts;
    let muted = false;
    let volume = 1;

    async function speak(text) {
      if (muted) return { spoken: false, reason: 'muted' };
      if (!speechSynthesis || !Utterance) throw new Error('Browser voice playback is unavailable. Use the speaker button or check browser audio permissions.');
      const payload = await requestTts({ text, provider: 'browser' });
      if (!payload?.enabled || payload.provider !== 'browser') throw new Error('Browser voice playback is unavailable.');
      return new Promise((resolve, reject) => {
        const utterance = new Utterance(text);
        utterance.voice = speechSynthesis.getVoices().find((voice) => voice.name === payload.voice || voice.lang === payload.voice) || null;
        utterance.volume = volume;
        utterance.onend = () => resolve({ spoken: true });
        utterance.onerror = () => reject(new Error('The browser blocked or could not complete voice playback. Tap the speaker button to try again.'));
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);
      });
    }

    return {
      speak,
      setMuted(value) { muted = value; if (muted) speechSynthesis?.cancel(); },
      isMuted() { return muted; },
      setVolume(value) { volume = Math.max(0, Math.min(1, Number(value))); },
    };
  }

  const api = { createVoiceController };
  global.KCVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);