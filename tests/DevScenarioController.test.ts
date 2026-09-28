import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../src/scenes/arena/ArenaRuntime';
import { defaultScenario, encodeScenario } from '../src/dev/scenario/config';
import { DevScenarioController } from '../src/dev/scenario/controller';

const host = vi.hoisted(() => ({ phase: 'LOBBY', started: false }));
vi.mock('../src/utils/devScenarioMode', () => ({ isDevScenarioMode: () => true }));
vi.mock('../src/dev/scenario/panel', () => ({ createScenarioPanel: () => ({ sync() {}, syncTarget() {}, refresh() {}, setCollapsed() {}, destroy() {} }) }));
vi.mock('../src/systems/navigation/NavigationGeometry', () => ({ NavigationGeometry: class { isFree() { return true; } } }));
vi.mock('../src/network/bridge', () => ({ bridge: {
  getGamePhase: () => host.phase, isArenaStarted: () => host.started, getLocalPlayerId: () => 'p1',
  sendLocalInput() {}, setLocalReady() {}, setGameMode() {}, setCoopDefenseMapId() {},
  setLocalReadyWithCommittedLoadout() {}, getSynchronizedNow: () => Date.now(), getPlayerCommittedLoadout: () => null,
  setDevScenarioPlayerFreeForAll() {}, setDevScenarioBotState() {},
} }));

let controller: DevScenarioController;
let player: { x: number; y: number; alive: boolean };
let attacks: string[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { hash: '' });
  vi.stubGlobal('history', { replaceState: (_a: unknown, _b: unknown, hash: string) => { location.hash = hash; } });
  host.phase = 'LOBBY'; host.started = false;
  player = { x: 208, y: 668, alive: true }; attacks = [];
  const runtime = {
    navigationLabPort: {
      setNextRoundSeed() {}, isReady: () => host.started,
      getPlayerPosition: () => ({ ...player }), getGeometry: () => ({}),
      placePlayer: (x: number, y: number) => { player.x = x; player.y = y; }, readEnemies: () => [],
    },
    devScenarioPort: { suppressEncounters() {}, setOptions() {}, readMission: () => ({}), updateTrain() {} },
    weaponBalanceLabPort: { setAdrenaline() {}, getMaxAdrenaline: () => 100,
      useWeaponAction: (slot: string) => { attacks.push(slot); return { ok: true }; } },
    rpcPorts: { heldAction: { clearPlayer() {} } },
    getWorldMetrics: () => ({ offsetX: 0, offsetY: 12, gridCols: 60, gridRows: 33 }),
    getScenarioLoadingState: () => ({ roundStartPrepared: true }), getScenarioObservation: () => ({}),
    getWorldDescriptor: () => ({}), getWorldCombatCore: () => null, setTimeOfDayDebugOverride() {},
    setIsLocalReady() {}, stopScenarioUltimate() {}, isMatchTerminated: () => false,
    hostDiscardRound: () => { host.phase = 'LOBBY'; host.started = false; },
  } as unknown as ArenaRuntime;
  const scene = { game: { loop: { callback() {} }, canvas: { width: 1920, height: 1080 }, renderer: { snapshot() {} } },
    cameras: { main: { scrollX: 0, scrollY: 0, zoomX: 1, zoomY: 1 } } } as unknown as Phaser.Scene;
  controller = new DevScenarioController(scene, runtime, () => {}, () => true);
});
afterEach(() => { controller.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function enter() {
  controller.start({ ...defaultScenario(), player: { gridX: 14, gridY: 23 } });
  controller.update(); controller.update();
  host.phase = 'ARENA'; host.started = true; controller.update();
}

describe('Dev scenario automation lifecycle', () => {
  it('publishes ready only after post-host start placement, and keeps held fire across teleport', async () => {
    enter();
    expect(controller.snapshot().ready).toBe(false);
    // Simulate a normal spawn reconciliation later in the same host frame.
    player.x = 208; player.y = 668;
    controller.afterHostFrame();
    expect(player).toMatchObject({ x: 464, y: 764 });
    expect((await window.devScenario!.whenReady()).ok).toBe(true);
    expect(window.devScenario!.run({ action: 'holdWeapon', slot: 'weapon2' }).ok).toBe(true);
    window.devScenario!.run({ action: 'teleport', gridX: 15, gridY: 23 });
    controller.update();
    expect(controller.snapshot().trigger).toBe('weapon2');
    expect(attacks).toEqual(['weapon2']);
    expect(player).toMatchObject({ x: 496, y: 764 });
  });
  it('applies hash-only recipe changes and preserves the running recipe for invalid hashes', () => {
    enter(); controller.afterHostFrame();
    location.hash = encodeScenario({ ...defaultScenario(), seed: 777 });
    window.dispatchEvent(new Event('hashchange'));
    expect(controller.config.seed).toBe(777);
    expect(controller.state).toBe('waiting-lobby');
    location.hash = '#scenario=invalid'; window.dispatchEvent(new Event('hashchange'));
    expect(controller.config.seed).toBe(777);
    expect(controller.lastAction).toMatchObject({ ok: false });
  });
  it('returns errors for invalid commands, detached snapshots and cancelled captures', async () => {
    enter(); controller.afterHostFrame();
    const api = window.devScenario!;
    expect(api.run({ action: 'holdWeapon', slot: 'typo' })).toMatchObject({ ok: false });
    const state = api.status(); (state.config as { seed: number }).seed = 7;
    expect(controller.config.seed).not.toBe(7);
    const capture = api.capture();
    controller.destroy();
    expect(await capture).toMatchObject({ ok: false });
    expect(window.devScenario).toBeUndefined();
    expect(api.run({ action: 'resume' })).toMatchObject({ ok: false });
  });
});
