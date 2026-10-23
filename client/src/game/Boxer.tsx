import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Trail } from '@react-three/drei';
import { Color, Group, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { DIM } from './rig/rig.js';
import type { FighterRig } from './rig/rig.js';

const UP = new Vector3(0, 1, 0), dir = new Vector3(), mid = new Vector3(), quat = new Quaternion();
/** Lays a segment whose long axis is local Y between two points (segment lengths never change, so no scaling). */
function lay(group: Group | null, a: Vector3, b: Vector3, extend = 0) {
  if (!group) return;
  dir.subVectors(b, a); const length = dir.length() || 1; dir.divideScalar(length);
  group.position.copy(mid.addVectors(a, b).multiplyScalar(0.5)).addScaledVector(dir, extend);
  group.quaternion.copy(quat.setFromUnitVectors(UP, dir));
}

const LOOKS = {
  red: { name: 'RAVAGER', armor: '#262a33', plate: '#3a3f4c', trim: '#c4182e', neon: '#ff2f4d', glove: '#d6122b', shorts: '#a30f22', shine: 0.8, rough: 0.32, wide: 1.12, spikes: true },
  ref: { name: 'REFEREE', armor: '#b9bcc8', plate: '#1a1a22', trim: '#222', neon: '#4d5a2c', glove: '#f4f4f4', shorts: '#15151b', shine: 0.2, rough: 0.6, wide: 0.9, spikes: false },
  blue: { name: 'AEGIS', armor: '#cdd7e3', plate: '#1a3a74', trim: '#1b4c9c', neon: '#38b8ff', glove: '#1f6be0', shorts: '#12388a', shine: 0.7, rough: 0.28, wide: 0.96, spikes: false },
} as const;

const Metal = ({ color, rough, metal = 0.9 }: { color: string; rough: number; metal?: number }) => <meshStandardMaterial color={color} metalness={metal} roughness={rough} />;

/** One articulated robot boxer. The rig computes the pose; this component only maps joints onto meshes every frame. */
export function Boxer({ rig, look: lookName }: { rig: FighterRig; look: keyof typeof LOOKS }) {
  const look = LOOKS[lookName], root = useRef<Group>(null), hips = useRef<Group>(null), chest = useRef<Group>(null), head = useRef<Group>(null);
  const upper = [useRef<Group>(null), useRef<Group>(null)], fore = [useRef<Group>(null), useRef<Group>(null)], glove = [useRef<Group>(null), useRef<Group>(null)];
  const thigh = [useRef<Group>(null), useRef<Group>(null)], shin = [useRef<Group>(null), useRef<Group>(null)], foot = [useRef<Group>(null), useRef<Group>(null)];
  const trail = [useRef<Group>(null), useRef<Group>(null)], lastGlove = useRef([new Vector3(), new Vector3()]);
  const elbow = [useRef<Group>(null), useRef<Group>(null)], knee = [useRef<Group>(null), useRef<Group>(null)];
  const neon = useMemo(() => new MeshStandardMaterial({ color: new Color(look.neon).multiplyScalar(0.25), emissive: new Color(look.neon), emissiveIntensity: 1.5, roughness: 0.4 }), [look.neon]);
  const gloveMat = useMemo(() => new MeshStandardMaterial({ color: look.glove, roughness: 0.38, metalness: 0.12, emissive: new Color(look.glove), emissiveIntensity: 0.12 }), [look.glove]);

  useFrame((_, dt) => {
    const g = rig.geometry, c = g.pose;
    if (root.current) { root.current.position.copy(rig.rootWorld); root.current.rotation.set(0, g.yaw, c.fall * 1.5, 'YZX'); }
    if (hips.current) hips.current.rotation.set(0, c.hipYaw, 0);
    if (chest.current) chest.current.rotation.copy(g.chest);
    if (head.current) { head.current.position.set(DIM.headX + c.headX, DIM.headY + c.headY, 0); head.current.rotation.set(c.headRoll, c.headYaw, -c.headPitch, 'YZX'); }
    neon.emissiveIntensity = 0.8 + c.glow * 1.8; gloveMat.emissiveIntensity = 0.1 + c.glow * 0.18;
    for (let i = 0; i < 2; i++) {
      lay(upper[i].current, g.shoulder[i], g.elbow[i]); lay(fore[i].current, g.elbow[i], g.wrist[i]); lay(glove[i].current, g.elbow[i], g.wrist[i], 0.19);
      glove[i].current?.rotateY(i === 0 ? c.lroll : c.rroll); // the fist turns over as a straight punch extends
      elbow[i].current?.position.copy(g.elbow[i]);
      // The streak behind a glove only shows while it is moving fast, which is what makes a punch read as quick.
      const speed = rig.gloveWorld[i].distanceTo(lastGlove.current[i]) / Math.max(dt, 1e-3); lastGlove.current[i].copy(rig.gloveWorld[i]);
      if (trail[i].current) trail[i].current!.visible = !rig.isRef && speed > 2.4;
      lay(thigh[i].current, g.hip[i], g.knee[i]); lay(shin[i].current, g.knee[i], g.ankle[i]); knee[i].current?.position.copy(g.knee[i]);
      foot[i].current?.position.set(g.ankle[i].x, g.ankle[i].y - 0.08, g.ankle[i].z);
      if (foot[i].current) foot[i].current!.rotation.y = i === 0 ? c.lfyaw : c.rfyaw; // toes turned out, pivoting on a punch
    }
  });

  const w = look.wide, sh = lookName === 'red';
  return <group ref={root}>
    {/* pelvis, boxing trunks and belt */}
    <group ref={hips}>
      <RoundedBox args={[0.26, 0.17, 0.35]} radius={0.05} smoothness={3}><Metal color={look.armor} rough={look.rough} /></RoundedBox>
      <RoundedBox args={[0.31, 0.25, 0.42]} radius={0.07} smoothness={3} position={[0, -0.12, 0]}><meshStandardMaterial color={look.shorts} roughness={0.5} metalness={0.2} /></RoundedBox>
      <mesh position={[0, 0.05, 0]}><boxGeometry args={[0.32, 0.045, 0.43]} /><primitive object={neon} attach="material" /></mesh>
      <mesh position={[0.16, -0.12, 0]}><boxGeometry args={[0.02, 0.16, 0.12]} /><primitive object={neon} attach="material" /></mesh>
      {/* waist and torso */}
      <group ref={chest} position={[0, DIM.pivotY, 0]}>
        <mesh position={[0, -0.27, 0]}><cylinderGeometry args={[0.115, 0.13, 0.14, 14]} /><Metal color={look.plate} rough={0.5} metal={0.7} /></mesh>
        <RoundedBox args={[0.31, 0.44, 0.5 * w + 0.06]} radius={0.09} smoothness={4}><Metal color={look.armor} rough={look.rough} metal={look.shine} /></RoundedBox>
        <RoundedBox args={[0.07, 0.19, 0.25]} radius={0.03} smoothness={3} position={[0.15, 0.1, 0.14]}><Metal color={look.plate} rough={0.4} /></RoundedBox>
        <RoundedBox args={[0.07, 0.19, 0.25]} radius={0.03} smoothness={3} position={[0.15, 0.1, -0.14]}><Metal color={look.plate} rough={0.4} /></RoundedBox>
        {[-0.07, -0.15, -0.23].map(y => <RoundedBox key={y} args={[0.06, 0.06, 0.3]} radius={0.02} smoothness={2} position={[0.14, y, 0]}><Metal color={look.plate} rough={0.45} /></RoundedBox>)}
        <mesh position={[0.158, 0.1, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.045, 0.045, 0.02, 20]} /><primitive object={neon} attach="material" /></mesh>
        <mesh position={[0.158, 0.2, 0]}><boxGeometry args={[0.012, 0.012, 0.42 * w]} /><primitive object={neon} attach="material" /></mesh>
        <RoundedBox args={[0.13, 0.3, 0.3]} radius={0.04} smoothness={3} position={[-0.2, 0.05, 0]}><Metal color={look.plate} rough={0.5} /></RoundedBox>
        {lookName === 'blue' && <RoundedBox args={[0.04, 0.3, 0.3]} radius={0.04} smoothness={3} position={[0.17, 0.0, 0]}><Metal color={look.plate} rough={0.25} /></RoundedBox>}
        {/* shoulders */}
        {[-1, 1].map(z => <group key={z} position={[0, DIM.shoulderY, z * DIM.shoulderZ]}>
          <mesh scale={[1, 0.85, 1]}><sphereGeometry args={[0.1 * w + 0.015, 20, 14]} /><Metal color={look.armor} rough={look.rough} metal={look.shine} /></mesh>
          <mesh position={[0, 0.02, 0]} scale={[1, 0.3, 1]}><sphereGeometry args={[0.112 * w + 0.015, 18, 8]} /><primitive object={neon} attach="material" /></mesh>
          {sh && <mesh position={[0, 0.12, z * 0.03]} rotation={[z * 0.3, 0, 0]}><coneGeometry args={[0.035, 0.14, 8]} /><Metal color={look.trim} rough={0.4} /></mesh>}
        </group>)}
        {/* neck and head */}
        <mesh position={[0.01, 0.3, 0]}><cylinderGeometry args={[0.055, 0.065, 0.11, 12]} /><Metal color={look.plate} rough={0.5} metal={0.6} /></mesh>
        <group ref={head} position={[DIM.headX, DIM.headY, 0]}>
          <RoundedBox args={[0.25, 0.28, 0.23]} radius={0.085} smoothness={4}><Metal color={look.armor} rough={look.rough} metal={look.shine} /></RoundedBox>
          <RoundedBox args={[0.06, 0.075, 0.19]} radius={0.025} smoothness={2} position={[0.105, 0.035, 0]}><primitive object={neon} attach="material" /></RoundedBox>
          <RoundedBox args={[0.1, 0.07, 0.15]} radius={0.03} smoothness={2} position={[0.06, -0.1, 0]}><Metal color={look.plate} rough={0.4} /></RoundedBox>
          {lookName === 'ref' ? null : sh ? <>
            <mesh position={[-0.02, 0.17, 0]} rotation={[0, 0, -0.15]}><boxGeometry args={[0.2, 0.07, 0.025]} /><Metal color={look.trim} rough={0.35} /></mesh>
            {[-1, 1].map(z => <mesh key={z} position={[-0.03, 0.12, z * 0.13]} rotation={[z * 0.5, 0, -0.5]}><coneGeometry args={[0.03, 0.15, 6]} /><Metal color={look.trim} rough={0.4} /></mesh>)}
          </> : <>
            <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.1, 0.012, 8, 28]} /><primitive object={neon} attach="material" /></mesh>
            {[-1, 1].map(z => <mesh key={z} position={[-0.02, 0.0, z * 0.12]}><cylinderGeometry args={[0.045, 0.045, 0.03, 16]} /><primitive object={neon} attach="material" /></mesh>)}
          </>}
        </group>
      </group>
    </group>
    {/* arms: [lead, rear] */}
    {[0, 1].map(i => <group key={i}>
      <group ref={upper[i]}><mesh><cylinderGeometry args={[0.062, 0.055, DIM.upperArm, 12]} /><Metal color={look.plate} rough={0.4} /></mesh>
        <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.07, 0.07, 0.08, 12]} /><Metal color={look.armor} rough={look.rough} metal={look.shine} /></mesh></group>
      <group ref={elbow[i]}><mesh><sphereGeometry args={[0.058, 14, 10]} /><Metal color={look.armor} rough={look.rough} metal={look.shine} /></mesh></group>
      <group ref={fore[i]}><mesh><cylinderGeometry args={[0.055, 0.045, DIM.foreArm, 12]} /><Metal color={look.armor} rough={look.rough} metal={look.shine} /></mesh>
        <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.062, 0.062, 0.1, 12]} /><primitive object={neon} attach="material" /></mesh></group>
      {!rig.isRef && <group ref={trail[i]} visible={false}><Trail target={glove[i] as unknown as RefObject<Object3D>} width={2.4} length={4.5} color={look.neon} attenuation={t => t * t} decay={2.4}><meshBasicMaterial transparent opacity={0.55} toneMapped={false} /></Trail></group>}
      <group ref={glove[i]}>
        <mesh position={[0, 0.02, 0]} scale={[1, 1.08, 0.92]}><sphereGeometry args={[0.108, 22, 16]} /><primitive object={gloveMat} attach="material" /></mesh>
        <mesh position={[0, -0.085, 0]}><cylinderGeometry args={[0.078, 0.09, 0.075, 14]} /><meshStandardMaterial color="#f2f2f2" roughness={0.6} /></mesh>
        <mesh position={[0.0, 0.05, i === 0 ? 0.085 : -0.085]} scale={[0.8, 1.3, 0.6]}><sphereGeometry args={[0.045, 12, 8]} /><primitive object={gloveMat} attach="material" /></mesh>
      </group>
    </group>)}
    {/* legs and boots */}
    {[0, 1].map(i => <group key={i}>
      <group ref={thigh[i]}><mesh><cylinderGeometry args={[0.088, 0.07, DIM.thigh, 12]} /><Metal color={look.armor} rough={look.rough} metal={look.shine} /></mesh>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[0.095, 0.095, 0.05, 12]} /><primitive object={neon} attach="material" /></mesh></group>
      <group ref={knee[i]}><mesh><sphereGeometry args={[0.07, 14, 10]} /><Metal color={look.plate} rough={0.4} /></mesh></group>
      <group ref={shin[i]}><mesh><cylinderGeometry args={[0.068, 0.052, DIM.shin, 12]} /><Metal color={look.armor} rough={look.rough} metal={look.shine} /></mesh></group>
      <group ref={foot[i]}>
        <RoundedBox args={[0.31, 0.11, 0.13]} radius={0.04} smoothness={3} position={[0.07, 0.02, 0]}><Metal color={look.plate} rough={0.35} /></RoundedBox>
        <mesh position={[0.2, 0.025, 0]}><boxGeometry args={[0.03, 0.04, 0.11]} /><primitive object={neon} attach="material" /></mesh>
      </group>
    </group>)}
  </group>;
}
