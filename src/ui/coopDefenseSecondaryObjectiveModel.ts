/**
 * Phaser-freies Anzeigemodell der Coop-Defense-Nebenmissionen.
 *
 * Der replizierte Snapshot beschreibt nur Zustand und Fortschritt. Welche Mission den
 * prominenten Slot bekommt, wie sie heißt, wie lange ein Abschluss stehen bleibt und wann
 * sich die Anzeige überhaupt ändert, entsteht hier – damit es ohne Szene testbar bleibt
 * (Vorbild: `CoopDefenseItemsModel`).
 */
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../config/coopDefenseMaps';
import type {
  CoopDefenseSecondaryObjectivePresentationEntry,
  CoopDefenseSecondaryObjectivePresentationState,
  CoopDefenseSecondaryObjectiveType,
} from '../types';

/**
 * Wie lange ein Abschluss oder Fehlschlag nach dem Zustandswechsel im Zielbereich sichtbar bleibt.
 * Der Snapshot meldet den terminalen Eintrag bis zum Rundenende weiter; ohne dieses Fenster
 * bliebe eine erfüllte Mission dauerhaft im Bild stehen. Das Fenster enthält die kurze
 * Mittenankündigung samt Übergabeflug und lässt danach rund sieben Sekunden Panel-Lesezeit.
 */
export const SECONDARY_OBJECTIVE_TERMINAL_HOLD_MS = 9_000;

/** Obergrenze gleichzeitig gezeigter Hintergrundzeilen. Darüber ist die Liste nicht mehr lesbar. */
export const SECONDARY_OBJECTIVE_MAX_CHIPS = 3;

export type SecondaryObjectiveTone = 'focus' | 'background' | 'completed' | 'failed';

export interface SecondaryObjectiveViewEntry {
  readonly objectiveId: string;
  readonly type: CoopDefenseSecondaryObjectiveType;
  readonly tone: SecondaryObjectiveTone;
  /** Vollständiger Missionsname; das HUD kürzt ihn pixelgenau auf die verfügbare Breite. */
  readonly title: string;
  readonly rewardHint: string;
  readonly progressCurrent: number;
  readonly progressTotal: number;
  /** Nur bei terminalem Zustand gesetzt: `ERFÜLLT` bzw. `GESCHEITERT`. */
  readonly statusLine: string | null;
}

export interface SecondaryObjectiveViewModel {
  /** Mission mit dem prominenten HUD-Slot; null, solange keine sichtbar ist. */
  readonly focus: SecondaryObjectiveViewEntry | null;
  /** Aktive Missionen ohne Fokus sowie verdrängte Abschlüsse, in stabiler Reihenfolge. */
  readonly chips: readonly SecondaryObjectiveViewEntry[];
  /** Ändert sich genau dann, wenn die Anzeige neu gezeichnet werden muss. */
  readonly signature: string;
}

const EMPTY_MODEL: SecondaryObjectiveViewModel = { focus: null, chips: [], signature: '' };

const TITLE_FALLBACK: Readonly<Record<CoopDefenseSecondaryObjectiveType, string>> = {
  destroy: 'ZIELE ZERSTÖREN',
  hold: 'STELLUNG HALTEN',
  carry: 'FRACHT BERGEN',
};

const REWARD_FALLBACK: Readonly<Record<CoopDefenseSecondaryObjectiveType, string>> = {
  destroy: 'WENIGER GEGNERDRUCK · BONUS-XP',
  hold: 'VERSTÄRKUNG FÜR DEN REST DER MAP',
  carry: 'BESSERE BELOHNUNG BEI SIEG',
};

function isTerminal(state: CoopDefenseSecondaryObjectivePresentationEntry['state']): boolean {
  return state === 'completed' || state === 'failed';
}

export function getSecondaryObjectiveTitle(
  entry: CoopDefenseSecondaryObjectivePresentationEntry,
  config: ResolvedCoopDefenseMapSecondaryObjectiveConfig | undefined,
): string {
  const authored = config?.displayName?.trim();
  return authored && authored.length > 0 ? authored : TITLE_FALLBACK[entry.type];
}

