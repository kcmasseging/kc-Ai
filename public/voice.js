(function (global) {
  function createVoiceController(options) {
    const speechSynthesis = options.speechSynthesis;
    const Utterance = options.Utterance;
    const requestTts = options.requestTts;
    const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const storageKey = options.storageKey || 'kcAiVoiceName';
    let availableVoices = [];
    let selectedVoiceId = storage?.getItem(storageKey) || '';
    let muted = false;
    let volume = 1;

    function voiceId(voice) { return voice.voiceURI || `${voice.name}|${voice.lang}`; }
    function voiceScore(voice) {
      const name = voice.name.toLowerCase();
      const isEnglish = /^en(?:-|$)/i.test(voice.lang || '');
      let score = isEnglish ? 100 : 0;
      if (/en-us/i.test(voice.lang)) score += 20;
      if (/natural|neural|premium|enhanced|google|microsoft|samantha|alex/i.test(name)) score += 15;
      if (voice.localService) score += 2;
      return score + (isEnglish ? 0 : -1000);
    }
    function refreshVoices() {
      availableVoices = (speechSynthesis?.getVoices?.() || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      if (!availableVoices.some((voice) => voiceId(voice) === selectedVoiceId)) {
        const preferred = availableVoices.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0];
        selectedVoiceId = preferred ? voiceId(preferred) : '';
      }
      options.onVoicesChanged?.(availableVoices.slice(), selectedVoiceId);
    }
    function selectedVoice() {
      return availableVoices.find((voice) => voiceId(voice) === selectedVoiceId) || availableVoices.slice().sort((a, b) => voiceScore(b) - voiceScore(a))[0];
    }
    function selectVoice(id) {
      if (!availableVoices.some((voice) => voiceId(voice) === id)) return false;
      selectedVoiceId = id;
      storage?.setItem(storageKey, id);
      options.onVoicesChanged?.(availableVoices.slice(), selectedVoiceId);
      return true;
    }

    refreshVoices();
    speechSynthesis?.addEventListener?.('voiceschanged', refreshVoices);

    async function speak(text) {
      if (muted) return { spoken: false, reason: 'muted' };
      if (!speechSynthesis || !Utterance) throw new Error('Browser voice playback is unavailable. Use the speaker button or check browser audio permissions.');
      const payload = await requestTts({ text, provider: 'browser' });
      if (!payload?.enabled || payload.provider !== 'browser') throw new Error('Browser voice playback is unavailable.');
      return new Promise((resolve, reject) => {
        const utterance = new Utterance(text);
        utterance.voice = selectedVoice() || null;
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = volume;
        utterance.onend = () => resolve({ spoken: true });
        utterance.onerror = () => reject(new Error('The browser blocked or could not complete voice playback. Tap the speaker button to try again.'));
        speechSynthesis.cancel();
        speechSynthesis.speak(utterance);
      });
    }

    return {
      speak,
      voices() { return availableVoices.slice(); },
      selectedVoice() { return selectedVoice(); },
      selectVoice,
      setMuted(value) { muted = value; if (muted) speechSynthesis?.cancel(); },
      isMuted() { return muted; },
      setVolume(value) { volume = Math.max(0, Math.min(1, Number(value))); },
    };
  }

  const api = { createVoiceController };
  global.KCVoice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);