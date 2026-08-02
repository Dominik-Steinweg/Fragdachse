import * as Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../../config';
import { getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';
import { getVisibleWorldView } from '../../ui/HostileBaseIndicator';
import {
  DEFAULT_DISTORTION_LIMITS,
  type DistortionFramePlan,
  type DistortionSourceState,
  planDistortionFrame,
} from './distortionFramePlanner';
import {
  DISTORTION_PROFILE_KEYS,
  DISTORTION_PROFILE_SIZE,
  distortionProfileTextureKey,
  writeDistortionProfilePixels,
} from './distortionProfileBake';

export const DISTORTION_MAP_TEXTURE_KEY = '__distortion_map';

/** Neutralwert der Karte. Der Shader rechnet `(rgb.rg - 0.5) * amount`. */
const NEUTRAL_FILL = 0x808080;

/**
 * Gemeinsame lokale Bildverzerrung für Zeitblase, Schwarzes Loch und Druckwellen.
 *
 * **Eine Karte, ein Pass.** Jede Quelle stempelt ihr gebackenes Profil in eine gemeinsame,
 * niedrig aufgelöste Verschiebungskarte; die Kamera hat dafür genau einen Displacement-Filter.
 * Ein eigener Vollbildfilter je Effekt würde mit jeder gleichzeitigen Quelle einen weiteren
 * Renderpass kosten – bei mehreren Zeitblasen wäre das nicht tragbar.
 *
 * **Die Karte wird nie in der Größe verändert.** `DynamicTexture.setSize()` legt den Framebuffer
 * neu an, während `Filters.Displacement.setTexture()` den `glTexture`-Wrapper **einmalig**
 * zwischenspeichert – der Filter zeigte danach auf eine tote Textur. Ändert sich die Auflösung
 * mit der Qualitätsstufe, wird die Textur zerstört, neu erzeugt und der Filter neu verbunden.
 */
export class LocalDistortionComposer {
  private texture: Phaser.Textures.DynamicTexture | null = null;
  private mapScale = 0;
  private readonly sources = new Map<string, DistortionSourceState>();
  private lastPlan: DistortionFramePlan = { commands: [], amount: 0, dropped: 0 };
  private onTextureRebuilt: (() => void) | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureProfileTextures();
  }

  /** Wird gerufen, wenn die Karte neu angelegt wurde – der Filter muss dann neu verbunden werden. */
  setTextureRebuiltHandler(handler: (() => void) | null): void {
    this.onTextureRebuilt = handler;
  }

  /**
   * Meldet eine Quelle für den aktuellen Frame an oder aktualisiert sie. Aufrufer melden pro
   * Frame; wer aufhört zu melden, verschwindet beim nächsten {@link update}.
   */
  submit(source: DistortionSourceState): void {
    this.sources.set(source.id, source);
  }

  release(id: string): void {
    this.sources.delete(id);
  }

  /**
   * Baut die Karte dieses Frames. Muss **nach** dem Kamera-Feedback laufen: der Versatz steckt
   * in `camera.scrollX`, und nur so wackelt die Verzerrung mit der Welt statt gegen sie.
   */
  update(camera: Phaser.Cameras.Scene2D.Camera): DistortionFramePlan {
    const profile = getGraphicsQualityProfile(this.scene);
    if (!profile.localDistortion || profile.distortionMapScale <= 0) {
      this.sources.clear();
      this.lastPlan = { commands: [], amount: 0, dropped: 0 };
      return this.lastPlan;
    }

    const texture = this.ensureMapTexture(profile.distortionMapScale);
    if (!texture) {
      this.sources.clear();
      return this.lastPlan;
    }

    // `camera.worldView` ist bei `origin = (0, 0)` unbrauchbar – dieselbe Ableitung wie beim
    // Basisanzeiger verwenden.
    const view = getVisibleWorldView(camera);
    const plan = planDistortionFrame(
      [...this.sources.values()],
      { x: view.x, y: view.y, width: view.width, height: view.height },
      this.mapScale,
      {
        ...DEFAULT_DISTORTION_LIMITS,
        maxSources: profile.maxDistortionSources,
      },
    );

    // Quellen sind Frame-Anmeldungen: wer nicht erneut meldet, ist weg. Das erspart jedem
    // Renderer eigene Aufräumpfade bei Rundenende, Tod oder Sichtwechsel.
    this.sources.clear();

    if (plan.commands.length === 0) {
      // Nichts zu zeichnen: die Karte bleibt stehen, der Filter wird ohnehin abgeschaltet.
      this.lastPlan = plan;
      return plan;
    }

    texture.fill(NEUTRAL_FILL, 1);
    for (const command of plan.commands) {
      const scale = command.sizePx / DISTORTION_PROFILE_SIZE;
      if (scale <= 0) continue;
      texture.stamp(distortionProfileTextureKey(command.profile), undefined, command.mapX, command.mapY, {
        alpha: command.alpha,
        scaleX: scale,
        scaleY: scale,
        rotation: command.rotation,
      });
    }
    // Phaser 4 puffert `fill()` und `stamp()`. Ohne den Flush bleibt die GPU-Textur schwarz;
    // der Displacement-Shader liest dann auf der ganzen Fläche (-0.5, -0.5), verschiebt das
    // komplette Kamerabild und zeigt keine der lokalen Quellen.
    texture.render();

    this.lastPlan = plan;
    return plan;
  }

  getLastPlan(): DistortionFramePlan {
    return this.lastPlan;
  }

  getTextureKey(): string {
    return DISTORTION_MAP_TEXTURE_KEY;
  }

  /** Rundenende: alle Quellen fallen lassen und die Karte neutralisieren. */
  reset(): void {
    this.sources.clear();
    this.lastPlan = { commands: [], amount: 0, dropped: 0 };
    if (this.texture) {
      this.texture.fill(NEUTRAL_FILL, 1);
      this.texture.render();
    }
  }

  destroy(): void {
    this.sources.clear();
    this.onTextureRebuilt = null;
    if (this.texture) {
      this.scene.textures.remove(DISTORTION_MAP_TEXTURE_KEY);
      this.texture = null;
    }
  }

  /**
   * Die vier Profile werden einmal gebacken. Bewusst per Pixelschleife: R und G tragen eine
   * vorzeichenbehaftete Richtung, keine Farbe – ein Canvas-Gradient würde Farben interpolieren.
   */
  private ensureProfileTextures(): void {
    for (const profile of DISTORTION_PROFILE_KEYS) {
      const key = distortionProfileTextureKey(profile);
      if (this.scene.textures.exists(key)) continue;

      const canvasTexture = this.scene.textures.createCanvas(
        key,
        DISTORTION_PROFILE_SIZE,
        DISTORTION_PROFILE_SIZE,
      );
      if (!canvasTexture) continue;

      const context = canvasTexture.context;
      const imageData = context.createImageData(DISTORTION_PROFILE_SIZE, DISTORTION_PROFILE_SIZE);
      imageData.data.set(writeDistortionProfilePixels(profile, DISTORTION_PROFILE_SIZE));
      context.putImageData(imageData, 0, 0);
      canvasTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      canvasTexture.refresh();
    }
  }

  private ensureMapTexture(scale: number): Phaser.Textures.DynamicTexture | null {
    if (this.texture && this.mapScale === scale) return this.texture;

    // Nicht `setSize()`: das legt den Framebuffer neu an, während der Displacement-Filter den
    // alten `glTexture`-Wrapper zwischengespeichert hat.
    if (this.texture) {
      this.scene.textures.remove(DISTORTION_MAP_TEXTURE_KEY);
      this.texture = null;
    }

    const width = Math.max(2, Math.ceil(GAME_WIDTH * scale));
    const height = Math.max(2, Math.ceil(GAME_HEIGHT * scale));
    const texture = this.scene.textures.addDynamicTexture(DISTORTION_MAP_TEXTURE_KEY, width, height);
    if (!texture) return null;

    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    texture.fill(NEUTRAL_FILL, 1);
    texture.render();
    this.texture = texture;
    this.mapScale = scale;
    this.onTextureRebuilt?.();
    return texture;
  }
}
