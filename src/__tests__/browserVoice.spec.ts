import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(__filename);
const createVoiceController = (nodeRequire('../../public/voice.js') as { createVoiceController: (options: any) => any }).createVoiceController;

describe('KC AI browser voice playback', () => {
  it('keeps text replies rendered before optional voice playback', () => {
    const app = readFileSync('public/app.js', 'utf8');
    expect(app).toContain('appendAssistantMessage(data.reply)');
    expect(app).toContain('text.textContent=reply');
    expect(app).toContain('playReply(data.reply');
  });

  it('requests the browser TTS payload only when KC AI speaks', async () => {
    const requests: unknown[] = [];
    let spoken = '';
    const synthesis = {
      getVoices: () => [{ lang: 'en-US', name: 'English' }],
      cancel: () => {},
      speak: (utterance: { text: string; onend: () => void }) => { spoken = utterance.text; utterance.onend(); },
    };
    const voice = createVoiceController({
      speechSynthesis: synthesis,
      Utterance: function (this: { text: string }, text: string) { this.text = text; } as unknown as new (text: string) => { text: string },
      requestTts: async (payload: unknown) => { requests.push(payload); return { enabled: true, provider: 'browser', voice: 'en-US-JennyNeural' }; },
    });

    expect(requests).toHaveLength(0);
    await voice.speak('KC AI response');
    expect(requests).toEqual([{ text: 'KC AI response', provider: 'browser' }]);
    expect(spoken).toBe('KC AI response');
  });

  it('supports manual replay, mute, volume, and playback failure without pretending success', async () => {
    const requests: unknown[] = [];
    const utterances: Array<{ volume: number; onerror: () => void }> = [];
    const synthesis = {
      getVoices: () => [],
      cancel: () => {},
      speak: (utterance: { volume: number; onerror: () => void }) => { utterances.push(utterance); utterance.onerror(); },
    };
    const voice = createVoiceController({
      speechSynthesis: synthesis,
      Utterance: function (this: { text: string }, text: string) { this.text = text; } as unknown as new (text: string) => { text: string },
      requestTts: async (payload: unknown) => { requests.push(payload); return { enabled: true, provider: 'browser', voice: 'en-US-JennyNeural' }; },
    });

    voice.setVolume(0.35);
    await expect(voice.speak('manual replay')).rejects.toThrow('browser blocked');
    expect(utterances[0].volume).toBe(0.35);
    voice.setMuted(true);
    await expect(voice.speak('muted response')).resolves.toEqual({ spoken: false, reason: 'muted' });
    expect(requests).toHaveLength(1);
  });

  it('prefers a natural English voice, persists selection, and refreshes asynchronously', () => {
    const voices = [{ name: 'Basic English', lang: 'en-US', voiceURI: 'basic' }, { name: 'Natural English', lang: 'en-US', voiceURI: 'natural' }, { name: 'French', lang: 'fr-FR', voiceURI: 'french' }];
    const callbacks: string[] = [];
    const storage = { value: '', getItem: () => storage.value, setItem: (_key: string, value: string) => { storage.value = value; } };
    const synthesis = { getVoices: () => voices, addEventListener: (_event: string, callback: () => void) => callbacks.push(String(callback)), cancel: () => {}, speak: () => {} };
    let changed: { voices: typeof voices; selected: string } | undefined;
    const controller = createVoiceController({ speechSynthesis: synthesis, storage, onVoicesChanged: (available: typeof voices, selected: string) => { changed = { voices: available, selected }; } });

    expect(controller.selectedVoice().name).toBe('Natural English');
    expect(changed?.voices).toHaveLength(3);
    expect(callbacks).toHaveLength(1);
    expect(controller.selectVoice('basic')).toBe(true);
    expect(storage.value).toBe('basic');
    expect(controller.selectedVoice().name).toBe('Basic English');
  });

  it('falls back to the best available English voice when a saved voice disappears', () => {
    const storage = { value: 'missing', getItem: () => storage.value, setItem: () => {} };
    const synthesis = { getVoices: () => [{ name: 'English Natural', lang: 'en-GB', voiceURI: 'english' }, { name: 'German Natural', lang: 'de-DE', voiceURI: 'german' }], cancel: () => {}, speak: () => {} };
    const controller = createVoiceController({ speechSynthesis: synthesis, storage });

    expect(controller.selectedVoice().voiceURI).toBe('english');
  });
});