/**
 * Coop-Defense-Tutorialfenster als Weltobjekt.
 *
 * Starthinweis (optional mit Steuerungstabelle) und lokale Checkpoint-Hinweise teilen dieselbe
 * Forest-Tafel: Glas, Walnussrahmen, Titelschild auf der oberen Leiste. Die Tafel steht über
 * ihrer Felsformation in der Welt und blendet sich aus, sobald Screen-Space-HUD sie überdeckt.
 */
import * as Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import { registerGraphicsObject } from '../effects/EffectUtils';
import { t } from '../i18n';
import {
  COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H,
  COOP_DEFENSE_TUTORIAL_PANEL_WIDTH,
  getCoopDefenseTutorialPanelCenterX,
  getCoopDefenseTutorialPanelHeight,
  getCoopDefenseTutorialPanelTopY,
  type CoopDefenseTutorialAnchor,
} from '../config/coopDefenseTutorial';
import { HELP_CONTROLS } from '../config/helpControls';
import { ensureIconTexture } from './uiTextures';
import { BORDER as FOREST_BORDER, SURFACE as FOREST_SURFACE, TEXT as FOREST_TEXT, textStyle as forestTextStyle } from './ForestModal';
import { ensureForestButton } from './forestTextures';
import { MOTION } from './uiTheme';
import {
  TUTORIAL_FRAME_INNER,
  TUTORIAL_TOP_RAIL_Y,
  ensureTutorialKeycapTexture,
  ensureTutorialPanelTexture,
} from './coopDefenseTutorialPanelTextures';
import {
  advanceHudOcclusionFade,
  createHudOcclusionFadeState,
  type HudOcclusionRect,
  resetHudOcclusionFade,
} from './hudOcclusionFade';
import { doHudRectsOverlap, getWorldRectOnScreen } from './hudOcclusionProbe';

const TUTORIAL_FADE_MS    = MOTION.slow;
/** Kurzer Absenk-Auftritt: die Tafel „legt sich" auf ihren Platz statt nur einzublenden. */
const TUTORIAL_ENTRY_RISE = 6;
const TUTORIAL_OCCLUSION_MARGIN_PX = 6;
const TUTORIAL_OCCLUSION_FADE = {
  minAlpha: 0.02,
  fadeOutMs: 90,
  fadeInMs: 520,
  holdMs: 260,
} as const;
// Innenlayout im Rahmen. Außenmaße bleiben der Vertrag aus `coopDefenseTutorial`, weil die
// Arena-Generierung die Felsformation unter dem Fenster daraus ableitet.
const TUTORIAL_PLAQUE_H     = 28;
const TUTORIAL_PLAQUE_PAD_X = 22;
const TUTORIAL_PLAQUE_ICON  = 14;
const TUTORIAL_PLAQUE_GAP   = 8;
const TUTORIAL_BODY_TOP     = TUTORIAL_TOP_RAIL_Y + TUTORIAL_PLAQUE_H / 2 + 6;
const TUTORIAL_BODY_PAD_X   = 64;
const TUTORIAL_TABLE_W      = 600;
const TUTORIAL_TABLE_PAD_BOTTOM = 14;
const TUTORIAL_KEYCAP_W     = 170;
const TUTORIAL_KEYCAP_H     = 24;
const TUTORIAL_KEY_CX       = -TUTORIAL_TABLE_W / 2 + 12 + TUTORIAL_KEYCAP_W / 2;
const TUTORIAL_DESC_X       = -TUTORIAL_TABLE_W / 2 + 12 + TUTORIAL_KEYCAP_W + 24;
/** Abstand der Steuerungsüberschrift über der ersten Tabellenzeile. */
const TUTORIAL_HEADING_GAP  = 18;
const TUTORIAL_HEADING_RULE = 150;

/**
 * Tabellenoberkante der Steuerungs-Variante: vom unteren Rahmen aus verankert, damit die Zeilen
 * unabhängig von der reservierten Fließtexthöhe nie in die Holzleiste laufen.
 */
