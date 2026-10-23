import { ACTIONS, PUNCH_ACTIONS, SIDES, opponent } from '../../../shared/types.js';
import type { Action, Battlefield, Decision, MatchConfig, Point, Robot, RoundCard, Side } from '../../../shared/types.js';
import { ACTION_RULES, COMBOS, JUDGES, LAYOUTS, PUNCHES, RULES, judgeScore, judgeScoreFor } from '../../../shared/rules.js';
import { distance, direction, add, scale } from './geometry.js';
import { commentary } from './commentary.js';

const isPunch = (action: Action) => PUNCHES.has(action as typeof PUNCH_ACTIONS[number]);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function createBattle(config: MatchConfig): Battlefield {
  const robot = (side: Side): Robot => ({
    side, ...config[side], color: side === 'red' ? '#ff5268' : '#4eaeff', hp: RULES.hp, stamina: RULES.stamina,
    position: { x: side === 'red' ? 8.85 : 11.15, y: 6 }, attackPower: RULES.attackPower, defense: RULES.defense,
    speed: RULES.speed, specialAbility: 'CHAMPIONSHIP COMBINATION', cooldown: 0, action: 'IDLE', vulnerability: 0,
    knockdownsTaken: 0, history: [], combo: null, clinchStreak: 0, deduction: 0, stats: { damage: 0, punchesThrown: 0, punchesLanded: 0, cleanHits: 0, blocks: 0, dodges: 0, counters: 0, clinches: 0, illegalMoves: 0, knockdowns: 0, actions: {} },
  });
  return { config: structuredClone(config), round: 0, robots: { red: robot('red'), blue: robot('blue') }, obstacles: structuredClone(LAYOUTS.championship),
    status: 'ready', winner: null, finishReason: null, idleRounds: 0, overtimeTurns: 0,
    boxingRound: 1, roundBaseline: { red: { score: 0, knockdowns: 0, judges: JUDGES.map(() => 0) }, blue: { score: 0, knockdowns: 0, judges: JUDGES.map(() => 0) } }, cards: [], events: [], decisions: [] };
}

/**
 * Combat dice. Both corners read the SAME stream, keyed only by seed, exchange and event (never by corner), so a given
 * seed cannot be luckier for one corner: two boxers making the same choices get the same luck.
 */
export const dice = (seed: number, round: number, salt: number) => seededRoll(seed, round, 'red', salt);

