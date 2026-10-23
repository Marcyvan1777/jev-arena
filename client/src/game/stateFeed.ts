import type { Battlefield } from '../../../shared/types.js';

/**
 * A stream of authoritative bout states pushed from outside React (a watched tournament). Every state reaches the 3D scene in
 * order, which a React prop could not guarantee when several arrive in one render. A late subscriber is caught up from the buffer.
 */
export class StateFeed {
  private listeners = new Set<(state: Battlefield) => void>(); private buffer: Battlefield[] = [];
  push(state: Battlefield) {
    if (state.round === 0) this.buffer = []; // a new bout starts
    this.buffer.push(state); if (this.buffer.length > 100) this.buffer.shift();
    this.listeners.forEach(listener => listener(state));
  }
  subscribe(listener: (state: Battlefield) => void) { this.buffer.forEach(listener); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  clear() { this.buffer = []; }
}
export const spectateFeed = new StateFeed();
