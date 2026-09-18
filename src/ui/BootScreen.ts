/**
 * BootScreen – DOM-Hilfe für den initialen Boot- und Ladescreen.
 *
 * Verwaltet den in `index.html` vorgerenderten Bootscreen während Verbindungsaufbau,
 * Schriftvorladung, Asset-Preload und der ersten gerenderten Frame-Ausgabe von Phaser.
 */

import type { BootLoaderState } from './BootLoaderProgress';

export const BOOT_ERROR_EVENT = 'arena-boot-error';
export interface BootDiagnostics {
  phase: 'assets' | 'preparation' | 'reveal' | 'ready' | 'failed' | 'cancelled';
  startedAt: number;
  elapsedMs: number;
  phases: Array<{ phase: BootDiagnostics['phase']; elapsedMs: number }>;
  loader: BootLoaderState | null;
  steps: Array<{ name: string; durationMs: number }>;
  error?: string;
}
declare global { interface Window { __FD_BOOT__?: BootDiagnostics } }

const BOOT_SCREEN_ID = 'boot-screen';
const BOOT_STATUS_ID = 'boot-status';
const BOOT_BAR_FILL_ID = 'boot-bar-fill';
const INDETERMINATE_CLASS = 'boot-bar-indeterminate';
const FADE_OUT_CLASS = 'boot-screen-fade-out';

function getElement(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

export class BootScreen {
  private static progressElement: HTMLElement | null = null;
  private static progress = 0;
  private static diagnostics: BootDiagnostics | null = null;

  static begin(): void {
    this.progressElement = null;
    this.progress = 0;
    this.diagnostics = { phase: 'assets', startedAt: performance.now(), elapsedMs: 0,
      phases: [{ phase: 'assets', elapsedMs: 0 }], loader: null, steps: [] };
    if (typeof window !== 'undefined') window.__FD_BOOT__ = this.diagnostics;
  }

  static phase(phase: BootDiagnostics['phase'], error?: unknown): void {
    if (!this.diagnostics) return;
    if (phase === 'cancelled' && ['ready', 'failed'].includes(this.diagnostics.phase)) return;
    this.diagnostics.phase = phase;
    this.diagnostics.elapsedMs = performance.now() - this.diagnostics.startedAt;
    this.diagnostics.phases.push({ phase, elapsedMs: this.diagnostics.elapsedMs });
    if (error !== undefined) this.diagnostics.error = String(error);
  }

  static recordLoader(state: BootLoaderState): void {
    if (this.diagnostics) this.diagnostics.loader = state;
  }

  static recordStep(name: string, durationMs: number): void {
    this.diagnostics?.steps.push({ name, durationMs });
  }

  static setDetail(text: string): void {
    const detail = getElement('boot-detail');
    if (detail) detail.textContent = text;
  }
  /**
   * Setzt den sichtbaren Statustext im Bootscreen.
   */
  static setStatus(text: string): void {
    const statusEl = getElement(BOOT_STATUS_ID);
    if (!statusEl) return;
    statusEl.textContent = text;
  }

  /**
   * Setzt den Ladefortschritt von 0.0 bis 1.0 und beendet den unbestimmten Modus.
   * Optional kann gleichzeitig der Statustext aktualisiert werden.
   */
  static setProgress(ratio: number, statusText?: string): void {
    const fillEl = getElement(BOOT_BAR_FILL_ID);
    if (fillEl) {
      if (!Number.isFinite(ratio)) return;
      if (this.progressElement !== fillEl) { this.progressElement = fillEl; this.progress = 0; }
      fillEl.classList.remove(INDETERMINATE_CLASS);
      this.progress = Math.max(this.progress, Math.min(1, ratio));
      fillEl.style.transform = `scaleX(${this.progress})`;
    }
    if (statusText !== undefined) {
      BootScreen.setStatus(statusText);
    }
  }

  /**
   * Schaltet den Ladebalken in den unbestimmten (animierten) Zustand.
   */
  static setIndeterminate(indeterminate = true): void {
    const fillEl = getElement(BOOT_BAR_FILL_ID);
    if (!fillEl) return;
    if (indeterminate) {
      fillEl.classList.add(INDETERMINATE_CLASS);
    } else {
      fillEl.classList.remove(INDETERMINATE_CLASS);
    }
  }

  /**
   * Blendet den Bootscreen mit einem weichen CSS-Übergang aus und entfernt ihn aus dem DOM.
   */
  static fadeOut(durationMs = 250): Promise<void> {
    const bootEl = getElement(BOOT_SCREEN_ID);
    if (!bootEl) return Promise.resolve();

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(fallback);
        bootEl.removeEventListener('transitionend', onTransitionEnd);
        bootEl.remove();
        resolve();
      };
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === bootEl && event.propertyName === 'opacity') finish();
      };

      bootEl.classList.add(FADE_OUT_CLASS);
      bootEl.addEventListener('transitionend', onTransitionEnd);
      const fallback = setTimeout(finish, durationMs + 50);
    });
  }

  /**
   * Entfernt den Bootscreen sofort und rückstandslos aus dem DOM.
   * Wird insbesondere bei Startup- und WebGL-Fehlern genutzt, damit `showBootError`
   * garantiert ungehindert sichtbar wird.
   */
  static dismissImmediate(): void {
    const bootEl = getElement(BOOT_SCREEN_ID);
    if (bootEl) {
      bootEl.remove();
    }
  }
}
