import { Euler, MathUtils, Vector3 } from 'three';
import type { Action, Battlefield, Personality, Side } from '../../../../shared/types.js';
import { SIDES, opponent } from '../../../../shared/types.js';
import { beatsFor, idleBeat, isPunch } from './beats.js';
import type { Beat } from './beats.js';
import { solveTwoBone } from './ik.js';

/** Body proportions in metres. Frame: +X forward, +Y up, +Z the boxer's right. Root = hip centre. */
export const DIM = { hips: 0.93, pivotY: 0.3, shoulderY: 0.19, shoulderZ: 0.3, headY: 0.52, headX: 0.03, upperArm: 0.33, foreArm: 0.31, thigh: 0.46, shin: 0.46, hipZ: 0.12 };
export const EXCHANGE_SECONDS = 0.95;
/** When, within an exchange (0..1), each punch starts, lands and is fully retracted. */
export const TIMELINE: Partial<Record<Action, { start: number; peak: number; end: number }>> = {
  JAB: { start: 0.04, peak: 0.28, end: 0.56 }, CROSS: { start: 0.06, peak: 0.36, end: 0.68 }, HOOK: { start: 0.06, peak: 0.4, end: 0.72 },
  UPPERCUT: { start: 0.08, peak: 0.42, end: 0.78 }, COUNTER: { start: 0.2, peak: 0.5, end: 0.84 },
};

const smooth = (x: number) => { const c = MathUtils.clamp(x, 0, 1); return c * c * (3 - 2 * c); };
const bump = (p: number, a: number, peak: number, b: number) => p <= a || p >= b ? 0 : p < peak ? smooth((p - a) / (peak - a)) : smooth(1 - (p - peak) / (b - peak));
/** A punch accelerates into its target, holds for an instant, then snaps back faster than it went out. */
function punchEnvelope(p: number, tl: { start: number; peak: number; end: number }) {
  if (p <= tl.start || p >= tl.end) return 0;
  if (p < tl.peak) return Math.pow((p - tl.start) / (tl.peak - tl.start), 2.2);
  const hold = 0.03;
  if (p < tl.peak + hold) return 1;
  const v = (p - tl.peak - hold) / (tl.end - tl.peak - hold);
  return (1 - v) * (1 - v);
}
/** How each personality carries itself. Purely cosmetic: it changes how the boxer moves, never what the rules let it do. */
export interface MoveStyle { bounce: number; rate: number; lean: number; guard: number; width: number; weave: number; drop: number }
export const STYLES: Record<Personality, MoveStyle> = {
  BERSERKER: { bounce: 1.3, rate: 1.1, lean: 0.12, guard: 0, width: 1.1, weave: 0.6, drop: 0.02 },          // forward-leaning pressure fighter
  COUNTERPUNCHER: { bounce: 0.8, rate: 0.9, lean: -0.04, guard: 0.06, width: 1, weave: 1.6, drop: 0 },      // upright, high hands, weaving
  TACTICIAN: { bounce: 1, rate: 1, lean: 0.03, guard: 0.02, width: 1, weave: 1, drop: 0.01 },
  TRICKSTER: { bounce: 1.8, rate: 1.35, lean: 0, guard: -0.05, width: 1.2, weave: 1.4, drop: 0 },           // Ali shuffle: bouncy, hands low
  COWARD: { bounce: 0.7, rate: 0.85, lean: -0.1, guard: 0.1, width: 0.9, weave: 0.8, drop: 0.06 },          // crouched and covered
};
const STEP_TRIGGER = 0.22;
const Y = new Vector3(0, 1, 0);

const KEYS = ['lunge', 'sway', 'drop', 'hop', 'fall', 'hipYaw', 'chestYaw', 'chestPitch', 'chestRoll', 'headPitch', 'headYaw', 'headRoll', 'headX', 'headY', 'lroll', 'rroll', 'lfyaw', 'rfyaw',
  'lgx', 'lgy', 'lgz', 'rgx', 'rgy', 'rgz', 'lpx', 'lpy', 'lpz', 'rpx', 'rpy', 'rpz', 'flx', 'fly', 'flz', 'frx', 'fry', 'frz', 'glow', 'shake'] as const;
export type Pose = Record<typeof KEYS[number], number>;
const blankPose = (): Pose => Object.fromEntries(KEYS.map(k => [k, 0])) as Pose;
const FAST_KEYS = new Set<string>(['lgx', 'lgy', 'lgz', 'rgx', 'rgy', 'rgz', 'headPitch', 'headYaw', 'headRoll', 'headX', 'headY', 'lunge', 'chestYaw', 'hipYaw', 'fall', 'glow', 'shake']);

const euler = new Euler(0, 0, 0, 'YZX'), tmp = new Vector3(), tmp2 = new Vector3();
const PIVOT = new Vector3(0, DIM.pivotY, 0);
/** Chest-frame point -> root frame, following the current torso twist, lean and hip turn. */
function chestToRoot(pose: Pose, v: Vector3, out: Vector3) {
  euler.set(pose.chestRoll, pose.chestYaw, -pose.chestPitch, 'YZX');
  return out.copy(v).applyEuler(euler).add(PIVOT).applyAxisAngle(Y, pose.hipYaw);
}

