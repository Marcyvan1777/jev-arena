import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, Group, HemisphereLight, PointLight, Quaternion, ShaderMaterial, SpotLight, Vector3 } from 'three';
import type { FightRig } from './rig/rig.js';

const UP = new Vector3(0, 1, 0), reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A soft shaft of stage light: brightest at the lamp, fading along its length and toward its edges, with drifting dust. */
function shaftMaterial(color: string, intensity: number) {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    uniforms: { uColor: { value: new Color(color) }, uTime: { value: 0 }, uIntensity: { value: intensity }, uHeight: { value: 1 } },
    vertexShader: `uniform float uHeight; varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vP;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = position.y / uHeight + 0.5; vP = position; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uIntensity; varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vP;
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vV))), edge = pow(facing, 2.4);
        float along = pow(clamp(vH, 0.0, 1.0), 1.6);
        float dust = 0.8 + 0.2 * sin(uTime * 0.7 + vP.x * 3.0 + vP.y * 2.2 + vP.z * 2.6);
        gl_FragColor = vec4(uColor, edge * along * dust * uIntensity);
      }`,
  });
}

/** One light beam from a lamp at `from` toward `to`. The wide end of the cone is where the light lands. */
function Shaft({ from, to, color, intensity = 0.35, spread = 0.11 }: { from: [number, number, number]; to: [number, number, number]; color: string; intensity?: number; spread?: number }) {
  const material = useMemo(() => shaftMaterial(color, intensity), [color, intensity]);
  const { position, quaternion, length, radius } = useMemo(() => {
    const a = new Vector3(...from), t = new Vector3(...to), d = t.clone().sub(a), length = d.length(); d.normalize();
    return { position: a.clone().addScaledVector(d, length / 2), quaternion: new Quaternion().setFromUnitVectors(UP, d.clone().negate()), length, radius: length * spread };
  }, [from, to, spread]);
  material.uniforms.uHeight.value = length;
  useFrame(({ clock }) => { material.uniforms.uTime.value = clock.elapsedTime; });
  return <mesh position={position} quaternion={quaternion} renderOrder={2}><coneGeometry args={[radius, length, 40, 1, true]} /><primitive object={material} attach="material" /></mesh>;
}

/** A moving-head lamp that sweeps over the crowd, and homes in on the ring when the fight peaks. */
function SweepingShaft({ phase, color, rate, focus }: { phase: number; color: string; rate: number; focus: MutableRefObject<number> }) {
  const group = useRef<Group>(null), material = useMemo(() => shaftMaterial(color, 0.3), [color]);
  const source = useMemo(() => new Vector3((phase % 2 ? 1 : -1) * 4, 7.4, -3), [phase]), length = 12;
  material.uniforms.uHeight.value = length;
  const target = useMemo(() => new Vector3(), []), dir = useMemo(() => new Vector3(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * rate + phase, f = focus.current;
    target.set(Math.cos(t) * 9 * (1 - f), 0.6 + Math.sin(t * 1.7) * 1.5, Math.sin(t * 0.8) * 9 * (1 - f) - 1 * f);
    dir.copy(target).sub(source).normalize();
    if (group.current) { group.current.position.copy(source).addScaledVector(dir, length / 2); group.current.quaternion.setFromUnitVectors(UP, dir.clone().negate()); }
    material.uniforms.uTime.value = clock.elapsedTime;
  });
  return <group ref={group}><mesh renderOrder={2}><coneGeometry args={[length * 0.075, length, 32, 1, true]} /><primitive object={material} attach="material" /></mesh></group>;
}

/**
 * The lighting rig. A hard key light over the ring, red and blue contre-jours that separate each boxer from the dark hall,
 * and a house that dims on a knockdown. Pulses are slow on purpose: nothing here strobes.
 */
