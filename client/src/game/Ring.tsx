import { useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import { AdditiveBlending, CanvasTexture, DoubleSide, SRGBColorSpace } from 'three';

export const RING = { half: 3.0, ropes: [0.58, 0.94, 1.3], post: 1.48 };
const RED = '#ff2f4d', BLUE = '#38b8ff';

function makeCanvasTexture() {
  const size = 1024, canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const base = g.createLinearGradient(0, 0, size, size); base.addColorStop(0, '#101a2e'); base.addColorStop(1, '#0a1020');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  g.globalAlpha = 0.05; g.strokeStyle = '#9fc3ff';
  for (let i = 0; i < size; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.moveTo(0, i); g.lineTo(size, i); g.stroke(); }
  g.globalAlpha = 1;
  // corner colour panels: red at the left (-X), blue at the right (+X)
  const panel = (x: number, color: string) => { const grad = g.createLinearGradient(x, 0, x === 0 ? 260 : size - 260, 0); grad.addColorStop(0, color + 'aa'); grad.addColorStop(1, color + '00'); g.fillStyle = grad; g.fillRect(x === 0 ? 0 : size - 260, 0, 260, size); };
  panel(0, RED); panel(size, BLUE);
  // centre ring + logo
  g.lineWidth = 10; g.strokeStyle = '#cfe4ff'; g.globalAlpha = 0.85; g.beginPath(); g.arc(size / 2, size / 2, 250, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.globalAlpha = 0.5; g.beginPath(); g.arc(size / 2, size / 2, 285, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = '#e8f2ff'; g.font = '900 150px Bahnschrift, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('JEV', size / 2, size / 2 - 40);
  g.fillStyle = '#7fb4ff'; g.font = '700 62px Bahnschrift, Arial, sans-serif'; g.fillText('A R E N A', size / 2, size / 2 + 62);
  // boundary lines
  g.lineWidth = 14; g.strokeStyle = '#e9f3ff'; g.globalAlpha = 0.9; g.strokeRect(14, 14, size - 28, size - 28); g.globalAlpha = 1;
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 8; return texture;
}

export function makeBanner(text: string) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128; const g = canvas.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1024, 0); grad.addColorStop(0, '#0b1020'); grad.addColorStop(0.5, '#142040'); grad.addColorStop(1, '#0b1020');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#7fe0ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 70; g.font = `800 ${size}px Bahnschrift, Arial Black, sans-serif`;
  while (g.measureText(text).width > 940 && size > 24) { size -= 2; g.font = `800 ${size}px Bahnschrift, Arial Black, sans-serif`; } // always fit the strip
  g.fillText(text, 512, 68);
  g.fillStyle = '#ff3d5a'; g.fillRect(0, 118, 1024, 10); const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}

/** Elevated ring: canvas mat, apron, corner posts with pads, three ropes per side and an LED skirt. */
export function Ring() {
  const mat = useMemo(makeCanvasTexture, []), banner = useMemo(() => makeBanner('JEV ARENA  ·  ROBOT BOXING LEAGUE  ·  JEV ARENA'), []);
  const h = RING.half, post = h + 0.07;
  const corners: Array<[number, number, string]> = [[-post, -post, RED], [-post, post, RED], [post, -post, BLUE], [post, post, BLUE]];
  return <group>
    {/* platform and apron */}
    <mesh position={[0, -0.45, 0]} receiveShadow><boxGeometry args={[h * 2 + 1.3, 0.9, h * 2 + 1.3]} /><meshStandardMaterial color="#0c1322" roughness={0.6} metalness={0.4} /></mesh>
    <mesh position={[0, -0.02, 0]} receiveShadow><boxGeometry args={[h * 2 + 1.3, 0.04, h * 2 + 1.3]} /><meshStandardMaterial color="#10192c" roughness={0.7} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow><planeGeometry args={[h * 2 + 0.2, h * 2 + 0.2]} /><meshStandardMaterial map={mat} roughness={0.55} metalness={0.15} /></mesh>
    {/* LED skirt */}
    {[0, 1, 2, 3].map(i => <mesh key={i} position={[i % 2 ? (i === 1 ? h + 0.66 : -h - 0.66) : 0, -0.5, i % 2 ? 0 : (i === 0 ? h + 0.66 : -h - 0.66)]} rotation={[0, i % 2 ? Math.PI / 2 : 0, 0]}>
      <planeGeometry args={[h * 2 + 1.3, 0.8]} /><meshBasicMaterial map={banner} toneMapped={false} /></mesh>)}
    {/* posts, pads and ropes */}
    {corners.map(([x, z, color]) => <group key={`${x}${z}`} position={[x, 0, z]}>
      <mesh position={[0, RING.post / 2, 0]} castShadow><cylinderGeometry args={[0.07, 0.08, RING.post, 14]} /><meshStandardMaterial color="#aeb8c6" metalness={0.9} roughness={0.3} /></mesh>
      <RoundedBox args={[0.2, 1.22, 0.2]} radius={0.06} smoothness={3} position={[0, 0.88, 0]}><meshStandardMaterial color={color} roughness={0.45} emissive={color} emissiveIntensity={0.25} /></RoundedBox>
      <mesh position={[0, RING.post + 0.02, 0]}><sphereGeometry args={[0.075, 12, 10]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} /></mesh>
    </group>)}
    {RING.ropes.map((y, i) => [0, 1, 2, 3].map(side => {
      const horizontal = side < 2, s = side % 2 ? 1 : -1, color = i === 1 ? '#ffffff' : i === 0 ? '#9fb7d6' : '#d7e3f5';
      const nearCamera = side === 0 ? false : false;
      return <mesh key={`${i}${side}`} position={horizontal ? [0, y, s * post] : [s * post, y, 0]} rotation={horizontal ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]} visible={!nearCamera}>
        <cylinderGeometry args={[0.022, 0.022, post * 2, 10]} /><meshStandardMaterial color={color} emissive={s < 0 && !horizontal ? RED : s > 0 && !horizontal ? BLUE : '#7ea8ff'} emissiveIntensity={0.35} roughness={0.3} metalness={0.5} transparent opacity={horizontal && s > 0 ? 0.3 : 1} />
      </mesh>;
    }))}
    {/* overhead neon halo */}
    <mesh position={[0, 5.4, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[3.8, 0.05, 10, 64]} /><meshBasicMaterial color="#6fd5ff" toneMapped={false} /></mesh>
    <mesh position={[0, 5.4, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[2.6, 0.03, 10, 64]} /><meshBasicMaterial color="#ff4d6a" toneMapped={false} /></mesh>
    {/* light cones */}
    {[[-3, 1.5], [3, 1.5], [-3, -1.8], [3, -1.8]].map(([x, z], i) => <mesh key={i} position={[x * 0.55, 3.2, z * 0.5]} rotation={[0, 0, (x as number) > 0 ? 0.35 : -0.35]}>
      <coneGeometry args={[1.5, 6.2, 24, 1, true]} /><meshBasicMaterial color={i % 2 ? '#7fb9ff' : '#9fd1ff'} transparent opacity={0.045} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} toneMapped={false} /></mesh>)}
  </group>;
}
