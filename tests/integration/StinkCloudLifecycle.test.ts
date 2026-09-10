import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());
import { StinkCloudSystem } from '../../src/effects/StinkCloudSystem';
import { PlayerUtilityActionRuntime } from '../../src/world/PlayerUtilityActionRuntime';
import { HostHeldActionSystem } from '../../src/systems/HostHeldActionSystem';
import { UTILITY_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { resolveRadialActions } from '../../src/systems/RadialActionModel';
import { healthBarTestScene } from '../healthBarTestScene';

function fixture() {
  const base = UTILITY_CONFIGS.STINK_CLOUD;
  if (base.type !== 'stinkcloud') throw Error('Stink fixture');
  let config = { ...base, plague: { ...base.plague!, combatMoveSpeedBonus: .3, combatDamageReduction: .3 } };
  const { scene } = healthBarTestScene();
  // Exercise the real host cloud lifetime; canvas texture creation and drawing are separate renderer tests.
  const textures = vi.spyOn(StinkCloudSystem.prototype as any, 'ensureTextures').mockImplementation(() => {});
  const cloud = new StinkCloudSystem(scene); textures.mockRestore();
  vi.spyOn(cloud, 'syncVisuals').mockImplementation(() => {});
  let alive = true, burrowed = false, attempt = 0;
  const cooldown = vi.fn(), publish = vi.fn();
  const action = new PlayerUtilityActionRuntime({
    captureSmokeDamage: () => ({ sourceDamageMultiplier: 2 }), projectileSpawn: { spawnProjectile: () => null },
    combatSystem: {} as never, actor: { getPlayer: () => ({ x: 40, y: 20, color: 0xffffff }), canInteract: () => true,
      isAlive: () => alive, isUtilityBlocked: () => burrowed },
    loadout: { getEquippedUtilityConfig: () => config, resolveUtilityConfig: (_p,c) => c, noteUtilityUsed() {} },
    heldAction: new HostHeldActionSystem(), translocator: null, decoy: null, stinkCloud: cloud,
    gameAudioSystem: { playSound() {} } as never,
    network: { loadout: { publishUtilityCooldownUntil: cooldown, publishStinkCloudUtilityState: publish,
      publishTemporaryUtilityInstances() {}, publishHeldUtilityId() {} }, roundStats: { recordUtilityUsed() {}, recordConstructionBuilt() {} } },
    dropBeer() {}, nukeStrike: () => false, placeable: null, isToolAuthorized: () => true, resolveToolUtilityConfig: () => config,
  });
  const cast = (now: number, temporaryUtilityInstanceId?: string, tool = false) => action.execute({ category: 'utility',
    playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: now, attemptId: 'cast-'+ ++attempt,
    params: { temporaryUtilityInstanceId }, ...(tool ? { source: { kind: 'tool', toolRef: { kind: 'utility', id: 'STINK_CLOUD' }, config } as const } : {}) });
  const step = (now: number) => cloud.hostUpdate(now, () => ({ x: 40, y: 20, color: 0xffffff, alive, burrowed }));
  return { action, cloud, cast, step, config, cooldown, publish,
    setAlive: (v: boolean) => { alive=v; }, setBurrowed: (v: boolean) => { burrowed=v; },
    changeBuild: () => { config = { ...config, cooldown: 1, plague: { ...config.plague, combatMoveSpeedBonus: 0 } }; },
    destroy: () => { action.destroy(); cloud.destroyAll(); } };
}

describe('primary stink cloud lifetime', () => {
  it('replicates owner-following independently from stationary cloud ownership', () => {
    const f = fixture();
    try {
      f.cast(1000);
      expect(f.step(1001).synced[0].followOwner).toBe(true);
      f.cloud.hostCreateStationaryCloud('p1', 0xffffff, 300, 200, 80, 1000, 0, 250, 1, 1);
      const stationary = f.step(1002).synced.find(cloud => !cloud.followOwner);
      expect(stationary).toMatchObject({ x: 300, y: 200, followOwner: false });
    } finally { f.destroy(); }
  });

  it('cannot bypass the global lock with temporary inventory or inspector tools',()=> {
    const f=fixture();try {
      const first=f.action.addTemporaryUtility('p1',f.config,1)!;
      const second=f.action.addTemporaryUtility('p1',f.config,1)!;
      expect(f.cast(1000,first).ok).toBe(true);
      expect(f.action.getStinkCloudState('p1')).toMatchObject({phase:'active',temporaryUtilityInstanceId:first});
      expect(f.cast(1100,second)).toEqual({ok:false,reason:'blocked'});
      expect(f.cast(1100,undefined,true)).toEqual({ok:false,reason:'blocked'});
      f.cloud.hostDeactivateForPlayer('p1',1200);
      expect(f.cast(1300,second)).toEqual({ok:false,reason:'cooldown'});
      expect(f.cast(1300,undefined,true)).toEqual({ok:false,reason:'cooldown'});
      expect(f.cast(1200+f.config.cooldown,second).ok).toBe(true);
      f.action.destroy();expect(f.step(1300+f.config.cooldown).synced).toEqual([]);
    } finally {f.destroy();}
  });

  it('hits immediately, follows the owner and starts the captured cooldown only at natural expiry', () => {
    const f=fixture(); try {
      expect(f.cast(1000).ok).toBe(true);
      const tick=f.step(1000).damageEvents;
      expect(tick).toHaveLength(1); expect(tick[0]).toMatchObject({ kind: 'player-primary', x: 40, y: 20,
        damage: f.config.cloudDamagePerTick, plague: { damageMultiplier: 2 } });
      expect(f.step(1001).damageEvents).toEqual([]);
      expect(f.action.getStinkMoveSpeedBonus('p1', 1001)).toBe(.3);
      expect(f.action.getStinkDamageReduction('p1', 1001)).toBe(.3);
      expect(f.cooldown.mock.calls.filter(call => call[2] === 'STINK_CLOUD')).toEqual([]);
      f.changeBuild(); expect(f.cast(1100, undefined, true).ok).toBe(false);
      const end=1000+f.config.cloudDuration;
      expect(f.step(end+30).damageEvents.length + tick.length).toBe(f.config.cloudDuration / f.config.cloudTickInterval);
      expect(f.action.getStinkCloudState('p1')).toMatchObject({ phase: 'cooldown', cooldownUntil: end+f.config.cooldown });
      expect(f.action.getStinkMoveSpeedBonus('p1', end)).toBe(0);
      expect(f.cast(end+f.config.cooldown-1)).toEqual({ ok: false, reason: 'cooldown' });
      expect(f.cast(end+f.config.cooldown).ok).toBe(true);
    } finally { f.destroy(); }
  });

  it.each(['death','burrow'] as const)('ends early on %s exactly once', reason => {
    const f=fixture(); try {
      f.cast(1000); f.step(1000);
      if(reason==='death') f.setAlive(false); else f.setBurrowed(true);
      expect(f.step(1400).synced).toEqual([]);
      expect(f.action.getStinkCloudState('p1')).toMatchObject({ phase: 'cooldown', cooldownUntil: 1400+f.config.cooldown });
      f.step(1500); expect(f.cooldown.mock.calls.filter(call => call[2] === 'STINK_CLOUD')).toHaveLength(1);
      expect(f.action.getStinkDamageReduction('p1', 1400)).toBe(0);
    } finally { f.destroy(); }
  });

  it('projects one active/cooldown lock across every source, including an exhausted temporary source', () => {
    const f=fixture(); try {
      f.cast(1000); const active=f.action.getStinkCloudState('p1')!;
      const resolve = (state: typeof active) => resolveRadialActions({ gameMode: 'coop_defense', stinkCloudState: state,
        tools: [{ kind: 'utility', id: 'STINK_CLOUD' }], temporaryUtilities: [{ kind: 'utility', instanceId: 'other', utilityId: 'STINK_CLOUD',
          charges: 1, cooldownUntil: 0, cooldownDurationMs: f.config.cooldown, acquisitionOrder: 0 }],
        persistentRewardIds: [], usedCapacity: 0, capacityMax: 10, now: 1000, canUseUtility: true, canPlace: true, canManage: true });
      const projected=resolve({ ...active, temporaryUtilityInstanceId: 'consumed' });
      expect(projected).toHaveLength(3); expect(projected.every(e => !e.available)).toBe(true);
      expect(projected.every(e => e.cooldownUntil === 0)).toBe(true);
      f.cloud.hostDeactivateForPlayer('p1', 1000);
      expect(resolve(f.action.getStinkCloudState('p1')!).every(e => e.disabledReason === 'cooldown')).toBe(true);
      f.action.removePlayer('p1'); expect(f.action.getStinkCloudState('p1')).toBeNull();
      expect(f.publish).toHaveBeenLastCalledWith('p1', null);
    } finally { f.destroy(); }
  });

  it('keeps enemy auras separate from primary player clouds', () => {
    const f=fixture(); try {
      f.cloud.hostActivate('enemy', 20, 1000, 1, 250, 0, 0, 1, 0, 0, 0, 'spore_void', 1000);
      expect(f.step(1000).damageEvents).toEqual([]);
      expect(f.step(1250).damageEvents[0]).toMatchObject({ kind: 'enemy-aura', plague: undefined });
      expect(f.action.getStinkCloudState('enemy')).toBeNull();
    } finally { f.destroy(); }
  });
});
