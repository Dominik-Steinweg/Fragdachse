import { plasmaBurnerTargetEffect, type PlasmaBurnerTarget } from './PlasmaBurnerTargetPolicy';

export function resolvePlasmaBurnerChain(options: {
  primary: PlasmaBurnerTarget;
  previous: readonly string[];
  maxJumps: number;
  radius: number;
  read(key: string, from: PlasmaBurnerTarget): PlasmaBurnerTarget | null;
  candidates(from: PlasmaBurnerTarget): readonly PlasmaBurnerTarget[];
  visible(from: PlasmaBurnerTarget, to: PlasmaBurnerTarget): boolean;
}): PlasmaBurnerTarget[] {
  if (options.primary.category === 'environment') return [];
  const result: PlasmaBurnerTarget[] = [];
  const visited = new Set([options.primary.key]);
  let from = options.primary;
  let retain = true;
  for (let i = 0; i < options.maxJumps; i++) {
    const valid = (t: PlasmaBurnerTarget | null): t is PlasmaBurnerTarget => !!t
      && !visited.has(t.key) && plasmaBurnerTargetEffect(t, 'automatic') !== null
      && Math.hypot(t.x - from.x, t.y - from.y) <= options.radius && options.visible(from, t);
    let next = retain && options.previous[i] ? options.read(options.previous[i], from) : null;
    if (!valid(next)) {
      retain = false;
      next = [...options.candidates(from)].sort((a, b) =>
        Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y)
        || a.key.localeCompare(b.key)).find(valid) ?? null;
    }
    if (!next) break;
    result.push(next); visited.add(next.key); from = next;
  }
  return result;
}
