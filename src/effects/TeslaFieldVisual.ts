import * as Phaser from 'phaser';
import { disposeShaderWarmupNode } from '../graphics/disposeShaderWarmupNode';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { mixColors } from './EffectUtils';
import { getEmissiveScale } from './EmissiveScale';
import {
  TESLA_BOLT_BACK_PAD,
  TESLA_BOLT_FRAGMENT_SOURCE,
  TESLA_BOLT_FRONT_PAD,
  TESLA_BOLT_HEIGHT,
  TESLA_BOLT_MAX_AMPLITUDE,
  TESLA_BOLT_SHADER_NAME,
  TESLA_DOME_FRAGMENT_SOURCE,
  TESLA_DOME_MAX_DISCHARGES,
  TESLA_DOME_OUTER_REACH,
  TESLA_DOME_SHADER_NAME,
} from './teslaDomeShader';

export type Vec3 = [number, number, number];

/** Vier Energiestufen als Shader-Farben: Schleier, Glühen, Adern und weißglühender Kern. */
export interface TeslaPalette {
  deep: Vec3;
  body: Vec3;
  hot: Vec3;
  core: Vec3;
}

/**
 * Zielfarben, zu denen die Waffenfarbe je Energiestufe gezogen wird. Der Farbton der Waffe
 * bleibt erkennbar, die Stufen lesen aber immer als dieselbe Familie.
 */
export interface TeslaPaletteRecipe {
  readonly deep: number;
  readonly body: number;
  readonly hot: number;
}

/** Helles Elektroblau, abgestimmt auf Gewitterprojektile und Blitznova. */
export const TESLA_ELECTRIC_RECIPE: TeslaPaletteRecipe = { deep: 0x1c4ee8, body: 0x2c86ff, hot: 0x8cc8ff };
/** Sattes Violett der gegnerischen Mini-Kuppel. */
export const TESLA_VOID_RECIPE: TeslaPaletteRecipe = { deep: 0x4a12b8, body: 0xa246ff, hot: 0xe6b8ff };

export function createTeslaPalette(): TeslaPalette {
  return { deep: [0, 0, 0], body: [0, 0, 0], hot: [0, 0, 0], core: [0, 0, 0] };
}

export function writeTeslaPalette(palette: TeslaPalette, baseColor: number, recipe: TeslaPaletteRecipe, whiteness: number): void {
  writeColor(palette.deep, mixColors(baseColor, recipe.deep, 0.8));
  writeColor(palette.body, mixColors(baseColor, recipe.body, 0.75));
  writeColor(palette.hot, mixColors(mixColors(baseColor, recipe.hot, 0.72), 0xffffff, whiteness * 0.12));
  writeColor(palette.core, mixColors(mixColors(baseColor, recipe.hot, 0.6), 0xffffff, 0.62 + whiteness * 0.25));
}

/** Schreibt in ein wiederverwendetes Array, damit das Uniform-Setup pro Frame nichts allokiert. */
function writeColor(target: Vec3, color: number): void {
  target[0] = ((color >> 16) & 0xff) / 255;
  target[1] = ((color >> 8) & 0xff) / 255;
  target[2] = (color & 0xff) / 255;
}

export interface TeslaFieldState {
  x: number;
  y: number;
  radius: number;
  /** Gesamtdeckkraft der Kuppel und ihrer Strahlen. */
  alpha: number;
  /** Ladungsfaktor ≥ 1; verdichtet Adern und Kante. */
  charge: number;
  /** 0 im Leerlauf, 1 mit Zielen. */
  activity: number;
  /** 0..1, Stärke des Überladungsschlags. */
  surge: number;
  /** Radiale Position (0..1) der Überladungsfront. */
  surgeFront: number;
  /** Schleierstärke der Hülle. */
  veil: number;
  /** Helligkeit der Bodenkante. */
  rim: number;
  /** Zahl großer Kriechentladungen auf der Hülle. */
  arcs: number;
  /** Energiewellen je Sekunde vom Boden zum Scheitel. */
  waveSpeed: number;
}

