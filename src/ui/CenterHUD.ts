/**
 * CenterHUD – bildschirmfeste Arena-Infoflächen.
 *
 * Es gibt keine festen GUI-Bereiche: Jede Fläche liegt über der Spielwelt. Daher gilt
 * „so wenig wie möglich, so viel wie nötig" – schmale Waldboden-Rahmen mit halbtransparentem
 * Glas, die nur erscheinen, solange sie etwas zu sagen haben:
 *   - oben mittig die Statusleiste (Lebensstatus, Rundentimer, Zug)
 *   - oben rechts Hauptziel und Angriffsserie (darunter das Nebenziel-HUD)
 *   - unten eine flache Zeile für Utility, Rüstung, Ultimate, Baukapazität und Power-Ups
 *   - kurze Meldungen oberhalb der Spielfigur
 * Das Tutorial-Fenster ist ein Weltobjekt und lebt in {@link CoopDefenseTutorialPanel}.
 */
import * as Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, DEPTH, COLORS, toCssColor } from '../config';
import { getUtilityHudDisplayName, type ArenaHUDData } from './ArenaHUD';
import type { CoopDefenseEncounterPresentationState } from '../types';
import type { CoopDefenseLifeStatusViewModel } from './coopDefenseLifeStatusModel';
import { formatNumber, getLocale, t } from '../i18n';
import { getContentDisplayName, getSourceName } from '../i18n/contentPresentation';
import { POWERUP_DEFS } from '../powerups/PowerUpConfig';
import type { CoopDefenseTutorialAnchor } from '../config/coopDefenseTutorial';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import type { MainObjectiveViewModel } from './coopDefenseMainObjectiveModel';
import type { CoopDefenseObjectiveAnnouncement } from './CoopDefenseObjectiveAnnouncement';
import {
  COOP_DEFENSE_ENCOUNTER_LAYOUT,
  COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT,
} from './CoopDefenseSecondaryObjectiveLayout';
import {
  advanceHudOcclusionFade,
  createHudOcclusionFadeState,
  type HudOcclusionRect,
  resetHudOcclusionFade,
} from './hudOcclusionFade';
import { isHudRectOccluded } from './hudOcclusionProbe';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import { HudCard, hudTextStyle } from './HudCard';
import { HUD_TONES, hudToneForColor, type HudTone } from './HudFrameAssets';
import { HudStatusStrip, type HudStatusField } from './HudStatusStrip';
import { HudResourceRow, type HudResourceEntry } from './HudResourceRow';
import { CoopDefenseTutorialPanel } from './CoopDefenseTutorialPanel';

const CENTER_X = GAME_WIDTH / 2;
const STATUS_STRIP_TOP = 8;
const TIMER_WARNING_SECS = 10;

// ── Kurzmeldungen (Frags, Bier) ─────────────────────────────────────────────
// Oberhalb der Spielfigur statt auf ihr: Die Bildmitte gehört dem Kampf.
const TOAST_Y = GAME_HEIGHT / 2 - 190;
const TOAST_MAX_TEXT_W = 620;
const TOAST_IN_MS = 200;
const TOAST_HOLD_MS = 950;
const TOAST_OUT_MS = 280;
const TOAST_BAND_TEX = '_center_toast_band';
const TOAST_TEXT_COLOR = 0xe6dcc4;

// ── Missionskarten ──────────────────────────────────────────────────────────
const MAIN = COOP_DEFENSE_MAIN_OBJECTIVE_LAYOUT;
const MAIN_X = MAIN.centerX;
const MAIN_Y = MAIN.topY + MAIN.height / 2;
const ENCOUNTER = COOP_DEFENSE_ENCOUNTER_LAYOUT;
const ENCOUNTER_X = ENCOUNTER.centerX;
const ENCOUNTER_Y = ENCOUNTER.topY + ENCOUNTER.height / 2;
const CARD_ENTRY_MS = 220;
const CARD_HANDOFF_MS = 180;
/** Über dieser Wellenzahl bleibt die Markenleiste leer; die Marken wären nicht mehr zählbar. */
const ENCOUNTER_PIP_MAX = 9;
const ENCOUNTER_SCAN_PERIOD_MS = 1_800;
const ENCOUNTER_ANNOUNCEMENT_PRIORITY = 100;
const ENCOUNTER_START_ANNOUNCEMENT_HOLD_MS = 900;
const ENCOUNTER_RESULT_ANNOUNCEMENT_HOLD_MS = 1_200;

// ── Untere Zeile ────────────────────────────────────────────────────────────
const STACK_REVEAL_MS = 500;
const ULTIMATE_REVEAL_MS = 850;
const CONSTRUCTION_CAPACITY_ID = 'construction';
/** Laufende Power-Ups ohne eigene Restzeit zeigen ihren Zähler statt einer Rinne. */
const POWER_UPS_WITHOUT_TRACK = new Set(['NEGEV_KILLSTREAK']);

type EncounterPhase = CoopDefenseEncounterPresentationState['phase'];
type TrainState =
  | { readonly mode: 'hidden' }
  | { readonly mode: 'arrival'; readonly secs: number }
  | { readonly mode: 'hp'; readonly ratio: number }
  | { readonly mode: 'destroyed' };

