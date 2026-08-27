import type { ActivityKind } from '../config/authoring/ActivityDefinition';
import type { WorldParticipation } from './WorldParticipation';

/**
 * Was ein Spieler in dieser World konkret darf.
 *
 * `canPlayerAct()` beantwortet nur "darf er ueberhaupt" und ist damit zu grob: eine Editor-World
 * erlaubt Bauen ohne Kampf, ein Beobachter fuehrt die Kamera ohne alles andere. Statt einer
 * universellen Freigabe wird deshalb aus dem autoritativen Runtime-State eine spezifische Policy
 * aufgeloest.
 *
 * Host und Client verwenden **dieselbe reine Regel**, aber mit getrennter Autoritaet: der Client
 * leitet daraus nur Eingabe-UX, Vorschau und lokale Freigabe ab, der Host loest sie aus seinem
 * eigenen Zustand erneut auf und validiert damit RPCs, Platzierung, Kampf und Eingaben.
 * Client-seitig uebermittelte Capabilities besitzen keine Autoritaet.
 */
export interface PlayerCapabilities {
  readonly canMove: boolean;
  readonly canUseCombat: boolean;
  readonly canPlace: boolean;
  readonly canDismantle: boolean;
  /** Handeln mit ausgeruesteten Gegenstaenden und Weltobjekten. */
  readonly canInteract: boolean;
  /** Missionsgebundene Aktionen: Ziele tragen, abgeben, reparieren. */
  readonly canUseMissionActions: boolean;
  /** Auch wer nicht handelt, darf zusehen. */
  readonly canControlCamera: boolean;
}

export interface PlayerCapabilityInput {
  readonly participation: WorldParticipation;
  /** Activity dieser World; `null` fuer eine World ohne Mission. */
  readonly activityKind: ActivityKind | null;
  /** Explizite World-Policy; Activity null darf Kampf erlauben oder verbieten. */
  readonly worldCombatAllowed: boolean;
}

const NOTHING: PlayerCapabilities = {
  canMove: false,
  canUseCombat: false,
  canPlace: false,
  canDismantle: false,
  canInteract: false,
  canUseMissionActions: false,
  canControlCamera: false,
};

export function resolvePlayerCapabilities(input: PlayerCapabilityInput): PlayerCapabilities {
  const { participation, activityKind, worldCombatAllowed } = input;
  // Wer nicht an der World teilnimmt, darf in ihr nichts – auch nicht zusehen.
  if (participation === 'none') return NOTHING;
  // Beobachten und Verlassen fuehren die Kamera, aber keine Handlung.
  if (participation !== 'interactive') return { ...NOTHING, canControlCamera: true };

  return {
    canMove: true,
    // Kampf ist eine explizite World-Policy, nicht die blosse Anwesenheit einer Activity.
    canUseCombat: worldCombatAllowed,
    canPlace: true,
    canDismantle: true,
    canInteract: true,
    canUseMissionActions: activityKind === 'coop-mission',
    canControlCamera: true,
  };
}
