import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { getCoopDefenseConstructionDefinition } from '../config/coopDefenseConstructions';
import { getTurretVisualSpec } from '../config/turretVisuals';
import type { SyncedPlaceableRock } from '../types';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import { ensureCanvasTexture } from './EffectUtils';

const TEXTURE = '__construction_ownership';
const EASE = 'Sine.easeInOut';
const DEAD = { x: 0, y: 0, scaleX: 0, scaleY: 0, alpha: 0 };
type Member = Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member>;

export interface ConstructionOwnershipTarget {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: number;
}
interface Marker extends ConstructionOwnershipTarget {
  readonly slot: number;
  readonly passive: boolean;
  readonly own: boolean;
}

/** Geometry is independent of HP, aim angle and the current animation frame. */
export function constructionOwnershipTarget(rock: SyncedPlaceableRock, metrics: WorldMetrics): ConstructionOwnershipTarget {
  const definition = getCoopDefenseConstructionDefinition(rock.constructionId!);
  // Symmetric envelope: even asymmetric footprints stay anchored at the runtime cell.
  let halfWidth = CELL_SIZE / 2;
  let halfHeight = CELL_SIZE / 2;
  for (const cell of definition.footprint) {
    halfWidth = Math.max(halfWidth, (Math.abs(cell.dx) + 0.5) * CELL_SIZE);
    halfHeight = Math.max(halfHeight, (Math.abs(cell.dy) + 0.5) * CELL_SIZE);
  }
  if (rock.kind === 'turret') {
    const size = getTurretVisualSpec(rock.turretWeaponId ?? (definition.kind === 'turret' ? definition.weaponId : 'SPORES')).displaySize;
    // Sprite bounds include transparent padding; never extend into a neighbouring cell.
    halfWidth = Math.min(halfWidth, size / 2);
    halfHeight = Math.min(halfHeight, size / 2);
  }
  // Keep the entire marker quad (including its glow) inside the occupied footprint.
  return { id: rock.id, ...worldCellCenter(metrics, rock.gridX, rock.gridY),
    width: halfWidth * 2 - 2, height: halfHeight * 2 - 2, color: rock.ownerColor };
}

/** World-owned persistent markers. Only Runtime-Rock IDs own slots, never construction types. */
export class ConstructionOwnershipGpuSystem {
  private readonly passiveLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly activeLayer: Phaser.GameObjects.SpriteGPULayer;
  private readonly markers = new Map<number, Marker>();
  private readonly free: number[] = [];
  private readonly seen = new Set<number>();
  private readonly ownTargets: ConstructionOwnershipTarget[] = [];
  private capacity = 64;
  private nextSlot = 0;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureOwnershipTexture(scene);
    this.passiveLayer = scene.add.spriteGPULayer(TEXTURE, this.capacity);
    this.passiveLayer.name = 'construction-ownership-passive';
    this.passiveLayer.setDepth(DEPTH.ROCKS - 0.1).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.activeLayer = scene.add.spriteGPULayer(TEXTURE, this.capacity * 2);
    this.activeLayer.name = 'construction-ownership-active';
    this.activeLayer.setDepth(DEPTH.ROCKS + 0.3).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.activeLayer.setAnimationEnabled(EASE, true);
  }

  sync(rocks: readonly SyncedPlaceableRock[], ownIds: ReadonlySet<number>, metrics: WorldMetrics,
    visible: boolean, active: boolean): readonly ConstructionOwnershipTarget[] {
    this.ownTargets.length = 0;
    if (this.destroyed) return this.ownTargets;
    this.seen.clear();
    let passiveCount = 0;
    for (const rock of rocks) {
      if (!rock.constructionId || rock.ownership === 'base-owned') continue;
      this.seen.add(rock.id);
      const target = constructionOwnershipTarget(rock, metrics);
      const passive = rock.kind === 'rock';
      const own = ownIds.has(rock.id);
      const previous = this.markers.get(rock.id);
      let marker = previous;
      if (!previous || previous.x !== target.x || previous.y !== target.y
        || previous.width !== target.width || previous.height !== target.height
        || previous.color !== target.color || previous.passive !== passive || previous.own !== own) {
        const recycled = previous?.slot ?? this.free.pop();
        const append = recycled === undefined;
        const slot = recycled ?? this.nextSlot++;
        if (slot >= this.capacity) {
          this.capacity *= 2;
          this.passiveLayer.resize(this.capacity, false);
          this.activeLayer.resize(this.capacity * 2, false);
        }
        marker = { ...target, slot, passive, own };
        this.markers.set(rock.id, marker);
        this.write(marker, append);
      }
      if (passive) passiveCount++;
      if (own) this.ownTargets.push(marker!);
    }
    for (const [id, marker] of this.markers) {
      if (this.seen.has(id)) continue;
      this.passiveLayer.editMember(marker.slot, DEAD);
      this.activeLayer.editMember(marker.slot * 2, DEAD);
      this.activeLayer.editMember(marker.slot * 2 + 1, DEAD);
      this.free.push(marker.slot);
      this.markers.delete(id);
    }
    this.passiveLayer.setVisible(visible && passiveCount > 0);
    this.activeLayer.setVisible(visible && active && this.ownTargets.length > 0);
    return this.ownTargets;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.passiveLayer.destroy(); this.activeLayer.destroy();
    this.markers.clear(); this.free.length = 0; this.ownTargets.length = 0; this.seen.clear();
    // Immutable atlas belongs to the Scene TextureManager, reused by subsequent worlds.
  }

  private write(marker: Marker, append: boolean): void {
    const texture = this.scene.textures.get(TEXTURE);
    const member = (frame: string, color: number, alpha: Member['alpha'], expand = 1): Member => ({
      x: marker.x, y: marker.y, frame: texture.get(frame),
      scaleX: marker.width / 128 * expand, scaleY: marker.height / 128 * expand,
      alpha, tintBlend: 1, tintTopLeft: color, tintTopRight: color, tintBottomLeft: color, tintBottomRight: color,
      creationTime: -((marker.id * 389) % 3200),
    });
    const pulse = (min: number, max: number): Member['alpha'] => ({
      base: min, amplitude: max - min, duration: 1600, ease: EASE, loop: true, yoyo: true,
    });
    const passive = marker.passive ? member('aura', marker.color, 0.22, 1.55) : DEAD;
    const glow = marker.own ? member('glow', marker.color, pulse(0.28, 0.44)) : DEAD;
    const core = marker.own ? member('core', 0xf3f7ff, pulse(0.48, 0.68)) : DEAD;
    if (append) {
      this.passiveLayer.addMember(passive);
      this.activeLayer.addMember(glow); this.activeLayer.addMember(core);
    } else {
      this.passiveLayer.editMember(marker.slot, passive);
      this.activeLayer.editMember(marker.slot * 2, glow); this.activeLayer.editMember(marker.slot * 2 + 1, core);
    }
  }
}

function ensureOwnershipTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEXTURE, 512, 128, (ctx, texture) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,0.15)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    texture.add('aura', 0, 0, 0, 128, 128);
    const corners = (offset: number, width: number, alpha: number): void => {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = width; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = offset + 64 + sx * 56; const y = 64 + sy * 56;
        ctx.moveTo(x - sx * 14, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * 14);
      }
      ctx.stroke();
    };
    corners(128, 12, 0.07); corners(128, 8, 0.12); corners(128, 5, 0.38);
    corners(256, 3.5, 1);
    texture.add('glow', 0, 128, 0, 128, 128);
    texture.add('core', 0, 256, 0, 128, 128);
  });
}