function encounterTone(phase: EncounterPhase): HudTone {
  return phase === 'cleared' || phase === 'complete' ? 'green' : 'purple';
}

function formatEncounterFronts(fronts: readonly string[] | undefined): string {
  const labels = (fronts ?? ['west']).map((front) => ({
    west: t('ui.direction.west'),
    north: t('ui.direction.north'),
    east: t('ui.direction.east'),
    south: t('ui.direction.south'),
  } as Record<string, string>)[front] ?? t('ui.direction.west'));
  return labels.length > 1 ? labels.join(' + ') : labels[0] ?? t('ui.direction.west');
}

function formatEncounterLabel(
  sequenceIndex: number,
  sequenceCount: number,
  fronts: readonly string[] | undefined,
): string {
  const count = Math.max(1, Math.floor(sequenceCount));
  const index = Math.min(count, Math.max(1, Math.floor(sequenceIndex)));
  return t('ui.encounter.waveLabel', { index, count, fronts: formatEncounterFronts(fronts) });
}

function formatClock(secs: number): string {
  const safe = Math.max(0, Math.ceil(secs));
  return safe < 60 ? `${safe}s` : `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`;
}

function cssToColor(css: string): number {
  const parsed = Number.parseInt(css.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : COLORS.GOLD_1;
}

/** Weiches, zu den Rändern auslaufendes Band hinter Kurzmeldungen – kein Kasten über der Welt. */
function ensureToastBandTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TOAST_BAND_TEX)) return;
  const w = 512;
  const h = 64;
  const ct = scene.textures.createCanvas(TOAST_BAND_TEX, w, h);
  if (!ct) return;
  const ctx = ct.context;
  const horizontal = ctx.createLinearGradient(0, 0, w, 0);
  horizontal.addColorStop(0, 'rgba(7,10,12,0)');
  horizontal.addColorStop(0.22, 'rgba(7,10,12,0.62)');
  horizontal.addColorStop(0.78, 'rgba(7,10,12,0.62)');
  horizontal.addColorStop(1, 'rgba(7,10,12,0)');
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  const vertical = ctx.createLinearGradient(0, 0, 0, h);
  vertical.addColorStop(0, 'rgba(0,0,0,0)');
  vertical.addColorStop(0.3, 'rgba(0,0,0,1)');
  vertical.addColorStop(0.7, 'rgba(0,0,0,1)');
  vertical.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ct.refresh();
}

export class CenterHUD {
  private container!: Phaser.GameObjects.Container;
  private statusStrip!: HudStatusStrip;
  private resourceRow!: HudResourceRow;
  private readonly tutorial: CoopDefenseTutorialPanel;

  private toast!: Phaser.GameObjects.Container;
  private toastBand!: Phaser.GameObjects.Image;
  private toastText!: Phaser.GameObjects.Text;
  private toastTween: Phaser.Tweens.TweenChain | null = null;

  /** Trägt Hauptziel- und Angriffsserien-Karte; weicht als Ganzes vor dem Spielfeld zurück. */
  private missionStack!: Phaser.GameObjects.Container;
  private readonly missionStackFade = createHudOcclusionFadeState();
  private mainCard!: HudCard;
  private mainTween: Phaser.Tweens.Tween | null = null;
  private encounterCard!: HudCard;
  private encounterTween: Phaser.Tweens.Tween | null = null;
  private encounterPulseTween: Phaser.Tweens.Tween | null = null;

  // Statusleiste
  private timerSecs: number | null = null;
  private lifeStatus: CoopDefenseLifeStatusViewModel | null = null;
  private train: TrainState = { mode: 'hidden' };
  private statusSignature = '';

  private lastMainObjectiveId: string | null = null;
  private lastMainObjectiveSignature: string | null = null;
  private mainObjectiveAnnouncementPending = false;
  private lastEncounterPresentationId: string | null = null;
  private lastEncounterPresentationSignature: string | null = null;
  private lastEncounterPresentationPhase: EncounterPhase | null = null;
  private lastEncounterCountdownText: string | null = null;
  private encounterAnnouncementHandsOver = false;
  private currentEncounterAnnouncementId: string | null = null;
  private currentEncounterAnnouncementPhase: EncounterPhase | null = null;
  private readonly announcedEncounterStarts = new Set<string>();
  private readonly announcedEncounterResults = new Set<string>();

  private utilityRevealUntil = 0;
  private ultimateRevealUntil = 0;
  private utilityHeldLastFrame = false;

  private objectiveAnnouncements: CoopDefenseObjectiveAnnouncement | null = null;

  constructor(private scene: Phaser.Scene) {
    this.tutorial = new CoopDefenseTutorialPanel(scene);
  }

  setObjectiveAnnouncements(announcements: CoopDefenseObjectiveAnnouncement | null): void {
    this.objectiveAnnouncements = announcements;
  }

