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
  SyncedCoopDefenseCarryItem,
} from '../types';
import { getLocale, t } from '../i18n';
import {
  getSecondaryObjectiveReward as resolveSecondaryObjectiveReward,
  getSecondaryObjectiveTitle as resolveSecondaryObjectiveTitle,
} from '../i18n/contentPresentation';

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
  /**
   * Kurztext anstelle der Fortschrittszahl: `ERFÜLLT`/`GESCHEITERT` bei terminalem Zustand, `HALTEN`
   * bei einem laufenden Hold. Ob eine Mission abgeschlossen ist, entscheidet allein {@link terminal} –
   * ein binäres Ziel hat einen Status, aber keinen Abschluss.
   */
  readonly statusLine: string | null;
  /** True bei `completed` oder `failed`. Steuert Abschlussankündigung und Akzentfarbe. */
  readonly terminal: boolean;
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

function isTerminal(state: CoopDefenseSecondaryObjectivePresentationEntry['state']): boolean {
  return state === 'completed' || state === 'failed';
}

export function getSecondaryObjectiveTitle(
  entry: CoopDefenseSecondaryObjectivePresentationEntry,
  config: ResolvedCoopDefenseMapSecondaryObjectiveConfig | undefined,
): string {
  return resolveSecondaryObjectiveTitle(entry.objectiveId, getLocale())
    ?? (entry.type === 'destroy' ? t('objective.fallback.destroy')
      : entry.type === 'hold' ? t('objective.fallback.hold')
        : config?.carry?.item === 'explosive' ? t('objective.fallback.demolition') : t('objective.fallback.carry'));
}

export function getSecondaryObjectiveRewardHint(
  entry: CoopDefenseSecondaryObjectivePresentationEntry,
  config: ResolvedCoopDefenseMapSecondaryObjectiveConfig | undefined,
): string {
  return resolveSecondaryObjectiveReward(entry.objectiveId, getLocale())
    ?? (entry.type === 'destroy' ? t('objective.reward.destroy')
      : entry.type === 'hold' ? t('objective.reward.hold')
        : config?.carry?.item === 'explosive' ? t('objective.reward.demolition') : t('objective.reward.carry'));
}

/** Zielreferenzen einer Mission; die Weltmarkierung löst sie lokal gegen den BaseManager auf. */
export function getSecondaryObjectiveTargets(
  configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
  objectiveId: string,
): readonly string[] {
  return configs.find((config) => config.id === objectiveId)?.targets ?? [];
}

/**
 * Carry führt über zwei Schritte, und die Weltmarkierung zeigt immer nur den nächsten: Solange
 * Objekte am Boden liegen, markieren sie sich selbst; sobald das Team eines trägt, kommt die
 * Abgabezone dazu. Eine dauerhaft markierte Zone ohne aufgenommenes Objekt würde den ersten
 * Schritt verdecken, und ein getragenes Objekt braucht keine eigene Marke – es sitzt sichtbar
 * am Träger und zöge sonst eine zweite Marke durch die Arena.
 */
export function isCarryDeliveryZoneMarked(
  carryItems: readonly SyncedCoopDefenseCarryItem[],
  objectiveId: string,
): boolean {
  return carryItems.some((item) => item.objectiveId === objectiveId && item.holderId !== null);
}

function toViewEntry(
  entry: CoopDefenseSecondaryObjectivePresentationEntry,
  config: ResolvedCoopDefenseMapSecondaryObjectiveConfig | undefined,
  tone: SecondaryObjectiveTone,
  liveStatus: string | undefined,
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
    // A live status of the objective's world (e.g. a charging portal) replaces the bare count while it runs.
    statusLine: isTerminal(entry.state) ? getStatusLine(entry) : liveStatus ?? getStatusLine(entry),
    terminal: isTerminal(entry.state),
  };
}

/**
 * Status of portal generator objectives for the HUD: the charge while the link builds, then that the
 * flank is open. Waiting and collapsed links add nothing; a fallen generator completes its objective.
 */
export function resolvePortalObjectiveStatusLines(
  links: readonly { readonly id: string; readonly generatorBaseId: string; readonly chargeDurationMs: number }[],
  configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
  entries: readonly { readonly id: string; readonly phase: string; readonly chargeStartedAtMs?: number }[] | null,
  elapsedMs: number,
): ReadonlyMap<string, string> {
  const lines = new Map<string, string>();
  for (const link of links) {
    const entry = entries?.find((candidate) => candidate.id === link.id);
    const objective = configs.find((config) => config.type === 'destroy' && config.targets.includes(link.generatorBaseId));
    if (!entry || !objective) continue;
    if (entry.phase === 'charging') {
      const percent = Math.floor(Math.max(0, Math.min(0.99, (elapsedMs - (entry.chargeStartedAtMs ?? elapsedMs))
        / Math.max(1, link.chargeDurationMs))) * 100);
      lines.set(objective.id, t('objective.status.portalCharging', { percent }));
    } else if (entry.phase === 'open') {
      lines.set(objective.id, t('objective.status.portalOpen'));
    }
  }
  return lines;
}

/**
 * Hold ist binär: `0 / 1` wäre eine Zahl ohne Aussage. Die Restdauer bleibt bewusst weg – sie wäre
 * bei einem an einen Encounter-Clear gebundenen `holdUntil` gar nicht bestimmbar.
 */
function getStatusLine(entry: CoopDefenseSecondaryObjectivePresentationEntry): string | null {
  if (entry.state === 'completed') return t('objective.status.completed');
  if (entry.state === 'failed') return t('objective.status.failed');
  return entry.type === 'hold' ? t('objective.status.hold') : null;
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
  liveStatus: ReadonlyMap<string, string> = new Map(),
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
    ? toViewEntry(focusEntry, configById.get(focusEntry.objectiveId), toTone(focusEntry), liveStatus.get(focusEntry.objectiveId))
    : null;
  const chips = visible
    .filter((entry) => entry !== focusEntry)
    .slice(0, SECONDARY_OBJECTIVE_MAX_CHIPS)
    .map((entry) => toViewEntry(entry, configById.get(entry.objectiveId), toTone(entry), liveStatus.get(entry.objectiveId)));

  return { focus, chips, signature: buildSignature({ focus, chips }) };
}
