import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera, Vector3 } from 'three';
import type { FightRig } from './rig/rig.js';

import type { CameraMode } from './cameraModes.js';

const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Broadcast director: frames both boxers, pushes in on knockdowns and the finish, and shakes on heavy hits. */
export function CameraRig({ fight, mode, shake }: { fight: FightRig; mode: CameraMode; shake: MutableRefObject<number> }) {
  const { camera } = useThree();
  const state = useMemo(() => ({ pos: new Vector3(0, 2.3, 5.4), look: new Vector3(0, 1.2, 0), zoom: 1, fov: 38 }), []);
  const want = useMemo(() => new Vector3(), []), aim = useMemo(() => new Vector3(), []), mid = useMemo(() => new Vector3(), []), back = useMemo(() => new Vector3(), []);
  const last = useRef<CameraMode>(mode);
  useFrame(({ clock }, dt) => {
    if (mode === 'free') { last.current = mode; return; }
    const t = clock.elapsedTime, red = fight.rigs.red, blue = fight.rigs.blue;
    mid.addVectors(red.headWorld, blue.headWorld).multiplyScalar(0.5);
    const closing = fight.finished && fight.p >= 1, falling = fight.knockdownRound && fight.p > 0.25;
    const zoomWant = closing ? 0.6 : falling ? 0.78 : 1;
    state.zoom += (zoomWant - state.zoom) * (1 - Math.exp(-2.2 * dt));
    let fov = 40;
    if (mode === 'broadcast') {
      // Sits square to the fight line (following the circling) so the boxers never stack up in front of each other.
      const line = Math.atan2(blue.base.z - red.base.z, blue.base.x - red.base.x), side = -line * 0.85, dist = 5.4 * state.zoom;
      want.set(mid.x * 0.5 + Math.sin(side) * dist + Math.sin(t * 0.14) * 0.7, 2.25 - (1 - state.zoom) * 0.9, mid.z + Math.cos(side) * dist);
      aim.set(mid.x * 0.8, 1.15, mid.z);
    } else if (mode === 'hall') {
      // Look up and around the hall: the posters, the LED wall and the crowd, with the fight still in the lower frame.
      want.set(mid.x * 0.3, 1.6, mid.z + 3.6); aim.set(Math.sin(t * 0.12) * 5.2, 2.7, -7.2); fov = 52;
    } else if (mode === 'orbit') {
      const a = t * 0.18; want.set(mid.x + Math.sin(a) * 4.3 * state.zoom, 2.1, mid.z + Math.cos(a) * 4.3 * state.zoom); aim.set(mid.x, 1.2, mid.z);
    } else {
      // Over-the-shoulder, the way a boxing video game frames the fight.
      const me = mode === 'red' ? red : blue, foe = mode === 'red' ? blue : red;
      back.set(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
      want.copy(me.headWorld).addScaledVector(back, -2.9 * state.zoom); want.y = 2.3; want.x += -back.z * 1.55; want.z += back.x * 1.55;
      aim.copy(foe.headWorld).lerp(me.headWorld, 0.3); aim.y = 1.3; fov = 44;
    }
    const k = 1 - Math.exp(-(last.current === mode ? 3.2 : 1.6) * dt);
    state.pos.lerp(want, k); state.look.lerp(aim, k * 1.4);
    state.fov += (fov - state.fov) * k;
    shake.current *= Math.exp(-7 * dt);
    const s = reducedMotion ? 0 : shake.current * 0.05;
    camera.position.set(state.pos.x + (Math.random() - 0.5) * s, state.pos.y + (Math.random() - 0.5) * s, state.pos.z + (Math.random() - 0.5) * s);
    camera.lookAt(state.look);
    const perspective = camera as PerspectiveCamera;
    if (Math.abs(perspective.fov - state.fov) > 0.01) { perspective.fov = state.fov; perspective.updateProjectionMatrix(); }
  });
  return mode === 'free' ? <OrbitControls makeDefault target={[0, 1.1, 0]} maxPolarAngle={Math.PI * 0.49} minDistance={1.8} maxDistance={9} /> : null;
}
