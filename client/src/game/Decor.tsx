import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Sparkles } from '@react-three/drei';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Battlefield } from '../../../shared/types.js';
import { RULES } from '../../../shared/rules.js';
import { PROJECT_NAME } from '../project.js';
import { makeBanner } from './Ring.js';

/**
 * Legends of the ring, hung around the hall. No photos ship with the game (they are not ours to distribute): drop your own
 * image into client/public/arena/ named ali.jpg and tyson.jpg (.jpeg, .png or .webp work too) and it appears on the posters.
 * Until then each poster shows a plaque with the boxer's name and record.
 */
interface Legend { file: string; name: string; nickname: string; record: string; quote: string; accent: string; initials: string }
const LEGENDS: Legend[] = [
  { file: 'ali', name: 'MUHAMMAD ALI', nickname: 'THE GREATEST', record: '56–5 · 37 KOs', quote: 'Float like a butterfly, sting like a bee.', accent: '#ffd24a', initials: 'MA' },
  { file: 'tyson', name: 'MIKE TYSON', nickname: 'IRON MIKE', record: '50–6 · 44 KOs', quote: 'Everyone has a plan until they get punched in the mouth.', accent: '#ff4a3c', initials: 'MT' },
];
const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG'];
const capitalised = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, line: number) {
  let current = '', row = 0;
  for (const word of text.split(' ')) { const test = current ? current + ' ' + word : word; if (ctx.measureText(test).width > width && current) { ctx.fillText(current, x, y + row * line); current = word; row++; } else current = test; }
  ctx.fillText(current, x, y + row * line);
}
function drawPoster(canvas: HTMLCanvasElement, legend: Legend, image?: HTMLImageElement) {
  const g = canvas.getContext('2d')!, W = canvas.width, H = canvas.height, pad = 36;
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#12161f'); bg.addColorStop(1, '#05070c'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const photo = { x: pad, y: pad, w: W - pad * 2, h: H * 0.7 };
  g.save(); g.beginPath(); g.rect(photo.x, photo.y, photo.w, photo.h); g.clip();
  if (image) { // cover-fit the supplied photo
    const scale = Math.max(photo.w / image.width, photo.h / image.height), w = image.width * scale, h = image.height * scale;
    // Top-aligned: in a portrait photo the face is in the upper part, so crop the bottom rather than the middle.
    g.drawImage(image, photo.x + (photo.w - w) / 2, photo.y - Math.max(0, h - photo.h) * 0.08, w, h);
  } else {
    const glow = g.createRadialGradient(W / 2, photo.y + photo.h * 0.45, 20, W / 2, photo.y + photo.h * 0.45, photo.w * 0.8); glow.addColorStop(0, legend.accent + '55'); glow.addColorStop(1, '#00000000'); g.fillStyle = glow; g.fillRect(photo.x, photo.y, photo.w, photo.h);
    g.fillStyle = legend.accent; g.globalAlpha = 0.9; g.font = '900 230px Bahnschrift, Arial Black, sans-serif'; g.textAlign = 'center'; g.fillText(legend.initials, W / 2, photo.y + photo.h * 0.55); g.globalAlpha = 1;
    g.fillStyle = '#7d8a99'; g.font = '700 22px Consolas, monospace'; g.fillText(`ADD YOUR PHOTO: public/arena/${legend.file}.jpg`, W / 2, photo.y + photo.h - 24);
  }
  g.restore();
  g.strokeStyle = legend.accent; g.lineWidth = 8; g.strokeRect(photo.x, photo.y, photo.w, photo.h);
  g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.font = '900 60px Bahnschrift, Arial Black, sans-serif'; g.fillText(legend.name, W / 2, photo.y + photo.h + 82);
  g.fillStyle = legend.accent; g.font = '700 30px Bahnschrift, Arial, sans-serif'; g.fillText(`${legend.nickname}  ·  ${legend.record}`, W / 2, photo.y + photo.h + 130);
  g.fillStyle = '#b9c7d6'; g.font = 'italic 26px Georgia, serif'; wrap(g, `“${legend.quote}”`, W / 2, photo.y + photo.h + 178, W - pad * 3, 34);
}
function usePoster(legend: Legend) {
  const canvas = useMemo(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 960; drawPoster(c, legend); return c; }, [legend]);
  const texture = useMemo(() => { const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace; t.anisotropy = 8; return t; }, [canvas]);
  useEffect(() => {
    let cancelled = false;
    // Accept ali.jpg, Ali.jpeg, tyson.png... any of the common spellings.
    const names = [legend.file, capitalised(legend.file)], candidates = names.flatMap(name => EXTENSIONS.map(ext => `/arena/${name}.${ext}`));
    const attempt = (index: number) => {
      if (index >= candidates.length || cancelled) return;
      const image = new Image(); image.onload = () => { if (cancelled) return; drawPoster(canvas, legend, image); texture.needsUpdate = true; }; image.onerror = () => attempt(index + 1);
      image.src = candidates[index];
    };
    attempt(0); return () => { cancelled = true; };
  }, [canvas, legend, texture]);
  return texture;
}

