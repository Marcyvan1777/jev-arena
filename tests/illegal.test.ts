import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { IllegalMoveError, PublicError } from '../server/src/errors.js';
import { MatchManager } from '../server/src/matchManager.js';
import { parseJevResponse } from '../server/src/ai/parseResponse.js';
import type { DecisionEngine } from '../server/src/ai/jevDecisionEngine.js';

const guard: DecisionEngine = async (state, side) => ({ robot: side, action: 'GUARD', round: state.round + 1, source: 'jev', latencyMs: 1, legalActions: ['GUARD'] });

describe('an illegal answer costs the exchange, never the bout', () => {
  it('reports what the model tried, as an IllegalMoveError', () => {
    try { parseJevResponse({ answers: { action: { type: 'choice', choice: 'FLY' } } }, ['GUARD', 'JAB'], 'red', 1, 1); expect.unreachable(); }
    catch (error) { expect(error).toBeInstanceOf(IllegalMoveError); expect((error as IllegalMoveError).attempted).toBe('FLY'); }
  });
  it('makes the boxer guard, records the fault and keeps the match running', async () => {
    let first = true;
    const manager = new MatchManager(async (state, side, ctx) => { if (side === 'blue' && first) { first = false; throw new IllegalMoveError('Jev selected an illegal action.', 'FLY'); } return guard(state, side, ctx); });
    const view = manager.create(DEFAULT_CONFIG), after = await manager.turn(view.id, 0, 0, true);
    expect(after.error).toBeNull(); expect(after.state.round).toBe(1);
    const blue = after.state.decisions.find(d => d.robot === 'blue')!;
    expect(blue.action).toBe('GUARD'); expect(blue.fallback).toMatchObject({ attempted: 'FLY' });
    expect(after.state.robots.blue.stats.illegalMoves).toBe(1); expect(after.usage.illegalMoves).toBe(1);
    expect(after.state.events.some(e => e.message.startsWith('ILLEGAL MOVE'))).toBe(true);
  });
  it('still stops for a real failure such as a network or credential error', async () => {
    const manager = new MatchManager(async (state, side, ctx) => { if (side === 'blue') throw new PublicError('Provider unavailable', 502); return guard(state, side, ctx); });
    const view = manager.create(DEFAULT_CONFIG);
    await expect(manager.turn(view.id, 0, 0, true)).rejects.toThrow('Provider'); expect(manager.get(view.id).paused).toBe(true);
  });
  it('finishes a whole bout even if a model answers illegally every single turn, and counts every fault', async () => {
    const manager = new MatchManager(async (state, side, ctx) => { if (side === 'blue') throw new IllegalMoveError('illegal', 'NOPE'); return guard(state, side, ctx); });
    const { state } = await manager.playBout({ ...DEFAULT_CONFIG, maxRounds: 12 }, new AbortController().signal);
    expect(state.status).toBe('finished'); expect(state.robots.blue.stats.illegalMoves).toBe(state.round); expect(state.robots.red.stats.illegalMoves).toBe(0);
  });
});