/** Per-corner seeded randomness, used only by the local Demo bots to vary their choices. */
export function seededRoll(seed: number, round: number, side: Side, salt = 0) {
  let x = (seed ^ Math.imul(round + 1, 0x9e3779b9) ^ (side === 'red' ? 0x85ebca6b : 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2d)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function destination(state: Battlefield, side: Side, action: Action): Point {
  const me = state.robots[side], foe = state.robots[opponent(side)], d = distance(me.position, foe.position);
  if (action !== 'STEP_IN' && action !== 'STEP_BACK' && action !== 'CLINCH') return me.position;
  const toward = direction(me.position, foe.position);
  if (action === 'CLINCH') { const closing = Math.min(me.speed, Math.max(0, d - 1.5)); return { x: clamp(me.position.x + toward.x * closing, 3.1, 16.9), y: clamp(me.position.y + toward.y * closing, 3.1, 8.9) }; }
  const amount = action === 'STEP_IN' ? Math.min(me.speed, Math.max(0, d - RULES.idealDistance)) : Math.min(me.speed * 0.8, Math.max(0, RULES.maximumDistance - d));
  const sign = action === 'STEP_IN' ? 1 : -1;
  return { x: clamp(me.position.x + toward.x * amount * sign, 3.1, 16.9), y: clamp(me.position.y + toward.y * amount * sign, 3.1, 8.9) };
}

export function legalActions(state: Battlefield, side: Side): Action[] {
  if (state.status === 'finished') return [];
  const me = state.robots[side], foe = state.robots[opponent(side)], d = distance(me.position, foe.position);
  return ACTIONS.filter(action => {
    const rule = ACTION_RULES[action];
    if (me.stamina < rule.cost) return false;
    if (rule.punch && action !== 'JAB' && me.cooldown > 0) return false;
    if (rule.punch) return d <= rule.range;
    if (action === 'CLINCH') return d <= RULES.punchRange;
    if (action === 'STEP_IN') return d > RULES.punchRange;
    if (action === 'STEP_BACK') return d < RULES.maximumDistance - 0.12;
    return true;
  });
}

export function damageFor(attacker: Robot, defender: Robot, action: Action, guarded: boolean, fatigued = false, combo = false): number {
  const rule = ACTION_RULES[action];
  const raw = Math.max(2, rule.damage + attacker.attackPower * 0.12 - defender.defense * 0.4);
  const exposed = raw * (1 + defender.vulnerability) * (fatigued ? RULES.fatigueFactor : 1) * (combo ? RULES.comboDamage : 1);
  return Math.max(1, Math.round(exposed * (guarded ? 1 - RULES.guardReduction : 1)));
}

/** True when `action` follows up the punch this boxer landed cleanly in the previous exchange. */
export const isCombo = (robot: Robot, action: Action) => robot.combo !== null && (COMBOS[robot.combo] ?? []).includes(action);

/** A gassed boxer (low stamina before the exchange) throws slower, weaker punches. */
export const isFatigued = (robot: Robot) => robot.stamina < RULES.fatigueBelow;

function roundGain(robot: Robot, baseline: { score: number }) { return judgeScore(robot) - baseline.score; }
const judgeScores = (robot: Robot) => JUDGES.map(judge => judgeScoreFor(robot, judge));

/** One judge's card for a round under the 10-point-must system: 10-9 normally, 10-8 when dominant, 10-10 when level. */
function markRound(diff: number, kdEdge: number) {
  if (Math.abs(diff) <= 2) return { red: 10, blue: 10, lead: null as Side | null, dominant: false };
  const lead: Side = diff > 0 ? 'red' : 'blue', dominant = Math.abs(diff) >= 40 || (lead === 'red' ? kdEdge : -kdEdge) >= 2, loser = dominant ? 8 : 9;
  return { red: lead === 'red' ? 10 : loser, blue: lead === 'blue' ? 10 : loser, lead, dominant };
}

/** Scores the boxing round that just ended: a consensus card plus one card per judge, less any points taken for fouls. */
function closeRound(next: Battlefield) {
  const { red, blue } = next.robots, base = next.roundBaseline;
  const kdEdge = (red.stats.knockdowns - base.red.knockdowns) - (blue.stats.knockdowns - base.blue.knockdowns);
  const consensus = markRound(roundGain(red, base.red) - roundGain(blue, base.blue), kdEdge);
  const redScores = judgeScores(red), blueScores = judgeScores(blue);
  const judges = JUDGES.map((_, i) => { const m = markRound((redScores[i] - base.red.judges[i]) - (blueScores[i] - base.blue.judges[i]), kdEdge); return { red: m.red - red.deduction, blue: m.blue - blue.deduction }; });
  const deductions = { red: red.deduction, blue: blue.deduction };
  const lead = consensus.lead ? next.robots[consensus.lead].name : null;
  const card: RoundCard = { round: next.boxingRound, red: consensus.red - red.deduction, blue: consensus.blue - blue.deduction, judges, deductions,
    note: (lead ? `${lead} ${consensus.dominant ? 'dominates' : 'edges'} the round` : 'Even round') + (red.deduction ? `; ${red.name} loses a point` : '') + (blue.deduction ? `; ${blue.name} loses a point` : '') };
  next.cards.push(card);
  next.events.push({ round: next.round, kind: 'bell', message: `END OF ROUND ${card.round} · ${card.note}. Card ${red.name} ${card.red}–${card.blue} ${blue.name}.` });
  next.roundBaseline = { red: { score: judgeScore(red), knockdowns: red.stats.knockdowns, judges: redScores }, blue: { score: judgeScore(blue), knockdowns: blue.stats.knockdowns, judges: blueScores } };
  red.deduction = 0; blue.deduction = 0;
}

/** The three judges' verdict on the whole bout: unanimous, split or majority. Null when the judges cannot separate the boxers. */
function judgesVerdict(next: Battlefield) {
  const totals = JUDGES.map((_, i) => ({ red: next.cards.reduce((n, c) => n + c.judges[i].red, 0), blue: next.cards.reduce((n, c) => n + c.judges[i].blue, 0) }));
  const votes = totals.map(t => t.red > t.blue ? 'red' : t.blue > t.red ? 'blue' : 'draw');
  const red = votes.filter(v => v === 'red').length, blue = votes.filter(v => v === 'blue').length;
  const winner: Side | null = red > blue ? 'red' : blue > red ? 'blue' : null;
  if (!winner) return null;
  const kind = Math.max(red, blue) === 3 ? 'unanimous' : red + blue === 3 ? 'split' : 'majority';
  const list = totals.map(t => winner === 'red' ? `${t.red}–${t.blue}` : `${t.blue}–${t.red}`).join(', ');
  return { winner, reason: `Judges' decision (${kind}) · ${next.robots[winner].name} ${list}` };
}

/** The one-minute break: stamina and a little health come back, the referee resets the distance. */
function restBetweenRounds(next: Battlefield) {
  for (const side of SIDES) {
    const fighter = next.robots[side];
    fighter.stamina = Math.min(RULES.stamina, fighter.stamina + RULES.restStamina);
    fighter.hp = Math.min(RULES.hp, fighter.hp + RULES.restHealth);
    fighter.cooldown = 0; fighter.vulnerability = Number((fighter.vulnerability / 2).toFixed(3));
  }
  const mid = (next.robots.red.position.x + next.robots.blue.position.x) / 2;
  next.robots.red.position = { x: mid - RULES.idealDistance / 2, y: 6 };
  next.robots.blue.position = { x: mid + RULES.idealDistance / 2, y: 6 };
  next.idleRounds = 0; next.boxingRound++;
  next.events.push({ round: next.round, kind: 'bell', message: `ROUND ${next.boxingRound} · SECONDS OUT. Both corners recover ${RULES.restStamina} stamina and ${RULES.restHealth} health.` });
}

export { judgeScore };

function normalizeDistance(positions: Record<Side, Point>) {
  const d = distance(positions.red, positions.blue), dir = direction(positions.red, positions.blue);
  if (d < 1.35 || d > RULES.maximumDistance) {
    const wanted = d < 1.35 ? 1.35 : RULES.maximumDistance;
    const delta = (wanted - d) / 2;
    positions.red = { x: clamp(positions.red.x - dir.x * delta, 3.1, 16.9), y: clamp(positions.red.y - dir.y * delta, 3.1, 8.9) };
    positions.blue = { x: clamp(positions.blue.x + dir.x * delta, 3.1, 16.9), y: clamp(positions.blue.y + dir.y * delta, 3.1, 8.9) };
  }
}

export function resolveTurn(snapshot: Battlefield, actions: Record<Side, Action>, decisions: Decision[] = []): Battlefield {
  if (snapshot.status === 'finished') throw new Error('This bout has ended.');
  for (const side of SIDES) if (!legalActions(snapshot, side).includes(actions[side])) throw new Error(`Illegal ${side} action.`);
  const next = structuredClone(snapshot); next.round++; next.status = 'active';
  const positions: Record<Side, Point> = { red: destination(snapshot, 'red', actions.red), blue: destination(snapshot, 'blue', actions.blue) };
  normalizeDistance(positions);
  for (const side of SIDES) {
    const fighter = next.robots[side], action = actions[side], rule = ACTION_RULES[action];
    fighter.position = positions[side]; fighter.action = action;
    fighter.stamina = clamp(fighter.stamina - rule.cost + RULES.staminaRegen + (action === 'CLINCH' ? RULES.clinchRecover : 0), 0, RULES.stamina);
    fighter.clinchStreak = action === 'CLINCH' ? snapshot.robots[side].clinchStreak + 1 : 0;
    if (action === 'CLINCH') {
      fighter.stats.clinches++;
      if (fighter.clinchStreak === 2) next.events.push({ round: next.round, kind: 'referee', actor: side, message: `WARNING: the referee cautions ${fighter.name} for holding.` });
      if (fighter.clinchStreak >= 3) { fighter.deduction++; fighter.clinchStreak = 0; next.events.push({ round: next.round, kind: 'referee', actor: side, message: `POINT DEDUCTION: ${fighter.name} loses a point for repeated holding.` }); }
    }
    fighter.cooldown = rule.punch && action !== 'JAB' ? rule.cooldown : Math.max(0, fighter.cooldown - 1);
    fighter.history = [...fighter.history, action].slice(-8); fighter.stats.actions[action] = (fighter.stats.actions[action] || 0) + 1;
    fighter.vulnerability = clamp(fighter.vulnerability + (action === 'UPPERCUT' ? 0.12 : action === 'HOOK' ? 0.08 : action === 'CROSS' ? 0.04 : 0) - (action === 'GUARD' ? 0.1 : action === 'SLIP' ? 0.07 : 0), 0, 0.35);
    if (distance(snapshot.robots[side].position, fighter.position) > 0.05)
      next.events.push({ round: next.round, kind: 'move', actor: side, message: `${fighter.name} ${action === 'STEP_IN' ? 'cuts off the ring' : action === 'CLINCH' ? 'closes in and ties up the opponent' : 'takes a short step back'}.` });
  }
  for (const decision of decisions) if (decision.fallback) {
    const boxer = next.robots[decision.robot]; boxer.stats.illegalMoves++;
    next.events.push({ round: next.round, kind: 'referee', actor: decision.robot, message: `ILLEGAL MOVE: ${boxer.name} answered "${decision.fallback.attempted}", which is not allowed. The referee makes them guard this exchange.` });
  }
  const damages: Record<Side, number> = { red: 0, blue: 0 }; let cleanLanded = 0;
  for (const side of SIDES) next.robots[side].combo = null; // a combination needs a clean punch in the previous exchange
  for (const side of SIDES) {
    const target = opponent(side), attacker = next.robots[side], defender = next.robots[target], action = actions[side], rule = ACTION_RULES[action], foeAction = actions[target];
    if (!rule.punch) continue;
    if (action === 'COUNTER' && !isPunch(foeAction)) {
      next.events.push({ round: next.round, kind: 'counter', actor: side, target, message: `${attacker.name} waits for a punch that never comes.` });
      continue;
    }
    attacker.stats.punchesThrown++;
    const inRange = distance(attacker.position, defender.position) <= rule.range;
    const slipped = foeAction === 'SLIP' && dice(snapshot.config.seed, next.round, 10) < RULES.slipChance;
    const tired = isFatigued(snapshot.robots[side]);
    const combo = isCombo(snapshot.robots[side], action);
    const smothered = foeAction === 'CLINCH';
    const accuracy = Math.min(0.97, (action === 'COUNTER' ? RULES.counterAccuracy : rule.accuracy) * (tired ? RULES.fatigueFactor : 1) * (smothered ? RULES.smotherAccuracy : 1) + (combo ? RULES.comboAccuracy : 0));
    const hit = inRange && !slipped && dice(snapshot.config.seed, next.round, 20 + ACTIONS.indexOf(action)) < accuracy;
    if (slipped) {
      defender.stats.dodges++;
      next.events.push({ round: next.round, kind: 'dodge', actor: target, target: side, message: `${defender.name} slips the ${action.toLowerCase()} cleanly. ${commentary('dodge', next.round, defender.name)}` });
      continue;
    }
    if (!hit) {
      next.events.push({ round: next.round, kind: 'miss', actor: side, target, message: `${attacker.name}'s ${action.toLowerCase()} misses. ${commentary('miss', next.round, attacker.name)}` });
      continue;
    }
    const guarded = foeAction === 'GUARD' || smothered;
    const amount = Math.min(defender.hp - damages[target], damageFor(snapshot.robots[side], snapshot.robots[target], action, guarded, tired, combo));
    damages[target] += Math.max(0, amount); attacker.stats.damage += Math.max(0, amount); attacker.stats.punchesLanded++; cleanLanded++;
    if (action === 'COUNTER') attacker.stats.counters++;
    if (!guarded) attacker.stats.cleanHits++;
    if (guarded) {
      if (!smothered) defender.stats.blocks++; // a clinch earns no defensive credit from the judges
      next.events.push({ round: next.round, kind: 'block', actor: side, target, amount, message: smothered ? `${attacker.name}'s ${action.toLowerCase()} is smothered in the clinch. ${amount} damage.` : `${defender.name} catches the ${action.toLowerCase()} on the guard. ${amount} damage.` });
    } else {
      next.events.push({ round: next.round, kind: action === 'COUNTER' ? 'counter' : 'hit', actor: side, target, amount, combo, message: `${attacker.name} lands a ${action.toLowerCase()} for ${amount}${combo ? ' as part of a combination' : ''}. ${commentary('hit', next.round, attacker.name)}` });
      attacker.combo = action;
    }
    const kdChance = !guarded ? (rule.knockdown || 0) * (snapshot.robots[target].hp <= 45 ? 1.55 : 1) * (1 + snapshot.robots[target].vulnerability) : 0;
    if (defender.hp - damages[target] > 0 && kdChance > 0 && dice(snapshot.config.seed, next.round, 70 + ACTIONS.indexOf(action)) < kdChance) {
      const floorDamage = Math.min(Math.max(0, defender.hp - damages[target]), 5);
      damages[target] += floorDamage; attacker.stats.damage += floorDamage; attacker.stats.knockdowns++; defender.knockdownsTaken++;
      defender.stamina = Math.min(RULES.stamina, defender.stamina + RULES.countRecovery); defender.vulnerability = clamp(defender.vulnerability + RULES.knockdownDaze, 0, 0.35);
      next.events.push({ round: next.round, kind: 'knockdown', actor: side, target, amount: floorDamage, message: `KNOCKDOWN! ${attacker.name}'s ${action.toLowerCase()} sends ${defender.name} to the canvas.` });
    }
  }
  for (const side of SIDES) next.robots[side].hp = Math.max(0, next.robots[side].hp - damages[side]);
  next.idleRounds = cleanLanded ? 0 : snapshot.idleRounds + 1;
  if (next.idleRounds >= RULES.refereeBreakAfter) {
    const mid = { x: (next.robots.red.position.x + next.robots.blue.position.x) / 2, y: 6 };
    next.robots.red.position = add(mid, scale({ x: -1, y: 0 }, RULES.idealDistance / 2));
    next.robots.blue.position = add(mid, scale({ x: 1, y: 0 }, RULES.idealDistance / 2));
    next.idleRounds = 0;
    next.events.push({ round: next.round, kind: 'referee', message: 'REFEREE BREAK: both fighters are brought back to center range. No damage awarded.' });
  }
  next.decisions.push(...decisions); next.events = next.events.slice(-200);
  const red = next.robots.red, blue = next.robots.blue;
  let winner: Side | 'draw' | null = null, reason: string | null = null;
  if (red.hp <= 0 || blue.hp <= 0) {
    const diff = red.hp - blue.hp || judgeScore(red) - judgeScore(blue) || red.stats.punchesLanded - blue.stats.punchesLanded;
    winner = diff > 0 ? 'red' : diff < 0 ? 'blue' : 'draw'; reason = winner === 'draw' ? 'Simultaneous knockout · equal scorecard' : 'Knockout (KO)';
  } else if (red.knockdownsTaken >= RULES.tkoKnockdowns || blue.knockdownsTaken >= RULES.tkoKnockdowns) {
    // If both boxers reach the limit in the same exchange, the healthier one wins; a dead heat falls through to the scorecards.
    const bothDown = red.knockdownsTaken >= RULES.tkoKnockdowns && blue.knockdownsTaken >= RULES.tkoKnockdowns;
    const edge = bothDown ? (red.hp - blue.hp) || (judgeScore(red) - judgeScore(blue)) : red.knockdownsTaken >= RULES.tkoKnockdowns ? -1 : 1;
    winner = edge > 0 ? 'red' : edge < 0 ? 'blue' : 'draw'; reason = 'Technical knockout (three knockdowns)';
  } else {
    const regulation = next.round <= next.config.maxRounds;
    const endOfRound = regulation && (next.round % RULES.exchangesPerRound === 0 || next.round >= next.config.maxRounds);
    if (endOfRound) closeRound(next);
    if (next.round >= next.config.maxRounds) {
      const totals = { red: next.cards.reduce((n, c) => n + c.red, 0), blue: next.cards.reduce((n, c) => n + c.blue, 0) }, scoreDiff = judgeScore(red) - judgeScore(blue), verdict = judgesVerdict(next);
      if (verdict) { winner = verdict.winner; reason = verdict.reason; }
      else if (totals.red !== totals.blue) { winner = totals.red > totals.blue ? 'red' : 'blue'; reason = `Judges' decision · ${red.name} ${totals.red}–${totals.blue} ${blue.name} on the cards`; }
      else if (scoreDiff !== 0) { winner = scoreDiff > 0 ? 'red' : 'blue'; reason = `Judges' decision · cards level ${totals.red}–${totals.blue}, ${next.robots[winner].name} wins on total scoring ${judgeScore(red).toFixed(1)}–${judgeScore(blue).toFixed(1)}`; }
      else if (next.overtimeTurns >= RULES.suddenDeathTurns) {
        const tie = red.stats.punchesLanded - blue.stats.punchesLanded || red.stats.damage - blue.stats.damage || (red.stats.blocks + red.stats.dodges) - (blue.stats.blocks + blue.stats.dodges);
        winner = tie > 0 ? 'red' : tie < 0 ? 'blue' : 'draw'; reason = winner === 'draw' ? 'Judges draw after finite sudden death' : 'Sudden-death judges tie-break';
      } else { next.overtimeTurns++; next.events.push({ round: next.round, kind: 'referee', message: `SCORECARDS TIED. Sudden death exchange ${next.overtimeTurns}/${RULES.suddenDeathTurns}.` }); }
    } else if (endOfRound) restBetweenRounds(next);
  }
  if (winner) {
    next.status = 'finished'; next.winner = winner; next.finishReason = reason;
    next.events.push({ round: next.round, kind: 'finish', message: winner === 'draw' ? 'THE BOUT ENDS EVEN.' : `${next.robots[winner].name} WINS BY ${reason?.toUpperCase()}.` });
  }
  return next;
}
