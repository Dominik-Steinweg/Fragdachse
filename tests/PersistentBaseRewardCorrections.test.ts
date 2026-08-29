import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIFECYCLE_PATH = resolve(process.cwd(), 'src/scenes/arena/ArenaLifecycleCoordinator.ts');

function readLifecycle(): string {
  return readFileSync(LIFECYCLE_PATH, 'utf8');
}

describe('Persistent Base Reward – 3D-2 Korrekturvertraege', () => {
  it('verwendet die zentrale kanonische World-Zellen-Aufloesung', () => {
    const source = readLifecycle();
    const resolverStart = source.indexOf('  private resolvePersistentBaseRewardCell(');
    const resolverEnd = source.indexOf('\n  private isPersistentBaseRewardPlacementInDomain(', resolverStart);
    expect(resolverStart).toBeGreaterThanOrEqual(0);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    const resolver = source.slice(resolverStart, resolverEnd);
    expect(resolver).toContain('return resolvePersistentBaseCell(');
    expect(resolver).not.toContain('resolvePersistentBaseCoreCellsRelative');
  });

  it('entfernt bei Basiszerstoerung nur die Reward-Turret-Runtime', () => {
    const source = readLifecycle();
    const destroyedStart = source.indexOf('baseManager.setOnBaseDestroyed((destroyedBase) => {');
    const destroyedEnd = source.indexOf('\n      });\n      return;', destroyedStart);
    expect(destroyedStart).toBeGreaterThanOrEqual(0);
    expect(destroyedEnd).toBeGreaterThan(destroyedStart);
    expect(source.slice(destroyedStart, destroyedEnd)).toContain(
      'this.removePersistentBaseRewardTurretsForBase(destroyedBase.id);',
    );

    const removalStart = source.indexOf('  private removePersistentBaseRewardTurretsForBase(');
    const removalEnd = source.indexOf('\n  private materializePersistentBaseReward(', removalStart);
    expect(removalStart).toBeGreaterThanOrEqual(0);
    expect(removalEnd).toBeGreaterThan(removalStart);
    const removal = source.slice(removalStart, removalEnd);
    expect(removal).toContain("rock.kind !== 'turret'");
    expect(removal).toContain("rock.ownership !== 'base-owned'");
    expect(removal).toContain('rock.persistentRewardId === undefined');
    expect(removal).toContain('placementSystem.removeRock(rock.id)');
    expect(removal).toContain('this.releasePlaceableRuntime(removed, false);');
    expect(removal).not.toContain('dismantleReward');
    expect(source).toContain("if (!persistentBaseActive) this.removePersistentBaseRewardTurretsForBase(site.baseId);");
  });

  it('baut nach einem Materialisierungsfehler das unveraenderte Composite wieder auf', () => {
    const source = readLifecycle();
    const placementStart = source.indexOf('  placePersistentBaseReward(');
    const placementEnd = source.indexOf('\n  /** Host callback fuer den atomaren Rollenwechsel', placementStart);
    expect(placementStart).toBeGreaterThanOrEqual(0);
    expect(placementEnd).toBeGreaterThan(placementStart);
    const placement = source.slice(placementStart, placementEnd);
    const rollbackAt = placement.indexOf('store.rollbackPlacement(sanitizedRequest.rewardId);');
    const refreshAt = placement.indexOf('this.hostRefreshPersistentBaseComposite();', rollbackAt);
    expect(placement).toContain('isPersistentContribution');
    expect(rollbackAt).toBeGreaterThanOrEqual(0);
    expect(refreshAt).toBeGreaterThan(rollbackAt);
    expect(placement).toContain('emitArenaMapGridChanged(this.scene.game.events');
  });
});
