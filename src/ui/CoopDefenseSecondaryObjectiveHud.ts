/**
 * HUD der Coop-Defense-Nebenmissionen: Fokuskarte unter dem Pflichtziel, kleinere
 * Hintergrundkarten und die Aktivierungs- bzw. Abschlussankündigung.
 *
 * Gestaltungsgrundsatz: Hauptziel und Angriffsserie (`CenterHUD`) bleiben der Anker oben
 * rechts. Die Nebenziele stehen als eigene Spalte **darunter** und teilen Breite und
 * Rahmenfamilie, tragen aber die blaue Farbfamilie, die in keiner Encounter-Phase und in keiner
 * Teamfarbe vorkommt. Die Raute vor dem Titel markiert das freiwillige Ziel zusätzlich.
 *
 * Die Ankündigung erscheint im oberen Bilddrittel und verwandelt sich danach in genau diese
 * Fokuskarte – so entsteht die Verbindung zwischen Einblendung und Dauerzustand, ohne die
 * Sicht auf die eigene Figur zu verstellen.
 */
import * as Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';
import {
  buildSecondaryObjectiveViewModel,
  SECONDARY_OBJECTIVE_MAX_CHIPS,
  type SecondaryObjectiveTone,
  type SecondaryObjectiveViewEntry,
} from './coopDefenseSecondaryObjectiveModel';
import { COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT } from './CoopDefenseSecondaryObjectiveLayout';
import {
  advanceHudOcclusionFade,
  createHudOcclusionFadeState,
  resetHudOcclusionFade,
  type HudOcclusionRect,
} from './hudOcclusionFade';
import { isHudRectOccluded } from './hudOcclusionProbe';
import type { CoopDefenseObjectiveAnnouncement } from './CoopDefenseObjectiveAnnouncement';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import { t } from '../i18n';
import { HudCard, HUD_TEXT_MUTED, HUD_TEXT_PRIMARY } from './HudCard';
import { HUD_TONES, type HudTone } from './HudFrameAssets';

const LAYOUT = COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT;
const PANEL_W = LAYOUT.panelWidth;
const PANEL_H = LAYOUT.panelHeight;
const CHIP_H = LAYOUT.chipHeight;
const ROW_GAP = LAYOUT.rowGap;
const COLUMN_TOP_Y = LAYOUT.columnTopY;
/** Die Nebenpanel-Spalte setzt die rechte Kante des Pflichtziel-Panels exakt fort. */
const COLUMN_X = LAYOUT.columnCenterX;

const ROW_MOVE_MS = 220;
const ENTRY_MS = 200;
const HANDOFF_MS = 180;

/** Farbfamilie pro Missionszustand; Hintergrundzeilen bleiben neutral und treten zurück. */
const TONE_FAMILY: Readonly<Record<SecondaryObjectiveTone, HudTone>> = {
  focus: 'blue',
  background: 'neutral',
  completed: 'green',
  failed: 'red',
};

interface RowVisual {
  readonly card: HudCard;
  moveTween: Phaser.Tweens.Tween | null;
  targetY: number;
}

function progressText(entry: SecondaryObjectiveViewEntry): string {
  return entry.statusLine ?? `${entry.progressCurrent} / ${entry.progressTotal}`;
}

function progressFraction(entry: SecondaryObjectiveViewEntry): number {
  if (entry.terminal) return 1;
  return entry.progressTotal > 0 ? entry.progressCurrent / entry.progressTotal : 0;
}

export class CoopDefenseSecondaryObjectiveHud {
  private root!: Phaser.GameObjects.Container;
  private panel!: HudCard;
  private panelTween: Phaser.Tweens.Tween | null = null;
  private panelPulseTween: Phaser.Tweens.Tween | null = null;
  private chips: RowVisual[] = [];

  private lastSignature: string | null = null;
  private lastPanelObjectiveId: string | null = null;
  private wasActive = false;
  /** Untere Kante der aktuell gezeigten Zeilen; Grundlage des Ausweich-Rechtecks. */
  private stackBottomY = COLUMN_TOP_Y;
  private readonly occlusionFade = createHudOcclusionFadeState();
  /** True, solange eine laufende Ankündigung ihren Platz an das Fokus-Panel übergibt. */
  private announceHandsOverToPanel = false;

