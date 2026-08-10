import * as Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, LOW_HEALTH_BLOOD_VFX } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import {
  ensureBloodEdgeTextures,
  TEX_BLOOD_EDGE_BOTTOM,
  TEX_BLOOD_EDGE_LEFT,
  TEX_BLOOD_EDGE_RIGHT,
  TEX_BLOOD_EDGE_TOP,
  TEX_BLOOD_SPECKLE,
} from './BloodEffectShared';
import {
  NEUTRAL_LOW_HEALTH_BLOOD_STATE,
  resolveLowHealthBloodAlphas,
  stepLowHealthBlood,
  type LowHealthBloodState,
} from './lowHealthBloodModel';

/** Unter der Schadensvignette (`DEPTH.OVERLAY - 1`) und unter dem HUD. */
const DEPTH_LOW_HEALTH_BLOOD = DEPTH.OVERLAY - 2;

const EDGE_TEXTURES = [
  TEX_BLOOD_EDGE_TOP,
  TEX_BLOOD_EDGE_BOTTOM,
  TEX_BLOOD_EDGE_LEFT,
  TEX_BLOOD_EDGE_RIGHT,
] as const;

/**
 * Dauerhafte Blutdarstellung am Bildschirmrand bei wenig Leben.
 *
 * Sie ersetzt den Gesundheitsanteil der schwarzen Weltvignette: großflächig, dezent und in der
 * Formsprache der Trefferspritzer. Die kurze, kräftigere Schadensvignette aus `EffectSystem`
 * liegt darüber und teilt sich dieselben Kantentexturen – Dauerzustand und Treffer sollen
 * erkennbar dasselbe Blut sein.
 *
 * Die Bilder liegen auf der **Klarheitskamera**: sie sind Rückmeldung, keine Welt. Auf der
 * Weltkamera würde das Tageszeit-Grading ihr Rot verschieben, und ohne Zuordnung zeichnete
 * jede der beiden Kameras sie einmal.
 */
export class LowHealthBloodOverlay {
  private edges: Phaser.GameObjects.Image[] = [];
  private speckle: Phaser.GameObjects.Image | null = null;
  private state: LowHealthBloodState = NEUTRAL_LOW_HEALTH_BLOOD_STATE;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * @param hpFraction Anteil verbleibender Lebenspunkte des lokalen Spielers, 1 … 0. Tot,
   *   zuschauend oder außerhalb der Arena wird 1 erwartet – der Rand gehört zum eigenen Körper.
   */
  update(hpFraction: number, deltaMs: number): void {
    const next = stepLowHealthBlood(this.state, hpFraction, deltaMs);
    this.state = next;

    if (next.intensity <= 0) {
      this.hide();
      return;
    }

    this.ensureObjects();

    const { filmAlpha, speckleAlpha } = resolveLowHealthBloodAlphas(next);
    for (const edge of this.edges) {
      edge.setVisible(true).setAlpha(filmAlpha);
    }

    // Der Spritzer-Layer ist Detail, keine Information: in `low` bleibt er aus, die Fläche
    // trägt den Zustand dort allein.
    const speckleEnabled = getGraphicsQualityProfile(this.scene).level !== 'low';
    this.speckle?.setVisible(speckleEnabled && speckleAlpha > 0).setAlpha(speckleAlpha);
  }

  /** Rundenende: der Zustand darf keine Rundengrenze überleben. */
  reset(): void {
    this.state = NEUTRAL_LOW_HEALTH_BLOOD_STATE;
    this.hide();
  }

  destroy(): void {
    this.destroyObjects();
    this.state = NEUTRAL_LOW_HEALTH_BLOOD_STATE;
  }

  private destroyObjects(): void {
    for (const edge of this.edges) edge.destroy();
    this.edges = [];
    this.speckle?.destroy();
    this.speckle = null;
  }

  private hide(): void {
    for (const edge of this.edges) edge.setVisible(false);
    this.speckle?.setVisible(false);
  }

  private ensureObjects(): void {
    if (this.edges.length === EDGE_TEXTURES.length && this.edges.every((edge) => edge.scene) && this.speckle?.scene) {
      return;
    }

    // Nur die Objekte, nicht den Zustand: der Wiederaufbau darf die laufende Intensität nicht
    // auf null zurückwerfen.
    this.destroyObjects();
    ensureBloodEdgeTextures(this.scene);

    const createLayer = (texture: string, tint: number) => {
      const image = this.scene.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, texture)
        .setDepth(DEPTH_LOW_HEALTH_BLOOD)
        .setScrollFactor(0)
        .setTint(tint)
        .setAlpha(0)
        .setVisible(false);
      promoteToClarityCamera(this.scene, image);
      return image;
    };

    this.edges = EDGE_TEXTURES.map((texture) => createLayer(texture, LOW_HEALTH_BLOOD_VFX.filmColor));
    this.speckle = createLayer(TEX_BLOOD_SPECKLE, LOW_HEALTH_BLOOD_VFX.speckleColor);
  }
}