  build(): void {
    this.container = this.scene.add.container(0, 0);
    this.container.setDepth(DEPTH.OVERLAY - 1);
    this.container.setVisible(false);
    promoteToClarityCamera(this.scene, this.container);

    this.statusStrip = new HudStatusStrip(this.scene, CENTER_X, STATUS_STRIP_TOP);
    this.container.add(this.statusStrip.root);

    // Eigene Zwischenebene für die beiden Missionskarten: Ihre Auftritts-Tweens schreiben ihr
    // eigenes Alpha, das Ausweichen vor dem Spielfeld liegt deshalb eine Ebene darüber und
    // multipliziert sich damit, statt es abzubrechen.
    this.missionStack = this.scene.add.container(0, 0);
    this.container.add(this.missionStack);
    this.buildMissionCards();

    this.resourceRow = new HudResourceRow(this.scene, this.container);
    this.buildToast();
    this.tutorial.build();
  }

  private buildMissionCards(): void {
    this.mainCard = new HudCard(this.scene, {
      scale: MAIN.scale, width: MAIN.width, tone: 'gold', titleSize: 15, valueSize: 14,
    });
    this.mainCard.setKicker(t('ui.objective.main'));
    this.mainCard.root.setPosition(MAIN_X, MAIN_Y).setVisible(false);
    this.encounterCard = new HudCard(this.scene, {
      scale: ENCOUNTER.scale, width: ENCOUNTER.width, tone: 'purple', titleSize: 15, valueSize: 14,
    });
    this.encounterCard.root.setPosition(ENCOUNTER_X, ENCOUNTER_Y).setVisible(false);
    this.missionStack.add([this.mainCard.root, this.encounterCard.root]);
  }

  private buildToast(): void {
    ensureToastBandTexture(this.scene);
    this.toastBand = this.scene.add.image(0, 0, TOAST_BAND_TEX);
    this.toastText = this.scene.add.text(0, 0, '', {
      ...hudTextStyle(22, TOAST_TEXT_COLOR, false, 1),
      align: 'center',
      wordWrap: { width: TOAST_MAX_TEXT_W, useAdvancedWrap: true },
    }).setOrigin(0.5);
    this.toast = this.scene.add.container(CENTER_X, TOAST_Y, [this.toastBand, this.toastText])
      .setVisible(false);
    this.container.add(this.toast);
  }

  transitionToGame(): void {
    this.container.setVisible(true);
    // Der eigentliche Rundentimer wird erst ab `isArenaStarted()` synchronisiert. Bis dahin
    // darf kein Build-Default als bereits laufender Spieltimer erscheinen.
    this.timerSecs = null;
    this.syncStatusStrip();
  }

  transitionToLobby(): void {
    this.container.setVisible(false);
    this.resetCoopMissionPresentation();
    this.hideTrainWidget();
    this.timerSecs = null;
    this.statusSignature = '';
    this.statusStrip.hide();
    this.resourceRow.clear();
    this.utilityRevealUntil = 0;
    this.ultimateRevealUntil = 0;
    this.utilityHeldLastFrame = false;
  }

  /**
   * Clears only Activity-scoped Coop presentation. The CenterHUD itself remains scene-lifetime
   * infrastructure and can immediately serve the next World or Activity.
   */
  resetCoopMissionPresentation(): void {
    this.objectiveAnnouncements?.reset();
    this.announcedEncounterStarts.clear();
    this.announcedEncounterResults.clear();
    this.encounterAnnouncementHandsOver = false;
    this.hideToast();
    this.hideMainObjectivePresentation(true);
    this.hideEncounterPresentation();
    this.tutorial.reset();
    if (this.missionStack) {
      resetHudOcclusionFade(this.missionStackFade);
      this.missionStack.setAlpha(1);
    }
    this.lifeStatus = null;
    this.syncStatusStrip();
  }

  // ── Statusleiste ──────────────────────────────────────────────────────────

  updateTimer(secs: number, visible = true): void {
    const next = visible ? Math.max(0, Math.floor(secs)) : null;
    if (next === this.timerSecs) return;
    this.timerSecs = next;
    this.syncStatusStrip();
  }

  /**
   * Lebens-/Rückkehrstatus. Jede Map mit authored Respawn-Budget füllt ihn; welcher Text
   * erscheint, entscheidet allein das Anzeigemodell.
   */
  updateLifeStatus(model: CoopDefenseLifeStatusViewModel | null): void {
    const same = model?.text === this.lifeStatus?.text && model?.color === this.lifeStatus?.color;
    this.lifeStatus = model;
    if (!same) this.syncStatusStrip();
  }

  /** @param arrivalTimerSecs Verbleibende Sekunden bis zur nächsten Einfahrt. */
  setTrainArrival(arrivalTimerSecs: number): void {
    this.setTrain({ mode: 'arrival', secs: Math.max(0, Math.ceil(arrivalTimerSecs)) });
  }

  updateTrainHP(hp: number, maxHp: number): void {
    const ratio = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0;
    // Auf Leistenpixel quantisiert: Die Leiste baut nur bei sichtbarer Änderung neu.
    this.setTrain({ mode: 'hp', ratio: Math.round(ratio * 92) / 92 });
  }

  showTrainDestroyed(): void {
    this.setTrain({ mode: 'destroyed' });
  }

  hideTrainWidget(): void {
    this.setTrain({ mode: 'hidden' });
  }

  private setTrain(next: TrainState): void {
    const current = this.train;
    if (current.mode === next.mode
      && (current.mode !== 'arrival' || current.secs === (next as typeof current).secs)
      && (current.mode !== 'hp' || current.ratio === (next as typeof current).ratio)) return;
    this.train = next;
    this.syncStatusStrip();
  }

