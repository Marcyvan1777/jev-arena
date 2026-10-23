import { useMemo } from 'react';
import { BackSide } from 'three';

/** The building around the ring: dark walls and roof, a truss of lamps, LED ribbons and glowing exit signs. */
export function Hall() {
  const exits = useMemo(() => Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2 + 0.3; return { x: Math.cos(a) * 20.5, z: Math.sin(a) * 17, a }; }), []);
  return <group>
    {/* walls and roof, seen from the inside */}
    <mesh position={[0, 7, 0]} scale={[1.18, 1, 0.9]}><cylinderGeometry args={[20.8, 20.8, 22, 48, 1, true]} /><meshStandardMaterial color="#05070c" side={BackSide} roughness={1} /></mesh>
    <mesh position={[0, 15, 0]} rotation={[Math.PI / 2, 0, 0]}><circleGeometry args={[30, 40]} /><meshBasicMaterial color="#020306" side={BackSide} /></mesh>
    {/* LED ribbons running around the upper bowl */}
    <mesh position={[0, 9.2, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.18, 0.9, 1]}><torusGeometry args={[20.3, 0.07, 6, 120]} /><meshBasicMaterial color="#3aa7ff" toneMapped={false} /></mesh>
    <mesh position={[0, 7.8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.18, 0.9, 1]}><torusGeometry args={[20.3, 0.05, 6, 120]} /><meshBasicMaterial color="#ff3a6a" toneMapped={false} /></mesh>
    {/* the lighting truss above the ring */}
    <group position={[0, 8.7, 0]}>
      <mesh><boxGeometry args={[9, 0.14, 0.14]} /><meshStandardMaterial color="#10141c" metalness={0.8} roughness={0.4} /></mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[9, 0.14, 0.14]} /><meshStandardMaterial color="#10141c" metalness={0.8} roughness={0.4} /></mesh>
      {[-4, 4].map(x => [-4, 4].map(z => <mesh key={`${x}${z}`} position={[x * 0.5, 0, z * 0.5]}><sphereGeometry args={[0.16, 10, 8]} /><meshBasicMaterial color="#cfe4ff" toneMapped={false} /></mesh>))}
    </group>
    {/* exit signs */}
    {exits.map((e, i) => <mesh key={i} position={[e.x, 5.4, e.z]} rotation={[0, -e.a + Math.PI / 2, 0]}><boxGeometry args={[0.8, 0.28, 0.06]} /><meshBasicMaterial color="#35e07a" toneMapped={false} /></mesh>)}
  </group>;
}
