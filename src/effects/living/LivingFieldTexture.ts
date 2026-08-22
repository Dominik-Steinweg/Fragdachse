import * as Phaser from 'phaser';
import {
  LIVING_FIELD_GLSL,
  LIVING_FIELD_UNIT_HEIGHT,
  LIVING_FIELD_UNIT_WIDTH,
} from './livingFieldShader';
import { getGraphicsQualityController, getGraphicsQualityProfile } from '../../graphics/GraphicsQuality';

/**
 * Die geteilte, animierte Feldtextur hinter allen lebendigen Balken einer Szene.
 *
 * Genau ein Shader-Quad rendert das Blob-Feld offscreen; jeder Balken ist danach ein
 * gewoehnliches, getintetes `Image`, das ein Fenster dieser Textur zeigt. Damit kostet ein
 * zusaetzlicher Balken einen batchbaren Quad statt zweier Partikel-Emitter.
 *
 * Der Shader haengt bewusst **nicht** an der Display-Liste. Ein Shader mit `renderToTexture`
 * wuerde sonst je Kamera, die ihn sieht, einmal pro Frame in seine Textur rendern. Stattdessen
 * ruft diese Klasse den Renderschritt selbst auf — genau so, wie `setRenderToTexture()` es
 * intern beim ersten Mal tut — und kontrolliert damit auch die Rate.
 */

// Zwei Schichten wie zuvor: ein dichtes, kleines Kernfeld und ein weiches, grosses Aussenfeld.
// Alle Werte in Feldeinheiten bzw. Sekunden. Die Durchmesser stammen aus den frueheren
// Emitter-Rampen (20 px * scale bzw. 30 px * scale bei einer Referenzbalkenhoehe von 14 px),
// umgerechnet auf LIVING_FIELD_UNITS_PER_BAR_HEIGHT.
const CORE_CELL = 32; // muss LIVING_FIELD_UNIT_WIDTH ganzzahlig teilen
const CORE_LIFE = 1.35;
const CORE_DIAMETER_START = 62;
const CORE_DIAMETER_END = 26;
const CORE_ALPHA_START = 0.05;
const CORE_ALPHA_END = 0.03;
const CORE_DRIFT = 9;

const OUTER_CELL = 64;
const OUTER_LIFE = 1.75;
const OUTER_DIAMETER_START = 118;
const OUTER_DIAMETER_END = 56;
const OUTER_ALPHA_START = 0.1;
const OUTER_ALPHA_END = 0.03;
const OUTER_DRIFT = 5;

/**
 * Die Hash-Gitter tragen weniger, dafuer groessere Blobs als die frueheren Emitter (ein Blob je
 * Zelle, Radius hoechstens Zellgroesse). Der Faktor gleicht die geringere Ueberdeckung aus, damit
 * die summierte Helligkeit der alten entspricht. Einziger Knopf fuer die optische Kalibrierung.
 */
const FIELD_GAIN = 2.6;

const SHADER_NAME = 'FragdachseLivingField';
const TEXTURE_KEY_PREFIX = '__living_field_';

const FRAGMENT_SOURCE = [
  '#pragma phaserTemplate(shaderName)',
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'varying vec2 outTexCoord;',
  'uniform float uTime;',
  LIVING_FIELD_GLSL,
  'void main () {',
  `  vec2 p = outTexCoord * vec2(${LIVING_FIELD_UNIT_WIDTH.toFixed(1)}, ${LIVING_FIELD_UNIT_HEIGHT.toFixed(1)});`,
  '  float core = livingField(',
  `    p, uTime, ${CORE_CELL.toFixed(1)}, ${(LIVING_FIELD_UNIT_WIDTH / CORE_CELL).toFixed(1)}, ${CORE_LIFE.toFixed(4)},`,
  `    ${CORE_DIAMETER_START.toFixed(1)}, ${CORE_DIAMETER_END.toFixed(1)},`,
  `    ${CORE_ALPHA_START.toFixed(4)}, ${CORE_ALPHA_END.toFixed(4)}, ${CORE_DRIFT.toFixed(1)}, 3.17`,
  '  );',
  '  float outer = livingField(',
  `    p, uTime, ${OUTER_CELL.toFixed(1)}, ${(LIVING_FIELD_UNIT_WIDTH / OUTER_CELL).toFixed(1)}, ${OUTER_LIFE.toFixed(4)},`,
  `    ${OUTER_DIAMETER_START.toFixed(1)}, ${OUTER_DIAMETER_END.toFixed(1)},`,
  `    ${OUTER_ALPHA_START.toFixed(4)}, ${OUTER_ALPHA_END.toFixed(4)}, ${OUTER_DRIFT.toFixed(1)}, 11.41`,
  '  );',
  // Vormultipliziertes Alpha: Phaser sampelt Texturen vormultipliziert, und rgb == a * weiss
  // erfuellt das per Konstruktion.
  `  float v = clamp((core + outer) * ${FIELD_GAIN.toFixed(3)}, 0.0, 1.0);`,
  '  gl_FragColor = vec4(vec3(v), v);',
  '}',
].join('\n');

interface QualityStep {
  readonly width: number;
  readonly height: number;
  readonly intervalMs: number;
}

// LivingBarEffect keeps Image consumers bound to this texture key. Keep the render target size
// stable across quality changes; changing it destroys the source behind all existing tiles.
const FIELD_TEXTURE_WIDTH = 1024;
const FIELD_TEXTURE_HEIGHT = 128;
const QUALITY_HIGH: QualityStep = {
  width: FIELD_TEXTURE_WIDTH,
  height: FIELD_TEXTURE_HEIGHT,
  intervalMs: 1000 / 30,
};
const QUALITY_MEDIUM: QualityStep = {
  width: FIELD_TEXTURE_WIDTH,
  height: FIELD_TEXTURE_HEIGHT,
  intervalMs: 1000 / 20,
};

