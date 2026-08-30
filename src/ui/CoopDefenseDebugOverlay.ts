import { COLORS, toCssColor } from '../config';
import { COOP_DEFENSE_MAP_CONFIGS } from '../config/coopDefenseMaps';
import {
  COOP_DEFENSE_CLASS_IDS,
  getUnlockedCoopDefenseClassIds,
} from '../config/coopDefenseClasses';
import {
  resolvePersistentBaseBuildAreaForStage,
  type PersistentBaseAreaStage,
} from '../persistentBase/PersistentBaseCore';
import {
  getPersistentBaseRewardIds,
  PERSISTENT_BASE_REWARD_DEFINITIONS,
} from '../persistentBase/PersistentBaseRewardCatalog';
import type { PersistentBaseRewardId } from '../persistentBase/PersistentBaseRewardTypes';
import type { CoopDefenseClassId } from '../types';
import { getLocale, t } from '../i18n';
import { getClassName } from '../i18n/contentPresentation';
import { getOverlayRoot } from './fullscreen';
import { getCoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';

function sanitizeNumberInput(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export interface CoopDefenseDebugValues {
  totalXp: number;
  bossPoints: number;
  highestUnlockedMapId: string;
  unlockedClassIds: readonly CoopDefenseClassId[];
  itemsUnlocked: boolean;
  persistentBaseUnlocked: boolean;
  persistentBaseAreaStage: PersistentBaseAreaStage;
  persistentBaseRewardUnlocks: readonly PersistentBaseRewardId[];
}

type ButtonIntent = 'neutral' | 'positive' | 'danger';

export class CoopDefenseDebugOverlay {
  private popup: HTMLDivElement | null = null;
  private closePopupFn: (() => void) | null = null;

  constructor(
    private readonly getCurrentValues: () => CoopDefenseDebugValues,
    private readonly onSubmit: (
      totalXp: number,
      bossPoints: number,
      highestUnlockedMapId: string,
    ) => void,
    private readonly onResetCharacter: () => void,
    private readonly onUnlockPersistentBase: () => void = () => undefined,
    private readonly onUnlockPersistentBaseAreaStage: () => void = () => undefined,
    private readonly onGrantPersistentBaseReward: (rewardId: PersistentBaseRewardId) => void = () => undefined,
    private readonly onGrantAllPersistentBaseRewards: () => void = () => undefined,
    private readonly onUnlockItemSystem: () => void = () => undefined,
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
      padding: '16px',
      boxSizing: 'border-box',
      backgroundColor: 'rgba(0, 0, 0, 0.56)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflowY: 'auto',
      zIndex: '3000',
    });

    const popup = document.createElement('div');
    Object.assign(popup.style, {
      width: '100%',
      maxWidth: '760px',
      maxHeight: '92vh',
      overflowY: 'auto',
      boxSizing: 'border-box',
      padding: '18px 20px',
      border: `2px solid ${toCssColor(COLORS.BROWN_4)}`,
      backgroundColor: toCssColor(COLORS.GREY_8),
      color: toCssColor(COLORS.GREY_1),
      fontFamily: 'monospace',
      boxShadow: '0 16px 36px rgba(0, 0, 0, 0.35)',
    });

    const title = document.createElement('div');
    title.innerText = 'COOP DEFENSE DEBUG';
    Object.assign(title.style, {
      fontSize: '20px',
      fontWeight: 'bold',
      color: toCssColor(COLORS.GOLD_1),
      marginBottom: '8px',
      textAlign: 'center',
    });

    const subtitle = document.createElement('div');
    subtitle.innerText = 'Nur lokal. Ändert ausschließlich den gespeicherten Fortschritt dieser Browser-Instanz.';
    Object.assign(subtitle.style, {
      fontSize: '12px',
      color: toCssColor(COLORS.GREY_4),
      marginBottom: '14px',
      lineHeight: '1.4',
      textAlign: 'center',
    });

    const createSection = (sectionTitle: string): HTMLElement => {
      const section = document.createElement('section');
      Object.assign(section.style, {
        borderTop: `1px solid ${toCssColor(COLORS.GREY_6)}`,
        padding: '10px 0 12px',
        marginBottom: '2px',
      });
      const heading = document.createElement('div');
      heading.innerText = sectionTitle;
      Object.assign(heading.style, {
        fontSize: '13px',
        fontWeight: 'bold',
        color: toCssColor(COLORS.GOLD_1),
        marginBottom: '8px',
      });
      section.appendChild(heading);
      return section;
    };

    const createButton = (label: string, intent: ButtonIntent = 'neutral'): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerText = label;
      Object.assign(button.style, {
        padding: '6px 9px',
        border: `1px solid ${toCssColor(
          intent === 'positive' ? COLORS.GREEN_3 : intent === 'danger' ? COLORS.RED_3 : COLORS.GREY_5,
        )}`,
        backgroundColor: toCssColor(
          intent === 'positive' ? COLORS.GREEN_4 : intent === 'danger' ? COLORS.RED_4 : COLORS.GREY_9,
        ),
        color: toCssColor(COLORS.GREY_1),
        cursor: 'pointer',
        fontFamily: 'monospace',
        fontSize: '11px',
        fontWeight: 'bold',
      });
      return button;
    };

    const createStatusLine = (label: string, value: string): HTMLDivElement => {
      const line = document.createElement('div');
      line.innerText = `${label}: ${value}`;
      Object.assign(line.style, {
        color: toCssColor(COLORS.GREY_2),
        fontSize: '13px',
        lineHeight: '1.5',
      });
      return line;
    };

    const setNumberInputValue = (input: HTMLInputElement, value: number): void => {
      const serializedValue = String(sanitizeNumberInput(String(value)));
      // Keep the initial value and the live value in sync. Re-applying this after the
      // overlay is attached also forces the browser to repaint a native number input
      // whose initial paint would otherwise still show its default 0.
      input.defaultValue = serializedValue;
      input.value = serializedValue;
    };

    const createNumberInput = (value: number): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.autocomplete = 'off';
      setNumberInputValue(input, value);
      Object.assign(input.style, {
        width: '100%',
        padding: '6px 8px',
        boxSizing: 'border-box',
        border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
        backgroundColor: toCssColor(COLORS.GREY_9),
        color: toCssColor(COLORS.GREY_1),
        outline: 'none',
        fontFamily: 'monospace',
        fontSize: '16px',
        fontWeight: 'bold',
        textAlign: 'center',
      });
      return input;
    };

    const createInputLabel = (text: string): HTMLDivElement => {
      const label = document.createElement('div');
      label.innerText = text;
      Object.assign(label.style, {
        fontSize: '11px',
        fontWeight: 'bold',
        color: toCssColor(COLORS.GREY_3),
        marginBottom: '4px',
        textAlign: 'center',
      });
      return label;
    };

    const campaignSection = createSection('KAMPAGNE');
    const valuesGrid = document.createElement('div');
    Object.assign(valuesGrid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: '10px',
      marginBottom: '10px',
    });

    const xpInput = createNumberInput(currentValues.totalXp);
    const xpField = document.createElement('div');
    xpField.append(createInputLabel('ERFAHRUNG (XP)'), xpInput);
    const bossPointsInput = createNumberInput(currentValues.bossPoints);
    const bossPointsField = document.createElement('div');
    bossPointsField.append(createInputLabel('BOSSPUNKTE'), bossPointsInput);
    valuesGrid.append(xpField, bossPointsField);

    const unlockLabel = createInputLabel('HÖCHSTE FREIGESCHALTETE MAP');
    const unlockSelect = document.createElement('select');
    Object.assign(unlockSelect.style, {
      width: '100%',
      padding: '7px 8px',
      boxSizing: 'border-box',
      border: `1px solid ${toCssColor(COLORS.GREY_5)}`,
      backgroundColor: toCssColor(COLORS.GREY_9),
      color: toCssColor(COLORS.GREY_1),
      outline: 'none',
      fontFamily: 'monospace',
      fontSize: '13px',
      fontWeight: 'bold',
      textAlign: 'center',
      marginBottom: '10px',
    });
    for (const mapConfig of COOP_DEFENSE_MAP_CONFIGS) {
      const option = document.createElement('option');
      option.value = mapConfig.mapId;
      option.innerText = `Map ${mapConfig.mapId}`;
      unlockSelect.appendChild(option);
    }
    unlockSelect.value = currentValues.highestUnlockedMapId;

    const currentClassNames = currentValues.unlockedClassIds.map((classId) => (
      getClassName(classId, getLocale())
    ));
    const currentClasses = currentClassNames.length > 0
      ? currentClassNames.join(', ')
      : '– keine Klassen freigeschaltet';
    const currentClassesStatus = createStatusLine('Klassen aktuell', currentClasses);

    const preview = document.createElement('div');
    Object.assign(preview.style, {
      padding: '8px 10px',
      border: `1px solid ${toCssColor(COLORS.GREY_6)}`,
      backgroundColor: toCssColor(COLORS.GREY_9),
      fontSize: '12px',
      color: toCssColor(COLORS.GREY_2),
      textAlign: 'left',
      whiteSpace: 'pre-line',
      lineHeight: '1.45',
    });
    campaignSection.append(valuesGrid, unlockLabel, unlockSelect, currentClassesStatus, preview);

    const itemSection = createSection('ITEM-SYSTEM');
    const itemStatus = createStatusLine(
      'Items',
      currentValues.itemsUnlocked ? '✓ freigeschaltet' : '– gesperrt',
    );
    itemSection.appendChild(itemStatus);
    if (!currentValues.itemsUnlocked) {
      const unlockItemsButton = createButton('[ITEM-SYSTEM FREISCHALTEN]', 'positive');
      unlockItemsButton.style.marginTop = '7px';
      unlockItemsButton.onclick = () => {
        this.onUnlockItemSystem();
        this.refresh();
      };
      itemSection.appendChild(unlockItemsButton);
    }

    const persistentBaseSection = createSection('PERSISTENTE BASIS');
    persistentBaseSection.appendChild(createStatusLine(
      'Basis',
      currentValues.persistentBaseUnlocked ? '✓ Basis freigeschaltet' : '– gesperrt',
    ));
    if (!currentValues.persistentBaseUnlocked) {
      const unlockBaseButton = createButton('[BASIS FREISCHALTEN]', 'positive');
      unlockBaseButton.style.marginTop = '7px';
      unlockBaseButton.onclick = () => {
        this.onUnlockPersistentBase();
        this.refresh();
      };
      persistentBaseSection.appendChild(unlockBaseButton);
    }

    const area = resolvePersistentBaseBuildAreaForStage(currentValues.persistentBaseAreaStage);
    const areaDescription = area.kind === 'square'
      ? `Stage ${currentValues.persistentBaseAreaStage} · kleiner ${area.sizeCells}×${area.sizeCells}-Baubereich`
      : `Stage ${currentValues.persistentBaseAreaStage} · erweiterter Radius-${area.radiusCells}-Baubereich`;
    persistentBaseSection.appendChild(createStatusLine('Baubereich', areaDescription));
    if (currentValues.persistentBaseAreaStage === 0) {
      const unlockAreaButton = createButton('[BAUBEREICH STUFE 1 FREISCHALTEN]', 'positive');
      unlockAreaButton.style.marginTop = '7px';
      unlockAreaButton.onclick = () => {
        this.onUnlockPersistentBaseAreaStage();
        this.refresh();
      };
      persistentBaseSection.appendChild(unlockAreaButton);
    } else {
      const stageDone = document.createElement('div');
      stageDone.innerText = '✓ Baubereich Stufe 1';
      Object.assign(stageDone.style, {
        color: toCssColor(COLORS.GREEN_2),
        fontSize: '12px',
        marginTop: '4px',
      });
      persistentBaseSection.appendChild(stageDone);
    }

    const rewardsSection = createSection('BASIS-REWARDS');
    const rewardList = document.createElement('div');
    Object.assign(rewardList.style, {
      display: 'grid',
      gap: '6px',
    });
    for (const definition of PERSISTENT_BASE_REWARD_DEFINITIONS) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
      });
      const label = document.createElement('span');
      label.innerText = t(definition.presentation.labelKey);
      Object.assign(label.style, {
        color: toCssColor(COLORS.GREY_2),
        fontSize: '12px',
        minWidth: '0',
      });
      row.appendChild(label);

      if (currentValues.persistentBaseRewardUnlocks.includes(definition.id)) {
        const granted = document.createElement('span');
        granted.innerText = '✓';
        granted.style.color = toCssColor(COLORS.GREEN_2);
        row.appendChild(granted);
      } else {
        const grantButton = createButton('[VERGEBEN]', 'positive');
        grantButton.onclick = () => {
          this.onGrantPersistentBaseReward(definition.id);
          this.refresh();
        };
        row.appendChild(grantButton);
      }
      rewardList.appendChild(row);
    }
    rewardsSection.appendChild(rewardList);

    const rewardIds = getPersistentBaseRewardIds();
    const allRewardsGranted = rewardIds.every((rewardId) => (
      currentValues.persistentBaseRewardUnlocks.includes(rewardId)
    ));
    const allRewardsButton = createButton(
      allRewardsGranted ? '✓ ALLE REWARDS VERGEBEN' : '[ALLE REWARDS VERGEBEN]',
      'positive',
    );
    allRewardsButton.style.marginTop = '9px';
    allRewardsButton.disabled = allRewardsGranted;
    if (allRewardsGranted) {
      allRewardsButton.style.cursor = 'default';
      allRewardsButton.style.opacity = '0.65';
    } else {
      allRewardsButton.onclick = () => {
        this.onGrantAllPersistentBaseRewards();
        this.refresh();
      };
    }
    rewardsSection.appendChild(allRewardsButton);

    const toolsSection = createSection('TOOLS');
    const balanceTitle = document.createElement('div');
    balanceTitle.innerText = 'BALANCE LAB · 1P';
    Object.assign(balanceTitle.style, {
      fontSize: '12px',
      fontWeight: 'bold',
      color: toCssColor(COLORS.GREY_3),
      marginBottom: '7px',
    });
    const balanceControls = document.createElement('div');
    Object.assign(balanceControls.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      flexWrap: 'wrap',
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
    Object.assign(balanceCheckbox.style, {
      width: '16px',
      height: '16px',
      accentColor: toCssColor(COLORS.GOLD_1),
    });
    const balanceLabel = document.createElement('span');
    balanceLabel.innerText = 'Runden aufzeichnen';
    balanceToggle.append(balanceCheckbox, balanceLabel);
    const balanceReportButton = createButton('Auswertung öffnen');
    balanceReportButton.onclick = () => this.onOpenBalanceReport();
    balanceControls.append(balanceToggle, balanceReportButton);
    toolsSection.append(balanceTitle, balanceControls);

    const buttonRow = document.createElement('div');
    Object.assign(buttonRow.style, {
      display: 'flex',
      justifyContent: 'center',
      gap: '10px',
      flexWrap: 'wrap',
      paddingTop: '10px',
      borderTop: `1px solid ${toCssColor(COLORS.GREY_6)}`,
    });

    const confirmBtn = createButton('WERTE SETZEN', 'positive');
    confirmBtn.style.padding = '8px 14px';
    const cancelBtn = createButton('SCHLIESSEN', 'danger');
    cancelBtn.style.padding = '8px 14px';

    const resetBtn = createButton('GESAMTEN COOP-FORTSCHRITT ZURÜCKSETZEN', 'danger');
    Object.assign(resetBtn.style, {
      width: '100%',
      marginTop: '12px',
      padding: '9px 14px',
    });

    const getEffectiveClassIds = (): readonly CoopDefenseClassId[] => (
      getUnlockedCoopDefenseClassIds(unlockSelect.value)
    );

    const updatePreview = (): void => {
      const totalXp = sanitizeNumberInput(xpInput.value);
      const bossPoints = sanitizeNumberInput(bossPointsInput.value);
      if (String(totalXp) !== xpInput.value) xpInput.value = String(totalXp);
      if (String(bossPoints) !== bossPointsInput.value) bossPointsInput.value = String(bossPoints);
      const progress = getCoopDefenseProgressSnapshot(totalXp);
      const effectiveClassIds = getEffectiveClassIds();
      const classLines = COOP_DEFENSE_CLASS_IDS.map((classId) => (
        `${effectiveClassIds.includes(classId) ? '✓' : '–'} ${getClassName(classId, getLocale())}`
      ));
      preview.innerText = [
        `Level ${progress.level} · ${progress.xpNeededForNextLevel} XP bis Level ${progress.level + 1}`,
        `★ ${bossPoints} Bosspunkte · höchste Map: ${unlockSelect.value}`,
        'Klassen:',
        ...classLines,
        `Items: ${currentValues.itemsUnlocked ? '✓ freigeschaltet' : '– gesperrt'}`,
        `Basis: ${currentValues.persistentBaseUnlocked ? '✓ freigeschaltet' : '– gesperrt'} · Stage ${currentValues.persistentBaseAreaStage}`,
      ].join('\n');
    };

    const closePopup = (): void => {
      if (this.popup === backdrop) {
        this.popup = null;
        this.closePopupFn = null;
      }
      backdrop.remove();
    };

    const save = (): void => {
      this.onSubmit(
        sanitizeNumberInput(xpInput.value),
        sanitizeNumberInput(bossPointsInput.value),
        unlockSelect.value,
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
    unlockSelect.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') closePopup();
    });
    confirmBtn.onclick = save;
    cancelBtn.onclick = closePopup;
    resetBtn.onclick = () => {
      if (!window.confirm(
        'Wirklich den gesamten lokalen Coop-Fortschritt inklusive XP, Map-/Klassenfortschritt, Items, persistenter Basis und Basis-Rewards zurücksetzen?',
      )) return;
      this.onResetCharacter();
      closePopup();
    };

    const stopOverlayPointerPropagation = (event: Event): void => {
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
      campaignSection,
      itemSection,
      persistentBaseSection,
      rewardsSection,
      toolsSection,
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

  refresh(): void {
    if (!this.popup) return;
    this.hide();
    this.show();
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
