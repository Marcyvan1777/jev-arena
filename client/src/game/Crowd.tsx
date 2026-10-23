import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, InstancedMesh, MathUtils, Object3D } from 'three';

const dummy = new Object3D();
interface Seat { x: number; y: number; z: number; phase: number; rot: number; tint: Color; period: number; offset: number; lift: number }

/**
 * A dark audience in raked tiers. In the dark you only see people by what lights them: the odd camera flash, phones held up
 * and the spill from the ring. On a big moment arms go up and the flashes multiply.
 */
export function Crowd({ cheer }: { cheer: React.RefObject<number> }) {
  const heads = useRef<InstancedMesh>(null), bodies = useRef<InstancedMesh>(null), tiers = useRef<InstancedMesh>(null), arms = useRef<InstancedMesh>(null), flashes = useRef<InstancedMesh>(null), phones = useRef<InstancedMesh>(null);
  const frame = useRef(0);
  const seats = useMemo(() => {
    const out: Seat[] = []; let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let row = 0; row < 9; row++) {
      const radius = 8.6 + row * 1.12, count = Math.floor(radius * 4.2);
      for (let i = 0; i < count; i++) {
        if (i % 22 === 0) continue; // aisles
        const a = (i / count) * Math.PI * 2 + rnd() * 0.04;
        out.push({ x: Math.cos(a) * radius * 1.18, y: -0.35 + row * 0.74, z: Math.sin(a) * radius * 0.9, phase: rnd() * 6.28, rot: a, tint: new Color().setHSL(0.58 + rnd() * 0.12, 0.25, 0.02 + rnd() * 0.03), period: 2.5 + rnd() * 6, offset: rnd() * 10, lift: rnd() });
      }
    }
    return out;
  }, []);
  const flashSeats = useMemo(() => seats.filter((_, i) => i % 7 === 0), [seats]);
  const phoneSeats = useMemo(() => seats.filter((_, i) => i % 11 === 3), [seats]);
  const armSeats = useMemo(() => seats.filter((_, i) => i % 2 === 0), [seats]);
  useLayoutEffect(() => {
    seats.forEach((s, i) => { bodies.current!.setColorAt(i, s.tint); heads.current!.setColorAt(i, s.tint.clone().offsetHSL(0, 0, 0.012)); });
    bodies.current!.instanceColor!.needsUpdate = true; heads.current!.instanceColor!.needsUpdate = true;
    seats.forEach((s, i) => { dummy.position.set(s.x, s.y - 0.12, s.z); dummy.rotation.set(0, -s.rot + Math.PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); tiers.current!.setMatrixAt(i, dummy.matrix); });
    tiers.current!.instanceMatrix.needsUpdate = true;
  }, [seats]);
  useFrame(({ clock }) => {
    // The audience is a background detail: refreshing it every other frame is invisible but frees the CPU for the fight.
    if (frame.current++ % 2 !== 0) return;
    const t = clock.elapsedTime, level = cheer.current ?? 0, boost = 1 + level * 2.2;
    seats.forEach((s, i) => {
      const bob = Math.abs(Math.sin(t * 2 * boost + s.phase)) * 0.05 * boost;
      dummy.position.set(s.x, s.y + 0.45 + bob, s.z); dummy.rotation.set(0, -s.rot + Math.PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bodies.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.y += 0.42; dummy.updateMatrix(); heads.current!.setMatrixAt(i, dummy.matrix);
    });
    bodies.current!.instanceMatrix.needsUpdate = true; heads.current!.instanceMatrix.needsUpdate = true;
    // Arms go up when the crowd is on its feet; each person joins in at their own level of excitement.
    armSeats.forEach((s, i) => {
      const up = MathUtils.clamp((level * 1.6 - s.lift) * 3, 0, 1), swing = Math.sin(t * 5 + s.phase) * 0.18 * up;
      dummy.position.set(s.x, s.y + 0.8 + up * 0.35, s.z); dummy.rotation.set(0, -s.rot + Math.PI / 2, swing); dummy.scale.set(1, Math.max(0.001, up), 1); dummy.updateMatrix(); arms.current!.setMatrixAt(i, dummy.matrix);
    });
    arms.current!.instanceMatrix.needsUpdate = true;
    // Camera flashes: a brief white burst at each seat's own rhythm, more often on a big moment.
    flashSeats.forEach((s, i) => {
      const speed = 1 + level * 3, cycle = ((t * speed + s.offset) % s.period) / s.period, on = cycle < 0.025 ? 1 - cycle / 0.025 : 0;
      dummy.position.set(s.x, s.y + 1.0, s.z); dummy.scale.setScalar(0.001 + on * 0.5); dummy.updateMatrix(); flashes.current!.setMatrixAt(i, dummy.matrix);
    });
    flashes.current!.instanceMatrix.needsUpdate = true;
    phoneSeats.forEach((s, i) => {
      const lit = 0.5 + 0.5 * Math.sin(t * 1.3 + s.phase), show = 0.04 + 0.05 * lit + level * 0.05;
      dummy.position.set(s.x, s.y + 1.18 + level * 0.2, s.z); dummy.scale.setScalar(show); dummy.updateMatrix(); phones.current!.setMatrixAt(i, dummy.matrix);
    });
    phones.current!.instanceMatrix.needsUpdate = true;
  });
  return <group>
    <instancedMesh ref={tiers} args={[undefined, undefined, seats.length]}><boxGeometry args={[0.62, 0.34, 0.7]} /><meshStandardMaterial color="#080b11" roughness={1} /></instancedMesh>
    <instancedMesh ref={bodies} args={[undefined, undefined, seats.length]}><capsuleGeometry args={[0.17, 0.4, 3, 8]} /><meshStandardMaterial roughness={1} metalness={0} /></instancedMesh>
    <instancedMesh ref={heads} args={[undefined, undefined, seats.length]}><sphereGeometry args={[0.14, 10, 8]} /><meshStandardMaterial roughness={0.9} /></instancedMesh>
    <instancedMesh ref={arms} args={[undefined, undefined, armSeats.length]}><capsuleGeometry args={[0.05, 0.42, 2, 6]} /><meshStandardMaterial color="#0a0d14" roughness={1} /></instancedMesh>
    <instancedMesh ref={flashes} args={[undefined, undefined, flashSeats.length]}><sphereGeometry args={[1, 6, 4]} /><meshBasicMaterial color="#ffffff" toneMapped={false} /></instancedMesh>
    <instancedMesh ref={phones} args={[undefined, undefined, phoneSeats.length]}><sphereGeometry args={[1, 6, 4]} /><meshBasicMaterial color="#cfe6ff" toneMapped={false} /></instancedMesh>
  </group>;
}