export interface FxEvent { kind: 'hit' | 'block'; target: Side; position: Vector3; amount: number; heavy: boolean; knockdown: boolean }
/** Everything the renderer needs for one boxer in one frame, all in the root frame unless noted. */
export interface RigGeometry {
  pose: Pose; rootWorld: Vector3; yaw: number;
  chest: Euler; headCentre: Vector3;
  shoulder: [Vector3, Vector3]; elbow: [Vector3, Vector3]; wrist: [Vector3, Vector3];   // [lead(left), rear(right)]
  hip: [Vector3, Vector3]; knee: [Vector3, Vector3]; ankle: [Vector3, Vector3];
}

export class FighterRig {
  cur = blankPose(); tgt = blankPose(); private vel = blankPose();
  style: MoveStyle = STYLES.TACTICIAN;
  /** Where each ankle really is in the world (they are planted, and only move when the boxer takes a step). */
  footWorld: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private feet = [0, 1].map(() => ({ pos: new Vector3(), from: new Vector3(), to: new Vector3(), t: 1, dur: 0.2, lift: 0 }));
  private feetReady = false; private lastRoot = new Vector3(); private rootVel = new Vector3();
  base = new Vector3(); yaw = 0;                          // ground position and facing, set by FightRig
  rootWorld = new Vector3(); headWorld = new Vector3(); headRestWorld = new Vector3();
  gloveWorld: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  geometry: RigGeometry;
  private phase: number;
  constructor(readonly side: Side, readonly isRef = false) {
    this.phase = side === 'red' ? 0 : 2.3;
    this.geometry = { pose: this.cur, rootWorld: this.rootWorld, yaw: 0, chest: new Euler(0, 0, 0, 'YZX'), headCentre: new Vector3(),
      shoulder: [new Vector3(), new Vector3()], elbow: [new Vector3(), new Vector3()], wrist: [new Vector3(), new Vector3()],
      hip: [new Vector3(), new Vector3()], knee: [new Vector3(), new Vector3()], ankle: [new Vector3(), new Vector3()] };
    this.reset();
  }
  reset() { this.tgt = this.compute(idleBeat(), 1, 0, 0, undefined, this.restHead(), this.restHead(), 0, 0); this.cur = { ...this.tgt }; this.vel = blankPose(); this.feetReady = false; this.geometry.pose = this.cur; }

  /** Head centre in the root frame while standing in the neutral stance. */
  restHead() {
    const rest = blankPose(); rest.chestPitch = 0.14; rest.chestYaw = -0.2; rest.hipYaw = -0.1;
    return chestToRoot(rest, new Vector3(DIM.headX, DIM.headY, 0), new Vector3());
  }

  /** The referee: upright, arms down, leaning in when a boxer is down and chopping the air to count. */
  computeReferee(t: number, counting: boolean, kneel: number): Pose {
    const o = blankPose(), s = Math.sin(t * 2.2 + this.phase);
    o.drop = 0.03 + 0.01 * s + 0.3 * kneel; o.chestPitch = 0.06 + 0.3 * kneel; o.headPitch = 0.1 + 0.25 * kneel; o.headYaw = 0.12 * Math.sin(t * 0.9); o.glow = 0.35;
    o.flx = 0.1 - 0.12 * kneel; o.flz = -0.14; o.frx = -0.1; o.frz = 0.14; o.lfyaw = 0.1; o.rfyaw = -0.2;
    const lead = new Vector3(0.05, -0.36, -0.33), rear = new Vector3(0.05, -0.36, 0.33);
    if (counting) { const chop = Math.abs(Math.sin(t * Math.PI / 0.55)); rear.set(0.3, 0.62 - 0.5 * chop, 0.3); lead.set(0.12, -0.2, -0.34); }
    chestToRoot(o, lead, lead); chestToRoot(o, rear, rear);
    o.lgx = lead.x; o.lgy = lead.y; o.lgz = lead.z; o.rgx = rear.x; o.rgy = rear.y; o.rgz = rear.z;
    o.lpx = -0.3; o.lpy = -1; o.lpz = -0.3; o.rpx = -0.3; o.rpy = -1; o.rpz = 0.3;
    return o;
  }

