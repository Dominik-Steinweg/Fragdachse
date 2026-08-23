import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../config';
import type {
  ResolvedCoopDefenseMapMissionCheckpointConfig,
  ResolvedCoopDefenseMapTutorialStepConfig,
} from '../config/coopDefenseMaps';

/**
 * Rein lokale Fortschaltung der Tutorial-Hinweise entlang der Route.
 *
 * Das Modell besitzt keinerlei Gameplay-Autoritaet: Es liest nur die Position des eigenen
 * Spielers und die authored Checkpoint-Geometrie und entscheidet daraus, welcher Hinweis gerade
 * sichtbar ist. Es wird nicht repliziert, aendert keinen Rundenzustand und ein vorauslaufender
 * Mitspieler loest hier nichts aus. Jeder Schritt erscheint pro Spieler und Runde genau einmal;
 * Tod und Respawn setzen nichts zurueck, eine neue Runde erzeugt einen frischen Zustand.
 */
export interface CoopDefenseTutorialStepState {
  readonly seenStepIds: ReadonlySet<string>;
  readonly activeStepId: string | null;
  /** Lokale Uhr; der Hinweis ist sichtbar, solange `nowMs` darunter liegt. */
  readonly activeUntilMs: number;
}

export interface CoopDefenseTutorialStepInput {
  readonly steps: readonly ResolvedCoopDefenseMapTutorialStepConfig[];
  readonly checkpoints: readonly ResolvedCoopDefenseMapMissionCheckpointConfig[];
  /** Weltposition des eigenen Spielers; `null`, solange er nicht lebend in der Arena steht. */
  readonly localPlayer: { readonly x: number; readonly y: number } | null;
  readonly nowMs: number;
}

export function createCoopDefenseTutorialStepState(): CoopDefenseTutorialStepState {
  return { seenStepIds: new Set<string>(), activeStepId: null, activeUntilMs: 0 };
}

export function advanceCoopDefenseTutorialSteps(
  state: CoopDefenseTutorialStepState,
  input: CoopDefenseTutorialStepInput,
): CoopDefenseTutorialStepState {
  const expired = state.activeStepId !== null && input.nowMs >= state.activeUntilMs;
  const triggered = input.localPlayer === null
    ? null
    : findTriggeredStep(state, input, input.localPlayer);

  if (triggered) {
    const seenStepIds = new Set(state.seenStepIds);
    seenStepIds.add(triggered.id);
    return {
      seenStepIds,
      activeStepId: triggered.id,
      activeUntilMs: input.nowMs + triggered.durationMs,
    };
  }
  if (!expired) return state;
  return { seenStepIds: state.seenStepIds, activeStepId: null, activeUntilMs: 0 };
}

/** Aktuell sichtbarer Schritt; `null`, sobald sein Fenster abgelaufen ist. */
export function getVisibleCoopDefenseTutorialStepId(
  state: CoopDefenseTutorialStepState,
  nowMs: number,
): string | null {
  if (state.activeStepId === null || nowMs >= state.activeUntilMs) return null;
  return state.activeStepId;
}

function findTriggeredStep(
  state: CoopDefenseTutorialStepState,
  input: CoopDefenseTutorialStepInput,
  localPlayer: { readonly x: number; readonly y: number },
): ResolvedCoopDefenseMapTutorialStepConfig | null {
  for (const step of input.steps) {
    if (state.seenStepIds.has(step.id)) continue;
    const checkpoint = input.checkpoints.find(({ id }) => id === step.checkpointId);
    if (!checkpoint) continue;
    if (!isInsideCheckpoint(checkpoint, localPlayer.x, localPlayer.y)) continue;
    return step;
  }
  return null;
}

function isInsideCheckpoint(
  checkpoint: ResolvedCoopDefenseMapMissionCheckpointConfig,
  x: number,
  y: number,
): boolean {
  const centerX = ARENA_OFFSET_X + (checkpoint.gridX + 0.5) * CELL_SIZE;
  const centerY = ARENA_OFFSET_Y + (checkpoint.gridY + 0.5) * CELL_SIZE;
  const radius = checkpoint.radiusCells * CELL_SIZE;
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}
