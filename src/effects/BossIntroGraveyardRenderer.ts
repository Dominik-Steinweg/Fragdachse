import * as Phaser from 'phaser';
import { DEPTH, DEPTH_LIGHTING } from '../config';
import { AMBIENT_WILDLIFE } from '../arena/AmbientWildlifeConfig';
import { getBossIntroPreset, type BossIntroState, type GraveyardRiseIntroPreset } from '../config/bossIntros';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { clearCameraFocusOverride, setCameraFocusOverride } from '../graphics/cameraFocusOverride';
import type { BurrowGpuRenderer } from './BurrowGpuRenderer';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, impactExceptional, impactLight, sustainedRumble } from './camera/cameraFeedbackPresets';
import { ensureCanvasTexture, registerGraphicsObject } from './EffectUtils';
import type { LightingSystem } from './LightingSystem';

/**
 * Inszenierung „Friedhof erhebt sich“ vor dem Grave-Titan.
 *
 * Reine Präsentation eines replizierten Host-Ankers ({@link BossIntroState}): Alle Positionen,
 * Zeitpunkte und Varianten folgen deterministisch aus Seed und `synchronizedNow - startedAtMs`.
 * Host, Clients und Late-Joiner sehen deshalb dieselbe Szene; Einmal-Effekte (Erdbrocken,
 * Shake, Blitz) zünden nur beim live miterlebten Überschreiten ihres Zeitpunkts.
 */

const TOMBSTONE_SPRITE_KEYS = ['graveyard_tombstone_a', 'graveyard_tombstone_b', 'graveyard_tombstone_c', 'graveyard_tombstone_d'] as const;
const FRAGMENT_SPRITE_KEYS = ['graveyard_tombstone_fragment_a', 'graveyard_tombstone_fragment_b', 'graveyard_tombstone_fragment_c', 'graveyard_tombstone_fragment_d'] as const;
const TEX_TOMB_FALLBACK = ['__grave_tomb_a', '__grave_tomb_b', '__grave_tomb_c', '__grave_tomb_d'] as const;
const TEX_FRAGMENT_FALLBACK = ['__grave_frag_a', '__grave_frag_b', '__grave_frag_c', '__grave_frag_d'] as const;
const TEX_PLOT = '__grave_plot';
const TEX_SHADOW = '__grave_shadow';
const TEX_CRATER = '__grave_crater';
const TEX_GLOW = '__grave_glow';
const TEX_MIST = '__grave_mist';
const TOMB_TEXTURE_PX = 128;
/** Gezeichnete Fläche des Grabfelds in seiner 64×96-Textur. */
const PLOT_DRAWN_WIDTH_PX = 44;
const PLOT_DRAWN_LENGTH_PX = 80;
const TEX_FIREFLY = '__grave_firefly';
/** Glühwürmchen in derselben Größe wie die Ambient-Glühwürmchen der Welt. */
const FIREFLY_HALO_RADIUS_PX = AMBIENT_WILDLIFE.fireflyGlowRadius * AMBIENT_WILDLIFE.visualScale;
const FRAGMENT_TEXTURE_PX = 64;

/** Bodennahe Grabfelder und der Krater liegen bei den Decals. */
const DEPTH_GRAVE_GROUND = DEPTH.DECALS + 0.12;
/** Grabsteine sind Material auf Felshöhe und werden von der Lichtkarte beleuchtet. */
const DEPTH_GRAVE_SHADOW = DEPTH.ROCKS + 0.2;
const DEPTH_GRAVE_STONE = DEPTH.ROCKS + 0.3;
const DEPTH_GRAVE_FRAGMENT = DEPTH.ROCKS + 0.35;
/** Selbstleuchtendes (Mondschein-Kegel, Nebel, Glühwürmchen) liegt über der Lichtkarte. */
const DEPTH_GRAVE_MOONBEAM = DEPTH_LIGHTING + 0.06;
const DEPTH_GRAVE_MIST = DEPTH_LIGHTING + 0.08;
const DEPTH_GRAVE_FIREFLY = DEPTH_LIGHTING + 0.12;

const MOON_LIGHT_KEY = 'bossIntro:moon';
const RIM_LIGHT_KEY = 'bossIntro:rim';
const RUMBLE_ID = 'bossIntro:rumble';
const FIREFLY_LIGHT_COUNT = 6;
const MIST_COUNT = 7;
/** Einmal-Effekte zünden nur, wenn ihr Zeitpunkt höchstens so lange zurückliegt. */
const ONE_SHOT_STALE_MS = 450;

interface StoneLayout {
  readonly x: number;
  readonly y: number;
  readonly variant: number;
  readonly rotation: number;
  readonly scale: number;
  readonly riseAtMs: number;
  readonly flip: boolean;
}

interface FragmentLayout {
  readonly stone: number;
  readonly variant: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly speed: number;
  readonly spin: number;
  readonly rotation: number;
  readonly scale: number;
}

interface FireflyLayout {
  readonly radius: number;
  readonly angularSpeed: number;
  readonly phase: number;
  readonly wobble: number;
  readonly pulseHz: number;
  readonly delayMs: number;
}