  /** The pose this boxer is trying to reach right now. `p` is exchange progress 0..1, `t` seconds of idle clock. */
  compute(beat: Beat, p: number, t: number, round: number, foeAction: Action | 'IDLE' | undefined, foeHead: Vector3, foeHeadRest: Vector3, sinceFinish: number, bellFlash: number): Pose {
    const o = blankPose(), ph = this.phase, s = Math.sin(t * 5.4 * this.style.rate + ph);
    const act = beat.action, tl = TIMELINE[act as Action], e = tl ? punchEnvelope(p, tl) : 0;
    const slipDir = round % 2 ? 1 : -1;
    // --- neutral boxing stance: bladed, knees bent, gently bouncing
    const st = this.style, tired = MathUtils.clamp((35 - beat.stamina) / 35, 0, 1), hurt = MathUtils.clamp((0.3 - beat.health) / 0.3, 0, 1);
    o.drop = 0.07 + st.drop + 0.04 * tired + 0.05 * hurt + 0.015 * st.bounce * s; o.hop = 0.012 * st.bounce * Math.max(0, s) * (1 - 0.6 * tired);
    o.chestPitch = 0.14 + st.lean + 0.02 * Math.sin(t * 1.9 + ph) + (0.015 + 0.04 * tired) * Math.sin(t * (6 + 5 * tired) + ph); // breathing heaves harder when tired
    o.chestYaw = -0.2; o.hipYaw = -0.1;
    o.headPitch = 0.1 + 0.2 * hurt + 0.1 * tired; o.headYaw = 0.05 * Math.sin(t * 1.3 + ph);
    o.sway += 0.06 * hurt * Math.sin(t * 2.1 + ph); o.headRoll += 0.1 * hurt * Math.sin(t * 1.7 + ph); // a hurt boxer wobbles
    o.glow = 0.55 + 0.1 * Math.sin(t * 2.4 + ph);
    // --- trunk and head moves per action
    // The kinetic chain: the hips turn first, the shoulders a moment later, the arm last, so power travels up the body.
    const eHip = tl ? punchEnvelope(p + 0.06, tl) : 0, eChest = tl ? punchEnvelope(p + 0.03, tl) : 0;
    o.lfyaw = 0.15; o.rfyaw = -0.65;
    const crouch = act === 'UPPERCUT' ? bump(p, tl!.start, tl!.start + 0.14, tl!.peak) : 0;
    if (act === 'JAB') { o.chestYaw += -0.3 * eChest; o.hipYaw += -0.1 * eHip; o.chestPitch += 0.1 * eChest; o.lfyaw += 0.25 * eHip; o.lroll = 1.3 * e; }
    else if (act === 'CROSS' || act === 'COUNTER') { o.chestYaw += 0.62 * eChest; o.hipYaw += 0.38 * eHip; o.chestPitch += 0.12 * eChest; o.rfyaw += 0.55 * eHip; o.rroll = 1.3 * e; } // the rear foot pivots, the heel turns out
    else if (act === 'HOOK') { o.chestYaw += -0.78 * eChest; o.hipYaw += -0.36 * eHip; o.chestRoll += 0.12 * eChest; o.chestPitch += 0.06 * eChest; o.lfyaw += 0.35 * eHip; o.lroll = 0.5 * e; }
    else if (act === 'UPPERCUT') { o.chestYaw += 0.42 * eChest; o.hipYaw += 0.3 * eHip; o.chestPitch += -0.12 * eChest; o.drop += 0.2 * crouch - 0.05 * e; o.rfyaw += 0.4 * eHip; o.rroll = -0.4 * e; }
    // A slip is timed to the punch it avoids and shaped by it: sidestep a straight, duck under a hook, pull back from an uppercut.
    const incoming = foeAction ? TIMELINE[foeAction as Action] : undefined, window3 = incoming ? [incoming.peak - 0.24, incoming.peak, incoming.peak + 0.26] : [0.04, 0.24, 0.62];
    const slipAmount = beat.dodged ? 1 : beat.hitBy ? 0.45 : 0.8;
    const slip = act === 'SLIP' ? bump(p, window3[0], window3[1], window3[2]) * slipAmount : act === 'COUNTER' ? bump(p, 0.04, 0.16, 0.36) : 0;
    if (act === 'SLIP' && foeAction === 'HOOK') { o.drop += 0.3 * slip; o.chestPitch += 0.32 * slip; o.headPitch += 0.2 * slip; o.sway += slipDir * 0.06 * slip; o.headY -= 0.04 * slip; }
    else if (act === 'SLIP' && foeAction === 'UPPERCUT') { o.chestPitch -= 0.38 * slip; o.headX -= 0.07 * slip; o.lunge -= 0.14 * slip; o.headPitch -= 0.25 * slip; o.drop += 0.03 * slip; }
    else { o.sway += slipDir * 0.24 * slip; o.chestRoll += slipDir * 0.45 * slip; o.headRoll += slipDir * 0.25 * slip; o.drop += 0.07 * slip; o.headY -= 0.05 * slip; }
    o.sway += 0.035 * st.weave * Math.sin(t * 1.7 + ph); o.chestRoll += 0.04 * st.weave * Math.sin(t * 2.3 + ph); // restless head movement even when nothing is thrown
    // --- reactions to what the opponent did
    const foeTl = foeAction ? TIMELINE[foeAction as Action] : undefined;
    const tc = foeTl?.peak ?? 0.4, k = MathUtils.clamp(0.35 + beat.damage / 28, 0.35, 1.3);
    if (beat.hitBy && foeTl) {
      const r = bump(p, tc - 0.02, tc + 0.08, tc + 0.52);
      if (beat.hitBy === 'HOOK') { o.headYaw += 0.95 * k * r; o.headRoll += 0.32 * k * r; o.chestYaw += 0.3 * k * r; o.sway += 0.1 * k * r; o.chestPitch -= 0.04 * k * r; }
      else if (beat.hitBy === 'UPPERCUT') { o.headPitch -= 0.85 * k * r; o.chestPitch -= 0.22 * k * r; o.hop += 0.07 * k * r; o.headY += 0.03 * r; o.lunge -= 0.08 * k * r; }
      else { o.headPitch -= 0.42 * k * r; o.headX -= 0.06 * k * r; o.chestPitch -= 0.16 * k * r; o.lunge -= 0.1 * k * r; o.headYaw += 0.25 * k * r; }
      o.glow += 1.4 * r; o.shake += 0.5 * r;
    }
    if (beat.guarded && foeTl) { const r = bump(p, tc - 0.02, tc + 0.06, tc + 0.4); o.chestPitch -= 0.06 * r; o.headX -= 0.025 * r; o.lunge -= 0.05 * r; o.shake += 1 * r; o.glow += 0.6 * r; }
    // --- footwork
    // Where each foot would like to be relative to the body. The planting controller (updateFeet) turns this into real steps.
    o.flx = 0.24; o.flz = -0.17 * st.width; o.frx = -0.2; o.frz = 0.2 * st.width;
    if (act === 'STEP_IN') { const w = bump(p, 0.05, 0.4, 0.8); o.flx += 0.3 * w; o.frx += 0.22 * bump(p, 0.35, 0.65, 0.98); o.chestPitch += 0.08 * w; }
    if (act === 'STEP_BACK') { const w = bump(p, 0.05, 0.4, 0.8); o.frx -= 0.3 * w; o.flx -= 0.2 * bump(p, 0.35, 0.65, 0.98); o.chestPitch -= 0.06 * w; }
    // --- gloves. Guard positions are defined on the chest so they follow the twist; punches aim at the opponent's head.
    const guard = act === 'GUARD' ? bump(p, 0, 0.18, 1.04) * 0.97 + 0.03 : act === 'SLIP' ? 0.55 : beat.guarded ? 0.85 : 0.0;
    const high = MathUtils.clamp(guard, 0, 1);
    const gl = new Vector3(0.36 + 0.04 * high, 0.32 + st.guard - 0.11 * tired - 0.05 * hurt + 0.18 * high + 0.02 * Math.sin(t * 3.1 + ph), -0.11 + 0.04 * high), gr = new Vector3(0.3 + 0.06 * high, 0.3 + st.guard - 0.11 * tired - 0.05 * hurt + 0.18 * high + 0.02 * Math.sin(t * 3.1 + 1 + ph), 0.13 - 0.05 * high);
    chestToRoot(o, gl, gl); chestToRoot(o, gr, gr);
    const shoulderR = chestToRoot(o, new Vector3(0, DIM.shoulderY, DIM.shoulderZ), new Vector3()), shoulderL = chestToRoot(o, new Vector3(0, DIM.shoulderY, -DIM.shoulderZ), new Vector3());
    let lead = gl.clone(), rear = gr.clone(), leadPole = new Vector3(-0.2, -1, -0.55), rearPole = new Vector3(-0.2, -1, 0.55);
    if (e > 0 && tl) {
      const rest = beat.own === 'landed' ? foeHead : foeHeadRest, T = new Vector3();
      if (beat.own === 'landed') T.set(rest.x - 0.15, rest.y - 0.02, rest.z);
      else if (beat.own === 'blocked') T.set(foeHeadRest.x - 0.27, foeHeadRest.y - 0.04, foeHeadRest.z);
      else if (beat.own === 'slipped') T.set(foeHeadRest.x - 0.14, foeHeadRest.y, foeHeadRest.z);
      else T.set(foeHeadRest.x - 0.34, foeHeadRest.y + 0.02, foeHeadRest.z + (act === 'JAB' || act === 'HOOK' ? 0.22 : -0.22));
      const shoulder = act === 'JAB' || act === 'HOOK' ? shoulderL : shoulderR;
      if (act === 'UPPERCUT') T.y -= 0.15;
      if (act === 'HOOK') T.set(T.x + 0.04, T.y, T.z - 0.1);
      o.lunge += MathUtils.clamp(T.x - shoulder.x - 0.6, 0, 0.5) * e;
      T.x -= o.lunge; T.z -= o.sway; T.y += o.drop - o.hop;
      const from = act === 'JAB' || act === 'HOOK' ? lead : rear, u = e;
      const path = new Vector3();
      if (act === 'HOOK') { const mid = new Vector3(T.x - 0.1, T.y + 0.04, T.z - 0.45); path.copy(from).multiplyScalar((1 - u) * (1 - u)).addScaledVector(mid, 2 * (1 - u) * u).addScaledVector(T, u * u); }
      else if (act === 'UPPERCUT') { const low = new Vector3(from.x + 0.1, from.y - 0.55, from.z); path.copy(from).multiplyScalar((1 - u) * (1 - u)).addScaledVector(low, 2 * (1 - u) * u).addScaledVector(T, u * u); }
      else path.copy(from).lerp(T, u);
      if (act === 'JAB' || act === 'HOOK') { lead = path; leadPole = act === 'HOOK' ? new Vector3(-0.1, 0.35, -1) : new Vector3(-0.1, -0.7, -0.6); }
      else { rear = path; rearPole = act === 'UPPERCUT' ? new Vector3(-0.5, -0.6, 0.7) : new Vector3(-0.1, -0.7, 0.6); }
    }
    // --- clinch: both boxers wrap their arms around each other, heads over shoulders
    const hug = act === 'CLINCH' || beat.clinched ? smooth((p - 0.05) / 0.25) * (1 - smooth((p - 0.9) / 0.1)) : 0;
    if (hug > 0) {
      o.lunge += (act === 'CLINCH' ? 0.2 : 0.05) * hug; o.chestPitch += 0.28 * hug; o.headYaw += 0.55 * hug; o.drop += 0.04 * hug; o.headPitch += 0.1 * hug;
      const body = new Vector3(foeHead.x - o.lunge, foeHead.y - 0.52 + o.drop, foeHead.z - o.sway);
      lead.lerp(new Vector3(body.x + 0.2, body.y + 0.12, body.z - 0.2), hug); rear.lerp(new Vector3(body.x + 0.2, body.y - 0.04, body.z + 0.2), hug);
      leadPole.lerp(new Vector3(-0.2, -0.4, -0.8), hug); rearPole.lerp(new Vector3(-0.2, -0.4, 0.8), hug);
    }
    // --- limp or celebrating overrides
    // A boxer goes down after the punch that does it (a knockdown, or a knockout by an ordinary blow); one who was already down stays down.
    const goesDown = beat.knockdown || (beat.down && beat.damage > 0);
    const fallRaw = goesDown ? smooth((p - (foeTl?.peak ?? 0.4) - 0.02) / 0.3) : 0;
    o.fall = beat.down ? (goesDown ? fallRaw : 1) : fallRaw * (1 - smooth((p - 0.74) / 0.24));
    if (o.fall > 0) {
      const limpL = new Vector3(0.05, -0.35, -0.42), limpR = new Vector3(0.05, -0.35, 0.42);
      lead.lerp(limpL, o.fall); rear.lerp(limpR, o.fall); o.headPitch += 0.2 * o.fall; o.glow *= 1 - 0.8 * o.fall;
    }
    const win = beat.won ? smooth(sinceFinish / 0.8) : 0, lose = beat.lost && !beat.down ? smooth(sinceFinish / 0.8) : 0;
    if (win > 0) {
      const up1 = chestToRoot(o, new Vector3(0.05, 0.95, -0.4), new Vector3()), up2 = chestToRoot(o, new Vector3(0.05, 0.95, 0.4), new Vector3());
      lead.lerp(up1, win); rear.lerp(up2, win); leadPole.lerp(new Vector3(0, -0.2, -1), win); rearPole.lerp(new Vector3(0, -0.2, 1), win);
      o.hop += win * Math.abs(Math.sin(t * 6)) * 0.14; o.headPitch -= 0.3 * win; o.chestPitch -= 0.1 * win; o.glow += 1.2 * win * (0.6 + 0.4 * Math.sin(t * 8));
      o.flx = 0.2 + 0.1 * win; o.frx = -0.2 - 0.1 * win;
    }
    if (lose > 0) { lead.lerp(new Vector3(0.12, 0.0, -0.3), lose); rear.lerp(new Vector3(0.12, 0.0, 0.3), lose); o.headPitch += 0.5 * lose; o.chestPitch += 0.25 * lose; o.drop += 0.05 * lose; o.glow *= 1 - 0.6 * lose; }
    o.glow += 0.8 * bellFlash;
    // Glove positions are stored in the root frame, minus this frame's root translation so they stay where the punch aims.
    o.lgx = lead.x; o.lgy = lead.y; o.lgz = lead.z; o.rgx = rear.x; o.rgy = rear.y; o.rgz = rear.z;
    o.lpx = leadPole.x; o.lpy = leadPole.y; o.lpz = leadPole.z; o.rpx = rearPole.x; o.rpy = rearPole.y; o.rpz = rearPole.z;
    return o;
  }

