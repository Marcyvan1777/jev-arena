import { PERSONALITIES, PROVIDERS } from './types.js';
import type { Personality, Provider } from './types.js';
import { fighterName } from './rules.js';

/** What a grid tournament is asked to do. Every model meets every other model-and-personality combination. */
export interface GridSetup {
  mode: 'jev' | 'demo';
  models: Provider[];              // which AI models take part (Demo Mode has the single local bot)
  personalities: Personality[];    // which personalities each model plays
  boutsPerPairing: number;         // even: half with each corner assignment, on the same seeds
  maxRounds: number;               // bout length in exchanges
  baseSeed: number;                // bout k of every pairing uses seed baseSeed + k
  includeMirror: boolean;          // also box each contender against itself, to measure pure luck
  concurrency: number;             // bouts played at once (live providers only)
}
export interface Contender { id: string; provider: Provider; personality: Personality; name: string }
export interface GridBout { pairing: number; a: string; b: string; aIsRed: boolean; seed: number; winner: 'A' | 'B' | 'draw'; kind: 'ko' | 'tko' | 'decision' | 'draw'; reason: string; exchanges: number; hpA: number; hpB: number; apiCalls: number; illegalA?: number; illegalB?: number }

export interface Standing { id: string; name: string; provider: Provider; personality: Personality; played: number; wins: number; draws: number; losses: number; score: number; scoreRate: number; ci95: [number, number]; stoppages: number; avgExchanges: number; illegalMoves: number }
export interface MatrixCell { score: number; played: number }
export interface Effect { key: string; label: string; scoreRate: number; ci95: [number, number]; bouts: number }
export interface GridAnalysis {
  standings: Standing[];                                   // best first
  matrix: Record<string, Record<string, MatrixCell>>;      // row's score against column, 0..1
  modelEffect: Effect[];                                   // model vs model with the personality held equal
  personalityEffect: Effect[];                             // personality vs personality with the model held equal
  verdict: string;
  bouts: number;
}
export interface GridEstimate { contenders: number; pairings: number; bouts: number; exchangesMax: number; callsMax: number; callsExpected: number; callsByProvider: Partial<Record<Provider, number>>; minutes: number | null }

export interface GridProgress {
  id: string; status: 'running' | 'finished' | 'failed' | 'cancelled'; setup: GridSetup; contenders: Contender[]; estimate: GridEstimate;
  completedBouts: number; totalBouts: number; apiCalls: number; running: string[]; analysis: GridAnalysis; elapsedSeconds: number; error?: string; savedTo?: string;
}

export const GRID_LIMITS = { maxBouts: 3000, maxLiveCalls: 40000, maxBoutsPerPairing: 40 };
export const contenderId = (provider: Provider, personality: Personality) => `${provider}:${personality}`;

/** Wilson 95% interval for a score out of n bouts: honest about how little a handful of bouts proves. */
export function wilson(score: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = score / n, denominator = 1 + z * z / n, centre = p + z * z / (2 * n), margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Number(Math.max(0, (centre - margin) / denominator).toFixed(3)), Number(Math.min(1, (centre + margin) / denominator).toFixed(3))];
}

export function buildContenders(setup: GridSetup): Contender[] {
  // The local rule-based bot may also take part in a live grid, as the baseline every model is measured against.
  const models = setup.mode === 'demo' ? ['demo' as Provider] : setup.models;
  return models.flatMap(provider => setup.personalities.map(personality => ({ id: contenderId(provider, personality), provider, personality, name: fighterName(setup.mode, provider as never, personality) })));
}
export function buildPairings(contenders: Contender[], includeMirror: boolean): Array<[Contender, Contender]> {
  const pairs: Array<[Contender, Contender]> = [];
  for (let i = 0; i < contenders.length; i++) for (let j = i + (includeMirror ? 0 : 1); j < contenders.length; j++) pairs.push([contenders[i], contenders[j]]);
  return pairs;
}

export function estimateGrid(setup: GridSetup): GridEstimate {
  const contenders = buildContenders(setup), pairings = buildPairings(contenders, setup.includeMirror);
  const callsByProvider: Partial<Record<Provider, number>> = {};
  let callsMax = 0;
  for (const [a, b] of pairings) for (const side of [a, b]) if (side.provider !== 'demo') { const calls = setup.boutsPerPairing * setup.maxRounds; callsMax += calls; callsByProvider[side.provider] = (callsByProvider[side.provider] ?? 0) + calls; }
  const bouts = pairings.length * setup.boutsPerPairing, live = callsMax > 0;
  // About 30 exchanges are played in a 36-exchange bout, and each exchange waits on the slower of two decisions (~1.5 s).
  const minutes = live ? Math.round(bouts * Math.min(setup.maxRounds, 30) * 1.5 / Math.max(1, setup.concurrency) / 60) : null;
  return { contenders: contenders.length, pairings: pairings.length, bouts, exchangesMax: bouts * setup.maxRounds, callsMax, callsExpected: Math.round(callsMax * 0.82), callsByProvider, minutes };
}

