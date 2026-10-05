import { t } from '../i18n';
import { BUTTON_CURSOR } from './gameCursor';
import { COLORS, toCssColor } from '../config';
import { getOverlayRoot } from './fullscreen';
import {
  buildAllCoopDefenseBalanceMapSnapshots,
} from '../debug/coopDefenseBalance/analyzer';
import { toBalanceRoundsCsv, toBalanceSummaryCsv } from '../debug/coopDefenseBalance/csv';
import { buildCoopDefenseBalanceReport } from '../debug/coopDefenseBalance/report';
import type { BalanceRoundFeedback } from '../debug/coopDefenseBalance/types';
import type { CoopDefenseRoundIdentity } from '../types';
import {
  deleteAllStoredCoopDefenseBalanceRounds,
  deleteStoredCoopDefenseBalanceStaleRounds,
  getStoredCoopDefenseBalanceLab,
} from '../utils/localPreferences';
import { CoopDefenseBalanceTracker } from '../debug/coopDefenseBalance/tracker';

function formatDuration(value: number | null): string {
  return value === null ? '—' : `${(value / 1000).toFixed(1)} s`;
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(0)} %`;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  Object.assign(button.style, {
    padding: '6px 9px',
    border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
    borderRadius: '3px',
    background: toCssColor(COLORS.GREY_8),
    color: toCssColor(COLORS.GREY_1),
    cursor: BUTTON_CURSOR,
    font: 'inherit',
  });
  return button;
}

export class CoopDefenseBalanceReportOverlay {
  private panel: HTMLDivElement | null = null;

  constructor(
    private readonly tracker: CoopDefenseBalanceTracker,
    private readonly onFeedbackSaved: () => void,
  ) {}

  show(): void {
    this.hide();
    if (typeof document === 'undefined') return;
    const report = buildCoopDefenseBalanceReport(
      buildAllCoopDefenseBalanceMapSnapshots(),
      this.tracker.getRounds(),
    );
    const panel = this.createPanel(t('ui.balanceReport.title'), false);
    const controls = document.createElement('div');
    Object.assign(controls.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' });
    controls.append(
      makeButton(t('ui.balanceReport.summaryCsv'), () => this.download('fragdachse-balancing-summary', toBalanceSummaryCsv(report))),
      makeButton(t('ui.balanceReport.roundsCsv'), () => this.download('fragdachse-balancing-rounds', toBalanceRoundsCsv(report))),
      makeButton(t('ui.balanceReport.deleteStale'), () => {
        const staleIds = report.rounds
          .filter((round) => round.status === 'STALE')
          .map((round) => round.record);
        if (staleIds.length === 0) return;
        if (window.confirm(t('ui.balanceReport.confirmDeleteStale', { count: staleIds.length }))) {
          deleteStoredCoopDefenseBalanceStaleRounds(staleIds);
        }
        this.show();
      }),
      makeButton(t('ui.balanceReport.deleteAll'), () => {
        if (!window.confirm(t('ui.balanceReport.confirmDeleteAll'))) return;
        deleteAllStoredCoopDefenseBalanceRounds();
        this.show();
      }),
      makeButton(t('ui.common.close'), () => this.hide()),
    );
    // The report is deliberately textual: it keeps theory and playtest values scannable even
    // with many maps and avoids another bespoke Phaser/DOM table abstraction.
    const output = document.createElement('pre');
    Object.assign(output.style, { margin: '0', whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: '1.35' });
    const lines = [
      t('ui.balanceReport.recording', { status: getStoredCoopDefenseBalanceLab().recordingEnabled ? t('ui.balanceReport.recordingOn') : t('ui.balanceReport.recordingOff'), current: report.currentRoundCount, stale: report.staleRoundCount }),
      '',
    ];
    for (const map of report.maps) {
      const snapshot = map.snapshot;
      const metrics = map.metrics;
      lines.push(
        `${snapshot.mapId} · ${snapshot.displayName} · ${snapshot.objective.toUpperCase()} · ${snapshot.modelQuality}`,
        t('ui.balanceReport.theory', { duration: snapshot.balanceReferenceDurationSec, enemies: snapshot.finiteEnemyCount, hp: snapshot.finiteEnemyHp, xp: snapshot.finiteEnemyXp, referenceEnemies: snapshot.persistentReferenceEnemyCount, referenceHp: snapshot.persistentReferenceHp, referenceXp: snapshot.persistentReferenceXp, hpPerMinute: snapshot.persistentReferenceHpPerMinute.toFixed(1) }),
        t('ui.balanceReport.bases', { hp: snapshot.friendlyMainBaseHp, targetHp: snapshot.hostileVictoryTargetHp || '—', turrets: snapshot.turretCount, powerups: snapshot.powerUpCount + snapshot.powerUpPedestalCount, tags: snapshot.mechanicTags.join(', ') || '—' }),
        t('ui.balanceReport.actual', { current: metrics.currentRounds, rated: metrics.ratedRounds, stale: metrics.staleRounds, winRate: formatPercent(metrics.victoryRate), averageDuration: formatDuration(metrics.averageDurationMs), medianDuration: formatDuration(metrics.medianDurationMs), xp: metrics.averageActualXp?.toFixed(1) ?? '—', difficulty: metrics.averageDifficulty?.toFixed(1) ?? '—', pacing: metrics.averagePacing?.toFixed(1) ?? '—', reserve: formatPercent(metrics.averageOwnBaseReserve) }),
        t('ui.balanceReport.anomalies', { anomalies: map.anomalies.join(' · ') || t('ui.balanceReport.none') }),
        '',
      );
    }
    output.textContent = lines.join('\n');
    panel.append(controls, output);
    this.mount(panel);
  }

  showFeedback(roundEndedAt: number, roundIdentity?: CoopDefenseRoundIdentity): void {
    this.hide();
    if (typeof document === 'undefined') return;
    const round = this.tracker.getRound(roundEndedAt, roundIdentity);
    if (!round) return;
    const panel = this.createPanel(t('ui.balanceReport.feedback'), true);
    const description = document.createElement('div');
    description.textContent = t('ui.balanceReport.feedbackHint');
    Object.assign(description.style, { color: toCssColor(COLORS.GREY_3), marginBottom: '12px', lineHeight: '1.4' });

    const difficulty = this.createRating(t('ui.balanceReport.difficulty'), [
      t('ui.balanceReport.tooEasy'), t('ui.balanceReport.easy'), t('ui.balanceReport.justRight'), t('ui.balanceReport.hard'), t('ui.balanceReport.tooHard'),
    ], round.feedback?.difficulty ?? 3);
    const pacing = this.createRating(t('ui.balanceReport.pacing'), [
      t('ui.balanceReport.tooCalm'), t('ui.balanceReport.calm'), t('ui.balanceReport.justRight'), t('ui.balanceReport.hectic'), t('ui.balanceReport.stress'),
    ], round.feedback?.pacing ?? 3);
    const comment = document.createElement('textarea');
    comment.value = round.feedback?.comment ?? '';
    comment.maxLength = 500;
    comment.placeholder = t('ui.balanceReport.comment');
    Object.assign(comment.style, {
      width: '100%', minHeight: '82px', boxSizing: 'border-box', resize: 'vertical',
      padding: '7px', margin: '6px 0 12px', background: toCssColor(COLORS.GREY_9),
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`, color: toCssColor(COLORS.GREY_1), font: 'inherit',
    });
    const buttons = document.createElement('div');
    Object.assign(buttons.style, { display: 'flex', justifyContent: 'flex-end', gap: '7px' });
    buttons.append(
      makeButton(t('ui.common.cancel'), () => this.hide()),
      makeButton(t('ui.balanceReport.saveFeedback'), () => {
        this.tracker.updateFeedback(roundEndedAt, {
          difficulty: Number(difficulty.input.value) as BalanceRoundFeedback['difficulty'],
          pacing: Number(pacing.input.value) as BalanceRoundFeedback['pacing'],
          comment: comment.value.slice(0, 500),
        }, roundIdentity);
        this.onFeedbackSaved();
        this.hide();
      }),
    );
    panel.append(description, difficulty.label, difficulty.input, pacing.label, pacing.input, comment, buttons);
    this.mount(panel);
  }

  hide(): void {
    this.panel?.remove();
    this.panel = null;
  }

  destroy(): void {
    this.hide();
  }

  private createPanel(titleText: string, centered: boolean): HTMLDivElement {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      ...(centered ? { inset: '0', margin: 'auto', height: 'fit-content' } : { top: '12px', right: '12px' }),
      width: centered ? 'min(470px, calc(100vw - 24px))' : 'min(1120px, calc(100vw - 24px))',
      maxHeight: 'calc(100vh - 24px)',
      overflowY: 'auto',
      boxSizing: 'border-box',
      padding: '14px 16px',
      border: `2px solid ${toCssColor(COLORS.BROWN_4)}`,
      backgroundColor: 'rgba(12, 12, 12, 0.96)',
      color: toCssColor(COLORS.GREY_1),
      fontFamily: 'monospace',
      fontSize: '12px',
      zIndex: '4100',
      boxShadow: '0 16px 36px rgba(0, 0, 0, 0.35)',
    });
    const title = document.createElement('div');
    title.textContent = titleText;
    Object.assign(title.style, { fontWeight: 'bold', color: toCssColor(COLORS.GOLD_1), marginBottom: '10px', fontSize: '15px' });
    panel.appendChild(title);
    return panel;
  }

  private createRating(title: string, labels: readonly string[], selected: number): {
    label: HTMLDivElement;
    input: HTMLSelectElement;
  } {
    const label = document.createElement('div');
    label.textContent = title;
    label.style.fontWeight = 'bold';
    label.style.marginTop = '6px';
    const input = document.createElement('select');
    Object.assign(input.style, {
      width: '100%', padding: '7px', background: toCssColor(COLORS.GREY_9),
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`, color: toCssColor(COLORS.GREY_1), font: 'inherit',
    });
    labels.forEach((text, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1);
      option.textContent = `${index + 1} = ${text}`;
      input.appendChild(option);
    });
    input.value = String(selected);
    return { label, input };
  }

  private mount(panel: HTMLDivElement): void {
    const stop = (event: Event): void => event.stopPropagation();
    ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'wheel'].forEach((name) => {
      panel.addEventListener(name, stop);
    });
    getOverlayRoot().appendChild(panel);
    this.panel = panel;
  }

  private download(prefix: string, content: string): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