function Poster({ legend, position, rotation }: { legend: Legend; position: [number, number, number]; rotation: [number, number, number] }) {
  const map = usePoster(legend);
  return <group position={position} rotation={rotation}>
    <mesh position={[0, 0, -0.04]}><boxGeometry args={[2.16, 3.16, 0.08]} /><meshStandardMaterial color="#0b0d12" metalness={0.6} roughness={0.5} /></mesh>
    <mesh><planeGeometry args={[2, 3]} /><meshBasicMaterial map={map} color="#b8b8b8" toneMapped={false} /></mesh>
    <mesh position={[0, 1.7, 0]}><boxGeometry args={[0.04, 0.4, 0.04]} /><meshStandardMaterial color="#555" /></mesh>
    <pointLight position={[0, -0.2, 1.2]} intensity={2.2} distance={4} color={legend.accent} />
  </group>;
}

/** A big LED wall behind the ring that shows the fight live: names, health, round and the judges' cards. */
function LedWall({ state }: { state: Battlefield | null }) {
  const latest = useRef(state); latest.current = state;
  const { canvas, texture } = useMemo(() => { const c = document.createElement('canvas'); c.width = 1536; c.height = 512; const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return { canvas: c, texture: t }; }, []);
  const since = useRef(10);
  useFrame((_, dt) => {
    since.current += dt; if (since.current < 0.2) return; since.current = 0;
    const g = canvas.getContext('2d')!, W = canvas.width, H = canvas.height, s = latest.current;
    g.fillStyle = '#04060b'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff08'; for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2); // scan lines
    const fighter = (side: 'red' | 'blue', x: number, align: CanvasTextAlign, color: string) => {
      const r = s?.robots[side]; g.textAlign = align; g.fillStyle = color; g.font = '800 54px Bahnschrift, Arial, sans-serif'; g.fillText(r?.name ?? (side === 'red' ? 'RED CORNER' : 'BLUE CORNER'), x, 92);
      const w = 560, left = align === 'left' ? x : x - w, hp = r ? r.hp / RULES.hp : 1;
      g.fillStyle = '#1a2230'; g.fillRect(left, 118, w, 26); g.fillStyle = color; g.fillRect(align === 'left' ? left : left + w * (1 - hp), 118, w * hp, 26);
      g.fillStyle = '#cfe0f2'; g.font = '700 30px Consolas, monospace'; g.fillText(r ? `HP ${r.hp}  ·  STA ${r.stamina}  ·  ${r.stats.punchesLanded}/${r.stats.punchesThrown} LANDED` : 'READY', x, 196);
      g.fillStyle = '#ffd24a'; g.fillText(r ? '◆'.repeat(r.knockdownsTaken) + '◇'.repeat(Math.max(0, 3 - r.knockdownsTaken)) : '◇◇◇', x, 244);
    };
    fighter('red', 48, 'left', '#ff4a63'); fighter('blue', W - 48, 'right', '#45b8ff');
    g.textAlign = 'center'; g.fillStyle = '#c5ff69'; g.font = '800 40px Consolas, monospace'; g.fillText(PROJECT_NAME, W / 2, 70);
    g.fillStyle = '#ffffff'; g.font = '900 120px Bahnschrift, Arial Black, sans-serif'; g.fillText(s && s.round > 0 ? `R${s.boxingRound}` : 'JEV', W / 2, 200);
    g.fillStyle = '#7fb4ff'; g.font = '700 30px Consolas, monospace'; g.fillText(s && s.round > 0 ? `EXCHANGE ${s.round} / ${s.config.maxRounds}` : 'ARENA', W / 2, 250);
    const cards = s?.cards ?? []; g.fillStyle = '#ffffff'; g.font = '700 44px Consolas, monospace';
    g.fillText(cards.length ? cards.map(c => `${c.red}-${c.blue}`).join('   ') : 'NO CARDS YET', W / 2, 330);
    g.fillStyle = s?.status === 'finished' ? '#ffd24a' : '#8fa4ba'; g.font = '800 54px Bahnschrift, Arial, sans-serif';
    g.fillText(s?.status === 'finished' ? (s.winner === 'draw' ? 'DRAW' : `${s.winner ? s.robots[s.winner].name : ''} WINS`) : s && s.round > 0 ? 'LIVE' : 'FIGHT NIGHT', W / 2, 430);
    texture.needsUpdate = true;
  });
  return <group position={[0, 2.5, -7.5]} scale={0.86}>
    <mesh position={[0, 0, -0.06]}><boxGeometry args={[7.6, 2.6, 0.12]} /><meshStandardMaterial color="#080a10" metalness={0.7} roughness={0.4} /></mesh>
    <mesh><planeGeometry args={[7.2, 2.4]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>
  </group>;
}

/** The three judges at their ringside table, because there are three judges. */
function JudgesTable() {
  const judges = [-1.25, 0, 1.25];
  return <group position={[5.3, 0, 0]}>
    <mesh position={[0, 0.4, 0]}><boxGeometry args={[1, 0.8, 3.9]} /><meshStandardMaterial color="#e8ecf3" roughness={0.8} /></mesh>
    <mesh position={[0, 0.82, 0]}><boxGeometry args={[1.05, 0.05, 3.95]} /><meshStandardMaterial color="#1a2433" metalness={0.5} roughness={0.4} /></mesh>
    {judges.map((z, i) => <group key={z} position={[0.75, 0, z]}>
      <RoundedBox args={[0.36, 0.62, 0.46]} radius={0.06} smoothness={3} position={[0.05, 1.15, 0]}><meshStandardMaterial color="#12161f" roughness={0.7} /></RoundedBox>
      <mesh position={[0.02, 1.62, 0]}><sphereGeometry args={[0.14, 14, 10]} /><meshStandardMaterial color="#b9bfc9" metalness={0.8} roughness={0.35} /></mesh>
      <mesh position={[-0.2, 0.9, 0]}><boxGeometry args={[0.28, 0.02, 0.4]} /><meshStandardMaterial color="#ffffff" /></mesh>
      <mesh position={[-0.28, 0.95, 0]}><sphereGeometry args={[0.035, 8, 6]} /><meshBasicMaterial color={['#ff4a63', '#ffd24a', '#45b8ff'][i]} toneMapped={false} /></mesh>
    </group>)}
  </group>;
}

/** Ringside advertising boards, as in a real hall (left, right and behind; the near side stays open for the camera). */
function Barricade() {
  const base = useMemo(() => makeBanner(`${PROJECT_NAME}  ·  JEV ARENA`), []);
  // The board text repeats every ~3 m instead of stretching one long caption over 12 m.
  const strip = (length: number) => { const t = base.clone(); t.wrapS = RepeatWrapping; t.repeat.set(Math.max(1, Math.round(length / 3.2)), 1); t.needsUpdate = true; return t; };
  const maps = useMemo(() => ({ side: strip(12), back: strip(13) }), [base]);
  const board = (position: [number, number, number], rotation: number, length: number, map: CanvasTexture) => <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[0, 0.5, 0]}><boxGeometry args={[length, 1, 0.16]} /><meshStandardMaterial color="#0a0d14" roughness={0.6} /></mesh>
    <mesh position={[0, 0.52, 0.085]}><planeGeometry args={[length - 0.1, 0.78]} /><meshBasicMaterial map={map} toneMapped={false} color="#bdbdbd" /></mesh>
  </group>;
  return <group>{board([-6.6, 0, 0], Math.PI / 2, 12, maps.side)}{board([6.6, 0, 0], -Math.PI / 2, 12, maps.side)}{board([0, 0, -6.2], 0, 13, maps.back)}</group>;
}

export function Decor({ state }: { state: Battlefield | null }) {
  const [ali, tyson] = LEGENDS;
  return <group>
    <LedWall state={state} />
    <Poster legend={ali} position={[-5.4, 2.7, -7.3]} rotation={[0, 0.28, 0]} />
    <Poster legend={tyson} position={[5.4, 2.7, -7.3]} rotation={[0, -0.28, 0]} />
    <Poster legend={ali} position={[-9, 2.9, 0]} rotation={[0, Math.PI / 2, 0]} />
    <Poster legend={tyson} position={[9, 2.9, 0]} rotation={[0, -Math.PI / 2, 0]} />
    <Poster legend={tyson} position={[-4.5, 2.9, 8]} rotation={[0, Math.PI, 0]} />
    <Poster legend={ali} position={[4.5, 2.9, 8]} rotation={[0, Math.PI, 0]} />
    <Barricade /><JudgesTable />
    <Sparkles count={90} scale={[12, 6, 12]} position={[0, 3, 0]} size={5} speed={0.25} opacity={0.22} color="#9fd1ff" noise={0.6} />
  </group>;
}
