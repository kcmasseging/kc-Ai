import { randomUUID } from 'node:crypto';
import { recordAudit } from './auditService';
import { InsufficientBalanceError, getStorage } from './storage';
import { supportedCurrencies, type WalletCurrency, type WalletEntryDirection, type WalletLedgerEntry, type WalletRail, type WalletRoute, type WalletRouteRequest, type WalletTransaction, type WalletAccount } from '../types/wallet';
import { unconfiguredWalletProviders } from './walletProviders';

export class WalletOperationError extends Error {}

function validateCurrency(currency: WalletCurrency): void {
  if (!supportedCurrencies.includes(currency as typeof supportedCurrencies[number])) throw new WalletOperationError(`Currency ${currency} is not supported or configured`);
}

function validateAmount(amountMinor: string): void {
  if (!/^[1-9][0-9]*$/.test(amountMinor)) throw new WalletOperationError('Amount must be a positive integer in minor units');
}

async function ownerWallet(ownerId: string): Promise<WalletAccount> {
  const account = await getStorage().getWalletAccount(ownerId);
  if (!account) throw new WalletOperationError('Owner wallet does not exist');
  if (account.ownerId !== ownerId || !['PRIVATE_BUILD', 'VALIDATED'].includes(account.status)) throw new WalletOperationError('Owner wallet access denied');
  return account;
}

export async function createOwnerWallet(ownerId: string): Promise<WalletAccount> {
  if (!ownerId.trim()) throw new WalletOperationError('Owner identity is required');
  const account: WalletAccount = { walletId: `wallet_${randomUUID()}`, ownerId, status: 'PRIVATE_BUILD', createdAt: new Date().toISOString() };
  const created = await getStorage().createWalletAccount(account);
  await recordAudit({ actionType: 'wallet.created', actorRole: 'owner', outcome: 'started', verificationStatus: 'verified' });
  return created;
}

export async function getOwnerWallet(ownerId: string) {
  const account = await ownerWallet(ownerId);
  return getStorage().getWalletState(account.walletId);
}

export async function mutateOwnerWallet(input: { ownerId: string; direction: WalletEntryDirection; currency: WalletCurrency; amountMinor: string; idempotencyKey: string; reference: string }): Promise<{ transaction: WalletTransaction; duplicate: boolean }> {
  const account = await ownerWallet(input.ownerId);
  validateCurrency(input.currency);
  validateAmount(input.amountMinor);
  if (!input.idempotencyKey.trim() || !input.reference.trim()) throw new WalletOperationError('Idempotency key and reference are required');
  let result;
  try { result = await getStorage().applyWalletMutation({ walletId: account.walletId, transactionId: `txn_${randomUUID()}`, idempotencyKey: input.idempotencyKey, currency: input.currency, amountMinor: input.amountMinor, direction: input.direction, reference: input.reference, now: new Date().toISOString() }); }
  catch (error) { if (error instanceof InsufficientBalanceError) throw new WalletOperationError(error.message); throw error; }
  await recordAudit({ actionType: `wallet.${input.direction.toLowerCase()}`, taskId: result.transaction.transactionId, actorRole: 'owner', outcome: result.duplicate ? 'completed' : 'started', verificationStatus: 'not-verified' });
  return result;
}

export async function reverseOwnerWalletTransaction(input: { ownerId: string; transactionId: string; idempotencyKey: string; reference: string }): Promise<{ transaction: WalletTransaction; duplicate: boolean }> {
  const state = await getOwnerWallet(input.ownerId);
  const original = state?.transactions.find((transaction) => transaction.transactionId === input.transactionId);
  if (!original) throw new WalletOperationError('Wallet transaction not found');
  if (original.status === 'REVERSED' || original.reversalOf) throw new WalletOperationError('Wallet transaction is already reversed');
  const result = await getStorage().applyWalletMutation({ walletId: original.walletId, transactionId: `txn_${randomUUID()}`, idempotencyKey: input.idempotencyKey, currency: original.currency, amountMinor: original.amountMinor, direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT', reference: input.reference, now: new Date().toISOString(), reversalOf: original.transactionId });
  await recordAudit({ actionType: 'wallet.reversed', taskId: result.transaction.transactionId, actorRole: 'owner', outcome: 'started', verificationStatus: 'not-verified' });
  return result;
}

export function listWalletRails(): WalletRail[] { return unconfiguredWalletProviders.rails.map((rail) => ({ ...rail, complianceRequirements: [...rail.complianceRequirements] })); }

export function resolveWalletRoute(request: WalletRouteRequest): WalletRoute {
  const rail = unconfiguredWalletProviders.rails.find((entry) => entry.country === request.country && entry.currency === request.currency && entry.rail === request.rail) || {
    priority: 3 as const,
    country: request.country,
    currency: request.currency,
    rail: request.rail,
    status: 'NOT_CONFIGURED' as const,
    reason: 'Country, currency, or payout rail is not configured',
    complianceRequirements: [],
  };
  return { request: { ...request }, rail: { ...rail, complianceRequirements: [...rail.complianceRequirements] }, available: false, reason: rail.reason };
}

export function deriveWalletBalances(ledger: WalletLedgerEntry[]): Record<string, string> {
  const balances: Record<string, bigint> = {};
  for (const entry of ledger) balances[entry.currency] = (balances[entry.currency] || 0n) + (entry.direction === 'CREDIT' ? BigInt(entry.amountMinor) : -BigInt(entry.amountMinor));
  return Object.fromEntries(Object.entries(balances).map(([currency, amount]) => [currency, amount.toString()]));
}
