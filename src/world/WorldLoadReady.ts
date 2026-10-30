import type { ArenaLoadStage } from '../types';

/**
 * World-Ladebarriere.
 *
 * Die Barriere haengt an der World-Instanz, nicht an der Runde: auch eine World ohne Activity
 * muss geladen sein, bevor jemand in ihr handeln darf. Eine Activity kann anschliessend
 * zusaetzliche Startbedingungen besitzen.
 *
 * Das Stufenvokabular bleibt bewusst dasselbe wie heute – die Stufen beschreiben den lokalen
 * Aufbau, nicht die Runde.
 */
export type WorldLoadStage = ArenaLoadStage;

export interface WorldLoadReadyState {
  readonly worldRevision: number;
  readonly progress: number;
  readonly stage: WorldLoadStage;
  readonly ready: boolean;
}

const WORLD_LOAD_STAGES: ReadonlySet<string> = new Set<WorldLoadStage>([
  'generating',
  'building',
  'rendering',
  'ready',
]);

export function isWorldLoadStage(value: unknown): value is WorldLoadStage {
  return typeof value === 'string' && WORLD_LOAD_STAGES.has(value);
}

/**
 * Netzwerkgrenze der World-Ladebarriere. Ein Stand einer anderen World-Instanz wird verworfen,
 * nicht umgerechnet; `ready` gilt nur bei vollstaendigem Fortschritt in der Endstufe.
 */
export function parseWorldLoadReadyState(
  raw: unknown,
  expectedWorldRevision: number,
): WorldLoadReadyState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<WorldLoadReadyState>;
  if (candidate.worldRevision !== expectedWorldRevision) return null;
  if (!isWorldLoadStage(candidate.stage)) return null;
  const progress = normalizeWorldLoadProgress(candidate.progress);
  return {
    worldRevision: expectedWorldRevision,
    progress,
    stage: candidate.stage,
    ready: candidate.ready === true && candidate.stage === 'ready' && progress >= 100,
  };
}

export function normalizeWorldLoadProgress(progress: unknown): number {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

/** Ladefortschritt einer World in Prozent (0–100, ungerundet). */
export interface WorldLoadProgressResult {
  readonly progress: number;
  readonly stage: WorldLoadStage;
  readonly ready: boolean;
}

/**
 * Fortschrittsmarken des synchronen World-Aufbaus. Gemessen dauert er nur rund ein Zehntel der
 * Ladezeit; den Rest tragen Render-Working-Set, Terrain-Snapshot und Kampf-Vorbereitung.
 */
export const WORLD_LOAD_BUILD_PROGRESS = {
  generating: 2,
  building: 5,
  built: 9,
  rendering: 12,
} as const;
const RENDER_SPAN = 98 - WORLD_LOAD_BUILD_PROGRESS.rendering;
/** Anteil der Chunk-Arbeit an der Renderstufe; den Rest teilen sich die uebrigen Ladegates. */
const RENDER_WORK_SHARE = 0.7;

/**
 * Uebersetzt die Chunk-Statistik des lokalen World-Aufbaus in den Fortschritt der Renderstufe.
 *
 * Sie beschreibt ausschliesslich die World: ist die lokale Welt gebaut und darstellbar? Ob eine
 * Runde starten darf, ist eine davon getrennte Frage – eine World ohne Activity ist fertig
 * geladen, ohne dass jemals eine Runde beginnt. `gates` sind weitere lokale Bedingungen derselben
 * Barriere (Terrain-Snapshot, Shader, Kampf-Praesentation), die neben der Chunk-Arbeit laufen.
 */
export function resolveWorldLoadProgress(
  pendingWork: number,
  residentWork: number,
  localWorldReady: boolean,
  gates: readonly boolean[] = [],
): WorldLoadProgressResult {
  if (localWorldReady) return { progress: 100, stage: 'ready', ready: true };
  const pending = Math.max(0, pendingWork);
  const resident = Math.max(0, residentWork);
  const workFraction = pending <= 0 ? 1 : resident / Math.max(1, resident + pending);
  const gateFraction = gates.length === 0 ? 1 : gates.filter(Boolean).length / gates.length;
  const fraction = RENDER_WORK_SHARE * workFraction + (1 - RENDER_WORK_SHARE) * gateFraction;
  return {
    progress: WORLD_LOAD_BUILD_PROGRESS.rendering + RENDER_SPAN * fraction,
    stage: 'rendering',
    ready: false,
  };
}
