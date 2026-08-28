/**
 * Gemeinsame Fakes fuer die SpriteGPULayer-Partikeltests.
 *
 * Der Layer protokolliert, was das GPU-VFX-Backend mit ihm anstellt: wie viele Member angelegt
 * (`added`), bespielt (`edited`) und stillgelegt (`patched`) wurden, und wie oft die Sichtbarkeit
 * umgeschaltet hat. Damit laesst sich die Emission pruefen, ohne WebGL oder echtes Phaser zu
 * brauchen.
 *
 * Der Texture-Manager bildet genau die Phaser-Semantik nach, an der der Atlas haengt: die
 * `firstFrame`-Befoerderung des ersten hinzugefuegten Frames und die Einfuegereihenfolge von
 * `getFrameNames()`.
 */

/** Eine Member-Animation, so wie sie im Buffer landen wuerde. */
export interface FakeGpuAnimation {
  base: number;
  amplitude: number;
  duration: number;
  ease: string;
  loop: boolean;
}

/**
 * Rechnet wie `SpriteGPULayer.vert`, damit Tests den tatsaechlich gezeichneten Wert pruefen
 * statt der rohen Buffer-Felder. Enthaelt bewusst auch den `repeats`-Term, den der Shader bei
 * `loop: false` aufaddiert – nur so faellt eine fehlende `gpuVfxEasedBase`-Korrektur auf.
 *
 * `t` ist die normalisierte Lebenszeit. Der Shader nimmt fuer nicht-lineare Eases `mod(t, 1)`,
 * bei exakt 1 also 0; dort ist der Member ohnehin schon stillgelegt.
 */
export function evaluateFakeAnimation(anim: FakeGpuAnimation, t: number): number {
  const { base, amplitude, duration, ease, loop } = anim;
  if (ease === 'None' || duration === 0) return base;
  if (ease === 'Linear') return base + amplitude * (loop ? t % 1 : t);
  if (ease === 'Quad.easeOut') {
    const time = t % 1;
    const repeats = loop ? 0 : Math.floor(amplitude);
    return base + amplitude * time * (2 - time) + repeats * amplitude;
  }
  if (ease === 'Cubic.easeIn') {
    const time = t % 1;
    const repeats = loop ? 0 : Math.floor(amplitude);
    return base + amplitude * time * time * time + repeats * amplitude;
  }
  throw new Error(`Test-Helper kennt die Ease nicht: ${ease}`);
}

export interface FakeGpuMemberSnapshot {
  x: FakeGpuAnimation;
  y: FakeGpuAnimation;
  scaleX: FakeGpuAnimation;
  /** Traegt den Groessenverlauf ohne Streckung, `scaleX` traegt ihn mit. */
  scaleY: FakeGpuAnimation;
  alpha: FakeGpuAnimation;
  rotation: FakeGpuAnimation;
  /** Frame-Name aus dem Atlas; `null`, wenn der Member gar keinen Frame gesetzt hat. */
  frame: string | null;
  /** Optionale GPU-Framefolge; statische Member tragen null. */
  frameAnimation: {
    name: string;
    amplitude: number;
    duration: number;
    ease: string;
    loop: boolean;
    yoyo: boolean;
  } | null;
  tint: number;
  /** Konstante 1 oder der Verlauf, mit dem der Tint ueber die Lebenszeit einblendet. */
  tintBlend: FakeGpuAnimation;
}

const STATIC_ANIMATION: FakeGpuAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'None', loop: false };

function readAnimation(value: unknown): FakeGpuAnimation {
  if (typeof value === 'number') return { ...STATIC_ANIMATION, base: value };
  if (!value || typeof value !== 'object') return { ...STATIC_ANIMATION };
  const anim = value as Partial<FakeGpuAnimation> & { velocity?: number };
  return {
    base: anim.base ?? 0,
    // Gravity kodiert die Geschwindigkeit statt einer Amplitude.
    amplitude: anim.amplitude ?? anim.velocity ?? 0,
    duration: anim.duration ?? 0,
    ease: anim.ease ?? 'None',
    loop: anim.loop ?? true,
  };
}

