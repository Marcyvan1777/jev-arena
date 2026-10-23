import type { Battlefield, MatchConfig } from '../../shared/types.js';

/** What a spectator's browser receives: the exchanges of the bout being shown that it has not seen yet. */
export interface LivePacket { key: string; label: string; index: number; total: number; states: Battlefield[]; done: boolean; speed: number | null }
/** Hooks a bout player calls so a simulation can be watched: the opening state, each new state, and how long to linger on it. */
export interface BoutObserver { start(state: Battlefield): void; onState(state: Battlefield): void; delayMs(state: Battlefield): number }

/** A state trimmed to what the arena and panels need, so a stream of them stays small. */
const lean = (state: Battlefield): Battlefield => { const copy = structuredClone(state); copy.decisions = copy.decisions.slice(-8); copy.events = copy.events.slice(-60); return copy; };

/**
 * The bout of a running tournament or grid that is currently on show. Watching paces the simulation (one exchange per animation),
 * `speed` null means fast-forward, and the speed can be changed while the bout is being played.
 */
export class LiveFeed {
  speed: number | null;
  private key = ''; private label = ''; private index = 0; private total: number; private states: Battlefield[] = []; private done = false;
  constructor(speed: number | null, total: number) { this.speed = speed; this.total = total; }

  /** A new bout is about to start. */
  prepare(key: string, label: string, index: number) { this.key = key; this.label = label; this.index = index; this.states = []; this.done = false; }
  end() { this.done = true; }

  observer(): BoutObserver {
    return {
      start: state => { this.states = [lean(state)]; },
      onState: state => { this.states.push(lean(state)); },
      delayMs: state => this.delay(state),
    };
  }

  /** How long the arena needs to play out the exchange that produced `state` at the current speed. */
  private delay(state: Battlefield): number {
    const speed = this.speed, finished = state.status === 'finished';
    if (state.round === 0) return speed === null ? 300 : 1800 / Math.min(speed, 2); // the fight-card introduction
    const events = state.events.filter(e => e.round === state.round), fell = events.some(e => e.kind === 'knockdown') || (finished && state.robots.red.hp <= 0) || (finished && state.robots.blue.hp <= 0);
    if (finished) { const ko = /^Knockout/.test(state.finishReason ?? ''); return speed === null ? 1200 : (ko ? 8500 : 4500) / Math.min(speed, 2); }
    if (speed === null) return 15;
    return (1000 / speed) * (fell ? 1.9 : 1) + (events.some(e => e.kind === 'bell') ? 600 / speed : 0);
  }

  read(key: string, after: number): LivePacket {
    const fresh = key !== this.key, states = fresh ? this.states.slice() : this.states.filter(s => s.round > after);
    return { key: this.key, label: this.label, index: this.index, total: this.total, states, done: this.done, speed: this.speed };
  }
}
