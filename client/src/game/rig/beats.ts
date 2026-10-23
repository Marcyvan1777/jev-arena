import type { Action, Battlefield, Side } from '../../../../shared/types.js';
import { RULES } from '../../../../shared/rules.js';
import { SIDES, opponent } from '../../../../shared/types.js';

export type Own = 'none' | 'landed' | 'blocked' | 'slipped' | 'whiffed';
/** What happened to one boxer during the latest exchange, read from the authoritative event log. */
export interface Beat {
  action: Action | 'IDLE';
  own: Own;                   // outcome of this boxer's own punch
  hitBy: Action | null;       // opponent punch that landed cleanly on this boxer
  guarded: boolean;           // an opponent punch hit the guard
  dodged: boolean;            // this boxer slipped an incoming punch
  clinched: boolean;          // the opponent tied this boxer up
  knockdown: boolean;
  damage: number;             // damage taken this exchange
  down: boolean;              // stays on the canvas (KO / TKO / zero health)
  won: boolean;
  lost: boolean;
  stamina: number;            // 0..100: a tired boxer's guard sinks and he breathes hard
  health: number;             // 0..1: a hurt boxer wobbles
}
export const idleBeat = (): Beat => ({ action: 'IDLE', own: 'none', hitBy: null, guarded: false, dodged: false, clinched: false, knockdown: false, damage: 0, down: false, won: false, lost: false, stamina: 100, health: 1 });
export const isPunch = (action: Action | 'IDLE') => action === 'JAB' || action === 'CROSS' || action === 'HOOK' || action === 'UPPERCUT' || action === 'COUNTER';

export function beatsFor(state: Battlefield | null): Record<Side, Beat> {
  const beats = { red: idleBeat(), blue: idleBeat() };
  if (!state) return beats;
  const events = state.events.filter(e => e.round === state.round);
  const finished = state.status === 'finished', winner = state.winner;
  for (const side of SIDES) {
    const foe = opponent(side), robot = state.robots[side], beat = beats[side];
    beat.action = state.round === 0 ? 'IDLE' : robot.action;
    beat.stamina = robot.stamina; beat.health = robot.hp / RULES.hp;
    const landedBy = (actor: Side) => events.find(e => e.actor === actor && (e.kind === 'hit' || (e.kind === 'counter' && e.amount !== undefined)));
    if (isPunch(beat.action)) {
      beat.own = landedBy(side) ? 'landed' : events.some(e => e.actor === side && e.kind === 'block') ? 'blocked'
        : events.some(e => e.actor === foe && e.kind === 'dodge' && e.target === side) ? 'slipped' : events.some(e => e.actor === side && (e.kind === 'miss' || e.kind === 'counter')) ? 'whiffed' : 'none';
    }
    beat.hitBy = landedBy(foe) ? state.robots[foe].action as Action : null;
    beat.guarded = events.some(e => e.actor === foe && e.kind === 'block');
    beat.dodged = events.some(e => e.actor === side && e.kind === 'dodge');
    beat.clinched = state.round > 0 && state.robots[foe].action === 'CLINCH';
    beat.knockdown = events.some(e => e.target === side && e.kind === 'knockdown');
    beat.damage = events.filter(e => e.target === side && e.amount !== undefined && e.kind !== 'dodge').reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const stoppedByTko = finished && /^Technical/.test(state.finishReason ?? '') && winner === foe;
    beat.down = robot.hp <= 0 || stoppedByTko;
    beat.won = finished && winner === side; beat.lost = finished && winner !== null && winner !== 'draw' && winner !== side;
  }
  return beats;
}
