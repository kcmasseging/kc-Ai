import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync('public/app.js', 'utf8');
const styles = readFileSync('public/styles.css', 'utf8');

describe('KC Robot visible interface contract', () => {
  it('mounts a standing robot with owner-focused state labels', () => {
    expect(app).toContain('className=\'robot-stage\'');
    expect(app).toContain('KC Robot');
    expect(app).toContain("thinking:'Thinking'");
    expect(app).toContain("speaking:'Speaking'");
    expect(app).toContain("blocked:'Owner action required'");
  });

  it('uses the authenticated owner task intake and real validation status', () => {
    expect(app).toContain("state.token?'/api/v1/owner/tasks':'/api/v1/tasks'");
    expect(app).toContain("task.status==='completed'");
    expect(app).toContain("setRobotState('blocked')");
  });

  it('keeps the character lightweight and mobile responsive in official colors', () => {
    expect(styles).toContain('.robot-character');
    expect(styles).toContain('#1457d9');
    expect(styles).toContain('#e8b92f');
    expect(styles).toContain('#d9383e');
    expect(styles).toContain('@media(max-width:760px){.robot-stage');
  });
});