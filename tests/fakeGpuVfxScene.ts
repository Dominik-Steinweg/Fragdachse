/**
 * Gemeinsame Fakes fuer die SpriteGPULayer-Partikeltests.
 *
 * Der Layer protokolliert, was `GpuVfxPool` und die Renderer mit ihm anstellen: wie viele
 * Member angelegt (`added`), bespielt (`edited`) und stillgelegt (`patched`) wurden. Damit
 * laesst sich die Emission pruefen, ohne WebGL oder echtes Phaser zu brauchen.
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
  throw new Error(`Test-Helper kennt die Ease nicht: ${ease}`);
}

export interface FakeGpuMemberSnapshot {
  x: FakeGpuAnimation;
  y: FakeGpuAnimation;
  scaleX: FakeGpuAnimation;
  alpha: FakeGpuAnimation;
  tint: number;
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

/**
 * Kopiert die Felder, auf die es in den Tests ankommt. Die Renderer mutieren ihre Vorlagen
 * bewusst wieder, ein Referenz-Mitschnitt waere also immer der letzte Spawn.
 */
function snapshotMember(member: Record<string, unknown>): FakeGpuMemberSnapshot {
  return {
    x: readAnimation(member.x),
    y: readAnimation(member.y),
    scaleX: readAnimation(member.scaleX),
    alpha: readAnimation(member.alpha),
    tint: (member.tintTopLeft as number) ?? 0,
  };
}

export interface FakeGpuLayer {
  key: string;
  size: number;
  gravity: number;
  timeElapsed: number;
  visible: boolean;
  depth: number;
  blendMode: number;
  enabledEases: string[];
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
}

export function makeFakeGpuLayer(key: string, size: number): FakeGpuLayer {
  const layer: FakeGpuLayer = {
    key,
    size,
    gravity: 1024,
    timeElapsed: 0,
    visible: true,
    depth: 0,
    blendMode: 0,
    enabledEases: [],
    added: 0,
    edited: [],
    members: [],
    patched: [],
    getDataByteSize: () => 42 * 4,
    addMember: () => { layer.added += 1; },
    editMember: (index, member) => {
      layer.edited.push(index);
      layer.members.push(snapshotMember(member));
    },
    patchMember: (index) => { layer.patched.push(index); },
    setVisible: (visible) => { layer.visible = visible; return layer; },
    setDepth: (depth) => { layer.depth = depth; return layer; },
    setBlendMode: (mode) => { layer.blendMode = mode; return layer; },
    setAnimationEnabled: (name, enabled) => {
      if (enabled) layer.enabledEases.push(name);
      return layer;
    },
  };
  return layer;
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
  textures: { exists: () => boolean; createCanvas: () => null };
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
    textures: { exists: () => true, createCanvas: () => null },
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
        // Der klassische Smoke-Emitter bleibt unveraendert und wird beim Teardown zurueckgesetzt.
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