function getTutorialControlsRowsTop(panelHeight: number): number {
  return panelHeight - TUTORIAL_FRAME_INNER - TUTORIAL_TABLE_PAD_BOTTOM
    - HELP_CONTROLS.length * COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H;
}

/** Vertikale Mitte des Fließtexts: zentriert zwischen Titelschild und Tabelle bzw. unterem Rahmen. */
function getTutorialBodyCenterY(panelHeight: number, showControls: boolean): number {
  const bottom = showControls
    ? getTutorialControlsRowsTop(panelHeight) - TUTORIAL_HEADING_GAP - 22
    : panelHeight - TUTORIAL_FRAME_INNER;
  return (TUTORIAL_BODY_TOP + bottom) / 2;
}

// Tutorial-Typografie folgt den Forest-Menüs (Chakra Petch, warmes Pergament-Weiß, Gold nur
// für Titel und Tasten), damit Hilfe-Fenster und Tutorial als eine Familie lesen.
const TUTORIAL_TITLE_FONT = forestTextStyle('labelSm', { color: COLORS.GOLD_1 });
const TUTORIAL_HEADING_FONT = forestTextStyle('section', { color: COLORS.GOLD_2 });
const TUTORIAL_BODY_FONT = {
  ...forestTextStyle('body', {
    color: FOREST_TEXT.primary,
    align: 'center',
    wordWrapWidth: COOP_DEFENSE_TUTORIAL_PANEL_WIDTH - TUTORIAL_BODY_PAD_X * 2,
  }),
  fontSize: '19px',
  lineSpacing: 6,
};
const TUTORIAL_CONTROLS_KEY_FONT = forestTextStyle('labelSm', { color: COLORS.GOLD_1 });
const TUTORIAL_CONTROLS_DESC_FONT = {
  ...forestTextStyle('body', { color: FOREST_TEXT.primary }),
  fontSize: '16px',
};

export class CoopDefenseTutorialPanel {
  private tutorialContainer!: Phaser.GameObjects.Container;
  private tutorialLifecycleContainer!: Phaser.GameObjects.Container;
  private tutorialPanelBg!: Phaser.GameObjects.Image;
  private tutorialControlsDecor!: Phaser.GameObjects.Graphics;
  private tutorialBody!: Phaser.GameObjects.Text;
  /** Überschrift, Tastenkappen und Beschriftungen der Steuerungstafel. */
  private tutorialControlsObjects: (Phaser.GameObjects.Text | Phaser.GameObjects.Image)[] = [];
  private tutorialTween: Phaser.Tweens.Tween | null = null;
  private readonly tutorialOcclusionFade = createHudOcclusionFadeState();
  private tutorialValue: string | null = null;
  private tutorialControlsValue = false;
  private tutorialStepContainer!: Phaser.GameObjects.Container;
  private tutorialStepLifecycleContainer!: Phaser.GameObjects.Container;
  private tutorialStepPanelBg!: Phaser.GameObjects.Image;
  private tutorialStepBody!: Phaser.GameObjects.Text;
  private tutorialStepTween: Phaser.Tweens.Tween | null = null;
  private tutorialStepValue: string | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  build(): void {
    this.buildTutorialPanel();
    this.buildTutorialStepPanel();
  }

  /** Rundengebundener Reset: beide Tafeln sofort ausblenden. */
  reset(): void {
    this.hideTutorial(true);
    this.hideTutorialStep(true);
  }

  destroy(): void {
    this.reset();
    this.tutorialContainer.destroy(true);
    this.tutorialStepContainer.destroy(true);
  }

