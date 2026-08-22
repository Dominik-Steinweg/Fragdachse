import * as Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import {
  getGraphicsQualityController,
  getGraphicsQualityProfile,
  type GraphicsQualityProfile,
  type VisualImportance,
} from '../graphics/GraphicsQuality';
import { getClarityCameraRegistry } from '../scenes/arena/ClarityCameraRegistry';
import {
  canUseSharedGlow,
  isSharedGlowTargetVisible,
  resolveSharedGlowAlpha,
  resolveSharedGlowBandWeights,
  resolveSharedGlowTargetAlpha,
} from './sharedGlowModel';

export {
  canUseSharedGlow,
  isSharedGlowTargetVisible,
  resolveSharedGlowAlpha,
  resolveSharedGlowBandWeights,
  resolveSharedGlowTargetAlpha,
} from './sharedGlowModel';

export interface SharedGlowHandleLike {
  active: boolean;
  outerStrength: number;
  innerStrength: number;
  color: number;
  setActive(active: boolean): this;
  destroy(): void;
  /** Set by phaserFx when a runtime inner glow requires the legacy filter path. */
  fallbackHandle?: {
    active?: boolean;
    outerStrength: number;
    innerStrength: number;
    color: number;
    setActive?: (active: boolean) => unknown;
    destroy?: () => void;
  } | null;
  setFallbackHandle?: (handle: SharedGlowHandleLike['fallbackHandle']) => void;
}

export interface SharedGlowRequest {
  readonly target: Phaser.GameObjects.GameObject;
  readonly color: number;
  readonly outerStrength: number;
  readonly innerStrength: number;
  readonly knockout: boolean;
  readonly distance: number;
  readonly importance: VisualImportance;
  readonly onRequiresFallback?: (handle: SharedGlowHandleLike) => void;
}

interface GlowRecord {
  readonly handle: SharedGlowHandle;
  readonly target: Phaser.GameObjects.GameObject;
  readonly importance: VisualImportance;
  readonly distance: number;
  readonly knockout: boolean;
  readonly onRequiresFallback?: (handle: SharedGlowHandleLike) => void;
  readonly destroyHandler: () => void;
}

interface GlowBandBuffer {
  readonly textureKey: string;
  readonly texture: Phaser.Textures.DynamicTexture;
  readonly image: Phaser.GameObjects.Image;
  readonly blur: {
    active: boolean;
    quality: number;
    x: number;
    y: number;
    strength: number;
    steps: number;
  };
}

interface GlowCameraBuffer {
  readonly near: GlowBandBuffer;
  readonly far: GlowBandBuffer | null;
}

const SHARED_GLOW_TEXTURE_PREFIX = '__shared_glow';
let nextSharedGlowId = 0;

function isWebGlScene(scene: Phaser.Scene): boolean {
  return Boolean((scene.sys as unknown as { renderer?: { gl?: unknown } }).renderer?.gl);
}

function canCaptureTarget(target: Phaser.GameObjects.GameObject): boolean {
  const candidate = target as unknown as {
    renderWebGLStep?: unknown;
    renderWebGL?: unknown;
    scene?: Phaser.Scene;
  };
  return typeof candidate.renderWebGLStep === 'function'
    || typeof candidate.renderWebGL === 'function';
}

function getTargetRoot(target: Phaser.GameObjects.GameObject): Phaser.GameObjects.GameObject {
  let root = target as Phaser.GameObjects.GameObject & { parentContainer?: Phaser.GameObjects.Container | null };
  while (root.parentContainer) {
    root = root.parentContainer as Phaser.GameObjects.GameObject & { parentContainer?: Phaser.GameObjects.Container | null };
  }
  return root;
}

function resolveTargetCamera(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
): 'world' | 'clarity' {
  const clarity = getClarityCameraRegistry(scene)?.getClarityCamera() ?? null;
  if (!clarity) return 'world';

  const root = getTargetRoot(target) as Phaser.GameObjects.GameObject & { cameraFilter?: number };
  const cameraFilter = root.cameraFilter ?? 0;
  if ((cameraFilter & scene.cameras.main.id) !== 0) return 'clarity';
  if ((cameraFilter & clarity.id) !== 0) return 'world';
  // cameraFilter=0 is technically visible on both cameras. The registry normally prevents
  // this, but choosing world avoids duplicating a source when a container is mid-reparent.
  return 'world';
}

