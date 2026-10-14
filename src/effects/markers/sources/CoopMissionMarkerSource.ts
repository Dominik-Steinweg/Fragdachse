import { CELL_SIZE } from '../../../config';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig, ResolvedCoopDefenseMapMissionProgressConfig } from '../../../config/coopDefenseMapAuthoring';
import type { CoopDefenseSecondaryObjectivePresentationState, CoopDefenseMissionProgressPresentationState, SyncedCoopDefenseCarryItem } from '../../../types';
import type { WorldMetrics } from '../../../world/WorldMetrics';
import { isCarryDeliveryZoneMarked } from '../../../ui/coopDefenseSecondaryObjectiveModel';
import type { MarkerDescriptor, MarkerSource } from '../MarkerTypes';
import { BaseAttackMarkerModel, type BaseAttackTarget } from './BaseAttackMarkerModel';

export interface MarkerTargetBounds {
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
  readonly dormant?: boolean; readonly destroyed?: boolean;
}
export interface EnemyMarkerTarget {
  readonly id: string; readonly generation: number; readonly x: number; readonly y: number;
  readonly size: number; readonly boss: boolean; readonly vulnerable: boolean;
  readonly timebomb: boolean; readonly fuseProgress?: number;
}
type Origin = Pick<WorldMetrics, 'offsetX' | 'offsetY'>;
const pose = (b: MarkerTargetBounds) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2, targetHalfHeight: b.height / 2 });
const progress = (current: number, total: number) => total > 0 ? Math.max(0, Math.min(1, current / total)) : undefined;

/** Pure projections: all positions/states come from the existing local presentation read models. */
export function mainObjectiveMarkers(id: string, bounds: MarkerTargetBounds | null): MarkerDescriptor[] {
  return bounds && !bounds.destroyed && !bounds.dormant ? [{ key: `main:${id}`, kind: 'main-objective',
    state: 'active', glyph: 'base', ...pose(bounds), visibility: 'world-and-edge' }] : [];
}

export function enemyMarkers(enemies: readonly EnemyMarkerTarget[]): MarkerDescriptor[] {
  return enemies.flatMap<MarkerDescriptor>(e => {
    const common = { x: e.x, y: e.y, targetHalfHeight: e.size / 2, state: 'active' as const };
    const key = `enemy:${e.id}:${e.generation}`;
    if (e.timebomb) return [{ ...common, key: `hazard:${key}`, kind: 'hazard' as const, glyph: 'timebomb' as const,
      visibility: 'world-and-edge' as const, urgent: true, progress: e.fuseProgress, bundleKey: 'hazard:timebomb' }];
    if (e.boss) return [{ ...common, key: `boss:${key}`, kind: 'boss' as const, glyph: 'boss' as const,
      visibility: 'edge-when-offscreen' as const, vulnerable: e.vulnerable }];
    return [];
  });
}

export function secondaryObjectiveMarkers(
  snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
  configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
  carry: readonly SyncedCoopDefenseCarryItem[], origin: Origin,
  boundsFor: (id: string) => MarkerTargetBounds | null,
): MarkerDescriptor[] {
  const out: MarkerDescriptor[] = [];
  for (const entry of snapshot ?? []) {
    if (entry.state === 'dormant') continue;
    const config = configs.find(c => c.id === entry.objectiveId);
    if (!config) continue;
    // Site-activated objectives belong to a world site; its own source keeps one marker from dormant to resolved.
    // Carry items and the delivery zone of a site still come from here.
    const siteOwned = config.start.type === 'site-activated';
    if (siteOwned && config.type !== 'carry') continue;
    // Focus remains a semantic grouping boundary; different objective types never share a glyph.
    const group = `mission:${config.type}:${entry.focused ? 'focus' : 'background'}`;
    const common = { state: entry.state, focused: entry.focused, progress: progress(entry.progressCurrent, entry.progressTotal),
      visibility: 'world-and-edge' as const };
    if (config.type === 'carry') {
      if (config.carry && !siteOwned) {
        const z = config.carry.spawnZone;
        const bounds = { x: origin.offsetX + z.gridX * CELL_SIZE, y: origin.offsetY + z.gridY * CELL_SIZE,
          width: z.widthCells * CELL_SIZE, height: z.heightCells * CELL_SIZE };
        out.push({ ...common, key: `mission:${encodeURIComponent(config.id)}:spawn`, kind: 'mission', glyph: 'mission-carry',
          ...pose(bounds), visibility: 'world-only', groundRing: { radiusPx: Math.max(bounds.width, bounds.height) / 2 } });
      }
      for (const item of carry) {
        if (item.objectiveId !== entry.objectiveId || item.holderId !== null) continue;
        out.push({ ...common, key: `mission:${encodeURIComponent(config.id)}:carry:${item.id}`, kind: 'carry', glyph: 'crate', x: item.x, y: item.y,
          // The existing Carry runtime uses a 16px item body, independent of the bottle sprite.
          targetHalfHeight: 8, bundleKey: `${group}:carry` });
      }
      if (config.carry && isCarryDeliveryZoneMarked(carry, entry.objectiveId)) {
        const z = config.carry.deliveryZone;
        const bounds = { x: origin.offsetX + z.gridX * CELL_SIZE, y: origin.offsetY + z.gridY * CELL_SIZE,
          width: z.widthCells * CELL_SIZE, height: z.heightCells * CELL_SIZE };
        out.push({ ...common, key: `mission:${encodeURIComponent(config.id)}:delivery`, kind: 'delivery', glyph: 'flag', ...pose(bounds),
          groundRing: { radiusPx: Math.max(bounds.width, bounds.height) / 2, tone: 'green' }, bundleKey: `${group}:delivery` });
      }
    } else {
      for (const id of config.targets) {
        const bounds = boundsFor(id);
        if (!bounds || bounds.dormant || (bounds.destroyed && entry.state === 'active')) continue;
        out.push({ ...common, key: `mission:${encodeURIComponent(config.id)}:${id}`, kind: 'mission', glyph: `mission-${config.type}`,
          ...pose(bounds), groundRing: { radiusPx: Math.max(bounds.width, bounds.height) / 2 }, bundleKey: group });
      }
    }
  }
  return out;
}

