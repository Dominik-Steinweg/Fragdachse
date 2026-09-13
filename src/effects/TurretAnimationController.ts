import type * as Phaser from 'phaser';
import { addPlayerGlow } from './PlayerGlow';
import { removeInternalFx, type GlowHandle } from '../utils/phaserFx';
import { DEPTH } from '../config';
import { registerGraphicsObject } from './EffectUtils';
import { NET_TICK_INTERVAL_MS } from '../config';
import { getTurretVisualSpec, getTurretVisualTransform } from '../config/turretVisuals';
import { turretAngleDifference } from '../utils/turretAngle';
import { pipelineAnimationKey, type PipelineAsset, type PipelineClip } from '../config/pipelineAssets';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome, TurretWeaponId } from '../types';

interface Binding {
  controlGlow?: GlowHandle | null;
  controlColor?: number;
  sprite: Phaser.GameObjects.Sprite;
  weaponId: TurretWeaponId;
  asset: PipelineAsset;
  clip: PipelineClip;
  activeUntil: number;
  dispose: () => void;
  pose?: { x: number; y: number; angle: number; from: number; target: number; elapsed: number };
}

/** Scene-owned presentation bindings; every binding ends with its world sprite. */
export class TurretAnimationController {
  private controlMarker: Phaser.GameObjects.Graphics | null = null;
  private controlLabel: Phaser.GameObjects.Text | null = null;
  private markedId: string | null = null;

  syncControl(occupants: readonly { id: string; color: number }[], candidate: { id: string | number; x: number; y: number } | null, label: string): void {
    const colors = new Map(occupants.map(occupant => [occupant.id, occupant.color]));
    for (const [id, binding] of this.bindings) {
      const color = colors.get(id);
      if (color === binding.controlColor) continue;
      if (binding.controlGlow) removeInternalFx(binding.sprite, binding.controlGlow);
      binding.controlColor = color;
      binding.controlGlow = color === undefined ? null : addPlayerGlow(binding.sprite, color, 1.4, 10);
    }
    const sprite = candidate ? this.bindings.get(String(candidate.id))?.sprite : undefined;
    this.markedId = candidate ? String(candidate.id) : null;
    if (!candidate || !sprite?.active) { this.controlMarker?.setVisible(false); this.controlLabel?.setVisible(false); return; }
    if (!this.controlMarker) {
      this.controlMarker = sprite.scene.add.graphics().setDepth(DEPTH.PROJECTILES + 2);
      registerGraphicsObject(sprite.scene, 'weaponTelegraphs', this.controlMarker);
      this.controlLabel = sprite.scene.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: '13px', color: '#ffffff',
        backgroundColor: '#13262c', padding: { x: 7, y: 4 } }).setOrigin(0.5, 0).setDepth(DEPTH.PROJECTILES + 3);
    }
    const radius = Math.max(24, Math.max(sprite.displayWidth, sprite.displayHeight) * 0.48);
    this.controlMarker.clear().setPosition(candidate.x, candidate.y).setVisible(true)
      .lineStyle(6, 0x102128, 0.9).strokeCircle(0, 0, radius)
      .lineStyle(3, 0x86f6ff, 1).strokeCircle(0, 0, radius);
    this.controlLabel!.setText(label).setPosition(candidate.x, candidate.y + radius + 8).setVisible(true);
  }
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
    if (this.markedId === id) {
      this.controlMarker?.setVisible(false);
      this.controlLabel?.setVisible(false);
      this.markedId = null;
    }
    const binding = this.bindings.get(id);
    if (!binding) return;
    this.bindings.delete(id);
    if (binding.controlGlow && !binding.sprite.isDestroyed) removeInternalFx(binding.sprite, binding.controlGlow);
    binding.sprite.off('destroy', binding.dispose);
    // Phaser destroys AnimationState before emitting the sprite's destroy event.
    if (binding.sprite.active && !binding.sprite.isDestroyed) this.idle(binding);
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
    this.controlMarker?.destroy(); this.controlMarker = null;
    this.controlLabel?.destroy(); this.controlLabel = null;
    for (const id of this.bindings.keys()) this.unbind(id);
    this.activeTesla.clear();
    this.now = 0;
  }
}