export interface TeslaBoltState {
  endX: number;
  endY: number;
  thickness: number;
  amplitude: number;
  branch: number;
  impact: number;
  surge: number;
}

export interface TeslaFieldOptions {
  readonly seed: number;
  readonly depth: number;
  readonly boltDepth: number;
  /** Meldet jedes erzeugte Quad der Visual-Attribution des Besitzers. */
  readonly register: (object: Phaser.GameObjects.GameObject) => void;
}

interface DomeUniforms {
  size: number;
  radius: number;
  time: number;
  pixelSize: number;
  detail: number;
  emission: number;
  appear: number;
}

interface BoltUniforms {
  width: number;
  length: number;
  alpha: number;
  thickness: number;
  amplitude: number;
  branch: number;
  impact: number;
  surge: number;
}

/** Ein Strahl je stabilem Slot; das Quad wird wiederverwendet, solange das Feld lebt. */
interface BoltSlot {
  quad: Phaser.GameObjects.Shader | null;
  uniforms: BoltUniforms;
  seed: number;
  /** Im laufenden Frame angefordert; sonst klingt der Strahl an seiner letzten Position aus. */
  requested: boolean;
  endX: number;
  endY: number;
  intensity: number;
}

/** Aufbau der Hülle vom Emitter bis zur Bodenkante. */
const DOME_APPEAR_MS = 340;
/** Nachglühen eines Strahls, dessen Ziel weggefallen ist. */
const BOLT_FADE_MS = 90;
/** Die Quad-Größe springt in Stufen, damit Ladungswachstum nicht jeden Frame neu layoutet. */
const DOME_SIZE_STEP = 32;
const SHADER_TIME_WRAP_S = 240;
const DETAIL = { high: 2, medium: 1, low: 0 } as const;

/**
 * Prozedurale Tesla-Energiehülle mit ihren Strahlen, gemeinsam für Spieler-, Turm- und
 * Gegnerkuppeln.
 *
 * Hülle, Adernetz, Kriechentladungen, Bodenkante und Strahlen entstehen vollständig im
 * Fragment-Shader (`teslaDomeShader.ts`): ein Quad für die Hülle und ein gepooltes Quad je
 * Strahlslot. Die CPU setzt pro Frame nur Transform und Uniforms. Der Besitzer bleibt für
 * Zustand, Glättung, Licht und Lebensdauer zuständig.
 */
export class TeslaFieldVisual {
  readonly palette = createTeslaPalette();
  private readonly bornAt: number;
  private readonly domeUniforms: DomeUniforms;
  private readonly dome: Phaser.GameObjects.Shader | null;
  private readonly bolts: BoltSlot[] = [];
  private readonly state: TeslaFieldState;

  constructor(private readonly scene: Phaser.Scene, private readonly options: TeslaFieldOptions, initial: TeslaFieldState) {
    this.bornAt = scene.time.now;
    this.state = { ...initial };
    this.domeUniforms = {
      size: getDomeQuadSize(initial.radius),
      radius: initial.radius,
      time: 0,
      pixelSize: 1,
      detail: 2,
      emission: 1,
      appear: 0,
    };
    this.dome = this.createDomeQuad();
  }

  /** Fordert für diesen Frame einen Strahl im gegebenen Slot an. */
  setBolt(slotIndex: number, bolt: TeslaBoltState): void {
    const index = Math.max(0, Math.floor(slotIndex));
    while (this.bolts.length <= index) this.bolts.push(this.createBoltSlot(this.bolts.length));
    const slot = this.bolts[index];
    slot.requested = true;
    slot.endX = bolt.endX;
    slot.endY = bolt.endY;
    const uniforms = slot.uniforms;
    uniforms.thickness = bolt.thickness;
    uniforms.amplitude = Math.min(TESLA_BOLT_MAX_AMPLITUDE, bolt.amplitude);
    uniforms.branch = bolt.branch;
    uniforms.impact = bolt.impact;
    uniforms.surge = bolt.surge;
  }

