import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { ScopeModeConfig } from '../loadout/LoadoutConfig';

// Start-Sichtradius in Screen-Pixeln bei scope=0 (muss die Screen-Diagonale übersteigen)
const INITIAL_VIEW_RADIUS_PX = 1500;

// Eindeutiger Textur-Key
const TEX_KEY = '__scope_overlay_canvas';

export class ScopeOverlay {
  private readonly image:      Phaser.GameObjects.Image;
  private readonly canvasTex:  Phaser.Textures.CanvasTexture;
  private readonly W:          number;
  private readonly H:          number;

  /** Animierter Anzeigewert – folgt dem Ziel-Progress mit scope/unscope-Geschwindigkeit. */
  private displayProgress = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.W = scene.scale.width;
    this.H = scene.scale.height;

    // Vorhandene Textur ggf. aus einem vorigen Round-Start entfernen
    if (scene.textures.exists(TEX_KEY)) {
      scene.textures.remove(TEX_KEY);
    }

    // CanvasTexture: gibt volle Kontrolle über native Canvas-2D-Operationen.
    // destination-out unterstützt korrektes Ausschneiden eines Kreises aus dem Overlay.
    this.canvasTex = scene.textures.createCanvas(TEX_KEY, this.W, this.H) as Phaser.Textures.CanvasTexture;

    // Image hat scrollFactor(0) → bleibt immer am linken oberen Bildschirmrand.
    // Koordinaten in der Canvas entsprechen direkt Screen-Pixeln – kein Kamera-Offset.
    this.image = scene.add.image(0, 0, TEX_KEY)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERLAY - 0.5)
      .setOrigin(0, 0)
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

    const ctx = this.canvasTex.context;
    const { W, H } = this;

    // Sichtradius in Screen-Pixeln: interpoliert von INITIAL (groß) zu fullScopeViewRadius (klein)
    const innerR = INITIAL_VIEW_RADIUS_PX + (config.fullScopeViewRadius - INITIAL_VIEW_RADIUS_PX) * this.displayProgress;
    const outerR = innerR + config.edgeSoftnessPx;

    // 1. Canvas leeren und schwarzes Overlay zeichnen
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(0,0,0,${this.displayProgress.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);

    // 2. Kreisförmiges Sichtloch mit weichem Rand ausschneiden.
    //    destination-out löscht Pixel anhand des Alpha-Werts der gezeichneten Form.
    //    Radialer Gradient: alpha=1 bei innerR (voll gelöscht) → alpha=0 bei outerR (nicht gelöscht).
    //    Ergebnis: vollständig sichtbar innerhalb innerR, weicher Übergang bis outerR, schwarz außerhalb.
    const gradient = ctx.createRadialGradient(
      cursorScreenX, cursorScreenY, Math.max(0, innerR),
      cursorScreenX, cursorScreenY, Math.max(1, outerR),
    );
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cursorScreenX, cursorScreenY, Math.max(1, outerR), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over'; // Blend-Mode zurücksetzen

    // GPU-Textur aus dem Canvas-Inhalt aktualisieren
    this.canvasTex.refresh();
  }

  destroy(): void {
    this.image.destroy();
    if (this.scene.textures.exists(TEX_KEY)) {
      this.scene.textures.remove(TEX_KEY);
    }
  }
}