  private syncStatusStrip(): void {
    if (!this.statusStrip) return;
    const fields: HudStatusField[] = [];
    if (this.lifeStatus) {
      const color = cssToColor(this.lifeStatus.color);
      fields.push(this.lifeStatus.value !== undefined
        ? { id: 'life', label: this.lifeStatus.label ?? '', value: this.lifeStatus.value, valueColor: color }
        : { id: 'life', label: '', value: this.lifeStatus.text, valueColor: color });
    }
    if (this.timerSecs !== null) {
      fields.push({
        id: 'timer',
        label: '',
        value: `${Math.floor(this.timerSecs / 60)}:${(this.timerSecs % 60).toString().padStart(2, '0')}`,
        valueColor: this.timerSecs <= TIMER_WARNING_SECS ? COLORS.RED_2 : undefined,
      });
    }
    const train = this.train;
    if (train.mode === 'arrival') {
      fields.push({ id: 'train', label: t('ui.train.name'), value: t('ui.train.arrivalShort', { time: formatClock(train.secs) }) });
    } else if (train.mode === 'hp') {
      fields.push({ id: 'train', label: t('ui.train.name'), value: '', bar: train.ratio });
    } else if (train.mode === 'destroyed') {
      fields.push({ id: 'train', label: t('ui.train.name'), value: t('ui.train.cancelled'), valueColor: COLORS.RED_2 });
    }
    const signature = fields.map((field) => `${field.id}|${field.label}|${field.value}|${field.valueColor ?? ''}|${field.bar ?? ''}`).join('#');
    if (signature === this.statusSignature) return;
    this.statusSignature = signature;
    this.statusStrip.setFields(fields);
  }

  // ── Hauptziel ─────────────────────────────────────────────────────────────

  updateMainObjectivePresentation(model: MainObjectiveViewModel | null): void {
    if (!model) {
      this.hideMainObjectivePresentation(false);
      return;
    }

    const objectiveChanged = model.id !== this.lastMainObjectiveId;
    const signature = `${model.id}|${model.title}|${model.progressLabel}|${model.progress.toFixed(4)}`;
    if (signature !== this.lastMainObjectiveSignature) {
      this.mainCard
        .setValue(model.progressLabel, HUD_TONES.gold.accent)
        .setTitle(model.title, COLORS.GOLD_1)
        .setProgress(model.progress);
      this.lastMainObjectiveSignature = signature;
    }

    if (objectiveChanged) {
      this.lastMainObjectiveId = model.id;
      this.mainObjectiveAnnouncementPending = this.objectiveAnnouncements !== null;
      this.mainCard.root.setVisible(false);
      if (this.objectiveAnnouncements) {
        this.objectiveAnnouncements.enqueue({
          id: `main:${model.id}`,
          kicker: t('ui.objective.main'),
          title: model.title,
          detail: model.progressLabel,
          tone: 'main',
          target: { x: MAIN_X, y: MAIN_Y, width: MAIN.width, scale: MAIN.scale },
          onStart: () => {
            this.mainObjectiveAnnouncementPending = true;
            this.mainCard?.root.setVisible(false);
          },
          onArrive: () => {
            this.mainObjectiveAnnouncementPending = false;
            if (this.lastMainObjectiveId === model.id) this.playCardEntry(this.mainCard, MAIN_Y, true, 'main');
          },
          onCancel: () => {
            this.mainObjectiveAnnouncementPending = false;
          },
        });
      } else {
        this.mainObjectiveAnnouncementPending = false;
        this.playCardEntry(this.mainCard, MAIN_Y, false, 'main');
      }
      return;
    }

    if (!this.mainObjectiveAnnouncementPending && !this.mainCard.root.visible) {
      this.playCardEntry(this.mainCard, MAIN_Y, false, 'main');
    }
  }

  /**
   * `handoff`: Eine Ankündigung hat ihren Rahmen bereits exakt auf diesem Platz abgelegt – nur
   * der Inhalt blendet auf. Sonst gleitet die Karte kurz von unten an ihren Platz.
   */
  private playCardEntry(card: HudCard, y: number, handoff: boolean, slot: 'main' | 'encounter'): void {
    const previous = slot === 'main' ? this.mainTween : this.encounterTween;
    previous?.destroy();
    let tween: Phaser.Tweens.Tween;
    if (handoff) {
      card.root.setY(y).setScale(1).setVisible(true).setAlpha(1);
      card.setContentAlpha(0);
      const proxy = { alpha: 0 };
      tween = this.scene.tweens.add({
        targets: proxy,
        alpha: 1,
        duration: CARD_HANDOFF_MS,
        ease: 'Quad.easeOut',
        onUpdate: () => { card.setContentAlpha(proxy.alpha); },
      });
    } else {
      card.setContentAlpha(1);
      card.root.setY(y + 8).setScale(1).setVisible(true).setAlpha(0);
      tween = this.scene.tweens.add({
        targets: card.root,
        alpha: 1,
        y,
        duration: CARD_ENTRY_MS,
        ease: 'Cubic.easeOut',
      });
    }
    if (slot === 'main') this.mainTween = tween;
    else this.encounterTween = tween;
  }

