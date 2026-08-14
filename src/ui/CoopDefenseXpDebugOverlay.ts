import { COLORS, toCssColor } from '../config';
import { getOverlayRoot } from './fullscreen';
import { COOP_DEFENSE_MAP_CONFIGS } from '../config/coopDefenseMaps';
import { getCoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';

function sanitizeNumberInput(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

interface CoopDefenseXpDebugValues {
  totalXp: number;
  bossPoints: number;
  highestUnlockedMapId: string;
  classesUnlocked: boolean;
}

export class CoopDefenseXpDebugOverlay {
  private popup: HTMLDivElement | null = null;
  private closePopupFn: (() => void) | null = null;

  constructor(
    private readonly getCurrentValues: () => CoopDefenseXpDebugValues,
    private readonly onSubmit: (
      totalXp: number,
      bossPoints: number,
      highestUnlockedMapId: string,
      classesUnlocked: boolean,
    ) => void,
    private readonly onResetCharacter: () => void,
    private readonly getBalanceRecordingEnabled: () => boolean = () => false,
    private readonly onBalanceRecordingChanged: (enabled: boolean) => void = () => undefined,
    private readonly onOpenBalanceReport: () => void = () => undefined,
  ) {}

  show(): void {
    if (this.popup || typeof document === 'undefined') return;

    const currentValues = this.getCurrentValues();
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      backgroundColor: 'rgba(0, 0, 0, 0.56)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '3000',
    });

    const popup = document.createElement('div');
    Object.assign(popup.style, {
      width: '400px',
      padding: '18px 20px',
      border: `2px solid ${toCssColor(COLORS.BROWN_4)}`,
      backgroundColor: toCssColor(COLORS.GREY_8),
      color: toCssColor(COLORS.GREY_1),
      fontFamily: 'monospace',
      boxShadow: '0 16px 36px rgba(0, 0, 0, 0.35)',
    });

    const title = document.createElement('div');
    title.innerText = 'COOP DEFENSE CHEATMODUS';
    Object.assign(title.style, {
      fontSize: '20px',
      fontWeight: 'bold',
      color: toCssColor(COLORS.GOLD_1),
      marginBottom: '8px',
      textAlign: 'center',
    });

    const subtitle = document.createElement('div');
    subtitle.innerText = 'Nur lokal. Überschreibt Fortschritt, Map- und Klassenfreischaltung dieser Browser-Instanz.';
    Object.assign(subtitle.style, {
      fontSize: '12px',
      color: toCssColor(COLORS.GREY_4),
      marginBottom: '14px',
      lineHeight: '1.4',
      textAlign: 'center',
    });

    const balanceSection = document.createElement('div');
    Object.assign(balanceSection.style, {
      borderTop: `1px solid ${toCssColor(COLORS.GREY_6)}`,
      borderBottom: `1px solid ${toCssColor(COLORS.GREY_6)}`,
      padding: '10px 0',
      marginBottom: '14px',
    });
    const balanceTitle = document.createElement('div');
    balanceTitle.innerText = 'BALANCE LAB · 1P';
    Object.assign(balanceTitle.style, {
      fontSize: '13px',
      fontWeight: 'bold',
      color: toCssColor(COLORS.GOLD_1),
      textAlign: 'center',
      marginBottom: '7px',
    });
    const balanceControls = document.createElement('div');
    Object.assign(balanceControls.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    });
    const balanceToggle = document.createElement('label');
    Object.assign(balanceToggle.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
      color: toCssColor(COLORS.GREY_2),
      fontSize: '12px',
      cursor: 'pointer',
    });
    const balanceCheckbox = document.createElement('input');
    balanceCheckbox.type = 'checkbox';
    balanceCheckbox.checked = this.getBalanceRecordingEnabled();
    balanceCheckbox.addEventListener('change', () => this.onBalanceRecordingChanged(balanceCheckbox.checked));
    Object.assign(balanceCheckbox.style, { width: '16px', height: '16px', accentColor: toCssColor(COLORS.GOLD_1) });
    const balanceLabel = document.createElement('span');
    balanceLabel.innerText = 'Runden aufzeichnen';
    balanceToggle.append(balanceCheckbox, balanceLabel);
    const balanceReportButton = document.createElement('button');
    balanceReportButton.type = 'button';
    balanceReportButton.innerText = 'Auswertung öffnen';
    Object.assign(balanceReportButton.style, {
      padding: '6px 8px',
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
      backgroundColor: toCssColor(COLORS.GREY_8),
      color: toCssColor(COLORS.GREY_1),
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontSize: '11px',
    });
    balanceReportButton.onclick = () => this.onOpenBalanceReport();
    balanceControls.append(balanceToggle, balanceReportButton);
    balanceSection.append(balanceTitle, balanceControls);

    const setNumberInputValue = (input: HTMLInputElement, value: number): void => {
      const serializedValue = String(sanitizeNumberInput(String(value)));
      // Keep the initial value and the live value in sync. Re-applying this after the
      // overlay is attached also forces the browser to repaint a native number input
      // whose initial paint would otherwise still show its default 0.
      input.defaultValue = serializedValue;
      input.value = serializedValue;
    };

    const createNumberInput = (value: number) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.autocomplete = 'off';
      setNumberInputValue(input, value);
      Object.assign(input.style, {
        width: '100%',
        padding: '8px 10px',
        boxSizing: 'border-box',
        border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
        backgroundColor: toCssColor(COLORS.GREY_9),
        color: toCssColor(COLORS.GREY_1),
        outline: 'none',
        fontFamily: 'monospace',
        fontSize: '22px',
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: '10px',
      });
      return input;
    };

    const createInputLabel = (text: string) => {
      const label = document.createElement('div');
      label.innerText = text;
      Object.assign(label.style, {
        fontSize: '12px',
        fontWeight: 'bold',
        color: toCssColor(COLORS.GREY_3),
        marginBottom: '5px',
        textAlign: 'center',
      });
      return label;
    };

    const xpLabel = createInputLabel('ERFAHRUNG (XP)');
    const xpInput = createNumberInput(currentValues.totalXp);
    const bossPointsLabel = createInputLabel('BOSSPUNKTE');
    const bossPointsInput = createNumberInput(currentValues.bossPoints);
    Object.assign(bossPointsInput.style, {
      width: '100%',
      marginBottom: '12px',
    });

    const unlockLabel = createInputLabel('FREIGESCHALTET BIS MAP');
    const unlockSelect = document.createElement('select');
    Object.assign(unlockSelect.style, {
      width: '100%',
      padding: '8px 10px',
      boxSizing: 'border-box',
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
      backgroundColor: toCssColor(COLORS.GREY_9),
      color: toCssColor(COLORS.GREY_1),
      outline: 'none',
      fontFamily: 'monospace',
      fontSize: '14px',
      fontWeight: 'bold',
      textAlign: 'center',
      marginBottom: '12px',
    });
    for (const mapConfig of COOP_DEFENSE_MAP_CONFIGS) {
      const option = document.createElement('option');
      option.value = mapConfig.mapId;
      option.innerText = `Map ${mapConfig.mapId}`;
      unlockSelect.appendChild(option);
    }
    unlockSelect.value = currentValues.highestUnlockedMapId;

    const classesRow = document.createElement('label');
    Object.assign(classesRow.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '9px',
      marginBottom: '12px',
      color: toCssColor(COLORS.GREY_2),
      fontSize: '13px',
      fontWeight: 'bold',
      cursor: 'pointer',
    });
    const classesCheckbox = document.createElement('input');
    classesCheckbox.type = 'checkbox';
    classesCheckbox.checked = currentValues.classesUnlocked;
    Object.assign(classesCheckbox.style, {
      width: '18px',
      height: '18px',
      accentColor: toCssColor(COLORS.GOLD_1),
      cursor: 'pointer',
    });
    const classesLabel = document.createElement('span');
    classesLabel.innerText = 'KLASSENMECHANIK FREIGESCHALTET';
    classesRow.append(classesCheckbox, classesLabel);

    const preview = document.createElement('div');
    Object.assign(preview.style, {
      fontSize: '14px',
      color: toCssColor(COLORS.GREY_2),
      textAlign: 'center',
      marginBottom: '14px',
      lineHeight: '1.5',
      minHeight: '42px',
    });

    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, {
      display: 'flex',
      justifyContent: 'center',
      gap: '10px',
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.innerText = 'WERTE SETZEN';
    Object.assign(confirmBtn.style, {
      padding: '8px 14px',
      border: `1px solid ${toCssColor(COLORS.GREEN_3)}`,
      backgroundColor: toCssColor(COLORS.GREEN_4),
      color: toCssColor(COLORS.GREY_1),
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontWeight: 'bold',
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'SCHLIESSEN';
    Object.assign(cancelBtn.style, {
      padding: '8px 14px',
      border: `1px solid ${toCssColor(COLORS.RED_3)}`,
      backgroundColor: toCssColor(COLORS.RED_4),
      color: toCssColor(COLORS.GREY_1),
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontWeight: 'bold',
    });

    const resetBtn = document.createElement('button');
    resetBtn.innerText = 'CHARAKTER AUF 0 SETZEN';
    Object.assign(resetBtn.style, {
      width: '100%',
      marginTop: '12px',
      padding: '9px 14px',
      border: `1px solid ${toCssColor(COLORS.RED_2)}`,
      backgroundColor: toCssColor(COLORS.RED_5),
      color: toCssColor(COLORS.GREY_1),
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontWeight: 'bold',
    });

    const updatePreview = () => {
      const totalXp = sanitizeNumberInput(xpInput.value);
      const bossPoints = sanitizeNumberInput(bossPointsInput.value);
      if (String(totalXp) !== xpInput.value) xpInput.value = String(totalXp);
      if (String(bossPoints) !== bossPointsInput.value) bossPointsInput.value = String(bossPoints);
      const progress = getCoopDefenseProgressSnapshot(totalXp);
      const unlockedMapName = COOP_DEFENSE_MAP_CONFIGS
        .find((mapConfig) => mapConfig.mapId === unlockSelect.value)?.mapId ?? unlockSelect.value;
      preview.innerText = `Level ${progress.level}\n${progress.xpNeededForNextLevel} XP bis Level ${progress.level + 1}  |  ★ ${bossPoints} Bosspunkte\nFreigeschaltet bis: ${unlockedMapName}\nKlassen: ${classesCheckbox.checked ? 'freigeschaltet' : 'gesperrt'}`;
    };

    const closePopup = () => {
      if (this.popup === backdrop) {
        this.popup = null;
        this.closePopupFn = null;
      }
      backdrop.remove();
    };

    const save = () => {
      this.onSubmit(
        sanitizeNumberInput(xpInput.value),
        sanitizeNumberInput(bossPointsInput.value),
        unlockSelect.value,
        classesCheckbox.checked,
      );
      closePopup();
    };

    for (const input of [xpInput, bossPointsInput]) {
      input.addEventListener('input', updatePreview);
      input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') save();
        if (event.key === 'Escape') closePopup();
      });
    }
    unlockSelect.addEventListener('change', updatePreview);
    classesCheckbox.addEventListener('change', updatePreview);
    unlockSelect.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') closePopup();
    });
    confirmBtn.onclick = save;
    cancelBtn.onclick = closePopup;
    resetBtn.onclick = () => {
      if (!window.confirm('Wirklich den gesamten Coop-Charakterfortschritt auf einen frischen Spieler zurücksetzen?')) {
        return;
      }
      this.onResetCharacter();
      closePopup();
    };
    const stopOverlayPointerPropagation = (event: Event) => {
      event.stopPropagation();
    };
    for (const eventName of [
      'pointerdown',
      'pointerup',
      'pointermove',
      'pointercancel',
      'mousedown',
      'mouseup',
      'mousemove',
      'touchstart',
      'touchend',
      'touchmove',
      'touchcancel',
      'wheel',
    ]) {
      backdrop.addEventListener(eventName, stopOverlayPointerPropagation);
    }
    backdrop.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      if (event.target === backdrop) closePopup();
    });

    buttonRow.append(confirmBtn, cancelBtn);
    popup.append(
      title,
      subtitle,
      balanceSection,
      xpLabel,
      xpInput,
      bossPointsLabel,
      bossPointsInput,
      unlockLabel,
      unlockSelect,
      classesRow,
      preview,
      buttonRow,
      resetBtn,
    );
    backdrop.appendChild(popup);
    getOverlayRoot().appendChild(backdrop);

    this.popup = backdrop;
    this.closePopupFn = closePopup;
    // Set the values once more after insertion so the visible native controls use the
    // same persisted values as the controls' initial state.
    setNumberInputValue(xpInput, currentValues.totalXp);
    setNumberInputValue(bossPointsInput, currentValues.bossPoints);
    updatePreview();
    xpInput.focus();
    xpInput.select();
    // Chrome kann den Live-Wert eines dynamischen Number-Inputs beim Fokussieren aus
    // seinem gespeicherten Formularzustand wiederherstellen. Der persistierte/default-Wert
    // bleibt dabei korrekt; nach dem Fokus und im naechsten Frame muss der Live-Wert deshalb
    // nochmals explizit synchronisiert werden.
    setNumberInputValue(xpInput, currentValues.totalXp);
    setNumberInputValue(bossPointsInput, currentValues.bossPoints);
    window.requestAnimationFrame(() => {
      if (this.popup !== backdrop) return;
      setNumberInputValue(xpInput, currentValues.totalXp);
      setNumberInputValue(bossPointsInput, currentValues.bossPoints);
    });
  }

  hide(): void {
    this.closePopupFn?.();
  }

  toggle(): void {
    if (this.popup) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.popup !== null;
  }

  destroy(): void {
    this.hide();
  }
}
