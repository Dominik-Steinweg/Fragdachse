import * as Phaser from 'phaser';
import {
  DEPTH_LIGHTING,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '../config';
import { ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';
import type { LightOccluderIndex } from './LightOccluderIndex';
import {
  DEFAULT_LIGHT_PROFILE_ID,
  LIGHTING_PROFILES,
  LIGHTMAP_SCALE,
  LIGHT_PRESETS,
  MAX_LIGHTS_PER_FRAME,
  MAX_OCCLUDING_LIGHTS_PER_FRAME,
  MAX_OCCLUDING_LIGHT_RADIUS,
  OCCLUDER_SCRATCH_SIZE,
  SHADOW_EXTEND_FACTOR,
  resolvePresetOverride,
  type LightPreset,
  type LightPresetKey,
  type LightProfileId,
} from './LightingConfig';
import {
  ShadowQuadBuffer,
  SHADOW_QUAD_STRIDE,
  projectCircleShadowQuad,
  projectRectShadowQuads,
} from './lightShadowGeometry';

const TEX_LIGHT_RADIAL = '__light_radial';
const RADIAL_TEX_SIZE = 256;
const CONE_TEX_WIDTH = 256;
const CONE_TEX_HEIGHT = 512;

/** Ausblendzeit, wenn ein Dauerlicht freigegeben wird – verhindert hartes Poppen. */
const RELEASE_FADE_MS = 140;
/**
 * Sicherheitsnetz gegen Lecks: ein Dauerlicht, das mehrere Frames lang nicht mehr
 * per `setLight` bestätigt wurde, gilt als verwaist. Alle Quellen aktualisieren ihre
 * Lichter pro Frame, der Schwellwert liegt also weit über dem Normalfall.
 */
const KEYED_LIGHT_STALE_MS = 400;

interface ActiveLight {
  key: string | null;
  shape: 'radial' | 'cone';
  x: number;
  y: number;
  radiusPx: number;
  color: number;
  intensity: number;
  angle: number;
  coneAngle: number;
  occludes: boolean;
  priority: number;
  flickerAmount: number;
  flickerHz: number;
  flickerPhase: number;
  /** 0 = Dauerlicht, sonst Abklingdauer ab `bornAt`. */
  durationMs: number;
  decayExponent: number;
  bornAt: number;
  touchedAt: number;
  releasedAt: number;
  /** Pro Frame neu berechnet: Intensität inklusive Profil, Abkling- und Flackerterm. */
  effectiveIntensity: number;
}

export interface LightOverrides {
  radiusPx?: number;
  color?: number;
  intensity?: number;
  angle?: number;
  durationMs?: number;
  occludes?: boolean;
}

interface OccluderSlot {
  readonly renderTexture: Phaser.GameObjects.RenderTexture;
  readonly image: Phaser.GameObjects.Image;
  readonly graphics: Phaser.GameObjects.Graphics;
}

/**
 * Dynamische Beleuchtung und Lichtverdeckung über eine Lightmap.
 *
 * Alle Lichter werden in eine halbauflösende Bildschirm-Lightmap komponiert, die als
 * ein einziges Overlay über die Welt gelegt wird. Dadurch werden Spieler, Gegner und
 * Effekte ohne Per-Objekt-Kosten beleuchtet – anders als bei Phasers eingebautem
 * Lighting, das `setLighting(true)` pro Objekt braucht, Render-Batches bricht und
 * keinerlei geometrische Verdeckung kennt.
 *
 * Tag und Nacht nutzen denselben Pfad und unterscheiden sich nur im Profil:
 * Tag füllt die Lightmap schwarz und komponiert additiv (nur Zusatzlicht),
 * Nacht füllt sie dunkel und komponiert multiplikativ (Grunddunkelheit).
 *
 * Verdeckende Lichter werden einzeln in eine eigene Scratch-RenderTexture gezeichnet,
 * dort um ihre Schattenpolygone erleichtert und anschließend additiv in die Lightmap
 * kopiert. Die Scratch-Texturen liegen als `renderMode: 'redraw'` knapp unter der
 * Lightmap in der Display-List – so ist garantiert, dass ihre Command-Buffer geleert
 * sind, bevor die Lightmap ihre eigenen Zeichenbefehle ausführt.
 */
export class LightingSystem {
  private profileId: LightProfileId = DEFAULT_LIGHT_PROFILE_ID;
  private profile = LIGHTING_PROFILES[DEFAULT_LIGHT_PROFILE_ID];

  private lightMap: Phaser.GameObjects.RenderTexture | null = null;
  private readonly slots: OccluderSlot[] = [];

  private readonly lights: ActiveLight[] = [];
  private readonly pool: ActiveLight[] = [];
  private readonly keyed = new Map<string, ActiveLight>();
  private readonly renderQueue: ActiveLight[] = [];

  private occluders: LightOccluderIndex | null = null;
  private readonly shadowQuads = new ShadowQuadBuffer();
  private readonly coneTextureKeys = new Map<number, string>();

  private enabled = false;
  private lastCostMs = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureTextures();
  }

  // ── Lebenszyklus ───────────────────────────────────────────────────────────

  /** Schaltet die Beleuchtung an (Rundenstart) oder aus (Lobby, Teardown). */
  setActive(active: boolean): void {
    if (this.enabled === active) return;
    this.enabled = active;
    if (!active) this.clear();
    this.syncOverlayVisibility();
  }

  setOccluderIndex(index: LightOccluderIndex | null): void {
    this.occluders = index;
  }

  setProfile(profileId: LightProfileId): void {
    if (this.profileId === profileId) return;
    this.profileId = profileId;
    this.profile = LIGHTING_PROFILES[profileId];
    this.lightMap?.setBlendMode(this.profile.compositeBlendMode);
    this.syncOverlayVisibility();
  }

  getProfileId(): LightProfileId {
    return this.profileId;
  }

  isFlashlightEnabled(): boolean {
    return this.enabled && this.profile.flashlightEnabled;
  }

  toggleProfile(): LightProfileId {
    this.setProfile(this.profileId === 'night' ? 'day' : 'night');
    return this.profileId;
  }

  getLastUpdateCostMs(): number {
    return this.lastCostMs;
  }

  /** Gibt alle Lichter frei, ohne die Texturen zu zerstören. */
  clear(): void {
    for (const light of this.lights) this.pool.push(light);
    this.lights.length = 0;
    this.keyed.clear();
    this.syncOverlayVisibility();
  }

  destroy(): void {
    this.clear();
    this.lightMap?.destroy();
    this.lightMap = null;
    for (const slot of this.slots) {
      slot.renderTexture.destroy();
      slot.image.destroy();
      slot.graphics.destroy();
    }
    this.slots.length = 0;
  }

  // ── Lichtquellen ───────────────────────────────────────────────────────────

  /** Einmalimpuls mit eigener Abklingdauer (Mündungsfeuer, Explosion, Aufschlag). */
  pulse(presetKey: LightPresetKey, x: number, y: number, overrides?: LightOverrides): void {
    const preset = LIGHT_PRESETS[presetKey] as LightPreset;
    if (!this.enabled || !preset.enabled) return;

    const light = this.acquire();
    this.applyPreset(light, preset, x, y, overrides);
    light.key = null;
    light.flickerPhase = Math.random() * Math.PI * 2;
    this.lights.push(light);
  }

  /**
   * Dauerlicht, dessen Lebenszeit die aufrufende Quelle verwaltet. Pro Frame erneut
   * aufrufen; `releaseLight(key)` beendet es. Die Quellen bringen ihren Lebenszyklus
   * bereits mit (`Map<id, visual>` plus `destroyVisual`), es entsteht kein zweiter.
   */
  setLight(
    key: string,
    presetKey: LightPresetKey,
    x: number,
    y: number,
    overrides?: LightOverrides,
  ): void {
    const preset = LIGHT_PRESETS[presetKey] as LightPreset;
    if (!this.enabled || !preset.enabled) {
      this.releaseLight(key);
      return;
    }

    let light = this.keyed.get(key);
    if (!light) {
      light = this.acquire();
      light.flickerPhase = hashToPhase(key);
      this.lights.push(light);
      this.keyed.set(key, light);
    }
    const bornAt = light.key === key ? light.bornAt : this.now();
    this.applyPreset(light, preset, x, y, overrides);
    light.key = key;
    light.bornAt = bornAt;
    light.durationMs = 0;
    light.releasedAt = 0;
  }

  releaseLight(key: string): void {
    const light = this.keyed.get(key);
    if (!light || light.releasedAt > 0) return;
    light.releasedAt = this.now();
  }

  // ── Frame-Update ───────────────────────────────────────────────────────────

  update(): void {
    const startMs = performance.now();
    const now = this.now();

    this.expireLights(now);

    if (!this.enabled) {
      this.lastCostMs = performance.now() - startMs;
      return;
    }

    const overlay = this.ensureLightMap();
    const scrollX = this.scene.cameras.main.scrollX;
    const scrollY = this.scene.cameras.main.scrollY;

    this.collectRenderQueue(now, scrollX, scrollY);

    if (this.profileId === 'day' && this.renderQueue.length === 0) {
      // Reines Tageslicht ohne aktive Lichtquelle: kein Renderpass, kein Overlay.
      overlay.setVisible(false);
      this.lastCostMs = performance.now() - startMs;
      return;
    }
    overlay.setVisible(true);

    overlay.fill(this.profile.ambientColor, 1);

    let occludingUsed = 0;
    for (const light of this.renderQueue) {
      const useOcclusion = light.occludes
        && this.occluders !== null
        && occludingUsed < MAX_OCCLUDING_LIGHTS_PER_FRAME
        && occludingUsed < this.slots.length;

      if (useOcclusion) {
        this.renderOccludingLight(light, this.slots[occludingUsed], scrollX, scrollY);
        occludingUsed += 1;
      } else {
        // Überzählige verdeckende Lichter fallen weich auf den einfachen Pfad zurück:
        // weniger Schatten statt fehlendem Licht.
        this.stampLight(overlay, light, (light.x - scrollX) * LIGHTMAP_SCALE, (light.y - scrollY) * LIGHTMAP_SCALE);
      }
    }

    this.lastCostMs = performance.now() - startMs;
  }

  // ── Intern: Lichtverwaltung ────────────────────────────────────────────────

  private now(): number {
    return this.scene.time.now;
  }

  private acquire(): ActiveLight {
    const light = this.pool.pop();
    if (light) return light;
    return {
      key: null,
      shape: 'radial',
      x: 0,
      y: 0,
      radiusPx: 0,
      color: 0xffffff,
      intensity: 1,
      angle: 0,
      coneAngle: 0,
      occludes: false,
      priority: 0,
      flickerAmount: 0,
      flickerHz: 0,
      flickerPhase: 0,
      durationMs: 0,
      decayExponent: 1,
      bornAt: 0,
      touchedAt: 0,
      releasedAt: 0,
      effectiveIntensity: 0,
    };
  }

  private applyPreset(
    light: ActiveLight,
    preset: LightPreset,
    x: number,
    y: number,
    overrides?: LightOverrides,
  ): void {
    const profileOverride = resolvePresetOverride(preset, this.profileId);
    const now = this.now();

    light.shape = preset.shape;
    light.x = x;
    light.y = y;
    light.radiusPx = (overrides?.radiusPx ?? preset.radiusPx) * (profileOverride?.radiusMult ?? 1);
    light.color = overrides?.color ?? preset.color;
    light.intensity = (overrides?.intensity ?? preset.intensity)
      * (profileOverride?.intensityMult ?? 1)
      * this.profile.lightIntensityMult;
    light.angle = overrides?.angle ?? 0;
    light.coneAngle = preset.coneAngle ?? Math.PI * 0.5;
    light.occludes = overrides?.occludes ?? preset.occludes;
    light.priority = preset.priority;
    light.flickerAmount = preset.flickerAmount;
    light.flickerHz = preset.flickerHz;
    light.durationMs = overrides?.durationMs ?? preset.durationMs;
    light.decayExponent = preset.decayExponent;
    light.bornAt = now;
    light.touchedAt = now;
    light.releasedAt = 0;

    // Verdeckende Lichter müssen in die Scratch-Textur passen.
    if (light.occludes && light.radiusPx > MAX_OCCLUDING_LIGHT_RADIUS) {
      light.radiusPx = MAX_OCCLUDING_LIGHT_RADIUS;
    }
  }

  private expireLights(now: number): void {
    for (let index = this.lights.length - 1; index >= 0; index -= 1) {
      const light = this.lights[index];
      let expired = false;

      if (light.key === null) {
        expired = now - light.bornAt >= light.durationMs;
      } else if (light.releasedAt > 0) {
        expired = now - light.releasedAt >= RELEASE_FADE_MS;
      } else if (now - light.touchedAt > KEYED_LIGHT_STALE_MS) {
        expired = true;
      }

      if (!expired) continue;
      if (light.key !== null) this.keyed.delete(light.key);
      this.lights[index] = this.lights[this.lights.length - 1];
      this.lights.pop();
      this.pool.push(light);
    }
  }

  /** Wählt die sichtbaren Lichter aus, berechnet ihre Intensität und sortiert sie. */
  private collectRenderQueue(now: number, scrollX: number, scrollY: number): void {
    this.renderQueue.length = 0;

    for (const light of this.lights) {
      let fade = 1;
      if (light.key === null && light.durationMs > 0) {
        const progress = Phaser.Math.Clamp((now - light.bornAt) / light.durationMs, 0, 1);
        fade = Math.pow(1 - progress, light.decayExponent);
      } else if (light.releasedAt > 0) {
        fade = Phaser.Math.Clamp(1 - (now - light.releasedAt) / RELEASE_FADE_MS, 0, 1);
      }

      let intensity = light.intensity * fade;
      if (light.flickerAmount > 0) {
        const wave = Math.sin(now * 0.001 * Math.PI * 2 * light.flickerHz + light.flickerPhase);
        intensity *= 1 + light.flickerAmount * wave;
      }
      light.effectiveIntensity = Phaser.Math.Clamp(intensity, 0, 1);
      if (light.effectiveIntensity <= 0.004) continue;

      const screenX = light.x - scrollX;
      const screenY = light.y - scrollY;
      const reach = light.radiusPx;
      if (screenX + reach < 0 || screenX - reach > GAME_WIDTH) continue;
      if (screenY + reach < 0 || screenY - reach > GAME_HEIGHT) continue;

      this.renderQueue.push(light);
    }

    // Verdeckende Lichter zuerst, damit sie die Scratch-Slots bekommen; innerhalb
    // gleicher Priorität gewinnt das hellere Licht.
    this.renderQueue.sort(compareLightImportance);
    if (this.renderQueue.length > MAX_LIGHTS_PER_FRAME) {
      this.renderQueue.length = MAX_LIGHTS_PER_FRAME;
    }
  }

  // ── Intern: Zeichnen ───────────────────────────────────────────────────────

  private stampLight(
    target: Phaser.GameObjects.RenderTexture,
    light: ActiveLight,
    x: number,
    y: number,
  ): void {
    const radiusLm = light.radiusPx * LIGHTMAP_SCALE;
    if (light.shape === 'cone') {
      target.stamp(this.ensureConeTexture(light.coneAngle), undefined, x, y, {
        alpha: light.effectiveIntensity,
        tint: light.color,
        rotation: light.angle,
        scale: radiusLm / CONE_TEX_WIDTH,
        originX: 0,
        originY: 0.5,
        blendMode: Phaser.BlendModes.ADD,
      });
      return;
    }

    target.stamp(TEX_LIGHT_RADIAL, undefined, x, y, {
      alpha: light.effectiveIntensity,
      tint: light.color,
      scale: radiusLm / (RADIAL_TEX_SIZE * 0.5),
      blendMode: Phaser.BlendModes.ADD,
    });
  }

  private renderOccludingLight(
    light: ActiveLight,
    slot: OccluderSlot,
    scrollX: number,
    scrollY: number,
  ): void {
    const center = OCCLUDER_SCRATCH_SIZE * 0.5;

    slot.renderTexture.clear();
    this.stampLight(slot.renderTexture, light, center, center);

    this.buildShadowGraphics(light, slot.graphics, center);
    slot.renderTexture.erase([slot.graphics]);

    slot.image.setPosition(
      (light.x - scrollX) * LIGHTMAP_SCALE,
      (light.y - scrollY) * LIGHTMAP_SCALE,
    );
    this.lightMap?.draw([slot.image]);
  }

  /** Zeichnet die Schattenpolygone einer Lichtquelle in Scratch-Koordinaten. */
  private buildShadowGraphics(
    light: ActiveLight,
    graphics: Phaser.GameObjects.Graphics,
    center: number,
  ): void {
    graphics.clear();
    const index = this.occluders;
    if (!index) return;

    const quads = this.shadowQuads;
    quads.reset();
    const extendPx = light.radiusPx * SHADOW_EXTEND_FACTOR;

    index.queryCircle(
      light.x,
      light.y,
      light.radiusPx,
      (left, top, right, bottom) => {
        projectRectShadowQuads(quads, light.x, light.y, left, top, right, bottom, extendPx);
      },
      (centerX, centerY, radius) => {
        projectCircleShadowQuad(quads, light.x, light.y, centerX, centerY, radius, extendPx);
      },
    );

    if (quads.length === 0) return;

    graphics.fillStyle(0xffffff, 1);
    const data = quads.data;
    for (let quad = 0; quad < quads.length; quad += 1) {
      const offset = quad * SHADOW_QUAD_STRIDE;
      graphics.beginPath();
      graphics.moveTo(
        (data[offset] - light.x) * LIGHTMAP_SCALE + center,
        (data[offset + 1] - light.y) * LIGHTMAP_SCALE + center,
      );
      for (let point = 1; point < 4; point += 1) {
        graphics.lineTo(
          (data[offset + point * 2] - light.x) * LIGHTMAP_SCALE + center,
          (data[offset + point * 2 + 1] - light.y) * LIGHTMAP_SCALE + center,
        );
      }
      graphics.closePath();
      graphics.fillPath();
    }
  }

  // ── Intern: Ressourcen ─────────────────────────────────────────────────────

  private syncOverlayVisibility(): void {
    if (!this.lightMap) return;
    this.lightMap.setVisible(this.enabled && this.profileId !== 'day');
  }

  private ensureLightMap(): Phaser.GameObjects.RenderTexture {
    if (this.lightMap) return this.lightMap;

    const width = Math.ceil(GAME_WIDTH * LIGHTMAP_SCALE);
    const height = Math.ceil(GAME_HEIGHT * LIGHTMAP_SCALE);

    // Scratch-Slots liegen knapp unter der Lightmap: die Display-List-Reihenfolge
    // garantiert, dass ihre Command-Buffer vor dem der Lightmap ausgeführt werden.
    for (let slot = 0; slot < MAX_OCCLUDING_LIGHTS_PER_FRAME; slot += 1) {
      this.slots.push(this.createOccluderSlot(slot));
    }

    const lightMap = this.scene.add.renderTexture(0, 0, width, height)
      .setOrigin(0, 0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setScrollFactor(0)
      .setDepth(DEPTH_LIGHTING)
      .setBlendMode(this.profile.compositeBlendMode);
    lightMap.setRenderMode('all');
    this.lightMap = lightMap;
    this.syncOverlayVisibility();
    return lightMap;
  }

  private createOccluderSlot(slotIndex: number): OccluderSlot {
    const renderTexture = this.scene.add
      .renderTexture(0, 0, OCCLUDER_SCRATCH_SIZE, OCCLUDER_SCRATCH_SIZE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_LIGHTING - 0.01 + slotIndex * 0.001);
    // 'redraw': der Command-Buffer wird an dieser Stelle der Display-List geleert,
    // die Textur selbst aber nicht gezeichnet.
    renderTexture.setRenderMode('redraw');

    // Bewusst nicht in der Display-List: beide Objekte werden ausschließlich als
    // Zeichenquelle an `DynamicTexture.draw()`/`erase()` übergeben.
    const image = new Phaser.GameObjects.Image(this.scene, 0, 0, renderTexture.texture.key)
      .setOrigin(0.5, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);

    const graphics = this.scene.make.graphics({}, false);

    return { renderTexture, image, graphics };
  }

  private ensureTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_LIGHT_RADIAL, RADIAL_TEX_SIZE, [
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.5625)'],
      [0.5, 'rgba(255,255,255,0.25)'],
      [0.75, 'rgba(255,255,255,0.0625)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }

  /**
   * Kegeltextur mit Apex links auf halber Höhe und Strahl nach +X. Der Öffnungswinkel
   * ist eingebacken, deshalb eine Textur pro verwendetem Winkel.
   *
   * Bewusst mit Canvas-Zeichenoperationen statt per `putImageData` aufgebaut: Phasers
   * ADD-Blend verwendet `funcSrc = gl.ONE`, addiert die Quellfarbe also ungewichtet und
   * setzt damit vormultipliziertes Alpha voraus. Ein per `putImageData` geschriebenes
   * `RGB = 255` bei `A = 0` würde außerhalb des Kegels über die gesamte Texturfläche
   * mitleuchten. Beim Zeichnen bleiben unberührte Pixel dagegen vollständig leer.
   *
   * Der weiche Rand entsteht durch gestapelte Keile von außen nach innen: der innerste
   * Bereich sammelt alle Schichten, der äußerste nur eine. Er bleibt bewusst schmal –
   * ein breiter Saum liest sich am Strahlende als flächiger Schein statt als Kegel.
   *
   * Kein Nahfeld-Glow in der Textur: der wäre eine Halbscheibe und würde an der
   * Spielerlinie hart abbrechen. Dafür gibt es das omnidirektionale Preset
   * `flashlightSpill`.
   */
  private ensureConeTexture(coneAngle: number): string {
    const angleKey = Math.round(coneAngle * 1000);
    const existing = this.coneTextureKeys.get(angleKey);
    if (existing) return existing;

    const key = `__light_cone_${angleKey}`;
    const halfAngle = coneAngle * 0.5;
    const apexY = CONE_TEX_HEIGHT * 0.5;
    const range = CONE_TEX_WIDTH;
    const edgeStart = halfAngle * 0.7;
    const edgeSteps = 12;

    ensureCanvasTexture(this.scene.textures, key, CONE_TEX_WIDTH, CONE_TEX_HEIGHT, (ctx) => {
      // Gleiche Abstandskurve wie die runde Lichttextur: (1 - d/r)².
      const beam = ctx.createRadialGradient(0, apexY, 0, 0, apexY, range);
      beam.addColorStop(0, 'rgba(255,255,255,1)');
      beam.addColorStop(0.25, 'rgba(255,255,255,0.5625)');
      beam.addColorStop(0.5, 'rgba(255,255,255,0.25)');
      beam.addColorStop(0.75, 'rgba(255,255,255,0.0625)');
      beam.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = beam;
      ctx.globalAlpha = 1 / edgeSteps;
      for (let step = 0; step < edgeSteps; step += 1) {
        const t = step / (edgeSteps - 1);
        const wedgeAngle = halfAngle + (edgeStart - halfAngle) * t;
        ctx.beginPath();
        ctx.moveTo(0, apexY);
        ctx.arc(0, apexY, range, -wedgeAngle, wedgeAngle);
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });

    this.coneTextureKeys.set(angleKey, key);
    return key;
  }
}

function compareLightImportance(left: ActiveLight, right: ActiveLight): number {
  if (left.occludes !== right.occludes) return left.occludes ? -1 : 1;
  if (left.priority !== right.priority) return right.priority - left.priority;
  return right.effectiveIntensity - left.effectiveIntensity;
}

/** Stabile Flackerphase pro Licht-Key, damit benachbarte Feuer nicht im Takt pulsen. */
function hashToPhase(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}
