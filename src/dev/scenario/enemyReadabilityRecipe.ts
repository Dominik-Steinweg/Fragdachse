import type { CoopDefenseEnemyKind } from '../../config/coopDefenseEnemies';
import { defaultScenario } from './config';

/** Fixed Map 1 / seed 12345 framing; requested cells are retained even on rock for the visual probe. */
export const ENEMY_READABILITY_PLACEMENTS: readonly {
  kind: CoopDefenseEnemyKind; gridX: number; gridY: number; background: string;
}[] = [
  { kind: 'zombie-badger', gridX: 20, gridY: 24, background: 'open meadow' },
  { kind: 'demon-badger', gridX: 31, gridY: 23, background: 'soil path' },
  { kind: 'rabid-badger', gridX: 20, gridY: 27, background: 'ground foliage' },
  { kind: 'grave-titan', gridX: 23, gridY: 14, background: 'rock' },
  { kind: 'spore-warden', gridX: 31, gridY: 19, background: 'canopy' },
  { kind: 'plague-medic', gridX: 28, gridY: 17, background: 'rock edge / shade' },
  { kind: 'void-stalker', gridX: 37, gridY: 18, background: 'open clearing' },
  { kind: 'stink-broodmother', gridX: 35, gridY: 25, background: 'mixed foliage / rock' },
];

/** The real railway ballast is far east of the woodland framing: a second camera station. */
export function enemyReadabilityPlacements(surface: 'woodland' | 'gravel') {
  return surface === 'woodland' ? ENEMY_READABILITY_PLACEMENTS
    : ENEMY_READABILITY_PLACEMENTS.map((p, i) => ({ ...p, gridX: 130.4, gridY: 14 + i * 2, background: 'railway ballast' }));
}

export function enemyReadabilityScenario(timeOfDay = 720) {
  return { ...defaultScenario(), mapId: '1', seed: 12345, timeOfDay,
    player: { gridX: 27, gridY: 28 }, hideAim: true };
}
