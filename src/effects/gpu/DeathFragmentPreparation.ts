import { getWalkingSheetForStaticTexture, WALKING_IDLE_FRAME } from '../../animations/BadgerAnimations';
import { getCoopDefenseEnemyConfig } from '../../config/coopDefenseEnemies';
import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import type { DeathFragmentFrame } from './DeathFragmentTemplateCache';

/** Only figures reachable in this world, including descendants and resurrected allies. */
export function collectDeathFragmentFrames(map: CoopDefenseMapConfig | null): DeathFragmentFrame[] {
  const textures = new Set<string>(['badger']);
  const kinds = new Set<string>();
  const visit = (kind: string): void => {
    if (kinds.has(kind)) return;
    kinds.add(kind);
    const config = getCoopDefenseEnemyConfig(kind);
    textures.add(config.imageKey);
    for (const spawn of config.deathSpawns ?? []) visit(spawn.enemyKind);
    if (config.spawnThrow) visit(config.spawnThrow.enemyKind);
  };
  for (const encounter of map?.encounters ?? []) {
    for (const group of encounter.groups) visit(group.enemyKind);
  }
  for (const spawn of map?.persistentSpawns ?? []) visit(spawn.enemyKind);
  if (map?.boss) visit(map.boss.enemyKind);
  // DecoyEntity uses the static player image even while PlayerEntity uses its walking sheet.
  const frames: DeathFragmentFrame[] = [{ textureKey: 'badger' }];
  for (const textureKey of textures) {
    const sheet = getWalkingSheetForStaticTexture(textureKey);
    if (sheet) {
      for (const frame of new Set([WALKING_IDLE_FRAME, ...sheet.frames])) {
        frames.push({ textureKey: sheet.textureKey, frame });
      }
    } else if (textureKey !== 'badger') frames.push({ textureKey });
  }
  return frames;
}
