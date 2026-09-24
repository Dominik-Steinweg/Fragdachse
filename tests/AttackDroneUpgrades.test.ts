import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseResolvedEffectTotals, sanitizeCoopDefenseUpgradeProfile } from '../src/utils/coopDefenseUpgrades';
import { resolveAttackDroneStats } from '../src/config/attackDrone';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { sanitizePersistentConstructions } from '../src/persistentBase/PersistentBaseTypes';

const ids=['unlock_attack_drone_station','attack_drone_self_loader','attack_drone_service','attack_drone_flight',
  'attack_drone_penetration','attack_drone_bomb_bay','attack_drone_bomb_count','attack_drone_fire_chunks'];
describe('attack drone content and persistence',()=>{
  it('requires both level-one branches and spends a boss point only on the bomb bay',()=>{
    const boss=getCoopDefenseUpgradeDefinition('attack_drone_bomb_bay')!;
    expect(boss.requires).toEqual([{upgradeId:'attack_drone_service',minLevel:1},{upgradeId:'attack_drone_penetration',minLevel:1}]);
    expect(boss.costPerLevel).toBe(0);expect(boss.bossPointCostPerLevel).toBe(1);
    for(const id of ids.filter(id=>id!==boss.id))expect(getCoopDefenseUpgradeDefinition(id)!.costPerLevel).toBe(1);
    expect(COOP_DEFENSE_CONSTRUCTIONS.attack_drone_station.allowedModes).toEqual(['coop_defense']);
    expect(COOP_DEFENSE_CONSTRUCTIONS.attack_drone_station.kind).toBe('drone_station');
  });
  it('migrates missing nodes to zero and applies upgrades only to the inspector',()=>{
    const old={upgrades:{unlock_machine_gun_turret:{unlocked:true,level:1}}};
    const migrated=sanitizeCoopDefenseUpgradeProfile(old,'inspector_gadachs');
    for(const id of ids)expect(migrated.upgrades[id].level).toBe(0);
    const all={upgrades:Object.fromEntries(ids.map(id=>[id,{unlocked:true,level:getCoopDefenseUpgradeDefinition(id)!.maxLevel}]))};
    const resolve=(classId:'inspector_gadachs'|'dachs_nukem')=>{
      const totals=getCoopDefenseResolvedEffectTotals(all,classId);return resolveAttackDroneStats(stat=>totals.additive[stat]??0);
    };
    expect(resolve('dachs_nukem')).toEqual(resolveAttackDroneStats());
    expect(resolve('inspector_gadachs').bombsEnabled).toBe(true);
    expect(resolve('inspector_gadachs').chunksPerBomb).toBeGreaterThan(0);
  });
  it('persists station identity and placement while discarding transient flight and combat data',()=>{
    const authored={persistentId:'station-one',tool:{kind:'construction',id:'attack_drone_station'},relativeGridX:1,relativeGridY:1,angle:0,placementOrder:1};
    expect(sanitizePersistentConstructions([{...authored,ammo:17,bombReadyAt:12000,drone:{x:1,y:2}}])).toEqual([authored]);
  });
  it.each(['de','en'] as const)('resolves every description in %s',locale=>{
    for(const id of ids)expect(getUpgradeDescription(id,locale)).not.toMatch(/[{}⟦⟧]/);
  });
});
