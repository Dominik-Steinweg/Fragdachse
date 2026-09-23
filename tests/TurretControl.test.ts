import { describe, expect, it, vi } from 'vitest';
import { selectTurretCandidate, turretCandidateScore, TurretControlSystem, TURRET_CONTROL_RULES, resolveTurretExit, isFriendlyTurret } from '../src/systems/TurretControlSystem';
import { COOP_DEFENSE_BASE_TURRET_OWNER_ID, COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID } from '../src/config';
import type { AutomatedTurret } from '../src/systems/TurretSystem';
import type { TurretControlInput } from '../src/types';
import { getCoopDefenseNumericStatTotals, getCoopDefenseUpgradeDefinition, sanitizeCoopDefenseUpgradeProfile, getAvailableCoopDefenseUpgradePoints } from '../src/utils/coopDefenseUpgrades';
import { COOP_DEFENSE_CLASS_IDS } from '../src/config/coopDefenseClasses';
import { encodePlayerStates, decodePlayerStates } from '../src/network/playerStateCodec';
import { WorldPlayerGameplayRuntime } from '../src/world/WorldPlayerGameplayRuntime';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';

vi.mock('phaser', () => ({ Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } }));

function service(overrides: Record<string, unknown> = {}): any {
  return new Proxy(overrides, { get(target, key) {
    if (!(key in target)) target[key as string] = vi.fn();
    return target[key as string];
  } });
}

const turret = (id: number | string, x = 50, y = 0): AutomatedTurret => ({ id, x, y, ownerId: 'owner', ownerColor: 1 });
function fixture() {
  let sources = [turret(1), turret('1')];
  let permitted = true, normal = true;
  let packet: { input: TurretControlInput; receivedAt: number } | null = null;
  const enter = vi.fn(), exit = vi.fn(), pin = vi.fn();
  const system = new TurretControlSystem({ getTurrets: () => sources,
    getActor: () => ({ x: 0, y: 0, angle: 0 }), canOccupy: () => permitted, canEnter: () => normal,
    isFriendly: () => true, getInput: () => packet, enter, exit, pin });
  return { system, enter, exit, pin, remove: () => { sources = []; }, revoke: () => { permitted = false; },
    block: () => { normal = false; }, input: (value: typeof packet) => { packet = value; } };
}

