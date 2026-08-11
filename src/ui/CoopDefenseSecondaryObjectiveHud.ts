/**
 * HUD der Coop-Defense-Nebenmissionen: Panelspalte unter dem Pflichtziel, Hintergrundzeilen
 * und die Aktivierungs- bzw. Abschlussankündigung.
 *
 * Gestaltungsgrundsatz: Das Pflichtziel-Panel (`CenterHUD`, Angriffsserie) bleibt der Anker
 * oben rechts. Die Nebenziele stehen als eigene Spalte **darunter** und teilen dessen Breite
 * und Formensprache, tragen aber eine eigene Leitfarbenfamilie (Blau), die in keiner
 * Encounter-Phase und in keiner Teamfarbe vorkommt. Die Spalte steht bündig unter dem
 * Pflichtziel; die Arena-Seitenspalte beginnt darunter, damit Killfeed und Leaderboard frei bleiben.
 *
 * Die Ankündigung erscheint klein im oberen Bilddrittel und fliegt danach sichtbar in ihren
 * Panelplatz – so entsteht die Verbindung zwischen Einblendung und Dauerzustand, ohne die
 * Sicht auf die eigene Figur zu verstellen.
 */
import * as Phaser from 'phaser';
import { COLORS, DEPTH, toCssColor } from '../config';
import { ensureFlatPanelTexture } from './uiTextures';
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
import type { CoopDefenseObjectiveAnnouncement } from './CoopDefenseObjectiveAnnouncement';

/** Gleiche Breite wie das Pflichtziel-Panel; die Spalte liest sich dadurch als dessen Fortsetzung. */
const PANEL_W = COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.panelWidth;
const PANEL_H = COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.panelHeight;
const CHIP_H = COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.chipHeight;
const ROW_GAP = COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.rowGap;
const PANEL_RADIUS = 9;
const COLUMN_TOP_Y = COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.columnTopY;
/** Die Nebenpanel-Spalte setzt die rechte Kante des Pflichtziel-Panels exakt fort. */
const COLUMN_X = COOP_DEFENSE_SECONDARY_OBJECTIVE_LAYOUT.columnCenterX;

const PANEL_LEFT = -PANEL_W / 2;
const PANEL_TOP = -PANEL_H / 2;
const PANEL_GLYPH_X = PANEL_LEFT + 24;
const PANEL_CONTENT_LEFT = PANEL_LEFT + 44;
const PANEL_CONTENT_RIGHT = -PANEL_LEFT - 18;
const PANEL_KICKER_Y = PANEL_TOP + 15;
const PANEL_TITLE_Y = PANEL_TOP + 36;
const PANEL_REWARD_Y = PANEL_TOP + 53;

const CHIP_LEFT = PANEL_LEFT;
const CHIP_GLYPH_X = CHIP_LEFT + 22;
const CHIP_CONTENT_LEFT = CHIP_LEFT + 40;
const CHIP_CONTENT_RIGHT = PANEL_CONTENT_RIGHT;

const PIP_W = 14;
const PIP_H = 5;
const PIP_GAP = 4;
/** Darüber sind Einzelmarken nicht mehr zählbar; der Fortschritt steht dann nur als Zahl. */
const PIP_MAX = 8;
/** Abstand zwischen Titel und Fortschrittszahl; darunter wird der Titel gekürzt. */
const TITLE_PROGRESS_GAP = 14;

const PANEL_BG_TEX = '_secondary_objective_panel_bg';
const CHIP_BG_TEX = '_secondary_objective_chip_bg';
const GLYPH_GLOW_TEX = '_secondary_objective_glyph_glow';

const ROW_MOVE_MS = 220;
const ENTRY_MS = 190;

/**
 * Oberes Bilddrittel: hoch genug, dass die Einblendung weder die eigene Figur in der Bildmitte
 * noch die geteilte `CenterHUD`-Ankündigung bei `GAME_HEIGHT / 2` verdeckt, und tief genug, um
 * nicht mit der oberen HUD-Zeile zu kollidieren.
 */
/** So breit, dass die zentrierte Einblendung gerade nicht in die Panelspalte rechts ragt. */
/** Flug in den Panelplatz; er ersetzt das frühere reine Ausblenden. */
const ANNOUNCE_TARGET_SCALE = 0.42;

interface ToneStyle {
  /** Leitfarbe für Rahmen, Glyphe, Titel und gefüllte Marken. */
  readonly accent: number;
  /** Gedämpfte Zweitfarbe für Kicker und Reward-Zeile. */
  readonly muted: number;
  readonly panelAlpha: number;
}

