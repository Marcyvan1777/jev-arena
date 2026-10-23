// Diagnostic: how do LLM-like play styles fare under the current scoring? Stochastic policies (not the Demo bots) stand in for a
// model that is told to be aggressive, passive or counter-punching. Local only; never calls an API.
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { createBattle, resolveTurn, legalActions } from '../server/src/game/engine.js';
// LLM-like stochastic policies: weights per action, normalised over the legal actions.
const W = {
  aggressive: { CLINCH: 1, JAB: 25, CROSS: 20, HOOK: 15, UPPERCUT: 8, GUARD: 10, SLIP: 5, COUNTER: 5, STEP_IN: 100, STEP_BACK: 1 },
  passive:    { CLINCH: 6, JAB: 14, CROSS: 7, HOOK: 3, UPPERCUT: 1, GUARD: 35, SLIP: 25, COUNTER: 15, STEP_IN: 100, STEP_BACK: 3 },
  smartCounter: { CLINCH: 2, JAB: 18, CROSS: 10, HOOK: 4, UPPERCUT: 2, GUARD: 18, SLIP: 14, COUNTER: 30, STEP_IN: 100, STEP_BACK: 2 },
};
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (state, side, kind) => { const legal = legalActions(state, side), w = legal.map(a => W[kind][a]), total = w.reduce((a, b) => a + b, 0); let r = rnd() * total; for (let i = 0; i < legal.length; i++) { r -= w[i]; if (r <= 0) return legal[i]; } return legal[0]; };
function run(aKind, bKind, n = 600) {
  let aWins = 0, draws = 0, stops = 0, len = 0;
  for (let i = 0; i < n; i++) {
    const aRed = i % 2 === 0; let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 1 + i * 7 });
    while (state.status !== 'finished') state = resolveTurn(state, { red: pick(state, 'red', aRed ? aKind : bKind), blue: pick(state, 'blue', aRed ? bKind : aKind) });
    const a = aRed ? 'red' : 'blue'; if (state.winner === a) aWins++; else if (state.winner === 'draw') draws++;
    if (/Knockout|Technical/.test(state.finishReason)) stops++; len += state.round;
  }
  return `${aKind} beats ${bKind} in ${(aWins / n * 100).toFixed(0)}% (draws ${(draws / n * 100).toFixed(0)}%) · stoppages ${(stops / n * 100).toFixed(0)}% · avg ${(len / n).toFixed(0)} exchanges`;
}
console.log(run('aggressive', 'passive')); console.log(run('aggressive', 'smartCounter')); console.log(run('aggressive', 'aggressive')); console.log(run('passive', 'smartCounter'));
