import type { WeaponSlot } from '../types';
import {
  loadRuntimeBenchmarkResults,
  runtimeBenchmarkResultsToCsv,
  selectBestObservedRuntimeResults,
} from '../debug/coopDefenseBalance/runtimeBenchmarkStorage';
import type {
  RuntimeBenchmarkRequest,
  RuntimeBenchmarkResult,
  RuntimeBenchmarkScenario,
} from '../debug/coopDefenseBalance/runtimeBenchmarkTypes';
import { getOverlayRoot } from './fullscreen';

export interface WeaponBalanceLabSelection {
  readonly weapon1: string;
  readonly weapon2: string | null;
}

export interface WeaponBalanceLabStartResult {
  readonly ok: boolean;
  readonly message?: string;
}

function addLabel(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  Object.assign(label.style, { display: 'grid', gap: '5px', fontSize: '12px' });
  const caption = document.createElement('span');
  caption.textContent = text;
  caption.style.color = '#c8c8c8';
  label.append(caption, control);
  return label;
}

function download(filename: string, mimeType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export class WeaponBalanceLabOverlay {
  private root: HTMLDivElement | null = null;

  constructor(
    private readonly getSelection: () => WeaponBalanceLabSelection,
    private readonly start: (request: RuntimeBenchmarkRequest) => WeaponBalanceLabStartResult,
  ) {}

  isOpen(): boolean { return this.root !== null; }
  toggle(): void { if (this.root) this.hide(); else this.show(); }
  hide(): void { this.root?.remove(); this.root = null; }
  destroy(): void { this.hide(); }

  show(): void {
    if (this.root || typeof document === 'undefined') return;
    const selection = this.getSelection();
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '5200', display: 'grid', placeItems: 'center',
      background: 'rgba(0, 0, 0, 0.72)', color: '#f2f2f2', fontFamily: 'Arial, sans-serif',
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(720px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
      padding: '20px', border: '1px solid #6d7b64', borderRadius: '8px',
      background: 'rgba(18, 22, 17, 0.98)', boxShadow: '0 16px 48px rgba(0,0,0,.55)',
    });
    const title = document.createElement('h2');
    title.textContent = 'Balance Lab 2.0 – Schießstand';
    title.style.margin = '0 0 6px';
    const intro = document.createElement('p');
    intro.textContent = 'Startet eine frische interne Runde mit echtem Waffen-, Projektil-, Treffer- und Ressourcenpfad. Klasse, Items und allgemeine Upgrades bleiben neutral.';
    Object.assign(intro.style, { margin: '0 0 16px', color: '#b9c2b4', fontSize: '13px', lineHeight: '1.45' });

    const slot = document.createElement('select');
    slot.append(new Option(`Waffe 1 · ${selection.weapon1}`, 'weapon1'));
    if (selection.weapon2) slot.append(new Option(`Waffe 2 · ${selection.weapon2}`, 'weapon2'));
    const scenario = document.createElement('select');
    scenario.append(new Option('Einzelziel (ST)', 'single_target'), new Option('Fünf Ziele (5T)', 'five_target'));
    const distance = document.createElement('select');
    for (const value of [40, 100, 150, 180, 250]) distance.append(new Option(`${value} px`, String(value), value === 180, value === 180));
    const duration = document.createElement('input');
    duration.type = 'number'; duration.min = '2'; duration.max = '60'; duration.step = '1'; duration.value = '8';
    const controls = document.createElement('div');
    Object.assign(controls.style, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' });
    controls.append(
      addLabel('Waffen-Slot', slot),
      addLabel('Szenario', scenario),
      addLabel('Distanz', distance),
      addLabel('Messfenster', duration),
    );

    const status = document.createElement('div');
    Object.assign(status.style, { minHeight: '20px', marginTop: '12px', color: '#ffcf70', fontSize: '13px' });
    const buttons = document.createElement('div');
    Object.assign(buttons.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' });
    const startButton = document.createElement('button');
    startButton.textContent = 'Schießstand starten';
    const closeButton = document.createElement('button'); closeButton.textContent = 'Schließen';
    const jsonButton = document.createElement('button'); jsonButton.textContent = 'JSON exportieren';
    const csvButton = document.createElement('button'); csvButton.textContent = 'CSV exportieren';
    for (const button of [startButton, closeButton, jsonButton, csvButton]) {
      Object.assign(button.style, { padding: '8px 12px', cursor: 'pointer' });
    }
    startButton.onclick = () => {
      const measurementMs = Math.max(2_000, Math.min(60_000, Number(duration.value) * 1000));
      const result = this.start({
        slot: slot.value as WeaponSlot,
        scenario: scenario.value as RuntimeBenchmarkScenario,
        distance: Number(distance.value),
        warmupMs: 1_000,
        measurementMs,
        settleMs: 2_000,
      });
      if (result.ok) this.hide();
      else status.textContent = result.message ?? 'Der Schießstand konnte nicht gestartet werden.';
    };
    closeButton.onclick = () => this.hide();
    jsonButton.onclick = () => download(
      'weapon-balance-runtime.json',
      'application/json;charset=utf-8',
      JSON.stringify(loadRuntimeBenchmarkResults(), null, 2),
    );
    csvButton.onclick = () => download(
      'weapon-balance-runtime.csv',
      'text/csv;charset=utf-8',
      runtimeBenchmarkResultsToCsv(loadRuntimeBenchmarkResults()),
    );
    buttons.append(startButton, closeButton, jsonButton, csvButton);

    const storedResults = loadRuntimeBenchmarkResults();
    const bestTitle = document.createElement('h3');
    bestTitle.textContent = 'Best observed (kein theoretisches Maximum)';
    bestTitle.style.margin = '20px 0 8px';
    const bestList = document.createElement('div');
    this.renderBestObserved(bestList, storedResults);
    const resultTitle = document.createElement('h3');
    resultTitle.textContent = 'Letzte Runtime-Messungen';
    resultTitle.style.margin = '20px 0 8px';
    const resultList = document.createElement('div');
    this.renderResults(resultList, storedResults);
    panel.append(title, intro, controls, status, buttons, bestTitle, bestList, resultTitle, resultList);
    backdrop.appendChild(panel);
    backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) this.hide(); });
    getOverlayRoot().appendChild(backdrop);
    this.root = backdrop;
  }

  private renderResults(container: HTMLDivElement, results: readonly RuntimeBenchmarkResult[]): void {
    if (results.length === 0) {
      container.textContent = 'Noch keine Messungen vorhanden.';
      container.style.color = '#90998c';
      return;
    }
    for (const result of results.slice(0, 12)) {
      const row = document.createElement('div');
      Object.assign(row.style, { padding: '7px 0', borderTop: '1px solid #354033', fontFamily: 'monospace', fontSize: '12px' });
      row.textContent = `${result.weaponId} · ${result.scenario === 'five_target' ? '5T' : 'ST'} · ${result.distance}px · ${result.dps.toFixed(1)} DPS · ${result.totalDamage.toFixed(0)} Schaden · Adr +${result.adrenalineGeneratedPerSecond.toFixed(1)}/s / -${result.adrenalinePerSecond.toFixed(1)}/s · ${result.buildSignature} · Tail ${result.tailStatus}`;
      container.appendChild(row);
    }
  }

  private renderBestObserved(container: HTMLDivElement, results: readonly RuntimeBenchmarkResult[]): void {
    const bestObserved = selectBestObservedRuntimeResults(results);
    if (bestObserved.length === 0) {
      container.textContent = 'Noch keine vergleichbaren Messungen vorhanden.';
      container.style.color = '#90998c';
      return;
    }
    for (const { result, sampleCount } of bestObserved.slice(0, 8)) {
      const row = document.createElement('div');
      Object.assign(row.style, { padding: '7px 0', borderTop: '1px solid #354033', fontFamily: 'monospace', fontSize: '12px' });
      row.textContent = `${result.weaponId} · ${result.scenario === 'five_target' ? '5T' : 'ST'} · ${result.distance}px · ${result.dps.toFixed(1)} DPS · ${sampleCount} Run${sampleCount === 1 ? '' : 's'} · ${result.buildSignature}`;
      container.appendChild(row);
    }
  }
}