const TONE_STYLES: Readonly<Record<SecondaryObjectiveTone, ToneStyle>> = {
  focus: { accent: COLORS.BLUE_2, muted: COLORS.BLUE_4, panelAlpha: 1 },
  background: { accent: COLORS.BLUE_3, muted: COLORS.GREY_5, panelAlpha: 0.8 },
  completed: { accent: COLORS.GREEN_2, muted: COLORS.GREEN_4, panelAlpha: 1 },
  failed: { accent: COLORS.RED_3, muted: COLORS.GREY_5, panelAlpha: 0.9 },
};

const KICKER_FONT = {
  fontSize: '12px', fontFamily: 'monospace', fontStyle: 'bold',
  color: toCssColor(COLORS.BLUE_4), letterSpacing: 2,
};
const TITLE_FONT = {
  fontSize: '19px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
};
const PROGRESS_FONT = {
  fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
};
const REWARD_FONT = {
  fontSize: '11px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4), letterSpacing: 1,
};
const CHIP_TITLE_FONT = {
  fontSize: '15px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_2),
};
const CHIP_PROGRESS_FONT = {
  fontSize: '15px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_2),
};
/**
 * Weicher Schein hinter der Rautenglyphe. Reines Weiß mit Alphaverlauf, zur Laufzeit auf die
 * Tonfarbe getintet – dieselbe Technik wie beim Leitschienen-Glow des Encounter-Panels.
 */
function ensureGlyphGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLYPH_GLOW_TEX)) return;
  const size = 34;
  const ct = scene.textures.createCanvas(GLYPH_GLOW_TEX, size, size);
  if (!ct) return;
  const ctx = ct.context;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ct.refresh();
}

/**
 * Raute statt Balken oder Pfeil: Das Pflichtziel führt eine vertikale Leitschiene, der
 * Offscreen-Pfeil der Feindbasis ein Dreieck. Die Raute ist damit in HUD und Welt eindeutig
 * dem freiwilligen Ziel zugeordnet.
 */
function drawDiamond(graphics: Phaser.GameObjects.Graphics, radius: number, filled: boolean): void {
  const points = [
    new Phaser.Math.Vector2(0, -radius),
    new Phaser.Math.Vector2(radius, 0),
    new Phaser.Math.Vector2(0, radius),
    new Phaser.Math.Vector2(-radius, 0),
  ];
  if (filled) graphics.fillPoints(points, true);
  else graphics.strokePoints(points, true, true);
}

/**
 * Kürzt einen Titel, bis er neben der Fortschrittszahl passt. Läuft nur bei einer echten
 * Textänderung, nicht pro Frame – ohne das lief der Missionsname bisher in die Zahl hinein.
 */
function fitTitle(text: Phaser.GameObjects.Text, full: string, maxWidth: number): void {
  text.setText(full);
  if (text.width <= maxWidth || full.length <= 1) return;
  let low = 1;
  let high = full.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    text.setText(`${full.slice(0, mid).trimEnd()}…`);
    if (text.width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  text.setText(`${full.slice(0, low).trimEnd()}…`);
}

interface RowVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly bg: Phaser.GameObjects.Image;
  readonly frame: Phaser.GameObjects.Graphics;
  readonly glyph: Phaser.GameObjects.Graphics;
  readonly title: Phaser.GameObjects.Text;
  readonly progress: Phaser.GameObjects.Text;
  moveTween: Phaser.Tweens.Tween | null;
  targetY: number;
}

export class CoopDefenseSecondaryObjectiveHud {
  private root!: Phaser.GameObjects.Container;

  private panel!: Phaser.GameObjects.Container;
  private panelBg!: Phaser.GameObjects.Image;
  private panelFrame!: Phaser.GameObjects.Graphics;
  private panelGlyphGlow!: Phaser.GameObjects.Image;
  private panelGlyph!: Phaser.GameObjects.Graphics;
  private panelPips!: Phaser.GameObjects.Graphics;
  private panelKicker!: Phaser.GameObjects.Text;
  private panelTitle!: Phaser.GameObjects.Text;
  private panelProgress!: Phaser.GameObjects.Text;
  private panelReward!: Phaser.GameObjects.Text;
  private panelTween: Phaser.Tweens.Tween | null = null;
  private panelPulseTween: Phaser.Tweens.Tween | null = null;

