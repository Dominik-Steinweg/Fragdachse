import * as Phaser from 'phaser';
import { ARENA_MAX_X, ARENA_MAX_Y, ARENA_OFFSET_X, ARENA_OFFSET_Y, GAME_WIDTH, GAME_HEIGHT, DEPTH, DEPTH_LIGHTING, VOID_PALETTE } from '../config';
import { VOID_METEOR_INTRO, type BossIntroState } from '../config/bossIntros';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { clearCameraFocusOverride, setCameraFocusOverride } from '../graphics/cameraFocusOverride';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY } from './camera/cameraFeedbackPresets';
import { DISTORTION_PRIORITY } from './distortion/distortionFramePlanner';
import type { LocalDistortionComposer } from './distortion/LocalDistortionComposer';
import { registerGraphicsObject } from './EffectUtils';
import { ensureFlameTextures, TEX_FLAME_EMBER } from './FlameShared';
import { MeteorGpuLayer, type MeteorGpuItem } from './gpu/MeteorGpuLayer';
import type { LightingSystem } from './LightingSystem';
import { ensureVoidIntroTextures, VOID_INTRO_GLOW_TEXTURE, VOID_INTRO_RING_TEXTURE } from './VoidIntroTextures';
import { VoidMeteorPlasmaLayer } from './gpu/VoidMeteorPlasmaLayer';
import { VoidMeteorParticleTrail } from './VoidMeteorParticleTrail';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

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

const clampFocus = (value: number, min: number, max: number, half: number): number =>
  max - min <= half * 2 ? (min + max) / 2 : Math.max(min + half, Math.min(max - half, value));
const IMMEDIATE_LIGHT_RELEASE = { immediate: true };

interface MeteorIntro {
  readonly state: BossIntroState;
  lastElapsed: number;
}

/** A replicated intro anchor drives this entirely local cinematic. It never creates a strike,
 * damage or fire. Late observers reconstruct flight/crater age without replaying the impact. */
