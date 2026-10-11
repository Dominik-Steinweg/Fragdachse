import * as Phaser from 'phaser';
import { ARENA_MAX_X, ARENA_MAX_Y, ARENA_OFFSET_X, ARENA_OFFSET_Y, GAME_WIDTH, GAME_HEIGHT, DEPTH, DEPTH_LIGHTING, VOID_PALETTE } from '../config';
import { VOID_METEOR_INTRO, type BossIntroState } from '../config/bossIntros';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { clearCameraFocusOverride, setCameraFocusOverride } from '../graphics/cameraFocusOverride';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, sustainedRumble } from './camera/cameraFeedbackPresets';
import { DISTORTION_PRIORITY } from './distortion/distortionFramePlanner';
import type { LocalDistortionComposer } from './distortion/LocalDistortionComposer';
import { registerGraphicsObject } from './EffectUtils';
import { ensureFlameTextures, TEX_FLAME_EMBER } from './FlameShared';
import { MeteorGpuLayer } from './gpu/MeteorGpuLayer';
import type { LightingSystem } from './LightingSystem';
import { ensureVoidIntroTextures, VOID_INTRO_GLOW_TEXTURE, VOID_INTRO_RING_TEXTURE } from './VoidIntroTextures';
import {
  ensureVoidMeteorTextures, VOID_METEOR_ROCK, VOID_METEOR_CORONA, VOID_METEOR_FLAME, VOID_METEOR_SMOKE,
  VOID_METEOR_CRACKS, VOID_METEOR_HEAT_LIP,
} from './VoidMeteorTextures';

const I = VOID_METEOR_INTRO;
const RUMBLE_ID = 'voidMeteorIntro:rumble';
const DISTORTION_ID = 'voidMeteorIntro:anticipation';
const HEAT_DISTORTION_ID = 'voidMeteorIntro:flightHeat';
const LIGHT_KEY = 'voidMeteorIntro:impact';
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

interface MeteorIntro {
  readonly key: string;
  readonly state: BossIntroState;
  lastElapsed: number;
}

/** A replicated intro anchor drives this entirely local cinematic. It never creates a strike,
 * damage or fire. Late observers reconstruct flight/crater age without replaying the impact. */
