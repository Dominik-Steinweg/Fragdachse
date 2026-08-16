import { COLORS, toCssColor } from '../config';
import { getOverlayRoot } from './fullscreen';
import { MINUTES_PER_DAY, formatTimeOfDay } from '../effects/TimeOfDay';

/**
 * Debug-Regler für die Uhrzeit der laufenden Runde.
 *
 * Bewusst **ohne** abdunkelnden Backdrop: Sinn des Reglers ist, die Beleuchtung während
 * des Ziehens zu beurteilen – ein Dimmer davor würde genau das verhindern. Das Panel
 * sitzt deshalb kompakt am unteren Bildrand und lässt die Arena frei.
 *
 * Die Änderung wirkt rein lokal. AUTO entfernt den Override wieder; auf dynamischen Maps
 * zeigt der Regler dann die inzwischen aus synchronisierter Rundenzeit berechnete Uhr statt
 * erneut auf die authored Startzeit zu springen.
 */

/** Viertelstunden: fein genug zum Beurteilen, grob genug für sinnvolle Pfeiltastenschritte. */
const STEP_MINUTES = 15;

export class TimeOfDayDebugOverlay {
  private panel: HTMLDivElement | null = null;
  private closePanelFn: (() => void) | null = null;

  constructor(
    private readonly getCurrentMinutes: () => number,
    private readonly getAutomaticMinutes: () => number,
    private readonly onOverride: (minutes: number, settled: boolean) => void,
    private readonly onAuto: () => void,
  ) {}

  show(): void {
    if (this.panel || typeof document === 'undefined') return;

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      width: '380px',
      padding: '14px 18px 16px',
      border: `2px solid ${toCssColor(COLORS.BROWN_4)}`,
      backgroundColor: toCssColor(COLORS.GREY_8),
      color: toCssColor(COLORS.GREY_1),
      fontFamily: 'monospace',
      boxShadow: '0 16px 36px rgba(0, 0, 0, 0.45)',
      // Zwischen dem XP-Cheat (3000) und den Performance-Diagnosen (4000).
      zIndex: '3500',
    });

    const title = document.createElement('div');
    title.innerText = 'UHRZEIT (nur lokal)';
    Object.assign(title.style, {
      fontSize: '12px',
      fontWeight: 'bold',
      color: toCssColor(COLORS.GREY_3),
      textAlign: 'center',
      marginBottom: '2px',
    });

    const readout = document.createElement('div');
    Object.assign(readout.style, {
      fontSize: '30px',
      fontWeight: 'bold',
      color: toCssColor(COLORS.GOLD_1),
      textAlign: 'center',
      marginBottom: '8px',
    });

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(MINUTES_PER_DAY - STEP_MINUTES);
    slider.step = String(STEP_MINUTES);
    slider.value = String(this.getCurrentMinutes());
    Object.assign(slider.style, {
      width: '100%',
      boxSizing: 'border-box',
      margin: '0 0 10px',
      cursor: 'pointer',
      accentColor: toCssColor(COLORS.GOLD_1),
    });

    const footer = document.createElement('div');
    Object.assign(footer.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      fontSize: '12px',
      color: toCssColor(COLORS.GREY_4),
    });

    const mapHint = document.createElement('span');

    const buttonStyle = {
      padding: '5px 10px',
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
      backgroundColor: toCssColor(COLORS.GREY_9),
      color: toCssColor(COLORS.GREY_1),
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontWeight: 'bold',
      fontSize: '11px',
    };

    const resetBtn = document.createElement('button');
    resetBtn.innerText = 'AUTO';
    Object.assign(resetBtn.style, buttonStyle);

    const closeBtn = document.createElement('button');
    closeBtn.innerText = 'SCHLIESSEN (ESC)';
    Object.assign(closeBtn.style, buttonStyle);

    const applyOverride = (minutes: number, settled: boolean): void => {
      slider.value = String(minutes);
      readout.innerText = formatTimeOfDay(minutes);
      this.onOverride(minutes, settled);
    };

    const applyAuto = (): void => {
      this.onAuto();
      const minutes = this.getAutomaticMinutes();
      slider.value = String(minutes);
      readout.innerText = formatTimeOfDay(minutes);
    };

    const closePanel = (): void => {
      if (this.panel === panel) {
        this.panel = null;
        this.closePanelFn = null;
      }
      document.removeEventListener('keydown', onKeyDown, true);
      panel.remove();
    };

    // In der Capture-Phase, damit Escape den Regler schliesst, bevor eine andere
    // Overlay-Ebene es aufgreift.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closePanel();
    };

    slider.addEventListener('input', () => applyOverride(Number(slider.value), false));
    slider.addEventListener('change', () => applyOverride(Number(slider.value), true));
    resetBtn.onclick = applyAuto;
    closeBtn.onclick = closePanel;
    document.addEventListener('keydown', onKeyDown, true);

    footer.append(mapHint, resetBtn, closeBtn);
    panel.append(title, readout, slider, footer);
    getOverlayRoot().appendChild(panel);

    this.panel = panel;
    this.closePanelFn = closePanel;
    mapHint.innerText = `Auto: ${formatTimeOfDay(this.getAutomaticMinutes())}`;
    readout.innerText = formatTimeOfDay(this.getCurrentMinutes());
    slider.focus();
  }

  hide(): void {
    this.closePanelFn?.();
  }

  toggle(): void {
    if (this.panel) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.panel !== null;
  }

  destroy(): void {
    this.hide();
  }
}
