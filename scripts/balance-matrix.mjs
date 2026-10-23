// Local balance matrix: every personality against every personality, both corners, Demo bots only.
// It never imports a provider SDK and refuses to run if any API call is counted.
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { PERSONALITIES, SIDES } from '../shared/types.js';
import { createBattle, resolveTurn } from '../server/src/game/engine.js';
import { demoDecision } from '../server/src/ai/demoDecisionEngine.js';

const bouts = Number(process.env.BOUTS || 40);
const usage = () => ({ apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 });
const overall = { fights: 0, ko: 0, tko: 0, decisions: 0, draws: 0, exchanges: 0, redWins: 0, movement: 0, actions: 0, knockdowns: 0 };
const byStyle = Object.fromEntries(PERSONALITIES.map(p => [p, { wins: 0, fights: 0 }]));
const mirror = { fights: 0, redWins: 0 };

for (const red of PERSONALITIES) for (const blue of PERSONALITIES) for (let seed = 1; seed <= bouts; seed++) {
  let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: seed * 7919 + PERSONALITIES.indexOf(red) * 101 + PERSONALITIES.indexOf(blue), red: { name: 'RED', personality: red }, blue: { name: 'BLUE', personality: blue } });
  const context = { signal: new AbortController().signal, maxCalls: 0, usage: usage() };
  while (state.status !== 'finished') {
    const [r, b] = await Promise.all(SIDES.map(side => demoDecision(state, side, context)));
    state = resolveTurn(state, { red: r.action, blue: b.action }, [r, b]);
  }
  if (context.usage.apiCalls) throw new Error('Balance matrix must never make API calls.');
  const reason = state.finishReason || '';
  overall.fights++; overall.exchanges += state.round;
  if (reason.includes('Technical knockout')) overall.tko++; else if (reason.includes('Knockout')) overall.ko++; else if (state.winner === 'draw') overall.draws++; else overall.decisions++;
  if (state.winner === 'red') overall.redWins++;
  for (const side of SIDES) { overall.movement += (state.robots[side].stats.actions.STEP_IN || 0) + (state.robots[side].stats.actions.STEP_BACK || 0); overall.actions += state.round; overall.knockdowns += state.robots[side].stats.knockdowns; }
  if (red === blue) { mirror.fights++; if (state.winner === 'red') mirror.redWins++; }
  else if (state.winner !== 'draw') { byStyle[state.winner === 'red' ? red : blue].wins++; }
  if (red !== blue) { byStyle[red].fights++; byStyle[blue].fights++; }
}
const pct = (n, d) => d ? +(n / d * 100).toFixed(1) : 0;
console.log(JSON.stringify({
  boutsPerPairing: bouts, fights: overall.fights,
  averageExchanges: +(overall.exchanges / overall.fights).toFixed(1), knockdownsPerFight: +(overall.knockdowns / overall.fights).toFixed(2),
  finish: { koPct: pct(overall.ko, overall.fights), tkoPct: pct(overall.tko, overall.fights), decisionPct: pct(overall.decisions, overall.fights), drawPct: pct(overall.draws, overall.fights) },
  movementSharePct: pct(overall.movement, overall.actions),
  cornerBias: { redWinPctOverall: pct(overall.redWins, overall.fights), redWinPctInMirrorMatches: pct(mirror.redWins, mirror.fights) },
  styleWinPct: Object.fromEntries(Object.entries(byStyle).map(([k, v]) => [k, pct(v.wins, v.fights)])),
}, null, 2));