  private readonly announcedActivation = new Set<string>();
  private readonly announcedTerminal = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly objectiveAnnouncements: CoopDefenseObjectiveAnnouncement,
  ) {}

  build(): void {
    this.root = this.scene.add.container(0, 0);
    this.root.setDepth(DEPTH.OVERLAY - 1).setVisible(false);
    // Aufbaupfad, nicht Konstruktor: Der Container muss auf der Anzeigeliste stehen, damit die
    // Klarheitskamera-Maske auf ihn und seine Kinder greift.
    promoteToClarityCamera(this.scene, this.root);

    this.panel = new HudCard(this.scene, {
      scale: LAYOUT.panelScale,
      width: PANEL_W,
      tone: 'blue',
      titleSize: 15,
      valueSize: 14,
    });
    this.panel.setGlyph(true).setKicker(t('ui.objective.secondary'));
    this.panel.root.setPosition(COLUMN_X, COLUMN_TOP_Y + PANEL_H / 2).setVisible(false);
    this.root.add(this.panel.root);

    for (let index = 0; index < SECONDARY_OBJECTIVE_MAX_CHIPS; index += 1) {
      const card = new HudCard(this.scene, {
        scale: LAYOUT.chipScale,
        width: PANEL_W,
        tone: 'neutral',
        titleSize: 13,
        valueSize: 13,
        backingAlpha: 0.52,
      });
      card.setGlyph(true);
      card.root.setPosition(COLUMN_X, COLUMN_TOP_Y).setVisible(false);
      this.root.add(card.root);
      this.chips.push({ card, moveTween: null, targetY: 0 });
    }
  }

  /**
   * Pro Frame aufgerufen. `elapsedMs` ist die Host-Rundenzeit, gegen die der Snapshot seine
   * Zustandswechsel datiert – daraus entsteht das Standzeitfenster terminaler Missionen.
   */
  sync(
    snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    elapsedMs: number,
    active: boolean,
  ): void {
    if (!active) {
      // Erst beim Verlassen der Arena zurücksetzen, nicht in jedem Lobby-Frame. Der Reset
      // verwirft auch die gezeigten Ankündigungen – eine neue Runde derselben Map soll ihre
      // Nebenmission wieder ankündigen.
      if (this.wasActive) this.reset();
      this.wasActive = false;
      return;
    }
    this.wasActive = true;

    const model = buildSecondaryObjectiveViewModel(snapshot, configs, elapsedMs);
    if (!model.focus && model.chips.length === 0) {
      this.hideAll();
      return;
    }

    // Vor dem Signatur-Kurzschluss: Das Ausweich-Rechteck folgt der Zeilenzahl, nicht der
    // Frage, ob sich die Beschriftung geändert hat.
    const stackHeight = (model.focus ? PANEL_H + ROW_GAP : 0)
      + model.chips.length * (CHIP_H + ROW_GAP);
    this.stackBottomY = COLUMN_TOP_Y + Math.max(0, stackHeight - ROW_GAP);

    this.root.setVisible(true);
    this.playPendingAnnouncements(model.focus, model.chips);
    if (model.signature === this.lastSignature) return;
    this.lastSignature = model.signature;

    if (model.focus) this.drawPanel(model.focus);
    else this.hidePanel();
    this.drawChips(model.chips, model.focus !== null);
  }

  /**
   * Pro Frame nach {@link sync}. Die Spalte weicht zurück, sobald unter ihr gekämpft oder
   * gezielt wird – die Deckkraft liegt am Wurzelcontainer und multipliziert sich mit den
   * Auftritts-Alphas der einzelnen Karten, statt sie zu überschreiben.
   */
  updateOcclusionFade(
    deltaMs: number,
    playerManager: PlayerManager | null,
    enemyManager: EnemyManager | null,
  ): void {
    if (!this.root?.visible) return;
    const occluded = isHudRectOccluded(this.scene, this.getOcclusionRect(), playerManager, enemyManager);
    this.root.setAlpha(advanceHudOcclusionFade(this.occlusionFade, occluded, deltaMs));
  }

  /** Aktuelle Screen-Space-Reservierung der sichtbaren Nebenmissionsspalte. */
  getReservedHudRects(): readonly HudOcclusionRect[] {
    if (!this.root?.visible) return [];
    return [this.getOcclusionRect()];
  }

  private getOcclusionRect(): HudOcclusionRect {
    return {
      left: COLUMN_X - PANEL_W / 2,
      right: COLUMN_X + PANEL_W / 2,
      top: COLUMN_TOP_Y,
      bottom: this.stackBottomY,
    };
  }

  private playPendingAnnouncements(
    focus: SecondaryObjectiveViewEntry | null,
    chips: readonly SecondaryObjectiveViewEntry[],
  ): void {
    const entries = focus ? [focus, ...chips] : [...chips];
    for (const entry of entries) {
      if (entry.terminal) {
        if (this.announcedTerminal.has(entry.objectiveId)) continue;
        this.announcedTerminal.add(entry.objectiveId);
        this.announcedActivation.add(entry.objectiveId);
        // Der Flug endet nur dann im Panelplatz, wenn die Mission ihn auch tatsächlich belegt.
        this.showAnnouncement(entry, focus?.objectiveId === entry.objectiveId);
        return;
      }
      if (this.announcedActivation.has(entry.objectiveId)) continue;
      this.announcedActivation.add(entry.objectiveId);
      // Nur eine wirklich fokussierte Mission wird angekündigt. Eine Mission, die den Slot nie
      // bekommen hat, soll das Bild nicht mit einer Einblendung unterbrechen.
      if (entry.tone === 'focus') this.showAnnouncement(entry, true);
    }
  }

  private drawPanel(entry: SecondaryObjectiveViewEntry): void {
    const tone = TONE_FAMILY[entry.tone];
    const style = HUD_TONES[tone];
    const decorative = getGraphicsQualityProfile(this.scene).level !== 'low';

    this.panel.setTone(tone)
      .setKicker(entry.terminal
        ? t('ui.objective.secondaryStatus', { status: entry.statusLine ?? '' })
        : t('ui.objective.secondary'))
      .setValue(progressText(entry), entry.terminal ? style.accent : HUD_TEXT_PRIMARY)
      .setTitle(entry.title, style.accent)
      .setProgress(progressFraction(entry), !entry.terminal);

    const objectiveChanged = entry.objectiveId !== this.lastPanelObjectiveId;
    this.lastPanelObjectiveId = entry.objectiveId;
    if (this.announceHandsOverToPanel) {
      // Die Ankündigung verwandelt sich gerade in diese Karte und übergibt am Ende selbst. Bis
      // dahin bleibt das Panel unsichtbar, sonst stünden Einblendung und Ziel gleichzeitig da.
      this.panel.root.setVisible(false);
    } else if (objectiveChanged || !this.panel.root.visible) {
      this.playPanelEntry(false);
    } else {
      this.panel.root.setVisible(true);
    }
    this.setPanelPulse(entry.tone === 'focus' && decorative);
  }

  private drawChips(entries: readonly SecondaryObjectiveViewEntry[], hasFocusPanel: boolean): void {
    let cursorY = COLUMN_TOP_Y + (hasFocusPanel ? PANEL_H + ROW_GAP : 0);
    for (let index = 0; index < this.chips.length; index += 1) {
      const chip = this.chips[index];
      const entry = entries[index];
      if (!entry) {
        chip.moveTween?.destroy();
        chip.moveTween = null;
        chip.card.root.setVisible(false);
        continue;
      }
      const tone = TONE_FAMILY[entry.tone];
      const style = HUD_TONES[tone];
      const centerY = cursorY + CHIP_H / 2;
      cursorY += CHIP_H + ROW_GAP;

      const appearing = !chip.card.root.visible;
      chip.card.setTone(tone)
        .setValue(progressText(entry), entry.terminal ? style.accent : HUD_TEXT_MUTED)
        .setTitle(entry.title, entry.tone === 'background' ? COLORS.BLUE_1 : style.accent)
        .setProgress(progressFraction(entry), false, entry.tone === 'background' ? 0.75 : 1);
      chip.card.root.setVisible(true);

      // Eine Zeile, die eine Position weiterrückt (weil darüber etwas verschwand), gleitet
      // dorthin, statt zu springen. Ein neu erscheinender Eintrag gleitet kurz ein.
      if (appearing) {
        chip.moveTween?.destroy();
        chip.card.root.setY(centerY + 8).setAlpha(0);
        chip.moveTween = this.scene.tweens.add({
          targets: chip.card.root,
          y: centerY,
          alpha: 1,
          duration: ENTRY_MS,
          ease: 'Cubic.easeOut',
          onComplete: () => { chip.moveTween = null; },
        });
      } else if (chip.targetY !== centerY) {
        chip.moveTween?.destroy();
        chip.moveTween = this.scene.tweens.add({
          targets: chip.card.root,
          y: centerY,
          alpha: 1,
          duration: ROW_MOVE_MS,
          ease: 'Cubic.easeOut',
          onComplete: () => { chip.moveTween = null; },
        });
      }
      chip.targetY = centerY;
    }
  }

  /**
   * `handoff`: Die Ankündigung hat ihren Rahmen bereits exakt auf diesem Platz abgelegt; nur
   * der Inhalt blendet auf. Sonst gleitet die Karte selbst kurz ein.
   */
  private playPanelEntry(handoff: boolean): void {
    this.panelTween?.destroy();
    const targetY = COLUMN_TOP_Y + PANEL_H / 2;
    if (handoff) {
      this.panel.root.setPosition(COLUMN_X, targetY).setScale(1).setVisible(true).setAlpha(1);
      this.panel.setContentAlpha(0);
      const proxy = { alpha: 0 };
      this.panelTween = this.scene.tweens.add({
        targets: proxy,
        alpha: 1,
        duration: HANDOFF_MS,
        ease: 'Quad.easeOut',
        onUpdate: () => { this.panel.setContentAlpha(proxy.alpha); },
        onComplete: () => { this.panelTween = null; },
      });
      return;
    }
    this.panel.setContentAlpha(1);
    this.panel.root.setPosition(COLUMN_X, targetY + 8).setScale(1).setVisible(true).setAlpha(0);
    this.panelTween = this.scene.tweens.add({
      targets: this.panel.root,
      alpha: 1,
      y: targetY,
      duration: ENTRY_MS,
      ease: 'Cubic.easeOut',
      onComplete: () => { this.panelTween = null; },
    });
  }

  private setPanelPulse(enabled: boolean): void {
    if (enabled === (this.panelPulseTween !== null)) return;
    this.panelPulseTween?.destroy();
    this.panelPulseTween = null;
    this.panel.setHeadPulse(1);
    if (!enabled) return;
    // Nur der fokussierte Zustand atmet – die laufende Spitze der Rinne pulsiert ruhig, damit
    // die Nebenmission das Auge nicht dauerhaft vom Kampf wegzieht.
    const proxy = { value: 1 };
    this.panelPulseTween = this.scene.tweens.add({
      targets: proxy,
      value: 0.35,
      duration: 1_150,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => { this.panel.setHeadPulse(proxy.value); },
    });
  }

  private showAnnouncement(entry: SecondaryObjectiveViewEntry, handsOverToPanel: boolean): void {
    const objectiveId = entry.objectiveId;
    const tone = entry.tone === 'completed'
      ? 'positive'
      : entry.tone === 'failed' ? 'negative' : 'secondary';
    this.objectiveAnnouncements.enqueue({
      id: `secondary:${objectiveId}:${entry.terminal ? entry.statusLine : 'active'}`,
      topic: `secondary:${objectiveId}`,
      priority: entry.terminal ? 50 : 0,
      kicker: entry.terminal
        ? t('ui.objective.secondaryStatus', { status: entry.statusLine ?? '' })
        : t('ui.objective.secondaryNew'),
      title: entry.title,
      // Die Aktivierungsmeldung nennt Ausgangslage und Belohnung; ein binäres Ziel zeigt dort
      // seinen Status statt einer nichtssagenden Null.
      detail: entry.terminal
        ? undefined
        : t('ui.objective.secondaryDetail', {
          status: progressText(entry),
          reward: entry.rewardHint,
        }),
      tone,
      ...(handsOverToPanel
        ? { target: { x: COLUMN_X, y: COLUMN_TOP_Y + PANEL_H / 2, width: PANEL_W, scale: LAYOUT.panelScale } }
        : {}),
      onStart: () => {
        this.announceHandsOverToPanel = handsOverToPanel;
        if (handsOverToPanel) this.panel?.root.setVisible(false);
      },
      onArrive: () => {
        if (this.announceHandsOverToPanel && this.lastPanelObjectiveId === objectiveId) {
          this.playPanelEntry(true);
        }
        this.announceHandsOverToPanel = false;
      },
      onCancel: () => {
        this.announceHandsOverToPanel = false;
      },
    });
  }

  private hidePanel(): void {
    this.panelTween?.destroy();
    this.panelTween = null;
    this.setPanelPulse(false);
    this.panel?.setContentAlpha(1);
    this.panel?.root.setVisible(false).setAlpha(1).setScale(1)
      .setPosition(COLUMN_X, COLUMN_TOP_Y + PANEL_H / 2);
    this.lastPanelObjectiveId = null;
  }

  private hideAll(): void {
    // Vor dem ersten Trigger läuft dieser Pfad jeden Frame. Ohne den Kurzschluss würden dort
    // dauerhaft Tween-Abbrüche und Sichtbarkeits-Setter für ein bereits leeres HUD anfallen.
    if (!this.root || !this.root.visible) return;
    this.hidePanel();
    for (const chip of this.chips) {
      chip.moveTween?.destroy();
      chip.moveTween = null;
      chip.card.root.setVisible(false).setY(0);
      chip.targetY = 0;
    }
    this.announceHandsOverToPanel = false;
    this.root.setVisible(false);
    this.lastSignature = null;
    // Eine wieder eingeblendete Spalte startet voll sichtbar; sonst erbte sie die Restdeckkraft
    // eines Gefechts, das inzwischen vorbei ist.
    resetHudOcclusionFade(this.occlusionFade);
    this.root.setAlpha(1);
    this.stackBottomY = COLUMN_TOP_Y;
  }

  /** Rundengebundener Zustand. Die Scene-Lifetime-Objekte bleiben bestehen. */
  reset(): void {
    this.hideAll();
    this.announcedActivation.clear();
    this.announcedTerminal.clear();
  }

  destroy(): void {
    this.panelTween?.destroy();
    this.panelPulseTween?.destroy();
    for (const chip of this.chips) chip.moveTween?.destroy();
    this.panelTween = null;
    this.panelPulseTween = null;
    this.chips.length = 0;
    this.root?.destroy(true);
  }
}
