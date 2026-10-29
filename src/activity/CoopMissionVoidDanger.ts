import { isPermanentVoidGroundHazard, type CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { CELL_SIZE } from '../config';
import {
  MAX_VOID_DANGER_ALERTS, VOID_ZONE_SOURCE, voidHazardSource, type ActivityVoidDanger, type VoidDangerAlert, type VoidDangerSource,
  type VoidMarchers, type VoidMarcherSample,
} from '../arena/VoidDangerField';
import { SPAWN_ZONE_ALERT_LEAD_MS, spawnZoneAlertLevel } from '../systems/CoopDefenseSpawnZoneAlerts';
import type { ArenaLayout, CoopDefenseSecondaryObjectivePresentationState, SyncedSpawnPlaceState, SyncedSpawnZoneAlert } from '../types';

/** What the projection reads; every answer may be null while the Activity is not running. */
export interface CoopMissionVoidDangerPorts {
  getMapConfig(): CoopDefenseMapConfig | null;
  getLayout(): ArenaLayout | null;
  /** World top-left of arena cell (0, 0). */
  getOffset(): { readonly offsetX: number; readonly offsetY: number } | null;
  getBase(id: string): { isDestroyed(): boolean; isDormant(): boolean; getSpec(): { readonly dormantObjectiveId?: string } } | undefined;
  getObjectives(): CoopDefenseSecondaryObjectivePresentationState | null;
  /** Host view of the spawn zones in use or still to come and of lapsed dormant objectives. */
  getSpawnPlaces(): SyncedSpawnPlaceState | null;
  /** Host-announced spawn zones and the mission time they refer to; null outside a round. */
  getSpawnZoneAlerts(): readonly SyncedSpawnZoneAlert[];
  getMissionElapsedMs(): number | null;
  /** The mission's enemies as trail samples (E12), through one reused sample; nothing outside a round. */
  forEachVoidMarcher(visit: (sample: Readonly<VoidMarcherSample>) => void): void;
}

/** A warning settles this fast once its zone is quiet again, also when the host replaces it. */
const ALERT_SETTLE_MS = 2500;
/**
 * A warning that arrives without its lead swells in over this long (user 2026-10-20: the haze popped
 * up). A checkpoint, event or base trigger has no predictable time, so the host announces its groups
 * only when they spawn; a late joiner sees a running warning at full strength at once.
 */
const ALERT_SWELL_MS = 2400;
/** Rising faster than this (per ms) is a jump: an announced lead rises by at most 1.5 / lead. */
const ALERT_JUMP_RATE = 2 / SPAWN_ZONE_ALERT_LEAD_MS;

const BASE_PREFIX = 'base:';
const ZONE_PREFIX = VOID_ZONE_SOURCE;
/**
 * Haze of a spawn place that is not releasing enemies yet: a zone a later encounter will use, a
 * dormant spawn point. A place that never will again carries none (user 2026-10-19).
 */
export const IDLE_SPAWN_PLACE_PRESENCE = .45;

/**
 * The Coop mission's share of the void danger (GDD Void-Gefahrenzonen V1), a pure read of
 * replicated state, identical on host and clients:
 *
 * - permanent void ground hazards from the start (`isPermanentVoidGroundHazard`) over their
 *   generated cells;
 * - presence of hostile bases: full while active, thinner while dormant, none once destroyed or
 *   once their site objective is done, failed or lapsed (a Dawn site closed or never entered);
 * - presence of spawn zones: full while in use, thinner while a later encounter, source or boss
 *   will still use them, none once nothing will.
 */
export class CoopMissionVoidDanger implements ActivityVoidDanger {
  private cache: { mapConfig: CoopDefenseMapConfig; layout: ArenaLayout; offsetX: number; offsetY: number; sources: readonly VoidDangerSource[] } | null = null;
  private objectiveCache: { raw: CoopDefenseSecondaryObjectivePresentationState | null; closed: ReadonlySet<string> } = { raw: null, closed: new Set() };
  /** Shown build-up per zone: rises with the host's announcement, never drops faster than it settles. */
  private readonly shown = new Map<string, number>();
  /** Zones whose warning jumped up: the shown level eases from `from` to the target from `startMs`. */
  private readonly swells = new Map<string, { from: number; startMs: number }>();
  private alertTime = NaN;
  private alertFrame: readonly VoidDangerAlert[] = [];

  /** The mission's hostile enemies lay void trails where they walk (E12); the same object every frame. */
  readonly marchers: VoidMarchers;

  constructor(private readonly ports: CoopMissionVoidDangerPorts) {
    this.marchers = { forEach: visit => ports.forEachVoidMarcher(visit) };
  }

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
    if (now === null || !mapConfig || !offset) { this.shown.clear(); this.swells.clear(); this.alertTime = NaN; return this.alertFrame = []; }
    if (now === this.alertTime) return this.alertFrame;
    const step = Number.isFinite(this.alertTime) ? Math.max(0, now - this.alertTime) : 0;
    this.alertTime = now;
    const targets = new Map<string, number>();
    // Spawn structures charge themselves (SpawnStructureRenderer); only zones thicken their haze.
    for (const alert of this.ports.getSpawnZoneAlerts()) {
      if (!alert.structure) targets.set(alert.zoneId, spawnZoneAlertLevel(alert, now, ALERT_SETTLE_MS));
    }
    for (const zoneId of new Set([...targets.keys(), ...this.shown.keys()])) {
      const target = targets.get(zoneId) ?? 0, shown = this.shown.get(zoneId) ?? 0;
      let swell = this.swells.get(zoneId);
      if (!swell && target > shown + Math.max(.02, step * ALERT_JUMP_RATE)) this.swells.set(zoneId, swell = { from: shown, startMs: now });
      let level: number;
      if (swell && target >= shown) {
        const k = Math.min(1, Math.max(0, (now - swell.startMs) / ALERT_SWELL_MS));
        level = swell.from + (target - swell.from) * k * k * (3 - 2 * k);
        if (k >= 1) this.swells.delete(zoneId);
      } else {
        this.swells.delete(zoneId);
        level = Math.max(target, shown - step / ALERT_SETTLE_MS);
      }
      if (level > .002 || swell) this.shown.set(zoneId, level); else this.shown.delete(zoneId);
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
    if (id.startsWith(ZONE_PREFIX)) {
      const places = this.places();
      // Until the host has spoken every zone counts as still to come.
      if (!places) return IDLE_SPAWN_PLACE_PRESENCE;
      const zoneId = id.slice(ZONE_PREFIX.length);
      return places.active.has(zoneId) ? 1 : places.upcoming.has(zoneId) ? IDLE_SPAWN_PLACE_PRESENCE : 0;
    }
    if (!id.startsWith(BASE_PREFIX)) return 1;
    const base = this.ports.getBase(id.slice(BASE_PREFIX.length));
    if (!base) return 1;
    if (base.isDestroyed()) return 0;
    const objectiveId = base.getSpec().dormantObjectiveId;
    if (objectiveId !== undefined && (this.closedObjectives().has(objectiveId) || this.places()?.lapsed.has(objectiveId))) return 0;
    return base.isDormant() ? IDLE_SPAWN_PLACE_PRESENCE : 1;
  }

  private placeCache: { raw: SyncedSpawnPlaceState | null; value: { active: ReadonlySet<string>; upcoming: ReadonlySet<string>; lapsed: ReadonlySet<string> } | null } = { raw: null, value: null };

  private places(): { active: ReadonlySet<string>; upcoming: ReadonlySet<string>; lapsed: ReadonlySet<string> } | null {
    const raw = this.ports.getSpawnPlaces();
    if (raw !== this.placeCache.raw) {
      this.placeCache = { raw, value: raw && { active: new Set(raw.activeZones), upcoming: new Set(raw.upcomingZones), lapsed: new Set(raw.lapsedObjectives) } };
    }
    return this.placeCache.value;
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
