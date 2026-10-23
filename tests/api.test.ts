import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { createApp } from '../server/src/app.js';
import { MatchManager } from '../server/src/matchManager.js';

let server: Server, base: string;
beforeEach(async () => {
  const manager = new MatchManager(async (s, side) => ({ robot: side, action: 'GUARD', source: 'jev', round: s.round + 1, latencyMs: 0, legalActions: ['GUARD'] }));
  server = createApp(manager).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.on('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
const post = (path: string, body: unknown, origin?: string) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
describe('local HTTP boundary', () => {
  it('creates, steps, retrieves and resets authoritative state', async () => {
    const created = await post('/matches', { ...DEFAULT_CONFIG, mode: 'demo' }); expect(created.status).toBe(201);
    const match = await created.json();
    const turn = await post(`/matches/${match.id}/turn`, { round: 0, generation: 0, step: true });
    expect((await turn.json()).state.round).toBe(1);
    const reset = await post(`/matches/${match.id}/reset`, { ...DEFAULT_CONFIG, mode: 'demo' });
    const value = await reset.json(); expect(value.state.round).toBe(0); expect(value.generation).toBe(1);
    expect((await fetch(`${base}/matches/${match.id}`)).status).toBe(200);
  });
  it('rejects invalid settings and foreign origins before spending credits', async () => {
    expect((await post('/matches', { ...DEFAULT_CONFIG, red: { name: '', personality: 'UNKNOWN' } })).status).toBe(400);
    expect((await post('/matches', DEFAULT_CONFIG, 'https://unrelated.example')).status).toBe(403);
  });
  it('runs an exact-count Demo tournament without touching the real provider', async () => {
    const started = await post('/tournaments', { config: { ...DEFAULT_CONFIG, mode: 'demo' }, fights: 3 });
    const job = await started.json(); expect(started.status).toBe(202); expect(job.fights).toBe(3);
    let body = job; for (let attempt = 0; attempt < 20 && body.status === 'running'; attempt++) { await new Promise(resolve => setTimeout(resolve, 10)); body = await (await fetch(`${base}/tournaments/${job.id}`)).json(); }
    expect(body.status).toBe('finished'); expect(body.summary.redWins + body.summary.blueWins + body.summary.draws).toBe(3);
  });
  it('requires an explicit confirmation before a live provider tournament can start', async () => {
    const response = await post('/tournaments', { config: DEFAULT_CONFIG, fights: 1, confirmPaid: false });
    expect(response.status).toBe(400); expect((await response.json()).error).toContain('Confirm paid');
  });
  it('returns only a credential-presence flag in health, never the key', async () => {
    const response = await fetch(`${base}/health`), body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['claudeConfigured', 'jevConfigured', 'maxRounds', 'model', 'ok', 'openaiConfigured']);
    expect(typeof body.jevConfigured).toBe('boolean');
    expect(typeof body.openaiConfigured).toBe('boolean'); expect(typeof body.claudeConfigured).toBe('boolean');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