  private buildTutorialPanel(): void {
    this.tutorialPanelBg = this.createTutorialPanelBg();
    this.tutorialBody = this.scene.add.text(0, 0, '', TUTORIAL_BODY_FONT)
      .setOrigin(0.5, 0.5)
      .setScrollFactor(1);

    // Steuerungstabelle: einmal aufgebaut, nur in der Steuerungs-Variante sichtbar. Die Zeilen
    // sind vom unteren Rahmen aus verankert; Überschrift und Zeilenflächen liegen in einer
    // gemeinsamen Graphics-Ebene, Tastenkappen als geteilte Textur wie im Hilfe-Fenster.
    const controlsHeight = getCoopDefenseTutorialPanelHeight(true);
    const rowsTop = getTutorialControlsRowsTop(controlsHeight);
    const rowH = COOP_DEFENSE_TUTORIAL_CONTROLS_ROW_H;
    const headingY = rowsTop - TUTORIAL_HEADING_GAP;
    const heading = this.scene.add.text(0, headingY, t('ui.help.heading'), TUTORIAL_HEADING_FONT)
      .setOrigin(0.5, 0.5)
      .setScrollFactor(1);
    const keycapKey = ensureTutorialKeycapTexture(this.scene, TUTORIAL_KEYCAP_W, TUTORIAL_KEYCAP_H);
    const rows = HELP_CONTROLS.flatMap((entry, i) => {
      const y = rowsTop + i * rowH + rowH / 2;
      return [
        this.scene.add.image(TUTORIAL_KEY_CX, y, keycapKey).setScrollFactor(1),
        this.scene.add.text(TUTORIAL_KEY_CX, y, t(entry.keyId), TUTORIAL_CONTROLS_KEY_FONT)
          .setOrigin(0.5, 0.5).setScrollFactor(1),
        this.scene.add.text(TUTORIAL_DESC_X, y, t(entry.descriptionKey), TUTORIAL_CONTROLS_DESC_FONT)
          .setOrigin(0, 0.5).setScrollFactor(1),
      ];
    });
    this.tutorialControlsObjects = [heading, ...rows];

    this.tutorialControlsDecor = this.scene.add.graphics().setScrollFactor(1);
    registerGraphicsObject(this.scene, 'gameplayHud', this.tutorialControlsDecor);
    const decor = this.tutorialControlsDecor;
    // Zierlinien links und rechts der Überschrift mit kleiner Raute als Abschluss.
    const ruleInner = heading.width / 2 + 14;
    decor.fillStyle(FOREST_BORDER.default, 0.55);
    for (const dir of [-1, 1]) {
      const inner = dir * ruleInner;
      const outer = dir * (ruleInner + TUTORIAL_HEADING_RULE);
      decor.fillRect(Math.min(inner, outer), headingY - 0.5, TUTORIAL_HEADING_RULE, 1);
    }
    decor.fillStyle(COLORS.GOLD_3, 0.85);
    for (const dir of [-1, 1]) {
      const x = dir * ruleInner;
      decor.fillTriangle(x - 3.5, headingY, x, headingY - 3.5, x + 3.5, headingY);
      decor.fillTriangle(x - 3.5, headingY, x, headingY + 3.5, x + 3.5, headingY);
    }
    // Ruhige Zeilenflächen statt eines harten Zebra-Musters.
    HELP_CONTROLS.forEach((_entry, i) => {
      decor.fillStyle(FOREST_SURFACE.raised, i % 2 === 0 ? 0.32 : 0.14);
      decor.fillRoundedRect(-TUTORIAL_TABLE_W / 2, rowsTop + i * rowH + 2, TUTORIAL_TABLE_W, rowH - 4, 6);
    });

    this.tutorialLifecycleContainer = this.scene.add.container(0, 0, [
      this.tutorialPanelBg,
      this.tutorialControlsDecor,
      ...this.createTutorialPlaque(),
      this.tutorialBody,
      ...this.tutorialControlsObjects,
    ]).setScrollFactor(1).setAlpha(0);
    this.tutorialContainer = this.scene.add.container(
      getCoopDefenseTutorialPanelCenterX(),
      getCoopDefenseTutorialPanelTopY(),
      [this.tutorialLifecycleContainer],
    );
    // Der übrige CenterHUD liegt auf der scrollfreien Klarheitskamera. Das Tutorial muss
    // dagegen ein Weltobjekt bleiben, damit es beim horizontalen Kamera-Scroll über seiner
    // Felsformation bleibt. Als eigener Root-Container erbt es nicht die Kamera-Maske des HUDs.
    this.tutorialContainer
      .setDepth(DEPTH.OVERLAY - 1)
      .setScrollFactor(1)
      .setVisible(false)
      .setAlpha(1);
  }