  /** Überträgt den Feldzustand eines Frames; nicht angeforderte Strahlen klingen aus. */
  render(state: TeslaFieldState, delta: number): void {
    Object.assign(this.state, state);
    const now = this.scene.time.now;
    const camera = this.scene.cameras?.main;
    const uniforms = this.domeUniforms;
    uniforms.radius = state.radius;
    uniforms.time = ((now - this.bornAt) / 1000) % SHADER_TIME_WRAP_S;
    uniforms.pixelSize = camera ? 1 / Math.max(0.001, Math.min(camera.zoomX, camera.zoomY)) : 1;
    uniforms.detail = DETAIL[getGraphicsQualityProfile(this.scene).level];
    uniforms.emission = getEmissiveScale();
    uniforms.appear = Phaser.Math.Clamp((now - this.bornAt) / DOME_APPEAR_MS, 0, 1);

    const alpha = Phaser.Math.Clamp(state.alpha, 0, 1);
    if (this.dome) {
      const size = getDomeQuadSize(state.radius);
      if (size !== uniforms.size) {
        uniforms.size = size;
        // Shader-Size aktualisiert displayOrigin nicht selbst.
        this.dome.setSize(size, size).setOrigin(0.5);
      }
      this.dome.setPosition(state.x, state.y).setVisible(alpha > 0.01);
    }

    const rise = delta / BOLT_FADE_MS;
    for (const slot of this.bolts) {
      slot.intensity = slot.requested
        ? Math.min(1, slot.intensity + rise * 3)
        : Math.max(0, slot.intensity - rise);
      slot.requested = false;
      slot.uniforms.alpha = slot.intensity * alpha;
      this.layoutBolt(slot, state.x, state.y);
    }
  }

  destroy(): void {
    if (this.dome?.renderNode) disposeShaderWarmupNode(this.dome.renderNode);
    this.dome?.destroy();
    for (const slot of this.bolts) {
      if (slot.quad?.renderNode) disposeShaderWarmupNode(slot.quad.renderNode);
      slot.quad?.destroy();
    }
    this.bolts.length = 0;
  }

