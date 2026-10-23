import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { analyseGrid, buildContenders, buildPairings, estimateGrid } from '../shared/grid.js';
import type { GridBout, GridSetup } from '../shared/grid.js';
import { createApp } from '../server/src/app.js';
import { MatchManager } from '../server/src/matchManager.js';

const live: GridSetup = { mode: 'jev', models: ['jev', 'claude'], personalities: ['BERSERKER', 'COUNTERPUNCHER'], boutsPerPairing: 4, maxRounds: 36, baseSeed: 42, includeMirror: false, concurrency: 3 };
const demo: GridSetup = { ...live, mode: 'demo', models: ['demo'], personalities: ['BERSERKER', 'COUNTERPUNCHER', 'TACTICIAN'] };
const bout = (a: string, b: string, winner: GridBout['winner']): GridBout => ({ pairing: 0, a, b, aIsRed: true, seed: 1, winner, kind: 'decision', reason: '', exchanges: 36, hpA: 100, hpB: 100, apiCalls: 0 });

describe('grid setup', () => {
  it('crosses every model with every personality and names them MODEL (PERSONALITY)', () => {
    const contenders = buildContenders(live);
    expect(contenders.map(c => c.name)).toEqual(['JEV (BERSERKER)', 'JEV (COUNTERPUNCHER)', 'CLAUDE (BERSERKER)', 'CLAUDE (COUNTERPUNCHER)']);
    expect(buildPairings(contenders, false)).toHaveLength(6); expect(buildPairings(contenders, true)).toHaveLength(10);
  });
  it('estimates bouts and the paid API calls before anything runs', () => {
    const estimate = estimateGrid(live);
    expect(estimate.bouts).toBe(24); expect(estimate.callsMax).toBe(24 * 2 * 36); expect(estimate.callsByProvider.jev).toBeGreaterThan(0); expect(estimate.callsByProvider.claude).toBeGreaterThan(0);
    expect(estimateGrid(demo).callsMax).toBe(0); expect(estimateGrid(demo).minutes).toBeNull();
  });
});

describe('grid analysis', () => {
  it('credits the model only from bouts where the personality is equal, and the personality only where the model is equal', () => {
    const c = buildContenders(live), id = (name: string) => c.find(x => x.name === name)!.id;
    const bouts = [
      // Claude always beats Jev with the same personality; BERSERKER always beats COUNTERPUNCHER on the same model.
      bout(id('JEV (BERSERKER)'), id('CLAUDE (BERSERKER)'), 'B'), bout(id('JEV (COUNTERPUNCHER)'), id('CLAUDE (COUNTERPUNCHER)'), 'B'),
      bout(id('JEV (BERSERKER)'), id('JEV (COUNTERPUNCHER)'), 'A'), bout(id('CLAUDE (BERSERKER)'), id('CLAUDE (COUNTERPUNCHER)'), 'A'),
      // A mixed bout (both differ) must not move either controlled effect.
      bout(id('JEV (BERSERKER)'), id('CLAUDE (COUNTERPUNCHER)'), 'A'),
    ];
    const analysis = analyseGrid(c, bouts);
    expect(analysis.modelEffect.find(e => e.key === 'claude')!.scoreRate).toBe(1); expect(analysis.modelEffect.find(e => e.key === 'jev')!.scoreRate).toBe(0);
    expect(analysis.personalityEffect.find(e => e.key === 'BERSERKER')!.scoreRate).toBe(1);
    expect(analysis.modelEffect.every(e => e.bouts === 2)).toBe(true);
    expect(analysis.standings[0].played).toBeGreaterThan(0); expect(analysis.verdict).toMatch(/matter/);
  });
  it('keeps a head-to-head matrix that adds up and counts a draw as half a point for both', () => {
    const c = buildContenders(demo), [a, b] = c, analysis = analyseGrid(c, [bout(a.id, b.id, 'A'), bout(a.id, b.id, 'draw')]);
    expect(analysis.matrix[a.id][b.id]).toEqual({ score: 0.75, played: 2 }); expect(analysis.matrix[b.id][a.id]).toEqual({ score: 0.25, played: 2 });
    expect(analysis.standings.find(s => s.id === a.id)).toMatchObject({ wins: 1, draws: 1, losses: 0, played: 2 });
  });
});

