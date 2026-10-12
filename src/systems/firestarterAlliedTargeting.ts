import type { EnemyAiTargetCatalog } from './EnemyAiTargetCatalog';

interface Point { readonly x: number; readonly y: number }

/** Allies prefer real hostile positions in a group; hostile shooters retain nearest-player aim.
 * Range and weapon-specific corridor checks remain with the attack planner. */
export function getFirestarterFactionTargets(
  source: { readonly faction: 'hostile' | 'allied'; readonly sprite: Point },
  catalog: Pick<EnemyAiTargetCatalog, 'getCandidates' | 'getPosition'>,
  groupRadius: number,
): Point[] {
  const points = catalog.getCandidates(source.faction === 'allied' ? 'hostile-enemies' : 'players')
    .flatMap(target => {
      const point = catalog.getPosition(target, source.sprite.x, source.sprite.y);
      return point ? [{ ...point, id: target.id }] : [];
    });
  const ranked = points.map(point => ({ point, distance: Math.hypot(point.x - source.sprite.x, point.y - source.sprite.y),
    density: source.faction === 'allied'
      ? points.filter(other => Math.hypot(other.x - point.x, other.y - point.y) <= groupRadius).length : 0 }));
  return ranked.sort((a, b) => b.density - a.density || a.distance - b.distance || a.point.id.localeCompare(b.point.id))
    .map(({ point }) => ({ x: point.x, y: point.y }));
}
