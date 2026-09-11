import { afterEach, describe, expect, it, vi } from 'vitest';

// Only this fixture changes production availability. Descendants have no class lists.
vi.mock('../../src/config/coopDefenseUpgrades.json', async importOriginal => {
  const original = await importOriginal<{ default: { categories: { upgrades: { id: string; availableClasses?: string[] }[] }[] } }>();
  const config = structuredClone(original.default);
  const unlock = config.categories.flatMap(category => category.upgrades)
    .find(node => node.id === 'unlock_machine_gun_turret')!;
  unlock.availableClasses!.push('dachs_of_steel');
  return { default: config };
});
vi.mock('phaser', () => ({ Math: {
  Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
  Angle: { Between: (x: number, y: number, tx: number, ty: number) => Math.atan2(ty - y, tx - x) },
  Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx - x, ty - y) },
} }));

import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { resolveMgTurretStats } from '../../src/config/mgTurret';
import { getSelectableLoadoutItems } from '../../src/loadout/LoadoutCatalog';
import { RockGridIndex } from '../../src/arena/RockGridIndex';
import { PlacementSystem } from '../../src/systems/PlacementSystem';
import { resolveConstructionAccess, getConstructionAccessContext } from '../../src/systems/ConstructionAccessResolver';
import { ConstructionWorldRuntime } from '../../src/world/ConstructionWorldRuntime';
import { resolveActiveArenaWorldMetrics, worldCellCenter } from '../../src/world/WorldMetrics';
import { NetworkBridge } from '../../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { FakeNetwork, createHostRoom, addClientRoom, type TestRoom } from '../fakePeerNetwork';
import { buildDefaultCoopDefenseUpgradeProfile, getCoopDefenseUpgradeCategories,
  getCoopDefenseToolCapacity, getCoopDefenseResolvedEffectTotals, sanitizeCoopDefenseUpgradeProfile,
  setLoadoutToolSlots, respecCoopDefenseUpgradeCategory } from '../../src/utils/coopDefenseUpgrades';
import { exportStoredGameProgressJson, importStoredGameProgressJson, invalidateLocalStorageCache,
  getStoredCoopDefenseUpgradeProfile, setStoredCoopDefenseUpgradeProfile,
  setStoredCoopDefenseClassesUnlocked } from '../../src/utils/localPreferences';
import type { ArenaLayout, LoadoutCommitSnapshot, LoadoutToolRef } from '../../src/types';

afterEach(() => { clearActiveSession(); vi.unstubAllGlobals(); });

