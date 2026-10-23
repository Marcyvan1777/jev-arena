import { Component, Suspense, lazy, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Battlefield, MatchConfig } from '../../../shared/types.js';
import { CAMERA_MODES } from './cameraModes.js';
import type { CameraMode } from './cameraModes.js';
import { Hud } from './Hud.js';
import { sfx } from './sound.js';
import { presentParams } from '../present/params.js';
import type { StateFeed } from './stateFeed.js';
import './arena3d.css';

// Three.js is large, so the 3D scene loads on demand and stays out of the first paint.
const ArenaCanvas = lazy(() => import('./ArenaCanvas.js'));

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="arena-fallback"><b>3D VIEW UNAVAILABLE</b><span>WebGL could not start in this browser. The fight still runs: follow it in the panels and event log.</span></div>
      : this.props.children;
  }
}
const webglAvailable = () => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };

export function Arena(props: { state: Battlefield | null; config: MatchConfig; speed: number; feed?: StateFeed }) {
  const [mode, setMode] = useState<CameraMode>(presentParams.cam ?? 'broadcast');
  useEffect(() => { (window as unknown as { __setCamera?: (m: CameraMode) => void }).__setCamera = setMode; }, []); // lets a recording script change angle
  const [supported] = useState(webglAvailable), [count, setCount] = useState(0), [replay, setReplay] = useState(0), [sound, setSound] = useState(sfx.enabled);
  // Browsers only start audio after a click, so unlock it on the first one (Start Battle is a click).
  useEffect(() => { const unlock = () => sfx.unlock(); window.addEventListener('pointerdown', unlock, { once: true }); return () => window.removeEventListener('pointerdown', unlock); }, []);
  return <div className="arena-canvas arena3d" role="img" aria-label="Animated 3D boxing ring with two humanoid robot boxers. Health, stamina, round and actions are also described in the fighter panels and event log.">
    {supported
      ? <SceneBoundary><Suspense fallback={<div className="arena-fallback"><b>LOADING RING…</b></div>}><ArenaCanvas state={props.state} speed={props.speed} mode={mode} replayToken={replay} onCount={setCount} feed={props.feed} /></Suspense></SceneBoundary>
      : <div className="arena-fallback"><b>3D VIEW UNAVAILABLE</b><span>This browser has no WebGL. The fight still runs: follow it in the panels and event log.</span></div>}
    <Hud state={props.state} config={props.config} count={count} />
    <div className="camera-switch" role="group" aria-label="Camera angle">{CAMERA_MODES.map(m => <button key={m.id} className={m.id === mode ? 'active' : ''} onClick={() => setMode(m.id)}>{m.label}</button>)}
      {props.state?.status === 'finished' && <button onClick={() => setReplay(n => n + 1)}>↺ REPLAY</button>}
      <button aria-pressed={sound} onClick={() => { sfx.unlock(); sfx.setEnabled(!sound); setSound(!sound); }}>{sound ? 'SOUND ON' : 'SOUND OFF'}</button></div>
  </div>;
}
