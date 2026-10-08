import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING, VOID_PALETTE } from '../config';
import { VOID_SPARKS_INTRO, type BossIntroState } from '../config/bossIntros';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { clearCameraFocusOverride, setCameraFocusOverride } from '../graphics/cameraFocusOverride';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, impactExceptional, impactMedium, sustainedRumble } from './camera/cameraFeedbackPresets';
import { DISTORTION_PRIORITY } from './distortion/distortionFramePlanner';
import type { LocalDistortionComposer } from './distortion/LocalDistortionComposer';
import { ensureCanvasTexture, registerGraphicsObject } from './EffectUtils';
import type { GroundGlowLightFrame, LightingSystem } from './LightingSystem';

/**
 * Void-Hunter-Intro „aus einer anderen Dimension“: Bodenrisse kriechen aus, ein schwebender
 * Dimensionsriss öffnet sich (dunkler Sternennebel, flackernder Rand, Sog-Verzerrung), kollabiert
 * zur Linie, und mit Blitz, Druckwelle und Narbe tritt der Boss hervor.
 *
 * Reine Präsentation des replizierten Intro-Ankers; deterministisch aus Seed und
 * `synchronizedNow - startedAtMs`. Einmal-Effekte zünden nur beim live erlebten Überschreiten.
 * Die Funken liefert {@link VoidHunterSparksRenderer} auf derselben Zeitachse.
 */

const I = VOID_SPARKS_INTRO;
const TEX_RIFT_BODY = '__void_rift_body';
const TEX_RIFT_NEBULA = '__void_rift_nebula';
const TEX_RIFT_RIM = '__void_rift_rim';
const TEX_GLOW = '__void_rift_glow';
const TEX_VEINS = '__void_rift_veins';
const TEX_SCAR = '__void_rift_scar';
const TEX_RING = '__void_rift_ring';
const RIFT_TEXTURE_W = 512;
const RIFT_TEXTURE_H = 192;
const GROUND_TEXTURE = 512;

/** Bodenrisse und Narbe liegen unter den Figuren; ihr Leuchten tragen Bodenleuchten der Lichtkarte. */
const DEPTH_VEINS = DEPTH.DECALS + 0.13;
/** Der Riss schwebt in der Luft und leuchtet selbst: über der Lichtkarte. */
const DEPTH_RIFT_GLOW = DEPTH_LIGHTING + 0.05;
const DEPTH_RIFT_BODY = DEPTH_LIGHTING + 0.07;
const DEPTH_RIFT_RIM = DEPTH_LIGHTING + 0.09;
const DEPTH_SHOCK_RING = DEPTH_LIGHTING + 0.11;

const RIFT_LIGHT_KEY = 'voidRift:rift';
const RUMBLE_ID = 'voidRift:rumble';
const DISTORTION_ID = 'voidRift:distortion';
const ONE_SHOT_STALE_MS = 450;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

interface RiftIntro {
  readonly key: string;
  readonly state: BossIntroState;
  readonly angle: number;
  lastElapsed: number;
}

