import type * as Phaser from 'phaser';

const GAME_OBJECT_DESTROY_EVENT = 'destroy';

export type GraphicsQuality = 'high' | 'medium' | 'low';
export type VisualImportance = 'critical' | 'standard' | 'decorative';

export interface GraphicsQualityProfile {
  readonly level: GraphicsQuality;
  readonly particleFactors: Readonly<Record<VisualImportance, number>>;
  readonly lightMapScale: number;
  readonly maxLightsPerFrame: number;
  readonly maxOccludingLightsPerFrame: number;
  readonly shadowLayerFactor: number;
  readonly projectileShadows: boolean;
  readonly externalDecorativeFilters: boolean;
  readonly decorativeFilters: boolean;
}

export const GRAPHICS_QUALITY_PROFILES: Readonly<Record<GraphicsQuality, GraphicsQualityProfile>> = {
  high: {
    level: 'high',
    particleFactors: { critical: 1, standard: 1, decorative: 1 },
    lightMapScale: 0.5,
    // Deutlich über der Zahl gleichzeitig sichtbarer Lichtquellen: sonst schneidet der
    // Sortier-/Truncate-Schritt jeden Frame andere Lichter weg, und mit dem Flackern der
    // Intensitäten springt der Grenzfall sichtbar an und aus. Ein reines Stamp-Licht ohne
    // Verdeckung ist ein einzelner Draw, die Obergrenze darf deshalb großzügig sein.
    maxLightsPerFrame: 200,
    maxOccludingLightsPerFrame: 6,
    shadowLayerFactor: 1,
    projectileShadows: true,
    externalDecorativeFilters: true,
    decorativeFilters: true,
  },
  medium: {
    level: 'medium',
    particleFactors: { critical: 0.8, standard: 0.65, decorative: 0.45 },
    lightMapScale: 0.375,
    maxLightsPerFrame: 120,
    maxOccludingLightsPerFrame: 2,
    shadowLayerFactor: 0.5,
    projectileShadows: true,
    externalDecorativeFilters: false,
    decorativeFilters: true,
  },
  low: {
    level: 'low',
    particleFactors: { critical: 0.6, standard: 0.35, decorative: 0 },
    lightMapScale: 0.25,
    maxLightsPerFrame: 64,
    maxOccludingLightsPerFrame: 0,
    shadowLayerFactor: 0.25,
    projectileShadows: false,
    externalDecorativeFilters: false,
    decorativeFilters: false,
  },
};

export function isGraphicsQuality(value: unknown): value is GraphicsQuality {
  return value === 'high' || value === 'medium' || value === 'low';
}

type QualityListener = (profile: GraphicsQualityProfile, previous: GraphicsQuality) => void;

interface TrackedEmitter {
  readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  importance: VisualImportance;
  readonly frequency: number;
  readonly quantity: Phaser.Types.GameObjects.Particles.EmitterOpOnEmitType;
  readonly maxAliveParticles: number;
  readonly estimatedAliveParticles: number;
  readonly originalExplode: Phaser.GameObjects.Particles.ParticleEmitter['explode'];
  readonly originalEmitParticleAt: Phaser.GameObjects.Particles.ParticleEmitter['emitParticleAt'];
  manualEmissionCarry: number;
  destroyHandler: () => void;
}

interface TrackedFilter {
  readonly target: { off?: (event: string, listener: () => void) => void };
  readonly handle: { active?: boolean; setActive?: (active: boolean) => unknown };
  readonly external: boolean;
  readonly importance: VisualImportance;
  readonly destroyHandler: () => void;
}

const controllers = new WeakMap<Phaser.Scene, GraphicsQualityController>();

export class GraphicsQualityController {
  private level: GraphicsQuality;
  private readonly listeners = new Set<QualityListener>();
  private readonly emitters = new Map<Phaser.GameObjects.Particles.ParticleEmitter, TrackedEmitter>();
  private readonly filters = new Set<TrackedFilter>();
  private ablationFiltersDisabled = false;
  private particleFactory: Phaser.GameObjects.GameObjectFactory['particles'] | null = null;
  private attachedScene: Phaser.Scene | null = null;

  constructor(initialLevel: GraphicsQuality = 'high') {
    this.level = initialLevel;
  }

