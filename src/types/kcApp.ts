export type KCAppId =
  | 'kc-telecom'
  | 'kc-earn'
  | 'kc-messaging-africa'
  | 'kc-business-suite'
  | 'unknown-app';

export interface KCAppContext {
  appId: KCAppId;
  appName: string;
  environment?: string;
  version?: string;
  capabilities?: string[];
}

export interface KCUserContext {
  userId?: string;
  displayName?: string;
  email?: string;
  authenticated: boolean;
}