export class VoidRiftIntroRenderer {
  private readonly riftGlow: Phaser.GameObjects.Image;
  private readonly riftBody: Phaser.GameObjects.Image;
  private readonly riftNebula: Phaser.GameObjects.Image;
  private readonly riftRim: Phaser.GameObjects.Image;
  private readonly veins: Phaser.GameObjects.Image;
  private readonly scar: Phaser.GameObjects.Image;
  private readonly shockRing: Phaser.GameObjects.Image;
  private readonly groundGlow: { lights: { x: number; y: number; radiusPx: number; intensity: number; color: number }[]; lightCount: number } = {
    lights: [{ x: 0, y: 0, radiusPx: 0, intensity: 0, color: VOID_PALETTE.primary }], lightCount: 0,
  };
  private cameraFeedback: CameraFeedbackController | null = null;
  private distortion: LocalDistortionComposer | null = null;
  private audio: GameAudioSystem | null = null;
  private current: RiftIntro | null = null;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lighting: LightingSystem,
  ) {
    ensureRiftTextures(scene.textures);
    this.veins = this.createImage(TEX_VEINS).setDepth(DEPTH_VEINS).setBlendMode(Phaser.BlendModes.ADD);
    this.scar = this.createImage(TEX_SCAR).setDepth(DEPTH_VEINS + 0.005).setBlendMode(Phaser.BlendModes.ADD);
    this.riftGlow = this.createImage(TEX_GLOW).setDepth(DEPTH_RIFT_GLOW).setBlendMode(Phaser.BlendModes.ADD);
    this.riftBody = this.createImage(TEX_RIFT_BODY).setDepth(DEPTH_RIFT_BODY);
    this.riftNebula = this.createImage(TEX_RIFT_NEBULA).setDepth(DEPTH_RIFT_BODY + 0.005).setBlendMode(Phaser.BlendModes.ADD);
    this.riftRim = this.createImage(TEX_RIFT_RIM).setDepth(DEPTH_RIFT_RIM).setBlendMode(Phaser.BlendModes.ADD);
    this.shockRing = this.createImage(TEX_RING).setDepth(DEPTH_SHOCK_RING).setBlendMode(Phaser.BlendModes.ADD);
  }

  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }
  setDistortionComposer(composer: LocalDistortionComposer | null): void { this.distortion = composer; }
  setAudioSystem(audio: GameAudioSystem | null): void { this.audio = audio; }

  sync(state: BossIntroState | null, now: number): void {
    if (this.destroyed) return;
    const elapsed = state ? now - state.startedAtMs : -1;
    if (state?.preset !== 'void-sparks' || elapsed < 0 || elapsed > I.durationMs) {
      this.clear();
      return;
    }
    const key = `${state.startedAtMs}:${state.seed}:${state.x}:${state.y}`;
    if (this.current?.key !== key) {
      this.clear();
      // Late-Joiner sehen den aktuellen Zustand, aber keine nachgeholten Einmal-Effekte.
      this.current = { key, state, angle: ((state.seed % 1000) / 1000 - 0.5) * 1.2, lastElapsed: elapsed - 60 };
    }
    const intro = this.current!;
    this.renderGround(intro, elapsed);
    this.renderRift(intro, elapsed);
    this.renderShockwave(intro, elapsed);
    this.renderCamera(intro, elapsed);
    this.fireOneShots(intro, elapsed);
    intro.lastElapsed = elapsed;
  }

  clear(): void {
    if (!this.current) return;
    this.current = null;
    for (const image of [this.riftGlow, this.riftBody, this.riftNebula, this.riftRim, this.veins, this.scar, this.shockRing]) {
      image.setVisible(false);
    }
    this.lighting.releaseLight(RIFT_LIGHT_KEY, { immediate: true });
    this.lighting.setGroundGlowLights(this, null);
    this.distortion?.release(DISTORTION_ID);
    this.cameraFeedback?.release(RUMBLE_ID, 120);
    clearCameraFocusOverride(this.scene);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const image of [this.riftGlow, this.riftBody, this.riftNebula, this.riftRim, this.veins, this.scar, this.shockRing]) {
      image.destroy();
    }
  }

  // ── Phasen ────────────────────────────────────────────────────────────────

  /** Öffnung des Risses: Länge zuerst, Breite danach; Kollaps umgekehrt zur leuchtenden Linie. */
  private riftShape(elapsed: number): { length: number; width: number; line: number } {
    if (elapsed >= I.collapseEndMs) return { length: 0, width: 0, line: 0 };
    const openLength = smooth((elapsed - I.riftOpenStartMs) / 900);
    const openWidth = smooth((elapsed - I.riftOpenStartMs - 600) / (I.riftOpenEndMs - I.riftOpenStartMs - 600));
    const collapse = clamp01((elapsed - I.collapseStartMs) / (I.collapseEndMs - I.collapseStartMs));
    const breathe = 1 + Math.sin(elapsed * 0.006) * 0.06 + Math.sin(elapsed * 0.017) * 0.03;
    const width = openWidth * breathe * (1 - smooth(collapse * 1.6));
    const length = openLength * (1 - smooth((collapse - 0.45) / 0.55));
    // Kurz vor dem Kollapsende bleibt nur eine grelle Linie.
    const line = collapse > 0 ? Math.sin(collapse * Math.PI) : 0;
    return { length, width, line };
  }

  private renderRift(intro: RiftIntro, elapsed: number): void {
    const { state, angle } = intro;
    const { length, width, line } = this.riftShape(elapsed);
    const visible = length > 0.01;
    const lengthPx = I.riftLengthPx * length;
    const widthPx = I.riftWidthPx * Math.max(width, 0.05 * length);
    const scaleX = lengthPx / (RIFT_TEXTURE_W * 0.94);
    const scaleY = widthPx / (RIFT_TEXTURE_H * 0.82);
    const flicker = 0.82 + 0.18 * Math.sin(elapsed * 0.047) * Math.sin(elapsed * 0.023 + 1.3);

    this.riftBody.setVisible(visible && width > 0.02).setPosition(state.x, state.y).setRotation(angle)
      .setScale(scaleX, scaleY).setAlpha(0.96);
    // Der Nebel wandert langsam durch den Riss – ein Blick in eine andere Dimension.
    this.riftNebula.setVisible(visible && width > 0.02).setPosition(
      state.x + Math.cos(angle) * Math.sin(elapsed * 0.0007) * lengthPx * 0.06,
      state.y + Math.sin(angle) * Math.sin(elapsed * 0.0007) * lengthPx * 0.06,
    ).setRotation(angle).setScale(scaleX * 0.92, scaleY * 0.84).setAlpha(0.55 + 0.25 * Math.sin(elapsed * 0.0031))
      .setTint(VOID_PALETTE.bright);
    this.riftRim.setVisible(visible).setPosition(state.x, state.y).setRotation(angle)
      .setScale(scaleX * 1.04, Math.max(scaleY * 1.12, 0.06 + line * 0.05))
      .setAlpha(Math.min(1, (0.75 + line * 0.6) * flicker));
    const glowStrength = visible ? Math.min(1, length * (0.55 + width * 0.6) + line * 0.8) : 0;
    this.riftGlow.setVisible(glowStrength > 0.01).setPosition(state.x, state.y).setRotation(angle)
      .setScale((lengthPx * 1.9) / 128, Math.max(widthPx * 3.2, 60 * length) / 128)
      .setTint(VOID_PALETTE.primary).setAlpha(0.42 * glowStrength * flicker);

    // Licht des Risses: wächst mit der Öffnung, bricht im Kollaps ein (Stille vor dem Sturm).
    const lightStrength = elapsed < I.collapseStartMs
      ? smooth((elapsed - I.riftOpenStartMs + 400) / 1600) * flicker
      : Math.max(0, 1 - (elapsed - I.collapseStartMs) / (I.collapseEndMs - I.collapseStartMs)) * 1.3;
    if (lightStrength > 0.01 && elapsed < I.collapseEndMs) {
      this.lighting.setLight(RIFT_LIGHT_KEY, 'voidFireChunk', state.x, state.y, {
        color: VOID_PALETTE.bright, radiusPx: 320, intensity: 1.05 * lightStrength,
      });
    } else this.lighting.releaseLight(RIFT_LIGHT_KEY);

    // Sog-Verzerrung um den Riss; im Kollaps zieht sie sich eng und stark zusammen.
    if (elapsed < I.emergeAtMs && this.distortion) {
      const collapse = clamp01((elapsed - I.collapseStartMs) / (I.collapseEndMs - I.collapseStartMs));
      const open = smooth((elapsed - I.riftOpenStartMs) / (I.riftOpenEndMs - I.riftOpenStartMs));
      const strength = elapsed < I.collapseStartMs ? 0.25 + open * 0.45 : elapsed < I.collapseEndMs ? 0.7 + collapse * 0.3 : 0;
      if (strength > 0.01 && elapsed >= I.riftOpenStartMs) {
        this.distortion.submit({
          id: DISTORTION_ID, profile: 'pullSwirl', worldX: state.x, worldY: state.y,
          radiusPx: I.riftLengthPx * (1.25 - collapse * 0.6), strength,
          rotation: angle + elapsed * 0.0012, priority: DISTORTION_PRIORITY.blackHole,
        });
      } else this.distortion.release(DISTORTION_ID);
    }
  }

  /** Bodenrisse während des Intros, nach dem Erscheinen eine verglimmende Narbe – unter den Figuren. */
  private renderGround(intro: RiftIntro, elapsed: number): void {
    const { state } = intro;
    const spread = smooth(elapsed / (I.anomalyEndMs + 800));
    const pulse = 0.8 + 0.2 * Math.sin(elapsed * 0.009);
    const beforeEmerge = elapsed < I.emergeAtMs;
    const veinAlpha = beforeEmerge
      ? spread * pulse * (elapsed > I.collapseStartMs ? 1.25 : 1)
      : 1 - smooth((elapsed - I.emergeAtMs) / 300);
    const veinScale = (I.veinRadiusPx * 2 * (0.35 + 0.65 * spread)) / GROUND_TEXTURE;
    this.veins.setVisible(veinAlpha > 0.01).setPosition(state.x, state.y).setRotation(intro.angle * 0.5)
      .setScale(veinScale).setTint(VOID_PALETTE.bright).setAlpha(Math.min(1, 0.85 * veinAlpha));

    const scarAge = elapsed - I.emergeAtMs;
    const scarAlpha = scarAge < 0 ? 0 : (1 - smooth(scarAge / I.scarFadeMs)) * (0.85 + 0.15 * Math.sin(elapsed * 0.02));
    this.scar.setVisible(scarAlpha > 0.01).setPosition(state.x, state.y).setRotation(intro.angle)
      .setScale((I.veinRadiusPx * 1.7) / GROUND_TEXTURE).setTint(VOID_PALETTE.core).setAlpha(scarAlpha);

    // Ein großes, weiches Bodenleuchten macht Risse und Narbe auch in tiefer Nacht lesbar.
    const glowLight = this.groundGlow.lights[0];
    glowLight.x = state.x; glowLight.y = state.y;
    glowLight.radiusPx = I.veinRadiusPx * (0.5 + 0.6 * spread);
    glowLight.intensity = Math.max(veinAlpha * 0.6, scarAlpha * 0.9);
    glowLight.color = scarAge >= 0 ? VOID_PALETTE.bright : VOID_PALETTE.primary;
    this.groundGlow.lightCount = glowLight.intensity > 0.01 ? 1 : 0;
    const frame: GroundGlowLightFrame = this.groundGlow;
    this.lighting.setGroundGlowLights(this, frame.lightCount > 0 ? frame : null);
  }

  /** Druckwelle beim Erscheinen: sichtbarer Ring plus Ring-Verzerrung. */
  private renderShockwave(intro: RiftIntro, elapsed: number): void {
    const age = elapsed - I.emergeAtMs;
    const t = age / I.shockwaveMs;
    if (age < 0 || t > 1) {
      this.shockRing.setVisible(false);
      if (age >= 0) this.distortion?.release(DISTORTION_ID);
      return;
    }
    const eased = 1 - (1 - t) * (1 - t);
    const radius = 40 + (I.shockwaveRadiusPx - 40) * eased;
    this.shockRing.setVisible(true).setPosition(intro.state.x, intro.state.y)
      .setScale((radius * 2) / 256).setTint(VOID_PALETTE.bright).setAlpha(0.9 * (1 - t));
    this.distortion?.submit({
      id: DISTORTION_ID, profile: 'ring', worldX: intro.state.x, worldY: intro.state.y,
      radiusPx: radius, strength: 0.9 * (1 - t), priority: DISTORTION_PRIORITY.blackHole,
    });
  }

  private renderCamera(intro: RiftIntro, elapsed: number): void {
    const camera = I.camera;
    const holdUntil = I.emergeAtMs + camera.holdAfterEmergeMs;
    const weight = elapsed <= holdUntil
      ? smooth(elapsed / camera.panInMs)
      : 1 - smooth((elapsed - holdUntil) / camera.panOutMs);
    setCameraFocusOverride(this.scene, intro.state.x, intro.state.y, weight, camera.zoom);

    if (elapsed >= I.rumble.startMs && elapsed < I.collapseEndMs) {
      const t = clamp01((elapsed - I.rumble.startMs) / (I.collapseEndMs - I.rumble.startMs));
      this.cameraFeedback?.request(sustainedRumble(RUMBLE_ID, I.rumble.amplitudePx * (0.2 + t * t * 0.8),
        CAMERA_FEEDBACK_PRIORITY.telegraph, {
          sourceX: intro.state.x, sourceY: intro.state.y, frequencyHz: 8 + t * 8, durationMs: 250,
        }));
    } else if (elapsed >= I.collapseEndMs) {
      this.cameraFeedback?.release(RUMBLE_ID, 60);
    }
  }

  private fireOneShots(intro: RiftIntro, elapsed: number): void {
    const crossed = (atMs: number): boolean => intro.lastElapsed < atMs && elapsed >= atMs
      && elapsed - atMs <= ONE_SHOT_STALE_MS;
    const { x, y } = intro.state;
    if (crossed(I.riftOpenStartMs)) {
      this.audio?.playSound('sfx_explosion_void_armageddon', x, y, undefined, 0.35);
    }
    if (crossed(I.collapseStartMs)) {
      this.cameraFeedback?.request(impactMedium({ sourceX: x, sourceY: y }));
    }
    if (crossed(I.emergeAtMs)) {
      this.cameraFeedback?.request(impactExceptional({ sourceX: x, sourceY: y }));
      this.lighting.pulse('teleportFlash', x, y, {
        radiusPx: 520, intensity: 1.4, color: VOID_PALETTE.core, durationMs: 750,
      });
      this.audio?.playSound('sfx_explosion_void_nuke', x, y, undefined, 0.75);
    }
  }

  private createImage(texture: string): Phaser.GameObjects.Image {
    const image = this.scene.add.image(0, 0, texture).setVisible(false);
    registerGraphicsObject(this.scene, 'bossIntro', image);
    return image;
  }
}

