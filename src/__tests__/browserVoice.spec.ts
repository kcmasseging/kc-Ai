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
});