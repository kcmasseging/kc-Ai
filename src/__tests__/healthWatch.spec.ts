import { describe, expect, it } from 'vitest';
import { clearAuditRecords, listAuditRecords } from '../services/auditService';
import { createIssue, HealthWatchService } from '../services/healthWatchService';

describe('owner health watch foundation', () => {
  it('reports healthy only after a registered check succeeds', async () => {
    const watch = new HealthWatchService();
    watch.register({ product: 'KC AI', async check() { return { checks: [{ area: 'availability', status: 'HEALTHY', evidence: 'health endpoint returned 200' }] }; } });
    const [snapshot] = await watch.scan();
    expect(snapshot.status).toBe('HEALTHY');
  });

  it('reports unverified products without inventing connectivity', async () => {
    const watch = new HealthWatchService();
    const snapshots = await watch.scan();
    expect(snapshots.find((snapshot) => snapshot.product === 'KC Telecom')?.status).toBe('UNVERIFIED');
  });

  it('creates degraded issues, suppresses duplicate alerts, and redacts evidence', async () => {
    const watch = new HealthWatchService();
    watch.register({ product: 'KC AI', async check() { return { checks: [{ area: 'API errors', status: 'DEGRADED' }], issues: [createIssue({ product: 'KC AI', component: 'API', severity: 'HIGH', symptom: 'repeated API failures', evidence: 'token=private-value failures=5', probableCause: 'provider configuration', recommendedAction: 'inspect configuration' })] }; } });
    const first = (await watch.scan())[0];
    const second = (await watch.scan())[0];
    expect(first.status).toBe('DEGRADED');
    expect(first.issues[0].evidence).toContain('token=[REDACTED]');
    expect(second.issues[0].alertSuppressed).toBe(true);
  });

  it('records failed repairs and only resolves after a successful repair result', async () => {
    await clearAuditRecords();
    const watch = new HealthWatchService();
    watch.register({ product: 'KC AI', async check() { return { checks: [{ area: 'cache', status: 'WARNING' }], issues: [createIssue({ product: 'KC AI', component: 'cache', severity: 'MEDIUM', symptom: 'cache warning', evidence: 'cache unavailable', probableCause: 'transient cache', recommendedAction: 'retry cache check' })] }; } });
    const issue = (await watch.scan())[0].issues[0];
    await expect(watch.repair(issue.issueId, { category: 'SAFE_AUTO_REPAIR', async repair() { throw new Error('repair failed'); } })).rejects.toThrow('repair failed');
    expect(watch.listIssues()[0].remediationStatus).toBe('OPEN');
    const resolved = await watch.repair(issue.issueId, { category: 'SAFE_AUTO_REPAIR', async repair() { return { attempted: true, evidence: 'cache check passed' }; } });
    expect(resolved.remediationStatus).toBe('RESOLVED');
    expect((await listAuditRecords()).some((record) => record.actionType === 'health-watch.repair-verified')).toBe(true);
  });

  it('denies owner-approval repairs in the foundation', async () => {
    const watch = new HealthWatchService();
    watch.register({ product: 'KC AI', async check() { return { checks: [{ area: 'deployment', status: 'WARNING' }], issues: [createIssue({ product: 'KC AI', component: 'deployment', severity: 'HIGH', symptom: 'deployment warning', evidence: 'not configured', probableCause: 'missing integration', recommendedAction: 'owner review' })] }; } });
    const issue = (await watch.scan())[0].issues[0];
    await expect(watch.repair(issue.issueId, { category: 'OWNER_APPROVAL_REQUIRED', async repair() { return { attempted: true, evidence: 'must not run' }; } })).rejects.toThrow('Owner approval');
  });
});
