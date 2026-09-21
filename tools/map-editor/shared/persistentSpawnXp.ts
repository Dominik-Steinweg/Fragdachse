import { resolveCoopDefenseEnemySpawnConfig } from '../../../src/config/coopDefenseEnemies';
import { resolveEnemyLifecycleTotals } from '../../../src/config/coopDefenseEnemyLifecycle';
import { getCoopDefensePersistentSpawnCount } from '../../../src/config/coopDefenseMapAuthoring';
import type { JsonObject } from './json';

/** Same one-player scaling and planning window as the game's XP reference; never normalizes the raw document. */
export function persistentSpawnXp(spawn: JsonObject, durationSec: unknown) {
  const life = resolveEnemyLifecycleTotals(String(spawn.enemyKind));
  const result = { xp: 0, direct: 0, follow: 0, count: 0, complete: false, dynamic: life.dynamic };
  const intervalMs = Number(spawn.intervalMs), countPerTick = Number(spawn.countPerTick), startAtMs = Number(spawn.startAtMs ?? 0);
  if (typeof durationSec !== 'number' || !Number.isInteger(durationSec) || durationSec <= 0
    || !Number.isInteger(intervalMs) || intervalMs <= 0 || !Number.isInteger(countPerTick) || countPerTick <= 0
    || !Number.isInteger(startAtMs) || startAtMs < 0) return result;
  try {
    const resolved = resolveCoopDefenseEnemySpawnConfig(String(spawn.enemyKind), { intervalMs, countPerTick }, 1);
    const count = getCoopDefensePersistentSpawnCount({ ...resolved, startAtMs }, durationSec * 1000);
    return { xp: count * life.xp, direct: count * life.directXp, follow: count * life.followXp, count, complete: life.complete, dynamic: life.dynamic };
  } catch { return result; }
}
