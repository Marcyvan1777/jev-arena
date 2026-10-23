import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import type { DecisionEngine } from '../server/src/ai/jevDecisionEngine.js';
import { MatchManager } from '../server/src/matchManager.js';
import { PublicError } from '../server/src/errors.js';

const choice: DecisionEngine = async (state, side) => ({ robot: side, action: 'GUARD', round: state.round + 1, source: 'jev', latencyMs: 1, legalActions: ['GUARD'] });
describe('authoritative session lifecycle', () => {
  it('deduplicates concurrent requests and repeated completed turn requests', async () => {
    const decide = vi.fn(choice), manager = new MatchManager(decide), view = manager.create(DEFAULT_CONFIG);
    const [a, b] = await Promise.all([manager.turn(view.id, 0, 0, true), manager.turn(view.id, 0, 0, true)]);
    expect(decide).toHaveBeenCalledTimes(2); expect(a.state.round).toBe(1); expect(b.state.round).toBe(1);
    await manager.turn(view.id, 0, 0, true); expect(decide).toHaveBeenCalledTimes(2);
  });
  it('gives both independent calls the exact same pre-turn battlefield', async () => {
    const snapshots: unknown[] = [];
    const manager = new MatchManager(async (state, side, ctx) => { snapshots.push(structuredClone(state)); return choice(state, side, ctx); });
    const view = manager.create(DEFAULT_CONFIG); await manager.turn(view.id, 0, 0, true);
    expect(snapshots).toHaveLength(2); expect(snapshots[0]).toEqual(snapshots[1]);
  });
  it('does not commit failed turns and reuses the successful robot on Retry', async () => {
    let fail = true;
    const decide = vi.fn<DecisionEngine>(async (s, side, ctx) => { if (side === 'blue' && fail) throw new PublicError('Provider unavailable', 502); return choice(s, side, ctx); });
    const manager = new MatchManager(decide), view = manager.create(DEFAULT_CONFIG);
    await expect(manager.turn(view.id, 0, 0, true)).rejects.toThrow('Provider');
    expect(manager.get(view.id).state.round).toBe(0); expect(manager.get(view.id).paused).toBe(true);
    fail = false; await manager.turn(view.id, 0, 0, true);
    expect(decide).toHaveBeenCalledTimes(3); expect(manager.get(view.id).state.round).toBe(1);
  });
  it('invalidates responses after pause and reset even if a provider ignores abort', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const manager = new MatchManager(async (...args) => { await gate; return choice(...args); });
    const view = manager.create(DEFAULT_CONFIG), turn = manager.turn(view.id, 0, 0, true);
    const rejected = expect(turn).rejects.toThrow('cancelled');
    const reset = manager.reset(view.id, { ...DEFAULT_CONFIG, seed: 99 });
    release(); await rejected; const after = await reset;
    expect(after.state.round).toBe(0); expect(after.generation).toBe(1); expect(after.state.config.seed).toBe(99);
    await expect(manager.turn(view.id, 0, 0, true)).rejects.toThrow('Stale');
  });
  it('requires resume for autoplay but allows one paused step', async () => {
    const manager = new MatchManager(choice), view = manager.create(DEFAULT_CONFIG);
    await expect(manager.turn(view.id, 0, 0)).rejects.toThrow('paused');
    const after = await manager.turn(view.id, 0, 0, true); expect(after.state.round).toBe(1); expect(after.paused).toBe(true);
  });
  it('demo mode does not invoke the real engine', async () => {
    const decide = vi.fn(choice), manager = new MatchManager(decide), view = manager.create({ ...DEFAULT_CONFIG, mode: 'demo' });
    await manager.turn(view.id, 0, 0, true); expect(decide).not.toHaveBeenCalled();
    expect(manager.get(view.id).usage.apiCalls).toBe(0);
  });
  it('runs the requested number of Demo Mode bouts without invoking Jev', async () => {
    const decide = vi.fn(choice), manager = new MatchManager(decide);
    const result = await manager.tournament({ ...DEFAULT_CONFIG, mode: 'demo' }, 7);
    expect(result.fights).toBe(7); expect(result.redWins + result.blueWins + result.draws).toBe(7);
    expect(result.punchesThrown).toBeGreaterThan(0); expect(decide).not.toHaveBeenCalled();
  });
});
