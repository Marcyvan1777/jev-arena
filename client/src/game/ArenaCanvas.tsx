import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Bloom, ChromaticAberration, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { Vector2 } from 'three';
import type { Battlefield } from '../../../shared/types.js';
import { Boxer } from './Boxer.js';
import { CameraRig } from './CameraRig.js';
import type { CameraMode } from './cameraModes.js';
import { Crowd } from './Crowd.js';
import { Effects } from './Effects.js';
import { Ring } from './Ring.js';
import { Decor } from './Decor.js';
import { Hall } from './Hall.js';
import { Lights } from './Lighting.js';
import { FightRig } from './rig/rig.js';
import { sfx } from './sound.js';
import type { StateFeed } from './stateFeed.js';
import type { FxEvent } from './rig/rig.js';

function Fight({ state, speed, mode, replayToken, onCount, feed, highQuality }: { state: Battlefield | null; speed: number; mode: CameraMode; replayToken: number; onCount: (n: number) => void; feed?: StateFeed; highQuality: boolean }) {
  const fight = useMemo(() => new FightRig(), []);
  const flash = useRef(0), shake = useRef(0), cheer = useRef(0), spawn = useRef<(event: FxEvent, now: number) => void>(() => undefined);
  // A single match is driven by React state; a watched tournament by a feed that delivers every exchange in order.
  useLayoutEffect(() => { if (!feed) fight.setState(state, speed); }, [fight, state, speed, feed]);
  useEffect(() => { fight.speed = speed; }, [fight, speed]);
  useEffect(() => feed?.subscribe(next => fight.setState(next, fight.speed)), [fight, feed]);
  useEffect(() => { if (replayToken > 0) fight.replay(); }, [fight, replayToken]);
  const lastCount = useRef(0);
  // Development hook for inspecting poses in the browser console (window.__fight.hold = 0.4 freezes an exchange).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __fight?: FightRig }; w.__fight = fight;
    return () => { delete w.__fight; };
  }, [fight]);
  // Runs before the boxers are drawn so every mesh reads this frame's pose.
  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime;
    for (const event of fight.update(Math.min(dt, 0.05), now)) {
      spawn.current(event, now); sfx.play(event.kind === 'block' ? 'block' : event.heavy ? 'heavy' : 'hit'); if (event.knockdown) sfx.play('knockdown'); shake.current = Math.max(shake.current, event.kind === 'block' ? 0.25 : event.heavy ? 1 : 0.5); flash.current = Math.max(flash.current, event.kind === 'block' ? 0.2 : event.heavy ? 1 : 0.5); cheer.current = Math.max(cheer.current, event.heavy ? 1 : 0.5);
    }
    for (const cue of fight.cues.splice(0)) sfx.play(cue);
    if (fight.count !== lastCount.current) { lastCount.current = fight.count; onCount(fight.count); }
    cheer.current *= Math.exp(-1.1 * Math.min(dt, 0.05)); sfx.crowd(cheer.current);
    if (fight.finished && fight.sinceFinish > 0.2) cheer.current = Math.max(cheer.current, 0.9);
  }, -10);
  return <>
    <Boxer rig={fight.rigs.red} look="red" />
    <Boxer rig={fight.rigs.blue} look="blue" />
    <Boxer rig={fight.referee} look="ref" />
    <Effects spawn={spawn} />
    <Lights fight={fight} flash={flash} highQuality={highQuality} />
    <Crowd cheer={cheer} />
    <CameraRig fight={fight} mode={mode} shake={shake} />
  </>;
}

export default function ArenaCanvas({ state, speed, mode, replayToken, onCount, feed }: { state: Battlefield | null; speed: number; mode: CameraMode; replayToken: number; onCount: (n: number) => void; feed?: StateFeed }) {
  // Smoothness first: if the machine cannot hold a steady frame rate, drop the costly extras (shadows, bloom, high pixel density).
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  return <Canvas shadows={quality === 'high'} dpr={quality === 'high' ? [1, 1.75] : 1} camera={{ fov: 40, near: 0.1, far: 90, position: [0, 2.5, 6.3] }} gl={{ antialias: true, powerPreference: 'high-performance' }} style={{ position: 'absolute', inset: 0 }}>
    <PerformanceMonitor onDecline={() => setQuality('low')} flipflops={2} />
    <color attach="background" args={['#020307']} />
    <fog attach="fog" args={['#03050a', 11, 34]} />
    <Environment resolution={128} frames={1} background={false} environmentIntensity={0.85}>
      <Lightformer form="rect" intensity={4} position={[0, 5, 2]} scale={[10, 4, 1]} rotation-x={Math.PI / 2} color="#e3efff" />
      <Lightformer form="rect" intensity={2.2} position={[0, 2, 6]} scale={[10, 3, 1]} color="#ffffff" />
      <Lightformer form="rect" intensity={4.5} position={[-5, 2, 0]} scale={[4, 3, 1]} rotation-y={Math.PI / 2} color="#ff4a64" />
      <Lightformer form="rect" intensity={4.5} position={[5, 2, 0]} scale={[4, 3, 1]} rotation-y={-Math.PI / 2} color="#45b9ff" />
    </Environment>
    <Hall />
    <Ring />
    <Decor state={state} />
    <Fight state={state} speed={speed} mode={mode} replayToken={replayToken} onCount={onCount} feed={feed} highQuality={quality === 'high'} />
    {quality === 'high' && <EffectComposer multisampling={2}>
      <Bloom intensity={0.8} luminanceThreshold={0.62} luminanceSmoothing={0.3} mipmapBlur radius={0.8} />
      <ChromaticAberration offset={new Vector2(0.0006, 0.0008)} radialModulation modulationOffset={0.35} />
      {/* Tone mapping first, then grain and vignette on the final picture. Contrast/saturation effects are left out on purpose:
          on very dark pixels they push values negative, which the tone curve turns into NaN, and a NaN spreads through bloom as black or white blotches. */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Noise opacity={0.06} blendFunction={BlendFunction.SOFT_LIGHT} />
      <Vignette eskil={false} offset={0.22} darkness={0.78} />
    </EffectComposer>}
  </Canvas>;
}