  /** Eases the current pose toward the target and rebuilds the joint positions. */
  step(dt: number) {
    // Critically damped spring per joint value: it keeps its velocity from frame to frame, so motion accelerates and settles
    // smoothly instead of changing speed abruptly the way plain exponential easing does. Exact for any frame time.
    for (const key of KEYS) {
      const w = FAST_KEYS.has(key) ? 38 : 20, e = Math.exp(-w * dt), d = this.cur[key] - this.tgt[key], t = (this.vel[key] + w * d) * dt;
      this.cur[key] = this.tgt[key] + (d + t) * e; this.vel[key] = (this.vel[key] - w * t) * e;
    }
    this.updateFeet(dt);
    this.solve();
  }

  /**
   * Feet are planted in the world, not glued to the body. As the body drifts, lunges or is pushed, a foot stays where it is until it
   * is stretched too far, then it lifts, swings in a small arc and plants again (never both at once unless badly stretched).
   * That is what separates a boxer's footwork from a figure sliding on ice.
   */
  private updateFeet(dt: number) {
    const c = this.cur, lying = c.fall, step = Math.max(dt, 1e-3);
    const root = new Vector3(c.lunge - 0.45 * lying, 0, c.sway).applyAxisAngle(Y, this.yaw).add(this.base), rootY = MathUtils.lerp(DIM.hips - c.drop + c.hop, 0.24, lying);
    if (this.feetReady) this.rootVel.set((root.x - this.lastRoot.x) / step, 0, (root.z - this.lastRoot.z) / step); else this.rootVel.set(0, 0, 0);
    this.lastRoot.copy(root);
    const rest = [[this.tgt.flx, this.tgt.flz], [this.tgt.frx, this.tgt.frz]];
    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i], other = this.feet[1 - i], want = new Vector3(rest[i][0], 0, rest[i][1]).applyAxisAngle(Y, this.yaw).add(root);
      if (!this.feetReady || lying > 0.3) { foot.pos.copy(want); foot.t = 1; foot.lift = 0; }
      else {
        const error = Math.hypot(want.x - foot.pos.x, want.z - foot.pos.z);
        if (foot.t >= 1 && (other.t >= 1 || error > 0.5) && error > STEP_TRIGGER) {
          foot.from.copy(foot.pos); foot.to.copy(want).addScaledVector(this.rootVel, 0.12); foot.t = 0; foot.dur = MathUtils.clamp(0.13 + error * 0.25, 0.13, 0.32);
        }
        if (foot.t < 1) { foot.t = Math.min(1, foot.t + dt / foot.dur); foot.pos.lerpVectors(foot.from, foot.to, smooth(foot.t)); foot.lift = 0.1 * Math.sin(Math.PI * foot.t); }
        else foot.lift = 0.6 * c.hop; // the little push-off of a bounce
      }
      const local = new Vector3(foot.pos.x - root.x, 0, foot.pos.z - root.z).applyAxisAngle(Y, -this.yaw);
      if (i === 0) { c.flx = local.x; c.flz = local.z; c.fly = foot.lift - rootY; } else { c.frx = local.x; c.frz = local.z; c.fry = foot.lift - rootY; }
    }
    this.feetReady = true;
  }
  private updateFeetWorld() { for (let i = 0; i < 2; i++) this.footWorld[i].copy(this.geometry.ankle[i]).applyAxisAngle(Y, this.yaw).add(this.rootWorld); }
  /** Rebuilds geometry from the current pose without easing (tests and first frame). */
  snap() { this.cur = { ...this.tgt }; this.vel = blankPose(); this.solve(); }

  private solve() {
    const c = this.cur, g = this.geometry; g.pose = c; g.yaw = this.yaw;
    g.chest.set(c.chestRoll, c.chestYaw, -c.chestPitch, 'YZX');
    // Root world position: ground point + hips height + local lunge/sway rotated into the world.
    const lying = c.fall;
    const rootY = MathUtils.lerp(DIM.hips - c.drop + c.hop, 0.24, lying);
    tmp.set(c.lunge - 0.45 * lying, 0, c.sway).applyAxisAngle(Y, this.yaw);
    this.rootWorld.set(this.base.x + tmp.x, rootY, this.base.z + tmp.z);
    const head = g.headCentre.set(DIM.headX + c.headX, DIM.headY + c.headY, 0); chestToRoot(c, head, head);
    this.headWorld.copy(head).applyAxisAngle(Y, this.yaw).add(this.rootWorld);
    this.headRestWorld.copy(this.restHead()).applyAxisAngle(Y, this.yaw).add(tmp2.set(this.base.x, DIM.hips, this.base.z));
    // Arms.
    const sh = [new Vector3(0, DIM.shoulderY, -DIM.shoulderZ), new Vector3(0, DIM.shoulderY, DIM.shoulderZ)];
    const goals = [new Vector3(c.lgx, c.lgy, c.lgz), new Vector3(c.rgx, c.rgy, c.rgz)], poles = [new Vector3(c.lpx, c.lpy, c.lpz), new Vector3(c.rpx, c.rpy, c.rpz)];
    for (let i = 0; i < 2; i++) {
      chestToRoot(c, sh[i], g.shoulder[i]);
      // Poles are authored in the chest frame; rotate them with the torso.
      poles[i].applyEuler(g.chest).applyAxisAngle(Y, c.hipYaw);
      // Limp arms swing wide while falling.
      solveTwoBone(g.shoulder[i], goals[i], DIM.upperArm, DIM.foreArm, poles[i], g.elbow[i], g.wrist[i]);
      this.gloveWorld[i].copy(g.wrist[i]).applyAxisAngle(Y, this.yaw).add(this.rootWorld);
    }
    // Legs.
    const feet = [new Vector3(c.flx, c.fly + 0.08, c.flz), new Vector3(c.frx, c.fry + 0.08, c.frz)];
    for (let i = 0; i < 2; i++) {
      g.hip[i].set(0, -0.05, i === 0 ? -DIM.hipZ : DIM.hipZ);
      solveTwoBone(g.hip[i], feet[i], DIM.thigh, DIM.shin, tmp2.set(1, 0, i === 0 ? -0.12 : 0.12), g.knee[i], g.ankle[i]);
    }
    this.updateFeetWorld();
  }
}

