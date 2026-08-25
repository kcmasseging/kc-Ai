import { describe, expect, it } from 'vitest';
import { createHealthResponse } from '../services/healthService';
import { createWelcomeMessage } from '../services/welcomeService';
import { checkCapability } from '../services/capabilityService';
import { createAndAdvanceTask } from '../services/taskService';
import { getTask, reloadTasks } from '../services/taskService';
import { SecretBus } from '../services/secretBusService';
import { verifyOwnerToken } from '../services/ownerModeService';
import { authenticateOwner, hashPassword, issueStepUpToken, logoutOwner, verifyOwnerSession, verifyStepUpToken, verifyStepUpTokenForSession } from '../services/authService';
import { clearAuditRecords, listAuditRecords, recordAudit, reloadAuditRecords } from '../services/auditService';
import { createHmac } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { advancePrivateBuild, createPrivateBuild, getPrivateBuild } from '../services/privateBuildService';
import { LocalStorage, StorageUnavailableError } from '../services/storage';
import { PostgresStorage } from '../services/postgresStorage';
import type { TaskRecord } from '../types/task';
import { newDb } from 'pg-mem';
import { createOwnerWallet, deriveWalletBalances, getOwnerWallet, listWalletRails, mutateOwnerWallet, resolveWalletRoute, reverseOwnerWalletTransaction, WalletOperationError } from '../services/walletService';

