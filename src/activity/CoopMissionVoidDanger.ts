import { isPermanentVoidGroundHazard, type CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { voidHazardSource, type ActivityVoidDanger, type VoidDangerSource } from '../arena/VoidDangerField';
import type { ArenaLayout, CoopDefenseSecondaryObjectivePresentationState } from '../types';

/** What the projection reads; every answer may be null while the Activity is not running. */
export interface CoopMissionVoidDangerPorts {
  getMapConfig(): CoopDefenseMapConfig | null;
  getLayout(): ArenaLayout | null;
  /** World top-left of arena cell (0, 0). */
  getOffset(): { readonly offsetX: number; readonly offsetY: number } | null;
  getBase(id: string): { isDestroyed(): boolean; getSpec(): { readonly dormantObjectiveId?: string } } | undefined;
  getObjectives(): CoopDefenseSecondaryObjectivePresentationState | null;
}

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
