import { ARENA } from '../../../shared/rules.js';
import type { Obstacle, Point } from '../../../shared/types.js';

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (p: Point, n: number): Point => ({ x: p.x * n, y: p.y * n });
export function direction(a: Point, b: Point): Point {
  const d = distance(a, b) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
export function inBounds(p: Point) {
  return p.x >= ARENA.radius && p.y >= ARENA.radius && p.x <= ARENA.width - ARENA.radius && p.y <= ARENA.height - ARENA.radius;
}
// Slab intersection includes the whole swept segment, preventing tunnelling.
export function intersects(a: Point, b: Point, o: Obstacle, margin = 0): boolean {
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, o.x - margin, o.x + o.w + margin],
    [a.y, b.y - a.y, o.y - margin, o.y + o.h + margin],
  ]) {
    if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return false; }
    else {
      const t1 = (min - start) / delta, t2 = (max - start) / delta;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
      if (lo > hi) return false;
    }
  }
  return true;
}
export const clearLine = (a: Point, b: Point, obstacles: Obstacle[], margin = 0) => !obstacles.some(o => intersects(a, b, o, margin));
export const canMove = (a: Point, b: Point, obstacles: Obstacle[]) => inBounds(b) && clearLine(a, b, obstacles, ARENA.radius);

// Tiny visibility graph: shortest route via expanded obstacle corners.
export function approachDestination(start: Point, target: Point, obstacles: Obstacle[], speed: number): Point {
  const pad = ARENA.radius + 0.04;
  const nodes = [start, target, ...obstacles.flatMap(o => [
    { x: o.x - pad, y: o.y - pad }, { x: o.x + o.w + pad, y: o.y - pad },
    { x: o.x - pad, y: o.y + o.h + pad }, { x: o.x + o.w + pad, y: o.y + o.h + pad },
  ]).filter(inBounds)];
  const costs = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = new Set<number>();
  costs[0] = 0;
  while (done.size < nodes.length) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done.has(i) && (u < 0 || costs[i] < costs[u])) u = i;
    if (u < 0 || !Number.isFinite(costs[u])) break;
    if (u === 1) break;
    done.add(u);
    for (let v = 0; v < nodes.length; v++) {
      if (done.has(v) || !clearLine(nodes[u], nodes[v], obstacles, ARENA.radius)) continue;
      const cost = costs[u] + distance(nodes[u], nodes[v]);
      if (cost < costs[v]) { costs[v] = cost; prev[v] = u; }
    }
  }
  if (prev[1] < 0) return start;
  let next = 1;
  while (prev[next] > 0) next = prev[next];
  // Reserve half the closing distance so two simultaneous approaches cannot deadlock.
  const amount = Math.min(speed, distance(start, nodes[next]), Math.max(0, (distance(start, target) - 1.05) / 2));
  return add(start, scale(direction(start, nodes[next]), amount));
}
export function pathsCollide(a: Point, a2: Point, b: Point, b2: Point): boolean {
  const p = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: (a2.x - a.x) - (b2.x - b.x), y: (a2.y - a.y) - (b2.y - b.y) };
  const norm = v.x * v.x + v.y * v.y;
  const t = norm ? Math.max(0, Math.min(1, -(p.x * v.x + p.y * v.y) / norm)) : 0;
  return Math.hypot(p.x + v.x * t, p.y + v.y * t) < ARENA.radius * 2;
}
