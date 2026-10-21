import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { WaterGeometry } from '../src/arena/WaterGeometry';
import { getBridgeDeckWorldRect, resolveCollisionWater } from '../src/arena/BridgeGeometry';
import { CELL_SIZE, getArenaMetricsProfile } from '../src/config';
import { BRIDGE_DEMOLITION_RULES } from '../src/config/bridges';
import { decodeBridgeStates } from '../src/network/NetworkBridge';
import { FULL_GAME_STATE_SLICE_KEYS } from '../src/network/FullGameStateBootstrap';
import { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import { NavigationGeometry } from '../src/systems/navigation/NavigationGeometry';
import type { ArenaBridge, WaterCell } from '../src/types';
import { WorldBridgeRuntime, type WorldBridgeHostPort } from '../src/world/WorldBridgeRuntime';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';

const metrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA', 40, 30));
const BRIDGE: ArenaBridge = { id: 'river-bridge', axis: 'horizontal', gridX: 10, gridY: 8, spanCells: 4, deckWidthCells: 3 };
const water: WaterCell[] = [];
for (let y = 0; y < 30; y++) for (let x = 10; x < 14; x++) water.push({ gridX: x, gridY: y });

function hostPort(overrides: Partial<WorldBridgeHostPort> = {}) {
  const calls: string[] = [];
  let now = 1000;
  const port: WorldBridgeHostPort & { calls: string[]; advance: (ms: number) => void } = {
    calls,
    advance: (ms) => { now += ms; },
    now: () => now,
    isFuseClockRunning: () => true,
    listDeckVictims: () => { calls.push('victims'); return { players: ['p1'], enemies: ['e1'], bosses: ['boss'] }; },
    killPlayer: (id) => calls.push(`kill-player:${id}`),
    killEnemy: (id, credit) => calls.push(`kill-enemy:${id}:${credit}`),
    damageBoss: (id, fraction) => calls.push(`boss:${id}:${fraction}`),
    detonate: (_x, _y, credit) => calls.push(`detonate:${credit}`),
    relocateGroundItems: () => calls.push('relocate'),
    ...overrides,
  };
  return port;
}

function runtime(host?: WorldBridgeHostPort) {
  const geometry = { collapsed: [] as string[][], setCollapsedBridges(ids: ReadonlySet<string>) { this.collapsed.push([...ids]); } };
  const owner = new WorldBridgeRuntime({ bridges: [BRIDGE], origin: metrics, geometry, host });
  return { owner, geometry };
}

describe('World bridge runtime', () => {
  it('burns the fuse in host time and resolves a collapse in its fixed order', () => {
    const host = hostPort();
    const { owner, geometry } = runtime(host);
    expect(owner.charge(BRIDGE.id, 'p2')).toBe('charged');
    expect(owner.charge(BRIDGE.id, 'p3')).toBe('charged-already');
    expect(owner.getSnapshot()).toEqual([{ id: BRIDGE.id, phase: 'charged', detonatesAt: 1000 + BRIDGE_DEMOLITION_RULES.fuseMs }]);
    host.advance(BRIDGE_DEMOLITION_RULES.fuseMs - 1);
    owner.hostStep();
    expect(owner.isStanding(BRIDGE.id)).toBe(false);
    expect(geometry.collapsed).toEqual([]);
    host.advance(1);
    owner.hostStep();
    expect(owner.getState(BRIDGE.id)?.phase).toBe('collapsed');
    // Victims are read on the standing deck; kills follow the geometry flip.
    expect(host.calls).toEqual(['victims', 'kill-player:p1', 'kill-enemy:e1:p2',
      `boss:boss:${BRIDGE_DEMOLITION_RULES.bossDamageFraction}`, 'detonate:p2', 'relocate']);
    expect(geometry.collapsed).toEqual([[BRIDGE.id]]);
    expect(owner.getSnapshot()).toEqual([{ id: BRIDGE.id, phase: 'collapsed' }]);
    expect(owner.collapse(BRIDGE.id)).toBe(false);
    expect(owner.charge(BRIDGE.id, 'p2')).toBe('collapsed');
  });

  it('keeps fuses still outside a live Activity and lets clients only project', () => {
    let live = false;
    const host = hostPort({ isFuseClockRunning: () => live });
    const { owner } = runtime(host);
    owner.charge(BRIDGE.id, null);
    host.advance(BRIDGE_DEMOLITION_RULES.fuseMs * 3);
    owner.hostStep();
    expect(owner.getState(BRIDGE.id)?.phase).toBe('charged');
    live = true;
    owner.hostStep();
    expect(owner.getState(BRIDGE.id)?.phase).toBe('collapsed');

    const client = runtime();
    expect(client.owner.charge(BRIDGE.id, 'p1')).toBe('unknown');
    client.owner.applySnapshot([{ id: BRIDGE.id, phase: 'charged', detonatesAt: 5 }, { id: 'unknown', phase: 'collapsed' }]);
    expect(client.owner.getState(BRIDGE.id)).toEqual({ phase: 'charged', detonatesAt: 5 });
    expect(client.geometry.collapsed).toEqual([]);
    client.owner.applySnapshot([{ id: BRIDGE.id, phase: 'collapsed' }]);
    client.owner.applySnapshot([]);
    expect(client.owner.getState(BRIDGE.id)?.phase).toBe('collapsed');
    expect(client.geometry.collapsed).toEqual([[BRIDGE.id]]);
  });

  it('decodes the bg slice defensively and requires it in full snapshots', () => {
    expect(FULL_GAME_STATE_SLICE_KEYS).toContain('bg');
    expect(decodeBridgeStates(undefined)).toBeUndefined();
    expect(decodeBridgeStates('x')).toEqual([]);
    expect(decodeBridgeStates([
      { id: 'a', phase: 'collapsed' },
      { id: 'b', phase: 'charged', detonatesAt: 12 },
      { id: 'c', phase: 'charged' },
      { id: '', phase: 'collapsed' },
      { id: 'd', phase: 'standing' },
    ])).toEqual([{ id: 'a', phase: 'collapsed' }, { id: 'b', phase: 'charged', detonatesAt: 12 }]);
  });
});

describe('bridge collision geometry', () => {
  const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: metrics.offsetX, offsetY: metrics.offsetY,
    width: metrics.widthPx, height: metrics.heightPx }), rocks: () => [], trunks: () => [], bases: () => [] });
  const deck = getBridgeDeckWorldRect(BRIDGE, metrics);
  const west = { x: deck.x - CELL_SIZE, y: deck.y + deck.height / 2 };
  const east = { x: deck.x + deck.width + CELL_SIZE, y: west.y };

  it('opens a walkable deck while the bridge stands and closes it like any shore once it fell', () => {
    index.setWaterGeometry(new WaterGeometry(resolveCollisionWater(water, [BRIDGE]), metrics));
    const standing = new NavigationGeometry(index.snapshotMovementGeometry());
    expect(standing.canMove(west.x, west.y, east.x, east.y, 12)).toBe(true);
    expect(index.isCircleBlocked(deck.x + deck.width / 2, west.y, 12)).toBe(false);

    index.setWaterGeometry(new WaterGeometry(resolveCollisionWater(water, [BRIDGE], new Set([BRIDGE.id])), metrics));
    const collapsed = new NavigationGeometry(index.snapshotMovementGeometry());
    expect(collapsed.canMove(west.x, west.y, east.x, east.y, 12)).toBe(false);
    expect(index.isCircleBlocked(deck.x + deck.width / 2, west.y, 12)).toBe(true);
    // Swimmers ignore water obstacles either way.
    expect(collapsed.snapshot.obstacles.some((obstacle) => obstacle.id.startsWith('water:'))).toBe(true);
  });
});
