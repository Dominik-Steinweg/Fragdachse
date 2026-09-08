import { describe, expect, it } from 'vitest';
import { decoyTargetHarness, resolvedDecoy } from './DecoyTestHelper';

describe('shared Decoy targeting', () => {
  it('captures owner attack and active-field movement targets before stealth invalidates them', () => {
    const h = decoyTargetHarness();
    let visible = true;
    h.enemy('movement', { movementFieldId: 'player' }); h.enemy('attack'); h.enemy('base');
    h.attackTargets.set('attack', { kind: 'player', id: 'owner' });
    h.targets.prepareOrdinaryGoals([{ kind: 'player', id: 'owner', x: 240, y: 176,
      goalCells: [{ gridX: 7, gridY: 5 }], isTargetable: () => visible }]);
    h.coordinator.prepareNow();
    const decoy = h.spawn(); visible = false; h.step();
    expect(h.targets.getTarget('movement')?.id).toBe(String(decoy.id));
    expect(h.targets.getTarget('attack')?.id).toBe(String(decoy.id));
    expect(h.targets.getTarget('base')).toBeNull();
    expect(h.targets.getMovementField('movement')).toBe(h.targets.getMovementField('attack'));
    h.close();
  });

  it('requires sight and a computed route for L2, then retains the first lock outside radius and sight', () => {
    const h = decoyTargetHarness();
    const enemy = h.enemy('base');
    const decoy = h.spawn({ config: resolvedDecoy() });
    h.setVisible(false); h.step(); expect(h.targets.getTarget(enemy.id)).toBeNull();
    h.setVisible(true); h.targets.updateLocks();
    expect(h.targets.getTarget(enemy.id)?.id).toBe(String(decoy.id));
    enemy.x = 48; h.setVisible(false);
    h.spawn({ ownerId: 'other', position: { x: 80, y: 176 }, config: resolvedDecoy() });
    h.step();
    expect(h.targets.getTarget(enemy.id)?.id).toBe(String(decoy.id));
    h.close();
  });

  it('resolves simultaneous first acquisition by distance then stable decoy ID', () => {
    const h = decoyTargetHarness(); h.enemy('e');
    const farther = h.spawn({ ownerId: 'farther', position: { x: 304, y: 176 }, config: resolvedDecoy() });
    const nearer = h.spawn({ position: { x: 208, y: 176 }, config: resolvedDecoy() });
    h.spawn({ ownerId: 'tie', position: { x: 80, y: 176 }, config: resolvedDecoy() });
    h.step();
    expect(h.targets.getTarget('e')?.id).toBe(String(nearer.id));
    expect(h.targets.getTarget('e')?.id).not.toBe(String(farther.id)); h.close();
  });

  it('does not treat a pending worker field as confirmed unreachable, then releases a blocked lock', () => {
    const h = decoyTargetHarness(); h.enemy('e');
    h.attackTargets.set('e', { kind: 'player', id: 'owner' });
    const decoy = h.spawn({ config: resolvedDecoy() }); h.step();
    h.coordinator.patchBarrierCells(Array.from({ length: 16 }, (_, gridY) => ({ gridX: 6, gridY, occupied: true })));
    h.targets.prepareNavigation(); h.targets.updateLocks();
    expect(h.targets.getTarget('e')?.id).toBe(String(decoy.id));
    h.coordinator.prepareNow(); h.targets.updateLocks();
    expect(h.targets.getTarget('e')).toBeNull(); h.close();
  });

  it('refunds unique actual engagements that remain living, hostile and in the end radius', () => {
    const h = decoyTargetHarness();
    const dead = h.enemy('dead'), gone = h.enemy('gone'), ally = h.enemy('ally');
    h.enemy('used'); h.enemy('queued');
    const decoy = h.spawn({ config: resolvedDecoy() }); h.step();
    for (const id of ['used', 'used', 'dead', 'gone', 'ally']) h.targets.usedTarget(id);
    dead.alive = false; gone.x = 760; ally.hostile = false;
    expect(h.end(decoy.id)).toBe(1);
    expect(h.targets.getTarget('used')).toBeNull();
    expect(Object.keys(h.coordinator.getDiagnostics().fields).some(id => id.startsWith('decoy:'))).toBe(false);
    h.close();
  });

  it('excludes cleanup and absent enemies and tears down clearance fields with the activity', () => {
    const h = decoyTargetHarness(); h.enemy('boss', { clearanceCells: 1 });
    const decoy = h.spawn({ config: resolvedDecoy() }); h.step(); h.targets.usedTarget('boss');
    expect(h.end(decoy.id, 'cleanup')).toBe(0); h.close();
    expect(h.targets.getTarget('boss')).toBeNull();
  });
});