const instances = new WeakMap<Phaser.Scene, LivingFieldTexture>();

export class LivingFieldTexture {
  private readonly textureKey: string;
  private shader: Phaser.GameObjects.Shader | null = null;
  private step: QualityStep = QUALITY_HIGH;
  private consumers = 0;
  private nextRenderAt = 0;
  private elapsedSec = 0;
  private readonly available: boolean;
  private unsubscribeQuality: (() => void) | null = null;
  private readonly onUpdate: (time: number, delta: number) => void;
  private readonly onShutdown: () => void;

  private constructor(private readonly scene: Phaser.Scene) {
    this.textureKey = TEXTURE_KEY_PREFIX + scene.scene.key;
    this.available = supportsShaderQuads(scene);

    this.onUpdate = (_time: number, delta: number) => this.update(delta);
    this.onShutdown = () => this.destroy();

    if (!this.available) return;

    this.step = resolveStep(scene);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown);

    this.unsubscribeQuality = getGraphicsQualityController(scene)?.subscribe(() => {
      const next = resolveStep(scene);
      const textureSizeChanged = next.width !== this.step.width || next.height !== this.step.height;
      this.step = next;
      // The render cadence may change without touching the shared texture. Existing Images must
      // keep their frame source alive because Phaser destroys it when the texture is replaced.
      if (!textureSizeChanged) return;
      // Ein Shader-Renderziel darf nicht in der Groesse veraendert werden; jeder Konsument haelt
      // bereits einen Frame darauf. Neu bauen statt anpassen.
      const hadConsumers = this.consumers > 0;
      this.disposeShader();
      if (hadConsumers) this.ensureShader();
    }) ?? null;
  }

  static get(scene: Phaser.Scene): LivingFieldTexture {
    let instance = instances.get(scene);
    if (!instance) {
      instance = new LivingFieldTexture(scene);
      instances.set(scene, instance);
    }
    return instance;
  }

  /** `false` ohne WebGL-Renderer oder Shader-Klasse — dann bleibt jeder Balken wie im `low`-Profil leer. */
  isAvailable(): boolean {
    return this.available;
  }

  getTextureKey(): string {
    return this.textureKey;
  }

  /**
   * Texturpixel je Feldeinheit. Konstant, solange die Texturgroesse konstant ist — die
   * Qualitaetsstufe aendert nur die Renderkadenz. Balken rechnen ihren Bildmassstab daraus, ein
   * Wechsel muesste also alle Konsumenten neu vermessen.
   */
  getPixelsPerUnit(): number {
    return this.step.width / LIVING_FIELD_UNIT_WIDTH;
  }

  getTextureWidth(): number {
    return this.step.width;
  }

  getTextureHeight(): number {
    return this.step.height;
  }

  retain(): void {
    this.consumers += 1;
    if (this.consumers === 1) this.ensureShader();
  }

  release(): void {
    if (this.consumers === 0) return;
    this.consumers -= 1;
    if (this.consumers === 0) this.disposeShader();
  }

  private update(deltaMs: number): void {
    if (!this.shader || this.consumers === 0) return;
    this.elapsedSec += deltaMs / 1000;
    this.nextRenderAt -= deltaMs;
    if (this.nextRenderAt > 0) return;
    this.nextRenderAt = this.step.intervalMs;
    this.renderOnce();
  }

  private renderOnce(): void {
    const shader = this.shader;
    const context = shader?.drawingContext;
    if (!shader || !context) return;
    const renderer = this.scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    // Das Renderziel wird nicht von selbst geleert, und der Quad zeichnet mit Normal-Blending.
    // Ohne diesen Schritt bliebe jedes vorherige Bild anteilig stehen und das Feld verschmierte
    // statt zu atmen.
    context.clear(renderer.gl.COLOR_BUFFER_BIT);
    shader.renderWebGLStep(renderer, shader, context);
  }

  private ensureShader(): void {
    if (this.shader || !this.available) return;

    // Ein Szenenneustart laesst den alten Schluessel im globalen TextureManager stehen.
    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);

    const shader = new Phaser.GameObjects.Shader(
      this.scene,
      {
        name: SHADER_NAME,
        shaderName: SHADER_NAME,
        fragmentSource: FRAGMENT_SOURCE,
        setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
          setUniform('uTime', this.elapsedSec);
        },
      },
      0,
      0,
      this.step.width,
      this.step.height,
    );
    // Bewusst nicht auf der Display-Liste: der Renderschritt laeuft aus `update()`.
    shader.setRenderToTexture(this.textureKey);
    shader.drawingContext?.setClearColor(0, 0, 0, 0);
    this.shader = shader;
    this.nextRenderAt = 0;
  }

  private disposeShader(): void {
    if (!this.shader) return;
    this.shader.destroy();
    this.shader = null;
    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
  }

  private destroy(): void {
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.onShutdown);
    this.consumers = 0;
    this.disposeShader();
    instances.delete(this.scene);
  }
}

function resolveStep(scene: Phaser.Scene): QualityStep {
  return getGraphicsQualityProfile(scene).level === 'high' ? QUALITY_HIGH : QUALITY_MEDIUM;
}

function supportsShaderQuads(scene: Phaser.Scene): boolean {
  const renderer = scene.sys?.renderer as { gl?: WebGLRenderingContext } | undefined;
  if (!renderer?.gl) return false;
  if (typeof Phaser.GameObjects?.Shader !== 'function') return false;
  return typeof scene.textures?.remove === 'function';
}
