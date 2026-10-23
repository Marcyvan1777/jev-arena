// Dependency-free boxing regression suite. It intentionally never calls the live Jev API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, PERSONALITY_PROMPTS, RULES } from '../shared/rules.js';
import { PERSONALITIES, SIDES } from '../shared/types.js';
import { createBattle, damageFor, judgeScore, legalActions, resolveTurn } from '../server/src/game/engine.js';
import { demoDecision } from '../server/src/ai/demoDecisionEngine.js';
import { parseJevResponse } from '../server/src/ai/parseResponse.js';
import { buildQuestion } from '../server/src/ai/questions.js';
import { MatchManager } from '../server/src/matchManager.js';
import { PublicError } from '../server/src/errors.js';

const context = () => ({ signal: new AbortController().signal, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 }, maxCalls: 0 });
const bout = () => createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 42 });
const chooseGuard = async (state, side) => ({ robot: side, action: 'GUARD', round: state.round + 1, source: 'jev', latencyMs: 1, legalActions: ['GUARD'] });

test('boxers begin at punch distance and legal actions only expose affordable boxing choices', () => {
  const state = bout(), legal = legalActions(state, 'red');
  assert(legal.includes('JAB')); assert(legal.includes('CROSS')); assert(legal.includes('HOOK')); assert(legal.includes('UPPERCUT'));
  assert(!legal.includes('STEP_IN')); assert(legal.includes('GUARD'));
  state.robots.red.stamina = 6;
  assert(!legalActions(state, 'red').includes('JAB')); assert(legalActions(state, 'red').includes('GUARD'));
  state.status = 'finished'; assert.deepEqual(legalActions(state, 'red'), []);
});

test('Jev parser accepts actual selection probabilities and rejects invented or illegal choices', () => {
  const raw = { model: 'jev-test', answers: { action: { type: 'choice', choice: 'JAB', confidence: 0.1, probabilities: { JAB: 0.7, GUARD: 0.3 } } } };
  const parsed = parseJevResponse(raw, ['JAB', 'GUARD'], 'red', 1, 25);
  assert.equal(parsed.selectedProbability, 0.7); assert.equal(parsed.model, 'jev-test'); assert(!('confidence' in parsed));
  assert.throws(() => parseJevResponse({ answers: { action: { choice: 'FLY' } } }, ['JAB'], 'red', 1, 1));
  assert.throws(() => parseJevResponse({ answers: { action: { choice: 'JAB', probabilities: { JAB: .2, GUARD: .2 } } } }, ['JAB', 'GUARD'], 'red', 1, 1));
});

test('boxing Jev payload has fighter state, opponent history, personality and precisely legal criteria', () => {
  const state = bout(); state.robots.blue.history = ['JAB', 'GUARD'];
  const question = buildQuestion(state, 'red');
  assert.deepEqual(Object.keys(question.criteria), legalActions(state, 'red'));
  assert.deepEqual(question.state.recentOpponentActions, ['JAB', 'GUARD']);
  assert.equal(question.state.punchRange, RULES.punchRange);
  assert(question.state.personality.length > 50);
});

test('damage, stamina and cooldowns follow boxing rules', () => {
  let state = bout();
  assert(damageFor(state.robots.red, state.robots.blue, 'CROSS', false) > damageFor(state.robots.red, state.robots.blue, 'JAB', false));
  assert(damageFor(state.robots.red, state.robots.blue, 'HOOK', true) < damageFor(state.robots.red, state.robots.blue, 'HOOK', false));
  state = resolveTurn(state, { red: 'CROSS', blue: 'GUARD' });
  assert.equal(state.robots.red.cooldown, 1); assert.equal(state.robots.red.stamina, 96);
  assert(!legalActions(state, 'red').includes('CROSS'));
  state = resolveTurn(state, { red: 'JAB', blue: 'GUARD' });
  assert.equal(state.robots.red.cooldown, 0);
});

