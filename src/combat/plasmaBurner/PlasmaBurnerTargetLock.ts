import { plasmaBurnerTargetEffect, type PlasmaBurnerTarget } from './PlasmaBurnerTargetPolicy';

/** Direct targeting is resolved before this predicate, including healthy friendly targets. */
export function canHoldPlasmaBurnerLock(target: PlasmaBurnerTarget | null, options: {
  x: number; y: number; angle: number; range: number; toleranceDegrees: number;
  firstTargetAt(angle: number): string | null;
}): target is PlasmaBurnerTarget {
  if (!target || options.toleranceDegrees <= 0 || plasmaBurnerTargetEffect(target, 'automatic') === null) return false;
  const angle = Math.atan2(target.y - options.y, target.x - options.x);
  const delta = Math.atan2(Math.sin(angle - options.angle), Math.cos(angle - options.angle));
  return Math.hypot(target.x - options.x, target.y - options.y) <= options.range
    && Math.abs(delta) <= options.toleranceDegrees * Math.PI / 180 + 1e-9
    && options.firstTargetAt(angle) === target.key;
}
