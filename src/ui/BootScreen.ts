/**
 * BootScreen – DOM-Hilfe für den initialen Boot- und Ladescreen.
 *
 * Verwaltet den in `index.html` vorgerenderten Bootscreen während Verbindungsaufbau,
 * Schriftvorladung, Asset-Preload und der ersten gerenderten Frame-Ausgabe von Phaser.
 */

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
      fillEl.classList.remove(INDETERMINATE_CLASS);
      const clamped = Math.max(0, Math.min(1, ratio));
      fillEl.style.width = `${(clamped * 100).toFixed(1)}%`;
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
      fillEl.style.width = '';
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
        bootEl.remove();
        resolve();
      };

      bootEl.classList.add(FADE_OUT_CLASS);
      bootEl.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, durationMs + 50);
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