const wait = async (poll: () => Promise<{ status: string }>) => { let last = await poll(); for (let i = 0; i < 400 && last.status === 'running'; i++) { await new Promise(r => setTimeout(r, 15)); last = await poll(); } return last; };
describe('running a grid', () => {
  it('plays every pairing the requested number of times and finishes with a consistent leaderboard', async () => {
    const manager = new MatchManager(), started = manager.startGrid(demo);
    expect(started.totalBouts).toBe(12);
    const done = await wait(async () => manager.getGrid(started.id)) as ReturnType<MatchManager['getGrid']>;
    expect(done.status).toBe('finished'); expect(done.completedBouts).toBe(12); expect(done.apiCalls).toBe(0);
    expect(done.analysis.standings.reduce((n, s) => n + s.played, 0)).toBe(24); // each bout is played by two contenders
    expect(done.analysis.standings.reduce((n, s) => n + s.score, 0)).toBeCloseTo(12, 5); // exactly one point per bout is shared out
    for (const a of done.contenders) for (const b of done.contenders) if (a.id !== b.id) expect(done.analysis.matrix[a.id][b.id].score + done.analysis.matrix[b.id][a.id].score).toBeCloseTo(1, 5);
  }, 30000);
  it('can be cancelled part way and keeps what finished', async () => {
    const manager = new MatchManager(), started = manager.startGrid({ ...demo, boutsPerPairing: 40, includeMirror: true });
    await new Promise(r => setTimeout(r, 40)); const cancelled = manager.cancelGrid(started.id);
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.completedBouts).toBeLessThan(cancelled.totalBouts);
  });
  it('retries a provider hiccup instead of throwing the whole bout away', async () => {
    let failures = 1;
    const manager = new MatchManager(async (state, side) => {
      if (side === 'blue' && failures-- > 0) { const { PublicError } = await import('../server/src/errors.js'); throw new PublicError('Provider unavailable', 502); }
      return { robot: side, action: 'GUARD', round: state.round + 1, source: 'jev', latencyMs: 1, legalActions: ['GUARD'] };
    });
    const { createBattle } = await import('../server/src/game/engine.js'); const { DEFAULT_CONFIG } = await import('../shared/rules.js');
    const config = { ...DEFAULT_CONFIG, maxRounds: 12 }; expect(createBattle(config)).toBeTruthy();
    const { state } = await manager.playBout(config, new AbortController().signal);
    expect(state.status).toBe('finished'); expect(failures).toBeLessThan(0);
  }, 20000);
});