export function checkpointMarkers(config: ResolvedCoopDefenseMapMissionProgressConfig | undefined,
  snapshot: CoopDefenseMissionProgressPresentationState | null, origin: Origin,
  clock?: { readonly nowMs: number; readonly elapsedMs: number }): MarkerDescriptor[] {
  if (!config || !snapshot) return [];
  return config.checkpoints.flatMap(c => {
    const completed = snapshot.completedCheckpoints.find(s => s.checkpointId === c.id);
    const activated = snapshot.activatedCheckpoints.some(s => s.checkpointId === c.id);
    if (!completed && !activated && snapshot.nextCheckpointId !== c.id) return [];
    return [{ key: `checkpoint:${c.id}`, kind: 'checkpoint' as const, glyph: 'flag' as const,
      state: completed ? 'completed' as const : activated ? 'active' as const : 'dormant' as const,
      x: origin.offsetX + (c.gridX + .5) * CELL_SIZE, y: origin.offsetY + (c.gridY + .5) * CELL_SIZE,
      targetHalfHeight: c.radiusCells * CELL_SIZE, groundRing: { radiusPx: c.radiusCells * CELL_SIZE },
      stateChangedAtMs: completed && clock ? clock.nowMs - Math.max(0, clock.elapsedMs - completed.completedAtRoundMs) : undefined,
      visibility: 'world-and-edge' as const }];
  });
}

/** One round's projections. First hydration is a baseline; only observed transitions get a local stamp. */
export class CoopMissionMarkerSource implements MarkerSource {
  readonly id = 'coop-mission';
  private readonly channels = new Map<string, readonly MarkerDescriptor[]>();
  private readonly history = new Map<string, MarkerDescriptor>();
  private readonly baseAttacks = new BaseAttackMarkerModel();

  setBaseAttacks(targets: readonly BaseAttackTarget[], nowMs: number): void {
    this.set('base-attacks', this.baseAttacks.project(targets, nowMs), nowMs);
  }

  setSecondary(descriptors: readonly MarkerDescriptor[], snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
    nowMs: number, elapsedMs = 0): void {
    if (!snapshot) { this.set('secondary', [], nowMs); return; }
    const keys = new Set(descriptors.map(d => d.key));
    const retained: MarkerDescriptor[] = [];
    for (const old of this.channels.get('secondary') ?? []) {
      if (keys.has(old.key)) continue;
      const terminal = snapshot.find(e => old.key.startsWith(`mission:${encodeURIComponent(e.objectiveId)}:`)
        && (e.state === 'completed' || e.state === 'failed'));
      if (terminal) retained.push({ ...old, state: terminal.state });
    }
    this.set('secondary', [...descriptors, ...retained].map(d => {
      const entry = snapshot.find(e => d.key.startsWith(`mission:${encodeURIComponent(e.objectiveId)}:`));
      return entry && (d.state === 'completed' || d.state === 'failed')
        ? { ...d, stateChangedAtMs: nowMs - Math.max(0, elapsedMs - entry.stateChangedAtMs) } : d;
    }), nowMs);
  }

  set(channel: string, descriptors: readonly MarkerDescriptor[], nowMs: number): void {
    const next = descriptors.map(d => {
      const before = this.history.get(d.key);
      const changed = before && before.state !== d.state;
      const marker = { ...d, stateChangedAtMs: changed ? nowMs : before?.stateChangedAtMs ?? d.stateChangedAtMs };
      this.history.set(d.key, marker);
      return marker;
    });
    this.channels.set(channel, next);
    const keys = new Set([...this.channels.values()].flatMap(markers => markers.map(d => d.key)));
    for (const key of this.history.keys()) if (!keys.has(key)) this.history.delete(key);
  }
  collect(out: MarkerDescriptor[]): void { for (const markers of this.channels.values()) out.push(...markers); }
  clear(): void { this.channels.clear(); this.history.clear(); this.baseAttacks.clear(); }
}