/** Where two boxers stand: midpoint, separation and the slow circling of the fight line, from the authoritative state. */
export function placement(state: Battlefield | null) {
  const red = state?.robots.red.position ?? { x: 8.85, y: 6 }, blue = state?.robots.blue.position ?? { x: 11.15, y: 6 };
  const d = Math.hypot(blue.x - red.x, blue.y - red.y);
  return { cx: MathUtils.clamp(((red.x + blue.x) / 2 - 10) * 0.2, -1.3, 1.3), cz: MathUtils.clamp(((red.y + blue.y) / 2 - 6) * 0.3, -0.8, 0.8), separation: MathUtils.clamp(1.3 + (d - 2.15) * 0.75, 1.0, 2.1) };
}

/** Choreographer for the whole bout: owns both rigs, the exchange clock, and the impact events they produce. */
export class FightRig {
  rigs: Record<Side, FighterRig> = { red: new FighterRig('red'), blue: new FighterRig('blue') };
  referee = new FighterRig('blue', true);
  /** Sound and overlay cues raised since the last time the renderer drained them. */
  cues: Array<'whoosh' | 'bell' | 'finish' | 'count'> = [];
  /** The referee's count: 1..4 over a knockdown, 1..10 over a knockout, 0 otherwise. */
  count = 0; finishKind: 'ko' | 'tko' | 'decision' | null = null;
  private refBase = new Vector3(0, 0, -1.6); private fallen: Side | null = null;
  beats = { red: idleBeat(), blue: idleBeat() };
  /** Debug aid: freezes the exchange at a fixed progress so a pose can be inspected. */
  hold: number | null = null;
  p = 1; clock = 0; sinceFinish = 0; bellFlash = 0; round = 0; speed = 1; finished = false; timeScale = 1;
  private place = { cx: 0, cz: 0, separation: 1.3 }; private axis = 0; private slowUntil = 0; private lastRound = -1; knockdownRound = false;
  private foeActions: Record<Side, Action | 'IDLE'> = { red: 'IDLE', blue: 'IDLE' };

