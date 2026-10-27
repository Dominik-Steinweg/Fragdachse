import * as Phaser from 'phaser';
import { addPlayerGlow } from './PlayerGlow';
import { removeInternalFx, type GlowHandle } from '../utils/phaserFx';


import { DEPTH_LIGHTING, NET_TICK_INTERVAL_MS } from '../config';
import { getTurretVisualSpec, getTurretVisualTransform, turretEmissionColor, turretEmissionKey } from '../config/turretVisuals';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';
import { turretAngleDifference } from '../utils/turretAngle';
import { pipelineAnimationKey, type PipelineAsset, type PipelineClip } from '../config/pipelineAssets';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome, TurretWeaponId } from '../types';

interface Binding {
  controlGlow?: GlowHandle | null;
  controlColor?: number;
  sprite: Phaser.GameObjects.Sprite;
  /** The turret's glowing parts above the light map, on the sprite's current frame. */
  glow: Phaser.GameObjects.Sprite | null;
  weaponId: TurretWeaponId;
  asset: PipelineAsset;
  clip: PipelineClip;
  activeUntil: number;
  dispose: () => void;
  pose?: { x: number; y: number; angle: number; from: number; target: number; elapsed: number };
}

/** Scene-owned presentation bindings; every binding ends with its world sprite. */
export class TurretAnimationController {
  syncControl(occupants: readonly { id: string; color: number }[]): void {
    const colors = new Map(occupants.map(occupant => [occupant.id, occupant.color]));
    for (const [id, binding] of this.bindings) {
      const color = colors.get(id);
      if (color === binding.controlColor) continue;
      if (binding.controlGlow) removeInternalFx(binding.sprite, binding.controlGlow);
      binding.controlColor = color;
      binding.controlGlow = color === undefined ? null : addPlayerGlow(binding.sprite, color, 1.4, 10, { rim: 0 });
    }

  }
  private readonly bindings = new Map<string, Binding>();
  private readonly activeTesla = new Set<string>();
  private now = 0;
  private lighting: Pick<LightingSystem, 'pulse'> | null = null;
  private readonly pulseOverrides = { color: 0xffffff };

  /** A shot of a glowing turret also lights its surroundings briefly in the glow's colour. */
  setLightingSystem(lighting: Pick<LightingSystem, 'pulse'> | null): void { this.lighting = lighting; }

