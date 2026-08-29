import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { BURROW_DRAIN_INTERVAL_MS, BURROW_WINDUP_DURATION_MS } from '../src/config';
import type { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import { BurrowSystem } from '../src/systems/BurrowSystem';
import type { WorldMetrics } from '../src/world/WorldMetrics';

const PLAYER_ID = 'p1';

function worldMetrics(): WorldMetrics {
  return {
    widthPx: 256,
    heightPx: 256,
    offsetX: 0,
    offsetY: 0,
    maxX: 256,
    maxY: 256,
    viewportWidth: 256,
    viewportHeight: 256,
    gridCols: 8,
    gridRows: 8,
    trackSpawnMinCol: 0,
    trackSpawnMaxCol: 7,
    usesDynamicCamera: false,
    showStaticFrames: false,
  };
}

interface HarnessOptions {
  blocked?: (x: number, y: number, radius: number) => boolean;
  input?: { dx: number; dy: number };
  metrics?: WorldMetrics | null;
  drainToZero?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const player = {
    id: PLAYER_ID,
    x: 20,
    y: 48,
    getCollisionRadius: () => 16,
    setPosition(x: number, y: number): void {
      this.x = x;
      this.y = y;
    },
  };
  const setPosition = vi.spyOn(player, 'setPosition');
  const obstacleIndex = {
    isCircleBlocked: vi.fn((x: number, y: number, radius: number) => (
      options.blocked?.(x, y, radius) ?? false
    )),
  } as unknown as ArenaObstacleIndex;
  let adrenaline = 30;
  const resources = {
    getAdrenaline: vi.fn(() => adrenaline),
    drainAdrenaline: vi.fn(() => {
      adrenaline = options.drainToZero ? 0 : Math.max(0, adrenaline - 5);
    }),
  };
  const playerMgr = {
    getPlayer: vi.fn(() => player),
    getAllPlayers: vi.fn(() => [player]),
  };
  const combat = {
    isAlive: vi.fn(() => true),
    getObstacleIndex: vi.fn(() => obstacleIndex),
    applyDamage: vi.fn(),
  };
  const hostPhysics = {
    setPlayerBurrowed: vi.fn(),
    applyRadialImpulse: vi.fn(),
  };
  const bridge = {
    getPlayerInput: vi.fn(() => options.input ?? { dx: 0, dy: 0 }),
    broadcastBurrowVisual: vi.fn(),
    broadcastShockwaveEffect: vi.fn(),
  };
  const positionReset = vi.fn();
  const system = new BurrowSystem(
    resources as never,
    playerMgr as never,
    combat as never,
    hostPhysics as never,
    bridge as never,
  );
  system.setWorldMetrics(options.metrics === undefined ? worldMetrics() : options.metrics);
  system.setPositionResetCallback(positionReset);

  return {
    system,
    player,
    setPosition,
    obstacleIndex,
    resources,
    combat,
    hostPhysics,
    bridge,
    positionReset,
  };
}

function enterUnderground(system: BurrowSystem): void {
  system.initPlayer(PLAYER_ID);
  system.handleBurrowRequest(PLAYER_ID, true);
  vi.setSystemTime(BURROW_WINDUP_DURATION_MS);
  system.update(0);
  expect(system.getPhase(PLAYER_ID)).toBe('underground');
}

describe('BurrowSystem Exit Assist', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('snappt Manual auf die freie Rastermitte und setzt die Missionsposition zurück', () => {
    const harness = createHarness({ blocked: (x, y) => x === 20 && y === 48 });
    enterUnderground(harness.system);

    harness.system.handleBurrowRequest(PLAYER_ID, false);

    expect(harness.player.x).toBe(16);
    expect(harness.player.y).toBe(48);
    expect(harness.setPosition).toHaveBeenCalledWith(16, 48);
    expect(harness.positionReset).toHaveBeenCalledWith(PLAYER_ID, 16, 48);
    expect(harness.system.getPhase(PLAYER_ID)).toBe('recovery');
  });

  it('bleibt bei Manual ohne freien Rasterkandidaten underground', () => {
    const harness = createHarness({ blocked: () => true });
    enterUnderground(harness.system);

    harness.system.handleBurrowRequest(PLAYER_ID, false);

    expect(harness.setPosition).not.toHaveBeenCalled();
    expect(harness.positionReset).not.toHaveBeenCalled();
    expect(harness.system.getPhase(PLAYER_ID)).toBe('underground');
  });

  it('vereinheitlicht Depleted mit dem Assist-Resolver', () => {
    const harness = createHarness({
      blocked: (x, y) => x === 20 && y === 48,
      drainToZero: true,
    });
    enterUnderground(harness.system);

    harness.system.update(BURROW_DRAIN_INTERVAL_MS);

    expect(harness.resources.drainAdrenaline).toHaveBeenCalled();
    expect(harness.player.x).toBe(16);
    expect(harness.player.y).toBe(48);
    expect(harness.system.getPhase(PLAYER_ID)).toBe('recovery');
  });

  it('setzt Depleted ohne gültigen Exit in trapped', () => {
    const harness = createHarness({ blocked: () => true, drainToZero: true });
    enterUnderground(harness.system);

    harness.system.update(BURROW_DRAIN_INTERVAL_MS);

    expect(harness.system.getPhase(PLAYER_ID)).toBe('trapped');
    expect(harness.setPosition).not.toHaveBeenCalled();
  });

  it('versucht bei Trapped weiter den Exit und setzt nach späterem Freimachen zurück', () => {
    let candidatesFree = false;
    const harness = createHarness({
      blocked: (x, y) => !candidatesFree || (x === 20 && y === 48),
      drainToZero: true,
    });
    enterUnderground(harness.system);
    harness.system.update(BURROW_DRAIN_INTERVAL_MS);
    expect(harness.system.getPhase(PLAYER_ID)).toBe('trapped');

    candidatesFree = true;
    harness.system.update(0);

    expect(harness.player.x).toBe(16);
    expect(harness.player.y).toBe(48);
    expect(harness.system.getPhase(PLAYER_ID)).toBe('recovery');
  });

  it('setzt bei Trapped den bestehenden Schaden fort, wenn kein Exit möglich ist', () => {
    const harness = createHarness({ blocked: () => true, drainToZero: true });
    enterUnderground(harness.system);
    harness.system.update(BURROW_DRAIN_INTERVAL_MS);

    harness.system.update(1000);

    expect(harness.combat.applyDamage).toHaveBeenCalledWith(
      PLAYER_ID,
      25,
      true,
      undefined,
      undefined,
      { sourceX: 20, sourceY: 16 },
    );
    expect(harness.system.getPhase(PLAYER_ID)).toBe('trapped');
  });

  it('erzeugt Shockwave und Knockback an der korrigierten Position', () => {
    const harness = createHarness({ blocked: (x, y) => x === 20 && y === 48 });
    enterUnderground(harness.system);

    harness.system.handleBurrowRequest(PLAYER_ID, false);

    expect(harness.hostPhysics.applyRadialImpulse).toHaveBeenCalledWith(
      16,
      48,
      expect.any(Number),
      expect.any(Number),
      PLAYER_ID,
      0,
    );
    expect(harness.bridge.broadcastShockwaveEffect).toHaveBeenCalledTimes(1);
    expect(harness.bridge.broadcastShockwaveEffect).toHaveBeenCalledWith(16, 48);
  });

  it('setzt bei bereits freier Position weder Position noch Missionshistorie zurück', () => {
    const harness = createHarness();
    enterUnderground(harness.system);

    harness.system.handleBurrowRequest(PLAYER_ID, false);

    expect(harness.setPosition).not.toHaveBeenCalled();
    expect(harness.positionReset).not.toHaveBeenCalled();
    expect(harness.system.getPhase(PLAYER_ID)).toBe('recovery');
  });

  it('lässt den normalen completeTunnelTransit-Ablauf ohne Exact-Check unverändert', () => {
    const harness = createHarness({ blocked: () => true });

    harness.system.startTunnelTransit(PLAYER_ID);
    harness.system.completeTunnelTransit(PLAYER_ID);

    expect(harness.obstacleIndex.isCircleBlocked).not.toHaveBeenCalled();
    expect(harness.setPosition).not.toHaveBeenCalled();
    expect(harness.system.getPhase(PLAYER_ID)).toBe('recovery');
  });

  it('prüft im defensiven requestExit-Tunnelpfad nur die aktuelle Kreisposition', () => {
    const free = createHarness({ blocked: () => false });
    free.system.startTunnelTransit(PLAYER_ID);
    free.system.handleBurrowRequest(PLAYER_ID, false);

    expect(free.obstacleIndex.isCircleBlocked).toHaveBeenCalledTimes(1);
    expect(free.obstacleIndex.isCircleBlocked).toHaveBeenCalledWith(20, 48, 16);
    expect(free.setPosition).not.toHaveBeenCalled();
    expect(free.system.getPhase(PLAYER_ID)).toBe('recovery');

    const blocked = createHarness({ blocked: () => true });
    blocked.system.startTunnelTransit(PLAYER_ID);
    blocked.system.handleBurrowRequest(PLAYER_ID, false);

    expect(blocked.obstacleIndex.isCircleBlocked).toHaveBeenCalledTimes(1);
    expect(blocked.setPosition).not.toHaveBeenCalled();
    expect(blocked.system.getPhase(PLAYER_ID)).toBe('underground');
  });

  it('führt ohne WorldMetrics keinen rasterbasierten Assist aus', () => {
    const harness = createHarness({
      metrics: null,
      blocked: (x, y) => x === 20 && y === 48,
    });
    enterUnderground(harness.system);

    harness.system.handleBurrowRequest(PLAYER_ID, false);

    expect(harness.obstacleIndex.isCircleBlocked).toHaveBeenCalledTimes(1);
    expect(harness.obstacleIndex.isCircleBlocked).toHaveBeenCalledWith(20, 48, 16);
    expect(harness.setPosition).not.toHaveBeenCalled();
    expect(harness.system.getPhase(PLAYER_ID)).toBe('underground');
  });
});