function readFrameName(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
    return (value as { name: string }).name;
  }
  return null;
}

/**
 * Kopiert die Felder, auf die es in den Tests ankommt. Das Backend mutiert seine Vorlage
 * bewusst wieder, ein Referenz-Mitschnitt waere also immer der letzte Spawn.
 */
function snapshotMember(member: Record<string, unknown>): FakeGpuMemberSnapshot {
  const frameAnimation = member.animation && typeof member.animation === 'object'
    ? member.animation as Record<string, unknown>
    : null;
  return {
    x: readAnimation(member.x),
    y: readAnimation(member.y),
    scaleX: readAnimation(member.scaleX),
    scaleY: readAnimation(member.scaleY),
    alpha: readAnimation(member.alpha),
    rotation: readAnimation(member.rotation),
    frame: readFrameName(member.frame),
    frameAnimation: frameAnimation && typeof frameAnimation.base === 'string'
      ? {
        name: frameAnimation.base,
        amplitude: (frameAnimation.amplitude as number) ?? 0,
        duration: (frameAnimation.duration as number) ?? 0,
        ease: (frameAnimation.ease as string) ?? 'None',
        loop: (frameAnimation.loop as boolean) ?? true,
        yoyo: (frameAnimation.yoyo as boolean) ?? true,
      }
      : null,
    tint: (member.tintTopLeft as number) ?? 0,
    tintBlend: readAnimation(member.tintBlend),
  };
}

export interface FakeGpuLayer {
  key: string;
  /** Lane-Label; alle Lanes teilen sich den Atlas, der Key unterscheidet sie also nicht mehr. */
  name: string;
  size: number;
  memberCount: number;
  gravity: number;
  timeElapsed: number;
  visible: boolean;
  /** Jede echte Sichtbarkeitsumschaltung, in Reihenfolge. */
  visibleTransitions: boolean[];
  depth: number;
  blendMode: number;
  enabledEases: string[];
  frameAnimations: { name: string; frames: (string | number)[]; duration: number }[];
  added: number;
  edited: number[];
  /** Mitschnitt der bespielten Member, in Spawn-Reihenfolge. */
  members: FakeGpuMemberSnapshot[];
  patched: number[];
  getDataByteSize(): number;
  addMember(): void;
  editMember(index: number, member: Record<string, unknown>): void;
  patchMember(index: number, data: Uint32Array, mask?: number[]): void;
  setVisible(visible: boolean): FakeGpuLayer;
  setDepth(depth: number): FakeGpuLayer;
  setBlendMode(mode: number): FakeGpuLayer;
  setAnimationEnabled(name: string, enabled: boolean): FakeGpuLayer;
  setAnimations(animations: { name: string; frames: (string | number)[]; duration: number }[]): FakeGpuLayer;
}

export function makeFakeGpuLayer(key: string, size: number): FakeGpuLayer {
  const layer: FakeGpuLayer = {
    key,
    name: '',
    size,
    memberCount: 0,
    gravity: 1024,
    timeElapsed: 0,
    visible: true,
    visibleTransitions: [],
    depth: 0,
    blendMode: 0,
    enabledEases: [],
    frameAnimations: [],
    added: 0,
    edited: [],
    members: [],
    patched: [],
    getDataByteSize: () => 42 * 4,
    addMember: () => { layer.added += 1; layer.memberCount += 1; },
    editMember: (index, member) => {
      // Phaser steigt bei `index >= memberCount` still aus.
      if (index < 0 || index >= layer.memberCount) return;
      layer.edited.push(index);
      layer.members.push(snapshotMember(member));
    },
    patchMember: (index) => {
      if (index < 0 || index >= layer.memberCount) return;
      layer.patched.push(index);
    },
    setVisible: (visible) => {
      if (visible !== layer.visible) layer.visibleTransitions.push(visible);
      layer.visible = visible;
      return layer;
    },
    setDepth: (depth) => { layer.depth = depth; return layer; },
    setBlendMode: (mode) => { layer.blendMode = mode; return layer; },
    setAnimationEnabled: (name, enabled) => {
      if (enabled) layer.enabledEases.push(name);
      return layer;
    },
    setAnimations: (animations) => {
      layer.frameAnimations = animations.map((animation) => ({
        name: animation.name,
        frames: [...animation.frames],
        duration: animation.duration,
      }));
      return layer;
    },
  };
  return layer;
}