describe('grid HTTP boundary', () => {
  let server: Server, base: string;
  beforeEach(async () => { server = createApp(new MatchManager()).listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`; });
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  it('estimates, refuses a paid grid without confirmation, and runs a demo grid', async () => {
    expect((await (await post('/grid/estimate', live)).json()).bouts).toBe(24);
    const paid = await post('/grid', { setup: live, confirmPaid: false }); expect(paid.status).toBe(400); expect((await paid.json()).error).toContain('Confirm');
    const odd = await post('/grid', { setup: { ...demo, boutsPerPairing: 3 }, confirmPaid: false }); expect(odd.status).toBe(400);
    const started = await post('/grid', { setup: { ...demo, boutsPerPairing: 2 }, confirmPaid: false }); expect(started.status).toBe(202);
    const job = await started.json(), done = await wait(async () => (await fetch(`${base}/grid/${job.id}`)).json());
    expect(done.status).toBe('finished');
  }, 20000);
});

describe('watching a simulation', () => {
  it('streams each bout exchange by exchange, in order, from the opening bell to the final state', async () => {
    const manager = new MatchManager(), setup = { ...demo, personalities: ['BERSERKER', 'COUNTERPUNCHER'] as GridSetup['personalities'], boutsPerPairing: 2 };
    const started = manager.startGrid(setup, { speed: null });
    const seen = new Map<string, number[]>(); let key = '', after = -1, labels = new Set<string>(), state = 'running';
    for (let i = 0; i < 600 && state === 'running'; i++) {
      const packet = manager.getLive(started.id, key, after); labels.add(packet.label);
      if (packet.key !== key) { key = packet.key; after = -1; }
      for (const s of packet.states) { seen.set(key, [...(seen.get(key) ?? []), s.round]); after = Math.max(after, s.round); }
      state = manager.getGrid(started.id).status; await new Promise(r => setTimeout(r, 12));
    }
    expect(seen.size).toBe(2); expect(labels.size).toBeGreaterThanOrEqual(2);
    for (const rounds of seen.values()) { expect(rounds[0]).toBe(0); expect(rounds.slice(1).every((r, i) => r === rounds[i] + 1)).toBe(true); }
  }, 30000);
  it('lets the viewer change the pace while it runs, and refuses jobs that are not being watched', async () => {
    const manager = new MatchManager(), started = manager.startGrid({ ...demo, boutsPerPairing: 2 }, { speed: 4 });
    expect(manager.setPace(started.id, 8)).toEqual({ speed: 8 }); expect(manager.getLive(started.id, '', -1).speed).toBe(8);
    manager.cancelGrid(started.id);
    const plain = manager.startGrid({ ...demo, boutsPerPairing: 2 });
    expect(() => manager.getLive(plain.id, '', -1)).toThrow('Nothing to watch'); manager.cancelGrid(plain.id);
  });
});

describe('watching a head-to-head tournament', () => {
  it('streams its bouts too, with the corners swapping between them', async () => {
    const { DEFAULT_CONFIG } = await import('../shared/rules.js'), manager = new MatchManager();
    const started = manager.startTournament({ ...DEFAULT_CONFIG, mode: 'demo' }, 2, true, { speed: null });
    const labels = new Set<string>(); let done = false;
    for (let i = 0; i < 600 && !done; i++) { labels.add(manager.getLive(started.id, '', -1).label); done = manager.getTournament(started.id).status !== 'running'; await new Promise(r => setTimeout(r, 12)); }
    expect(manager.getTournament(started.id).status).toBe('finished'); expect([...labels].filter(Boolean).length).toBe(2);
  }, 30000);
});

describe('the local rule-based bot as a baseline', () => {
  it('can take part in a live grid next to a model, and costs no API calls itself', () => {
    const setup: GridSetup = { ...live, models: ['jev', 'demo'], personalities: ['BERSERKER', 'COUNTERPUNCHER'] };
    expect(buildContenders(setup).map(c => c.name)).toEqual(['JEV (BERSERKER)', 'JEV (COUNTERPUNCHER)', 'DEMO (BERSERKER)', 'DEMO (COUNTERPUNCHER)']);
    const estimate = estimateGrid(setup);
    expect(estimate.callsByProvider.demo).toBeUndefined(); expect(estimate.callsByProvider.jev).toBeGreaterThan(0);
    expect(estimate.callsMax).toBeLessThan(estimateGrid({ ...setup, models: ['jev', 'claude'] }).callsMax);
  });
  it('plays a decision model against an LLM-style provider in the same ring, on the same rules', async () => {
    const { DEFAULT_CONFIG } = await import('../shared/rules.js');
    const manager = new MatchManager(async (state, side) => ({ robot: side, action: 'GUARD', round: state.round + 1, source: 'jev', latencyMs: 5, legalActions: ['GUARD'] }));
    const view = manager.create({ ...DEFAULT_CONFIG, providers: { red: 'demo', blue: 'jev' } }), after = await manager.turn(view.id, 0, 0, true);
    expect(after.state.decisions.map(d => `${d.robot}:${d.source}`).sort()).toEqual(['blue:jev', 'red:demo']);
  });
});
