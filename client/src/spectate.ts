import { useCallback, useEffect, useState } from 'react';
import type { Battlefield } from '../../shared/types.js';
import { api } from './api.js';
import { spectateFeed } from './game/stateFeed.js';

export interface SpectatorView { state: Battlefield | null; label: string; index: number; total: number; speed: number | null; done: boolean }
const empty: SpectatorView = { state: null, label: '', index: 0, total: 0, speed: 4, done: false };

/** Follows the bout of a watched tournament or grid: polls for new exchanges and hands them, in order, to the 3D scene. */
export function useSpectator(jobId: string | null) {
  const [view, setView] = useState<SpectatorView>(empty);
  useEffect(() => {
    spectateFeed.clear();
    if (!jobId) { setView(empty); return; }
    let cancelled = false, busy = false, key = '', after = -1;
    const tick = async () => {
      if (busy) return; busy = true;
      try {
        const packet = await api.live(jobId, key, after);
        if (cancelled) return;
        if (packet.key !== key) { key = packet.key; after = -1; }
        for (const state of packet.states) { spectateFeed.push(state); after = Math.max(after, state.round); }
        const last = packet.states.at(-1);
        setView(previous => ({ state: last ?? previous.state, label: packet.label, index: packet.index, total: packet.total, speed: packet.speed, done: packet.done }));
      } catch { /* the job may have just ended; the next poll or the parent will stop watching */ }
      finally { busy = false; }
    };
    void tick(); const timer = window.setInterval(tick, 300);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [jobId]);
  const setSpeed = useCallback((speed: number | null) => { if (jobId) void api.pace(jobId, speed).then(() => setView(v => ({ ...v, speed }))).catch(() => undefined); }, [jobId]);
  return { ...view, setSpeed };
}
