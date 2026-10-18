import { isPermanentVoidGroundHazard, type CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { CELL_SIZE } from '../config';
import { MAX_VOID_DANGER_ALERTS, voidHazardSource, type ActivityVoidDanger, type VoidDangerAlert, type VoidDangerSource } from '../arena/VoidDangerField';
import { spawnZoneAlertLevel } from '../systems/CoopDefenseSpawnZoneAlerts';
import type { ArenaLayout, CoopDefenseSecondaryObjectivePresentationState, SyncedSpawnZoneAlert } from '../types';

/** What the projection reads; every answer may be null while the Activity is not running. */
export interface CoopMissionVoidDangerPorts {
  getMapConfig(): CoopDefenseMapConfig | null;
  getLayout(): ArenaLayout | null;
  /** World top-left of arena cell (0, 0). */
  getOffset(): { readonly offsetX: number; readonly offsetY: number } | null;
  getBase(id: string): { isDestroyed(): boolean; getSpec(): { readonly dormantObjectiveId?: string } } | undefined;
  getObjectives(): CoopDefenseSecondaryObjectivePresentationState | null;
  /** Host-announced spawn zones and the mission time they refer to; null outside a round. */
  getSpawnZoneAlerts(): readonly SyncedSpawnZoneAlert[];
  getMissionElapsedMs(): number | null;
}

/** A warning settles this fast once its zone is quiet again, also when the host replaces it. */
const ALERT_SETTLE_MS = 2500;

const BASE_PREFIX = 'base:';

/**
 * The Coop mission's share of the void danger (GDD Void-Gefahrenzonen V1), a pure read of
 * replicated state, identical on host and clients:
 *
 * - permanent void ground hazards from the start (`isPermanentVoidGroundHazard`) over their
 *   generated cells;
 * - presence: a destroyed base, or one whose site objective is done or failed (a Dawn site closed
 *   at dusk), lets its haze lift.
 */
export class CoopMissionVoidDanger implements ActivityVoidDanger {
  private cache: { mapConfig: CoopDefenseMapConfig; layout: ArenaLayout; offsetX: number; offsetY: number; sources: readonly VoidDangerSource[] } | null = null;
  private objectiveCache: { raw: CoopDefenseSecondaryObjectivePresentationState | null; closed: ReadonlySet<string> } = { raw: null, closed: new Set() };
  /** Shown build-up per zone: rises with the host's announcement, never drops faster than it settles. */
  private readonly shown = new Map<string, number>();
  private alertTime = NaN;
  private alertFrame: readonly VoidDangerAlert[] = [];

  constructor(private readonly ports: CoopMissionVoidDangerPorts) {}

  /** This frame's answer, or null while no mission World is laid out. */
  read(): ActivityVoidDanger | null {
    return this.ports.getMapConfig() && this.ports.getLayout() && this.ports.getOffset() ? this : null;
  }

  get sources(): readonly VoidDangerSource[] {
    const mapConfig = this.ports.getMapConfig(), layout = this.ports.getLayout(), offset = this.ports.getOffset();
    if (!mapConfig || !layout || !offset) return [];
    const cached = this.cache;
    if (cached && cached.mapConfig === mapConfig && cached.layout === layout && cached.offsetX === offset.offsetX && cached.offsetY === offset.offsetY) return cached.sources;
    const sources = resolvePermanentVoidHazardSources(mapConfig, layout, offset.offsetX, offset.offsetY);
    this.cache = { mapConfig, layout, offsetX: offset.offsetX, offsetY: offset.offsetY, sources };
    return sources;
  }

  /**
   * Spawn zone warnings of this frame (GDD Void-Gefahrenzonen V1, E4/E8): each announced zone's
   * build-up as a world rectangle, strongest first. A replaced or withdrawn announcement settles
   * instead of vanishing.
   */
  get alerts(): readonly VoidDangerAlert[] {
    const now = this.ports.getMissionElapsedMs(), mapConfig = this.ports.getMapConfig(), offset = this.ports.getOffset();
    if (now === null || !mapConfig || !offset) { this.shown.clear(); this.alertTime = NaN; return this.alertFrame = []; }
    if (now === this.alertTime) return this.alertFrame;
    const step = Number.isFinite(this.alertTime) ? Math.max(0, now - this.alertTime) : 0;
    this.alertTime = now;
    const targets = new Map<string, number>();
    for (const alert of this.ports.getSpawnZoneAlerts()) targets.set(alert.zoneId, spawnZoneAlertLevel(alert, now, ALERT_SETTLE_MS));
    for (const zoneId of new Set([...targets.keys(), ...this.shown.keys()])) {
      const target = targets.get(zoneId) ?? 0, shown = this.shown.get(zoneId) ?? 0;
      const level = Math.max(target, shown - step / ALERT_SETTLE_MS);
      if (level > .002) this.shown.set(zoneId, level); else this.shown.delete(zoneId);
    }
    const zones = new Map((mapConfig.spawnZones ?? []).map(zone => [zone.id, zone]));
    const frame: VoidDangerAlert[] = [];
    for (const [zoneId, level] of this.shown) {
      const zone = zones.get(zoneId);
      if (!zone) continue;
      frame.push({ x: offset.offsetX + zone.gridX * CELL_SIZE, y: offset.offsetY + zone.gridY * CELL_SIZE,
        width: zone.widthCells * CELL_SIZE, height: zone.heightCells * CELL_SIZE, level });
    }
    frame.sort((left, right) => right.level - left.level);
    return this.alertFrame = frame.slice(0, MAX_VOID_DANGER_ALERTS);
  }

  presenceOf(id: string): number {
    if (!id.startsWith(BASE_PREFIX)) return 1;
    const base = this.ports.getBase(id.slice(BASE_PREFIX.length));
    if (!base) return 1;
    if (base.isDestroyed()) return 0;
    const objectiveId = base.getSpec().dormantObjectiveId;
    return objectiveId !== undefined && this.closedObjectives().has(objectiveId) ? 0 : 1;
  }

  private closedObjectives(): ReadonlySet<string> {
    const raw = this.ports.getObjectives();
    if (raw !== this.objectiveCache.raw) {
      this.objectiveCache = { raw, closed: new Set((raw ?? []).filter(entry => entry.state === 'completed' || entry.state === 'failed').map(entry => entry.objectiveId)) };
    }
    return this.objectiveCache.closed;
  }
}

/** Danger sources of the mission's permanent void ground hazards, one per event. */
export function resolvePermanentVoidHazardSources(mapConfig: CoopDefenseMapConfig, layout: ArenaLayout,
  offsetX: number, offsetY: number): VoidDangerSource[] {
  const events = (mapConfig.mapEvents ?? []).filter(isPermanentVoidGroundHazard);
  if (events.length === 0) return [];
  const cells = new Map<string, { gridX: number; gridY: number }[]>();
  for (const zone of layout.groundHazardZones ?? []) {
    const list = cells.get(zone.eventId) ?? [];
    list.push(...zone.cells);
    cells.set(zone.eventId, list);
  }
  return events.flatMap(event => {
    const list = cells.get(event.id);
    return list?.length ? [voidHazardSource(event.id, offsetX, offsetY, list, mapConfig.voidDanger?.intensity)] : [];
  });
}
