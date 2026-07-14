import { COLORS, toCssColor } from '../config';
import { getCoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';

function sanitizeNumberInput(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export class CoopDefenseXpDebugOverlay {
  private popup: HTMLDivElement | null = null;
  private closePopupFn: (() => void) | null = null;

  constructor(
    private readonly getCurrentXp: () => number,
    private readonly getCurrentBossPoints: () => number,
    private readonly onSubmit: (totalXp: number, bossPoints: number) => void,
  ) {}

  show(): void {
    if (this.popup || typeof document === 'undefined') return;

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
      width: '360px',
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
    subtitle.innerText = 'Nur lokal. Ueberschreibt Erfahrung und Bosspunkte dieser Browser-Instanz.';
    Object.assign(subtitle.style, {
      fontSize: '12px',
      color: toCssColor(COLORS.GREY_4),
      marginBottom: '14px',
      lineHeight: '1.4',
      textAlign: 'center',
    });

    const createNumberInput = (value: number) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = String(value);
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
    const xpInput = createNumberInput(this.getCurrentXp());
    const bossPointsLabel = createInputLabel('BOSSPUNKTE');
    const bossPointsInput = createNumberInput(this.getCurrentBossPoints());
    Object.assign(bossPointsInput.style, {
      width: '100%',
      marginBottom: '12px',
    });

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

    const updatePreview = () => {
      const totalXp = sanitizeNumberInput(xpInput.value);
      const bossPoints = sanitizeNumberInput(bossPointsInput.value);
      if (String(totalXp) !== xpInput.value) xpInput.value = String(totalXp);
      if (String(bossPoints) !== bossPointsInput.value) bossPointsInput.value = String(bossPoints);
      const progress = getCoopDefenseProgressSnapshot(totalXp);
      preview.innerText = `Level ${progress.level}\n${progress.xpNeededForNextLevel} XP bis Level ${progress.level + 1}  |  ★ ${bossPoints} Bosspunkte`;
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
    confirmBtn.onclick = save;
    cancelBtn.onclick = closePopup;
    backdrop.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.target === backdrop) closePopup();
    });

    buttonRow.append(confirmBtn, cancelBtn);
    popup.append(
      title,
      subtitle,
      xpLabel,
      xpInput,
      bossPointsLabel,
      bossPointsInput,
      preview,
      buttonRow,
    );
    backdrop.appendChild(popup);
    document.body.appendChild(backdrop);

    this.popup = backdrop;
    this.closePopupFn = closePopup;
    updatePreview();
    xpInput.focus();
    xpInput.select();
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
