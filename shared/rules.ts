import type { Action, Layout, MatchConfig, Obstacle, Personality, PunchAction, Robot } from './types.js';
export const ARENA = { width: 20, height: 12, radius: 0.55 };
export const RULES = { hp: 170, stamina: 100, staminaRegen: 9, attackPower: 20, defense: 3, speed: 0.62, punchRange: 2.75, idealDistance: 2.15, maximumDistance: 3.45, guardReduction: 0.62, slipChance: 0.78, counterAccuracy: 0.82, refereeBreakAfter: 3, tkoKnockdowns: 3, suddenDeathTurns: 6,
  clinchRecover: 14, smotherAccuracy: 0.7, countRecovery: 12, judgeCleanHit: 2, judgeKnockdown: 15, judgeBlock: 1.5, judgeSlip: 2.5, judgeCounter: 3, comboAccuracy: 0.1, comboDamage: 1.1, exchangesPerRound: 12, restStamina: 35, restHealth: 6, fatigueBelow: 25, fatigueFactor: 0.8, knockdownDaze: 0.12 };
export interface ActionRule { cost: number; range: number; damage: number; accuracy: number; cooldown: number; punch?: boolean; knockdown?: number; description: string }
export const ACTION_RULES: Record<Action, ActionRule> = {
  JAB: { cost: 7, range: 2.75, damage: 7, accuracy: 0.9, cooldown: 0, punch: true, description: 'Fast straight lead punch. 7 base damage, 90% accuracy, low stamina cost.' },
  CROSS: { cost: 13, range: 2.7, damage: 12, accuracy: 0.8, cooldown: 1, punch: true, description: 'Committed rear straight. 12 base damage; accurate enough to punish a lazy guard.' },
  HOOK: { cost: 20, range: 2.55, damage: 17, accuracy: 0.7, cooldown: 1, punch: true, knockdown: 0.15, description: 'Heavy arc punch. 17 base damage and knockdown threat; costs stamina.' },
  UPPERCUT: { cost: 28, range: 2.35, damage: 24, accuracy: 0.61, cooldown: 2, punch: true, knockdown: 0.38, description: 'Explosive inside punch. 24 base damage with real knockdown potential; high risk.' },
  GUARD: { cost: 0, range: 0, damage: 0, accuracy: 1, cooldown: 0, description: 'Raise both gloves. Cuts incoming punch damage by 62% and recovers composure.' },
  SLIP: { cost: 9, range: 0, damage: 0, accuracy: 1, cooldown: 0, description: 'Move head off line. 78% chance to evade a punch while staying in counter range.' },
  COUNTER: { cost: 15, range: 2.75, damage: 14, accuracy: 0.82, cooldown: 1, punch: true, description: 'Wait for an incoming punch and fire back. Only lands when the opponent commits.' },
  STEP_IN: { cost: 2, range: 0, damage: 0, accuracy: 1, cooldown: 0, description: 'Close the small gap to punching range. Legal only when outside striking distance.' },
  CLINCH: { cost: 2, range: 2.75, damage: 0, accuracy: 1, cooldown: 0, description: 'Tie the opponent up at close range. You cannot punch, but their punches this exchange are smothered (about a third less accurate, and reduced like a guard) and you recover 14 stamina. A second clinch in a row earns a referee warning; a third costs you a point on the round card.' },
  STEP_BACK: { cost: 3, range: 0, damage: 0, accuracy: 1, cooldown: 0, description: 'Make a short retreat to reset, but ring pressure caps the distance.' },
};
export const PUNCHES = new Set<PunchAction>(['JAB', 'CROSS', 'HOOK', 'UPPERCUT', 'COUNTER']);
export const PERSONALITY_PROMPTS: Record<Personality, string> = {
  BERSERKER: 'Pressure boxer. Begin at close range, favor combinations of jab, cross, hook and uppercut, and keep the opponent under sustained attack. Accept reasonable exposure to create knockdowns. Step in only if the opponent escaped range.',
  COUNTERPUNCHER: 'Defensive tactical boxer. Preserve stamina, use guard and slip against likely punches, then choose counter or precise cross when the opponent commits. Do not retreat repeatedly: remain close enough to punish mistakes.',
  TACTICIAN: 'Balanced championship boxer. Read recent action patterns, vary punches, manage stamina and attack when distance is good. Use defense to create openings rather than waiting forever.',
  TRICKSTER: 'Unpredictable boxer. Mix slips, counters, sudden hooks and angle changes. Stay in striking distance and exploit repeated opponent patterns.',
  COWARD: 'Cautious boxer who values defense and stamina, but understands judges reward clean punches. Guard or slip danger, then jab/cross at safe boxing distance; do not flee the ring.',
};
/** After a clean punch, these follow-ups flow naturally: they are more accurate and hit harder. Same table for both corners. */
export const COMBOS: Partial<Record<Action, Action[]>> = { JAB: ['CROSS', 'HOOK'], CROSS: ['HOOK', 'UPPERCUT'], HOOK: ['CROSS', 'UPPERCUT'], UPPERCUT: ['JAB', 'HOOK'] };
/** The playable ring, in the same units as boxer positions (the engine clamps movement to it). */
export const RING_BOUNDS = { minX: 3.1, maxX: 16.9, minY: 3.1, maxY: 8.9 };
/** What the judges reward. A punch caught on the guard earns the attacker only its (reduced) damage; clean punches, knockdowns, counters and successful defence earn points. */
export function judgeScore(robot: Robot): number {
  const s = robot.stats;
  return s.damage + s.cleanHits * RULES.judgeCleanHit + s.knockdowns * RULES.judgeKnockdown + s.blocks * RULES.judgeBlock + s.dodges * RULES.judgeSlip + s.counters * RULES.judgeCounter;
}
/** Three judges weigh the same fight differently, as real judges do, so close fights can produce split decisions. */
export const JUDGES = [
  { name: 'Judge 1', favours: 'damage', damage: 1, clean: 2, knockdown: 15, block: 1, slip: 1.5, counter: 3 },
  { name: 'Judge 2', favours: 'activity', damage: 0.5, clean: 3.5, knockdown: 12, block: 1.5, slip: 2, counter: 3 },
  { name: 'Judge 3', favours: 'defence', damage: 0.8, clean: 2, knockdown: 15, block: 2.5, slip: 4, counter: 4 },
] as const;
export function judgeScoreFor(robot: Robot, judge: typeof JUDGES[number]): number {
  const s = robot.stats;
  return s.damage * judge.damage + s.cleanHits * judge.clean + s.knockdowns * judge.knockdown + s.blocks * judge.block + s.dodges * judge.slip + s.counters * judge.counter;
}
export const PRIMARY_STRATEGIES = ['BERSERKER', 'COUNTERPUNCHER'] as const;
export const PROVIDER_DISPLAY_NAMES = { jev: "JEV", openai: "GPT", claude: "CLAUDE", demo: "DEMO" } as const;
/** A boxer is named after its model, with its personality in parentheses: "JEV (BERSERKER)". */
export const fighterName = (mode: MatchConfig['mode'], provider: keyof typeof PROVIDER_DISPLAY_NAMES, personality: Personality) => `${PROVIDER_DISPLAY_NAMES[mode === 'demo' ? 'demo' : provider]} (${personality})`;
export function withFighterNames(config: MatchConfig): MatchConfig {
  const named = (side: 'red' | 'blue') => ({ ...config[side], name: fighterName(config.mode, config.providers[side], config[side].personality) });
  return { ...config, red: named('red'), blue: named('blue') };
}
export const STRATEGY_PROFILES = {
  BERSERKER: { title: 'PRESSURE BRAWLER', summary: 'Forces exchanges with jab → cross → hook/uppercut combinations. Trades safety for damage and knockdown chances.', strengths: 'High punch volume · knockout pressure', risk: 'Vulnerable after committed heavy punches' },
  COUNTERPUNCHER: { title: 'DEFENSIVE SNIPER', summary: 'Uses guard and slips to make pressure miss, then answers with a counter or precise cross.', strengths: 'Efficient defense · punishes mistakes', risk: 'Loses rounds if it waits too long' },
} as const;
export const LAYOUTS: Record<Layout, Obstacle[]> = { championship: [] };
export const DEFAULT_CONFIG: MatchConfig = { mode: 'jev', providers: { red: 'jev', blue: 'jev' }, layout: 'championship', seed: 42, maxRounds: 36, red: { name: 'RAVAGER', personality: 'BERSERKER' }, blue: { name: 'AEGIS', personality: 'COUNTERPUNCHER' } };