  private hideMainObjectivePresentation(resetRound: boolean): void {
    if (!resetRound && !this.lastMainObjectiveId && !this.mainCard?.root.visible) return;
    this.mainTween?.destroy();
    this.mainTween = null;
    this.mainCard?.setContentAlpha(1);
    this.mainCard?.root.setVisible(false).setAlpha(1).setScale(1).setPosition(MAIN_X, MAIN_Y);
    this.lastMainObjectiveId = null;
    this.lastMainObjectiveSignature = null;
    this.mainObjectiveAnnouncementPending = false;
  }

  /**
   * Pro Frame: Hauptziel- und Angriffsserien-Karte weichen gemeinsam zurück, sobald unter der
   * rechten Spalte gekämpft oder gezielt wird. Gemeinsam, weil eine halb durchsichtige Karte
   * über einer deckenden aussähe wie ein Darstellungsfehler.
   */
  updateMissionStackOcclusion(
    deltaMs: number,
    playerManager: PlayerManager | null,
    enemyManager: EnemyManager | null,
  ): void {
    if (!this.missionStack) return;
    const mainVisible = this.mainCard?.root.visible === true;
    const encounterVisible = this.encounterCard?.root.visible === true;
    if (!mainVisible && !encounterVisible) {
      resetHudOcclusionFade(this.missionStackFade);
      this.missionStack.setAlpha(1);
      return;
    }

    const occluded = isHudRectOccluded(this.scene, {
      left: MAIN_X - MAIN.width / 2,
      right: MAIN_X + MAIN.width / 2,
      top: mainVisible ? MAIN.topY : ENCOUNTER.topY,
      bottom: encounterVisible ? ENCOUNTER.topY + ENCOUNTER.height : MAIN.topY + MAIN.height,
    }, playerManager, enemyManager);
    this.missionStack.setAlpha(advanceHudOcclusionFade(this.missionStackFade, occluded, deltaMs));
  }

  /** Screen-Space-Flächen, die das World-Space-Tutorial nicht überdecken darf. */
  getReservedHudRects(): readonly HudOcclusionRect[] {
    const rects: HudOcclusionRect[] = [];
    const announcementRect = this.objectiveAnnouncements?.getReservedHudRect();
    if (announcementRect) rects.push(announcementRect);

    const addCardRect = (card: HudCard | undefined): void => {
      if (!card?.root.visible) return;
      rects.push({
        left: card.root.x - card.width * card.root.scaleX / 2,
        right: card.root.x + card.width * card.root.scaleX / 2,
        top: card.root.y - card.height * card.root.scaleY / 2,
        bottom: card.root.y + card.height * card.root.scaleY / 2,
      });
    };
    // Statusleiste und untere Zeile bleiben bewusst frei: Sie sind flach und dauerhaft sichtbar;
    // eine Reservierung würde die Tafel schon bei einer Randberührung verschwinden lassen.
    addCardRect(this.mainCard);
    addCardRect(this.encounterCard);
    return rects;
  }

  // ── Tutorial (Weltobjekt, eigene Klasse) ───────────────────────────────────

  updateTutorialOcclusion(deltaMs: number, reservedHudRects: readonly HudOcclusionRect[]): void {
    this.tutorial.updateTutorialOcclusion(deltaMs, reservedHudRects);
  }

  /**
   * @param showControls True: Unter dem Fließtext erscheint die Steuerungstabelle des
   *   Hilfe-Fensters; das Fenster wächst entsprechend (Einstiegs-Map).
   */
  updateTutorial(text: string | null, showControls = false, anchor?: CoopDefenseTutorialAnchor): void {
    this.tutorial.updateTutorial(text, showControls, anchor);
  }

  updateTutorialStep(text: string | null, anchor?: CoopDefenseTutorialAnchor): void {
    this.tutorial.updateTutorialStep(text, anchor);
  }

  // ── Angriffsserie ─────────────────────────────────────────────────────────

