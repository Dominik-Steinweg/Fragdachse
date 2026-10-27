import type * as Phaser from 'phaser';
import { PIPELINE_ASSETS } from '../config/pipelineAssets';
import type { MeshShadowCaster } from './EnemyMeshShadowRenderer';
import { TURRET_SHADOW_HEIGHT_SCALE } from './ShadowConfig';

/** Visits every turret sprite an owner shows; `raised` when it stands on a base surface (fort decks, outposts). */
export type TurretShadowSource = (visit: (sprite: Phaser.GameObjects.Sprite, raised: boolean) => void) => void;

/** Idle and sheet textures of every turret resolve to the pipeline asset its mesh belongs to. */
const TURRET_TEXTURES = new Map(PIPELINE_ASSETS.filter(asset => asset.category === 'turret')
  .flatMap(asset => [[asset.textureKey, asset], [asset.sheetTextureKey, asset]] as const));

class TurretCaster implements MeshShadowCaster {
  readonly kind = 'turret';
  readonly mountedShadow = true;
  plane = 0;
  seen = 0;
  constructor(readonly sprite: Phaser.GameObjects.Sprite) {}
  getImageKey(): string { return TURRET_TEXTURES.get(this.sprite.texture.key)?.textureKey ?? this.sprite.texture.key; }
  getHp(): number { return this.sprite.active ? 1 : 0; }
  isBurrowed(): boolean { return false; }
  getHopLiftScale(): number { return 1; }
  getShadowHeightScale(): number { return TURRET_SHADOW_HEIGHT_SCALE; }
  getShadowReceiverPlane(): number { return this.plane; }
}

/**
 * Turret sprites as mesh shadow casters, beside the enemies: the same sun projection, penumbra and
 * receiver. Owners register a source; a caster lives as long as some source still visits its sprite.
 */
export class ShadowTurretCasters {
  private readonly sources = new Set<TurretShadowSource>();
  private readonly casters = new Map<Phaser.GameObjects.Sprite, TurretCaster>();
  private out: MeshShadowCaster[] = [];
  private tick = 0;
  private readonly visit = (sprite: Phaser.GameObjects.Sprite, raised: boolean): void => {
    if (!sprite.active || !TURRET_TEXTURES.has(sprite.texture.key)) return;
    let caster = this.casters.get(sprite);
    if (!caster) { caster = new TurretCaster(sprite); this.casters.set(sprite, caster); }
    caster.plane = raised ? 1 : 0;
    caster.seen = this.tick;
    this.out.push(caster);
  };

  /** Registers an owner's turret sprites; the returned function unregisters them. */
  addSource(source: TurretShadowSource): () => void {
    this.sources.add(source);
    return () => { this.sources.delete(source); };
  }

  /** Appends this frame's turret casters to `out`. */
  collect(out: MeshShadowCaster[]): void {
    this.tick++;
    this.out = out;
    for (const source of this.sources) source(this.visit);
    for (const [sprite, caster] of this.casters) if (caster.seen !== this.tick) this.casters.delete(sprite);
  }

  destroy(): void {
    this.sources.clear();
    this.casters.clear();
  }
}