  bind(id: string, sprite: Phaser.GameObjects.Sprite, weaponId: TurretWeaponId): void {
    const previous = this.bindings.get(id);
    if (previous?.sprite === sprite && previous.weaponId === weaponId) return;
    this.unbind(id);
    const asset = getTurretVisualSpec(weaponId).asset;
    sprite.setTexture(asset.sheetTextureKey, asset.idleFrame).setOrigin(asset.pivot[0], asset.pivot[1]);
    const dispose = () => this.unbind(id);
    const emission = turretEmissionKey(asset);
    // Self-lit like other emissive layers: just above the light map, under the canopy.
    const glow = emission && sprite.scene?.textures.exists(emission)
      ? sprite.scene.add.sprite(sprite.x, sprite.y, emission, asset.idleFrame).setOrigin(asset.pivot[0], asset.pivot[1])
        .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_LIGHTING + 0.08)
      : null;
    const binding: Binding = { sprite, glow, weaponId, asset,
      clip: asset.clips.find((clip) => clip.name === 'fire')!, activeUntil: 0, dispose };
    this.bindings.set(id, binding);
    this.syncGlow(binding);
    sprite.once('destroy', dispose);
  }

  unbind(id: string): void {
    const binding = this.bindings.get(id);
    if (!binding) return;
    this.bindings.delete(id);
    if (binding.controlGlow && !binding.sprite.isDestroyed) removeInternalFx(binding.sprite, binding.controlGlow);
    binding.sprite.off('destroy', binding.dispose);
    binding.glow?.destroy();
    // Phaser destroys AnimationState before emitting the sprite's destroy event.
    if (binding.sprite.active && !binding.sprite.isDestroyed) this.idle(binding);
  }

  /** The glow follows the sprite's frame, transform and visibility; the fire clip brightens it. */
  private syncGlow(binding: Binding): void {
    const glow = binding.glow, sprite = binding.sprite;
    if (!glow) return;
    glow.setVisible(sprite.visible && sprite.active);
    if (!glow.visible) return;
    if (glow.frame.name !== sprite.frame.name) glow.setFrame(sprite.frame.name);
    glow.setPosition(sprite.x, sprite.y).setRotation(sprite.rotation).setScale(sprite.scaleX, sprite.scaleY)
      .setFlip(sprite.flipX, sprite.flipY).setAlpha(emissiveAlpha(sprite.alpha));
  }

  /** Only presentation state: confirmed angles never flow back to simulation. */
  syncPose(id: string, x: number, y: number, angle: number, interpolate: boolean): void {
    const binding = this.bindings.get(id);
    if (!binding || !Number.isFinite(angle)) return;
    const pose = binding.pose;
    if (!interpolate || !pose || pose.x !== x || pose.y !== y) {
      binding.pose = { x, y, angle, from: angle, target: angle, elapsed: NET_TICK_INTERVAL_MS };
    } else if (pose.target !== angle) {
      pose.from = pose.angle;
      pose.target = angle;
      pose.elapsed = 0;
    }
    this.applyPose(binding);
  }

  private applyPose(binding: Binding): void {
    const pose = binding.pose;
    if (!pose) return;
    const transform = getTurretVisualTransform(getTurretVisualSpec(binding.weaponId), pose.x, pose.y, pose.angle);
    binding.sprite.setPosition(transform.x, transform.y).setRotation(transform.rotation);
  }

  /** Called only for a confirmed spawn, never for a snapshot refresh or baseline. */
  onShot(id: string): void {
    const binding = this.bindings.get(id);
    if (!binding || !binding.sprite.active || binding.weaponId === 'TURRET_TESLA') return;
    const key = pipelineAnimationKey(binding.asset, binding.clip);
    const color = binding.glow ? turretEmissionColor(binding.asset) : null;
    if (color !== null && this.lighting && binding.sprite.visible) {
      this.pulseOverrides.color = color;
      this.lighting.pulse('turretGlow', binding.sprite.x, binding.sprite.y, this.pulseOverrides);
    }
    if (binding.clip.loop) {
      binding.activeUntil = this.now + WEAPON_CONFIGS[binding.weaponId].cooldown + 2 * NET_TICK_INTERVAL_MS;
      binding.sprite.play(key, true);
    } else {
      binding.sprite.play(key); // A new discharge restarts even an unfinished recoil.
    }
  }

  syncTesla(domes: readonly SyncedTeslaDome[]): void {
    this.activeTesla.clear();
    for (const dome of domes) {
      const prefix = 'tesla-turret:';
      if (dome.ownerId.startsWith(prefix)) this.activeTesla.add(dome.ownerId.slice(prefix.length));
    }
  }

  update(delta: number): void {
    this.now += Math.max(0, delta);
    for (const [id, binding] of this.bindings) {
      if (!binding.sprite.active) continue;
      this.syncGlow(binding);
      const pose = binding.pose;
      if (pose && pose.elapsed < NET_TICK_INTERVAL_MS) {
        pose.elapsed = Math.min(NET_TICK_INTERVAL_MS, pose.elapsed + Math.max(0, delta));
        pose.angle = pose.from + turretAngleDifference(pose.from, pose.target) * pose.elapsed / NET_TICK_INTERVAL_MS;
        this.applyPose(binding);
      }
      if (binding.weaponId === 'TURRET_TESLA') {
        if (this.activeTesla.has(id)) {
          binding.sprite.play(pipelineAnimationKey(binding.asset, binding.clip), true);
        } else this.idle(binding);
      } else if (binding.clip.loop ? this.now >= binding.activeUntil : !binding.sprite.anims.isPlaying) {
        this.idle(binding);
      }
    }
  }

  private idle(binding: Binding): void {
    if (binding.sprite.anims.isPlaying) binding.sprite.anims.stop();
    if (String(binding.sprite.frame.name) !== String(binding.asset.idleFrame)) {
      binding.sprite.setFrame(binding.asset.idleFrame);
    }
  }

  clear(): void {
    for (const id of this.bindings.keys()) this.unbind(id);
    this.activeTesla.clear();
    this.now = 0;
  }
}
