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
