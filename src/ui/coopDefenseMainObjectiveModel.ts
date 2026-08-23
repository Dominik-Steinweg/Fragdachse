import type { CoopDefenseMapObjective } from '../config/coopDefenseMaps';
import type { CoopDefenseEncounterPresentationState } from '../types';
import { formatDuration, formatNumber, getLocale, t } from '../i18n';

export interface MainObjectiveBossProgress {
  readonly currentHp: number;
  readonly maxHp: number;
}

export interface MainObjectiveBaseProgress {
  readonly currentHp: number;
  readonly maxHp: number;
  readonly remaining: number;
  readonly total: number;
}

/** Vorstoss: die authored Checkpoint-Reihenfolge ist die Route, ihr letzter Punkt die Extraktion. */
export interface MainObjectiveAdvanceProgress {
  readonly activatedCheckpoints: number;
  readonly totalCheckpoints: number;
  readonly routeComplete: boolean;
}

export interface MainObjectiveModelInput {
  readonly mapId: string;
  readonly objective: CoopDefenseMapObjective;
  readonly elapsedMs: number;
  readonly surviveDurationSec?: number;
  readonly encounterCount: number;
  readonly encounter: CoopDefenseEncounterPresentationState | null;
  readonly boss: MainObjectiveBossProgress | null;
  readonly hostileBases: MainObjectiveBaseProgress | null;
  readonly advance?: MainObjectiveAdvanceProgress | null;
}

export interface MainObjectiveViewModel {
  readonly id: string;
  readonly title: string;
  readonly progressLabel: string;
  /** 0..1; beschreibt den Fortschritt zur Erfüllung des jeweiligen Hauptziels. */
  readonly progress: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function getClearedEncounterCount(state: CoopDefenseEncounterPresentationState | null): number {
  if (!state) return 0;
  if (state.phase === 'complete') return state.sequenceCount;
  if (state.phase === 'cleared') return state.sequenceIndex;
  return Math.max(0, state.sequenceIndex - 1);
}

/** Phaser-freies Anzeigemodell des dauerhaft sichtbaren Hauptziels. */
export function buildMainObjectiveViewModel(input: MainObjectiveModelInput): MainObjectiveViewModel {
  const id = `${input.mapId}:${input.objective}`;
  if (input.objective === 'survive') {
    const totalMs = Math.max(1, Math.round((input.surviveDurationSec ?? 0) * 1000));
    const elapsedMs = Math.max(0, Math.min(totalMs, input.elapsedMs));
    return {
      id,
      title: t('ui.mainObjective.survive'),
      progressLabel: `${formatDuration(elapsedMs / 1000, getLocale())} / ${formatDuration(totalMs / 1000, getLocale())}`,
      progress: clamp01(elapsedMs / totalMs),
    };
  }

  if (input.objective === 'defeat-boss') {
    const boss = input.boss;
    return {
      id,
      title: t('ui.mainObjective.boss'),
      progressLabel: boss
        ? `${formatNumber(Math.ceil(Math.max(0, boss.currentHp)), getLocale(), { useGrouping: false })} / ${formatNumber(Math.ceil(Math.max(1, boss.maxHp)), getLocale(), { useGrouping: false })} HP`
        : t('ui.mainObjective.bossAppears'),
      progress: boss ? clamp01(boss.currentHp / Math.max(1, boss.maxHp)) : 0,
    };
  }

  if (input.objective === 'advance') {
    const total = Math.max(1, Math.floor(input.advance?.totalCheckpoints ?? 0));
    const activated = Math.max(0, Math.min(total, Math.floor(input.advance?.activatedCheckpoints ?? 0)));
    // Der letzte Checkpoint ist die Extraktion; sie wird ab dem finalen Abschnitt mitgenannt.
    const onFinalLeg = input.advance?.routeComplete === true || activated >= total - 1;
    const progressLabel = `${formatNumber(activated, getLocale())} / ${formatNumber(total, getLocale())}`;
    return {
      id,
      title: t('ui.mainObjective.advance'),
      progressLabel: onFinalLeg
        ? `${progressLabel} · ${t('ui.mainObjective.extraction')}`
        : progressLabel,
      progress: clamp01(activated / total),
    };
  }

  if (input.objective === 'destroy-hostile-bases') {
    const bases = input.hostileBases;
    if (!bases) {
      return { id, title: t('ui.mainObjective.enemyBase'), progressLabel: t('ui.mainObjective.targetScanning'), progress: 0 };
    }
    const plural = bases.total !== 1;
    return {
      id,
      title: plural ? t('ui.mainObjective.enemyBases') : t('ui.mainObjective.enemyBase'),
      progressLabel: plural
        ? `${formatNumber(Math.max(0, bases.total - bases.remaining), getLocale())} / ${formatNumber(bases.total, getLocale())}`
        : `${formatNumber(Math.ceil(Math.max(0, bases.currentHp)), getLocale(), { useGrouping: false })} / ${formatNumber(Math.ceil(Math.max(1, bases.maxHp)), getLocale(), { useGrouping: false })} HP`,
      progress: plural
        ? clamp01((bases.total - bases.remaining) / Math.max(1, bases.total))
        : clamp01((Math.max(1, bases.maxHp) - Math.max(0, bases.currentHp)) / Math.max(1, bases.maxHp)),
    };
  }

  const total = Math.max(1, Math.floor(input.encounterCount));
  const cleared = Math.min(total, getClearedEncounterCount(input.encounter));
  return {
    id,
    title: t('ui.mainObjective.waves'),
    progressLabel: `${formatNumber(cleared, getLocale())} / ${formatNumber(total, getLocale())}`,
    progress: clamp01(cleared / total),
  };
}
