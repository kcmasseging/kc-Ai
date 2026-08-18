export interface HealthResponse {
  status: 'ok';
  service: 'kc-ai';
  version: string;
  environment: string;
  timestamp: string;
}

export function createHealthResponse(environment = 'development'): HealthResponse {
  return {
    status: 'ok',
    service: 'kc-ai',
    version: '1.0.0',
    environment,
    timestamp: new Date().toISOString(),
  };
}
