import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { ScopeModeConfig } from '../loadout/LoadoutConfig';

// Start-Sichtradius in Screen-Pixeln bei scope=0 (muss die Screen-Diagonale übersteigen)
const INITIAL_VIEW_RADIUS_PX = 1500;

// Eindeutiger Textur-Key
const TEX_KEY = '__scope_overlay_canvas';

/**
 * Die Canvas wird um diesen Faktor kleiner als der Bildschirm gehalten und beim Anzeigen wieder
 * hochskaliert. Das Overlay besteht ausschliesslich aus einer Flaeche und einem weichen
 * Radialverlauf, hat also keine hohen Ortsfrequenzen, die dabei verloren gehen koennten. In voller
 * Aufloesung kostete jeder Frame ein Loeschen und Fuellen von 1920x1080, das Rastern eines
 * Verlaufs mit bis zu 1500 px Radius und einen Upload von rund 8 MB Texturdaten auf die GPU.
 */
const CANVAS_DOWNSCALE = 4;

export class ScopeOverlay {
  private readonly image:      Phaser.GameObjects.Image;
  private readonly canvasTex:  Phaser.Textures.CanvasTexture;
  private readonly W:          number;
  private readonly H:          number;

  /** Animierter Anzeigewert – folgt dem Ziel-Progress mit scope/unscope-Geschwindigkeit. */
  private displayProgress = 0;

  /** Zuletzt gezeichneter Zustand in Canvas-Koordinaten, für den Dirty-Check. */
  private drawnX = Number.NaN;
  private drawnY = Number.NaN;
  private drawnInnerR = Number.NaN;
  private drawnOuterR = Number.NaN;
  private drawnProgress = Number.NaN;

  constructor(private readonly scene: Phaser.Scene) {
    this.W = Math.ceil(scene.scale.width / CANVAS_DOWNSCALE);
    this.H = Math.ceil(scene.scale.height / CANVAS_DOWNSCALE);

    // Vorhandene Textur ggf. aus einem vorigen Round-Start entfernen
    if (scene.textures.exists(TEX_KEY)) {
      scene.textures.remove(TEX_KEY);
    }

    // CanvasTexture: gibt volle Kontrolle über native Canvas-2D-Operationen.
    // destination-out unterstützt korrektes Ausschneiden eines Kreises aus dem Overlay.
    this.canvasTex = scene.textures.createCanvas(TEX_KEY, this.W, this.H) as Phaser.Textures.CanvasTexture;

    // Das Spiel laeuft mit `smoothPixelArt`, dessen Shader beim Hochskalieren bewusst blockige
    // Pixel erhaelt. Fuer diesen weichen Verlauf waere das genau falsch, deshalb hier abgeschaltet
    // und stattdessen echte bilineare Interpolation.
    this.canvasTex.setSmoothPixelArt(false);
    this.canvasTex.setFilter(Phaser.Textures.FilterMode.LINEAR);

    // Image hat scrollFactor(0) → bleibt immer am linken oberen Bildschirmrand.
    // Screen-Koordinaten werden über CANVAS_DOWNSCALE in Canvas-Koordinaten umgerechnet.
    this.image = scene.add.image(0, 0, TEX_KEY)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY - 0.5)
      .setOrigin(0, 0)
      .setScale(CANVAS_DOWNSCALE)
      .setVisible(false);
  }

  /**
   * Jeden Frame aufrufen.
   * @param targetProgress  Ziel-Scope-Fortschritt (0 = kein Scope, 1 = voller Scope)
   * @param cursorScreenX   Cursor-X in Screen-Koordinaten (pointer.x)
   * @param cursorScreenY   Cursor-Y in Screen-Koordinaten (pointer.y)
   * @param delta           Phaser delta (ms)
   * @param config          ScopeModeConfig der aktiven Scope-Waffe
   */
  update(
    targetProgress: number,
    cursorScreenX:  number,
    cursorScreenY:  number,
    delta:          number,
    config:         ScopeModeConfig,
  ): void {
    // Animiertes Annähern: Einscopen mit scopeInMs, Entscopen mit unscopeSpeedMs
    if (targetProgress > this.displayProgress) {
      this.displayProgress = Math.min(targetProgress, this.displayProgress + delta / config.scopeInMs);
    } else {
      this.displayProgress = Math.max(targetProgress, this.displayProgress - delta / config.unscopeSpeedMs);
    }

    if (this.displayProgress <= 0.005) {
      this.image.setVisible(false);
      return;
    }
    this.image.setVisible(true);

    const { W, H } = this;

    // Sichtradius in Screen-Pixeln: interpoliert von INITIAL (groß) zu fullScopeViewRadius (klein)
    const innerScreenR = INITIAL_VIEW_RADIUS_PX + (config.fullScopeViewRadius - INITIAL_VIEW_RADIUS_PX) * this.displayProgress;

    // Alles Weitere rechnet in Canvas-Koordinaten.
    const cx = cursorScreenX / CANVAS_DOWNSCALE;
    const cy = cursorScreenY / CANVAS_DOWNSCALE;
    const innerR = innerScreenR / CANVAS_DOWNSCALE;
    const outerR = innerR + config.edgeSoftnessPx / CANVAS_DOWNSCALE;

    // Steht der Zeiger still und ist der Scope ausanimiert, ist der Canvas-Inhalt unveraendert.
    // Dann entfallen Rasterung und Texturupload komplett.
    if (
      cx === this.drawnX
      && cy === this.drawnY
      && innerR === this.drawnInnerR
      && outerR === this.drawnOuterR
      && this.displayProgress === this.drawnProgress
    ) {
      return;
    }

    const ctx = this.canvasTex.context;

    // 1. Canvas leeren und schwarzes Overlay zeichnen
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(0,0,0,${this.displayProgress.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);

    // 2. Kreisförmiges Sichtloch mit weichem Rand ausschneiden.
    //    destination-out löscht Pixel anhand des Alpha-Werts der gezeichneten Form.
    //    Radialer Gradient: alpha=1 bei innerR (voll gelöscht) → alpha=0 bei outerR (nicht gelöscht).
    //    Ergebnis: vollständig sichtbar innerhalb innerR, weicher Übergang bis outerR, schwarz außerhalb.
    const gradient = ctx.createRadialGradient(
      cx, cy, Math.max(0, innerR),
      cx, cy, Math.max(1, outerR),
    );
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, outerR), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over'; // Blend-Mode zurücksetzen

    // GPU-Textur aus dem Canvas-Inhalt aktualisieren
    this.canvasTex.refresh();

    this.drawnX = cx;
    this.drawnY = cy;
    this.drawnInnerR = innerR;
    this.drawnOuterR = outerR;
    this.drawnProgress = this.displayProgress;
  }

  destroy(): void {
    this.image.destroy();
    if (this.scene.textures.exists(TEX_KEY)) {
      this.scene.textures.remove(TEX_KEY);
    }
  }
}
