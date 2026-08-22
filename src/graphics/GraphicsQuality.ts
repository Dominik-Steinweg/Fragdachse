import type * as Phaser from 'phaser';

const GAME_OBJECT_DESTROY_EVENT = 'destroy';

export type GraphicsQuality = 'high' | 'medium' | 'low';
export type VisualImportance = 'critical' | 'standard' | 'decorative';
export type FilterScope = 'object' | 'camera';

export interface SharedGlowBandProfile {
  readonly quality: 0 | 1 | 2;
  readonly offsetPx: number;
  readonly steps: number;
}

export interface SharedGlowProfile {
  readonly enabled: boolean;
  readonly bufferScale: number;
  readonly importance: Readonly<Record<VisualImportance, boolean>>;
  readonly near: SharedGlowBandProfile;
  readonly far: SharedGlowBandProfile | null;
}

export interface GraphicsQualityProfile {
  readonly level: GraphicsQuality;
  readonly particleFactors: Readonly<Record<VisualImportance, number>>;
  readonly lightMapScale: number;
  readonly maxLightsPerFrame: number;
  readonly maxOccludingLightsPerFrame: number;
  readonly shadowLayerFactor: number;
  readonly projectileShadows: boolean;
  /**
   * Schatten bewegter Werfer (Spieler, Gegner, Zug, Projektile). Sie werden – anders als die
   * statischen – jeden Frame als gestapelte Alpha-Fuellungen neu gezeichnet und lassen sich
   * nicht backen. In `low` bewusst abgeschaltet: dort zaehlt Bildrate mehr als die Plastik
   * bewegter Objekte.
   */
  readonly dynamicShadows: boolean;
  /**
   * Der lebendige Balken-Effekt (LivingBarEffect) in HUD, Menues und Overlays sowie der
   * gleichartige Anteil des PlayerStatusRing. Beide zeigen dasselbe GPU-Feld: die Balken als
   * getintete Ausschnitte einer geteilten, offscreen gerenderten Feldtextur, der Ring als
   * eigener Shader-Quad im Polarraum.
   *
   * In `low` komplett aus. Der Schalter ist deshalb kein reines Sichtbarkeitsflag: ohne ihn
   * bliebe die geteilte Feldtextur fuer unsichtbare Balken am Rendern, und die Puls-Anmeldungen
   * am Atem-Treiber liefen weiter. Zwischen `high` und `medium` unterscheidet sich nur die
   * Renderkadenz des Feldes (30 Hz gegen 20 Hz); seine Aufloesung bleibt fest, weil jedes
   * Balken-Image einen Frame darauf haelt und ein Groessenwechsel die Textur unter allen
   * bestehenden Konsumenten austauschen wuerde.
   */
  readonly livingBarEffects: boolean;
  readonly externalDecorativeFilters: boolean;
  readonly decorativeFilters: boolean;
  readonly sharedGlow: SharedGlowProfile;
  /**
   * Obergrenze für die Renderauflösung relativ zum 1920x1080-Designraum (siehe
   * `graphics/RenderResolution`). Ein hochauflösender Monitor kostet quadratisch Fill-Rate:
   * WQHD bedeutet 1,78-mal so viele Fragmente wie 1080p. `low` bleibt deshalb bewusst beim
   * Designraum und nimmt die weichere CSS-Skalierung des Browsers in Kauf.
   */
  readonly maxRenderScale: number;
  /**
   * Gemeinsamer Faktor auf alle Amplituden des Kamera-Feedbacks. Bewusst **kein** An/Aus-Schalter:
   * Rumpeln bei Nuke-Countdown, Airstrike-Warnung oder anfliegendem Meteor ist lesbare
   * Telegraphie und muss auch in `low` erhalten bleiben. Es skaliert, es verschwindet nicht.
   */
  readonly cameraMotionScale: number;
  /**
   * Silhouettenblitz am getroffenen Ziel. Überall an: es ist die einzige unmittelbare
   * Rückmeldung am Ziel selbst und damit Lesbarkeit, keine Dekoration.
   */
  readonly hitFlash: boolean;
  /** Rein visueller Trefferimpuls der getroffenen Figur. In `low` aus. */
  readonly entityJolt: boolean;
  /** Feste Poolgröße der Trefferkopien. Zur Laufzeit wird nie nachallokiert. */
  readonly hitFlashPoolSize: number;
  /** Dezentes Color-Grading der Weltkamera (Sättigung, Kontrast, Helligkeit, Farbbalance). */
  readonly worldColorGrade: boolean;
  readonly worldVignette: boolean;
  /**
   * Kontrollierter Schwellenwert-Bloom der Weltkamera. `event` heißt: kein Dauerbloom, aber
   * außergewöhnliche Ereignisse dürfen ihn kurz hochziehen.
   *
   * Der Bloom ist der mit Abstand teuerste Posten der Bildkomposition: er kostet einen
   * Offscreen-Pass in Backing-Store-Auflösung plus Blur-Schritte, und die Renderauflösung geht
   * quadratisch ein.
   */
  readonly worldBloom: 'full' | 'event' | 'off';
  /** Kurzzeitige Ereignispulse (Nuke, Bossphase, Tod). */
  readonly eventPostFx: boolean;
  /**
   * Lokale Bildverzerrung (Zeitblase, Schwarzes Loch, Druckwelle). Aus bleiben in `low` die
   * bestehenden Membran-, Ring- und Partikeldarstellungen unverändert erhalten – nur die
   * Verzerrung der Welt dahinter entfällt.
   */
  readonly localDistortion: boolean;
  /** Obergrenze gleichzeitig gezeichneter Verzerrungsquellen. */
  readonly maxDistortionSources: number;
  /**
   * Auflösung der Verschiebungskarte relativ zum Designraum. Sie darf klein sein: die Karte
   * trägt weiche Richtungsfelder, keine Details. 0 schaltet sie ab.
   */
  readonly distortionMapScale: number;
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
    dynamicShadows: true,
    livingBarEffects: true,
    externalDecorativeFilters: true,
    decorativeFilters: true,
    sharedGlow: {
      enabled: true,
      bufferScale: 1,
      importance: { critical: true, standard: true, decorative: true },
      near: { quality: 2, offsetPx: 2.75, steps: 4 },
      far: { quality: 2, offsetPx: 5.5, steps: 6 },
    },
    maxRenderScale: 2,
    cameraMotionScale: 1,
    hitFlash: true,
    entityJolt: true,
    hitFlashPoolSize: 24,
    worldColorGrade: true,
    worldVignette: true,
    worldBloom: 'full',
    eventPostFx: true,
    localDistortion: true,
    maxDistortionSources: 6,
    distortionMapScale: 0.25,
  },
  medium: {
    level: 'medium',
    particleFactors: { critical: 0.8, standard: 0.65, decorative: 0.45 },
    lightMapScale: 0.375,
    maxLightsPerFrame: 120,
    maxOccludingLightsPerFrame: 2,
    shadowLayerFactor: 0.5,
    projectileShadows: true,
    dynamicShadows: true,
    livingBarEffects: true,
    externalDecorativeFilters: false,
    decorativeFilters: true,
    sharedGlow: {
      enabled: true,
      bufferScale: 0.5,
      importance: { critical: true, standard: true, decorative: true },
      near: { quality: 1, offsetPx: 2.75, steps: 3 },
      far: { quality: 1, offsetPx: 5.5, steps: 4 },
    },
    maxRenderScale: 1.5,
    cameraMotionScale: 1,
    hitFlash: true,
    entityJolt: true,
    hitFlashPoolSize: 16,
    worldColorGrade: true,
    worldVignette: true,
    worldBloom: 'event',
    eventPostFx: true,
    localDistortion: true,
    maxDistortionSources: 3,
    distortionMapScale: 0.1875,
  },
  low: {
    level: 'low',
    particleFactors: { critical: 0.6, standard: 0.35, decorative: 0 },
    lightMapScale: 0.25,
    maxLightsPerFrame: 64,
    maxOccludingLightsPerFrame: 0,
    shadowLayerFactor: 0.25,
    projectileShadows: false,
    dynamicShadows: false,
    livingBarEffects: false,
    externalDecorativeFilters: false,
    decorativeFilters: false,
    sharedGlow: {
      enabled: true,
      bufferScale: 0.25,
      importance: { critical: true, standard: false, decorative: false },
      near: { quality: 0, offsetPx: 2.75, steps: 1 },
      far: null,
    },
    maxRenderScale: 1,
    cameraMotionScale: 0.7,
    hitFlash: true,
    entityJolt: false,
    hitFlashPoolSize: 12,
    worldColorGrade: false,
    worldVignette: false,
    worldBloom: 'off',
    eventPostFx: false,
    localDistortion: false,
    maxDistortionSources: 0,
    distortionMapScale: 0,
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
  readonly scope: FilterScope;
  readonly shared: boolean;
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

  /** Diagnose-Schalter fuer Objektfilter. Kamera-PostFX werden separat abgetragen. */
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
    // Phaser 4.2.1 initialisiert auch ohne `sortProperty` einen Sort-Callback. Die Renderer
    // sortieren dadurch den Alive-Pool jedes Frame, obwohl der Vergleich fuer den leeren
    // Property-Namen immer gleich ist. Nur explizit konfigurierte Sortierung behalten.
    if (!config.sortCallback && !config.sortProperty) emitter.setSortCallback();
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
    scope: FilterScope = 'object',
    shared = false,
  ): void {
    const tracked: TrackedFilter = {
      target,
      handle,
      external,
      importance,
      scope,
      shared,
      destroyHandler: () => this.filters.delete(tracked),
    };
    target.once?.(GAME_OBJECT_DESTROY_EVENT, tracked.destroyHandler);
    this.filters.add(tracked);
    this.applyFilterProfile(tracked);
  }

  trackSharedGlow(
    target: { once?: (event: string, listener: () => void) => void; off?: (event: string, listener: () => void) => void },
    handle: { active?: boolean; setActive?: (active: boolean) => unknown },
    importance: VisualImportance = 'standard',
  ): void {
    this.trackFilter(target, handle, false, importance, 'object', true);
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
    const active = tracked.shared
      ? !(this.ablationFiltersDisabled && tracked.scope === 'object')
        && profile.sharedGlow.enabled
        && profile.sharedGlow.importance[tracked.importance]
      : !(this.ablationFiltersDisabled && tracked.scope === 'object')
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