interface IntroScene {
  readonly key: string;
  readonly state: BossIntroState;
  readonly preset: GraveyardRiseIntroPreset;
  readonly stones: readonly StoneLayout[];
  readonly fragments: readonly FragmentLayout[];
  readonly fireflies: readonly FireflyLayout[];
  readonly churnEvents: readonly { readonly atMs: number; readonly x: number; readonly y: number }[];
  lastElapsedMs: number;
}

/** Kleiner deterministischer PRNG (mulberry32). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const easeOutBack = (value: number): number => {
  const t = clamp01(value) - 1;
  const overshoot = 2.1;
  return 1 + t * t * ((overshoot + 1) * t + overshoot);
};

export class BossIntroGraveyardRenderer {
  private readonly plots: Phaser.GameObjects.Image[] = [];
  private readonly shadows: Phaser.GameObjects.Image[] = [];
  private readonly stones: Phaser.GameObjects.Image[] = [];
  private readonly fragments: Phaser.GameObjects.Image[] = [];
  private readonly fireflies: Phaser.GameObjects.Image[] = [];
  private readonly mist: Phaser.GameObjects.Image[] = [];
  private readonly crater: Phaser.GameObjects.Image;
  private readonly moonbeam: Phaser.GameObjects.Image;
  private cameraFeedback: CameraFeedbackController | null = null;
  private audio: GameAudioSystem | null = null;
  private current: IntroScene | null = null;
  private lightsActive = false;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lighting: LightingSystem,
    private readonly burrowGpu: BurrowGpuRenderer,
  ) {
    this.ensureTextures();
    this.crater = this.createImage(TEX_CRATER).setDepth(DEPTH_GRAVE_GROUND + 0.01);
    this.moonbeam = this.createImage(TEX_GLOW).setDepth(DEPTH_GRAVE_MOONBEAM).setBlendMode(Phaser.BlendModes.ADD);
  }

  setCameraFeedback(controller: CameraFeedbackController | null): void { this.cameraFeedback = controller; }
  setAudioSystem(audio: GameAudioSystem | null): void { this.audio = audio; }

  /** Ob ein Intro gerade das Erscheinen dieses Bosses inszeniert (unterdrückt den Spawnblitz). */
  ownsSpawnAt(state: BossIntroState | null, now: number): boolean {
    if (!state) return false;
    const elapsed = now - state.startedAtMs;
    return elapsed >= -1_000 && elapsed <= getBossIntroPreset(state.preset).durationMs + 4_000;
  }

  /**
   * Pro Frame. `state` ist der replizierte Anker oder `null`; `active` ist die äußere
   * Präsentationsfreigabe (keine Darstellung in Vorschauen oder während des Exit-Fades).
   */
  sync(state: BossIntroState | null, now: number, active: boolean): void {
    if (this.destroyed) return;
    if (!state || !active) {
      this.clear();
      return;
    }
    const elapsed = now - state.startedAtMs;
    const preset = getBossIntroPreset(state.preset);
    if (elapsed < 0 || elapsed > preset.durationMs) {
      this.clear();
      return;
    }

    const key = `${state.startedAtMs}:${state.seed}:${state.x}:${state.y}`;
    if (this.current?.key !== key) {
      this.clear();
      this.current = this.buildIntro(key, state, preset, elapsed);
    }
    const intro = this.current!;
    this.renderStones(intro, elapsed);
    this.renderFragments(intro, elapsed);
    this.renderGround(intro, elapsed);
    this.renderAtmosphere(intro, elapsed, now);
    this.renderCamera(intro, elapsed);
    this.fireOneShots(intro, elapsed);
    intro.lastElapsedMs = elapsed;
  }

  /** World-Teardown und Präsentationsende: alles verstecken, Licht und Kamera freigeben. */
  clear(): void {
    if (this.current === null && !this.lightsActive) return;
    this.current = null;
    for (const list of [this.plots, this.shadows, this.stones, this.fragments, this.fireflies, this.mist]) {
      for (const image of list) image.setVisible(false);
    }
    this.crater.setVisible(false);
    this.moonbeam.setVisible(false);
    this.releaseLights();
    this.cameraFeedback?.release(RUMBLE_ID, 120);
    clearCameraFocusOverride(this.scene);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const list of [this.plots, this.shadows, this.stones, this.fragments, this.fireflies, this.mist]) {
      for (const image of list) image.destroy();
      list.length = 0;
    }
    this.crater.destroy();
    this.moonbeam.destroy();
  }

  // ── Aufbau ────────────────────────────────────────────────────────────────

  private buildIntro(key: string, state: BossIntroState, preset: GraveyardRiseIntroPreset, elapsed: number): IntroScene {
    const random = createRandom(state.seed);
    const config = preset.tombstones;
    const stones: StoneLayout[] = [];
    // Versetzte, grob nach Norden ausgerichtete Reihen lesen als Friedhof; einzelne Steine
    // stehen schief. Die Mitte bleibt frei – dort bricht der Titan durch.
    const baseRotation = (random() - 0.5) * 0.24;
    const slots: { x: number; y: number }[] = [];
    const rows = Math.floor(config.fieldRadiusY / config.rowSpacingPx);
    const columns = Math.floor(config.fieldRadiusX / config.columnSpacingPx);
    for (let row = -rows; row <= rows; row += 1) {
      const shift = (row & 1) * config.columnSpacingPx * 0.5;
      for (let column = -columns; column <= columns; column += 1) {
        const x = column * config.columnSpacingPx + shift + (random() - 0.5) * 8;
        const y = row * config.rowSpacingPx + (random() - 0.5) * 8;
        const ellipse = (x / config.fieldRadiusX) ** 2 + (y / config.fieldRadiusY) ** 2;
        if (ellipse > 1 || Math.hypot(x, y) < config.innerRadius) continue;
        slots.push({ x, y });
      }
    }
    for (let index = slots.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [slots[index], slots[swap]] = [slots[swap], slots[index]];
    }
    const chosen = slots.slice(0, config.count);
    // Die Steine erheben sich von innen nach außen, wie eine Welle aus dem Grab.
    const riseOrder = chosen
      .map((slot, index) => ({ index, distance: Math.hypot(slot.x, slot.y) }))
      .sort((a, b) => a.distance - b.distance)
      .map((entry) => entry.index);
    const visualSpan = TOMB_TEXTURE_PX * 0.7;
    chosen.forEach((slot, index) => {
      const crooked = random() < 0.3;
      stones.push({
        x: state.x + slot.x,
        y: state.y + slot.y,
        variant: Math.floor(random() * 4),
        rotation: baseRotation + (random() - 0.5) * (crooked ? 0.8 : 0.16),
        scale: (config.sizePx / visualSpan) * (1 + (random() - 0.5) * 2 * config.sizeJitter),
        riseAtMs: config.riseStartMs + riseOrder.indexOf(index) * config.riseStaggerMs + random() * 70,
        flip: random() < 0.5,
      });
    });

    const fragments: FragmentLayout[] = [];
    stones.forEach((stone, stoneIndex) => {
      const awayX = stone.x - state.x;
      const awayY = stone.y - state.y;
      const length = Math.hypot(awayX, awayY) || 1;
      for (let index = 0; index < preset.shatter.fragmentsPerStone; index += 1) {
        const spread = (random() - 0.5) * 1.5;
        const cos = Math.cos(spread);
        const sin = Math.sin(spread);
        const dirX = (awayX / length) * cos - (awayY / length) * sin;
        const dirY = (awayX / length) * sin + (awayY / length) * cos;
        fragments.push({
          stone: stoneIndex,
          variant: Math.floor(random() * 4),
          dirX,
          dirY,
          speed: preset.shatter.fragmentSpeed * (0.55 + random() * 0.7),
          spin: (random() - 0.5) * 14,
          rotation: random() * Math.PI * 2,
          scale: stone.scale * (0.55 + random() * 0.35),
        });
      }
    });

    const fireflies: FireflyLayout[] = [];
    for (let index = 0; index < preset.fireflies.count; index += 1) {
      fireflies.push({
        radius: preset.fireflies.orbitRadius * (0.4 + random() * 0.65),
        angularSpeed: (random() < 0.5 ? -1 : 1) * (0.35 + random() * 0.55),
        phase: random() * Math.PI * 2,
        wobble: 8 + random() * 18,
        pulseHz: 0.6 + random() * 1.1,
        delayMs: random() * 900,
      });
    }

    // Erdbrocken beim Aufwühlen: anfangs vereinzelt, kurz vor dem Durchbruch dicht.
    const churnEvents: { atMs: number; x: number; y: number }[] = [];
    const churnSpan = preset.emergeAtMs - preset.churn.startMs;
    for (let time = 0; time < churnSpan; ) {
      const progress = time / churnSpan;
      const reach = preset.churn.radius * (0.35 + progress * 0.65);
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * reach;
      churnEvents.push({
        atMs: preset.churn.startMs + time,
        x: state.x + Math.cos(angle) * distance,
        y: state.y + Math.sin(angle) * distance,
      });
      time += Phaser.Math.Linear(340, 85, progress) * (0.75 + random() * 0.5);
    }

    this.ensurePool(this.plots, stones.length, () => this.createImage(TEX_PLOT).setDepth(DEPTH_GRAVE_GROUND));
    this.ensurePool(this.shadows, stones.length, () => this.createImage(TEX_SHADOW).setDepth(DEPTH_GRAVE_SHADOW));
    this.ensurePool(this.stones, stones.length, () => this.createImage(this.tombTexture(0)).setDepth(DEPTH_GRAVE_STONE));
    this.ensurePool(this.fragments, fragments.length, () => this.createImage(this.fragmentTexture(0)).setDepth(DEPTH_GRAVE_FRAGMENT));
    this.ensurePool(this.fireflies, fireflies.length, () => this.createImage(TEX_FIREFLY)
      .setDepth(DEPTH_GRAVE_FIREFLY).setBlendMode(Phaser.BlendModes.ADD));
    this.ensurePool(this.mist, MIST_COUNT, () => this.createImage(TEX_MIST)
      .setDepth(DEPTH_GRAVE_MIST).setBlendMode(Phaser.BlendModes.ADD));
    stones.forEach((stone, index) => {
      this.stones[index].setTexture(this.tombTexture(stone.variant)).setFlipX(stone.flip);
      this.shadows[index].setTexture(this.tombTexture(stone.variant)).setFlipX(stone.flip)
        .setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
    });
    fragments.forEach((fragment, index) => this.fragments[index].setTexture(this.fragmentTexture(fragment.variant)));

    // Late-Joiner sehen den aktuellen Zustand, aber keine nachgeholten Einmal-Effekte.
    return { key, state, preset, stones, fragments, fireflies, churnEvents, lastElapsedMs: elapsed - 60 };
  }

  // ── Darstellung ───────────────────────────────────────────────────────────

  private renderStones(intro: IntroScene, elapsed: number): void {
    const { preset } = intro;
    const emerge = preset.emergeAtMs;
    const churnProgress = clamp01((elapsed - preset.churn.startMs) / (emerge - preset.churn.startMs));
    intro.stones.forEach((stone, index) => {
      const plot = this.plots[index];
      const shadow = this.shadows[index];
      const image = this.stones[index];
      const rise = clamp01((elapsed - stone.riseAtMs) / preset.tombstones.riseDurationMs);
      const shattered = elapsed >= emerge;
      // Grabfeld: erscheint mit dem Stein und bleibt nach dem Zerbersten noch kurz als Spur.
      const plotAlpha = shattered
        ? 0.75 * (1 - smoothstep((elapsed - emerge) / 1_800))
        : 0.75 * smoothstep(rise * 1.6);
      // Das Grabfeld liegt südlich vor dem Stein, in dessen Ausrichtung.
      const plotScale = preset.tombstones.plotWidthPx / PLOT_DRAWN_WIDTH_PX;
      const plotOffset = (PLOT_DRAWN_LENGTH_PX * plotScale) / 2 + 3;
      plot.setVisible(plotAlpha > 0.01).setAlpha(plotAlpha)
        .setPosition(stone.x - Math.sin(stone.rotation) * plotOffset, stone.y + Math.cos(stone.rotation) * plotOffset)
        .setRotation(stone.rotation)
        .setScale(plotScale * (0.85 + rise * 0.15));

      if (rise <= 0 || shattered) {
        image.setVisible(false);
        shadow.setVisible(false);
        return;
      }

      // Top-down „Aufsteigen“: aus dem Boden auf die Kamera zu wachsen, mit kurzem Nachwippen.
      const grow = Phaser.Math.Linear(0.42, 1, easeOutBack(rise));
      const wobble = Math.sin(rise * Math.PI * 3.2) * 0.14 * (1 - rise);
      // Beim Aufwühlen zittern die Steine und kippen leicht vom Zentrum weg.
      const trembleAmp = churnProgress * churnProgress * 2.6;
      const trembleX = Math.sin(elapsed * 0.071 + index * 1.7) * trembleAmp;
      const trembleY = Math.cos(elapsed * 0.083 + index * 2.3) * trembleAmp;
      const lean = churnProgress * 0.09 * (index % 2 === 0 ? 1 : -1);
      const height = rise * (1 + churnProgress * 0.15);
      image.setVisible(true)
        .setPosition(stone.x + trembleX, stone.y + trembleY)
        .setRotation(stone.rotation + wobble + lean)
        .setScale(stone.scale * grow)
        .setAlpha(clamp01(rise * 3));
      // Kontaktschatten wächst mit der „Höhe“ nach Südosten.
      shadow.setVisible(true)
        .setPosition(stone.x + trembleX + 2.5 * height, stone.y + trembleY + 3 * height)
        .setRotation(stone.rotation + wobble + lean)
        .setScale(stone.scale * grow * 1.04)
        .setAlpha(0.42 * clamp01(rise * 2));
    });
  }

  private renderFragments(intro: IntroScene, elapsed: number): void {
    const since = elapsed - intro.preset.emergeAtMs;
    const lifetime = intro.preset.shatter.fragmentLifetimeMs;
    const visible = since >= 0 && since <= lifetime;
    intro.fragments.forEach((fragment, index) => {
      const image = this.fragments[index];
      if (!visible) {
        image.setVisible(false);
        return;
      }
      const stone = intro.stones[fragment.stone];
      const seconds = since / 1000;
      // Gebremster Flug (Reibung) plus Höhenbogen über die Skalierung.
      const drag = 3.2;
      const travel = (fragment.speed * (1 - Math.exp(-drag * seconds))) / drag;
      const progress = since / lifetime;
      const hop = Math.sin(Math.min(1, progress * 2.4) * Math.PI) * 0.45;
      image.setVisible(true)
        .setPosition(stone.x + fragment.dirX * travel, stone.y + fragment.dirY * travel)
        .setRotation(fragment.rotation + fragment.spin * (1 - Math.exp(-2.4 * seconds)) / 2.4)
        .setScale(fragment.scale * (1 + hop))
        .setAlpha(1 - smoothstep((progress - 0.55) / 0.45));
    });
  }

  private renderGround(intro: IntroScene, elapsed: number): void {
    const { preset, state } = intro;
    const churnProgress = clamp01((elapsed - preset.churn.startMs) / (preset.emergeAtMs - preset.churn.startMs));
    const since = elapsed - preset.emergeAtMs;
    const fadeOut = since > 0 ? 1 - smoothstep((since - 600) / (preset.durationMs - preset.emergeAtMs - 600)) : 1;
    const size = since > 0
      ? 1.35
      : Phaser.Math.Linear(0.25, 1, smoothstep(churnProgress));
    const alpha = (since > 0 ? 1 : smoothstep(churnProgress * 2.2)) * fadeOut;
    const scale = (preset.churn.radius * 2 * size) / 128;
    this.crater.setVisible(alpha > 0.01).setAlpha(alpha * 0.9).setPosition(state.x, state.y)
      .setScale(scale * (1 + Math.sin(elapsed * 0.02) * 0.03 * churnProgress), scale * 0.9);
  }

  private renderAtmosphere(intro: IntroScene, elapsed: number, now: number): void {
    const { preset, state } = intro;
    const moon = preset.moonlight;
    const emerge = preset.emergeAtMs;
    const fadeIn = smoothstep(elapsed / moon.fadeInMs);
    const fadeOut = 1 - smoothstep((elapsed - emerge - 300) / moon.fadeOutMs);
    const churnProgress = clamp01((elapsed - preset.churn.startMs) / (emerge - preset.churn.startMs));
    // Unruhiges Flackern, sobald die Erde arbeitet – B-Movie-Gewitterstimmung ohne Gewitter.
    const flicker = 1 - churnProgress * (0.1 + 0.1 * Math.sin(elapsed * 0.031) * Math.sin(elapsed * 0.017));
    const moonStrength = fadeIn * fadeOut * flicker;

    this.lighting.setLight(MOON_LIGHT_KEY, 'graveMoonlight', state.x - 30, state.y - 40, {
      radiusPx: moon.radius,
      color: moon.color,
      intensity: moon.intensity * moonStrength,
    });
    // Grünlicher Unterlicht-Schimmer aus dem Grab: wächst mit dem Aufwühlen.
    this.lighting.setLight(RIM_LIGHT_KEY, 'firefly', state.x, state.y, {
      radiusPx: preset.churn.radius * 2.6,
      color: 0x8fd16a,
      intensity: 0.85 * smoothstep(churnProgress * 1.4) * fadeOut,
    });
    this.lightsActive = true;

    // Weicher Mondscheinkegel als sichtbarer Lichtschacht.
    this.moonbeam.setVisible(moonStrength > 0.01).setPosition(state.x - 30, state.y - 40)
      .setTint(moon.color).setAlpha(0.2 * moonStrength).setScale((moon.radius * 1.5) / 64);

    // Bodennebel kriecht über das Gräberfeld.
    for (let index = 0; index < this.mist.length; index += 1) {
      const angle = (index / this.mist.length) * Math.PI * 2 + elapsed * 0.00009 * (index % 2 === 0 ? 1 : -1);
      const radius = 70 + (index * 37) % 90;
      const swell = 1 + churnProgress * 0.35 + Math.sin(elapsed * 0.0011 + index) * 0.08;
      this.mist[index].setVisible(fadeIn * fadeOut > 0.01)
        .setPosition(state.x + Math.cos(angle) * radius, state.y + Math.sin(angle) * radius * 0.75)
        .setTint(0xb8cbe8)
        .setAlpha(0.11 * fadeIn * fadeOut * (0.7 + churnProgress * 0.5))
        .setScale((2.4 + (index % 3) * 0.5) * swell);
    }

    // Glühwürmchen umkreisen den Friedhof und stieben beim Durchbruch davon.
    const fly = preset.fireflies;
    let lightIndex = 0;
    intro.fireflies.forEach((firefly, index) => {
      const image = this.fireflies[index];
      const appear = smoothstep((elapsed - fly.startMs - firefly.delayMs) / 700);
      const scatter = Math.max(0, elapsed - emerge) / 1000;
      const scatterFade = 1 - smoothstep(scatter / 1.2);
      const strength = appear * scatterFade;
      if (strength <= 0.01) {
        image.setVisible(false);
        this.lighting.releaseLight(`bossIntro:firefly:${index}`, { immediate: true });
        return;
      }
      const seconds = elapsed / 1000;
      const angle = firefly.phase + seconds * firefly.angularSpeed * (1 + scatter * 3);
      const radius = firefly.radius * (1 + scatter * 1.8) + Math.sin(seconds * 2.1 + firefly.phase) * firefly.wobble;
      const x = state.x + Math.cos(angle) * radius;
      const y = state.y + Math.sin(angle) * radius * 0.8;
      const pulse = 0.55 + 0.45 * Math.sin(seconds * Math.PI * 2 * firefly.pulseHz + firefly.phase);
      image.setVisible(true).setPosition(x, y).setTint(fly.color)
        .setAlpha(strength * (0.35 + pulse * 0.65))
        .setScale((FIREFLY_HALO_RADIUS_PX * 2) / 64);
      if (lightIndex < FIREFLY_LIGHT_COUNT && index % 2 === 0) {
        this.lighting.setLight(`bossIntro:firefly:${index}`, 'firefly', x, y, {
          radiusPx: 70,
          intensity: 0.5 * strength * pulse,
        });
        lightIndex += 1;
      }
    });
    void now;
  }

  private renderCamera(intro: IntroScene, elapsed: number): void {
    const camera = intro.preset.camera;
    const holdUntil = intro.preset.emergeAtMs + camera.holdAfterEmergeMs;
    const weight = elapsed <= holdUntil
      ? smoothstep(elapsed / camera.panInMs)
      : 1 - smoothstep((elapsed - holdUntil) / camera.panOutMs);
    setCameraFocusOverride(this.scene, intro.state.x, intro.state.y, weight);

    const churnProgress = clamp01((elapsed - intro.preset.churn.startMs) / (intro.preset.emergeAtMs - intro.preset.churn.startMs));
    if (churnProgress > 0 && elapsed < intro.preset.emergeAtMs) {
      this.cameraFeedback?.request(sustainedRumble(
        RUMBLE_ID,
        intro.preset.churn.rumbleAmplitudePx * (0.25 + churnProgress * churnProgress * 0.75),
        CAMERA_FEEDBACK_PRIORITY.telegraph,
        { sourceX: intro.state.x, sourceY: intro.state.y, frequencyHz: 7 + churnProgress * 6, durationMs: 250 },
      ));
    }
  }

  private fireOneShots(intro: IntroScene, elapsed: number): void {
    const crossed = (atMs: number): boolean => intro.lastElapsedMs < atMs && elapsed >= atMs
      && elapsed - atMs <= ONE_SHOT_STALE_MS;
    const { state, preset } = intro;

    intro.stones.forEach((stone) => {
      if (!crossed(stone.riseAtMs)) return;
      this.burrowGpu.playExit(stone.x, stone.y);
      this.cameraFeedback?.request(impactLight({ sourceX: stone.x, sourceY: stone.y }));
      this.audio?.playSound('sfx_burrowed', stone.x, stone.y, undefined, 0.55);
    });
    for (const event of intro.churnEvents) {
      if (crossed(event.atMs)) this.burrowGpu.playExit(event.x, event.y);
    }
    if (crossed(preset.churn.startMs)) this.audio?.playSound('sfx_burrowed', state.x, state.y, undefined, 0.9);
    if (crossed(preset.emergeAtMs)) {
      this.cameraFeedback?.release(RUMBLE_ID, 80);
      this.cameraFeedback?.request(impactExceptional({ sourceX: state.x, sourceY: state.y }));
      this.burrowGpu.playShockwave(state.x, state.y, preset.shatter.shockwaveRadius);
      this.burrowGpu.playExit(state.x, state.y);
      for (const stone of intro.stones) this.burrowGpu.playExit(stone.x, stone.y);
      this.lighting.pulse('teleportFlash', state.x, state.y, { radiusPx: 320, intensity: 1.1, color: 0xd6ffc4, durationMs: 520 });
    }
  }

  // ── Helfer ────────────────────────────────────────────────────────────────

  private releaseLights(): void {
    if (!this.lightsActive) return;
    this.lighting.releaseLight(MOON_LIGHT_KEY);
    this.lighting.releaseLight(RIM_LIGHT_KEY);
    for (let index = 0; index < this.fireflies.length; index += 1) {
      this.lighting.releaseLight(`bossIntro:firefly:${index}`, { immediate: true });
    }
    this.lightsActive = false;
  }

  private tombTexture(variant: number): string {
    const sprite = TOMBSTONE_SPRITE_KEYS[variant % 4];
    return this.scene.textures.exists(sprite) ? sprite : TEX_TOMB_FALLBACK[variant % 4];
  }

  private fragmentTexture(variant: number): string {
    const sprite = FRAGMENT_SPRITE_KEYS[variant % 4];
    return this.scene.textures.exists(sprite) ? sprite : TEX_FRAGMENT_FALLBACK[variant % 4];
  }

  private createImage(texture: string): Phaser.GameObjects.Image {
    const image = this.scene.add.image(0, 0, texture).setVisible(false);
    registerGraphicsObject(this.scene, 'bossIntro', image);
    return image;
  }

  private ensurePool(pool: Phaser.GameObjects.Image[], count: number, create: () => Phaser.GameObjects.Image): void {
    while (pool.length < count) pool.push(create());
  }

  private ensureTextures(): void {
    const textures = this.scene.textures;
    TEX_TOMB_FALLBACK.forEach((key, variant) => {
      ensureCanvasTexture(textures, key, TOMB_TEXTURE_PX, TOMB_TEXTURE_PX, (ctx) => drawTombstone(ctx, variant));
    });
    TEX_FRAGMENT_FALLBACK.forEach((key, variant) => {
      ensureCanvasTexture(textures, key, FRAGMENT_TEXTURE_PX, FRAGMENT_TEXTURE_PX, (ctx) => drawFragment(ctx, variant));
    });
    ensureCanvasTexture(textures, TEX_PLOT, 64, 96, drawGravePlot);
    ensureCanvasTexture(textures, TEX_SHADOW, 8, 8, (ctx) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 8); });
    ensureCanvasTexture(textures, TEX_CRATER, 128, 128, drawCrater);
    ensureCanvasTexture(textures, TEX_GLOW, 128, 128, (ctx) => {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.18, 'rgba(255,255,255,0.75)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    });
    // Kleiner heller Leib (≈ Ambient-Insekt) mit schwachem Halo.
    ensureCanvasTexture(textures, TEX_FIREFLY, 64, 64, (ctx) => {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.06, 'rgba(255,255,255,0.95)');
      gradient.addColorStop(0.12, 'rgba(255,255,255,0.32)');
      gradient.addColorStop(0.4, 'rgba(255,255,255,0.08)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    });
    ensureCanvasTexture(textures, TEX_MIST, 64, 64, (ctx) => {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.6, 'rgba(255,255,255,0.35)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    });
  }
}

// ── Prozedurale Ersatzgrafik (bis authored Sprites vorliegen) ───────────────

type Ctx = CanvasRenderingContext2D;

function stoneFill(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, '#b9bcb4');
  gradient.addColorStop(0.45, '#8d918a');
  gradient.addColorStop(1, '#5c605b');
  return gradient;
}

function speckle(ctx: Ctx, seed: number, count: number, area: { x: number; y: number; w: number; h: number }): void {
  const random = createRandom(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let index = 0; index < count; index += 1) {
    const moss = random() < 0.45;
    ctx.fillStyle = moss
      ? `rgba(${70 + random() * 30},${95 + random() * 30},${55 + random() * 20},${0.35 + random() * 0.35})`
      : `rgba(${40 + random() * 40},${40 + random() * 40},${40 + random() * 40},${0.15 + random() * 0.25})`;
    const radius = moss ? 1.5 + random() * 4 : 0.6 + random() * 1.6;
    ctx.beginPath();
    ctx.arc(area.x + random() * area.w, area.y + random() * area.h, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function crack(ctx: Ctx, points: readonly [number, number][]): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = 'rgba(30,32,30,0.75)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
  ctx.restore();
}

function outline(ctx: Ctx): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(28,30,28,0.85)';
  ctx.stroke();
}

function roundedRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Grabsteine in 90°-Draufsicht; Varianten 1 und 2 stehen schief und zeigen verkürzt ihre Front. */
function drawTombstone(ctx: Ctx, variant: number): void {
  const c = TOMB_TEXTURE_PX / 2;
  ctx.clearRect(0, 0, TOMB_TEXTURE_PX, TOMB_TEXTURE_PX);
  switch (variant) {
    case 0: {
      // Aufrechte Grabplatte: Oberkante mit Sockel.
      roundedRectPath(ctx, c - 46, c - 4, 92, 30, 6);
      ctx.fillStyle = '#4d504b';
      ctx.fill();
      outline(ctx);
      roundedRectPath(ctx, c - 38, c - 12, 76, 26, 13);
      ctx.fillStyle = stoneFill(ctx, c - 38, c - 12, c + 38, c + 14);
      ctx.fill();
      outline(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(c - 30, c - 9, 56, 3);
      speckle(ctx, 11, 26, { x: c - 38, y: c - 12, w: 76, h: 26 });
      crack(ctx, [[c + 8, c - 12], [c + 4, c - 2], [c + 11, c + 6]]);
      break;
    }
    case 1: {
      // Schiefes Steinkreuz.
      ctx.beginPath();
      ctx.moveTo(c - 8, c - 44); ctx.lineTo(c + 8, c - 44); ctx.lineTo(c + 8, c - 22);
      ctx.lineTo(c + 30, c - 22); ctx.lineTo(c + 30, c - 8); ctx.lineTo(c + 8, c - 8);
      ctx.lineTo(c + 9, c + 34); ctx.lineTo(c - 9, c + 34); ctx.lineTo(c - 8, c - 8);
      ctx.lineTo(c - 30, c - 8); ctx.lineTo(c - 30, c - 22); ctx.lineTo(c - 8, c - 22);
      ctx.closePath();
      ctx.fillStyle = stoneFill(ctx, c - 30, c - 44, c + 30, c + 34);
      ctx.fill();
      outline(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(c - 6, c - 42, 3, 70);
      ctx.fillRect(c - 28, c - 20, 52, 3);
      speckle(ctx, 23, 22, { x: c - 30, y: c - 44, w: 60, h: 78 });
      roundedRectPath(ctx, c - 16, c + 30, 32, 12, 4);
      ctx.fillStyle = '#4a4d48';
      ctx.fill();
      outline(ctx);
      break;
    }
    case 2: {
      // Gekippter Rundbogenstein mit eingeritzter Inschriftzeile.
      ctx.beginPath();
      ctx.moveTo(c - 30, c + 30);
      ctx.lineTo(c - 30, c - 14);
      ctx.ellipse(c, c - 14, 30, 26, 0, Math.PI, 0);
      ctx.lineTo(c + 30, c + 30);
      ctx.closePath();
      ctx.fillStyle = stoneFill(ctx, c - 30, c - 40, c + 30, c + 30);
      ctx.fill();
      outline(ctx);
      ctx.strokeStyle = 'rgba(35,38,35,0.6)';
      ctx.lineWidth = 2.5;
      for (const y of [c - 6, c + 4, c + 13]) {
        ctx.beginPath(); ctx.moveTo(c - 17, y); ctx.lineTo(c + 17, y); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(c, c - 30); ctx.lineTo(c, c - 18); ctx.moveTo(c - 6, c - 25); ctx.lineTo(c + 6, c - 25); ctx.stroke();
      speckle(ctx, 37, 34, { x: c - 30, y: c - 40, w: 60, h: 70 });
      crack(ctx, [[c - 30, c + 2], [c - 18, c + 8], [c - 22, c + 18], [c - 12, c + 26]]);
      break;
    }
    default: {
      // Kleiner Obelisk von oben: Pyramidenspitze mit vier unterschiedlich hellen Flächen.
      const s = 30;
      ctx.fillStyle = '#474a45';
      ctx.fillRect(c - s - 6, c - s - 6, (s + 6) * 2, (s + 6) * 2);
      ctx.beginPath(); ctx.rect(c - s - 6, c - s - 6, (s + 6) * 2, (s + 6) * 2); outline(ctx);
      const faces: [number, number, number, number, string][] = [
        [c - s, c - s, c + s, c - s, '#c4c7bf'],
        [c + s, c - s, c + s, c + s, '#8a8e87'],
        [c + s, c + s, c - s, c + s, '#5d615c'],
        [c - s, c + s, c - s, c - s, '#a5a9a1'],
      ];
      for (const [x0, y0, x1, y1, color] of faces) {
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(c, c); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
      }
      ctx.beginPath(); ctx.rect(c - s, c - s, s * 2, s * 2); outline(ctx);
      ctx.strokeStyle = 'rgba(30,32,30,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c - s, c - s); ctx.lineTo(c + s, c + s); ctx.moveTo(c + s, c - s); ctx.lineTo(c - s, c + s); ctx.stroke();
      speckle(ctx, 53, 24, { x: c - s - 6, y: c - s - 6, w: (s + 6) * 2, h: (s + 6) * 2 });
      break;
    }
  }
}

function drawFragment(ctx: Ctx, variant: number): void {
  const random = createRandom(101 + variant * 17);
  const c = FRAGMENT_TEXTURE_PX / 2;
  const corners = 5 + (variant % 3);
  ctx.beginPath();
  for (let index = 0; index < corners; index += 1) {
    const angle = (index / corners) * Math.PI * 2 + random() * 0.5;
    const radius = 10 + random() * 11;
    const x = c + Math.cos(angle) * radius;
    const y = c + Math.sin(angle) * radius * (0.7 + random() * 0.3);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = stoneFill(ctx, c - 20, c - 20, c + 20, c + 20);
  ctx.fill();
  outline(ctx);
  speckle(ctx, 211 + variant, 8, { x: c - 20, y: c - 20, w: 40, h: 40 });
}

/** Aufgeworfenes Grabfeld: dunkle, lockere Erde mit Klumpen. */
function drawGravePlot(ctx: Ctx): void {
  const random = createRandom(7);
  roundedRectPath(ctx, 10, 8, 44, 80, 14);
  const gradient = ctx.createLinearGradient(10, 8, 54, 88);
  gradient.addColorStop(0, '#4a3a2b');
  gradient.addColorStop(1, '#2b2119');
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let index = 0; index < 60; index += 1) {
    ctx.fillStyle = random() < 0.5 ? 'rgba(110,88,64,0.55)' : 'rgba(18,13,9,0.5)';
    ctx.beginPath();
    ctx.arc(10 + random() * 44, 8 + random() * 80, 1 + random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(20,14,10,0.7)';
  ctx.lineWidth = 2;
  roundedRectPath(ctx, 10, 8, 44, 80, 14);
  ctx.stroke();
}

/** Aufgewühlter Erdtrichter, aus dem der Titan bricht. */
function drawCrater(ctx: Ctx): void {
  const random = createRandom(29);
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(12,9,7,0.95)');
  gradient.addColorStop(0.45, 'rgba(46,34,24,0.9)');
  gradient.addColorStop(0.8, 'rgba(84,64,44,0.55)');
  gradient.addColorStop(1, 'rgba(84,64,44,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2;
    const radius = 50 + random() * 12;
    const x = 64 + Math.cos(angle) * radius;
    const y = 64 + Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  for (let index = 0; index < 40; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 20 + random() * 40;
    ctx.fillStyle = random() < 0.5 ? 'rgba(120,96,70,0.6)' : 'rgba(20,15,10,0.6)';
    ctx.beginPath();
    ctx.arc(64 + Math.cos(angle) * radius, 64 + Math.sin(angle) * radius, 1.5 + random() * 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
