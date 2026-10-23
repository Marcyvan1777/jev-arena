import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, RULES } from '../shared/rules.js';
import { SIDES } from '../shared/types.js';
import type { Action, Battlefield } from '../shared/types.js';
import { createBattle, damageFor, isFatigued, legalActions as legalActionsOf, resolveTurn } from '../server/src/game/engine.js';
import { demoDecision } from '../server/src/ai/demoDecisionEngine.js';
import { MatchManager } from '../server/src/matchManager.js';

const bout = (patch: Partial<typeof DEFAULT_CONFIG> = {}, tweak?: (state: Battlefield) => void) => { const state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 42, ...patch }); tweak?.(state); return state; };
const guardTurns = (state: Battlefield, turns: number) => { for (let i = 0; i < turns; i++) state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' }); return state; };
function find2(red: Action, blue: Action, want: (next: Battlefield) => boolean, patch: (state: Battlefield) => void) { for (let seed = 1; seed < 600; seed++) { const next = resolveTurn(bout({ seed }, patch), { red, blue }); if (want(next)) return next; } throw new Error('no seed'); }
const context = () => ({ signal: new AbortController().signal, maxCalls: 0, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 } });

describe('boxing rounds, cards and rest', () => {
  it('rings the bell after each round and scores an even round 10-10', () => {
    const state = guardTurns(bout(), RULES.exchangesPerRound);
    expect(state.cards).toHaveLength(1); expect(state.cards[0]).toMatchObject({ round: 1, red: 10, blue: 10, note: 'Even round', deductions: { red: 0, blue: 0 } }); expect(state.cards[0].judges).toEqual([{ red: 10, blue: 10 }, { red: 10, blue: 10 }, { red: 10, blue: 10 }]);
    expect(state.boxingRound).toBe(2);
    expect(state.events.some(e => e.kind === 'bell')).toBe(true);
  });
  it('gives the round to the boxer who scored more, 10-9 or 10-8 when dominant', () => {
    let state = guardTurns(bout(), RULES.exchangesPerRound - 1);
    state.robots.red.stats.damage = 20; state.robots.red.stats.punchesLanded = 3;
    state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    expect(state.cards[0]).toMatchObject({ red: 10, blue: 9 });
    state = guardTurns(bout(), RULES.exchangesPerRound - 1);
    state.robots.blue.stats.damage = 60; state.robots.blue.stats.punchesLanded = 8;
    state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    expect(state.cards[0]).toMatchObject({ red: 8, blue: 10 });
  });
  it('restores stamina and a little health between rounds and clears cooldowns', () => {
    let state = guardTurns(bout(), RULES.exchangesPerRound - 1);
    state.robots.red.hp = 100; state.robots.red.stamina = 30; state.robots.red.cooldown = 2;
    state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    expect(state.robots.red.hp).toBe(100 + RULES.restHealth);
    expect(state.robots.red.stamina).toBe(30 + RULES.staminaRegen + RULES.restStamina);
    expect(state.robots.red.cooldown).toBe(0);
  });
  it('decides a full-distance fight on the cards, then on total scoring when cards are level', () => {
    let state = guardTurns(bout({ maxRounds: RULES.exchangesPerRound }), RULES.exchangesPerRound - 1);
    state.robots.red.stats.damage = 25; state.robots.red.stats.punchesLanded = 4;
    state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    expect(state.status).toBe('finished'); expect(state.winner).toBe('red'); expect(state.finishReason).toContain('unanimous');
    // Level cards (a 2-point gap rounds to 10-10) but a higher total score still separates them.
    state = guardTurns(bout({ maxRounds: RULES.exchangesPerRound }), RULES.exchangesPerRound - 1);
    state.robots.blue.stats.damage = 1;
    state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    expect(state.winner).toBe('blue'); expect(state.finishReason).toContain('total scoring');
  });
  it('weakens a gassed boxer', () => {
    const state = bout(), red = state.robots.red, blue = state.robots.blue;
    red.stamina = RULES.fatigueBelow - 1; expect(isFatigued(red)).toBe(true);
    expect(damageFor(red, blue, 'CROSS', false, true)).toBeLessThan(damageFor(red, blue, 'CROSS', false, false));
    red.stamina = RULES.fatigueBelow; expect(isFatigued(red)).toBe(false);
  });
});