  updateEncounterPresentation(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
  ): void {
    if (!state) {
      this.currentEncounterAnnouncementId = null;
      this.currentEncounterAnnouncementPhase = null;
      this.hideEncounterPresentation();
      return;
    }

    this.currentEncounterAnnouncementId = state.encounterId;
    this.currentEncounterAnnouncementPhase = state.phase;
    this.queueEncounterAnnouncements(state);

    const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
    const remainingMs = state.phaseEndsAtMs === null
      ? 0
      : Math.max(0, state.phaseEndsAtMs - elapsed);
    const hasCountdown = state.phaseEndsAtMs !== null
      && (state.phase === 'incoming' || state.phase === 'rest');
    // Während des laufenden Angriffs tritt die Gegnerbilanz an die Stelle der Restzeit: Sie ist
    // hier die einzige Größe, die den Fortschritt der Welle tatsächlich beschreibt.
    const kills = state.phase === 'active'
      && typeof state.enemiesTotal === 'number'
      && typeof state.enemiesDefeated === 'number'
      && state.enemiesTotal > 0
      ? { defeated: Phaser.Math.Clamp(state.enemiesDefeated, 0, state.enemiesTotal), total: state.enemiesTotal }
      : null;
    const countdownText = kills
      ? `${kills.defeated} / ${kills.total}`
      : !hasCountdown
        ? ''
        : remainingMs >= 10_000
          ? t('ui.encounter.countdownSeconds', { seconds: formatNumber(Math.ceil(remainingMs / 1000), getLocale(), { useGrouping: false }) })
          : t('ui.encounter.countdownSeconds', { seconds: formatNumber(remainingMs / 1000, getLocale(), { maximumFractionDigits: 1, useGrouping: false }) });
    const statusText = t(
      state.phase === 'incoming'
        ? 'ui.encounter.status.incoming'
        : state.phase === 'active'
          ? 'ui.encounter.status.active'
          : state.phase === 'cleared'
            ? 'ui.encounter.status.cleared'
            : state.phase === 'rest'
              ? 'ui.encounter.status.rest'
              : 'ui.encounter.status.complete',
    );
    const tone = encounterTone(state.phase);
    const accent = HUD_TONES[tone].accent;
    const phaseChanged = state.phase !== this.lastEncounterPresentationPhase;
    const card = this.encounterCard;
    card.setTone(tone);

    if (countdownText !== this.lastEncounterCountdownText) {
      card.setValue(countdownText, accent);
      this.lastEncounterCountdownText = countdownText;
      this.lastEncounterPresentationSignature = null;
    }
    const textSignature = [state.encounterId, state.phase, statusText, tone].join('|');
    if (textSignature !== this.lastEncounterPresentationSignature) {
      card.setTitle(statusText, accent);
      this.lastEncounterPresentationSignature = textSignature;
    }
    this.syncEncounterPips(state);

    // Nur die Gegnerbilanz oder eine wirklich zeitlich endende Phase darf einen Abschluss
    // behaupten. Für einen offenen active-State ohne belastbare Gegnerzuordnung bleibt die
    // Rinne gedimmt gefüllt und bekommt stattdessen einen wandernden Lichtimpuls.
    const indeterminate = state.phase === 'active' && kills === null;
    const progress = indeterminate
      ? 1
      : kills
        ? kills.defeated / kills.total
        : state.phaseEndsAtMs === null
          ? 1
          : Phaser.Math.Clamp(
            (elapsed - state.phaseStartedAtMs) / Math.max(1, state.phaseEndsAtMs - state.phaseStartedAtMs),
            0,
            1,
          );
    const determinate = !indeterminate
      && (kills !== null || (state.phaseEndsAtMs !== null && state.phase !== 'active'));
    card.setProgress(progress, determinate, determinate ? 1 : 0.32);
    if (indeterminate) {
      const scan = 0.5 + 0.5 * Math.sin((elapsed / ENCOUNTER_SCAN_PERIOD_MS) * Math.PI * 2);
      card.setHeadAt(0.04 + scan * 0.92);
    }

    if (!this.encounterAnnouncementHandsOver && (phaseChanged || !card.root.visible)) {
      this.playEncounterPhaseEntry(state.phase, false);
    }
    this.lastEncounterPresentationId = state.encounterId;
    this.lastEncounterPresentationPhase = state.phase;
  }

  /**
   * Wellenposition als Marken auf der Rahmenschiene: abgewehrt, laufend und ausstehend sind an
   * Farbe unterscheidbar. Der Kicker nennt Welle und Front; bei sehr vielen Wellen bleibt er
   * allein, weil einzelne Marken dann nicht mehr zählbar wären.
   */
  private syncEncounterPips(state: CoopDefenseEncounterPresentationState): void {
    const count = Math.max(1, Math.floor(state.sequenceCount));
    const isDone = state.phase === 'cleared' || state.phase === 'complete';
    const clearedCount = state.phase === 'complete'
      ? count
      : isDone
        ? state.sequenceIndex
        : state.sequenceIndex - 1;
    const currentIndex = isDone ? -1 : state.sequenceIndex - 1;
    this.encounterCard.setKicker(formatEncounterLabel(state.sequenceIndex, count, state.encounterFronts));
    if (count > ENCOUNTER_PIP_MAX || count < 2) this.encounterCard.setPips(0, 0, -1);
    else this.encounterCard.setPips(count, clearedCount, currentIndex);
  }

