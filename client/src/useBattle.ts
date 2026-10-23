import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchConfig, MatchView } from '../../shared/types.js';
import { api } from './api.js';

export function useBattle(config: MatchConfig, speed: number) {
  const [view, setView] = useState<MatchView | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(view), epoch = useRef(0), locked = useRef(false), controlLock = useRef(false), alive = useRef(true);
  const accept = useCallback((next: MatchView) => { current.current = next; setView(next); }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  const advance = useCallback(async (step: boolean) => {
    if (locked.current || !current.current) return;
    locked.current = true; setBusy(true); setError(null);
    const token = epoch.current, before = current.current;
    try {
      const next = await api.turn(before, step);
      if (alive.current && token === epoch.current) {
        accept(next); if (next.state.status === 'finished') setRunning(false);
      }
    } catch (e) {
      if (alive.current && token === epoch.current) {
        setRunning(false); setError(e instanceof Error ? e.message : 'Turn failed. Retry when ready.');
        try { const actual = await api.get(before.id); if (token === epoch.current) accept(actual); } catch { /* retain last known state */ }
      }
    } finally { if (token === epoch.current && alive.current) { locked.current = false; setBusy(false); } }
  }, [accept]);
  useEffect(() => {
    if (!running || busy || controlling || !view || view.state.status === 'finished') return;
    const timer = setTimeout(() => void advance(false), view.state.round === 0 ? 200 : 1000 / speed);
    return () => clearTimeout(timer);
  }, [running, busy, controlling, view, speed, advance]);

  useEffect(() => {
    if (!busy || !view) return;
    let cancelled = false, polling = false;
    const id = view.id, generation = view.generation;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const fresh = await api.get(id), active = current.current;
        if (!cancelled && active?.id === id && active.generation === generation && fresh.generation === generation)
          accept({ ...active, usage: fresh.usage });
      } catch { /* the turn request owns connection errors */ }
      finally { polling = false; }
    }, 600);
    return () => { cancelled = true; clearInterval(timer); };
  }, [busy, view?.id, view?.generation, accept]);

  const control = async (kind: 'start' | 'pause' | 'restart' | 'step' | 'retry') => {
    if (controlLock.current) return;
    if (kind === 'step' || kind === 'retry') {
      if (current.current) return advance(true);
    }
    const token = ++epoch.current;
    controlLock.current = true;
    let stepAfterCreate = false;
    setRunning(false); setControlling(true); setError(null);
    try {
      let next = current.current;
      if (kind === 'pause' && next) next = await api.pause(next.id);
      else if (kind === 'restart') next = next ? await api.reset(next.id, config) : await api.create(config);
      else {
        if (!next) next = await api.create(config);
        else if (next.state.status === 'finished' || next.state.round === 0) next = await api.reset(next.id, config);
        if (kind !== 'step') next = await api.resume(next.id);
      }
      if (token === epoch.current && alive.current && next) {
        accept(next); setRunning(kind === 'start');
        stepAfterCreate = kind === 'step';
      }
    } catch (e) { if (alive.current && token === epoch.current) setError(e instanceof Error ? e.message : 'Connection failed.'); }
    finally { if (alive.current && token === epoch.current) { locked.current = false; controlLock.current = false; setBusy(false); setControlling(false); } }
    if (stepAfterCreate && alive.current && token === epoch.current) await advance(true);
  };
  // The backend advances only on requests; hiding the tab prevents new paid turns.
  useEffect(() => {
    const hidden = () => { if (document.hidden) setRunning(false); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);
  return { view, running, busy, controlling, error, control };
}
