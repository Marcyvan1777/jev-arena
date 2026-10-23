import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { AdditiveBlending, Color, InstancedMesh, MathUtils, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import type { FxEvent } from './rig/rig.js';

const COUNT = 28, dummy = new Object3D();
interface Burst { at: number; origin: Vector3; velocities: Vector3[]; color: Color; heavy: boolean }
interface Popup { id: number; position: Vector3; text: string; color: string; heavy: boolean }
let popupId = 0;

/** Impact sparks, a flash ring and floating damage numbers. `spawn` is filled in so the choreographer can trigger them. */
export function Effects({ spawn }: { spawn: MutableRefObject<(event: FxEvent, now: number) => void> }) {
  const sparks = useRef<InstancedMesh>(null), ring = useRef<Mesh>(null), ringMat = useRef<MeshBasicMaterial>(null);
  const burst = useRef<Burst[]>([]), [popups, setPopups] = useState<Popup[]>([]);
  const ringState = useRef({ at: -10, position: new Vector3(), heavy: false });
  const colors = useMemo(() => ({ hit: new Color('#ffd479'), block: new Color('#7fd4ff'), heavy: new Color('#ff5a3c') }), []);
  useEffect(() => {
    spawn.current = (event, now) => {
      const color = event.kind === 'block' ? colors.block : event.heavy ? colors.heavy : colors.hit, count = event.heavy ? COUNT : 14;
      const velocities = Array.from({ length: count }, () => new Vector3((Math.random() - 0.5) * 2.6, Math.random() * 1.8 + 0.3, (Math.random() - 0.5) * 2.6).multiplyScalar(event.heavy ? 1.5 : 1));
      burst.current.push({ at: now, origin: event.position.clone(), velocities, color, heavy: event.heavy });
      if (burst.current.length > 6) burst.current.shift();
      ringState.current = { at: now, position: event.position.clone(), heavy: event.heavy };
      if (event.amount > 0) {
        const id = ++popupId;
        setPopups(list => [...list.slice(-4), { id, position: event.position.clone().add(new Vector3(0, 0.35, 0.1)), text: (event.kind === 'block' ? '🛡 ' : '−') + event.amount, color: event.kind === 'block' ? '#8fdcff' : event.heavy ? '#ff7a5c' : '#ffe08a', heavy: event.heavy }]);
        window.setTimeout(() => setPopups(list => list.filter(p => p.id !== id)), 900);
      }
    };
  }, [spawn, colors]);
  useFrame(({ clock }) => {
    const now = clock.elapsedTime; let index = 0;
    const mesh = sparks.current!;
    for (const b of burst.current) {
      const age = now - b.at; if (age > 0.7) continue;
      for (const v of b.velocities) {
        if (index >= mesh.count) break;
        dummy.position.copy(b.origin).addScaledVector(v, age); dummy.position.y -= 2.2 * age * age;
        dummy.scale.setScalar(Math.max(0.001, (b.heavy ? 0.045 : 0.03) * (1 - age / 0.7)));
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix); mesh.setColorAt(index, b.color); index++;
      }
    }
    for (; index < mesh.count; index++) { dummy.scale.setScalar(0.0001); dummy.position.set(0, -50, 0); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix); }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const r = ringState.current, age = now - r.at;
    if (ring.current && ringMat.current) {
      const visible = age >= 0 && age < 0.3; ring.current.visible = visible;
      if (visible) { ring.current.position.copy(r.position); ring.current.scale.setScalar((r.heavy ? 0.5 : 0.3) * (0.4 + age * 5)); ringMat.current.opacity = MathUtils.clamp(1 - age / 0.3, 0, 1) * 0.9; ring.current.lookAt(ring.current.position.x, ring.current.position.y, ring.current.position.z + 5); }
    }
  });
  return <group>
    <instancedMesh ref={sparks} args={[undefined, undefined, COUNT * 4]} frustumCulled={false}><sphereGeometry args={[1, 6, 5]} /><meshBasicMaterial toneMapped={false} blending={AdditiveBlending} transparent /></instancedMesh>
    <mesh ref={ring} visible={false}><ringGeometry args={[0.7, 1, 28]} /><meshBasicMaterial ref={ringMat} color="#fff3c4" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    {popups.map(p => <Html key={p.id} position={p.position} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}><div className={'damage-pop' + (p.heavy ? ' heavy' : '')} style={{ color: p.color }}>{p.text}</div></Html>)}
  </group>;
}