function configureTextureCamera(
  texture: Phaser.Textures.DynamicTexture,
  cameraMode: 'world' | 'clarity',
  bufferScale: number,
  worldCamera: Phaser.Cameras.Scene2D.Camera,
): void {
  texture.camera.setOrigin(0, 0);
  texture.camera.setZoom(bufferScale);
  texture.camera.setRotation(0);
  texture.camera.setScroll(cameraMode === 'world' ? worldCamera.scrollX : 0, cameraMode === 'world' ? worldCamera.scrollY : 0);
}

function destroyBandBuffer(scene: Phaser.Scene, band: GlowBandBuffer | null): void {
  if (!band) return;
  band.image.destroy();
  scene.textures.remove(band.textureKey);
}

export class SharedGlowSystem {
  private readonly records = new Map<SharedGlowHandle, GlowRecord>();
  private readonly id = nextSharedGlowId += 1;
  private world: GlowCameraBuffer | null = null;
  private clarity: GlowCameraBuffer | null = null;
  private profileLevel: GraphicsQualityProfile['level'] | null = null;
  private destroyed = false;
  private readonly unsubscribeQuality: (() => void) | null;
  private readonly onPostUpdate: () => void;
  private readonly onShutdown: () => void;

  constructor(private readonly scene: Phaser.Scene) {
    this.onPostUpdate = () => this.flush();
    this.onShutdown = () => this.destroy();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown);

