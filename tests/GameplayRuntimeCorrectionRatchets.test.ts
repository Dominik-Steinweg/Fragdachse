import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Gameplay Runtime correction-pass ratchets', () => {
  it('keeps weapon dispatch on the semantic PlayerActionRuntime path', () => {
    const loadoutManager = source('src/loadout/LoadoutManager.ts');
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');

    expect(loadoutManager).not.toMatch(/\n\s*use\s*\(/);
    expect(worldRuntime).not.toContain('useLegacyLoadoutAction');
    expect(worldRuntime).not.toMatch(/systems\.loadout\.use\s*\(/);
  });

  it('keeps Gauss lifecycle state separate from held utility actions', () => {
    const ultimateRuntime = source('src/world/PlayerUltimateBehaviorRuntime.ts');
    const inputSystem = source('src/systems/InputSystem.ts');
    const inputBindings = source('src/scenes/arena/ArenaInputBindings.ts');
    const rpcCoordinator = source('src/scenes/arena/RpcCoordinator.ts');

    expect(ultimateRuntime).toContain('gaussChargeId');
    expect(ultimateRuntime).toContain('gaussChargeHistory');
    expect(ultimateRuntime).not.toContain('HostHeldActionSystem');
    expect(inputSystem).toContain('attemptId: this.gaussCommitAttemptId');
    expect(inputSystem).toContain("ultimateAction: 'cancel'");
    expect(inputBindings).toContain('inputSystem.handleGaussActionResult');
    expect(rpcCoordinator).toContain("params?.ultimateAction === 'cancel'");
  });

  it('keeps Negev killstreak state and reactions out of LoadoutManager', () => {
    const loadoutManager = source('src/loadout/LoadoutManager.ts');
    const weaponActivation = source('src/world/PlayerWeaponActivationRuntime.ts');
    const behaviorPort = source('src/loadout/NegevBehaviorPort.ts');
    const behaviorRuntime = source('src/world/NegevBehaviorRuntime.ts');
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');
    const combatBinding = source('src/world/WorldCombatGameplayBinding.ts');
    const hostFrame = source('src/scenes/arena/HostUpdateCoordinator.ts');

    expect(loadoutManager).not.toContain('negevStates');
    expect(loadoutManager).not.toContain('finishNegevKillstreak');
    expect(loadoutManager).not.toContain('prepareShot');
    expect(loadoutManager).not.toContain('commitShot');
    expect(weaponActivation).toContain('negevBehavior?.prepareShot');
    expect(weaponActivation).toContain('negevBehavior?.commitShot');
    expect(behaviorPort).toContain('NegevBehaviorPort');
    expect(behaviorRuntime).toContain('update(nowMs: number)');
    expect(behaviorRuntime).not.toContain('Date.now()');
    expect(worldRuntime).toContain('new NegevBehaviorRuntime');
    expect(combatBinding).toContain('getPlayerCombatIntegration()?.reactions.registerKill');
    expect(hostFrame).not.toContain('loadout?.getNegevHudBuffs');
    expect(hostFrame).toContain('negevBehavior?.getHudBuffs');
  });

  it('keeps Shotgun Lightning and simple kill reactions out of LoadoutManager', () => {
    const loadoutManager = source('src/loadout/LoadoutManager.ts');
    const reactionPort = source('src/loadout/WeaponReactionPort.ts');
    const reactionRuntime = source('src/world/WeaponReactionRuntime.ts');
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');
    const combatBinding = source('src/world/WorldCombatGameplayBinding.ts');
    const hostFrame = source('src/scenes/arena/HostUpdateCoordinator.ts');

    expect(loadoutManager).not.toContain('shotgunLightningQueue');
    expect(loadoutManager).not.toContain('processShotgunLightningQueue');
    expect(loadoutManager).not.toContain('handleKill');
    expect(reactionPort).toContain('WeaponReactionPort');
    expect(reactionRuntime).toContain('class WeaponReactionRuntime');
    expect(worldRuntime).toContain('new WeaponReactionRuntime');
    expect(combatBinding).toContain('reactions.registerKill');
    expect(hostFrame).toContain('weaponReaction?.update');
  });

  it('keeps Tesla Dome and Energy Shield lifecycles in the sustained behavior owner', () => {
    const loadoutManager = source('src/loadout/LoadoutManager.ts');
    const actionRuntime = source('src/world/PlayerActionRuntime.ts');
    const sustainedPort = source('src/loadout/SustainedWeaponBehaviorPort.ts');
    const sustainedRuntime = source('src/world/SustainedWeaponBehaviorRuntime.ts');
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');
    const combatBinding = source('src/world/WorldCombatGameplayBinding.ts');

    expect(loadoutManager).not.toContain('setTeslaDomeSystem');
    expect(loadoutManager).not.toContain('setEnergyShieldSystem');
    expect(loadoutManager).not.toContain('activateTeslaDomeWeapon');
    expect(loadoutManager).not.toContain('activateEnergyShieldWeapon');
    expect(loadoutManager).not.toContain('activeWeaponSlots');
    expect(loadoutManager).toContain('setSustainedWeaponBehavior');
    expect(actionRuntime).toContain('sustainedWeaponBehavior?.claimWeaponAction');
    expect(actionRuntime).toContain('sustainedWeaponBehavior?.activateWeapon');
    expect(sustainedPort).toContain('SustainedWeaponBehaviorPort');
    expect(sustainedRuntime).toContain('class SustainedWeaponBehaviorRuntime');
    expect(sustainedRuntime).toContain('hostRefresh');
    expect(sustainedRuntime).toContain('hostDeactivateForPlayer');
    expect(worldRuntime).toContain('new SustainedWeaponBehaviorRuntime');
    expect(combatBinding).toContain('playerCombat.sustainedWeapon.setTeslaDomeSystem');
    expect(combatBinding).toContain('playerCombat.sustainedWeapon.setEnergyShieldSystem');
  });

  it('keeps immediate weapon dispatch and resource commit out of LoadoutManager (10A)', () => {
    const loadoutManager = source('src/loadout/LoadoutManager.ts');
    const actionRuntime = source('src/world/PlayerActionRuntime.ts');
    const weaponActivation = source('src/world/PlayerWeaponActivationRuntime.ts');
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');

    expect(loadoutManager).not.toContain('activateWeapon(');
    expect(loadoutManager).not.toContain('completeWeaponAction(');
    expect(loadoutManager).not.toContain('private fireWeapon(');
    expect(loadoutManager).not.toContain('dispatchWeaponFire(');
    expect(loadoutManager).not.toContain('setPhysicsSystem(');
    expect(loadoutManager).not.toContain('setItemRuntimeChargeConsumer(');
    expect(loadoutManager).not.toContain('setItemRuntimeWeaponFiredHandler(');
    expect(actionRuntime).toContain('weaponActivation.activateWeapon');
    expect(weaponActivation).toContain('drainAdrenaline');
    expect(worldRuntime).toContain('new PlayerWeaponActivationRuntime');
  });

  it('keeps ShieldBuff lifecycle ownership and reads outside concrete Loadout coupling', () => {
    const loadoutManager = source('src/loadout/LoadoutManager.ts');
    const shieldBuffPort = source('src/loadout/ShieldBuffPort.ts');
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');
    const combatBinding = source('src/world/WorldCombatGameplayBinding.ts');

    expect(loadoutManager).not.toContain('ShieldBuffSystem');
    expect(loadoutManager).not.toContain('setShieldBuffSystem');
    expect(loadoutManager).not.toContain('shieldBuffSystem');
    expect(loadoutManager).toContain('ShieldBuffReadPort');
    expect(shieldBuffPort).toContain('interface ShieldBuffLifecyclePort');
    expect(worldRuntime).toContain('shieldBuffPort?.resetPlayer');
    expect(worldRuntime).toContain('shieldBuffPort?.removePlayer');
    expect(combatBinding).toContain('bindPlayerShieldBuffPort');
    expect(combatBinding).not.toContain('player.loadout.setShieldBuffSystem');
  });

  it('keeps PlayerRelationshipPort outside Player gameplay Network ports', () => {
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');
    const ultimateRuntime = source('src/world/PlayerUltimateBehaviorRuntime.ts');
    const networkPortStart = worldRuntime.indexOf('export interface WorldPlayerGameplayNetworkPort');
    const networkPortEnd = worldRuntime.indexOf('export interface WorldPlayerGameplaySystems');
    const networkPort = worldRuntime.slice(networkPortStart, networkPortEnd);

    expect(networkPort).not.toContain('relationship');
    expect(worldRuntime).toContain('options.relationship.isEnemyPair');
    expect(worldRuntime).not.toContain('options.network.relationship');
    expect(ultimateRuntime).toContain('this.options.relationship.isEnemyPair');
    expect(ultimateRuntime).not.toContain('this.options.network.relationship');
    expect(ultimateRuntime).not.toContain('PlayerUltimateBehaviorNetworkPort');
  });
});