describe('KC AI foundation', () => {
  it('creates a health response with status and service metadata', () => {
    const response = createHealthResponse();

    expect(response.status).toBe('ok');
    expect(response.service).toBe('kc-ai');
    expect(response.version).toBeDefined();
  });

  it('creates a mandatory welcome for signup/login that is central to the KC ecosystem', () => {
    const welcome = createWelcomeMessage({
      userName: 'Jane',
      appId: 'kc-telecom',
      appName: 'KC TELECOM',
      ecosystem: ['KC TELECOM', 'KC Earn', 'KC Messaging Africa', 'KC Business Suite'],
    });

    expect(welcome.mandatory).toBe(true);
    expect(welcome.trigger).toBe('after-auth-success');
    expect(welcome.autoPlayPolicy).toBe('start-immediately-after-first-user-interaction-if-browser-blocks-audio');
    expect(welcome.voice).toContain('Hello Jane');
    expect(welcome.text).toContain('central assistant for the KC ecosystem');
    expect(welcome.text).toContain('KC TELECOM');
    expect(welcome.text).toContain('KC Earn');
    expect(welcome.permissionsHint).toContain('browser or device audio permissions');
    expect(welcome.permissionsHint).not.toContain('Skip');
    expect(welcome.permissionsHint).not.toContain('Mute');
    expect(welcome.permissionsHint).not.toContain('Disable KC AI Voice');
    expect(welcome.permissionsHint).not.toContain('Never play again');
    expect(welcome.voiceControls).toBe('normal KC AI conversation voice controls remain separate from mandatory login/signup introduction');
  });

  it('blocks unsupported external work instead of claiming success', async () => {
    expect(checkCapability('deployment').status).toBe('planned');

    const task = await createAndAdvanceTask({ goal: 'deploy this to production', appId: 'kc-telecom' });

    expect(task.status).toBe('blocked');
    expect(task.verificationStatus).toBe('not-verified');
    expect(task.blockedReason).toContain('deployment integration');
  });

  it.each([
    ['unsupported email send', "Send a test email to example@example.com saying 'KC AI capability test'. If email sending is not actually available, do not pretend to send it."],
    ['unsupported payment', 'Transfer $25 to the test account'],
    ['unsupported deploy', 'Publish this build to production'],
    ['unsupported external message', 'Send an external message to the test recipient'],
  ])('%s is blocked without a false harmless-task result', async (_label, goal) => {
    const task = await createAndAdvanceTask({ goal });

    expect(task.status).toBe('blocked');
    expect(task.verificationStatus).toBe('not-verified');
    expect(task.blockedReason).toBeTruthy();
    expect(task.blockedReason).not.toContain('no external side effect');
    expect(task.progress.join(' ')).not.toContain('Task completed: no external side effect was requested.');
  });

  it('still completes harmless internal work', async () => {
    const task = await createAndAdvanceTask({ goal: 'summarize the internal task notes' });

    expect(task.status).toBe('completed');
    expect(task.verificationStatus).toBe('verified');
    expect(task.progress).toContain('Task completed: no external side effect was requested.');
  });

  it('encrypts Secret Bus values and reports missing key material', () => {
    const unavailable = new SecretBus();
    expect(unavailable.status().available).toBe(false);

    const bus = new SecretBus('a'.repeat(32), '/tmp/kc-ai-test-secrets.json');
    const metadata = bus.create({ ownerId: 'owner-1', type: 'private-note', label: 'Example', value: 'test-only-value' });
    expect(metadata.maskedValue).not.toContain('test-only-value');
    expect(bus.reveal('owner-1', metadata.id)).toBe('test-only-value');
  });

  it('persists encrypted vault metadata without plaintext and reloads records', () => {
    const filePath = '/tmp/kc-ai-persistent-secrets.json';
    try { unlinkSync(filePath); } catch {}
    const first = new SecretBus('b'.repeat(32), filePath);
    const created = first.create({ ownerId: 'owner-2', type: 'api-key', label: 'Build key', value: 'private-test-value' });
    const raw = readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('private-test-value');
    const second = new SecretBus('b'.repeat(32), filePath);
    expect(second.list('owner-2')).toHaveLength(1);
    expect(second.get('other-owner', created.id)).toBeUndefined();
    expect(second.reveal('owner-2', created.id)).toBe('private-test-value');
    unlinkSync(filePath);
  });

  it('issues, expires, re-authenticates, and revokes owner sessions', async () => {
    process.env.KC_AI_OWNER_ID = 'test-owner';
    process.env.KC_AI_OWNER_PASSWORD_HASH = hashPassword('correct horse battery staple');
    const secret = 'owner-session-test-secret';
    const result = await authenticateOwner({ ownerId: 'test-owner', password: 'correct horse battery staple', secret });
    expect(result).toBeDefined();
    expect(verifyOwnerSession(result?.sessionToken, secret)).toBeDefined();
    expect(verifyOwnerSession(result?.sessionToken, secret, result?.expiresAt)).toBeUndefined();
    const stepUp = await issueStepUpToken({ token: result?.sessionToken, password: 'correct horse battery staple', secret });
    expect(verifyStepUpToken(stepUp)).toBe(true);
    expect(verifyStepUpTokenForSession(stepUp, 'wrong-session')).toBe(false);
    expect(await logoutOwner(result?.sessionToken, secret)).toBe(true);
    expect(verifyOwnerSession(result?.sessionToken, secret)).toBeUndefined();
  });

  it('records safe audit errors without sensitive values', async () => {
    await clearAuditRecords();
    await recordAudit({ actionType: 'test', actorRole: 'owner', outcome: 'failed', verificationStatus: 'not-verified', error: 'token=do-not-log password=also-private' });
    const audit = await listAuditRecords();
    expect(audit[0].error).toBe('token=[REDACTED] password=[REDACTED]');
  });

  it('reloads audit records from the atomic local store', async () => {
    await clearAuditRecords();
    const created = await recordAudit({ actionType: 'persisted-test', actorRole: 'system', outcome: 'completed', verificationStatus: 'verified' });
    await reloadAuditRecords();
    expect(await listAuditRecords()).toContainEqual(created);
  });

  it('reloads task state from the atomic local store', async () => {
    const task = await createAndAdvanceTask({ goal: 'prepare a safe local checklist' });
    expect(await getTask(task.taskId)).toBeDefined();
    reloadTasks();
    expect(await getTask(task.taskId)).toMatchObject({ taskId: task.taskId, status: 'completed', lastSuccessfulStep: expect.any(String) });
  });

  it('accepts only signed, unexpired Owner Mode claims', () => {
    const secret = 'owner-auth-test-secret';
    const claims = Buffer.from(JSON.stringify({ subject: 'owner-1', role: 'owner', expiresAt: Date.now() + 60_000 })).toString('base64url');
    const signature = createHmac('sha256', secret).update(claims).digest('base64url');

    expect(verifyOwnerToken(`${claims}.${signature}`, secret)).toMatchObject({ subject: 'owner-1', role: 'owner' });
    expect(verifyOwnerToken(`${claims}.invalid`, secret)).toBeUndefined();
  });

  it('keeps private builds owner-scoped and requires ordered approval', async () => {
    const build = await createPrivateBuild({ ownerId: 'owner-private', goal: 'Build a wallet in a private staging context' });

    expect(build.status).toBe('PRIVATE_BUILD');
    expect(build.privateContext).toBe('development-staging');
    expect(build.productionActivation).toBe('disabled');
    expect(getPrivateBuild(build.privateBuildId, 'other-owner')).toBeUndefined();
    expect(await advancePrivateBuild(build.privateBuildId, 'owner-private', 'APPROVED_FOR_PRODUCTION')).toBeUndefined();

    expect((await advancePrivateBuild(build.privateBuildId, 'owner-private', 'VALIDATED'))?.status).toBe('VALIDATED');
    expect((await advancePrivateBuild(build.privateBuildId, 'owner-private', 'OWNER_REVIEW_REQUIRED'))?.status).toBe('OWNER_REVIEW_REQUIRED');
    expect((await advancePrivateBuild(build.privateBuildId, 'owner-private', 'APPROVED_FOR_STAGING'))?.status).toBe('APPROVED_FOR_STAGING');
    const approved = await advancePrivateBuild(build.privateBuildId, 'owner-private', 'APPROVED_FOR_PRODUCTION');

    expect(approved?.status).toBe('APPROVED_FOR_PRODUCTION');
    expect(approved?.productionActivation).toBe('disabled');
    expect(await advancePrivateBuild(build.privateBuildId, 'owner-private', 'APPROVED_FOR_PRODUCTION')).toBeUndefined();
  });

  it('persists PostgreSQL tasks, history, and audit records across adapter reload', async () => {
    const database = newDb({ noAstCoverageCheck: true } as never);
    const Pool = database.adapters.createPg().Pool;
    const first = new PostgresStorage({ pool: new Pool() });
    await first.initialize();
    const task: TaskRecord = { taskId: 'db-task', goal: 'database test', status: 'received', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: ['received'], verificationStatus: 'not-verified' };
    await first.createTask(task);
    const updated = { ...task, status: 'completed' as const, updatedAt: new Date().toISOString(), progress: ['received', 'completed'], verificationStatus: 'verified' as const };
    await first.updateTask(updated);
    const audit = await first.appendAudit({ actionType: 'db-test', timestamp: new Date().toISOString(), taskId: task.taskId, actorRole: 'system', outcome: 'completed', verificationStatus: 'verified' });
    const second = new PostgresStorage({ pool: new Pool() });
    await second.initialize();
    expect(await second.getTask(task.taskId)).toMatchObject({ status: 'completed' });
    expect(await second.listTaskHistory(task.taskId)).toHaveLength(2);
    expect(await second.listAuditRecords()).toContainEqual(expect.objectContaining({ actionType: audit.actionType, taskId: audit.taskId, actorRole: audit.actorRole, outcome: audit.outcome, verificationStatus: audit.verificationStatus }));
    await first.close(); await second.close();
  });

  it('serializes concurrent PostgreSQL task updates and preserves state history', async () => {
    const database = newDb({ noAstCoverageCheck: true } as never);
    const Pool = database.adapters.createPg().Pool;
    const storage = new PostgresStorage({ pool: new Pool() });
    await storage.initialize();
    const task: TaskRecord = { taskId: 'concurrent-task', goal: 'concurrency test', status: 'received', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: ['received'], verificationStatus: 'not-verified' };
    await storage.createTask(task);
    await Promise.all([
      storage.updateTask({ ...task, status: 'planning', updatedAt: new Date().toISOString(), progress: ['received', 'planning'] }),
      storage.updateTask({ ...task, status: 'executing', updatedAt: new Date().toISOString(), progress: ['received', 'executing'] }),
    ]);
    expect(await storage.listTaskHistory(task.taskId)).toHaveLength(3);
    expect(['planning', 'executing']).toContain((await storage.getTask(task.taskId))?.status);
    await storage.close();
  });

  it('reports failed database connections and recovers through local fallback', async () => {
    const failed = new PostgresStorage({ pool: { connect: async () => { throw new Error('offline'); }, end: async () => {} } });
    await expect(failed.initialize()).rejects.toBeInstanceOf(StorageUnavailableError);
    const directory = `/tmp/kc-ai-storage-${Date.now()}`;
    const local = new LocalStorage(`${directory}/tasks.json`, `${directory}/audit.json`, `${directory}/history.json`);
    const task: TaskRecord = { taskId: 'fallback-task', goal: 'fallback test', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: ['completed'], verificationStatus: 'verified' };
    await local.createTask(task);
    await local.appendAudit({ actionType: 'fallback-test', timestamp: new Date().toISOString(), actorRole: 'system', outcome: 'completed', verificationStatus: 'verified' });
    const recovered = new LocalStorage(`${directory}/tasks.json`, `${directory}/audit.json`, `${directory}/history.json`);
    expect(await recovered.getTask(task.taskId)).toMatchObject({ status: 'completed' });
    expect(await recovered.listAuditRecords()).toHaveLength(1);
  });

  it('keeps the private wallet owner-scoped and persists its ledger safely', async () => {
    const ownerId = `wallet-owner-${Date.now()}`;
    const account = await createOwnerWallet(ownerId);
    await expect(getOwnerWallet('other-owner')).rejects.toBeInstanceOf(WalletOperationError);
    const credit = await mutateOwnerWallet({ ownerId, direction: 'CREDIT', currency: 'PHP', amountMinor: '1000', idempotencyKey: 'credit-1', reference: 'development funding ledger' });
    const duplicate = await mutateOwnerWallet({ ownerId, direction: 'CREDIT', currency: 'PHP', amountMinor: '1000', idempotencyKey: 'credit-1', reference: 'development funding ledger' });
    expect(duplicate).toMatchObject({ duplicate: true, transaction: { transactionId: credit.transaction.transactionId } });
    const debit = await mutateOwnerWallet({ ownerId, direction: 'DEBIT', currency: 'PHP', amountMinor: '400', idempotencyKey: 'debit-1', reference: 'development debit ledger' });
    expect(debit.transaction.status).toBe('UNVERIFIED');
    await expect(mutateOwnerWallet({ ownerId, direction: 'DEBIT', currency: 'PHP', amountMinor: '700', idempotencyKey: 'debit-2', reference: 'insufficient test' })).rejects.toBeInstanceOf(WalletOperationError);
    const wallet = await getOwnerWallet(ownerId);
    expect(wallet?.account.walletId).toBe(account.walletId);
    expect(deriveWalletBalances(wallet?.ledger || [])).toEqual({ PHP: '600' });
    const reversal = await reverseOwnerWalletTransaction({ ownerId, transactionId: debit.transaction.transactionId, idempotencyKey: 'reverse-1', reference: 'development reversal' });
    expect(reversal.transaction.status).toBe('REVERSED');
    expect(deriveWalletBalances((await getOwnerWallet(ownerId))?.ledger || [])).toEqual({ PHP: '1000' });
  });

  it('protects wallet mutations under concurrent requests and rejects invalid currency', async () => {
    const ownerId = `wallet-concurrency-${Date.now()}`;
    await createOwnerWallet(ownerId);
    await mutateOwnerWallet({ ownerId, direction: 'CREDIT', currency: 'NGN', amountMinor: '100', idempotencyKey: 'seed', reference: 'seed' });
    const results = await Promise.allSettled([
      mutateOwnerWallet({ ownerId, direction: 'DEBIT', currency: 'NGN', amountMinor: '60', idempotencyKey: 'debit-a', reference: 'concurrent a' }),
      mutateOwnerWallet({ ownerId, direction: 'DEBIT', currency: 'NGN', amountMinor: '60', idempotencyKey: 'debit-b', reference: 'concurrent b' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(mutateOwnerWallet({ ownerId, direction: 'CREDIT', currency: 'USD', amountMinor: '1', idempotencyKey: 'usd', reference: 'invalid currency' })).rejects.toBeInstanceOf(WalletOperationError);
  });

  it('keeps country rails unconfigured and provider success unavailable', () => {
    const rails = listWalletRails();
    expect(rails.map((rail) => rail.currency)).toEqual(expect.arrayContaining(['NGN', 'PHP', 'IDR', 'PGK', 'CNY', 'PKR', 'MYR', 'SGD', 'THB', 'VND', 'INR', 'BDT', 'JPY', 'KRW']));
    expect(rails.every((rail) => rail.status === 'NOT_CONFIGURED')).toBe(true);
    expect(rails.every((rail) => rail.reason.length > 0 && rail.complianceRequirements.length === 0)).toBe(true);
    expect(resolveWalletRoute({ country: 'Philippines', currency: 'PHP', rail: 'bank-transfer', amountMinor: '100' }).available).toBe(false);
    expect(resolveWalletRoute({ country: 'Atlantis', currency: 'XXX', rail: 'unknown', amountMinor: '100' }).reason).toContain('not configured');
  });
});