    const quality = getGraphicsQualityController(scene);
    this.unsubscribeQuality = quality?.subscribe((profile) => {
      if (this.profileLevel === profile.level) return;
      this.rebuildBuffers(profile);
    }) ?? null;
    this.rebuildBuffers(getGraphicsQualityProfile(scene));
  }

  add(request: SharedGlowRequest): SharedGlowHandleLike | null {
    if (this.destroyed || !isWebGlScene(this.scene) || !canCaptureTarget(request.target)) return null;
    if (!canUseSharedGlow(request.innerStrength, request.knockout)) return null;

    const handle = new SharedGlowHandle(this, request);
    const destroyHandler = () => this.remove(handle);
    const record: GlowRecord = {
      handle,
      target: request.target,
      importance: request.importance,
      distance: request.distance,
      knockout: request.knockout,
      onRequiresFallback: request.onRequiresFallback,
      destroyHandler,
    };
    this.records.set(handle, record);
    (request.target as unknown as { once?: (event: string, listener: () => void) => void }).once?.(
      Phaser.GameObjects.Events.DESTROY,
      destroyHandler,
    );
    return handle;
  }

  remove(handle: SharedGlowHandle): void {
    const record = this.records.get(handle);
    if (!record) return;
    (record.target as unknown as { off?: (event: string, listener: () => void) => void }).off?.(
      Phaser.GameObjects.Events.DESTROY,
      record.destroyHandler,
    );
    this.records.delete(handle);
  }

  requestFallback(handle: SharedGlowHandle): void {
    const record = this.records.get(handle);
    if (!record) return;
    record.onRequiresFallback?.(handle);
  }

  flush(): void {
    if (this.destroyed) return;
    const profile = getGraphicsQualityProfile(this.scene);
    if (!profile.sharedGlow.enabled) {
      this.setBuffersVisible(false);
      return;
    }

    const buffers = [this.world, this.clarity];
    for (const buffer of buffers) {
      if (!buffer) continue;
      configureTextureCamera(buffer.near.texture, buffer === this.world ? 'world' : 'clarity', profile.sharedGlow.bufferScale, this.scene.cameras.main);
      configureTextureCamera(buffer.far?.texture ?? buffer.near.texture, buffer === this.world ? 'world' : 'clarity', profile.sharedGlow.bufferScale, this.scene.cameras.main);
      buffer.near.texture.clear();
      buffer.far?.texture.clear();
    }

    const bandHasSource = {
      world: { near: false, far: false },
      clarity: { near: false, far: false },
    };

    for (const record of this.records.values()) {
      const handle = record.handle;
      const target = record.target as Phaser.GameObjects.GameObject & {
        active?: boolean;
        visible?: boolean;
        alpha?: number;
        parentContainer?: Phaser.GameObjects.Container | null;
      };
      if (!handle.active || handle.fallbackHandle || !isSharedGlowTargetVisible(target)) continue;

      const cameraMode = resolveTargetCamera(this.scene, record.target);
      const camera = cameraMode === 'world'
        ? this.scene.cameras.main
        : getClarityCameraRegistry(this.scene)?.getClarityCamera() ?? null;
      // DynamicTexture.capture() invokes renderWebGLStep directly and does not perform the
      // normal willRender test. The camera assignment above is the explicit routing decision;
      // consulting target.willRender(camera) here can reject valid world sprites because the
      // capture is rendered through a separate DynamicTexture camera/display list.
      if (!camera) continue;

      const weights = resolveSharedGlowBandWeights(record.distance);
      const alpha = resolveSharedGlowAlpha(handle.outerStrength) * resolveSharedGlowTargetAlpha(target);
      if (alpha <= 0) continue;
      const destination = cameraMode === 'world' ? this.world : this.clarity;
      if (!destination) continue;

      const capture = (texture: Phaser.Textures.DynamicTexture, weight: number): void => {
        if (weight <= 0) return;
        texture.capture(record.target, {
          transform: 'world',
          alpha: alpha * weight,
          tint: handle.color,
        });
      };

      capture(destination.near.texture, weights.near);
      bandHasSource[cameraMode].near ||= weights.near > 0;
      if (destination.far && weights.far > 0) {
        capture(destination.far.texture, weights.far);
        bandHasSource[cameraMode].far = true;
      }
    }

    for (const buffer of buffers) {
      if (!buffer) continue;
      buffer.near.texture.render();
      buffer.far?.texture.render();
    }

    this.setBandVisibility(this.world, bandHasSource.world);
    this.setBandVisibility(this.clarity, bandHasSource.clarity);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
    this.unsubscribeQuality?.();
    for (const record of this.records.values()) record.handle.destroy();
    this.records.clear();
    this.destroyBuffers();
  }

  private rebuildBuffers(profile: GraphicsQualityProfile): void {
    if (this.destroyed) return;
    this.profileLevel = profile.level;
    this.destroyBuffers();
    if (!isWebGlScene(this.scene) || !profile.sharedGlow.enabled) return;
    this.world = this.createCameraBuffer('world', profile);
    this.clarity = this.createCameraBuffer('clarity', profile);
  }

  private createCameraBuffer(cameraMode: 'world' | 'clarity', profile: GraphicsQualityProfile): GlowCameraBuffer {
    const near = this.createBandBuffer(cameraMode, 'near', profile);
    const far = profile.sharedGlow.far ? this.createBandBuffer(cameraMode, 'far', profile) : null;
    return { near, far };
  }

  private createBandBuffer(
    cameraMode: 'world' | 'clarity',
    band: 'near' | 'far',
    profile: GraphicsQualityProfile,
  ): GlowBandBuffer {
    const key = `${SHARED_GLOW_TEXTURE_PREFIX}_${this.id}_${cameraMode}_${band}`;
    const width = Math.max(2, Math.ceil(GAME_WIDTH * profile.sharedGlow.bufferScale));
    const height = Math.max(2, Math.ceil(GAME_HEIGHT * profile.sharedGlow.bufferScale));
    const texture = this.scene.textures.addDynamicTexture(key, width, height);
    if (!texture) throw new Error(`Unable to create shared glow texture ${key}`);
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    texture.clear().render();

    const image = this.scene.add.image(0, 0, key)
      .setOrigin(0, 0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setScrollFactor(0)
      .setDepth(cameraMode === 'world' ? DEPTH.CANOPY - 0.01 : DEPTH.OVERLAY - 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    if (cameraMode === 'clarity') getClarityCameraRegistry(this.scene)?.promote(image);

    image.enableFilters();
    const filters = image.filters?.internal;
    if (!filters) throw new Error(`Unable to enable shared glow filters for ${key}`);
    const settings = band === 'far' ? profile.sharedGlow.far! : profile.sharedGlow.near;
    const blur = filters.addBlur(
      settings.quality,
      settings.offsetPx * profile.sharedGlow.bufferScale,
      settings.offsetPx * profile.sharedGlow.bufferScale,
      1,
      0xffffff,
      settings.steps,
    ) as GlowBandBuffer['blur'];
    blur.active = true;
    return { textureKey: key, texture, image, blur };
  }

  private setBuffersVisible(visible: boolean): void {
    this.world?.near.image.setVisible(visible);
    this.world?.far?.image.setVisible(visible);
    this.clarity?.near.image.setVisible(visible);
    this.clarity?.far?.image.setVisible(visible);
  }

  private setBandVisibility(buffer: GlowCameraBuffer | null, visible: { near: boolean; far: boolean }): void {
    if (!buffer) return;
    buffer.near.image.setVisible(visible.near);
    buffer.far?.image.setVisible(visible.far);
  }

  private destroyBuffers(): void {
    destroyBandBuffer(this.scene, this.world?.near ?? null);
    destroyBandBuffer(this.scene, this.world?.far ?? null);
    destroyBandBuffer(this.scene, this.clarity?.near ?? null);
    destroyBandBuffer(this.scene, this.clarity?.far ?? null);
    this.world = null;
    this.clarity = null;
  }
}

export class SharedGlowHandle implements SharedGlowHandleLike {
  active = true;
  fallbackHandle: SharedGlowHandleLike['fallbackHandle'] = null;
  private destroyed = false;
  private _outerStrength: number;
  private _innerStrength: number;
  private _color: number;

  constructor(
    private readonly system: SharedGlowSystem,
    private readonly request: SharedGlowRequest,
  ) {
    this._outerStrength = request.outerStrength;
    this._innerStrength = request.innerStrength;
    this._color = request.color;
  }

  get outerStrength(): number { return this.fallbackHandle?.outerStrength ?? this._outerStrength; }
  set outerStrength(value: number) {
    this._outerStrength = value;
    if (this.fallbackHandle) this.fallbackHandle.outerStrength = value;
  }

  get innerStrength(): number { return this.fallbackHandle?.innerStrength ?? this._innerStrength; }
  set innerStrength(value: number) {
    this._innerStrength = value;
    if (this.fallbackHandle) {
      this.fallbackHandle.innerStrength = value;
    } else if (value > 0) {
      this.system.requestFallback(this);
    }
  }

  get color(): number { return this.fallbackHandle?.color ?? this._color; }
  set color(value: number) {
    this._color = value;
    if (this.fallbackHandle) this.fallbackHandle.color = value;
  }

  setActive(active: boolean): this {
    this.active = active;
    this.fallbackHandle?.setActive?.(active);
    return this;
  }

  setFallbackHandle(handle: SharedGlowHandleLike['fallbackHandle']): void {
    this.fallbackHandle = handle;
    if (!handle) return;
    handle.outerStrength = this._outerStrength;
    handle.innerStrength = this._innerStrength;
    handle.color = this._color;
    handle.setActive?.(this.active);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fallbackHandle?.destroy?.();
    this.fallbackHandle = null;
    this.system.remove(this);
  }
}

const systems = new WeakMap<Phaser.Scene, SharedGlowSystem>();

export function installSharedGlowSystem(scene: Phaser.Scene): SharedGlowSystem {
  const existing = systems.get(scene);
  if (existing) return existing;
  const system = new SharedGlowSystem(scene);
  systems.set(scene, system);
  return system;
}

export function getSharedGlowSystem(scene: Phaser.Scene): SharedGlowSystem | null {
  return systems.get(scene) ?? null;
}

export function destroySharedGlowSystem(scene: Phaser.Scene): void {
  const system = systems.get(scene);
  if (!system) return;
  system.destroy();
  systems.delete(scene);
}
