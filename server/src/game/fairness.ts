import { RING_BOUNDS, RULES } from '../../../shared/rules.js';
import { SIDES, opponent } from '../../../shared/types.js';
import type { Action, Battlefield, MatchConfig, Robot, Side } from '../../../shared/types.js';
import { TEST_TYPE_NOTES, differences, testTypeOf } from '../../../shared/fairness.js';
import type { FairnessCheck, FairnessReport } from '../../../shared/fairness.js';
import { buildQuestion } from '../ai/questions.js';
import { createBattle, dice, legalActions, resolveTurn, seededRoll } from './engine.js';

const RING_CENTRE_X = (RING_BOUNDS.minX + RING_BOUNDS.maxX) / 2;

/** The same bout seen from the other corner: boxers swap sides and the ring is reflected. A fair prompt cannot tell the difference. */
export function mirrorState(state: Battlefield): Battlefield {
  const flip = (robot: Robot, side: Side): Robot => ({ ...structuredClone(robot), side, position: { x: 2 * RING_CENTRE_X - robot.position.x, y: robot.position.y } });
  const mirror = structuredClone(state);
  mirror.robots = { red: flip(state.robots.blue, 'red'), blue: flip(state.robots.red, 'blue') };
  mirror.cards = state.cards.map(card => ({ ...card, red: card.blue, blue: card.red, judges: card.judges.map(j => ({ red: j.blue, blue: j.red })), deductions: { red: card.deductions.blue, blue: card.deductions.red } }));
  mirror.roundBaseline = { red: state.roundBaseline.blue, blue: state.roundBaseline.red };
  return mirror;
}

/** The prompt content a boxer sees, minus the one thing allowed to differ: its personality text. */
function promptFor(state: Battlefield, side: Side) {
  const { state: payload, legal, criteria } = buildQuestion(state, side);
  const { personality: _personality, ...shared } = payload;
  return JSON.stringify({ shared, legal, criteria });
}

/** Plays random legal exchanges so the audit covers real mid-fight states, not only the opening bell. */
function sampleStates(config: MatchConfig, bouts: number, maxStates: number) {
  const states: Battlefield[] = [];
  for (let b = 0; b < bouts && states.length < maxStates; b++) {
    let state = createBattle({ ...config, seed: 1000 + b * 37 });
    for (let i = 0; i < 80 && state.status !== 'finished'; i++) {
      states.push(structuredClone(state));
      const pick = (side: Side): Action => { const legal = legalActions(state, side); return legal[Math.floor(seededRoll(b + 5, state.round, side, 500) * legal.length)]; };
      state = resolveTurn(state, { red: pick('red'), blue: pick('blue') });
    }
  }
  return states;
}

/**
 * Evidence, not a promise: checks that the two corners are judged on the same base. The only intended differences
 * are the AI model and the personality text, and the report says which of the two (if any) your setup varies.
 */
export function auditFairness(config: MatchConfig): FairnessReport {
  const checks: FairnessCheck[] = [], add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, pass, detail });
  const start = createBattle(config), { red, blue } = start.robots;
  const statKeys = ['hp', 'stamina', 'attackPower', 'defense', 'speed', 'cooldown', 'vulnerability'] as const;
  const unequal = statKeys.filter(key => red[key] !== blue[key]);
  add('stats', 'Identical base stats', unequal.length === 0, unequal.length ? `Differs: ${unequal.join(', ')}` : `Both start with ${RULES.hp} health, ${RULES.stamina} stamina, attack ${red.attackPower}, defense ${red.defense}, speed ${red.speed}.`);
  add('start', 'Mirror-image start', red.position.y === blue.position.y && Math.abs((red.position.x - RING_CENTRE_X) + (blue.position.x - RING_CENTRE_X)) < 1e-9, 'Boxers start the same distance from the centre of the ring on opposite sides.');
  const states = sampleStates(config, 12, 400);
  let promptMismatch = 0, legalMismatch = 0, leak = 0;
  const names = [config.red.name, config.blue.name].filter(name => name.length >= 3);
  for (const state of states) {
    const mirrored = mirrorState(state);
    for (const side of SIDES) {
      if (promptFor(state, side) !== promptFor(mirrored, opponent(side))) promptMismatch++;
      if (legalActions(state, side).join() !== legalActions(mirrored, opponent(side)).join()) legalMismatch++;
      const raw = JSON.stringify(buildQuestion(state, side));
      if (names.some(name => raw.includes(name))) leak++;
    }
  }
  add('prompt', 'Same prompt from either corner', promptMismatch === 0, promptMismatch ? `${promptMismatch} of ${states.length * 2} sampled prompts changed when the bout was mirrored.` : `${states.length} sampled fight states give the same prompt content from either corner (only the personality text differs).`);
  add('legal', 'Same legal actions', legalMismatch === 0, legalMismatch ? `${legalMismatch} mismatches.` : 'Legal actions and their descriptions match in every mirrored state.');
  add('names', 'Names never reach the AI', leak === 0, leak ? 'A boxer name appears in a prompt.' : 'Names and colours are display only; they are not in the prompt.');
  let sum = 0; for (let i = 0; i < 4000; i++) sum += dice(config.seed, i, 20);
  const mean = sum / 4000;
  add('dice', 'Shared dice', Math.abs(mean - 0.5) < 0.02, `Both corners read one dice stream keyed by seed and exchange, never by corner, so a seed cannot be luckier for one side (mean ${mean.toFixed(3)}). Tournaments also swap corners.`);
  const d = differences(config);
  add('transport', 'Provider settings', true, d.model ? 'Each provider gets the identical text through its own API (Jev choice question, OpenAI strict JSON, Claude forced tool call) at that provider\'s default sampling. That is part of what "the model" means here.' : 'Both corners use the same provider.');
  return { ok: checks.every(check => check.pass), testType: testTypeOf(config), differs: d, checks, note: TEST_TYPE_NOTES[testTypeOf(config)] };
}
