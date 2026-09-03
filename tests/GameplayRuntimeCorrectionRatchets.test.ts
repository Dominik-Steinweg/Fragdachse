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
    const behaviorPort = source('src/loadout/NegevBehaviorPort.ts');
    const behaviorRuntime = source('src/world/NegevBehaviorRuntime.ts');
    const worldRuntime = source('src/world/WorldPlayerGameplayRuntime.ts');
    const combatBinding = source('src/world/WorldCombatGameplayBinding.ts');
    const hostFrame = source('src/scenes/arena/HostUpdateCoordinator.ts');

    expect(loadoutManager).not.toContain('negevStates');
    expect(loadoutManager).not.toContain('finishNegevKillstreak');
    expect(loadoutManager).toContain('negevBehavior?.prepareShot');
    expect(loadoutManager).toContain('negevBehavior?.commitShot');
    expect(behaviorPort).toContain('NegevBehaviorPort');
    expect(behaviorRuntime).toContain('update(nowMs: number)');
    expect(behaviorRuntime).not.toContain('Date.now()');
    expect(worldRuntime).toContain('new NegevBehaviorRuntime');
    expect(combatBinding).toContain('negevBehavior?.registerKill');
    expect(hostFrame).not.toContain('loadout?.getNegevHudBuffs');
    expect(hostFrame).toContain('negevBehavior?.getHudBuffs');
  });
});
