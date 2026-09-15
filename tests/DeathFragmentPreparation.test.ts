import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { collectDeathFragmentFrames } from '../src/effects/gpu/DeathFragmentPreparation';
import { getWalkingSheetForStaticTexture, WALKING_IDLE_FRAME } from '../src/animations/BadgerAnimations';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../src/config/coopDefenseEnemies';
import { COOP_DEFENSE_MAP_CONFIGS } from '../src/config/coopDefenseMaps';

describe('death fragment working set', () => {
  it('includes static decoys and every player locomotion frame without unrelated graphics', () => {
    const frames = collectDeathFragmentFrames(null);
    const player = getWalkingSheetForStaticTexture('badger')!;
    expect(frames).toContainEqual({ textureKey: 'badger' });
    expect(frames.filter(frame => frame.textureKey === player.textureKey).map(frame => frame.frame).sort())
      .toEqual([...new Set([WALKING_IDLE_FRAME, ...player.frames])].sort());
    expect(frames.every(frame => ['badger', player.textureKey].includes(frame.textureKey))).toBe(true);
  });

  it('covers encounters, persistent sources, bosses and recursive spawn descendants', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS) {
      const frames = collectDeathFragmentFrames(map);
      const seen = new Set<string>();
      const visit = (kind: string): void => {
        if (seen.has(kind)) return;
        seen.add(kind);
        const config = COOP_DEFENSE_ENEMY_CONFIGS[kind];
        const sheet = getWalkingSheetForStaticTexture(config.imageKey);
        if (sheet) {
          for (const frame of [WALKING_IDLE_FRAME, ...sheet.frames]) {
            expect(frames).toContainEqual({ textureKey: sheet.textureKey, frame });
          }
        } else expect(frames).toContainEqual({ textureKey: config.imageKey });
        config.deathSpawns?.forEach(spawn => visit(spawn.enemyKind));
        if (config.spawnThrow) visit(config.spawnThrow.enemyKind);
      };
      map.encounters?.forEach(encounter => encounter.groups.forEach(group => visit(group.enemyKind)));
      map.persistentSpawns?.forEach(spawn => visit(spawn.enemyKind));
      if (map.boss) visit(map.boss.enemyKind);
      expect(new Set(frames.map(frame => `${frame.textureKey}/${frame.frame}`)).size).toBe(frames.length);
    }
  });
});
