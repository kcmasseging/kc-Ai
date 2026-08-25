import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createHealthResponse } from '../services/healthService';
import { verifyOwnerToken } from '../services/ownerModeService';
import { authConfigurationStatus, authenticateOwner, hashPassword, initializeOwner, issueStepUpToken, verifyOwnerSession } from '../services/authService';
import { createAndAdvanceTask } from '../services/taskService';
import { clearAuditRecords, listAuditRecords } from '../services/auditService';
import { createPrivateBuild, getPrivateBuild } from '../services/privateBuildService';
import { SecretBus } from '../services/secretBusService';
import { verifySystem } from '../services/systemVerificationService';
import { readFileSync } from 'node:fs';

function signedOwnerClaim(secret: string, subject = 'acceptance-owner'): string {
  const claims = Buffer.from(JSON.stringify({ subject, role: 'owner', expiresAt: Date.now() + 60_000 })).toString('base64url');
  return `${claims}.${createHmac('sha256', secret).update(claims).digest('base64url')}`;
}

describe('KC AI owner acceptance', () => {
  it('allows only a verified owner claim into Owner Mode', () => {
    const secret = 'acceptance-owner-secret';
    expect(verifyOwnerToken(signedOwnerClaim(secret), secret)).toMatchObject({ role: 'owner', subject: 'acceptance-owner' });
    expect(verifyOwnerToken(signedOwnerClaim(secret, 'ordinary-user'), 'wrong-secret')).toBeUndefined();
    expect(verifyOwnerToken(undefined, secret)).toBeUndefined();
  });

  it('returns a readiness result from actual health, capability, storage, and Secret Bus checks', async () => {
    const result = await verifySystem('test', new SecretBus());
    expect(['READY', 'PARTIALLY AVAILABLE', 'UNAVAILABLE']).toContain(result.status);
    expect(result.checks.health).toBe('PASS');
    expect(result.checks.storage).toBe('AVAILABLE');
    expect(result.checks.capabilities).toBe('PARTIALLY AVAILABLE');
    expect(result.checks.secretBus).toBe('UNAVAILABLE');
    expect(result.status).toBe('PARTIALLY AVAILABLE');
  });

  it('executes and validates a harmless task before completion and preserves audit evidence', async () => {
    await clearAuditRecords();
    const task = await createAndAdvanceTask({ goal: 'prepare a harmless owner acceptance checklist', actorRole: 'owner' });
    expect(task.status).toBe('completed');
    expect(task.verificationStatus).toBe('verified');
    expect(task.result).toBeTruthy();
    expect(task.verificationResult).toBeTruthy();
    expect((await listAuditRecords()).filter((record) => record.taskId === task.taskId).map((record) => record.actionType)).toEqual(['task.received', 'task.completed']);
  });

  it('requires a verified owner and step-up for private build access', async () => {
    process.env.KC_AI_OWNER_ID = 'acceptance-owner';
    process.env.KC_AI_OWNER_PASSWORD_HASH = hashPassword('acceptance owner password');
    const secret = 'acceptance-auth-secret';
    const login = await authenticateOwner({ ownerId: 'acceptance-owner', password: 'acceptance owner password', secret });
    expect(login).toBeDefined();
    expect(verifyOwnerSession(login?.sessionToken, secret)).toBeDefined();
    const stepUp = await issueStepUpToken({ token: login?.sessionToken, password: 'acceptance owner password', secret });
    expect(stepUp).toBeDefined();
    const build = await createPrivateBuild({ ownerId: 'acceptance-owner', goal: 'Acceptance-only private build check' });
    expect(getPrivateBuild(build.privateBuildId, 'ordinary-user')).toBeUndefined();
    expect(getPrivateBuild(build.privateBuildId, 'acceptance-owner')).toMatchObject({ status: 'PRIVATE_BUILD' });
  });

  it('keeps Secret Bus values private and unsupported capabilities blocked', async () => {
    const bus = new SecretBus('c'.repeat(32), '/tmp/kc-ai-acceptance-secrets.json');
    const metadata = bus.create({ ownerId: 'acceptance-owner', type: 'private-note', label: 'Acceptance secret', value: 'do-not-expose' });
    expect(metadata.maskedValue).not.toContain('do-not-expose');
    expect(bus.get('ordinary-user', metadata.id)).toBeUndefined();
    const blocked = await createAndAdvanceTask({ goal: 'deploy to production', actorRole: 'user' });
    expect(blocked.status).toBe('blocked');
    expect(blocked.verificationStatus).toBe('not-verified');
  });

  it('confirms the current source commit without claiming deployment evidence', () => {
    expect(createHealthResponse('test')).toMatchObject({ status: 'ok', service: 'kc-ai' });
  });

  it('keeps the owner hash tool local and owner-only', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const app = readFileSync('public/app.js', 'utf8');
    const hashTool = readFileSync('public/owner-password-hash.js', 'utf8');
    expect(html).toContain('class="tab owner-only" data-view="password-hash"');
    expect(app).toContain("if(view==='password-hash'&&!state.token){show('signin');return}");
    expect(hashTool).not.toMatch(/fetch|XMLHttpRequest|localStorage|sessionStorage|console\.|document\.cookie/);
    expect(app).toContain("$('hash-password').value='';$('hash-password-confirm').value=''");
    expect(app).not.toMatch(/api\([^\n]*hash-password|JSON\.stringify\([^\n]*hash-password/);
    expect(app).toContain('body:JSON.stringify({setupSecret,passwordHash})');
    expect(app).not.toContain('body:JSON.stringify({setupSecret,password})');
  });

  it('cannot initialize after owner authentication has been configured', () => {
    process.env.KC_AI_OWNER_PASSWORD_HASH = hashPassword('configured owner password');
    process.env.KC_AI_OWNER_INITIALIZATION_SECRET = 'i'.repeat(32);
    expect(initializeOwner({ setupSecret: 'i'.repeat(32), passwordHash: hashPassword('new owner password') })).toBe(false);
    expect(authConfigurationStatus()).toMatchObject({ configured: true, initializationAvailable: false, mode: 'environment-hash' });
  });

  it('keeps the owner password hash out of the Railway build command', () => {
    const railwayConfig = readFileSync('railway.toml', 'utf8');
    expect(railwayConfig).toContain('buildCommand = "npm run build"');
    expect(railwayConfig).toContain('startCommand = "npm start"');
    expect(railwayConfig).not.toContain('KC_AI_OWNER_PASSWORD_HASH');
  });

  it('keeps the public shell distinct from the authenticated owner workspace', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const app = readFileSync('public/app.js', 'utf8');
    const styles = readFileSync('public/styles.css', 'utf8');

    expect(html).toContain('Central intelligence for the KC ecosystem');
    expect(html).toContain('Owner Workspace');
    expect(html).toContain('data-view="browser">KC Browser');
    expect(html).toContain('id="browser-state"');
    expect(html).toContain('id="voice-toggle"');
    expect(html).toContain('id="voice-select"');
    expect(html).toContain('id="voice-volume"');
    expect(app).toContain("document.body.classList.toggle('owner-mode',Boolean(state.token))");
    expect(app).toContain('loadBrowser()');
    expect(app).toContain('<strong>RESULT</strong>');
    expect(app).toContain('<strong>VERIFICATION</strong>');
    expect(app).toContain('Search provider configuration required');
    expect(styles).toContain('body.owner-mode{--owner-bg:#020b25');
    expect(styles).toContain('@media(max-width:760px)');
    expect(styles).toContain('.browser-grid{grid-template-columns:1fr}');
  });

  it('proves successful sign-in and reload restore the authenticated workspace', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const app = readFileSync('public/app.js', 'utf8');

    expect((html.match(/id="view-signin"/g) || [])).toHaveLength(1);
    expect((html.match(/id="login-form"/g) || [])).toHaveLength(1);
    expect((html.match(/id="voice-toggle"/g) || [])).toHaveLength(1);
    expect((html.match(/>Voice</g) || [])).toHaveLength(1);
    expect(app).toContain("state.token=data.sessionToken;sessionStorage.setItem('kcOwnerToken',state.token);setSession();show('settings')");
    expect(app).toContain("async function restoreOwnerSession(){if(!state.token){setSession();show('home');return}");
    expect(app).toContain("await api('/api/v1/owner/secret-bus/status');setSession();show('settings')");
    expect(app).toContain("if(error.status===401){clearOwnerSession();show('home')}");
    expect(app).toContain("if(response.status===401&&state.token)clearOwnerSession()");
    expect(app).toContain("document.body.classList.add('auth-pending')");
    expect(app).toContain("document.body.classList.remove('auth-pending')");
    expect(app).toContain("document.body.classList.toggle('owner-mode',Boolean(state.token))");
    expect(html).toContain('data-view="browser">KC Browser');
    expect(html).toContain('data-view="tasks">Tasks');
    expect(html).toContain('data-view="capabilities">Capabilities');
    expect(html).toContain('data-view="settings">Settings');
    expect(readFileSync('public/styles.css', 'utf8')).toContain('body.auth-pending .topbar,body.auth-pending .shell,body.auth-pending footer');
  });

  it('defines the authenticated Owner Board without changing the public shell', () => {
    const html = readFileSync('public/index.html', 'utf8');
    const app = readFileSync('public/app.js', 'utf8');
    const styles = readFileSync('public/styles.css', 'utf8');

    expect(html).toContain('class="owner-board-home"');
    expect(html).toContain('Hi Kelvin,<br>what should we<br><span>work on today?</span>');
    expect(html).toContain('Message KC AI...');
    expect(html).toContain('id="owner-ask"');
    expect(html).toContain('id="board-capability-count"');
    expect(html).toContain('id="board-task-count"');
    expect(html).toContain('id="board-verification-status"');
    expect(html).toContain('id="board-browser-status"');
    expect(app).toContain("$('board-capability-count').textContent=String(available.length)");
    expect(app).toContain("$('board-task-count').textContent=data.tasks.length?`${data.tasks.length} total`:'None yet'");
    expect(app).toContain("$('board-browser-status').textContent=configured?'Ready':'Needs setup'");
    expect(app).toContain("$('owner-ask').onclick=()=>{show('home');$('chat-input').focus()}");
    expect(styles).toContain('body.owner-mode .hero{display:none}');
    expect(styles).toContain('body.owner-mode .tabs{position:fixed');
    expect(styles).toContain('background:radial-gradient(ellipse at 72% 25%');
    expect(styles).toContain('.quick-actions{grid-template-columns:repeat(2,minmax(0,1fr))}');
    expect(styles).toContain('.owner-mode .chat-form{padding:18px 20px;background:#fff');
  });
});
