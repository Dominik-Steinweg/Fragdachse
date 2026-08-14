import { COLORS, toCssColor } from '../config';
import { getOverlayRoot } from './fullscreen';
import {
  buildAllCoopDefenseBalanceMapSnapshots,
} from '../debug/coopDefenseBalance/analyzer';
import { toBalanceRoundsCsv, toBalanceSummaryCsv } from '../debug/coopDefenseBalance/csv';
import { buildCoopDefenseBalanceReport } from '../debug/coopDefenseBalance/report';
import type { BalanceRoundFeedback } from '../debug/coopDefenseBalance/types';
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
    cursor: 'pointer',
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
    const panel = this.createPanel('COOP DEFENSE · BALANCE LAB · AUSWERTUNG', false);
    const controls = document.createElement('div');
    Object.assign(controls.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' });
    controls.append(
      makeButton('Summary-CSV', () => this.download('fragdachse-balancing-summary', toBalanceSummaryCsv(report))),
      makeButton('Runden-CSV', () => this.download('fragdachse-balancing-rounds', toBalanceRoundsCsv(report))),
      makeButton('Veraltete Messungen löschen', () => {
        const staleIds = report.rounds
          .filter((round) => round.status === 'STALE')
          .map((round) => round.record.roundEndedAt);
        if (staleIds.length === 0) return;
        if (window.confirm(`${staleIds.length} veraltete Messungen löschen?`)) {
          deleteStoredCoopDefenseBalanceStaleRounds(staleIds);
        }
        this.show();
      }),
      makeButton('Alle Balance-Messungen löschen', () => {
        if (!window.confirm('Alle lokalen Balance-Messungen unwiderruflich löschen?')) return;
        deleteAllStoredCoopDefenseBalanceRounds();
        this.show();
      }),
      makeButton('Schließen', () => this.hide()),
    );
    // The report is deliberately textual: it keeps theory and playtest values scannable even
    // with many maps and avoids another bespoke Phaser/DOM table abstraction.
    const output = document.createElement('pre');
    Object.assign(output.style, { margin: '0', whiteSpace: 'pre-wrap', font: 'inherit', lineHeight: '1.35' });
    const lines = [
      `Aufzeichnung: ${getStoredCoopDefenseBalanceLab().recordingEnabled ? 'AN (nur 1P)' : 'AUS'} · Aktuell: ${report.currentRoundCount} · Veraltet: ${report.staleRoundCount}`,
      '',
    ];
    for (const map of report.maps) {
      const snapshot = map.snapshot;
      const metrics = map.metrics;
      lines.push(
        `${snapshot.mapId} · ${snapshot.displayName} · ${snapshot.objective.toUpperCase()} · ${snapshot.modelQuality}`,
        `  Theorie: ${snapshot.balanceReferenceDurationSec}s | finite ${snapshot.finiteEnemyCount} Gegner / ${snapshot.finiteEnemyHp} HP / ${snapshot.finiteEnemyXp} XP | persistent REFERENZ ${snapshot.persistentReferenceEnemyCount} / ${snapshot.persistentReferenceHp} HP / ${snapshot.persistentReferenceXp} XP | ${snapshot.persistentReferenceHpPerMinute.toFixed(1)} HP/min`,
        `  Basen: eigen ${snapshot.friendlyMainBaseHp} HP | Siegziel ${snapshot.hostileVictoryTargetHp || '—'} HP | Türme ${snapshot.turretCount} | Power-Ups ${snapshot.powerUpCount + snapshot.powerUpPedestalCount} | Tags ${snapshot.mechanicTags.join(', ') || '—'}`,
        `  Real: ${metrics.currentRounds} aktuell / ${metrics.ratedRounds} bewertet / ${metrics.staleRounds} veraltet | Siegquote ${formatPercent(metrics.victoryRate)} | Dauer Ø ${formatDuration(metrics.averageDurationMs)} / Median ${formatDuration(metrics.medianDurationMs)} | XP Ø ${metrics.averageActualXp?.toFixed(1) ?? '—'} | Schwierigkeit Ø ${metrics.averageDifficulty?.toFixed(1) ?? '—'} | Pacing Ø ${metrics.averagePacing?.toFixed(1) ?? '—'} | Basisreserve Ø ${formatPercent(metrics.averageOwnBaseReserve)}`,
        `  Auffälligkeiten: ${map.anomalies.join(' · ') || 'keine'}`,
        '',
      );
    }
    output.textContent = lines.join('\n');
    panel.append(controls, output);
    this.mount(panel);
  }

  showFeedback(roundEndedAt: number): void {
    this.hide();
    if (typeof document === 'undefined') return;
    const round = this.tracker.getRound(roundEndedAt);
    if (!round) return;
    const panel = this.createPanel('BALANCE-FEEDBACK', true);
    const description = document.createElement('div');
    description.textContent = 'Nur fuer diesen lokalen 1P-Testlauf. Das technische Ergebnis bleibt auch ohne Feedback gespeichert.';
    Object.assign(description.style, { color: toCssColor(COLORS.GREY_3), marginBottom: '12px', lineHeight: '1.4' });

    const difficulty = this.createRating('Schwierigkeit', [
      'viel zu leicht', 'eher leicht', 'passend', 'eher schwer', 'viel zu schwer',
    ], round.feedback?.difficulty ?? 3);
    const pacing = this.createRating('Pacing', [
      'zu ruhig', 'eher ruhig', 'passend', 'hektisch', 'Dauerstress',
    ], round.feedback?.pacing ?? 3);
    const comment = document.createElement('textarea');
    comment.value = round.feedback?.comment ?? '';
    comment.maxLength = 500;
    comment.placeholder = 'Optionaler Kommentar';
    Object.assign(comment.style, {
      width: '100%', minHeight: '82px', boxSizing: 'border-box', resize: 'vertical',
      padding: '7px', margin: '6px 0 12px', background: toCssColor(COLORS.GREY_9),
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`, color: toCssColor(COLORS.GREY_1), font: 'inherit',
    });
    const buttons = document.createElement('div');
    Object.assign(buttons.style, { display: 'flex', justifyContent: 'flex-end', gap: '7px' });
    buttons.append(
      makeButton('Abbrechen', () => this.hide()),
      makeButton('Feedback speichern', () => {
        this.tracker.updateFeedback(roundEndedAt, {
          difficulty: Number(difficulty.input.value) as BalanceRoundFeedback['difficulty'],
          pacing: Number(pacing.input.value) as BalanceRoundFeedback['pacing'],
          comment: comment.value.slice(0, 500),
        });
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