test('simultaneous punches use one snapshot and guard/slip/counter create distinct events', () => {
  const initial = bout(), before = structuredClone(initial);
  const next = resolveTurn(initial, { red: 'JAB', blue: 'JAB' });
  assert.deepEqual(initial, before); assert.equal(next.round, 1); assert.equal(next.robots.red.stats.punchesThrown, 1); assert.equal(next.robots.blue.stats.punchesThrown, 1);
  const guarded = resolveTurn(bout(), { red: 'HOOK', blue: 'GUARD' });
  assert(guarded.events.some(e => e.kind === 'block' || e.kind === 'miss'));
  const countered = resolveTurn(bout(), { red: 'JAB', blue: 'COUNTER' });
  assert.equal(countered.robots.blue.stats.punchesThrown, 1);
});

test('KO, TKO and judges scorecards have explicit outcomes without arena surge damage', () => {
  let state = bout(); state.robots.blue.hp = 1;
  state = resolveTurn(state, { red: 'JAB', blue: 'GUARD' });
  if (state.status === 'finished') assert.equal(state.finishReason, 'Knockout (KO)');
  state = bout(); state.robots.blue.knockdownsTaken = RULES.tkoKnockdowns - 1; state.robots.blue.hp = 90;
  // Find a deterministic seed that turns this uppercut into the final knockdown.
  let tko = null;
  for (let seed = 1; seed < 300 && !tko; seed++) { const s = structuredClone(state); s.config.seed = seed; const n = resolveTurn(s, { red: 'UPPERCUT', blue: 'JAB' }); if (n.status === 'finished' && n.finishReason?.startsWith('Technical')) tko = n; }
  assert(tko);
  const judged = bout(); judged.config.maxRounds = 1;
  const finish = resolveTurn(judged, { red: 'JAB', blue: 'GUARD' });
  assert(finish.status === 'finished' || finish.overtimeTurns === 1);
  assert(judgeScore(finish.robots.red) >= 0);
});

test('100 deterministic demo bouts are reproducible, fight often, and make no API calls', async () => {
  let knockouts = 0, decisions = 0, draws = 0, turns = 0, thrown = 0, landed = 0, movement = 0;
  for (let seed = 1; seed <= 100; seed++) {
    let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed, red: { name: 'RED', personality: 'BERSERKER' }, blue: { name: 'BLUE', personality: 'COUNTERPUNCHER' } });
    const ctx = context();
    while (state.status !== 'finished') {
      const [red, blue] = await Promise.all(SIDES.map(side => demoDecision(state, side, ctx)));
      state = resolveTurn(state, { red: red.action, blue: blue.action }, [red, blue]);
    }
    assert.equal(ctx.usage.apiCalls, 0); turns += state.round; thrown += state.robots.red.stats.punchesThrown + state.robots.blue.stats.punchesThrown; landed += state.robots.red.stats.punchesLanded + state.robots.blue.stats.punchesLanded;
    movement += (state.robots.red.stats.actions.STEP_IN || 0) + (state.robots.red.stats.actions.STEP_BACK || 0) + (state.robots.blue.stats.actions.STEP_IN || 0) + (state.robots.blue.stats.actions.STEP_BACK || 0);
    if (state.finishReason?.includes('Knockout')) knockouts++; else if (state.winner === 'draw') draws++; else decisions++;
  }
  assert.equal(knockouts + decisions + draws, 100); assert(thrown > 600); assert(landed > 250); assert(movement / (turns * 2) < .2); assert(draws <= 2);
});

test('personalities are distinct and manager deduplicates same-generation turns', async () => {
  assert.equal(new Set(Object.values(PERSONALITY_PROMPTS)).size, PERSONALITIES.length);
  let calls = 0; const snapshots = [];
  const manager = new MatchManager(async (state, side) => { calls++; snapshots.push(structuredClone(state)); return chooseGuard(state, side); });
  const view = manager.create(DEFAULT_CONFIG);
  await Promise.all([manager.turn(view.id, 0, 0, true), manager.turn(view.id, 0, 0, true)]);
  assert.equal(calls, 2); assert.deepEqual(snapshots[0], snapshots[1]);
  await manager.turn(view.id, 0, 0, true); assert.equal(calls, 2);
  const failed = new MatchManager(async (state, side) => { if (side === 'blue') throw new PublicError('Provider unavailable', 502); return chooseGuard(state, side); });
  const failedView = failed.create(DEFAULT_CONFIG); await assert.rejects(failed.turn(failedView.id, 0, 0, true)); assert.equal(failed.get(failedView.id).state.round, 0);
});
