/** A projectile view owned by a feature presenter instead of the generic style renderers. */
export interface ProjectileCustomVisual {
  update(x: number, y: number, size: number, vx: number, vy: number): void;
  destroy(): void;
}
export interface ProjectileVisualRequest {
  readonly id: number;
  readonly weaponSourceId?: string;
  readonly x: number;
  readonly y: number;
}
export type ProjectileCustomVisualFactory = (projectile: ProjectileVisualRequest) => ProjectileCustomVisual | null;

/**
 * Scene-lifetime registry: feature presenters (e.g. the kraken's eggs and spines) claim projectiles by their
 * replicated weapon source and draw them with their own art. Host and client presentation consult it alike;
 * a registration only affects projectiles that appear while it is active.
 */
export class ProjectileVisualOverrides {
  private readonly factories = new Set<ProjectileCustomVisualFactory>();
  register(factory: ProjectileCustomVisualFactory): () => void {
    this.factories.add(factory);
    return () => { this.factories.delete(factory); };
  }
  create(projectile: ProjectileVisualRequest): ProjectileCustomVisual | null {
    if (!projectile.weaponSourceId) return null;
    for (const factory of this.factories) {
      const visual = factory(projectile);
      if (visual) return visual;
    }
    return null;
  }
}