  attach(scene: Phaser.Scene): void {
    if (this.attachedScene === scene) return;
    controllers.set(scene, this);
    this.attachedScene = scene;
    this.particleFactory = scene.add.particles.bind(scene.add);
    scene.add.particles = ((
      x?: number,
      y?: number,
      texture?: string | Phaser.Textures.Texture,
      config?: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
    ) => {
      const resolvedConfig = config ?? {};
      const emitter = this.particleFactory!(x, y, texture, resolvedConfig);
      this.trackEmitter(emitter, resolvedConfig);
      return emitter;
    }) as Phaser.GameObjects.GameObjectFactory['particles'];
  }

  getLevel(): GraphicsQuality {
    return this.level;
  }

  getProfile(): GraphicsQualityProfile {
    return GRAPHICS_QUALITY_PROFILES[this.level];
  }

  /**
   * Diagnose-Schalter des Ablationsmodus: schaltet **alle** getrackten Filter ab, unabhaengig
   * von Qualitaetsstufe und Wichtigkeit. Nur fuer Messungen gedacht; im Normalbetrieb immer
   * `false`. Der Qualitaets-Pfad bleibt unveraendert und greift wieder, sobald zurueckgesetzt
   * wird (siehe {@link PerformanceAblationController}).
   */
  setAblationFiltersDisabled(disabled: boolean): void {
    if (this.ablationFiltersDisabled === disabled) return;
    this.ablationFiltersDisabled = disabled;
    for (const tracked of this.filters) this.applyFilterProfile(tracked);
  }

  setLevel(level: GraphicsQuality): void {
    if (this.level === level) return;
    const previous = this.level;
    this.level = level;
    for (const tracked of this.emitters.values()) this.applyEmitterProfile(tracked);
    for (const tracked of this.filters) this.applyFilterProfile(tracked);
    for (const listener of this.listeners) listener(this.getProfile(), previous);
  }