  private queueEncounterAnnouncements(state: CoopDefenseEncounterPresentationState): void {
    if (!this.objectiveAnnouncements) return;
    const isStarting = state.phase === 'incoming' || state.phase === 'active';
    if (isStarting && !this.announcedEncounterStarts.has(state.encounterId)) {
      this.announcedEncounterStarts.add(state.encounterId);
      const targetId = state.encounterId;
      this.objectiveAnnouncements.enqueue({
        id: `wave:start:${targetId}`,
        topic: 'wave',
        priority: ENCOUNTER_ANNOUNCEMENT_PRIORITY,
        kicker: t('ui.encounter.waveKicker', { index: state.sequenceIndex, count: state.sequenceCount }),
        title: t('ui.encounter.attackFrom', { fronts: formatEncounterFronts(state.encounterFronts) }),
        detail: t('ui.encounter.prepare'),
        tone: 'wave',
        holdMs: ENCOUNTER_START_ANNOUNCEMENT_HOLD_MS,
        isRelevant: () => this.currentEncounterAnnouncementId === targetId
          && (this.currentEncounterAnnouncementPhase === 'incoming'
            || this.currentEncounterAnnouncementPhase === 'active'),
        target: { x: ENCOUNTER_X, y: ENCOUNTER_Y, width: ENCOUNTER.width, scale: ENCOUNTER.scale },
        onStart: () => {
          this.encounterAnnouncementHandsOver = true;
          this.encounterCard?.root.setVisible(false);
        },
        onArrive: () => {
          this.encounterAnnouncementHandsOver = false;
          if (this.lastEncounterPresentationId === targetId) {
            this.playEncounterPhaseEntry(this.lastEncounterPresentationPhase ?? state.phase, true);
          }
        },
        onCancel: () => {
          this.encounterAnnouncementHandsOver = false;
        },
      });
    }

    const isResult = state.phase === 'cleared' || state.phase === 'complete';
    const resultKey = `${state.encounterId}:${state.phase}`;
    if (isResult && !this.announcedEncounterResults.has(resultKey)) {
      this.announcedEncounterResults.add(resultKey);
      this.objectiveAnnouncements.enqueue({
        id: `wave:result:${resultKey}`,
        topic: 'wave',
        priority: ENCOUNTER_ANNOUNCEMENT_PRIORITY,
        kicker: state.phase === 'complete'
          ? t('ui.encounter.series')
          : t('ui.encounter.waveKicker', { index: state.sequenceIndex, count: state.sequenceCount }),
        title: state.phase === 'complete' ? t('ui.encounter.allWavesCleared') : t('ui.encounter.waveCleared'),
        tone: 'positive',
        holdMs: ENCOUNTER_RESULT_ANNOUNCEMENT_HOLD_MS,
        isRelevant: () => this.currentEncounterAnnouncementId === state.encounterId
          && (this.currentEncounterAnnouncementPhase === 'cleared'
            || this.currentEncounterAnnouncementPhase === 'complete'),
      });
    }
  }

  /**
   * Auftritt bei Phasenwechsel. Nur die beiden kurzen Signalphasen atmen; ein Dauerpuls während
   * des Angriffs würde neben den Kampfeffekten nur flimmern.
   */
  private playEncounterPhaseEntry(phase: EncounterPhase, handoff: boolean): void {
    this.playCardEntry(this.encounterCard, ENCOUNTER_Y, handoff, 'encounter');
    this.encounterPulseTween?.destroy();
    this.encounterPulseTween = null;
    this.encounterCard.setHeadPulse(1);
    if (phase !== 'incoming' && phase !== 'cleared') return;
    const proxy = { value: 1 };
    this.encounterPulseTween = this.scene.tweens.add({
      targets: proxy,
      value: 0.3,
      duration: phase === 'incoming' ? 340 : 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => { this.encounterCard.setHeadPulse(proxy.value); },
    });
  }

  private hideEncounterPresentation(): void {
    this.encounterTween?.destroy();
    this.encounterTween = null;
    this.encounterPulseTween?.destroy();
    this.encounterPulseTween = null;
    this.encounterCard?.setContentAlpha(1);
    this.encounterCard?.root
      .setVisible(false)
      .setAlpha(1)
      .setScale(1)
      .setPosition(ENCOUNTER_X, ENCOUNTER_Y);
    this.encounterAnnouncementHandsOver = false;
    this.currentEncounterAnnouncementId = null;
    this.currentEncounterAnnouncementPhase = null;
    this.lastEncounterPresentationSignature = null;
    this.lastEncounterPresentationId = null;
    this.lastEncounterPresentationPhase = null;
    this.lastEncounterCountdownText = null;
  }

  // ── Untere Zeile ──────────────────────────────────────────────────────────

