// Explicitly local balance telemetry: never imports or calls the Jev SDK.
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { SIDES } from '../shared/types.js';
import { createBattle, resolveTurn } from '../server/src/game/engine.js';
import { demoDecision } from '../server/src/ai/demoDecisionEngine.js';

const matches = Number(process.env.BOXING_MATCHES || 100);
const usage = () => ({ apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 });
const totals = { ko: 0, tko: 0, judges: 0, draws: 0, exchanges: 0, thrown: 0, landed: 0, movement: 0 };
for (let seed = 1; seed <= matches; seed++) {
  let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed, red: { name: 'ROBOT RED', personality: 'BERSERKER' }, blue: { name: 'ROBOT BLUE', personality: 'COUNTERPUNCHER' } });
  const context = { signal: new AbortController().signal, maxCalls: 0, usage: usage() };
  while (state.status !== 'finished') {
    const [red, blue] = await Promise.all(SIDES.map(side => demoDecision(state, side, context)));
    state = resolveTurn(state, { red: red.action, blue: blue.action }, [red, blue]);
  }
  if (context.usage.apiCalls) throw new Error('Benchmark must never make Jev API calls.');
  const reason = state.finishReason || '';
  if (reason.includes('Technical knockout')) totals.tko++; else if (reason.includes('Knockout')) totals.ko++; else if (state.winner === 'draw') totals.draws++; else totals.judges++;
  totals.exchanges += state.round;
  for (const side of SIDES) {
    const stats = state.robots[side].stats;
    totals.thrown += stats.punchesThrown; totals.landed += stats.punchesLanded;
    totals.movement += (stats.actions.STEP_IN || 0) + (stats.actions.STEP_BACK || 0);
  }
}
const pct = n => (n / matches * 100).toFixed(1) + '%';
console.log(JSON.stringify({ matches, koRate: pct(totals.ko), tkoRate: pct(totals.tko), judgesDecisionRate: pct(totals.judges), drawRate: pct(totals.draws), averageMatchLength: +(totals.exchanges / matches).toFixed(2), punchesThrownPerMatch: +(totals.thrown / matches).toFixed(2), punchesLandedPerMatch: +(totals.landed / matches).toFixed(2), movementTurnShare: (totals.movement / (totals.exchanges * 2) * 100).toFixed(1) + '%', raw: totals }, null, 2));