export class VoidMeteorIntroRenderer {
  private readonly meteor: MeteorGpuLayer;
  private readonly warningGlow: Phaser.GameObjects.Image;
  private readonly warningRing: Phaser.GameObjects.Image;
  private readonly plasma: VoidMeteorPlasmaLayer;
  private trail: VoidMeteorParticleTrail | null = null;
  private readonly flightShadow: Phaser.GameObjects.Image;
  private readonly flameCrown: Phaser.GameObjects.Image[];
  private readonly groundGlow = {
    lights: [{ x: 0, y: 0, radiusPx: 0, intensity: 0, color: VOID_PALETTE.primary as number }],
    lightCount: 0,
  };
  private readonly crater: MeteorGpuItem = { x: 0, y: 0, radius: I.meteorRadiusPx, progress: 1, seed: 0, void: true, age: 0 };
  private readonly warningDistortion = { id: DISTORTION_ID, profile: 'pullSwirl' as const,
    worldX: 0, worldY: 0, radiusPx: 0, strength: 0, rotation: 0, priority: DISTORTION_PRIORITY.blackHole };
  private readonly heatDistortion = { id: HEAT_DISTORTION_ID, profile: 'lens' as const,
    worldX: 0, worldY: 0, radiusPx: 0, strength: 0, rotation: 0, priority: DISTORTION_PRIORITY.shockwave };
  private readonly rumble = { id: RUMBLE_ID, channel: 'rumble' as const, amplitudePx: 0,
    frequencyHz: 0, sourceX: 0, sourceY: 0, durationMs: 250, priority: CAMERA_FEEDBACK_PRIORITY.telegraph, decay: 'linear' as const };
  private readonly crownLight = { radiusPx: 220, intensity: 0, color: 0xff8b32, occludes: false };
  private cameraFeedback: CameraFeedbackController | null = null;
  private distortion: LocalDistortionComposer | null = null;
  private audio: GameAudioSystem | null = null;
  private impactCallback: ((x: number, y: number, radius: number) => void) | null = null;
  private current: MeteorIntro | null = null;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem) {
    ensureVoidIntroTextures(scene.textures);
    ensureFlameTextures(scene);
    this.meteor = new MeteorGpuLayer(scene, 'bossIntro');
    this.plasma = new VoidMeteorPlasmaLayer(scene);
    this.warningGlow = this.createImage(VOID_INTRO_GLOW_TEXTURE)
      .setDepth(DEPTH.DECALS + 0.14).setBlendMode(Phaser.BlendModes.ADD);
    this.warningRing = this.createImage(VOID_INTRO_RING_TEXTURE)
      .setDepth(DEPTH.DECALS + 0.15).setBlendMode(Phaser.BlendModes.ADD);
    this.flightShadow = this.createImage(VOID_INTRO_GLOW_TEXTURE).setDepth(DEPTH.DECALS + 0.16).setTint(0x030008);
    this.flameCrown = Array.from({ length: 14 }, () => this.createFlame());
  }

  registerGpuVfx(gpu: GpuVfxSystem): void {
    this.trail?.destroy();
    this.trail = new VoidMeteorParticleTrail(gpu);
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
    const previous = this.current?.state;
    if (!previous || previous.startedAtMs !== state.startedAtMs || previous.seed !== state.seed
      || previous.x !== state.x || previous.y !== state.y) {
      this.clear();
      // First observation is a silent baseline, including a join on the impact frame.
      this.current = { state, lastElapsed: elapsed };
      this.trail?.start(state.seed);
    }
    const intro = this.current!;
    const impactAge = elapsed - I.impactAtMs;
    this.meteor.begin();
    if (impactAge >= 0) {
      const crater = this.crater;
      crater.x = state.x; crater.y = state.y; crater.seed = state.seed % 997;
      crater.age = impactAge / 1_000;
      this.meteor.add(crater);
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
    if (intro.lastElapsed < I.impactAtMs && elapsed >= I.impactAtMs && impactAge <= 450) {
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
    this.flightShadow.setVisible(false);
    this.plasma.clear();
    this.trail?.clear();
    for (const flame of this.flameCrown) flame.setVisible(false);
    this.lighting.setGroundGlowLights(this, null);
    this.lighting.releaseLight(LIGHT_KEY, IMMEDIATE_LIGHT_RELEASE);
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
    this.flightShadow.destroy();
    this.plasma.destroy();
    this.trail?.destroy();
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
      this.crownLight.intensity = 0.8 * (1 - crownAge / I.flameCrownMs);
      this.lighting.setLight(LIGHT_KEY, 'explosion', state.x, state.y, this.crownLight);
    } else this.lighting.releaseLight(LIGHT_KEY);
  }

  /** Analytic GPU core/wake are seekable; stochastic GPU detail starts with observation. */
  private renderFlight(state: BossIntroState, elapsed: number): void {
    const age = elapsed - I.meteorStartMs;
    const duration = I.impactAtMs - I.meteorStartMs;
    const progress = clamp01(age / duration);
    const angle = Math.PI - (0.45 + (state.seed % 1_000) / 1_000 * 0.22);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const distance = 410 * (1 - progress ** 1.35) + 690 * (1 - smooth(age / 300));
    const x = state.x - dx * distance, y = state.y - dy * distance;
    const visible = age >= 0 && age < duration;
    const reveal = smooth(age / 160);
    const compression = smooth((age - duration + 550) / 550);
    const radius = 100 * (0.94 + 0.06 * progress);
    const entryT = clamp01(age / 300);
    const speed = 410 * 1.35 * progress ** 0.35 / (duration / 1000)
      + (age < 300 ? 690 * 6 * entryT * (1 - entryT) / 0.3 : 0);
    if (visible) this.plasma.sync(x, y, radius, angle, age / 1_000, state.seed, compression, reveal);
    else this.plasma.clear();
    this.trail?.sync(x, y, angle, speed, visible);
    const shadowSize = 110 + 130 * progress;
    this.flightShadow.setVisible(visible).setPosition(x + dx * 70 * (1 - progress), y + dy * 70 * (1 - progress))
      .setDisplaySize(shadowSize, shadowSize).setAlpha(reveal * (0.2 + 0.68 * progress));
    if (visible) {
      const heat = this.heatDistortion;
      heat.worldX = x; heat.worldY = y; heat.radiusPx = radius * 1.5;
      heat.strength = 0.035 * reveal * (0.82 + 0.18 * Math.sin(age * 0.009)); heat.rotation = angle;
      this.distortion?.submit(heat);
    } else this.distortion?.release(HEAT_DISTORTION_ID);
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
    const warning = this.warningDistortion;
    warning.worldX = state.x; warning.worldY = state.y; warning.radiusPx = radius * 1.2;
    warning.strength = 0.18 * t; warning.rotation = elapsed * 0.0004;
    this.distortion?.submit(warning);
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
    setCameraFocusOverride(this.scene,
      clampFocus(state.x, ARENA_OFFSET_X, ARENA_MAX_X, halfWidth),
      clampFocus(state.y, ARENA_OFFSET_Y, ARENA_MAX_Y, halfHeight), weight, I.camera.zoom);
    if (elapsed >= I.meteorStartMs && elapsed < I.impactAtMs) {
      const t = clamp01((elapsed - I.meteorStartMs) / (I.impactAtMs - I.meteorStartMs));
      const rumble = this.rumble;
      rumble.amplitudePx = 1 + 7 * t * t; rumble.frequencyHz = 8 + t * 8;
      rumble.sourceX = state.x; rumble.sourceY = state.y;
      this.cameraFeedback?.request(rumble);
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