  private buildTutorialStepPanel(): void {
    this.tutorialStepPanelBg = this.createTutorialPanelBg();
    this.tutorialStepBody = this.scene.add.text(0, 0, '', TUTORIAL_BODY_FONT)
      .setOrigin(0.5, 0.5)
      .setScrollFactor(1);
    this.tutorialStepLifecycleContainer = this.scene.add.container(0, 0, [
      this.tutorialStepPanelBg,
      ...this.createTutorialPlaque(),
      this.tutorialStepBody,
    ]).setScrollFactor(1).setAlpha(0);
    this.tutorialStepContainer = this.scene.add.container(
      getCoopDefenseTutorialPanelCenterX(),
      getCoopDefenseTutorialPanelTopY(),
      [this.tutorialStepLifecycleContainer],
    );
    this.tutorialStepContainer
      .setDepth(DEPTH.OVERLAY - 1)
      .setScrollFactor(1)
      .setVisible(false)
      .setAlpha(1);
  }

  /** Glas und Holzrahmen; die Textur wird pro angezeigter Fensterhöhe gewählt. */
  private createTutorialPanelBg(): Phaser.GameObjects.Image {
    const width = COOP_DEFENSE_TUTORIAL_PANEL_WIDTH;
    const height = getCoopDefenseTutorialPanelHeight(false);
    return this.scene.add.image(0, 0, ensureTutorialPanelTexture(this.scene, width, height))
      .setOrigin(0.5, 0)
      .setDisplaySize(width, height)
      .setScrollFactor(1);
  }

  private setTutorialPanelHeight(image: Phaser.GameObjects.Image, height: number): void {
    const width = COOP_DEFENSE_TUTORIAL_PANEL_WIDTH;
    image.setTexture(ensureTutorialPanelTexture(this.scene, width, height)).setDisplaySize(width, height);
  }

  /** Walnuss-Schild mit Hinweis-Symbol und Titel, mittig auf der oberen Rahmenleiste. */
  private createTutorialPlaque(): Phaser.GameObjects.GameObject[] {
    const title = this.scene.add.text(0, TUTORIAL_TOP_RAIL_Y, t('ui.help.title'), TUTORIAL_TITLE_FONT)
      .setOrigin(0.5, 0.5)
      .setScrollFactor(1);
    const contentW = TUTORIAL_PLAQUE_ICON + TUTORIAL_PLAQUE_GAP + Math.ceil(title.width);
    const plaqueW = Math.max(120, contentW + TUTORIAL_PLAQUE_PAD_X * 2);
    const contentLeft = -contentW / 2;
    title.setX(contentLeft + TUTORIAL_PLAQUE_ICON + TUTORIAL_PLAQUE_GAP + title.width / 2);
    const plaque = this.scene.add.image(
      0,
      TUTORIAL_TOP_RAIL_Y,
      ensureForestButton(this.scene, plaqueW, TUTORIAL_PLAQUE_H, 'neutral', 'rest'),
    ).setScrollFactor(1);
    // Symbol in doppelter Größe rastern und herunterskalieren, sonst franst die Kontur aus.
    const icon = this.scene.add.image(
      contentLeft + TUTORIAL_PLAQUE_ICON / 2,
      TUTORIAL_TOP_RAIL_Y,
      ensureIconTexture(this.scene, 'info', TUTORIAL_PLAQUE_ICON * 2, COLORS.GOLD_1),
    ).setDisplaySize(TUTORIAL_PLAQUE_ICON, TUTORIAL_PLAQUE_ICON).setScrollFactor(1);
    return [plaque, icon, title];
  }