  private queue: Battlefield[] = [];
  /** New authoritative state. A follow-on exchange waits its turn so the current one is never cut short. */
  setState(state: Battlefield | null, speed: number) {
    this.speed = speed;
    this.target = placement(state);
    const round = state?.round ?? 0;
    if (round === this.lastRound || this.queue.some(q => q.round === round)) return;
    const newest = this.queue.at(-1)?.round ?? this.lastRound;
    if (state && round === newest + 1 && this.hold === null && (this.p < 1 || this.queue.length)) { this.queue.push(state); return; }
    this.queue = []; this.applyState(state);
  }
  private applyState(state: Battlefield | null) {
    const round = state?.round ?? 0;
    {
      const fresh = round < this.lastRound || this.lastRound < 0;
      this.lastRound = round; this.round = round; this.p = round === 0 ? 1 : 0; this.beats = beatsFor(state);
      if (state) for (const side of SIDES) this.rigs[side].style = STYLES[state.robots[side].personality] ?? STYLES.TACTICIAN;
      this.foeActions = { red: this.beats.blue.action, blue: this.beats.red.action };
      this.finished = state?.status === 'finished'; if (!this.finished) this.sinceFinish = 0;
      const goesDown = (b: typeof this.beats.red) => b.knockdown || (b.down && b.damage > 0);
      this.knockdownRound = goesDown(this.beats.red) || goesDown(this.beats.blue);
      this.fallen = this.beats.red.knockdown || (this.finished && this.beats.red.down) ? 'red' : this.beats.blue.knockdown || (this.finished && this.beats.blue.down) ? 'blue' : null;
      this.finishKind = !this.finished ? null : /^Technical/.test(state?.finishReason ?? '') ? 'tko' : /^Knockout/.test(state?.finishReason ?? '') ? 'ko' : 'decision';
      this.count = 0;
      if (!fresh && state?.events.some(e => e.round === round && e.kind === 'bell')) this.cues.push('bell');
      if (!fresh && this.finished) this.cues.push('finish');
      if (round === 1) this.cues.push('bell');
      if (state?.events.some(e => e.round === round && e.kind === 'bell')) this.bellFlash = 1;
      if (fresh) { this.sinceFinish = 0; for (const side of SIDES) this.rigs[side].reset(); this.place = { ...placement(state) }; }
    }
    this.target = placement(state);
  }
  target = placement(null);