export function Lights({ fight, flash, highQuality }: { fight: FightRig; flash: MutableRefObject<number>; highQuality: boolean }) {
  const hemi = useRef<HemisphereLight>(null), key = useRef<SpotLight>(null), fill = useRef<SpotLight>(null), red = useRef<PointLight>(null), blue = useRef<PointLight>(null), front = useRef<PointLight>(null), focus = useRef(0);
  const house = useRef(1);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime, ko = fight.finished && fight.finishKind === 'ko', falling = fight.knockdownRound && fight.p > 0.3;
    const target = ko ? 0.22 : falling ? 0.55 : 1;
    house.current += (target - house.current) * (1 - Math.exp(-3 * dt));
    flash.current *= Math.exp(-9 * dt);
    const pulse = ko && !reducedMotion ? 0.12 * Math.sin(t * 2.2) : 0, hit = flash.current * 0.35;
    if (hemi.current) hemi.current.intensity = 0.75 * house.current;
    if (key.current) key.current.intensity = (150 * (0.55 + 0.45 * house.current) + 45 * pulse * 8) * (1 + hit);
    if (fill.current) fill.current.intensity = 40 * (0.55 + 0.45 * house.current) * (1 + hit);
    if (red.current) red.current.intensity = 26 * (0.6 + 0.4 * house.current) * (1 + hit * 0.5);
    if (blue.current) blue.current.intensity = 26 * (0.6 + 0.4 * house.current) * (1 + hit * 0.5);
    if (front.current) front.current.intensity = 16 * house.current;
    const winnerSide = fight.finished && fight.sinceFinish > 0.5 ? 1 : 0;
    focus.current += ((fight.finished || fight.knockdownRound ? 1 : winnerSide) - focus.current) * (1 - Math.exp(-1.5 * dt));
  });
  return <>
    <hemisphereLight ref={hemi} args={['#6f8cc8', '#0b0e16', 0.5]} />
    <spotLight ref={key} position={[0, 8, 0.8]} angle={0.5} penumbra={0.95} intensity={150} decay={2} color="#e4eeff" />
    {/* soft contact shadows come from this one; spot-light shadows crush to pure black here */}
    <directionalLight position={[3.5, 7, 4.5]} intensity={0.9} color="#dfe9ff" castShadow={highQuality} shadow-mapSize={[1536, 1536]} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} shadow-bias={-0.0004} />
    {/* same lamp, no shadow: keeps what the key light's shadows hide from going pure black */}
    <spotLight ref={fill} position={[0, 8, 0.8]} angle={0.55} penumbra={1} intensity={85} decay={2} color="#cfe0ff" />
    <pointLight ref={red} position={[-3.6, 2.1, -2.6]} intensity={26} distance={10} decay={2} color="#ff2f50" />
    <pointLight ref={blue} position={[3.6, 2.1, -2.6]} intensity={26} distance={10} decay={2} color="#2f9bff" />
    <pointLight ref={front} position={[0, 1.4, 4.2]} intensity={6} distance={9} decay={2} color="#ffd9b0" />
    {/* a faint wash so the stands read as silhouettes against the dark */}
    <pointLight position={[-12, 7, 2]} intensity={55} distance={30} decay={2} color="#5b86d8" />
    <pointLight position={[12, 7, -2]} intensity={55} distance={30} decay={2} color="#b25bd8" />
    {/* four key beams converging on the ring, two sweeping lamps over the crowd */}
    <Shaft from={[-3, 8.4, -2.6]} to={[0, 0.2, 0]} color="#9fc4ff" intensity={0.5} spread={0.075} />
    <Shaft from={[3, 8.4, -2.6]} to={[0, 0.2, 0]} color="#9fc4ff" intensity={0.5} spread={0.075} />
    <Shaft from={[-2.4, 8.4, 3]} to={[0, 0.2, 0]} color="#ffe2c4" intensity={0.38} spread={0.07} />
    <Shaft from={[2.4, 8.4, 3]} to={[0, 0.2, 0]} color="#ffe2c4" intensity={0.38} spread={0.07} />
    <Shaft from={[-6.5, 8, -5]} to={[-3.2, 0.1, -2.3]} color="#ff3a5a" intensity={0.4} spread={0.07} />
    <Shaft from={[6.5, 8, -5]} to={[3.2, 0.1, -2.3]} color="#3a9bff" intensity={0.4} spread={0.07} />
    <SweepingShaft phase={0} color="#8fe0ff" rate={0.35} focus={focus} />
    <SweepingShaft phase={2.1} color="#ff9ad0" rate={0.28} focus={focus} />
    <SweepingShaft phase={4.2} color="#ffe29a" rate={0.31} focus={focus} />
  </>;
}