describe('manual turret occupancy', () => {
  it('enforces runtime action and lifecycle boundaries and cancels pending channels without discharging', () => {
    const player = { id: 'pilot', x: 0, y: 0, rotation: 0, hp: 71, armor: 23,
      setPosition(x: number, y: number) { this.x = x; this.y = y; } };
    let sources = [turret(1)], permitted = true, stunned = false, dash = 0, forced = false, phase = 'idle';
    const physics = service({ getDashPhase: () => dash, hasForcedMovement: () => forced });
    const runtime = new WorldPlayerGameplayRuntime({
      playerManager: service({ getAllPlayers: () => [player], getPlayer: () => player, getWorldSpawnPoint: () => ({ x: -50, y: 0 }) }),
      getTurrets: () => sources, isFriendlyTurret: () => true,
      projectileSpawn: service(), projectileTravelReadPort: service(), projectileEnvironmentInteractionPort: service(),
      translocatorProjectilePort: { spawnPuck: () => 1, getPuckPosition: () => null, consumePuck: () => false },
      combatSystem: service({ isAlive: () => true, isStunned: () => stunned }), hostPhysics: physics,
      fireSystem: service(), placementSystem: service(), gameAudioSystem: service(), decoySystem: service(),
      worldMetrics: resolveActiveArenaWorldMetrics(), getEnemyManager: () => null, getTargetStatusSystem: () => null,
      getPowerUpSystem: () => null, getPlayerCapabilities: () => ({ canMove: permitted, canInteract: permitted, canUseCombat: true } as never),
      resetPlayerPosition: vi.fn(), dropBeer: vi.fn(), createLoadoutManager: () => service(),
      createBurrowSystem: () => service({ getPhase: () => phase, isTunnelTransit: () => false, isStunned: () => false }),
      weaponExecution: service(), relationship: { isEnemyPair: () => false },
      network: { input: { getPlayerInput: () => undefined }, presentation: service(), loadout: service(), roundStats: service() },
    });
    const systems = (runtime as any).systems;
    vi.spyOn(systems.playerModifier, 'getNumericStat').mockReturnValue(1);
    const cancel = vi.spyOn(systems.sustainedWeaponBehavior, 'resetPlayer');
    const entry = () => runtime.requestTurretControl('pilot', { action: 'enter', turretId: 1 });
    permitted = false; expect(entry()).toBe(false); permitted = true;
    stunned = true; expect(entry()).toBe(false); stunned = false;
    dash = 2; expect(entry()).toBe(false); dash = 0;
    forced = true; expect(entry()).toBe(false); forced = false;
    phase = 'recovery'; expect(entry()).toBe(false); phase = 'idle';
    expect(entry()).toBe(true); expect([player.x, player.y]).toEqual([50, 0]);
    expect(cancel).toHaveBeenCalledWith('pilot');
    expect(runtime.usePlayerAction({ playerId: 'pilot', category: 'weapon', slot: 'weapon1', angle: 0, targetX: 200, targetY: 0, hostNowMs: 0 })).toEqual({ ok: false, reason: 'blocked' });
    expect(runtime.startHeldAction('pilot', 'malicious', 'charged_throw', 100, 0)).toBe(false);
    expect(runtime.startUtilityHeldAction('pilot', 'malicious', 'charged_throw', 0)).toBe(false);
    runtime.handleDashRequest('pilot', 1, 0, 0); runtime.handleBurrowRequest('pilot', true);
    expect(physics.handleDashRPC).not.toHaveBeenCalled();
    expect(systems.burrow.handleBurrowRequest).not.toHaveBeenCalled();
    sources = []; runtime.reconcileTurretControl();
    expect(runtime.getTurretControlState('pilot')).toBeUndefined();
    expect([player.hp, player.armor]).toEqual([71, 23]);
    sources = [turret(1, -20)]; expect(entry()).toBe(true);
    runtime.detachPlayerLoadout('pilot'); expect(runtime.isControllingTurret('pilot')).toBe(false);
    sources = [turret(1, -20)]; expect(entry()).toBe(true);
    runtime.destroy(); runtime.destroy(); expect(runtime.isControllingTurret('pilot')).toBe(false);
    expect(entry()).toBe(false);
  });
  it('uses faction semantics for every weapon type and stable typed IDs for equal scores', () => {
    const tesla = { ...turret(1), weaponId: 'TURRET_TESLA' as const };
    expect(isFriendlyTurret('pilot', tesla, () => false)).toBe(true);
    expect(isFriendlyTurret('pilot', tesla, () => true)).toBe(false);
    expect(isFriendlyTurret('pilot', { ...tesla, ownerId: COOP_DEFENSE_BASE_TURRET_OWNER_ID }, () => true)).toBe(true);
    expect(isFriendlyTurret('pilot', { ...tesla, ownerId: COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID }, () => false)).toBe(false);
    const actor = { x: 0, y: 0, angle: 0 }, a = turret(2), b = turret(1);
    expect(selectTurretCandidate(actor, [a, b], null, () => true)?.id).toBe(1);
    expect(selectTurretCandidate(actor, [b, a], null, () => true)?.id).toBe(1);
    expect(turretCandidateScore({ ...actor, angle: NaN }, tesla)).toBe(-Infinity);
  });

  it('exits beyond the carrier with body clearance and deterministic blocked-direction fallbacks', () => {
    const source = { ...turret(1, 100, 100), footprint: { left: 0, top: 0, right: 400, bottom: 200 } };
    const spawn = vi.fn(() => ({ x: 900, y: 900 }));
    const geometry = { resolveSafeGroundPoint: (x: number, y: number) => ({ x, y }) };
    const first = resolveTurretExit(source, { x: 5, y: 5 }, 0, 16, geometry, spawn);
    expect(first.x).toBeGreaterThan(source.footprint.right + 16); expect(first.y).toBe(100);
    const blocked = { resolveSafeGroundPoint: (x: number, y: number) => y > 220 ? { x, y } : null };
    const alternate = resolveTurretExit(source, { x: 5, y: 5 }, 0, 16, blocked, spawn);
    expect(alternate.y).toBeGreaterThan(220);
    expect(resolveTurretExit(source, { x: 5, y: 5 }, 0, 16, blocked, spawn)).toEqual(alternate);
    expect(spawn).not.toHaveBeenCalled();
    const originOnly = { resolveSafeGroundPoint: (x: number, y: number) => x === 5 && y === 5 ? { x, y } : null };
    expect(resolveTurretExit(source, { x: 5, y: 5 }, 0, 16, originOnly, spawn)).toEqual({ x: 5, y: 5 });
    expect(resolveTurretExit(source, { x: 5, y: 5 }, 0, 16, null, spawn)).toEqual({ x: 900, y: 900 });
  });
  it('favors looking at a farther turret, filters range and keeps the candidate through small score changes', () => {
    const actor = { x: 0, y: 0, angle: 0 };
    const front = turret(1, 90), side = turret(2, 0, 10);
    expect(selectTurretCandidate(actor, [side, front], null, () => true)?.id).toBe(1);
    expect(turretCandidateScore(actor, turret(3, TURRET_CONTROL_RULES.range + 1))).toBe(-Infinity);
    expect(selectTurretCandidate(actor, [turret(1, 50), turret(2, 49)], 1, () => true)?.id).toBe(1);
    expect(selectTurretCandidate(actor, [turret(1, 80), turret(2, 10)], 1, () => true)?.id).toBe(2);
    expect(selectTurretCandidate(actor, [front], 1, () => false)).toBeNull();
    expect(selectTurretCandidate(actor, [turret(1, -30)], null, () => true)).toBeNull();
  });

  it('claims a turret atomically, distinguishes numeric IDs and validates exit revisions', () => {
    const f = fixture();
    expect(f.system.request('a', { action: 'enter', turretId: 1 })).toBe(true);
    expect(f.system.request('b', { action: 'enter', turretId: 1 })).toBe(false);
    expect(f.system.request('b', { action: 'enter', turretId: '1' })).toBe(true);
    const state = f.system.getState('a')!;
    expect(f.system.request('a', { action: 'exit', ...state, revision: state.revision + 1 })).toBe(false);
    expect(f.system.request('a', { action: 'exit', ...state })).toBe(true);
    expect(f.system.request('b', { action: 'enter', turretId: 1 })).toBe(false);
    expect(f.exit).toHaveBeenCalledOnce();
    f.system.clear();
    expect(f.system.getOccupant('1')).toBeUndefined();
  });

  it('rejects entry outside normal state and releases on disappearance or permission loss', () => {
    const blocked = fixture(); blocked.block();
    expect(blocked.system.request('a', { action: 'enter', turretId: 1 })).toBe(false);
    for (const reason of ['remove', 'revoke'] as const) {
      const f = fixture(); f.system.request('a', { action: 'enter', turretId: 1 });
      f.system.reconcile(); expect(f.pin).toHaveBeenCalledOnce();
      f[reason](); f.system.reconcile();
      expect(f.system.isOccupied('a')).toBe(false); expect(f.exit).toHaveBeenCalledOnce();
    }
  });

  it('requires fresh input for the exact occupancy and rejects malformed mouse points', () => {
    const f = fixture(); f.system.request('a', { action: 'enter', turretId: 1 });
    const state = f.system.getState('a')!;
    expect(f.system.getManualControl(1, 100)?.fireHeld).toBe(false);
    f.input({ input: { ...state, targetX: 120, targetY: 40, fireHeld: true }, receivedAt: 100 });
    expect(f.system.getManualControl(1, 100)).toMatchObject({ fireHeld: true, targetX: 120, targetY: 40 });
    expect(f.system.getManualControl(1, 101 + TURRET_CONTROL_RULES.inputTimeoutMs)?.fireHeld).toBe(false);
    f.input({ input: { ...state, revision: state.revision + 1, targetX: 120, targetY: 40, fireHeld: true }, receivedAt: 100 });
    expect(f.system.getManualControl(1, 100)?.fireHeld).toBe(false);
    f.input({ input: { ...state, targetX: NaN, targetY: 40, fireHeld: true }, receivedAt: 100 });
    expect(f.system.getManualControl(1, 100)?.fireHeld).toBe(false);
  });

  it('roundtrips occupancy including typed turret IDs and clears it in a subsequent full player snapshot', () => {
    const player = { aim: { revision: 0, isMoving: false, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 }, burrowPhase: 'idle' };
    for (const turretId of [7, 'base:7']) {
      const state = { ...player, turretControl: { turretId, revision: 3 } };
      expect(decodePlayerStates(encodePlayerStates({ a: state } as never)).a.turretControl).toEqual(state.turretControl);
    }
    expect(decodePlayerStates(encodePlayerStates({ a: player } as never)).a.turretControl).toBeUndefined();
  });

  it('grants intrinsic Inspector control and silently refunds a saved purchase', () => {
    const raw = { upgrades: { turret_control: { unlocked: true, level: 1 } } } as never;
    const clean = sanitizeCoopDefenseUpgradeProfile(raw, 'inspector_gadachs');
    expect(clean.upgrades.turret_control.level).toBe(0);
    expect(getAvailableCoopDefenseUpgradePoints(2, clean, 'inspector_gadachs')).toBe(1);
    expect(getCoopDefenseNumericStatTotals(clean, 'inspector_gadachs')['player.turretControlEnabled']).toBe(1);
  });

  it('resolves the authored feature for every Coop class', () => {
    const upgrade = getCoopDefenseUpgradeDefinition('turret_control')!;
    for (const classId of COOP_DEFENSE_CLASS_IDS) {
      const stats = getCoopDefenseNumericStatTotals({ upgrades: { turret_control: { unlocked: true, level: 1 } } } as never, classId);
      expect(stats['player.turretControlEnabled']).toBe(upgrade.effects[0].value);
    }
  });
});
