import type * as Phaser from 'phaser';
import { NET_TICK_INTERVAL_MS } from '../config';
import { getTurretVisualSpec } from '../config/turretVisuals';
import { pipelineAnimationKey, type PipelineAsset, type PipelineClip } from '../config/pipelineAssets';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome, TurretWeaponId } from '../types';

interface Binding {
  sprite: Phaser.GameObjects.Sprite;
  weaponId: TurretWeaponId;
  asset: PipelineAsset;
  clip: PipelineClip;
  activeUntil: number;
  dispose: () => void;
}

/** Scene-owned presentation bindings; every binding ends with its world sprite. */
export class TurretAnimationController {
  private readonly bindings = new Map<string, Binding>();
  private readonly activeTesla = new Set<string>();
  private now = 0;

  bind(id: string, sprite: Phaser.GameObjects.Sprite, weaponId: TurretWeaponId): void {
    const previous = this.bindings.get(id);
    if (previous?.sprite === sprite && previous.weaponId === weaponId) return;
    this.unbind(id);
    const asset = getTurretVisualSpec(weaponId).asset;
    sprite.setTexture(asset.sheetTextureKey, asset.idleFrame).setOrigin(asset.pivot[0], asset.pivot[1]);
    const dispose = () => this.unbind(id);
    this.bindings.set(id, { sprite, weaponId, asset,
      clip: asset.clips.find((clip) => clip.name === 'fire')!, activeUntil: 0, dispose });
    sprite.once('destroy', dispose);
  }

  unbind(id: string): void {
    const binding = this.bindings.get(id);
    if (!binding) return;
    this.bindings.delete(id);
    binding.sprite.off('destroy', binding.dispose);
    // Phaser destroys AnimationState before emitting the sprite's destroy event.
    if (binding.sprite.active && !binding.sprite.isDestroyed) this.idle(binding);
  }

  /** Called only for a confirmed spawn, never for a snapshot refresh or baseline. */
  onShot(id: string): void {
    const binding = this.bindings.get(id);
    if (!binding || !binding.sprite.active || binding.weaponId === 'TURRET_TESLA') return;
    const key = pipelineAnimationKey(binding.asset, binding.clip);
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
