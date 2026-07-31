import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { getCoopDefenseMapUnlockedByVictoryOn } from '../src/config/coopDefenseMapUnlocks';

const ATTACK_MAP_IDS = ['12', '13'] as const;

describe('coop-defense hostile bases', () => {
  it('uses maps 12 and 13 as the only attack maps and ends on map 15', () => {
    expect(COOP_DEFENSE_MAP_CONFIGS.map((map) => map.mapId)).not.toContain('16');
    expect(COOP_DEFENSE_MAP_CONFIGS.at(-1)?.mapId).toBe('15');
    expect(getCoopDefenseMapUnlockedByVictoryOn('15')).toBeNull();
    expect(COOP_DEFENSE_MAP_CONFIGS
      .filter((map) => map.objective === 'destroy-hostile-bases')
      .map((map) => map.mapId)).toEqual(ATTACK_MAP_IDS);
  });

  it('keeps both attack maps winnable through the hostile base and losable through friendly bases', () => {
    for (const mapId of ATTACK_MAP_IDS) {
      const map = getCoopDefenseMapConfig(mapId);
      expect(map.bases.some((base) => base.faction === 'hostile')).toBe(true);
      expect(map.bases.some((base) => base.faction === 'friendly')).toBe(true);
    }
  });

  it('introduces a small turretless 1000-HP hive on map 12', () => {
    const hostile = getCoopDefenseMapConfig('12').bases.find((base) => base.faction === 'hostile');
    expect(hostile?.hpMax).toBe(1000);
    expect(hostile?.shape.kind).toBe('cells');
    expect(hostile?.shape.kind === 'cells' ? hostile.shape.cells : []).toHaveLength(10);
    expect(hostile?.turrets ?? []).toHaveLength(0);
    expect(hostile?.powerUpPedestals ?? []).toHaveLength(0);
  });

  it('uses the original 17-cell footprint, 2000 HP and two spore turrets on map 13', () => {
    const hostile = getCoopDefenseMapConfig('13').bases.find((base) => base.faction === 'hostile');
    expect(hostile?.hpMax).toBe(2000);
    expect(hostile?.shape.kind).toBe('cells');
    expect(hostile?.shape.kind === 'cells' ? hostile.shape.cells : []).toHaveLength(17);
    expect(hostile?.turrets).toHaveLength(2);
    expect(hostile?.turrets?.map((turret) => turret.weaponId)).toEqual(['BASE_SPOREN', 'BASE_SPOREN']);
    expect(hostile?.turrets?.map((turret) => turret.mountSide)).toEqual(['rear', 'rear']);
  });

  it('places hostile bases outside the spawn band and before the defended bases', () => {
    for (const mapId of ATTACK_MAP_IDS) {
      const specs = resolveCoopDefenseBases(getCoopDefenseMapConfig(mapId));
      const hostileCells = specs
        .filter((spec) => spec.faction === 'hostile')
        .flatMap((spec) => spec.cells);
      const friendlyCells = specs
        .filter((spec) => spec.faction === 'friendly')
        .flatMap((spec) => spec.cells);

      expect(Math.min(...hostileCells.map((cell) => cell.gridX))).toBeGreaterThan(6);
      expect(Math.max(...hostileCells.map((cell) => cell.gridX)))
        .toBeLessThan(Math.min(...friendlyCells.map((cell) => cell.gridX)));
    }
  });

  it('carries every configured base faction through to the resolved spec', () => {
    for (const mapConfig of COOP_DEFENSE_MAP_CONFIGS) {
      const specs = resolveCoopDefenseBases(mapConfig);
      for (const spec of specs) {
        expect(spec.faction).toBe(mapConfig.bases.find((base) => base.id === spec.id)?.faction);
      }
    }
  });
});
