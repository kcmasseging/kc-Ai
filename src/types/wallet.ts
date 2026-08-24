export const supportedCurrencies = ['NGN', 'PHP', 'IDR', 'PGK', 'CNY', 'PKR', 'MYR', 'SGD', 'THB', 'VND', 'INR', 'BDT', 'JPY', 'KRW'] as const;
export type WalletCurrency = typeof supportedCurrencies[number] | (string & {});

export type WalletTransactionStatus = 'PENDING' | 'PROCESSING' | 'CONFIRMED' | 'UNVERIFIED' | 'FAILED' | 'REVERSED' | 'CANCELLED';
export type WalletEntryDirection = 'CREDIT' | 'DEBIT';
export type WalletRailStatus = 'NOT_CONFIGURED' | 'PROVIDER_RESEARCH_REQUIRED' | 'PROVIDER_SELECTED' | 'CREDENTIALS_REQUIRED' | 'COMPLIANCE_REQUIRED' | 'CONFIGURED' | 'TESTING' | 'VERIFIED' | 'LIVE' | 'DISABLED';

export interface WalletAccount {
  walletId: string;
  ownerId: string;
  status: 'PRIVATE_BUILD' | 'VALIDATED';
  createdAt: string;
}

export interface WalletLedgerEntry {
  entryId: string;
  walletId: string;
  transactionId: string;
  currency: WalletCurrency;
  direction: WalletEntryDirection;
  amountMinor: string;
  reference: string;
  createdAt: string;
  reversalOf?: string;
}

export interface WalletTransaction {
  transactionId: string;
  walletId: string;
  idempotencyKey: string;
  currency: WalletCurrency;
  amountMinor: string;
  direction: WalletEntryDirection;
  reference: string;
  status: WalletTransactionStatus;
  createdAt: string;
  updatedAt: string;
  providerConfirmed: false;
  failureReason?: string;
  reversalOf?: string;
}

export interface WalletState {
  account: WalletAccount;
  transactions: WalletTransaction[];
  ledger: WalletLedgerEntry[];
}

export interface WalletRail {
  priority: 1 | 2 | 3;
  country: string;
  currency: WalletCurrency;
  rail: string;
  status: WalletRailStatus;
  reason: string;
  provider?: string;
  fxSource?: string;
  estimatedFees?: string;
  expectedSettlementStatus?: WalletTransactionStatus;
  complianceRequirements: string[];
}

export interface WalletRouteRequest {
  country: string;
  currency: WalletCurrency;
  rail: string;
  amountMinor: string;
}

export interface WalletRoute {
  request: WalletRouteRequest;
  rail: WalletRail;
  available: false;
  reason: string;
}

export interface WalletMutationInput {
  walletId: string;
  transactionId: string;
  idempotencyKey: string;
  currency: WalletCurrency;
  amountMinor: string;
  direction: WalletEntryDirection;
  reference: string;
  now: string;
  reversalOf?: string;
}

export interface WalletMutationResult {
  transaction: WalletTransaction;
  duplicate: boolean;
}