  /**
   * Aktualisiert die temporäre Verdeckung in einer eigenen Alpha-Ebene. Der Welt-Root bleibt
   * an seiner Position; nur seine Sichtbarkeit wird gegen die aktuellen Screen-Flächen geprüft.
   */
  updateTutorialOcclusion(
    deltaMs: number,
    reservedHudRects: readonly HudOcclusionRect[],
  ): void {
    const tutorialRects = this.getTutorialScreenRects();
    if (tutorialRects.length === 0) {
      resetHudOcclusionFade(this.tutorialOcclusionFade);
      if (this.tutorialContainer?.active) this.tutorialContainer.setAlpha(1);
      if (this.tutorialStepContainer?.active) this.tutorialStepContainer.setAlpha(1);
      return;
    }

    const occluded = tutorialRects.some((tutorialRect) => reservedHudRects.some((reservedRect) => (
      doHudRectsOverlap(tutorialRect, reservedRect, TUTORIAL_OCCLUSION_MARGIN_PX)
    )));
    const alpha = advanceHudOcclusionFade(
      this.tutorialOcclusionFade,
      occluded,
      deltaMs,
      TUTORIAL_OCCLUSION_FADE,
    );
    this.tutorialContainer.setAlpha(alpha);
    this.tutorialStepContainer.setAlpha(alpha);
  }

  /** Aktuelle sichtbare Panel-Fläche des Tutorials in Design-Screen-Koordinaten. */
  getTutorialScreenRect(): HudOcclusionRect | null {
    return this.getTutorialScreenRectForContainer(this.tutorialContainer, this.tutorialControlsValue);
  }

  private getTutorialScreenRects(): HudOcclusionRect[] {
    return [
      this.getTutorialScreenRectForContainer(this.tutorialContainer, this.tutorialControlsValue),
      this.getTutorialScreenRectForContainer(this.tutorialStepContainer, false),
    ].filter((rect): rect is HudOcclusionRect => rect !== null);
  }

  private getTutorialScreenRectForContainer(
    container: Phaser.GameObjects.Container | undefined,
    showControls: boolean,
  ): HudOcclusionRect | null {
    if (!container?.visible) return null;
    const camera = this.scene.cameras?.main;
    if (!camera) return null;
    const width = COOP_DEFENSE_TUTORIAL_PANEL_WIDTH;
    const height = getCoopDefenseTutorialPanelHeight(showControls);
    return getWorldRectOnScreen({
      left: container.x - width / 2,
      right: container.x + width / 2,
      top: container.y,
      bottom: container.y + height,
    }, camera);
  }


  /**
   * @param showControls True: Unter dem Fließtext erscheint die Steuerungstabelle des
   *   Hilfe-Fensters; das Fenster wächst entsprechend (Einstiegs-Map).
   */
  updateTutorial(
    text: string | null,
    showControls = false,
    anchor?: CoopDefenseTutorialAnchor,
  ): void {
    this.tutorialContainer.setPosition(
      getCoopDefenseTutorialPanelCenterX(anchor),
      getCoopDefenseTutorialPanelTopY(anchor),
    );
    const nextText = text?.trim() || null;
    if (nextText === this.tutorialValue && showControls === this.tutorialControlsValue) return;
    this.tutorialValue = nextText;
    this.tutorialControlsValue = showControls;
    this.tutorialTween?.destroy();
    this.tutorialTween = null;

    if (!nextText) {
      this.hideTutorial(false);
      return;
    }

    const height = getCoopDefenseTutorialPanelHeight(showControls);
    this.setTutorialPanelHeight(this.tutorialPanelBg, height);
    this.tutorialBody.setText(nextText).setY(getTutorialBodyCenterY(height, showControls));
    this.tutorialControlsDecor.setVisible(showControls);
    for (const entry of this.tutorialControlsObjects) entry.setVisible(showControls);

    this.tutorialContainer.setVisible(true).setAlpha(this.tutorialOcclusionFade.alpha);
    this.tutorialLifecycleContainer.setAlpha(0).setY(-TUTORIAL_ENTRY_RISE);
    this.tutorialTween = this.scene.tweens.add({
      targets: this.tutorialLifecycleContainer,
      alpha: 1,
      y: 0,
      duration: TUTORIAL_FADE_MS,
      ease: MOTION.ease.out,
      onComplete: () => { this.tutorialTween = null; },
    });
  }

