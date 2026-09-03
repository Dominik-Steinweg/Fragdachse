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
});
