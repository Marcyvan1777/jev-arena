import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { DEFAULT_CONFIG } from '../shared/rules.js';
import { SIDES } from '../shared/types.js';
import type { Action, Battlefield } from '../shared/types.js';
import { createBattle, resolveTurn } from '../server/src/game/engine.js';
import { demoDecision } from '../server/src/ai/demoDecisionEngine.js';
import { solveTwoBone } from '../client/src/game/rig/ik.js';
import { beatsFor } from '../client/src/game/rig/beats.js';
import { DIM, FightRig, TIMELINE } from '../client/src/game/rig/rig.js';

const bout = (seed: number, patch?: (state: Battlefield) => void) => { const state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed }); patch?.(state); return state; };
/** First seed whose exchange satisfies `want`, so each test pins a specific outcome of the seeded dice. */
function find(red: Action, blue: Action, want: (next: Battlefield) => boolean, patch?: (state: Battlefield) => void) {
  for (let seed = 1; seed < 600; seed++) { const next = resolveTurn(bout(seed, patch), { red, blue }); if (want(next)) return next; }
  throw new Error(`no seed for ${red} v ${blue}`);
}
/** Plays one exchange on a rig frame by frame and returns the impacts and how close the gloves came. */
function play(state: Battlefield, seconds = 1.4) {
  const rig = new FightRig(); rig.setState(createBattle(state.config), 1); rig.update(1 / 60, 0); rig.setState(state, 1);
  const fx: ReturnType<FightRig['update']> = [], samples: Array<{ p: number; reach: number; foeHeadPitch: number; foeFall: number; foeY: number }> = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    fx.push(...rig.update(1 / 60, i / 60));
    const reach = Math.min(...[0, 1].map(g => rig.rigs.red.gloveWorld[g].distanceTo(rig.rigs.blue.headWorld)));
    samples.push({ p: rig.p, reach, foeHeadPitch: rig.rigs.blue.cur.headPitch, foeFall: rig.rigs.blue.cur.fall, foeY: rig.rigs.blue.rootWorld.y });
  }
  return { rig, fx, samples };
}

describe('two-bone IK', () => {
  it('keeps both bone lengths and reaches a reachable target', () => {
    const mid = new Vector3(), end = new Vector3(), root = new Vector3(0, 1, 0), target = new Vector3(0.4, 1.2, 0.2);
    solveTwoBone(root, target, DIM.upperArm, DIM.foreArm, new Vector3(0, -1, 0), mid, end);
    expect(mid.distanceTo(root)).toBeCloseTo(DIM.upperArm, 4); expect(end.distanceTo(mid)).toBeCloseTo(DIM.foreArm, 4); expect(end.distanceTo(target)).toBeLessThan(1e-4);
  });
  it('stretches toward, but never beyond, an unreachable target and survives a degenerate pole', () => {
    const mid = new Vector3(), end = new Vector3();
    solveTwoBone(new Vector3(), new Vector3(5, 0, 0), DIM.upperArm, DIM.foreArm, new Vector3(1, 0, 0), mid, end);
    expect(end.length()).toBeLessThanOrEqual(DIM.upperArm + DIM.foreArm); expect(Number.isFinite(mid.x + mid.y + mid.z)).toBe(true);
  });
});

describe('beats read from the authoritative event log', () => {
  it('marks a trade of clean jabs, a blocked punch and a slipped punch', () => {
    const trade = beatsFor(find('JAB', 'JAB', n => n.events.filter(e => e.kind === 'hit').length === 2));
    expect(trade.red.own).toBe('landed'); expect(trade.blue.hitBy).toBe('JAB'); expect(trade.blue.damage).toBeGreaterThan(0);
    const block = beatsFor(find('HOOK', 'GUARD', n => n.events.some(e => e.kind === 'block')));
    expect(block.red.own).toBe('blocked'); expect(block.blue.guarded).toBe(true);
    const slip = beatsFor(find('JAB', 'SLIP', n => n.events.some(e => e.kind === 'dodge')));
    expect(slip.red.own).toBe('slipped'); expect(slip.blue.dodged).toBe(true);
  });
  it('flags a knockdown without leaving the boxer down, and a stoppage as down', () => {
    const knockdown = find('UPPERCUT', 'JAB', n => n.events.some(e => e.kind === 'knockdown' && e.target === 'blue') && n.status === 'active', s => { s.robots.blue.hp = 60; });
    const beats = beatsFor(knockdown); expect(beats.blue.knockdown).toBe(true); expect(beats.blue.down).toBe(false);
    const ko = beatsFor(find('UPPERCUT', 'JAB', n => n.status === 'finished' && n.winner === 'red', s => { s.robots.blue.hp = 6; }));
    expect(ko.blue.down).toBe(true); expect(ko.red.won).toBe(true); expect(ko.blue.lost).toBe(true);
  });
});