describe('configuration-driven shared utility slots', () => {
  it('carries an additional class through unlocks, persistence, network, host placement and restore', async () => {
    const classId = 'dachs_of_steel';
    const tool: LoadoutToolRef = { kind: 'construction', id: 'machine_gun_turret' };
    const branch = ['unlock_machine_gun_turret', 'mg_attrition', 'mg_calibration', 'mg_optics', 'mg_fire_superiority'];
    const categories = getCoopDefenseUpgradeCategories(classId);
    const utilityNodes = categories.find(category => category.id === 'utility')!.upgrades.map(node => node.id);
    expect(utilityNodes).toEqual(expect.arrayContaining([...branch, 'mg_fire_control_network', 'mg_bleed', 'mg_handoff']));
    let profile = sanitizeCoopDefenseUpgradeProfile({ upgrades: Object.fromEntries(branch.map(id => [id, { level: 1 }])) }, classId);
    expect(getCoopDefenseToolCapacity(profile, classId)).toBe(1);
    profile = setLoadoutToolSlots(profile, [tool], classId);
    expect(profile.toolLoadout).toEqual([tool]);
    expect(getSelectableLoadoutItems('utility', 'coop_defense', profile, classId).map(entry => entry.id)).toContain(tool.id);
    expect(setLoadoutToolSlots(profile, [tool, { kind: 'utility', id: 'HE_GRENADE' }], classId).toolLoadout).toEqual([tool]);
    const totals = getCoopDefenseResolvedEffectTotals(profile, classId);
    const stats = resolveMgTurretStats(stat => totals.additive[stat] ?? 0, stat => totals.percentage[stat] ?? 0);
    expect(stats.targetRange).toBeGreaterThan(resolveMgTurretStats().targetRange);
    expect(stats.cooldownMs).toBeLessThan(resolveMgTurretStats().cooldownMs);

    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
    setStoredCoopDefenseClassesUnlocked(true);
    setStoredCoopDefenseUpgradeProfile(profile, classId);
    const saved = exportStoredGameProgressJson();
    invalidateLocalStorageCache();
    expect(importStoredGameProgressJson(saved).ok).toBe(true);
    profile = getStoredCoopDefenseUpgradeProfile(classId);
    expect(profile.toolLoadout).toEqual([tool]);
    expect(profile.upgrades.mg_optics.level).toBe(1);

    const network = new FakeNetwork();
    const hostRoom = await createHostRoom(network), clientRoom = await addClientRoom(network);
    const use = (room: TestRoom) => setActiveSession({ room: room.room, transport: room.transport, roomCode: 'TOOLS' });
    use(hostRoom); const host = new NetworkBridge(); host.activate(); host.publishLobbySync();
    use(clientRoom); const client = new NetworkBridge(); client.activate();
    const playerId = client.getLocalPlayerId();
    client.setLocalLobbyLoadoutPreview({ coopDefenseClassId: classId, coopDefenseProfile: profile, tools: [tool] });
    clientRoom.room.update();
    const snapshot = (bridge: NetworkBridge): LoadoutCommitSnapshot => {
      const preview = bridge.getPlayerLobbyLoadoutPreview(playerId)!;
      return { weapon1: 'GLOCK', weapon2: 'P90', utility: 'ROCK_BARRIER', ultimate: 'ARMAGEDDON',
        coopDefenseClassId: preview.coopDefenseClassId, coopDefenseProfile: preview.coopDefenseProfile!, tools: preview.tools };
    };
    const clientSnapshot = snapshot(client);
    expect(resolveConstructionAccess(tool.id, getConstructionAccessContext('coop_defense', clientSnapshot)).allowed).toBe(true);
    for (const invalid of [
      { ...clientSnapshot, tools: [] },
      { ...clientSnapshot, coopDefenseClassId: 'dachs_nukem' as const },
      { ...clientSnapshot, coopDefenseProfile: buildDefaultCoopDefenseUpgradeProfile(classId) },
    ]) {
      expect(resolveConstructionAccess(tool.id, getConstructionAccessContext('coop_defense', invalid)).allowed).toBe(false);
    }
    use(hostRoom);
    let current = snapshot(host);
    expect(current.tools).toEqual([tool]);
    const metrics = resolveActiveArenaWorldMetrics();
    const point = worldCellCenter(metrics, 10, 10);
    const layout: ArenaLayout = { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] };
    const players = { getPlayer: () => ({ id: playerId, ...point, active: true, color: 0xffffff }), getAllPlayers: () => [] };
    const placement = new PlacementSystem(layout, new RockGridIndex([]), players as never, metrics);
    const runtime = new ConstructionWorldRuntime({
      isHost: () => true, getGameMode: () => 'coop_defense', getCurrentLoadout: () => current,
      getPersistentBaseContext: () => null, getPlayerCapabilities: () => ({ canPlace: true }),
      playerManager: players, placementSystem: placement, combatSystem: { isAlive: () => true, isBurrowed: () => false },
      modifierReadPort: { getNumericStat: (_id: string, stat: string) => totals.additive[stat] ?? 0,
        getPercentageStat: (_id: string, stat: string) => totals.percentage[stat] ?? 0, getModifiers: () => null },
      getLocalPlayerId: () => playerId, resolveOwnerId: () => 'owner',
      rockVisualHelper: { materializePlaceableRock: vi.fn() }, emitGridChanged: vi.fn(),
      publishUtilityCooldown: vi.fn(), recordConstructionBuilt: vi.fn(),
    } as never);
    expect(runtime.placeInspectorConstruction(playerId, 'machine_gun_turret', point.x, point.y, 100)).toEqual({ ok: true });
    const built = placement.getAllRuntimeRocks()[0];
    expect(built.targetRange).toBe(stats.targetRange);
    const restoreTool = runtime.buildRestoreTools(playerId).find(entry => entry.id === tool.id)!;
    expect(restoreTool).toMatchObject({ unlocked: true, active: true });
    const restored = runtime.materializeRestoreCandidate({ tool: restoreTool, gridX: 12, gridY: 10,
      blueprint: { persistentId: 'saved', tool, relativeGridX: 2, relativeGridY: 0, angle: 0 } }, playerId, 0xffffff, 'host-persistent');
    expect(restored?.targetRange).toBe(stats.targetRange);
    expect(runtime.getEffectiveDefinition('machine_gun_turret', playerId, false)).toBe(COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret);

    current = { ...current, tools: [] }; // A stale utility projection must not authorize a tool.
    expect(runtime.placeInspectorConstruction(playerId, 'machine_gun_turret', point.x, point.y, 1000).ok).toBe(false);
    expect(runtime.buildRestoreTools(playerId).find(entry => entry.id === tool.id)).toMatchObject({ unlocked: true, active: false });
    expect(resolveConstructionAccess('rock_barrier', getConstructionAccessContext('coop_defense', current)).allowed).toBe(false);
    expect(runtime.useInspectorUtility(playerId, { kind: 'utility', id: 'HE_GRENADE' }, 0, point.x, point.y, 1000).ok).toBe(false);
    current = { ...current, tools: [{ kind: 'utility', id: 'HE_GRENADE' }] };
    expect(runtime.useInspectorUtility(playerId, { kind: 'utility', id: 'SMOKE_GRENADE' }, 0, point.x, point.y, 1000).ok).toBe(false);
    current = { ...current, tools: [tool], coopDefenseClassId: 'dachs_nukem' };
    expect(runtime.placeInspectorConstruction(playerId, 'machine_gun_turret', point.x, point.y, 1000).ok).toBe(false);
    current = { ...current, coopDefenseClassId: classId, coopDefenseProfile: buildDefaultCoopDefenseUpgradeProfile(classId) };
    expect(runtime.placeInspectorConstruction(playerId, 'machine_gun_turret', point.x, point.y, 1000).ok).toBe(false);
    expect(respecCoopDefenseUpgradeCategory(profile, 'utility', classId)?.toolLoadout).not.toContainEqual(tool);
  });
});