  /**
   * Lokaler Tutorial-Step im selben World-Space-Panel wie das Starttutorial. Der Checkpoint
   * wird außerhalb der HUD-Darstellung ausgewertet; `anchor` bestimmt ausschließlich die
   * authored Weltposition des Fensters.
   */
  updateTutorialStep(
    text: string | null,
    anchor?: CoopDefenseTutorialAnchor,
  ): void {
    this.tutorialStepContainer.setPosition(
      getCoopDefenseTutorialPanelCenterX(anchor),
      getCoopDefenseTutorialPanelTopY(anchor),
    );
    const nextText = text?.trim() || null;
    if (nextText === this.tutorialStepValue) return;
    this.tutorialStepValue = nextText;
    this.tutorialStepTween?.destroy();
    this.tutorialStepTween = null;

    if (!nextText) {
      this.hideTutorialStep(false);
      return;
    }

    const height = getCoopDefenseTutorialPanelHeight(false);
    this.tutorialStepBody.setText(nextText).setY(getTutorialBodyCenterY(height, false));
    this.tutorialStepContainer.setVisible(true).setAlpha(1);
    this.tutorialStepLifecycleContainer.setAlpha(0).setY(-TUTORIAL_ENTRY_RISE);
    this.tutorialStepTween = this.scene.tweens.add({
      targets: this.tutorialStepLifecycleContainer,
      alpha: 1,
      y: 0,
      duration: TUTORIAL_FADE_MS,
      ease: MOTION.ease.out,
      onComplete: () => { this.tutorialStepTween = null; },
    });
  }

  /** @param arrivalTimerSecs Verbleibende Sekunden bis zur nächsten Einfahrt. */
  private hideTutorial(immediate: boolean): void {
    this.tutorialTween?.destroy();
    this.tutorialTween = null;
    this.tutorialValue = null;
    if (immediate || !this.tutorialContainer.visible) {
      this.tutorialContainer.setVisible(false).setAlpha(1);
      this.tutorialLifecycleContainer.setAlpha(0);
      resetHudOcclusionFade(this.tutorialOcclusionFade);
      return;
    }
    this.tutorialTween = this.scene.tweens.add({
      targets: this.tutorialLifecycleContainer,
      alpha: 0,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.tutorialTween = null;
        this.tutorialContainer.setVisible(false).setAlpha(1);
        resetHudOcclusionFade(this.tutorialOcclusionFade);
      },
    });
  }

  private hideTutorialStep(immediate: boolean): void {
    this.tutorialStepTween?.destroy();
    this.tutorialStepTween = null;
    this.tutorialStepValue = null;
    if (immediate || !this.tutorialStepContainer?.visible) {
      this.tutorialStepContainer?.setVisible(false).setAlpha(1);
      this.tutorialStepLifecycleContainer?.setAlpha(0);
      return;
    }
    this.tutorialStepTween = this.scene.tweens.add({
      targets: this.tutorialStepLifecycleContainer,
      alpha: 0,
      duration: TUTORIAL_FADE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.tutorialStepTween = null;
        this.tutorialStepContainer.setVisible(false).setAlpha(1);
      },
    });
  }
}
