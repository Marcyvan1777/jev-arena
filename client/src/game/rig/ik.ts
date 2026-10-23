import { Vector3 } from 'three';

const scratch = new Vector3(), side = new Vector3();

/**
 * Two-bone inverse kinematics (shoulder -> elbow -> wrist, or hip -> knee -> ankle).
 * Given the root joint, a target for the end joint and a pole vector hinting which way the middle joint bends,
 * it writes the middle joint into `mid` and the reachable end joint into `end`.
 */
export function solveTwoBone(root: Vector3, target: Vector3, upper: number, lower: number, pole: Vector3, mid: Vector3, end: Vector3) {
  scratch.subVectors(target, root);
  const reach = upper + lower - 1e-4, near = Math.abs(upper - lower) + 1e-3;
  const distance = Math.min(reach, Math.max(near, scratch.length() || near));
  scratch.normalize();
  if (!Number.isFinite(scratch.x)) scratch.set(1, 0, 0);
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  // Bend direction: the part of the pole vector perpendicular to the shoulder-to-target line.
  side.copy(pole).addScaledVector(scratch, -pole.dot(scratch));
  if (side.lengthSq() < 1e-8) side.set(0, -1, 0).addScaledVector(scratch, scratch.y);
  side.normalize();
  mid.copy(root).addScaledVector(scratch, along).addScaledVector(side, height);
  end.copy(root).addScaledVector(scratch, distance);
}