  private chips: RowVisual[] = [];

  private lastSignature: string | null = null;
  private lastPanelObjectiveId: string | null = null;
  private wasActive = false;
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

    ensureFlatPanelTexture(
      this.scene, PANEL_BG_TEX, PANEL_W, PANEL_H, COLORS.GREY_8, COLORS.GREY_6,
      { radius: PANEL_RADIUS, fillAlpha: 0.86, strokeAlpha: 0.4 },
    );
    ensureFlatPanelTexture(
      this.scene, CHIP_BG_TEX, PANEL_W, CHIP_H, COLORS.GREY_8, COLORS.GREY_6,
      { radius: PANEL_RADIUS, fillAlpha: 0.72, strokeAlpha: 0.3 },
    );
    ensureGlyphGlowTexture(this.scene);

    this.buildPanel();
    this.buildChips();
  }

  private buildPanel(): void {
    this.panelBg = this.scene.add.image(0, 0, PANEL_BG_TEX).setOrigin(0.5);
    this.panelFrame = this.scene.add.graphics();
    this.panelGlyphGlow = this.scene.add
      .image(PANEL_GLYPH_X, -1, GLYPH_GLOW_TEX)
      .setOrigin(0.5)
      .setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.panelGlyph = this.scene.add.graphics();
    this.panelPips = this.scene.add.graphics();
    this.panelKicker = this.scene.add
      .text(PANEL_CONTENT_LEFT, PANEL_KICKER_Y, 'NEBENZIEL', KICKER_FONT)
      .setOrigin(0, 0.5);
    this.panelTitle = this.scene.add
      .text(PANEL_CONTENT_LEFT, PANEL_TITLE_Y, '', TITLE_FONT)
      .setOrigin(0, 0.5);
    this.panelProgress = this.scene.add
      .text(PANEL_CONTENT_RIGHT, PANEL_TITLE_Y, '', PROGRESS_FONT)
      .setOrigin(1, 0.5);
    this.panelReward = this.scene.add
      .text(PANEL_CONTENT_LEFT, PANEL_REWARD_Y, '', REWARD_FONT)
      .setOrigin(0, 0.5);

    this.panel = this.scene.add.container(COLUMN_X, COLUMN_TOP_Y + PANEL_H / 2, [
      this.panelBg,
      this.panelFrame,
      this.panelGlyphGlow,
      this.panelGlyph,
      this.panelPips,
      this.panelKicker,
      this.panelTitle,
      this.panelProgress,
      this.panelReward,
    ]).setScrollFactor(0).setVisible(false);
    this.root.add(this.panel);
  }

  private buildChips(): void {
    for (let index = 0; index < SECONDARY_OBJECTIVE_MAX_CHIPS; index += 1) {
      const bg = this.scene.add.image(0, 0, CHIP_BG_TEX).setOrigin(0.5);
      const frame = this.scene.add.graphics();
      const glyph = this.scene.add.graphics();
      const title = this.scene.add.text(CHIP_CONTENT_LEFT, 0, '', CHIP_TITLE_FONT).setOrigin(0, 0.5);
      const progress = this.scene.add.text(CHIP_CONTENT_RIGHT, 0, '', CHIP_PROGRESS_FONT).setOrigin(1, 0.5);
      const container = this.scene.add
        .container(COLUMN_X, COLUMN_TOP_Y, [bg, frame, glyph, title, progress])
        .setScrollFactor(0)
        .setVisible(false);
      this.root.add(container);
      this.chips.push({ container, bg, frame, glyph, title, progress, moveTween: null, targetY: 0 });
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

    this.root.setVisible(true);
    this.playPendingAnnouncements(model.focus, model.chips);
    if (model.signature === this.lastSignature) return;
    this.lastSignature = model.signature;

    if (model.focus) this.drawPanel(model.focus);
    else this.hidePanel();
    this.drawChips(model.chips, model.focus !== null);
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
    const style = TONE_STYLES[entry.tone];
    const decorative = getGraphicsQualityProfile(this.scene).level !== 'low';

    this.panelProgress
      .setText(entry.statusLine ?? `${entry.progressCurrent} / ${entry.progressTotal}`)
      .setColor(toCssColor(entry.terminal ? style.accent : COLORS.GREY_1));
    fitTitle(
      this.panelTitle,
      entry.title,
      PANEL_CONTENT_RIGHT - PANEL_CONTENT_LEFT - this.panelProgress.width - TITLE_PROGRESS_GAP,
    );
    this.panelTitle.setColor(toCssColor(style.accent));
    this.panelKicker.setColor(toCssColor(style.muted));
    this.panelReward.setText(entry.rewardHint).setColor(toCssColor(COLORS.GREY_5));
    this.panelBg.setAlpha(style.panelAlpha);

    this.panelFrame.clear();
    this.panelFrame.lineStyle(1.5, style.accent, 0.5);
    this.panelFrame.strokeRoundedRect(
      PANEL_LEFT + 1, PANEL_TOP + 1, PANEL_W - 2, PANEL_H - 2, PANEL_RADIUS,
    );

    this.panelGlyph.clear();
    this.panelGlyph.setPosition(PANEL_GLYPH_X, -1);
    this.panelGlyph.fillStyle(style.accent, 0.95);
    drawDiamond(this.panelGlyph, 5.5, true);
    this.panelGlyph.lineStyle(1.5, style.accent, 0.55);
    drawDiamond(this.panelGlyph, 10, false);
    this.panelGlyphGlow.setTint(style.accent).setVisible(decorative);

    this.drawPips(this.panelPips, entry, style, PANEL_CONTENT_RIGHT, PANEL_KICKER_Y);

    const objectiveChanged = entry.objectiveId !== this.lastPanelObjectiveId;
    this.lastPanelObjectiveId = entry.objectiveId;
    if (this.announceHandsOverToPanel) {
      // Die Ankündigung fliegt gerade auf diesen Platz zu und übergibt am Ende selbst. Bis
      // dahin bleibt das Panel unsichtbar, sonst stünden Einblendung und Ziel gleichzeitig da.
      this.panel.setVisible(false);
    } else if (objectiveChanged || !this.panel.visible) {
      this.playPanelEntry(1);
    } else {
      this.panel.setVisible(true);
    }
    this.setPanelPulse(entry.tone === 'focus' && decorative);
  }

  private drawPips(
    graphics: Phaser.GameObjects.Graphics,
    entry: SecondaryObjectiveViewEntry,
    style: ToneStyle,
    rightX: number,
    y: number,
  ): void {
    graphics.clear();
    if (entry.progressTotal < 2 || entry.progressTotal > PIP_MAX) return;
    const total = entry.progressTotal;
    const totalW = total * PIP_W + (total - 1) * PIP_GAP;
    const startX = rightX - totalW;
    const top = y - PIP_H / 2;
    for (let index = 0; index < total; index += 1) {
      const x = startX + index * (PIP_W + PIP_GAP);
      if (index < entry.progressCurrent) graphics.fillStyle(style.accent, 0.95);
      else graphics.fillStyle(COLORS.GREY_6, 0.7);
      graphics.fillRoundedRect(x, top, PIP_W, PIP_H, 2);
    }
  }

  private drawChips(entries: readonly SecondaryObjectiveViewEntry[], hasFocusPanel: boolean): void {
    let cursorY = COLUMN_TOP_Y + (hasFocusPanel ? PANEL_H + ROW_GAP : 0);
    for (let index = 0; index < this.chips.length; index += 1) {
      const chip = this.chips[index];
      const entry = entries[index];
      if (!entry) {
        chip.moveTween?.destroy();
        chip.moveTween = null;
        chip.container.setVisible(false);
        continue;
      }
      const style = TONE_STYLES[entry.tone];
      const centerY = cursorY + CHIP_H / 2;
      cursorY += CHIP_H + ROW_GAP;

      const appearing = !chip.container.visible;
      chip.container.setVisible(true);
      chip.bg.setAlpha(style.panelAlpha);
      chip.progress
        .setText(entry.statusLine ?? `${entry.progressCurrent} / ${entry.progressTotal}`)
        .setColor(toCssColor(entry.terminal ? style.accent : COLORS.GREY_3));
      fitTitle(
        chip.title,
        entry.title,
        CHIP_CONTENT_RIGHT - CHIP_CONTENT_LEFT - chip.progress.width - TITLE_PROGRESS_GAP,
      );
      chip.title.setColor(toCssColor(style.accent));
      chip.frame.clear();
      chip.frame.lineStyle(1, style.accent, 0.34);
      chip.frame.strokeRoundedRect(CHIP_LEFT + 1, -CHIP_H / 2 + 1, PANEL_W - 2, CHIP_H - 2, PANEL_RADIUS);
      chip.glyph.clear();
      chip.glyph.setPosition(CHIP_GLYPH_X, 0);
      chip.glyph.fillStyle(style.accent, 0.9);
      drawDiamond(chip.glyph, 4.5, true);

      // Eine Zeile, die eine Position weiterrückt (weil darüber etwas verschwand), gleitet
      // dorthin, statt zu springen. Ein neu erscheinender Eintrag sitzt sofort richtig.
      if (appearing || chip.container.y === 0) {
        chip.container.setY(centerY).setAlpha(1);
      } else if (chip.targetY !== centerY) {
        chip.moveTween?.destroy();
        chip.moveTween = this.scene.tweens.add({
          targets: chip.container,
          y: centerY,
          duration: ROW_MOVE_MS,
          ease: 'Cubic.easeOut',
          onComplete: () => { chip.moveTween = null; },
        });
      }
      chip.targetY = centerY;
    }
  }

  private playPanelEntry(fromScale: number): void {
    this.panelTween?.destroy();
    const targetY = COLUMN_TOP_Y + PANEL_H / 2;
    this.panel
      .setPosition(COLUMN_X, targetY + (fromScale < 1 ? 0 : 8))
      .setScale(fromScale < 1 ? fromScale : 0.97)
      .setVisible(true)
      .setAlpha(0);
    this.panelTween = this.scene.tweens.add({
      targets: this.panel,
      alpha: 1,
      y: targetY,
      scaleX: 1,
      scaleY: 1,
      duration: fromScale < 1 ? 260 : ENTRY_MS,
      ease: 'Back.easeOut',
      onComplete: () => { this.panelTween = null; },
    });
  }

  private setPanelPulse(enabled: boolean): void {
    this.panelPulseTween?.destroy();
    this.panelPulseTween = null;
    this.panelGlyphGlow.setScale(1).setAlpha(0.5);
    if (!enabled) return;
    // Nur der fokussierte Zustand atmet – ruhiger als das Signalpulsieren des Pflichtziels,
    // damit die Nebenmission das Auge nicht dauerhaft vom Kampf wegzieht.
    this.panelPulseTween = this.scene.tweens.add({
      targets: this.panelGlyphGlow,
      scale: 1.35,
      alpha: 0.24,
      duration: 1_150,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * Auftritt im oberen Bilddrittel, kurzes Halten, danach Flug in den Panelplatz. Der Flug ist
   * die eigentliche Übergabe: Das Panel erscheint erst, wenn die Einblendung dort angekommen
   * ist, und übernimmt ihre Größe.
   */
  private showAnnouncement(entry: SecondaryObjectiveViewEntry, handsOverToPanel: boolean): void {
    const objectiveId = entry.objectiveId;
    const tone = entry.tone === 'completed'
      ? 'positive'
      : entry.tone === 'failed' ? 'negative' : 'secondary';
    this.objectiveAnnouncements.enqueue({
      id: `secondary:${objectiveId}:${entry.terminal ? entry.statusLine : 'active'}`,
      topic: `secondary:${objectiveId}`,
      priority: entry.terminal ? 50 : 0,
      kicker: entry.terminal ? `NEBENZIEL ${entry.statusLine}` : 'NEUES NEBENZIEL',
      title: entry.title,
      // Die Aktivierungsmeldung nennt Ausgangslage und Belohnung; ein binäres Ziel zeigt dort
      // seinen Status statt einer nichtssagenden Null.
      detail: entry.terminal
        ? undefined
        : `${entry.statusLine ?? `${entry.progressCurrent} / ${entry.progressTotal}`}  ·  ${entry.rewardHint}`,
      tone,
      ...(handsOverToPanel
        ? { target: { x: COLUMN_X, y: COLUMN_TOP_Y + PANEL_H / 2, scale: ANNOUNCE_TARGET_SCALE } }
        : {}),
      onStart: () => {
        this.announceHandsOverToPanel = handsOverToPanel;
        if (handsOverToPanel && this.panel?.active) this.panel.setVisible(false);
      },
      onArrive: () => {
        if (this.announceHandsOverToPanel
          && this.panel?.active
          && this.lastPanelObjectiveId === objectiveId) {
          this.playPanelEntry(ANNOUNCE_TARGET_SCALE);
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
    this.panel?.setVisible(false).setAlpha(1).setScale(1)
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
      chip.container.setVisible(false).setY(0);
      chip.targetY = 0;
    }
    this.announceHandsOverToPanel = false;
    this.root.setVisible(false);
    this.lastSignature = null;
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