  private updateCount() {
    let n = 0;
    if (this.finished && this.finishKind === 'ko' && this.fallen && this.sinceFinish > 0.9 && this.sinceFinish < 7.2) n = Math.min(10, Math.floor((this.sinceFinish - 0.9) / 0.55) + 1);
    else if (!this.finished && this.knockdownRound && this.p > 0.76) n = Math.min(4, Math.floor((this.p - 0.76) / 0.06) + 1);
    if (n !== this.count) { this.count = n; if (n > 0) this.cues.push('count'); }
  }

  replaying = false;
  /** Plays the latest exchange again in slow motion (the final blow, usually). */
  replay() { this.replaying = true; this.p = 0; this.sinceFinish = 0; this.count = 0; this.rigs.red.reset(); this.rigs.blue.reset(); }

  /** Advances the animation. Returns impacts that happened during this frame. */
  update(dt: number, now: number): FxEvent[] {
    const fx: FxEvent[] = [];
    if (this.queue.length && this.p >= 1 && !this.replaying && this.hold === null) this.applyState(this.queue.shift()!);
    let scale = this.knockdownRound && this.p > 0.3 ? 0.45 : 1;
    if (this.replaying) scale = Math.min(scale, 0.35);
    scale *= 1 + 0.7 * this.queue.length; // catch up when exchanges arrive faster than they can play
    if (now < this.slowUntil) scale = Math.min(scale, 0.12);
    this.timeScale = scale;
    const prev = this.p;
    if (this.hold !== null) this.p = this.hold;
    else if (this.p < 1) this.p = Math.min(1, this.p + dt * scale * this.speed / EXCHANGE_SECONDS);
    this.clock += dt; this.bellFlash = Math.max(0, this.bellFlash - dt * 1.5);
    if (this.replaying && this.p >= 1) this.replaying = false;
    if (this.finished && this.p >= 1 && !this.replaying) this.sinceFinish += dt;
    this.updateCount();
    const k = 1 - Math.exp(-5 * dt);
    this.place.cx += (this.target.cx - this.place.cx) * k; this.place.cz += (this.target.cz - this.place.cz) * k; this.place.separation += (this.target.separation - this.place.separation) * (1 - Math.exp(-9 * dt));
    this.axis += ((this.finished ? 0 : 0.2 * Math.sin(this.clock * 0.23)) - this.axis) * (1 - Math.exp(-1.5 * dt));
    const dx = Math.cos(this.axis), dz = -Math.sin(this.axis), half = this.place.separation / 2;
    this.rigs.red.base.set(this.place.cx - dx * half, 0, this.place.cz - dz * half); this.rigs.red.yaw = this.axis;
    this.rigs.blue.base.set(this.place.cx + dx * half, 0, this.place.cz + dz * half); this.rigs.blue.yaw = this.axis + Math.PI;
    for (const side of SIDES) {
      const me = this.rigs[side], foe = this.rigs[opponent(side)];
      // The opponent's head, expressed in this boxer's baseline root frame (before this frame's lunge and sway).
      const toLocal = (world: Vector3) => world.clone().sub(tmp.set(me.base.x, DIM.hips, me.base.z)).applyAxisAngle(Y, -me.yaw);
      me.tgt = me.compute(this.beats[side], this.p, this.clock, this.round, this.foeActions[side], toLocal(foe.headWorld), toLocal(foe.headRestWorld), this.sinceFinish, this.bellFlash);
      me.step(dt);
    }
    // The referee stands off to the side, closes in on a fallen boxer and counts.
    const mid = tmp.set((this.rigs.red.base.x + this.rigs.blue.base.x) / 2, 0, (this.rigs.red.base.z + this.rigs.blue.base.z) / 2).clone();
    const away = tmp2.set(dz, 0, -dx);
    const near = this.fallen ? this.rigs[this.fallen].base.clone().addScaledVector(away, 0.95).addScaledVector(tmp.set(dx, 0, -dz), this.fallen === 'red' ? 0.55 : -0.55) : mid.clone().addScaledVector(away, 1.9).addScaledVector(tmp.set(dx, 0, -dz), 1.3 * Math.sin(this.clock * 0.22)); // wanders along the far rope, out of the boxers' sight line
    near.x = MathUtils.clamp(near.x, -2.6, 2.6); near.z = MathUtils.clamp(near.z, -2.6, 2.6);
    this.refBase.lerp(near, 1 - Math.exp(-3 * dt));
    this.referee.base.copy(this.refBase); this.referee.yaw = Math.atan2(-(mid.z - this.refBase.z), mid.x - this.refBase.x);
    this.referee.tgt = this.referee.computeReferee(this.clock, this.count > 0, this.count > 0 ? 1 : 0); this.referee.step(dt);
    // Impacts: fire once when a landed or blocked punch reaches its peak.
    for (const side of SIDES) {
      const beat = this.beats[side], tl = TIMELINE[beat.action as Action];
      const swish = tl ? tl.start + (tl.peak - tl.start) * 0.55 : 1;
      if (tl && isPunch(beat.action) && prev < swish && this.p >= swish) this.cues.push('whoosh');
      if (!tl || !isPunch(beat.action) || prev >= tl.peak || this.p < tl.peak) continue;
      if (beat.own !== 'landed' && beat.own !== 'blocked') continue;
      const target = opponent(side), victim = this.beats[target], glove = this.rigs[side].gloveWorld[beat.action === 'JAB' || beat.action === 'HOOK' ? 0 : 1];
      const amount = victim.damage, heavy = victim.knockdown || amount >= 16;
      fx.push({ kind: beat.own === 'landed' ? 'hit' : 'block', target, position: glove.clone(), amount, heavy, knockdown: victim.knockdown });
      if (heavy && beat.own === 'landed') this.slowUntil = now + 0.09;
    }
    return fx;
  }
}
