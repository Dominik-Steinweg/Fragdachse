import type * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { wildlifeFogCover } from '../arena/AmbientWildlifeAppearance';
import { removeInternalFx, type GlowHandle } from '../utils/phaserFx';
import { addPlayerGlow, PLAYER_GLOW, setPlayerGlowOpacity } from './PlayerGlow';
import type { GroundGlowLightFrame, LightingSystem } from './LightingSystem';
import type { SunCloudState } from './sunlight/cloudShadow';

type Figure = Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;

/** Scene-weite Umgebung der Spielerfarbe: Sonnen-/Nebelfeld der dargestellten World. */
export interface PlayerGlowEnvironment {
  readonly clouds: SunCloudState;
  /** Wirksamer Nebelanteil der World (0 = kein Nebelpass, 1 = Standardstärke). */
  fogStrength(): number;
}

const environments = new WeakMap<Phaser.Scene, PlayerGlowEnvironment>();

/** Borrow only: the World's sunlight owner releases this before its fields go away. */
export function bindPlayerGlowEnvironment(scene: Phaser.Scene, environment: PlayerGlowEnvironment): () => void {
  environments.set(scene, environment);
  return () => { if (environments.get(scene) === environment) environments.delete(scene); };
}

/** Halo-Skalierung gegenüber dem Grundglow, bis zu der das Filter-Padding reicht. */
const MAX_FOG_SCALE = 1 + PLAYER_GLOW.fogSpread * 0.6;
const MIN_LIFT = 0.02;

/**
 * Hält die Spielerfarbe einer Figur gegen die Pässe über ihr lesbar.
 *
 * Der Halo des Figur-Filters liegt unter Bodennebel und Lichtkarte. Eine halo-only-Kopie über
 * dem Nebel gleicht genau dessen lokale Deckung aus (im Dunst breiter statt heller); ein
 * schattenloses Bodenlicht in Spielerfarbe beleuchtet nachts Boden, Nebel und den eigenen Halo.
 * Reine Darstellung: liest den angezeigten Sprite und dessen Glow-Handle, schreibt nichts zurück.
 */
export class PlayerGlowPresence {
  private readonly lift: Phaser.GameObjects.Image;
  private readonly liftGlow: GlowHandle | null;
  private readonly light = { x: 0, y: 0, radiusPx: 0, intensity: 0, color: 0 };
  private readonly lightFrame: GroundGlowLightFrame & { lightCount: number } = { lights: [this.light], lightCount: 0 };
  private lightRegistered = false;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly source: Figure,
    color: number,
    private lighting: Pick<LightingSystem, 'setGroundGlowLights'> | null,
  ) {
    this.lift = scene.add.image(source.x, source.y, source.texture.key, source.frame.name)
      .setDepth(DEPTH.GROUND_FOG_COMPOSITE + 0.05)
      .setVisible(false);
    this.liftGlow = addPlayerGlow(this.lift, color, 1, PLAYER_GLOW.strength.min,
      { knockout: true, rim: 0, maxScale: MAX_FOG_SCALE });
  }

  /** Nachfolgende World-Lichtkarte; `null` meldet das Bodenlicht ab. */
  setLighting(lighting: Pick<LightingSystem, 'setGroundGlowLights'> | null): void {
    if (lighting === this.lighting) return;
    this.releaseLight();
    this.lighting = lighting;
  }

  /**
   * Pro dargestelltem Frame nach Pose/Sichtbarkeit der Figur.
   * @param shown Figur steht sichtbar auf dem Feld (nicht getarnt, eingegraben oder montiert).
   */
  sync(glow: GlowHandle | null, shown: boolean): void {
    if (this.destroyed) return;
    const source = this.source;
    const visible = shown && source.active && source.visible && source.alpha > 0.01 && glow !== null;
    if (!visible || !glow) {
      this.lift.setVisible(false);
      this.releaseLight();
      return;
    }
    const pulse = glow.outerStrength / PLAYER_GLOW.strength.min;
    this.syncLift(glow);
    this.syncLight(glow.color, pulse);
  }

  private syncLift(glow: GlowHandle): void {
    const source = this.source, environment = environments.get(this.scene);
    const fog = environment ? Math.max(0, Math.min(1, environment.fogStrength())) : 0;
    const cover = fog > 0 ? wildlifeFogCover(source.x, source.y, environment!.clouds) * fog : 0;
    const opacity = cover * PLAYER_GLOW.fogLift * source.alpha;
    if (opacity < MIN_LIFT || !this.liftGlow) {
      this.lift.setVisible(false);
      return;
    }
    const lift = this.lift;
    if (lift.texture.key !== source.texture.key || lift.frame.name !== source.frame.name)
      lift.setTexture(source.texture.key, source.frame.name);
    lift.setPosition(source.x, source.y)
      .setRotation(source.rotation)
      .setScale(source.scaleX, source.scaleY)
      .setOrigin(source.originX, source.originY)
      .setFlip(source.flipX, source.flipY)
      .setVisible(true);
    const liftGlow = this.liftGlow;
    liftGlow.color = glow.color;
    liftGlow.outerStrength = glow.outerStrength;
    // Light scattering in haze: the halo widens with cover; opacity carries the energy.
    liftGlow.scale = 1 + cover * PLAYER_GLOW.fogSpread;
    setPlayerGlowOpacity(liftGlow, opacity);
  }

  private syncLight(color: number, pulse: number): void {
    if (!this.lighting) return;
    const light = this.light, tuning = PLAYER_GLOW.groundLight;
    light.x = this.source.x;
    light.y = this.source.y;
    light.color = color;
    light.radiusPx = tuning.radiusPx * Math.min(1.25, 0.9 + pulse * 0.1);
    light.intensity = tuning.intensity * Math.min(1.6, pulse) * this.source.alpha;
    this.lightFrame.lightCount = 1;
    this.lighting.setGroundGlowLights(this, this.lightFrame);
    this.lightRegistered = true;
  }

  private releaseLight(): void {
    this.lightFrame.lightCount = 0;
    if (!this.lightRegistered) return;
    this.lightRegistered = false;
    this.lighting?.setGroundGlowLights(this, null);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseLight();
    removeInternalFx(this.lift, this.liftGlow);
    this.lift.destroy();
  }
}
