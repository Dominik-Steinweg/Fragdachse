import type * as Phaser from 'phaser';
import { DEPTH_LIGHTING } from '../config';
import { AMBIENT_WILDLIFE } from '../arena/AmbientWildlifeConfig';
import { createWildlifeAppearance, fireflyGlowStrength } from '../arena/AmbientWildlifeAppearance';
import { prepareWildlifeVisuals } from '../arena/AmbientWildlifeGeometry';
import { createAmbientWildlifeLayer, type AmbientWildlifeLayer } from '../arena/AmbientWildlifeLayer';
import type { WildlifeAnimal } from '../arena/AmbientWildlifeModel';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import { LIGHT_PRESETS } from './LightingConfig';
import { registerGraphicsObject } from './EffectUtils';
import type { LightingSystem } from './LightingSystem';

/**
 * Inszenierte Glühwürmchen, die exakt wie die Ambient-Glühwürmchen aussehen: dasselbe Mesh,
 * derselbe Puls, dasselbe Bodenlicht und dieselbe Ebene. Nur die Flugbahn gibt der Besitzer vor
 * (z. B. um den Grave-Titan); das Ambient-Verhaltensmodell läuft hier nicht.
 */

/** Selbstleuchtend wie die Ambient-Glühwürmchen: über der Lichtkarte, unter dem Kronendach. */
const DEPTH_FIREFLY = DEPTH_LIGHTING + 0.1;
const TAU = Math.PI * 2;

export interface GraveFireflyPose {
  readonly x: number;
  readonly y: number;
  /** Flugrichtung in Radiant (0 = rechts). */
  readonly heading: number;
  /** 0..1 Sichtbarkeit (Ein-/Ausblenden). */
  readonly alpha: number;
}

export class GraveFireflySwarm {
  private readonly animals: WildlifeAnimal[];
  private readonly layer: AmbientWildlifeLayer;
  private readonly lightKeys: string[];
  private readonly lit: boolean[];
  private readonly view = createVisibleWorldView();
  private lastNowMs: number | null = null;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lighting: LightingSystem | null,
    lightKeyPrefix: string,
    count: number,
    seed: number,
  ) {
    let state = seed >>> 0;
    const random = (): number => {
      state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return state / 4294967296;
    };
    this.animals = Array.from({ length: count }, () => createFirefly(random));
    this.layer = createAmbientWildlifeLayer(scene, prepareWildlifeVisuals(this.animals), DEPTH_FIREFLY, 'grave-fireflies');
    registerGraphicsObject(scene, 'bossIntro', this.layer);
    this.lightKeys = this.animals.map((_, index) => `${lightKeyPrefix}:${index}`);
    this.lit = this.animals.map(() => false);
  }

  get size(): number { return this.animals.length; }

  /** Eine Pose pro Glühwürmchen; fehlende gelten als unsichtbar. */
  sync(poses: readonly GraveFireflyPose[], nowMs: number): void {
    if (this.destroyed) return;
    const view = getVisibleWorldView(this.scene.cameras.main, this.view, 32);
    const dt = this.lastNowMs === null ? 0 : Math.max(0, Math.min(0.1, (nowMs - this.lastNowMs) / 1000));
    this.lastNowMs = nowMs;
    const time = nowMs / 1000;
    const preset = LIGHT_PRESETS.stagedFirefly;
    for (let index = 0; index < this.animals.length; index += 1) {
      const animal = this.animals[index];
      const pose = poses[index];
      animal.opacity = pose ? Math.max(0, Math.min(1, pose.alpha)) : 0;
      if (pose) {
        animal.x = pose.x;
        animal.y = pose.y;
        animal.angle = pose.heading;
      }
      animal.animation += dt * AMBIENT_WILDLIFE.firefly.animationRate;
      const radius = preset.radiusPx;
      const visible = animal.opacity > 0.005 && animal.x + radius >= view.x && animal.y + radius >= view.y
        && animal.x - radius <= view.x + view.width && animal.y - radius <= view.y + view.height;
      if (visible && this.lighting) {
        const pulse = fireflyGlowStrength(time, animal.variation, animal.phaseOffset, animal.speed);
        this.lighting.setLight(this.lightKeys[index], 'stagedFirefly', animal.x, animal.y, {
          intensity: preset.intensity * animal.opacity * pulse,
        });
      } else if (this.lit[index]) {
        this.lighting?.releaseLight(this.lightKeys[index], { immediate: true });
      }
      this.lit[index] = visible;
    }
    this.layer.updatePose(view, time);
  }

  /** Alles unsichtbar machen und die Bodenlichter freigeben; der Schwarm bleibt wiederverwendbar. */
  clear(): void {
    for (let index = 0; index < this.animals.length; index += 1) {
      this.animals[index].opacity = 0;
      if (this.lit[index]) this.lighting?.releaseLight(this.lightKeys[index], { immediate: true });
      this.lit[index] = false;
    }
    this.lastNowMs = null;
    if (!this.destroyed) this.layer.updatePose({ x: 0, y: 0, width: 0, height: 0 }, 0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.layer.destroy();
  }
}

/** Glühwürmchen mit derselben Erscheinungs- und Pulsvariation wie im Ambient-Modell. */
function createFirefly(random: () => number): WildlifeAnimal {
  const phaseOffset = random() * TAU;
  return {
    kind: 'firefly',
    homeX: 0,
    homeY: 0,
    variation: random(),
    phaseOffset,
    appearance: createWildlifeAppearance('firefly', random(), random(), 0),
    x: 0,
    y: 0,
    angle: phaseOffset,
    turnSpeed: 0,
    avoidanceAngle: null,
    // Ruhige Ambient-Fluggeschwindigkeit: der Puls zeigt kein Flucht-Aufleuchten.
    speed: AMBIENT_WILDLIFE.firefly.speed,
    animation: phaseOffset,
    opacity: 0,
    fishPhase: 'swimming',
    phaseTime: 0,
    calmTime: 0,
    alertCooldown: 0,
    fleeing: false,
    resting: false,
    diurnalActive: false,
    retireTime: 0,
    shot: { x: 0, y: 0, until: 0 },
  };
}