describe('demo bots and corner fairness', () => {
  it('plays mirror matches without a corner advantage and actually uses footwork', async () => {
    let redWins = 0, decided = 0, movement = 0, actions = 0;
    for (let seed = 1; seed <= 80; seed++) {
      let state = bout({ seed, red: { name: 'A', personality: 'TACTICIAN' }, blue: { name: 'B', personality: 'TACTICIAN' } });
      while (state.status !== 'finished') {
        const [red, blue] = await Promise.all(SIDES.map(side => demoDecision(state, side, context())));
        state = resolveTurn(state, { red: red.action, blue: blue.action }, [red, blue]);
      }
      if (state.winner === 'red') redWins++; if (state.winner !== 'draw') decided++;
      for (const side of SIDES) { movement += (state.robots[side].stats.actions.STEP_IN || 0) + (state.robots[side].stats.actions.STEP_BACK || 0); actions += state.round; }
    }
    expect(redWins / decided).toBeGreaterThan(0.3); expect(redWins / decided).toBeLessThan(0.7);
    expect(movement / actions).toBeGreaterThan(0.02);
  }, 30000);
  it('swaps corners every other tournament bout and reports contender results with a confidence interval', async () => {
    const manager = new MatchManager(), config = { ...DEFAULT_CONFIG, mode: 'demo' as const, red: { name: 'ALPHA', personality: 'BERSERKER' as const }, blue: { name: 'OMEGA', personality: 'COUNTERPUNCHER' as const } };
    const result = await manager.tournament(config, 6);
    expect(result.bouts.map(b => b.aIsRed)).toEqual([true, false, true, false, true, false]);
    expect(result.contenderA.label).toBe('ALPHA'); expect(result.contenderB.label).toBe('OMEGA');
    expect(result.contenderA.wins + result.contenderB.wins + result.draws).toBe(6);
    expect(result.redWins + result.blueWins + result.draws).toBe(6);
    const { winRate, ci95 } = result.contenderA; expect(ci95[0]).toBeLessThanOrEqual(winRate); expect(winRate).toBeLessThanOrEqual(ci95[1]);
    const fixed = await manager.tournament(config, 4, undefined, undefined, false);
    expect(fixed.bouts.every(b => b.aIsRed)).toBe(true);
  }, 30000);
  it('cancels a running tournament', async () => {
    const manager = new MatchManager(), started = manager.startTournament({ ...DEFAULT_CONFIG, mode: 'demo' }, 100);
    expect(manager.cancelTournament(started.id).status).toBe('cancelled');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(manager.getTournament(started.id).status).toBe('cancelled');
  });
});

describe('real-boxing rules: clinching, fouls, judges and the count', () => {
  it('lets a close boxer tie the opponent up, recover stamina and smother their punches without earning guard credit', () => {
    const state = bout(); state.robots.red.stamina = 40;
    expect(legalActionsOf(state, 'red')).toContain('CLINCH');
    let result: Battlefield | null = null;
    for (let seed = 1; seed < 300 && !result; seed++) { const next = resolveTurn(bout({ seed }), { red: 'CLINCH', blue: 'HOOK' }); if (next.events.some(e => e.kind === 'block' && e.message.includes('smothered'))) result = next; }
    expect(result).not.toBeNull(); expect(result!.robots.blue.stats.blocks).toBe(0); expect(result!.robots.red.stats.blocks).toBe(0);
    const clinch = resolveTurn(state, { red: 'CLINCH', blue: 'GUARD' });
    expect(clinch.robots.red.stamina).toBe(40 - 2 + RULES.staminaRegen + RULES.clinchRecover);
    expect(clinch.robots.red.stats.punchesThrown).toBe(0);
  });
  it('warns on a second clinch in a row and takes a point on the third', () => {
    let state = bout();
    for (let i = 0; i < 3; i++) state = resolveTurn(state, { red: 'CLINCH', blue: 'GUARD' });
    const all = state.events.map(e => e.message).join('\n');
    expect(all).toContain('WARNING'); expect(all).toContain('POINT DEDUCTION'); expect(state.robots.red.deduction).toBe(1);
    // the point comes off the round card for every judge
    for (let i = 3; i < RULES.exchangesPerRound; i++) state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    expect(state.cards[0].deductions.red).toBe(1); expect(state.cards[0].red).toBe(9); expect(state.cards[0].judges.every(j => j.red === 9 && j.blue === 10)).toBe(true);
  });
  it('lets a downed boxer recover a little during the count', () => {
    const next = find2('UPPERCUT', 'JAB', n => n.events.some(e => e.kind === 'knockdown' && e.target === 'blue'), s => { s.robots.blue.hp = 60; s.robots.blue.stamina = 30; });
    expect(next.robots.blue.stamina).toBeGreaterThan(30 - 7 + RULES.staminaRegen); // the jab costs 7 and regen adds 9; the count adds more
  });
  it('produces a split decision when the three judges disagree, and names the winner on the majority', () => {
    // Judge 2 prizes clean punches, Judge 3 prizes defence: give red the clean punches and blue the slips.
    let state = bout({ maxRounds: RULES.exchangesPerRound });
    for (let i = 0; i < RULES.exchangesPerRound - 1; i++) state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    state.robots.red.stats.cleanHits = 10; state.robots.blue.stats.dodges = 8;
    state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' });
    expect(state.status).toBe('finished'); expect(state.finishReason).toContain('split'); expect(state.winner).toBe('red');
  });
});