export function getSecondaryObjectiveRewardHint(
  entry: CoopDefenseSecondaryObjectivePresentationEntry,
  config: ResolvedCoopDefenseMapSecondaryObjectiveConfig | undefined,
): string {
  const authored = config?.rewardHint?.trim();
  return authored && authored.length > 0 ? authored : REWARD_FALLBACK[entry.type];
}

/** Zielreferenzen einer Mission; die Weltmarkierung löst sie lokal gegen den BaseManager auf. */
export function getSecondaryObjectiveTargets(
  configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
  objectiveId: string,
): readonly string[] {
  return configs.find((config) => config.id === objectiveId)?.targets ?? [];
}

function toViewEntry(
  entry: CoopDefenseSecondaryObjectivePresentationEntry,
  config: ResolvedCoopDefenseMapSecondaryObjectiveConfig | undefined,
  tone: SecondaryObjectiveTone,
): SecondaryObjectiveViewEntry {
  const title = getSecondaryObjectiveTitle(entry, config);
  return {
    objectiveId: entry.objectiveId,
    type: entry.type,
    tone,
    title,
    rewardHint: getSecondaryObjectiveRewardHint(entry, config),
    progressCurrent: Math.max(0, Math.min(entry.progressCurrent, entry.progressTotal)),
    progressTotal: Math.max(1, entry.progressTotal),
    statusLine: entry.state === 'completed'
      ? 'ERFÜLLT'
      : entry.state === 'failed' ? 'GESCHEITERT' : null,
  };
}

function buildSignature(model: Omit<SecondaryObjectiveViewModel, 'signature'>): string {
  const describe = (entry: SecondaryObjectiveViewEntry): string => [
    entry.objectiveId,
    entry.tone,
    entry.progressCurrent,
    entry.progressTotal,
    entry.title,
    entry.statusLine ?? '',
  ].join(':');
  return [
    model.focus ? describe(model.focus) : '-',
    ...model.chips.map(describe),
  ].join('|');
}

/**
 * Leitet aus Snapshot und authored Konfiguration ab, was angezeigt wird.
 *
 * Der Fokus-Slot bevorzugt die tatsächlich fokussierte Mission. Ein frischer Abschluss darf
 * ihn übernehmen, solange keine andere Mission fokussiert ist: Das System gibt den Fokus beim
 * Abschluss frei, die Auszahlung soll aber trotzdem prominent stehen. Startet gleichzeitig eine
 * neue Mission, gewinnt diese – ein laufendes Pflichtziel ist wichtiger als eine Quittung.
 */
export function buildSecondaryObjectiveViewModel(
  snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
  configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
  elapsedMs: number,
): SecondaryObjectiveViewModel {
  if (!snapshot || snapshot.length === 0) return EMPTY_MODEL;
  const now = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const configById = new Map(configs.map((config) => [config.id, config]));

  const visible = snapshot.filter((entry) => {
    if (entry.state === 'dormant') return false;
    if (!isTerminal(entry.state)) return true;
    // Negative Alter entstehen bei einem Snapshot aus der Zukunft (Reconnect vor dem lokalen
    // Uhrenabgleich). Er wird gezeigt, nicht verworfen – sonst fehlte die Quittung ganz.
    return now - entry.stateChangedAtMs <= SECONDARY_OBJECTIVE_TERMINAL_HOLD_MS;
  });
  if (visible.length === 0) return EMPTY_MODEL;

  const focusEntry = visible.find((entry) => entry.focused && !isTerminal(entry.state))
    ?? [...visible]
      .filter((entry) => isTerminal(entry.state))
      .sort((left, right) => right.stateChangedAtMs - left.stateChangedAtMs)[0]
    ?? null;

  const toTone = (entry: CoopDefenseSecondaryObjectivePresentationEntry): SecondaryObjectiveTone => {
    if (entry.state === 'completed') return 'completed';
    if (entry.state === 'failed') return 'failed';
    return entry === focusEntry ? 'focus' : 'background';
  };

  const focus = focusEntry
    ? toViewEntry(focusEntry, configById.get(focusEntry.objectiveId), toTone(focusEntry))
    : null;
  const chips = visible
    .filter((entry) => entry !== focusEntry)
    .slice(0, SECONDARY_OBJECTIVE_MAX_CHIPS)
    .map((entry) => toViewEntry(entry, configById.get(entry.objectiveId), toTone(entry)));

  return { focus, chips, signature: buildSignature({ focus, chips }) };
}