/* ── Texturen ─────────────────────────────────────────────────────────────── */

export interface FakeDrawCall {
  readonly source: string;
  readonly x: number;
  readonly y: number;
  readonly smoothing: boolean;
  readonly composite: string;
}

export interface FakeFrame {
  name: string;
  cutX: number;
  cutY: number;
  cutWidth: number;
  cutHeight: number;
}

export interface FakeCanvasTexture {
  key: string;
  width: number;
  height: number;
  firstFrame: string;
  /** Einfuegereihenfolge – daran haengen Phasers Frame-Indizes. */
  frameOrder: string[];
  frames: Map<string, FakeFrame>;
  refreshed: number;
  drawCalls: FakeDrawCall[];
  context: FakeCanvasContext;
  add(name: string, sourceIndex: number, x: number, y: number, w: number, h: number): FakeFrame | null;
  has(name: string): boolean;
  get(name?: string): FakeFrame;
  getFrameNames(includeBase?: boolean): string[];
  getSourceImage(): { key: string };
  refresh(): void;
}

export interface FakeCanvasContext {
  imageSmoothingEnabled: boolean;
  globalCompositeOperation: string;
  fillStyle: unknown;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(source: { key?: string }, x: number, y: number): void;
  createRadialGradient(...args: number[]): { addColorStop(): void };
  createLinearGradient(...args: number[]): { addColorStop(): void };
  /** Die GroundFire-Motive werden pixelweise geschrieben und brauchen einen echten Puffer. */
  createImageData(width: number, height: number): { width: number; height: number; data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
  /** Alle uebrigen Canvas-Methoden sind No-Ops (siehe Proxy in `makeFakeCanvasTexture`). */
  [method: string]: unknown;
}

const noop = (): undefined => undefined;

function makeFakeCanvasTexture(key: string, width: number, height: number): FakeCanvasTexture {
  const gradient = { addColorStop: () => {} };
  const texture: FakeCanvasTexture = {
    key,
    width,
    height,
    firstFrame: '__BASE',
    frameOrder: ['__BASE'],
    frames: new Map([['__BASE', { name: '__BASE', cutX: 0, cutY: 0, cutWidth: width, cutHeight: height }]]),
    refreshed: 0,
    drawCalls: [],
    // Unbekannte Canvas-Methoden sind No-Ops: die Renderer zeichnen hier echte Pfade, die
    // Tests interessieren aber nur Frame-Geometrie und Blit-Parameter.
    context: new Proxy({
      imageSmoothingEnabled: true,
      globalCompositeOperation: 'source-over',
      fillStyle: null,
      clearRect: () => {},
      fillRect: () => {},
      drawImage: (source: { key?: string }, x: number, y: number) => {
        texture.drawCalls.push({
          source: source.key ?? '?',
          x,
          y,
          smoothing: texture.context.imageSmoothingEnabled as boolean,
          composite: texture.context.globalCompositeOperation as string,
        });
      },
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: () => {},
    } as Record<string, unknown>, {
      get: (target, key: string) => (key in target ? target[key] : noop),
    }) as unknown as FakeCanvasContext,
    add: (name, _sourceIndex, x, y, w, h) => {
      if (texture.frames.has(name)) return null;
      const frame: FakeFrame = { name, cutX: x, cutY: y, cutWidth: w, cutHeight: h };
      texture.frames.set(name, frame);
      texture.frameOrder.push(name);
      // Phaser befoerdert den ersten hinzugefuegten Frame zum Default der Textur.
      if (texture.firstFrame === '__BASE') texture.firstFrame = name;
      return frame;
    },
    has: (name) => texture.frames.has(name),
    get: (name) => texture.frames.get(name ?? texture.firstFrame)!,
    getFrameNames: (includeBase = false) => (
      includeBase ? [...texture.frameOrder] : texture.frameOrder.filter((n) => n !== '__BASE')
    ),
    getSourceImage: () => ({ key }),
    refresh: () => { texture.refreshed += 1; },
  };
  return texture;
}

export interface FakeTextureManager {
  list: Map<string, FakeCanvasTexture>;
  exists(key: string): boolean;
  get(key: string): FakeCanvasTexture;
  createCanvas(key: string, width: number, height: number): FakeCanvasTexture;
}

export function makeFakeTextureManager(): FakeTextureManager {
  const list = new Map<string, FakeCanvasTexture>();
  return {
    list,
    exists: (key) => list.has(key),
    get: (key) => list.get(key)!,
    createCanvas: (key, width, height) => {
      const texture = makeFakeCanvasTexture(key, width, height);
      list.set(key, texture);
      return texture;
    },
  };
}

export interface FakeDisplayObject {
  destroyed: boolean;
  [method: string]: unknown;
}

/** Deckt die Chainable-Oberflaeche ab, die Shapes und Images in den Renderern benutzen. */
export function makeFakeDisplayObject(): FakeDisplayObject {
  const object = { destroyed: false } as FakeDisplayObject;
  const chainable = [
    'setDepth', 'setBlendMode', 'setStrokeStyle', 'setPosition', 'setAlpha', 'setScale',
    'setTint', 'setRotation', 'setOrigin', 'setVisible',
  ];
  for (const method of chainable) object[method] = () => object;
  object.destroy = () => { object.destroyed = true; };
  return object;
}

export interface FakeGpuVfxScene {
  layers: FakeGpuLayer[];
  objects: FakeDisplayObject[];
  emitters: FakeDisplayObject[];
  textures: FakeTextureManager;
  tweens: { add: () => object };
  time: { now: number; delayedCall: () => object };
  add: Record<string, (...args: never[]) => unknown>;
}

export function makeFakeGpuVfxScene(): FakeGpuVfxScene {
  const layers: FakeGpuLayer[] = [];
  const objects: FakeDisplayObject[] = [];
  const emitters: FakeDisplayObject[] = [];
  const track = (): FakeDisplayObject => {
    const object = makeFakeDisplayObject();
    objects.push(object);
    return object;
  };
  const scene: FakeGpuVfxScene = {
    layers,
    objects,
    emitters,
    textures: makeFakeTextureManager(),
    tweens: { add: () => ({}) },
    time: { now: 0, delayedCall: () => ({}) },
    add: {
      circle: track,
      rectangle: track,
      image: track,
      particles: () => {
        const emitter = makeFakeDisplayObject();
        emitter.emitParticleAt = () => emitter;
        emitter.explode = () => emitter;
        emitter.stop = () => emitter;
        // Der klassische Burst-Emitter bleibt unveraendert und wird beim Teardown zurueckgesetzt.
        emitter.killAll = () => emitter;
        emitter.forEachDead = () => emitter;
        emitters.push(emitter);
        return emitter;
      },
      spriteGPULayer: ((key: string, size: number) => {
        const layer = makeFakeGpuLayer(key, size);
        layers.push(layer);
        return layer;
      }) as unknown as (...args: never[]) => unknown,
    },
  };
  return scene;
}

/** Lane-Layer nach Label, so wie das Backend ihn benannt hat. */
export function findFakeLane(scene: FakeGpuVfxScene, label: string): FakeGpuLayer {
  const layer = scene.layers.find((candidate) => candidate.name === label);
  if (!layer) throw new Error(`Keine Lane mit dem Label ${label}`);
  return layer;
}
