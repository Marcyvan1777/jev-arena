import type { Action, Personality, Robot } from '../../../shared/types.js';
import { opponent } from '../../../shared/types.js';
import { ACTION_RULES, PUNCHES, RULES } from '../../../shared/rules.js';
import { isCombo, isFatigued, legalActions, seededRoll } from '../game/engine.js';
import type { DecisionEngine } from './jevDecisionEngine.js';

// How each personality weighs the same situation. Same rules for everyone; only the temperament differs.
interface Temperament { aggression: number; defense: number; staminaCare: number; counterBias: number; noise: number }
const TEMPERAMENTS: Record<Personality, Temperament> = {
  BERSERKER: { aggression: 1.15, defense: 0.7, staminaCare: 0.6, counterBias: 0.6, noise: 0.5 },
  COUNTERPUNCHER: { aggression: 0.85, defense: 1.15, staminaCare: 1.1, counterBias: 1.2, noise: 0.35 },
  TACTICIAN: { aggression: 1, defense: 1, staminaCare: 1, counterBias: 1, noise: 0.3 },
  TRICKSTER: { aggression: 0.95, defense: 0.95, staminaCare: 0.8, counterBias: 1.1, noise: 1 },
  COWARD: { aggression: 0.8, defense: 1.2, staminaCare: 1.3, counterBias: 0.9, noise: 0.4 },
};

/** Share of the opponent's recent actions matching `wanted`, smoothed toward a prior so one sample is never certain. */
function frequency(foe: Robot, wanted: (action: Action) => boolean, prior: number) {
  const recent = foe.history.slice(-6);
  return (recent.filter(wanted).length + prior * 2) / (recent.length + 2);
}

// Explicit local sparring logic for visual and mechanic testing. It never impersonates a real provider.
// Each legal action gets a utility (expected damage swing minus stamina cost); a seeded softmax picks one.
export const demoDecision: DecisionEngine = async (state, side, context) => {
  context.signal.throwIfAborted();
  const me = state.robots[side], foe = state.robots[opponent(side)], legal = legalActions(state, side), t = TEMPERAMENTS[me.personality];
  const foePunches = frequency(foe, a => PUNCHES.has(a as never), 0.55), foeGuards = frequency(foe, a => a === 'GUARD', 0.2), foeSlips = frequency(foe, a => a === 'SLIP', 0.1);
  const foeHeavy = frequency(foe, a => a === 'HOOK' || a === 'UPPERCUT', 0.2);
  const tired = isFatigued(me), fatigue = tired ? RULES.fatigueFactor : 1;
  const care = t.staminaCare * (1 + Math.max(0, (45 - me.stamina) / 25)), pressure = state.idleRounds >= 2 ? 2 : 0;
  const utility = (action: Action): number => {
    const rule = ACTION_RULES[action];
    if (rule.punch && action !== 'COUNTER') {
      const flow = isCombo(me, action);
      const landed = Math.min(0.97, rule.accuracy * fatigue + (flow ? RULES.comboAccuracy : 0)) * (1 - foeSlips * RULES.slipChance) * (1 - foeGuards * RULES.guardReduction) * (flow ? RULES.comboDamage : 1);
      const knockdown = (rule.knockdown ?? 0) * (foe.hp <= 45 ? 1.55 : 1) * 9 * (1 + foe.vulnerability);
      const finisher = foe.hp <= rule.damage * 1.2 ? 4 : 0;
      return t.aggression * (landed * rule.damage * fatigue + knockdown + finisher) - rule.cost * 0.22 * care - rule.cooldown * 0.6 + pressure;
    }
    switch (action) {
      case 'COUNTER': return t.counterBias * (foePunches * RULES.counterAccuracy * fatigue * rule.damage) - (1 - foePunches) * rule.cost * 0.3 * care;
      case 'GUARD': return t.defense * foePunches * 9 * RULES.guardReduction + (me.stamina < 35 ? 1.5 : 0.4) - pressure;
      case 'SLIP': return t.defense * foePunches * RULES.slipChance * 9 * 0.8 - rule.cost * 0.22 * care - pressure;
      case 'CLINCH': return (me.stamina < 30 ? 5 : 0) + (me.hp < 45 ? 3 : 0) + t.defense * foePunches * 9 * 0.4 - me.clinchStreak * 10 - 4 - pressure;
      case 'STEP_IN': return 7;
      case 'STEP_BACK': return t.defense * foePunches * foeHeavy * 9 * 0.9 + (me.hp < 30 ? 1.5 : 0) - rule.cost * 0.3 * care - pressure;
      default: return 0;
    }
  };
  const scored = legal.map(action => ({ action, u: utility(action) })), best = Math.max(...scored.map(s => s.u));
  const temperature = 1 + t.noise * 4, weights = scored.map(s => Math.exp((s.u - best) / temperature));
  let roll = seededRoll(state.config.seed, state.round, side, 90) * weights.reduce((a, b) => a + b, 0), chosen = scored[0].action;
  for (let i = 0; i < scored.length; i++) { roll -= weights[i]; if (roll <= 0) { chosen = scored[i].action; break; } }
  return { robot: side, action: chosen, source: 'demo', round: state.round + 1, latencyMs: 0, legalActions: legal };
};