  subscribe(listener: QualityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  scaleParticleCount(count: number, importance: VisualImportance = 'standard'): number {
    if (!Number.isFinite(count) || count <= 0) return 0;
    const factor = this.getProfile().particleFactors[importance];
    if (factor <= 0) return 0;
    return Math.max(1, Math.round(count * factor));
  }

  trackEmitter(
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
    importance: VisualImportance = 'standard',
  ): void {
    const existing = this.emitters.get(emitter);
    if (existing) {
      existing.importance = importance;
      this.applyEmitterProfile(existing);
      return;
    }
    const frequency = typeof config.frequency === 'number' ? config.frequency : 0;
    const quantity = config.quantity ?? 1;
    const maxAliveParticles = typeof config.maxAliveParticles === 'number' ? config.maxAliveParticles : 0;
    const lifespan = typeof config.lifespan === 'number' ? config.lifespan : 0;
    const estimatedAliveParticles = frequency > 0 && lifespan > 0
      ? Math.ceil((lifespan / frequency) * Math.max(1, typeof quantity === 'number' ? quantity : 1))
      : 0;
    const tracked: TrackedEmitter = {
      emitter,
      importance,
      frequency,
      quantity,
      maxAliveParticles,
      estimatedAliveParticles,
      originalExplode: emitter.explode.bind(emitter),
      originalEmitParticleAt: emitter.emitParticleAt.bind(emitter),
      manualEmissionCarry: 0,
      destroyHandler: () => undefined,
    };
    emitter.explode = (count?: number, x?: number, y?: number) => {
      if (count === undefined) return tracked.originalExplode(undefined, x, y);
      const scaled = this.scaleParticleCount(count, tracked.importance);
      return scaled > 0 ? tracked.originalExplode(scaled, x, y) : undefined;
    };
    emitter.emitParticleAt = (x?: number, y?: number, count?: number) => {
      if (count === undefined) return tracked.originalEmitParticleAt(x, y, undefined);
      const factor = this.getProfile().particleFactors[tracked.importance];
      tracked.manualEmissionCarry += Math.max(0, count) * factor;
      const scaled = Math.floor(tracked.manualEmissionCarry);
      tracked.manualEmissionCarry -= scaled;
      return scaled > 0 ? tracked.originalEmitParticleAt(x, y, scaled) : undefined;
    };
    tracked.destroyHandler = () => this.emitters.delete(emitter);
    emitter.once(GAME_OBJECT_DESTROY_EVENT, tracked.destroyHandler);
    this.emitters.set(emitter, tracked);
    this.applyEmitterProfile(tracked);
  }

  setEmitterImportance(
    emitter: Phaser.GameObjects.Particles.ParticleEmitter,
    importance: VisualImportance,
  ): void {
    const tracked = this.emitters.get(emitter);
    if (!tracked) return;
    tracked.importance = importance;
    this.applyEmitterProfile(tracked);
  }

  trackFilter(
    target: { once?: (event: string, listener: () => void) => void; off?: (event: string, listener: () => void) => void },
    handle: { active?: boolean; setActive?: (active: boolean) => unknown },
    external: boolean,
    importance: VisualImportance = 'standard',
  ): void {
    const tracked: TrackedFilter = {
      target,
      handle,
      external,
      importance,
      destroyHandler: () => this.filters.delete(tracked),
    };
    target.once?.(GAME_OBJECT_DESTROY_EVENT, tracked.destroyHandler);
    this.filters.add(tracked);
    this.applyFilterProfile(tracked);
  }

  untrackFilter(handle: object): void {
    for (const tracked of this.filters) {
      if (tracked.handle !== handle) continue;
      tracked.target.off?.(GAME_OBJECT_DESTROY_EVENT, tracked.destroyHandler);
      this.filters.delete(tracked);
      return;
    }
  }

  destroy(): void {
    for (const tracked of this.emitters.values()) {
      tracked.emitter.off(GAME_OBJECT_DESTROY_EVENT, tracked.destroyHandler);
    }
    for (const tracked of this.filters) {
      tracked.target.off?.(GAME_OBJECT_DESTROY_EVENT, tracked.destroyHandler);
    }
    this.emitters.clear();
    this.filters.clear();
    this.listeners.clear();
    if (this.attachedScene && this.particleFactory) {
      controllers.delete(this.attachedScene);
      this.attachedScene.add.particles = this.particleFactory;
    }
    this.attachedScene = null;
    this.particleFactory = null;
  }

  private applyEmitterProfile(tracked: TrackedEmitter): void {
    const factor = this.getProfile().particleFactors[tracked.importance];
    const frequency = tracked.frequency > 0 && factor > 0
      ? Math.max(1, Math.round(tracked.frequency / factor))
      : tracked.frequency;
    // Flow-Emitter werden ueber das Intervall skaliert. Die Menge gleichzeitig ebenfalls
    // zu reduzieren wuerde den Faktor quadrieren. Manuelle Bursts laufen ueber die Wrapper oben.
    tracked.emitter.setFrequency(frequency, factor <= 0 ? 0 : tracked.quantity);

    const baselineAlive = tracked.maxAliveParticles > 0
      ? tracked.maxAliveParticles
      : tracked.estimatedAliveParticles;
    if (baselineAlive > 0) {
      tracked.emitter.maxAliveParticles = factor <= 0 ? 1 : Math.max(1, Math.round(baselineAlive * factor));
    }
  }

  private applyFilterProfile(tracked: TrackedFilter): void {
    const profile = this.getProfile();
    const active = !this.ablationFiltersDisabled
      && (tracked.importance === 'critical'
        || (profile.decorativeFilters && (!tracked.external || profile.externalDecorativeFilters)));
    if (tracked.handle.setActive) tracked.handle.setActive(active);
    else tracked.handle.active = active;
  }
}

export function getGraphicsQualityController(scene: Phaser.Scene): GraphicsQualityController | null {
  return controllers.get(scene) ?? null;
}

export function getGraphicsQualityProfile(scene: Phaser.Scene): GraphicsQualityProfile {
  return getGraphicsQualityController(scene)?.getProfile() ?? GRAPHICS_QUALITY_PROFILES.high;
}

export function scaleParticleCount(
  scene: Phaser.Scene,
  count: number,
  importance: VisualImportance = 'standard',
): number {
  const controller = getGraphicsQualityController(scene);
  if (controller) return controller.scaleParticleCount(count, importance);
  return Math.max(0, Math.round(count));
}