  private createDomeQuad(): Phaser.GameObjects.Shader | null {
    // Headless-Präsentation darf keine GPU-Ressourcen anlegen.
    if (!hasWebGl(this.scene)) return null;
    const uniforms = this.domeUniforms;
    const state = this.state;
    const palette = this.palette;
    const seed = this.options.seed % 997;
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: TESLA_DOME_SHADER_NAME,
      shaderName: TESLA_DOME_SHADER_NAME,
      fragmentSource: TESLA_DOME_FRAGMENT_SOURCE,
      setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
        setUniform('uSize', uniforms.size);
        setUniform('uRadius', uniforms.radius);
        setUniform('uTime', uniforms.time);
        setUniform('uSeed', seed);
        setUniform('uPixelSize', uniforms.pixelSize);
        setUniform('uDetail', uniforms.detail);
        setUniform('uEmission', uniforms.emission);
        setUniform('uAlpha', state.alpha);
        setUniform('uCharge', state.charge);
        setUniform('uActivity', state.activity);
        setUniform('uSurge', state.surge);
        setUniform('uSurgeFront', state.surgeFront);
        setUniform('uAppear', uniforms.appear);
        setUniform('uVeil', state.veil);
        setUniform('uRim', state.rim);
        setUniform('uArcs', Phaser.Math.Clamp(state.arcs, 0, TESLA_DOME_MAX_DISCHARGES));
        setUniform('uWaveSpeed', state.waveSpeed);
        setUniform('uDeep', palette.deep);
        setUniform('uBody', palette.body);
        setUniform('uHot', palette.hot);
        setUniform('uCore', palette.core);
      },
    }, state.x, state.y, uniforms.size, uniforms.size);
    quad.setOrigin(0.5).setDepth(this.options.depth).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(false);
    // Direktes Display-List-Kind: normales Kamera-Culling und World-Kamera-Zuordnung.
    this.scene.add.existing(quad);
    this.options.register(quad);
    return quad;
  }

  private createBoltSlot(slotIndex: number): BoltSlot {
    const uniforms: BoltUniforms = {
      width: TESLA_BOLT_BACK_PAD + TESLA_BOLT_FRONT_PAD + 1,
      length: 1,
      alpha: 0,
      thickness: 1,
      amplitude: 0,
      branch: 0,
      impact: 0,
      surge: 0,
    };
    const slot: BoltSlot = {
      quad: null,
      uniforms,
      // Der Seed hängt am Slot, nicht am Array-Index eines Ziels: ein wegfallender Strahl darf
      // die Form der übrigen Strahlen nicht umspringen lassen.
      seed: (this.options.seed + slotIndex * 37) % 997,
      requested: false,
      endX: this.state.x,
      endY: this.state.y,
      intensity: 0,
    };
    if (!hasWebGl(this.scene)) return slot;

    const dome = this.domeUniforms;
    const palette = this.palette;
    const quad = new Phaser.GameObjects.Shader(this.scene, {
      name: TESLA_BOLT_SHADER_NAME,
      shaderName: TESLA_BOLT_SHADER_NAME,
      fragmentSource: TESLA_BOLT_FRAGMENT_SOURCE,
      setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
        setUniform('uSize', [uniforms.width, TESLA_BOLT_HEIGHT]);
        setUniform('uBack', TESLA_BOLT_BACK_PAD);
        setUniform('uLength', uniforms.length);
        setUniform('uTime', dome.time);
        setUniform('uSeed', slot.seed);
        setUniform('uPixelSize', dome.pixelSize);
        setUniform('uDetail', dome.detail);
        setUniform('uEmission', dome.emission);
        setUniform('uAlpha', uniforms.alpha);
        setUniform('uWidth', uniforms.thickness);
        setUniform('uAmp', uniforms.amplitude);
        setUniform('uBranch', uniforms.branch);
        setUniform('uImpact', uniforms.impact);
        setUniform('uSurge', uniforms.surge);
        setUniform('uBody', palette.body);
        setUniform('uHot', palette.hot);
        setUniform('uCore', palette.core);
      },
    }, this.state.x, this.state.y, uniforms.width, TESLA_BOLT_HEIGHT);
    quad.setOrigin(0.5).setDepth(this.options.boltDepth).setBlendMode(Phaser.BlendModes.NORMAL).setVisible(false);
    this.scene.add.existing(quad);
    this.options.register(quad);
    slot.quad = quad;
    return slot;
  }

  /** Richtet das Quad entlang Zentrum → Ziel aus; Reserve hinter beiden Enden für die Blüten. */
  private layoutBolt(slot: BoltSlot, startX: number, startY: number): void {
    const quad = slot.quad;
    const uniforms = slot.uniforms;
    const dx = slot.endX - startX;
    const dy = slot.endY - startY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    uniforms.length = length;
    if (!quad) return;
    const width = Math.ceil(length + TESLA_BOLT_BACK_PAD + TESLA_BOLT_FRONT_PAD);
    if (width !== uniforms.width) {
      uniforms.width = width;
      quad.setSize(width, TESLA_BOLT_HEIGHT).setOrigin(0.5);
    }
    const centerOffset = width / 2 - TESLA_BOLT_BACK_PAD;
    quad
      .setPosition(startX + Math.cos(angle) * centerOffset, startY + Math.sin(angle) * centerOffset)
      .setRotation(angle)
      .setVisible(uniforms.alpha > 0.005);
  }
}

function getDomeQuadSize(radius: number): number {
  const size = Math.ceil((Math.max(radius, 4) + TESLA_DOME_OUTER_REACH + 2) * 2);
  return Math.ceil(size / DOME_SIZE_STEP) * DOME_SIZE_STEP;
}

export function hasWebGl(scene: Phaser.Scene): boolean {
  return Boolean((scene.sys?.renderer as { gl?: unknown } | undefined)?.gl);
}
