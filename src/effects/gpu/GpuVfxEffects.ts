import { GpuVfxFrameId } from './GpuVfxAtlas';
import { GpuVfxLaneId } from './GpuVfxRenderLanes';

/**
 * GpuVfxEffects – der Manifest der *logischen* Effekte.
 *
 * Ein Effekt ist die semantische Einheit: er traegt sein Motiv, seine Qualitaetsklasse, seinen
 * Source-Lifecycle und seine Zeile im Profiler-Report. Auf welchem physischen Layer er landet,
 * steht in `GpuVfxRenderLanes.ts` – mehrere Effekte duerfen sich eine Lane teilen, ohne dass ihre
 * Statistik zusammenfaellt.
 */

export const GpuVfxEffectId = {
  AirstrikeBomb:  0,
  AirstrikeSpark: 1,
  RocketExhaust:  2,
  RocketSmoke:    3,
  StinkInner:     4,
  StinkPlume:     5,
  StinkAccent:    6,
  StinkEdge:      7,
  FlameCore:      8,
  FlameOuter:     9,
  FlameSpark:     10,
} as const;

export type GpuVfxEffectId = (typeof GpuVfxEffectId)[keyof typeof GpuVfxEffectId];

/** Dieselben Kategorien wie `GraphicsQualityProfile.particleFactors`. */
export type GpuVfxImportance = 'critical' | 'standard' | 'decorative';

/**
 * `kill-with-source`: verschwindet die Quelle, werden ihre lebenden Member sofort stillgelegt.
 * `linger`: die Quelle verschwindet, bereits gespawnte Member leben normal aus.
 */
export type GpuVfxReleaseMode = 'kill-with-source' | 'linger';

export interface GpuVfxEffectSpec {
  readonly id: GpuVfxEffectId;
  /** Zwei-Ebenen-Profiling: dieser Name steht im Report, auch bei geteilter Lane. */
  readonly label: string;
  readonly lane: GpuVfxLaneId;
  /** Nur fuer Effekte, die je nach Variante additiv zeichnen (Wolkenpartikel). */
  readonly laneAdditive?: GpuVfxLaneId;
  readonly frame: GpuVfxFrameId;
  readonly importance: GpuVfxImportance;
  readonly release: GpuVfxReleaseMode;
}

/** Reihenfolge = `GpuVfxEffectId`. */
export const GPU_VFX_EFFECTS: readonly GpuVfxEffectSpec[] = [
  {
    id: GpuVfxEffectId.AirstrikeBomb,
    label: 'airstrike.bomb',
    lane: GpuVfxLaneId.AirstrikeBomb,
    frame: GpuVfxFrameId.AirstrikeBomb,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.AirstrikeSpark,
    label: 'airstrike.spark',
    lane: GpuVfxLaneId.AirstrikeSpark,
    frame: GpuVfxFrameId.AirstrikeSpark,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.RocketExhaust,
    label: 'rocket.exhaust',
    lane: GpuVfxLaneId.RocketExhaust,
    frame: GpuVfxFrameId.RocketExhaust,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.RocketSmoke,
    label: 'rocket.smoke',
    lane: GpuVfxLaneId.RocketSmoke,
    frame: GpuVfxFrameId.RocketSmoke,
    importance: 'standard',
    // Beim Zerstoeren einer einzelnen Rakete liefen die Schwaden des geteilten Emitters aus,
    // statt zu verschwinden. Nur der Teardown raeumt sie ab.
    release: 'linger',
  },
  {
    id: GpuVfxEffectId.StinkInner,
    label: 'stink.inner',
    lane: GpuVfxLaneId.StinkNormal,
    laneAdditive: GpuVfxLaneId.StinkAdd,
    frame: GpuVfxFrameId.StinkPuff,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.StinkPlume,
    label: 'stink.plume',
    lane: GpuVfxLaneId.StinkNormal,
    laneAdditive: GpuVfxLaneId.StinkAdd,
    frame: GpuVfxFrameId.StinkPuff,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.StinkAccent,
    label: 'stink.accent',
    lane: GpuVfxLaneId.StinkAdd,
    frame: GpuVfxFrameId.StinkPuff,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.StinkEdge,
    label: 'stink.edge',
    lane: GpuVfxLaneId.StinkAdd,
    frame: GpuVfxFrameId.StinkPuff,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.FlameCore,
    label: 'flame.core',
    lane: GpuVfxLaneId.FlameCore,
    frame: GpuVfxFrameId.FlameCore,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.FlameOuter,
    label: 'flame.outer',
    lane: GpuVfxLaneId.FlameOuter,
    frame: GpuVfxFrameId.FlameOuter,
    importance: 'standard',
    release: 'kill-with-source',
  },
  {
    id: GpuVfxEffectId.FlameSpark,
    label: 'flame.spark',
    lane: GpuVfxLaneId.FlameSpark,
    frame: GpuVfxFrameId.FlameSpark,
    importance: 'standard',
    release: 'kill-with-source',
  },
];
