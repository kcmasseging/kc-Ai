import type { WalletCurrency, WalletRail, WalletRoute, WalletRouteRequest, WalletTransactionStatus } from '../types/wallet';

export interface FxRateProvider {
  quote(input: { from: WalletCurrency; to: WalletCurrency; amountMinor: string }): Promise<{ rate: string; expiresAt: string }>;
}

export interface FundingProvider {
  createFundingRequest(input: { walletId: string; currency: WalletCurrency; amountMinor: string; idempotencyKey: string }): Promise<{ providerReference: string; status: WalletTransactionStatus }>;
}

export interface PayoutProvider {
  createPayoutRequest(input: { walletId: string; country: string; currency: WalletCurrency; amountMinor: string; idempotencyKey: string }): Promise<{ providerReference: string; status: WalletTransactionStatus }>;
}

export interface RemittanceProvider {
  createRemittance(input: { walletId: string; country: string; currency: WalletCurrency; amountMinor: string; idempotencyKey: string }): Promise<{ providerReference: string; status: WalletTransactionStatus }>;
}

export interface BeneficiaryVerifier {
  verify(input: { country: string; currency: WalletCurrency; beneficiaryReference: string }): Promise<{ verified: boolean; reason?: string }>;
}

export interface TransactionStatusVerifier {
  verify(providerReference: string): Promise<{ status: WalletTransactionStatus; verifiedAt: string }>;
}

export interface WebhookVerifier {
  verify(headers: Record<string, string | undefined>, payload: string): Promise<{ providerReference: string; valid: boolean }>;
}

export interface WalletRoutingProvider {
  resolve(input: WalletRouteRequest): Promise<WalletRoute>;
}

export interface WalletProviderRegistry {
  fx?: FxRateProvider;
  funding?: FundingProvider;
  payout?: PayoutProvider;
  remittance?: RemittanceProvider;
  beneficiary?: BeneficiaryVerifier;
  transactionStatus?: TransactionStatusVerifier;
  webhook?: WebhookVerifier;
  routing?: WalletRoutingProvider;
  rails: WalletRail[];
}

export const unconfiguredWalletProviders: WalletProviderRegistry = {
  rails: [
    { priority: 2, country: 'Nigeria', currency: 'NGN', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 1, country: 'Philippines', currency: 'PHP', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 1, country: 'Indonesia', currency: 'IDR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'Papua New Guinea', currency: 'PGK', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'China', currency: 'CNY', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'Pakistan', currency: 'PKR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'Malaysia', currency: 'MYR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'Singapore', currency: 'SGD', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'Thailand', currency: 'THB', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'Vietnam', currency: 'VND', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'India', currency: 'INR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 2, country: 'Bangladesh', currency: 'BDT', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 3, country: 'Japan', currency: 'JPY', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 3, country: 'South Korea', currency: 'KRW', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'No legitimate funding or payout provider is connected', complianceRequirements: [] },
    { priority: 3, country: 'Sri Lanka', currency: 'LKR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'Currency and provider are not configured', complianceRequirements: [] },
    { priority: 3, country: 'Nepal', currency: 'NPR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'Currency and provider are not configured', complianceRequirements: [] },
    { priority: 3, country: 'Cambodia', currency: 'KHR', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'Currency and provider are not configured', complianceRequirements: [] },
    { priority: 3, country: 'Laos', currency: 'LAK', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'Currency and provider are not configured', complianceRequirements: [] },
    { priority: 3, country: 'Myanmar', currency: 'MMK', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'Currency and provider are not configured', complianceRequirements: [] },
    { priority: 3, country: 'Brunei', currency: 'BND', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'Currency and provider are not configured', complianceRequirements: [] },
    { priority: 3, country: 'Timor-Leste', currency: 'USD', rail: 'unconfigured', status: 'NOT_CONFIGURED', reason: 'Currency and provider are not configured', complianceRequirements: [] },
  ],
};
