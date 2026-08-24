import type { WalletCurrency, WalletRail, WalletTransactionStatus } from '../types/wallet';

export interface FxRateProvider {
  quote(input: { from: WalletCurrency; to: WalletCurrency; amountMinor: string }): Promise<{ rate: string; expiresAt: string }>;
}

export interface FundingProvider {
  createFundingRequest(input: { walletId: string; currency: WalletCurrency; amountMinor: string; idempotencyKey: string }): Promise<{ providerReference: string; status: WalletTransactionStatus }>;
}

export interface PayoutProvider {
  createPayoutRequest(input: { walletId: string; country: string; currency: WalletCurrency; amountMinor: string; idempotencyKey: string }): Promise<{ providerReference: string; status: WalletTransactionStatus }>;
}

export interface TransactionStatusVerifier {
  verify(providerReference: string): Promise<{ status: WalletTransactionStatus; verifiedAt: string }>;
}

export interface WebhookVerifier {
  verify(headers: Record<string, string | undefined>, payload: string): Promise<{ providerReference: string; valid: boolean }>;
}

export interface WalletProviderRegistry {
  fx?: FxRateProvider;
  funding?: FundingProvider;
  payout?: PayoutProvider;
  transactionStatus?: TransactionStatusVerifier;
  webhook?: WebhookVerifier;
  rails: WalletRail[];
}

export const unconfiguredWalletProviders: WalletProviderRegistry = {
  rails: [
    { country: 'Nigeria', currency: 'NGN', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected' },
    { country: 'Philippines', currency: 'PHP', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected' },
    { country: 'Indonesia', currency: 'IDR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected' },
    { country: 'China', currency: 'CNY', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected' },
    { country: 'Pakistan', currency: 'PKR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected' },
  ],
};