// ── Prozedurale Texturen ────────────────────────────────────────────────────

/** Kleiner deterministischer PRNG für reproduzierbare Texturen. */
function textureRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linsenförmiger, leicht gezackter Riss-Umriss mit spitzen Enden. */
function riftPath(ctx: CanvasRenderingContext2D, inset: number, seed: number, jag: number): void {
  const random = textureRandom(seed);
  const w = RIFT_TEXTURE_W, h = RIFT_TEXTURE_H;
  const left = w * 0.03 + inset, right = w * 0.97 - inset;
  const mid = h / 2;
  const half = h * 0.41 - inset;
  const steps = 48;
  ctx.beginPath();
  ctx.moveTo(left, mid);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 1; i < steps; i++) {
      const t = side < 0 ? i / steps : 1 - i / steps;
      const x = left + (right - left) * t;
      // Spitze Enden, bauchige Mitte; die Zacken lassen den Riss „gerissen“ wirken.
      const envelope = Math.pow(Math.sin(t * Math.PI), 0.85);
      const noise = (random() - 0.5) * jag * envelope;
      ctx.lineTo(x, mid + side * (half * envelope + noise));
    }
    ctx.lineTo(side < 0 ? right : left, mid);
  }
  ctx.closePath();
}

function ensureRiftTextures(textures: Phaser.Textures.TextureManager): void {
  ensureCanvasTexture(textures, TEX_RIFT_BODY, RIFT_TEXTURE_W, RIFT_TEXTURE_H, (ctx) => {
    // Inneres der anderen Dimension: fast schwarzer, violetter Abgrund mit Sternen.
    riftPath(ctx, 0, 11, 10);
    const depth = ctx.createRadialGradient(RIFT_TEXTURE_W / 2, RIFT_TEXTURE_H / 2, 4,
      RIFT_TEXTURE_W / 2, RIFT_TEXTURE_H / 2, RIFT_TEXTURE_W * 0.48);
    depth.addColorStop(0, '#030008');
    depth.addColorStop(0.55, '#0c0220');
    depth.addColorStop(1, '#2a0848');
    ctx.fillStyle = depth;
    ctx.fill();
    ctx.save();
    ctx.clip();
    const random = textureRandom(23);
    for (let i = 0; i < 130; i++) {
      const bright = random() < 0.18;
      ctx.fillStyle = bright ? 'rgba(249,232,255,0.95)' : `rgba(${180 + random() * 60},${140 + random() * 60},255,${0.35 + random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(random() * RIFT_TEXTURE_W, random() * RIFT_TEXTURE_H, bright ? 1.6 + random() * 1.4 : 0.6 + random() * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  ensureCanvasTexture(textures, TEX_RIFT_NEBULA, RIFT_TEXTURE_W, RIFT_TEXTURE_H, (ctx) => {
    // Nebelschleier, additiv über dem Abgrund; wird zur Laufzeit violett eingefärbt.
    riftPath(ctx, 6, 11, 8);
    ctx.save();
    ctx.clip();
    const random = textureRandom(37);
    for (let i = 0; i < 26; i++) {
      const x = RIFT_TEXTURE_W * (0.15 + random() * 0.7);
      const y = RIFT_TEXTURE_H * (0.25 + random() * 0.5);
      const r = 30 + random() * 70;
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, `rgba(255,255,255,${0.16 + random() * 0.16})`);
      cloud.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cloud;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  });
  ensureCanvasTexture(textures, TEX_RIFT_RIM, RIFT_TEXTURE_W, RIFT_TEXTURE_H, (ctx) => {
    // Gleißender Rand: breites violettes Glühen, darin ein weißer Kern.
    ctx.lineJoin = 'round';
    for (const [width, color] of [[16, 'rgba(179,71,255,0.25)'], [9, 'rgba(217,140,255,0.55)'], [4, 'rgba(249,232,255,0.95)'], [1.6, 'rgba(255,255,255,1)']] as const) {
      riftPath(ctx, 8, 11, 10);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  });
  ensureCanvasTexture(textures, TEX_GLOW, 128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
  ensureCanvasTexture(textures, TEX_RING, 256, 256, (ctx) => {
    for (const [width, alpha] of [[18, 0.18], [8, 0.45], [3, 1]] as const) {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(128, 128, 116, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  ensureCanvasTexture(textures, TEX_VEINS, GROUND_TEXTURE, GROUND_TEXTURE, (ctx) => drawVeins(ctx, 53, 9, 0.9));
  ensureCanvasTexture(textures, TEX_SCAR, GROUND_TEXTURE, GROUND_TEXTURE, (ctx) => {
    const c = GROUND_TEXTURE / 2;
    const burn = ctx.createRadialGradient(c, c, 0, c, c, c * 0.42);
    burn.addColorStop(0, 'rgba(255,255,255,0.75)');
    burn.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    burn.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = burn;
    ctx.fillRect(0, 0, GROUND_TEXTURE, GROUND_TEXTURE);
    drawVeins(ctx, 71, 14, 0.62);
  });
}

/** Leuchtende, verästelte Risse, die vom Zentrum ausstrahlen. */
function drawVeins(ctx: CanvasRenderingContext2D, seed: number, count: number, reach: number): void {
  const random = textureRandom(seed);
  const c = GROUND_TEXTURE / 2;
  const branch = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
    let px = x, py = y, a = angle;
    const steps = Math.max(3, Math.round(length / 14));
    for (let s = 0; s < steps; s++) {
      a += (random() - 0.5) * 0.7;
      const nx = px + Math.cos(a) * (length / steps), ny = py + Math.sin(a) * (length / steps);
      const w = width * (1 - s / steps * 0.7);
      for (const [lineWidth, alpha] of [[w * 3.2, 0.12], [w * 1.6, 0.35], [w * 0.6, 0.95]] as const) {
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      }
      if (depth > 0 && random() < 0.22) branch(nx, ny, a + (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.6), length * 0.45, w * 0.7, depth - 1);
      px = nx; py = ny;
    }
  };
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.5;
    branch(c + Math.cos(angle) * 10, c + Math.sin(angle) * 10, angle, c * reach * (0.55 + random() * 0.45), 3.2, 2);
  }
}