describe('fight choreography', () => {
  it('delivers one clean-hit impact, with the glove arriving at the opponent head and the head snapping back', () => {
    const state = find('CROSS', 'JAB', n => n.events.some(e => e.kind === 'hit' && e.actor === 'red') && !n.events.some(e => e.kind === 'hit' && e.actor === 'blue'));
    const { fx, samples } = play(state);
    expect(fx.filter(e => e.kind === 'hit')).toHaveLength(1);
    const contact = samples.filter(s => Math.abs(s.p - TIMELINE.CROSS!.peak) < 0.04);
    expect(Math.min(...contact.map(s => s.reach))).toBeLessThan(0.5);
    expect(Math.min(...samples.map(s => s.foeHeadPitch))).toBeLessThan(0.05);
  });
  it('drops a knocked-down boxer to the canvas and gets them back up before the next exchange', () => {
    const state = find('UPPERCUT', 'JAB', n => n.events.some(e => e.kind === 'knockdown' && e.target === 'blue') && n.status === 'active', s => { s.robots.blue.hp = 60; });
    const { samples } = play(state, 2.6), fall = samples.map(s => s.foeFall);
    expect(Math.max(...fall)).toBeGreaterThan(0.85); expect(fall.at(-1)!).toBeLessThan(0.2);
    expect(Math.min(...samples.map(s => s.foeY))).toBeLessThan(0.45);
  });
  it('leaves a stopped boxer down and has the winner raise both gloves above the head', () => {
    const state = find('UPPERCUT', 'JAB', n => n.status === 'finished' && n.winner === 'red', s => { s.robots.blue.hp = 6; });
    const { rig } = play(state, 4);
    expect(rig.rigs.blue.cur.fall).toBeGreaterThan(0.95);
    for (const glove of rig.rigs.red.gloveWorld) expect(glove.y).toBeGreaterThan(rig.rigs.red.headWorld.y);
  });
  it('stays finite, inside the ring and above the canvas through a whole demo bout', async () => {
    let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 11 }); const rig = new FightRig(); rig.setState(state, 4);
    const context = { signal: new AbortController().signal, maxCalls: 0, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 } };
    let now = 0;
    while (state.status !== 'finished') {
      const [red, blue] = await Promise.all(SIDES.map(side => demoDecision(state, side, context)));
      state = resolveTurn(state, { red: red.action, blue: blue.action }, [red, blue]); rig.setState(state, 4);
      for (let i = 0; i < 18; i++, now += 1 / 60) {
        rig.update(1 / 60, now);
        for (const side of SIDES) {
          const r = rig.rigs[side];
          expect(Object.values(r.cur).every(Number.isFinite)).toBe(true);
          expect(Math.abs(r.rootWorld.x)).toBeLessThan(3); expect(Math.abs(r.rootWorld.z)).toBeLessThan(3); expect(r.rootWorld.y).toBeGreaterThan(0.15);
          for (const joint of [...r.geometry.elbow, ...r.geometry.wrist, ...r.geometry.knee, ...r.geometry.ankle]) expect(Number.isFinite(joint.x + joint.y + joint.z)).toBe(true);
        }
      }
    }
  }, 30000);
});

describe('animation fluidity', () => {
  it('never teleports a hand, foot, head or hip between frames across a whole bout', async () => {
    let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 5 }); const rig = new FightRig(); rig.setState(state, 1);
    const context = { signal: new AbortController().signal, maxCalls: 0, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 } };
    const previous = new Map<string, Vector3>(); let worst = 0, frames = 0, now = 0, culprit = '';
    const track = (key: string, point: Vector3) => { const last = previous.get(key); if (last && frames > 5 && last.distanceTo(point) > worst) { worst = last.distanceTo(point); culprit = `${key} frame ${frames} round ${rig.round} p ${rig.p.toFixed(2)}`; } previous.set(key, point.clone()); };
    const frame = () => { rig.update(1 / 60, now); now += 1 / 60; frames++; for (const side of SIDES) { const r = rig.rigs[side]; track(side + 'g0', r.gloveWorld[0]); track(side + 'g1', r.gloveWorld[1]); track(side + 'h', r.headWorld); track(side + 'root', r.rootWorld); } };
    while (state.status !== 'finished') {
      const [red, blue] = await Promise.all(SIDES.map(side => demoDecision(state, side, context)));
      state = resolveTurn(state, { red: red.action, blue: blue.action }, [red, blue]); rig.setState(state, 1);
      for (let i = 0; i < 60 * 4 && (i === 0 || rig.p < 1); i++) frame(); // play the exchange to its end, as the game does at 1x
    }
    for (let i = 0; i < 180; i++) frame();
    // Under 0.15 m per 1/60 s frame (9 m/s). A fast punch is about 0.1; a pop or teleport is 0.25 and more.
    expect(worst, culprit).toBeLessThan(0.15);
  }, 30000);
  it('plays queued exchanges in order instead of cutting one short', () => {
    let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 9 }); const rig = new FightRig(); rig.setState(state, 1); rig.update(1 / 60, 0);
    for (let i = 0; i < 3; i++) { state = resolveTurn(state, { red: 'GUARD', blue: 'GUARD' }); rig.setState(state, 1); }
    expect(rig.round).toBe(1);
    const seen = new Set<number>(); for (let i = 0; i < 600; i++) { rig.update(1 / 60, i / 60); seen.add(rig.round); }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });
});

