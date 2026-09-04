import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_PATH = 'src/scenes/arena/ClientUpdateCoordinator.ts';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Client-Tick – Phase 12B stabile Player-Reads', () => {
  it('kennt keine konkreten Player-Gameplay-Children oder host-only Runtime-Erzeugung', () => {
    const client = read(CLIENT_PATH);
    expect(client).not.toMatch(/private get playerSystems\b/);
    expect(client).not.toMatch(/playerSystems\b/);
    expect(client).not.toMatch(/\.systems\?\.?\.(loadout|resource|burrow|ak47Behavior)\b/);
    expect(client).not.toContain('new WorldPlayerGameplayRuntime');
    expect(client).toContain('getPlayerGameplayReadViews(): PlayerGameplayReadViews | null');
    expect(client).toContain('private get playerGameplayReadViews(): PlayerGameplayReadViews | null');
  });

  it('liest Utility-, Adrenalin- und Burrow-State über stabile Quellen', () => {
    const client = read(CLIENT_PATH);
    expect(client).toContain('this.playerGameplayReadViews?.getEquippedUtilityConfig(localId)');
    expect(client).toContain('this.playerGameplayReadViews.getAdrenaline(localId)');
    expect(client).toContain('this.playerGameplayReadViews.isBurrowed(localId)');
    expect(client).toContain('bridge.getPlayerActiveBuffs(localId)');
  });

  it('behält die nichtautoritative Weapon2-Prediction-Korrelation und Reconciliation', () => {
    const client = read(CLIENT_PATH);
    for (const contract of [
      'pendingAdrenalineSpends',
      'retryUnresolvedWeapon2Predictions',
      'authoritativeAdrenaline',
      'rollbackRejectedLoadoutFire',
      'resolvePredictedWeapon2Use',
    ]) {
      expect(client, contract).toContain(contract);
    }
  });
});
