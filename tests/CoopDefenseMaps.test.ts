import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig,
  type CoopBaseShape,
} from '../src/config/coopDefenseMaps';
import { getCoopDefenseEnemyConfig, getCoopDefenseEnemyXp } from '../src/config/coopDefenseEnemies';
import { shouldDelayFirstPedestalSpawn } from '../src/powerups/PowerUpConfig';

function getShapeBounds(shape: CoopBaseShape): { width: number; height: number } {
  if (shape.kind === 'rectangle') return { width: shape.widthCells, height: shape.heightCells };
  return {
    width: Math.max(...shape.cells.map((cell) => cell.gridX)) + 1,
    height: Math.max(...shape.cells.map((cell) => cell.gridY)) + 1,
  };
}

function expectedRespawnMs(defId: string): number {
  if (defId === 'HEALTH_PACK') return 5_000;
  if (defId === 'ARMOR' || defId === 'ADRENALINE') return 10_000;
  if (defId === 'DOUBLE_DAMAGE') return 20_000;
  return 30_000;
}

function getTheoreticalMapXp(mapId: string): number {
  const map = getCoopDefenseMapConfig(mapId);
  const durationMs = map.roundDurationSec * 1_000;
  const waveXp = map.waves.reduce((sum, wave) => {
    const activeMs = Math.max(0, durationMs - (wave.startAtMs ?? 0));
    const waveCount = 1 + Math.floor(activeMs / wave.intervalMs);
    return sum + waveCount * wave.countPerWave * getCoopDefenseEnemyXp(wave.enemyKind);
  }, 0);
  return waveXp + (map.boss ? getCoopDefenseEnemyXp(map.boss.enemyKind) : 0);
}

describe('Coop defense map progression', () => {
  it('keeps map metadata usable after balancing and terminology changes', () => {
    const playableMaps = COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0');
    const displayNames = playableMaps.map((map) => map.displayName.trim());

    expect(displayNames.every((name) => name.length > 0)).toBe(true);
    expect(new Set(displayNames).size).toBe(displayNames.length);
    for (const map of playableMaps) {
      expect(map.roundDurationSec).toBeGreaterThan(0);
      if (map.tutorialText !== undefined) {
        expect(map.tutorialText.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('calculates finite XP for every playable map without fixing balancing values', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      const theoreticalXp = getTheoreticalMapXp(map.mapId);
      expect(Number.isFinite(theoreticalXp)).toBe(true);
      expect(theoreticalXp).toBeGreaterThan(0);
    }
  });

  it('uses valid visual footprints for every base', () => {
    for (const base of COOP_DEFENSE_MAP_CONFIGS
      .filter(({ mapId }) => mapId !== '0')
      .flatMap((map) => map.bases)) {
      const bounds = getShapeBounds(base.shape);
      expect(base.hpMax).toBeGreaterThan(0);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
      for (const turret of base.turrets ?? []) {
        expect(turret.cellOffset.gridX).toBeGreaterThanOrEqual(0);
        expect(turret.cellOffset.gridX).toBeLessThan(bounds.width);
        expect(turret.cellOffset.gridY).toBeGreaterThanOrEqual(0);
        expect(turret.cellOffset.gridY).toBeLessThan(bounds.height);
      }
    }
  });

  it('builds linked power-up bases symmetrically around open pedestal cells', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      for (const base of map.bases) {
        const pedestals = base.powerUpPedestals ?? [];
        if (pedestals.length === 0) continue;
        expect(base.shape.kind).toBe('cells');
        const bounds = getShapeBounds(base.shape);
        const cells = base.shape.kind === 'cells' ? base.shape.cells : [];
        const occupied = new Set(cells.map((cell) => `${cell.gridX}:${cell.gridY}`));
        for (const pedestal of pedestals) {
          expect(pedestal.cellOffset.gridX).toBeGreaterThanOrEqual(0);
          expect(pedestal.cellOffset.gridX).toBeLessThan(bounds.width);
          expect(pedestal.cellOffset.gridY).toBeGreaterThanOrEqual(0);
          expect(pedestal.cellOffset.gridY).toBeLessThan(bounds.height);
          expect(occupied.has(`${pedestal.cellOffset.gridX}:${pedestal.cellOffset.gridY}`)).toBe(false);
        }
        for (const cell of cells) {
          expect(occupied.has(`${cell.gridX}:${bounds.height - 1 - cell.gridY}`)).toBe(true);
        }
      }
    }
  });

  it('centers single turrets vertically on their base footprints', () => {
    const singleTurretBases = COOP_DEFENSE_MAP_CONFIGS.flatMap((map) => map.bases)
      .filter((base) => (base.turrets?.length ?? 0) === 1);
    expect(singleTurretBases.length).toBeGreaterThan(0);
    for (const base of singleTurretBases) {
      const { height } = getShapeBounds(base.shape);
      expect(base.turrets?.[0].cellOffset.gridY).toBe(Math.floor(height / 2));
    }
  });

  it('uses known enemies and valid spawn settings for every wave and boss', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      for (const wave of map.waves) {
        expect(() => getCoopDefenseEnemyConfig(wave.enemyKind)).not.toThrow();
        expect(wave.intervalMs).toBeGreaterThan(0);
        expect(wave.countPerWave).toBeGreaterThan(0);
        expect(wave.startAtMs ?? 0).toBeGreaterThanOrEqual(0);
      }
      if (map.boss) {
        expect(getCoopDefenseEnemyConfig(map.boss.enemyKind).isBoss).toBe(true);
        expect(map.boss.spawnAtMs).toBeGreaterThanOrEqual(0);
        expect(map.boss.spawnAtMs).toBeLessThan(map.roundDurationSec * 1_000);
      }
    }
  });

  it('embeds health, adrenaline, and armor pickups in the enlarged rear bases of maps 6 and 8', () => {
    for (const mapId of ['6', '8']) {
      const rearBase = getCoopDefenseMapConfig(mapId).bases.find((base) => base.id === 'coop-base-rear');
      expect(rearBase).toBeDefined();
      expect(getShapeBounds(rearBase!.shape)).toEqual({ width: 4, height: 5 });
      expect(rearBase!.powerUpPedestals?.map((pedestal) => pedestal.defId)).toEqual([
        'HEALTH_PACK',
        'ADRENALINE',
        'ARMOR',
      ]);
    }
  });

  it('uses standardized cooldowns and delays the first strong pedestal spawn', () => {
    for (const map of COOP_DEFENSE_MAP_CONFIGS.filter(({ mapId }) => mapId !== '0')) {
      const freePowerUps = map.powerUps;
      const linkedPowerUps = map.bases.flatMap((base) => base.powerUpPedestals ?? []);
      for (const powerUp of [...freePowerUps, ...linkedPowerUps]) {
        expect(powerUp.spawnOnArenaStart).toBe(!shouldDelayFirstPedestalSpawn(powerUp.defId));
        expect(powerUp.respawnMs).toBe(expectedRespawnMs(powerUp.defId));
      }
    }
  });
});