export class VoidMeteorIntroRenderer {
  private readonly meteor: MeteorGpuLayer;
  private readonly warningGlow: Phaser.GameObjects.Image;
  private readonly warningRing: Phaser.GameObjects.Image;
  private readonly flightBody: Phaser.GameObjects.Image;
  private readonly flightCracks: Phaser.GameObjects.Image;
  private readonly flightHeatLip: Phaser.GameObjects.Image;
  private readonly flightCorona: Phaser.GameObjects.Image;
  private readonly flightGlow: Phaser.GameObjects.Image;
  private readonly flightShadow: Phaser.GameObjects.Image;
  private readonly flightSmoke: Phaser.GameObjects.Image[];
  private readonly flightFlames: Phaser.GameObjects.Image[];
  private readonly flightSparks: Phaser.GameObjects.Image[];
  private readonly flameCrown: Phaser.GameObjects.Image[];
  private readonly groundGlow = {
    lights: [{ x: 0, y: 0, radiusPx: 0, intensity: 0, color: VOID_PALETTE.primary as number }],
    lightCount: 0,
  };
  private cameraFeedback: CameraFeedbackController | null = null;
  private distortion: LocalDistortionComposer | null = null;
  private audio: GameAudioSystem | null = null;
  private impactCallback: ((x: number, y: number, radius: number) => void) | null = null;
  private current: MeteorIntro | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem) {
    ensureVoidIntroTextures(scene.textures);
    ensureVoidMeteorTextures(scene.textures);
    ensureFlameTextures(scene);
    this.meteor = new MeteorGpuLayer(scene, 'bossIntro');
    this.warningGlow = this.createImage(VOID_INTRO_GLOW_TEXTURE)
      .setDepth(DEPTH.DECALS + 0.14).setBlendMode(Phaser.BlendModes.ADD);
    this.warningRing = this.createImage(VOID_INTRO_RING_TEXTURE)
      .setDepth(DEPTH.DECALS + 0.15).setBlendMode(Phaser.BlendModes.ADD);
    this.flightShadow = this.createImage(VOID_INTRO_GLOW_TEXTURE).setDepth(DEPTH.DECALS + 0.16).setTint(0x030008);
    // A single airborne mass is deliberately above the canopy. Its ground shadow remains below actors.
    this.flightBody = this.createImage(VOID_METEOR_ROCK).setDepth(20.66);
    this.flightCracks = this.createImage(VOID_METEOR_CRACKS).setDepth(20.661).setBlendMode(Phaser.BlendModes.ADD);
    this.flightHeatLip = this.createImage(VOID_METEOR_HEAT_LIP).setDepth(20.662).setBlendMode(Phaser.BlendModes.ADD);
    this.flightCorona = this.createImage(VOID_METEOR_CORONA).setDepth(20.65).setBlendMode(Phaser.BlendModes.ADD);
    this.flightGlow = this.createImage(VOID_INTRO_GLOW_TEXTURE).setDepth(20.54).setBlendMode(Phaser.BlendModes.ADD);
    this.flightSmoke = Array.from({ length: 18 }, () => this.createFlightSmoke());
    this.flightFlames = Array.from({ length: 24 }, () => this.createFlightFlame());
    this.flightSparks = Array.from({ length: 22 }, () => this.createFlightSpark());
    this.flameCrown = Array.from({ length: 14 }, () => this.createFlame());
  }

  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }
  setDistortionComposer(composer: LocalDistortionComposer | null): void { this.distortion = composer; }
  setAudioSystem(audio: GameAudioSystem | null): void { this.audio = audio; }
  setImpactCallback(callback: ((x: number, y: number, radius: number) => void) | null): void {
    this.impactCallback = callback;
  }

  ownsSpawnAt(state: BossIntroState | null, now: number): boolean {
    if (this.destroyed || state?.preset !== 'void-meteor') return false;
    const elapsed = now - state.startedAtMs;
    return elapsed >= 0 && elapsed <= I.durationMs + 4_000;
  }

  sync(state: BossIntroState | null, now: number): void {
    if (this.destroyed) return;
    const elapsed = state ? now - state.startedAtMs : -1;
    if (state?.preset !== 'void-meteor' || elapsed < 0 || elapsed > I.durationMs) {
      this.clear();
      return;
    }
    const key = `${state.startedAtMs}:${state.seed}:${state.x}:${state.y}`;
    if (this.current?.key !== key) {
      this.clear();
      // The first observation is a silent baseline, including a join on the impact frame.
      this.current = { key, state, lastElapsed: elapsed };
    }
    const intro = this.current!;
    const impactAge = elapsed - I.impactAtMs;
    this.meteor.begin();
    if (impactAge >= 0) {
      this.meteor.add({
        x: state.x, y: state.y, radius: I.meteorRadiusPx,
        progress: 1, seed: state.seed % 997, void: true, age: impactAge / 1_000,
      });
    }
    this.meteor.flush();
    // Intro residue recedes beneath the authoritative fire chunks instead of masking their landings.
    this.meteor.setAlpha((1 - 0.62 * smooth(impactAge / 1_100))
      * (1 - smooth((elapsed - I.durationMs + 1_200) / 1_200)));
    this.renderFlight(state, elapsed);
    this.renderGround(state, elapsed);
    this.renderWarning(state, elapsed);
    this.renderFlameCrown(state, elapsed - I.emergeAtMs);
    this.renderCamera(state, elapsed);
    const crossed = (at: number): boolean => intro.lastElapsed < at && elapsed >= at && elapsed - at <= 450;
    if (crossed(I.impactAtMs)) {
      this.impactCallback?.(state.x, state.y, I.explosionRadiusPx);
      this.audio?.playSound('sfx_explosion_void_armageddon', state.x, state.y, undefined, 0.35);
      this.audio?.playSound('sfx_explosion_void_nuke', state.x, state.y, undefined, 0.8);
    }
    intro.lastElapsed = elapsed;
  }

  clear(): void {
    if (!this.current) return;
    this.current = null;
    this.meteor.clear();
    this.warningGlow.setVisible(false);
    this.warningRing.setVisible(false);
    for (const image of this.flightImages()) image.setVisible(false);
    for (const flame of this.flameCrown) flame.setVisible(false);
    this.lighting.setGroundGlowLights(this, null);
    this.lighting.releaseLight(LIGHT_KEY, { immediate: true });
    this.distortion?.release(DISTORTION_ID);
    this.distortion?.release(HEAT_DISTORTION_ID);
    this.cameraFeedback?.release(RUMBLE_ID, 120);
    clearCameraFocusOverride(this.scene);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.meteor.destroy();
    this.warningGlow.destroy();
    this.warningRing.destroy();
    for (const image of this.flightImages()) image.destroy();
    for (const flame of this.flameCrown) flame.destroy();
    this.impactCallback = null;
  }

  private renderGround(state: BossIntroState, elapsed: number): void {
    const approach = smooth(elapsed / I.impactAtMs);
    const age = elapsed - I.impactAtMs;
    const warning = age < 0 ? smooth(elapsed / 700) * (0.16 + 0.55 * approach) : 0;
    this.warningGlow.setVisible(warning > 0).setPosition(state.x, state.y)
      .setDisplaySize(I.meteorRadiusPx * 3, I.meteorRadiusPx * 3)
      .setTint(VOID_PALETTE.primary).setAlpha(warning * (0.9 + 0.1 * Math.sin(elapsed * 0.014)));
    const light = this.groundGlow.lights[0];
    light.x = state.x; light.y = state.y;
    light.radiusPx = I.meteorRadiusPx * (1.25 + 0.35 * approach);
    light.intensity = age < 0 ? warning : 0.35 * (1 - smooth(age / 1_800));
    light.color = age < 0 ? VOID_PALETTE.primary : VOID_PALETTE.bright;
    this.groundGlow.lightCount = light.intensity > 0.01 ? 1 : 0;
    this.lighting.setGroundGlowLights(this, this.groundGlow.lightCount ? this.groundGlow : null);
    const crownAge = elapsed - I.emergeAtMs;
    if (crownAge >= 0 && crownAge < I.flameCrownMs) {
      this.lighting.setLight(LIGHT_KEY, 'explosion', state.x, state.y, {
        radiusPx: 220, intensity: 0.8 * (1 - crownAge / I.flameCrownMs), color: 0xff8b32, occludes: false,
      });
    } else this.lighting.releaseLight(LIGHT_KEY);
  }

  /** Fixed pools sampled analytically: a join sees the same airborne silhouette and wake.
   * Rotation is wholly in the map plane; no simulated perspective or visible rock side face. */
  private renderFlight(state: BossIntroState, elapsed: number): void {
    const age = elapsed - I.meteorStartMs;
    const duration = I.impactAtMs - I.meteorStartMs;
    const progress = clamp01(age / duration);
    // West-front impact: approach from the map interior above/right of the target.
    const angle = Math.PI - (0.45 + (state.seed % 1_000) / 1_000 * 0.22);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const distance = 410 * (1 - progress ** 1.35) + 690 * (1 - smooth(age / 300));
    const x = state.x - dx * distance, y = state.y - dy * distance;
    const visible = age >= 0 && age < duration;
    const reveal = smooth(age / 160);
    const size = 226 * (0.94 + 0.06 * progress);
    const rotation = angle + Math.sin(state.seed) * 0.25 + age * 0.00018;
    this.flightBody.setVisible(visible).setPosition(x, y).setDisplaySize(size, size)
      .setRotation(rotation).setAlpha(reveal);
    const pulse = 0.82 + 0.18 * Math.sin(age * 0.009);
    const localFront = angle - rotation;
    const heatTint = (cx: number, cy: number): number => {
      const intensity = Math.round(255 * (0.16 + 0.84 * clamp01(0.5 + (cx * Math.cos(localFront) + cy * Math.sin(localFront)) * 0.5)));
      return intensity * 0x010101;
    };
    this.flightCracks.setVisible(visible).setPosition(x, y).setDisplaySize(size, size)
      .setRotation(rotation).setTint(heatTint(-1, -1), heatTint(1, -1), heatTint(-1, 1), heatTint(1, 1))
      .setAlpha(reveal * pulse);
    this.flightHeatLip.setVisible(visible).setPosition(x, y).setDisplaySize(size, size)
      .setRotation(angle).setAlpha(reveal * (0.9 + 0.1 * pulse));
    this.flightCorona.setVisible(visible).setPosition(x, y).setDisplaySize(size * 1.14, size * 1.14)
      .setRotation(angle).setAlpha(reveal * (0.8 + 0.12 * Math.sin(age * 0.021)));
    this.flightGlow.setVisible(visible).setPosition(x, y).setDisplaySize(size * 2.1, size * 2.1)
      .setTint(VOID_PALETTE.primary).setAlpha(reveal * 0.26);
    const shadowSize = 110 + 130 * progress;
    this.flightShadow.setVisible(visible).setPosition(x + dx * 70 * (1 - progress), y + dy * 70 * (1 - progress))
      .setDisplaySize(shadowSize, shadowSize).setAlpha(reveal * (0.2 + 0.68 * progress));
    if (visible) this.distortion?.submit({
      id: HEAT_DISTORTION_ID, profile: 'lens', worldX: x, worldY: y,
      radiusPx: size * 0.7, strength: 0.035 * reveal * pulse, rotation: angle,
      priority: DISTORTION_PRIORITY.shockwave,
    });
    else this.distortion?.release(HEAT_DISTORTION_ID);

    // Trails extend ~three rock diameters behind the head. A particle's emission time, rather
    // than a local emitter clock, controls both initial build-up and the brief postimpact remnant.
    const drawWake = (images: readonly Phaser.GameObjects.Image[], life: number, kind: 'smoke' | 'flame' | 'spark'): void => {
      for (let i = 0; i < images.length; i++) {
        const phase = ((i * 0.618034 + (state.seed % 997) / 997) % 1) * life;
        const particleAge = ((age + phase) % life + life) % life;
        const born = age - particleAge;
        const t = particleAge / life;
        const present = age >= 0 && born >= 0 && born < duration;
        const lateral = Math.sin(i * 4.79 + state.seed) * (kind === 'spark' ? 65 : 32)
          + Math.sin(particleAge * 0.006 + i) * 18 * t;
        const length = kind === 'spark' ? 690 : 570;
        // Small hot fragments peel off the leading edge and sweep into the wake.
        const behind = kind === 'spark' ? -78 + t * length : 65 + t * length;
        const px = x - dx * behind - dy * lateral, py = y - dy * behind + dx * lateral;
        const fade = smooth(t * 9) * (1 - smooth(t)) * (1 - smooth((age - duration) / 650));
        const image = images[i];
        image.setVisible(present).setPosition(px, py);
        if (kind === 'smoke') {
          const width = 65 + t * 145;
          image.setDisplaySize(width * 1.2, width).setRotation(i * 2.4 + t * 0.7).setAlpha(fade * 0.68);
        } else if (kind === 'flame') {
          image.setDisplaySize(190 + 140 * t, 112 - 46 * t).setRotation(angle + Math.sin(i) * 0.1)
            .setAlpha(fade * 0.48);
        } else {
          image.setDisplaySize(15 + 23 * (1 - t), 2.5 + (i % 3)).setRotation(angle)
            .setTint(i % 3 === 0 ? 0xffefff : VOID_PALETTE.bright).setAlpha(fade * 0.85);
        }
      }
    };
    drawWake(this.flightSmoke, 1_250, 'smoke');
    drawWake(this.flightFlames, 1_100, 'flame');
    drawWake(this.flightSparks, 920, 'spark');
  }

  private flightImages(): readonly Phaser.GameObjects.Image[] {
    return [this.flightBody, this.flightCracks, this.flightHeatLip, this.flightCorona, this.flightGlow, this.flightShadow,
      ...this.flightSmoke, ...this.flightFlames, ...this.flightSparks];
  }

  private createFlightSmoke(): Phaser.GameObjects.Image {
    return this.createImage(VOID_METEOR_SMOKE).setDepth(20.55);
  }

  private createFlightFlame(): Phaser.GameObjects.Image {
    return this.createImage(VOID_METEOR_FLAME).setDepth(20.6).setBlendMode(Phaser.BlendModes.ADD);
  }

  private createFlightSpark(): Phaser.GameObjects.Image {
    return this.createImage(VOID_INTRO_GLOW_TEXTURE).setDepth(20.67).setBlendMode(Phaser.BlendModes.ADD);
  }

  private renderWarning(state: BossIntroState, elapsed: number): void {
    if (elapsed >= I.impactAtMs) {
      this.warningRing.setVisible(false);
      this.distortion?.release(DISTORTION_ID);
      return;
    }
    const t = smooth(elapsed / I.impactAtMs);
    const radius = I.meteorRadiusPx * (0.4 + 0.6 * t);
    this.warningRing.setVisible(true).setPosition(state.x, state.y)
      .setScale(radius / 116).setTint(VOID_PALETTE.bright).setAlpha(smooth(elapsed / 700) * (0.25 + 0.4 * t));
    this.distortion?.submit({
      id: DISTORTION_ID, profile: 'pullSwirl', worldX: state.x, worldY: state.y,
      radiusPx: radius * 1.2, strength: 0.18 * t, rotation: elapsed * 0.0004,
      priority: DISTORTION_PRIORITY.blackHole,
    });
  }

  private renderFlameCrown(state: BossIntroState, age: number): void {
    const t = clamp01(age / I.flameCrownMs);
    const envelope = smooth(t * 7) * (1 - smooth(t));
    for (let i = 0; i < this.flameCrown.length; i++) {
      const phase = i * 2.39996 + (state.seed % 628) / 100;
      const radius = 58 + 45 * t + 12 * Math.sin(phase * 3);
      const flame = this.flameCrown[i];
      flame.setVisible(age >= 0 && age < I.flameCrownMs)
        .setPosition(state.x + Math.cos(phase) * radius, state.y + Math.sin(phase) * radius)
        .setRotation(phase + Math.PI / 2 + 0.15 * Math.sin(age * 0.025 + phase))
        .setDisplaySize(24 + 16 * envelope, 48 + 48 * envelope)
        .setTint(i % 3 === 0 ? 0xffdd88 : 0xff7926).setAlpha(envelope * 0.85);
    }
  }

  private renderCamera(state: BossIntroState, elapsed: number): void {
    const holdUntil = I.emergeAtMs + I.camera.holdAfterEmergeMs;
    const weight = elapsed <= holdUntil ? smooth(elapsed / I.camera.panInMs)
      : 1 - smooth((elapsed - holdUntil) / I.camera.panOutMs);
    const camera = this.scene.cameras.main;
    // Read the existing map extent; never move the host's reserved spawn to frame an intro.
    // Account for the design-to-viewport scale used by both production and scenario cameras.
    const halfWidth = camera.width / this.scene.scale.width * GAME_WIDTH / I.camera.zoom / 2 + 32;
    const halfHeight = camera.height / this.scene.scale.height * GAME_HEIGHT / I.camera.zoom / 2 + 32;
    const clampFocus = (value: number, min: number, max: number, half: number): number =>
      max - min <= half * 2 ? (min + max) / 2 : Math.max(min + half, Math.min(max - half, value));
    setCameraFocusOverride(this.scene,
      clampFocus(state.x, ARENA_OFFSET_X, ARENA_MAX_X, halfWidth),
      clampFocus(state.y, ARENA_OFFSET_Y, ARENA_MAX_Y, halfHeight), weight, I.camera.zoom);
    if (elapsed >= I.meteorStartMs && elapsed < I.impactAtMs) {
      const t = clamp01((elapsed - I.meteorStartMs) / (I.impactAtMs - I.meteorStartMs));
      this.cameraFeedback?.request(sustainedRumble(RUMBLE_ID, 1 + 7 * t * t,
        CAMERA_FEEDBACK_PRIORITY.telegraph, {
          sourceX: state.x, sourceY: state.y, frequencyHz: 8 + t * 8, durationMs: 250,
        }));
    } else this.cameraFeedback?.release(RUMBLE_ID, 60);
  }

  private createFlame(): Phaser.GameObjects.Image {
    return this.createImage(TEX_FLAME_EMBER).setDepth(DEPTH_LIGHTING + 0.15).setBlendMode(Phaser.BlendModes.ADD);
  }

  private createImage(texture: string): Phaser.GameObjects.Image {
    const image = this.scene.add.image(0, 0, texture).setVisible(false);
    registerGraphicsObject(this.scene, 'bossIntro', image);
    return image;
  }
}