  updateBottomStatus(data: ArenaHUDData, utilityHeld: boolean): void {
    const now = this.scene.time.now;
    if (utilityHeld) {
      this.utilityHeldLastFrame = true;
    } else if (this.utilityHeldLastFrame) {
      this.utilityHeldLastFrame = false;
      this.utilityRevealUntil = now + STACK_REVEAL_MS;
    }

    const showUtility = utilityHeld
      || data.utilityAction !== undefined
      || data.persistentBaseRewardId !== undefined
      || data.utilityCooldownFrac > 0.001
      || data.utilityBlocked === true
      || Boolean(data.utilityStatusLabel)
      || now < this.utilityRevealUntil
      || (data.isTemporaryUtilitySelected ?? false);
    const isUltimateReady = data.isUltimateActive || data.rage >= data.ultimateRequiredRage;
    const showUltimate = isUltimateReady || now < this.ultimateRevealUntil;

    const entries: HudResourceEntry[] = [];
    if (showUtility) {
      const charges = data.utilityChargeState
        ? `${data.utilityChargeState.availableCharges}/${data.utilityChargeState.maxCharges}`
        : '';
      entries.push({
        id: 'utility',
        side: 'left',
        tone: 'orange',
        title: getUtilityHudDisplayName(data.utilityId, data.utilityAction, data.persistentBaseRewardId),
        value: data.utilityStatusLabel ?? charges,
        frac: Phaser.Math.Clamp(1 - data.utilityCooldownFrac, 0, 1),
        energy: data.isTemporaryUtilitySelected ? 1 : 0,
        dim: data.utilityBlocked === true,
        attention: data.isTemporaryUtilitySelected ?? false,
      });
    }
    if (data.armor > 0) {
      entries.push({
        id: 'armor',
        side: 'left',
        tone: 'gold',
        title: t('ui.hud.armor'),
        value: `${Math.round(data.armor)}/${Math.round(data.maxArmor)}`,
        frac: Phaser.Math.Clamp(data.armor / Math.max(1, data.maxArmor), 0, 1),
      });
    }
    if (showUltimate) {
      entries.push({
        id: 'ultimate',
        side: 'right',
        tone: 'red',
        title: data.ultimateId ? getContentDisplayName(data.ultimateId, getLocale()) : t('ui.hud.ultimateShort'),
        value: isUltimateReady ? t('ui.hud.ready') : '',
        valueColor: isUltimateReady ? HUD_TONES.red.accent : undefined,
        frac: Phaser.Math.Clamp(data.rage / Math.max(1, data.maxRage), 0, 1),
        energy: isUltimateReady ? 1 : 0,
        attention: isUltimateReady,
      });
    }
    const capacityMax = data.constructionCapacityMax ?? 0;
    if (capacityMax > 0) {
      const used = Phaser.Math.Clamp(data.constructionCapacityUsed ?? 0, 0, capacityMax);
      entries.push({
        id: CONSTRUCTION_CAPACITY_ID,
        side: 'right',
        tone: 'bronze',
        title: t('ui.hud.constructionCapacity'),
        value: `${Math.round(used)} / ${Math.round(capacityMax)}`,
        frac: used / capacityMax,
      });
    }
    if (data.shieldBuff?.visible) {
      const shield = data.shieldBuff;
      entries.push(this.powerUpEntry(shield.defId,
        shield.maxValue > 0 ? shield.value / shield.maxValue : 0, `+${shield.damageBonusPct}%`));
    }
    for (const powerUp of data.activePowerUps ?? []) {
      if (!POWERUP_DEFS[powerUp.defId] || powerUp.remainingFrac <= 0.001) continue;
      entries.push(this.powerUpEntry(powerUp.defId, powerUp.remainingFrac, powerUp.valueText, powerUp.intensity));
    }
    this.resourceRow.sync(entries);
  }

  private powerUpEntry(defId: string, remainingFrac: number, valueText?: string, intensity?: number): HudResourceEntry {
    const def = POWERUP_DEFS[defId];
    return {
      id: `powerup:${defId}`,
      side: 'right',
      tone: def ? hudToneForColor(def.color) : 'neutral',
      title: getContentDisplayName(defId, getLocale()),
      value: valueText ?? '',
      frac: POWER_UPS_WITHOUT_TRACK.has(defId) ? null : Phaser.Math.Clamp(remainingFrac, 0, 1),
      energy: intensity ?? 0,
    };
  }

  flashUtilityCooldown(_frac: number, _displayName: string): void {
    this.utilityRevealUntil = Math.max(this.utilityRevealUntil, this.scene.time.now + STACK_REVEAL_MS);
  }

  flashUltimateInsufficientRage(): void {
    this.ultimateRevealUntil = Math.max(this.ultimateRevealUntil, this.scene.time.now + ULTIMATE_REVEAL_MS);
  }

  // ── Kurzmeldungen ─────────────────────────────────────────────────────────

  showAnnouncement(text: string, color: string | number = TOAST_TEXT_COLOR): void {
    this.toastTween?.destroy();
    this.toastTween = null;
    this.toastText.setText(text).setColor(typeof color === 'number' ? toCssColor(color) : color);
    this.toastBand.setDisplaySize(this.toastText.width + 220, Math.max(56, this.toastText.height + 26));
    this.toast.setVisible(true).setAlpha(0).setScale(0.92).setY(TOAST_Y + 8);
    this.toastTween = this.scene.tweens.chain({
      targets: this.toast,
      tweens: [
        { alpha: 1, scaleX: 1, scaleY: 1, y: TOAST_Y, duration: TOAST_IN_MS, ease: 'Back.easeOut' },
        { alpha: 0, y: TOAST_Y - 12, delay: TOAST_HOLD_MS, duration: TOAST_OUT_MS, ease: 'Quad.easeIn' },
      ],
      onComplete: () => this.hideToast(),
    });
  }

  showFraggedBy(killerName: string, sourceId: string, _color: number): void {
    this.showAnnouncement(t('ui.announcement.fraggedBy', {
      player: killerName,
      source: getSourceName(sourceId, getLocale()),
    }), COLORS.RED_2);
  }

  showYouFragged(victimName: string, _color: number): void {
    this.showAnnouncement(t('ui.announcement.youFragged', { player: victimName }), COLORS.GREEN_2);
  }

  showBeerCaptured(playerName: string, _color: number): void {
    this.showAnnouncement(t('ui.announcement.beerCaptured', { player: playerName }), COLORS.GREEN_2);
  }

  private hideToast(): void {
    this.toastTween?.destroy();
    this.toastTween = null;
    this.toast?.setVisible(false).setAlpha(1).setScale(1).setY(TOAST_Y);
  }

  destroy(): void {
    this.hideToast();
    this.hideMainObjectivePresentation(true);
    this.hideEncounterPresentation();
    this.tutorial.destroy();
    this.statusStrip.destroy();
    this.resourceRow.destroy();
    this.container.destroy(true);
  }
}
