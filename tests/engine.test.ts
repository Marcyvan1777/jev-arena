import { describe, expect, it } from 'vitest';
import { ACTION_RULES, DEFAULT_CONFIG, PERSONALITY_PROMPTS, RULES } from '../shared/rules.js';
import { PERSONALITIES, SIDES } from '../shared/types.js';
import { createBattle, damageFor, judgeScore, legalActions, resolveTurn } from '../server/src/game/engine.js';
import { demoDecision } from '../server/src/ai/demoDecisionEngine.js';

const bout = () => createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 42 });
describe('boxing engine', () => {
  it('starts in punch range and filters actions by stamina and cooldown', () => {
    const state = bout(); expect(legalActions(state, 'red')).toContain('UPPERCUT');
    state.robots.red.stamina = 6; expect(legalActions(state, 'red')).not.toContain('JAB'); expect(legalActions(state, 'red')).toContain('GUARD');
    state.status = 'finished'; expect(legalActions(state, 'red')).toEqual([]);
  });
  it('resolves simultaneous punches from an unchanged snapshot and supports defense', () => {
    const state = bout(), before = structuredClone(state), next = resolveTurn(state, { red: 'JAB', blue: 'JAB' });
    expect(state).toEqual(before); expect(next.robots.red.stats.punchesThrown).toBe(1); expect(next.robots.blue.stats.punchesThrown).toBe(1);
    const guarded = resolveTurn(bout(), { red: 'HOOK', blue: 'GUARD' }); expect(guarded.events.some(e => e.kind === 'block' || e.kind === 'miss')).toBe(true);
  });
  it('applies punch damage, stamina and cooldowns', () => {
    let state = bout(); expect(damageFor(state.robots.red, state.robots.blue, 'CROSS', false)).toBeGreaterThan(damageFor(state.robots.red, state.robots.blue, 'JAB', false));
    state = resolveTurn(state, { red: 'CROSS', blue: 'GUARD' }); expect(state.robots.red.stamina).toBe(96); expect(state.robots.red.cooldown).toBe(1);
    state = resolveTurn(state, { red: 'JAB', blue: 'GUARD' }); expect(state.robots.red.cooldown).toBe(0);
  });
  it('uses KO/TKO/judges conditions and finite overtime rather than surge damage', () => {
    const state = bout(); state.config.maxRounds = 1; const end = resolveTurn(state, { red: 'JAB', blue: 'GUARD' });
    expect(end.status === 'finished' || end.overtimeTurns === 1).toBe(true); expect(judgeScore(end.robots.red)).toBeGreaterThanOrEqual(0);
  });
  it('keeps personalities and action set meaningful', () => {
    expect(Object.keys(ACTION_RULES)).toHaveLength(10); expect(new Set(Object.values(PERSONALITY_PROMPTS)).size).toBe(PERSONALITIES.length); expect(RULES.refereeBreakAfter).toBeGreaterThan(0);
  });
  it('runs deterministic demo bouts with no API calls', async () => {
    let state = bout(); const context = { signal: new AbortController().signal, maxCalls: 0, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 } };
    while (state.status !== 'finished') { const [red, blue] = await Promise.all(SIDES.map(side => demoDecision(state, side, context))); state = resolveTurn(state, { red: red.action, blue: blue.action }); }
    expect(context.usage.apiCalls).toBe(0); expect(state.round).toBeLessThanOrEqual(state.config.maxRounds + RULES.suddenDeathTurns);
  });
});
