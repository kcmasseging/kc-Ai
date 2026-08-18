export interface TTSRequest {
  text: string;
  voice?: string;
  provider?: 'browser' | 'azure' | 'google';
}

export interface TTSResponse {
  enabled: boolean;
  provider: 'browser' | 'azure' | 'google';
  voice: string;
  message: string;
}

export function createTtsResponse(input: TTSRequest): TTSResponse {
  const provider = input.provider || 'browser';
  const voice = input.voice || 'en-US-JennyNeural';

  return {
    enabled: true,
    provider,
    voice,
    message: `Voice synthesis is available for ${provider}. KC AI can speak a welcome and context-aware message when the browser/device audio permission is granted.`,
  };
}