describe('moving like a real boxer', () => {
  it('plants the feet and takes real steps instead of sliding along with the body', async () => {
    let state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 21 }); const rig = new FightRig(); rig.setState(state, 1);
    const context = { signal: new AbortController().signal, maxCalls: 0, usage: { apiCalls: 0, completedDecisions: 0, failedDecisions: 0, totalLatencyMs: 0 } };
    const last = [new Vector3(), new Vector3()]; let frames = 0, planted = 0, bothMoving = 0, swings = 0, wasMoving = [false, false], farthest = 0, now = 0;
    const frame = () => {
      rig.update(1 / 60, now); now += 1 / 60; frames++;
      const r = rig.rigs.red, moving = [0, 1].map(i => r.footWorld[i].distanceTo(last[i]) > 0.004);
      if (frames > 30) { for (let i = 0; i < 2; i++) { if (!moving[i]) planted++; if (moving[i] && !wasMoving[i]) swings++; } if (moving[0] && moving[1]) bothMoving++; }
      wasMoving = moving; for (let i = 0; i < 2; i++) { last[i].copy(r.footWorld[i]); farthest = Math.max(farthest, Math.hypot(r.footWorld[i].x - r.rootWorld.x, r.footWorld[i].z - r.rootWorld.z)); }
    };
    while (state.status !== 'finished') {
      const [red, blue] = await Promise.all(SIDES.map(side => demoDecision(state, side, context)));
      state = resolveTurn(state, { red: red.action, blue: blue.action }, [red, blue]); rig.setState(state, 1);
      for (let i = 0; i < 60 * 4 && (i === 0 || rig.p < 1); i++) frame();
    }
    const total = (frames - 30) * 2;
    expect(planted / total, 'feet stay put most of the time').toBeGreaterThan(0.6);
    expect(swings, 'and they do step now and then').toBeGreaterThan(4);
    expect(bothMoving / (frames - 30), 'one foot moves while the other holds the weight').toBeLessThan(0.15);
    expect(farthest, 'a foot is never left behind out of reach').toBeLessThan(0.95);
  }, 30000);
  it('turns the hips before the arm arrives, so a punch starts from the ground up', () => {
    const state = find('CROSS', 'GUARD', n => n.events.some(e => e.actor === 'red' && (e.kind === 'hit' || e.kind === 'block')), s => { s.robots.blue.hp = 170; });
    const rig = new FightRig(); rig.setState(createBattle(state.config), 1); rig.update(1 / 60, 0); rig.setState(state, 1);
    let hipPeak = 0, hipAt = 0, armPeak = 0, armAt = 0;
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 60, i / 60); const red = rig.rigs.red, hip = red.cur.hipYaw, arm = red.gloveWorld[1].x - red.rootWorld.x;
      if (hip > hipPeak) { hipPeak = hip; hipAt = i; } if (arm > armPeak) { armPeak = arm; armAt = i; }
    }
    expect(hipAt).toBeLessThanOrEqual(armAt);
  });
  it('shows tiredness and hurt: the guard sinks and the head wobbles', () => {
    const settle = (tweak: (s: ReturnType<typeof createBattle>) => void) => {
      const state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 3 }); tweak(state);
      const rig = new FightRig(); rig.setState(state, 1); for (let i = 0; i < 90; i++) rig.update(1 / 60, i / 60); return rig.rigs.red;
    };
    const fresh = settle(() => undefined), tired = settle(s => { s.robots.red.stamina = 4; });
    expect(tired.cur.lgy).toBeLessThan(fresh.cur.lgy - 0.05); expect(tired.cur.drop).toBeGreaterThan(fresh.cur.drop);
    const hurt = settle(s => { s.robots.red.hp = 20; }); expect(hurt.cur.headPitch).toBeGreaterThan(fresh.cur.headPitch + 0.1);
  });
  it('gives each personality its own way of carrying itself, without touching the rules', () => {
    const stance = (p: 'BERSERKER' | 'COWARD' | 'TRICKSTER') => {
      const state = createBattle({ ...DEFAULT_CONFIG, mode: 'demo', seed: 3, red: { name: 'A', personality: p } });
      const rig = new FightRig(); rig.setState(state, 1); for (let i = 0; i < 90; i++) rig.update(1 / 60, i / 60); return rig.rigs.red.cur;
    };
    const berserker = stance('BERSERKER'), coward = stance('COWARD'), trickster = stance('TRICKSTER');
    expect(berserker.chestPitch).toBeGreaterThan(coward.chestPitch + 0.1); expect(coward.drop).toBeGreaterThan(berserker.drop);
    expect(coward.lgy).toBeGreaterThan(trickster.lgy); // the coward's hands are up, the trickster's are low
  });
});