const empty = (c: Contender): Standing => ({ id: c.id, name: c.name, provider: c.provider, personality: c.personality, played: 0, wins: 0, draws: 0, losses: 0, score: 0, scoreRate: 0, ci95: [0, 0], stoppages: 0, avgExchanges: 0, illegalMoves: 0 });

/** Turns raw bouts into a leaderboard, a head-to-head matrix, and the two controlled effects (model, personality). */
export function analyseGrid(contenders: Contender[], bouts: GridBout[]): GridAnalysis {
  const byId = new Map(contenders.map(c => [c.id, c])), table = new Map(contenders.map(c => [c.id, empty(c)]));
  const matrix: GridAnalysis['matrix'] = Object.fromEntries(contenders.map(c => [c.id, Object.fromEntries(contenders.map(d => [d.id, { score: 0, played: 0 }]))]));
  const modelBouts = new Map<string, { score: number; n: number }>(), personalityBouts = new Map<string, { score: number; n: number }>();
  const bump = (map: Map<string, { score: number; n: number }>, key: string, score: number) => { const cur = map.get(key) ?? { score: 0, n: 0 }; cur.score += score; cur.n++; map.set(key, cur); };
  for (const bout of bouts) {
    const scoreA = bout.winner === 'A' ? 1 : bout.winner === 'draw' ? 0.5 : 0, scoreB = 1 - scoreA, a = byId.get(bout.a), b = byId.get(bout.b);
    if (!a || !b) continue;
    table.get(a.id)!.illegalMoves += bout.illegalA ?? 0; table.get(b.id)!.illegalMoves += bout.illegalB ?? 0;
    const sides: Array<[Contender, Contender, number]> = a.id === b.id ? [[a, b, 0.5]] : [[a, b, scoreA], [b, a, scoreB]];
    for (const [me, foe, score] of sides) {
      const row = table.get(me.id)!; row.played++; row.score += score; row.wins += score === 1 ? 1 : 0; row.draws += score === 0.5 ? 1 : 0; row.losses += score === 0 ? 1 : 0;
      if (bout.kind === 'ko' || bout.kind === 'tko') row.stoppages++; row.avgExchanges += bout.exchanges;
      matrix[me.id][foe.id].score += score; matrix[me.id][foe.id].played++;
      // Controlled comparisons: only bouts where exactly one factor differs can credit that factor.
      if (me.id !== foe.id && me.personality === foe.personality && me.provider !== foe.provider) bump(modelBouts, me.provider, score);
      if (me.id !== foe.id && me.provider === foe.provider && me.personality !== foe.personality) bump(personalityBouts, me.personality, score);
    }
  }
  for (const row of table.values()) { row.scoreRate = row.played ? Number((row.score / row.played).toFixed(3)) : 0; row.ci95 = wilson(row.score, row.played); row.avgExchanges = row.played ? Number((row.avgExchanges / row.played).toFixed(1)) : 0; }
  for (const id of Object.keys(matrix)) for (const other of Object.keys(matrix[id])) { const cell = matrix[id][other]; cell.score = cell.played ? Number((cell.score / cell.played).toFixed(3)) : 0; }
  const effect = (map: Map<string, { score: number; n: number }>, label: (key: string) => string): Effect[] =>
    [...map.entries()].map(([key, { score, n }]) => ({ key, label: label(key), scoreRate: Number((score / n).toFixed(3)), ci95: wilson(score, n), bouts: n })).sort((x, y) => y.scoreRate - x.scoreRate);
  const modelEffect = effect(modelBouts, key => key.toUpperCase()), personalityEffect = effect(personalityBouts, key => key);
  const spread = (list: Effect[]) => list.length > 1 ? list[0].scoreRate - list.at(-1)!.scoreRate : 0, ms = spread(modelEffect), ps = spread(personalityEffect);
  const verdict = !bouts.length ? 'No bouts finished yet.'
    : !modelEffect.length && !personalityEffect.length ? 'Not enough variety to separate model from personality.'
    : ms > 0 && ps > 0 ? (ms > ps * 1.25 ? `The model matters more than the personality: models spread by ${Math.round(ms * 100)} points, personalities by ${Math.round(ps * 100)}.` : ps > ms * 1.25 ? `The personality matters more than the model: personalities spread by ${Math.round(ps * 100)} points, models by ${Math.round(ms * 100)}.` : `Model and personality matter about equally (${Math.round(ms * 100)} and ${Math.round(ps * 100)} points of spread).`)
    : ps > 0 ? `Personality spreads results by ${Math.round(ps * 100)} points (a single model is being tested).` : `Model spreads results by ${Math.round(ms * 100)} points.`;
  const standings = [...table.values()].sort((x, y) => y.scoreRate - x.scoreRate || y.wins - x.wins);
  return { standings, matrix, modelEffect, personalityEffect, verdict, bouts: bouts.length };
}

export const ALL_PERSONALITIES = [...PERSONALITIES];
export const ALL_PROVIDERS = [...PROVIDERS];
