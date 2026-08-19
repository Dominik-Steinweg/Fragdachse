/**
 * Gemeinsame Fakes fuer die SpriteGPULayer-Partikeltests.
 *
 * Der Layer protokolliert, was `GpuVfxPool` und die Renderer mit ihm anstellen: wie viele
 * Member angelegt (`added`), bespielt (`edited`) und stillgelegt (`patched`) wurden. Damit
 * laesst sich die Emission pruefen, ohne WebGL oder echtes Phaser zu brauchen.
 */

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
  patched: number[];
  getDataByteSize(): number;
  addMember(): void;
  editMember(index: number): void;
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
    patched: [],
    getDataByteSize: () => 42 * 4,
    addMember: () => { layer.added += 1; },
    editMember: (index) => { layer.edited.push(index); },
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
