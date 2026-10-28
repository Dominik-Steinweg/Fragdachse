import * as Phaser from 'phaser';
import { addPlayerGlow } from './PlayerGlow';
import { removeInternalFx, type GlowHandle } from '../utils/phaserFx';
import { fillRadialGradientTexture } from './EffectUtils';
import { ensurePlasmaCoreTexture, PLASMA_CORE_FRAMES, TEX_PLASMA_CORE } from './PlasmaCoreTexture';
import { DEPTH_LIGHTING, NET_TICK_INTERVAL_MS } from '../config';
import { getTurretVisualSpec, getTurretVisualTransform, turretEmissionColor, turretEmissionKey } from '../config/turretVisuals';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem, LightOverrides } from './LightingSystem';
import { turretAngleDifference } from '../utils/turretAngle';
import { pipelineAnimationKey, type PipelineAsset, type PipelineClip } from '../config/pipelineAssets';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome, TurretWeaponId } from '../types';

/**
 * The light a shot throws, per weapon, on top of the shared `turretGlow` pulse: the spore cap glows up
 * softly and dies down slowly; the flamer's burner flares with every burst, so a stream of shots
 * becomes a strong, flickering fire light.
 */
const SHOT_LIGHT: Partial<Record<TurretWeaponId, LightOverrides>> = {
  SPORES: { intensity: .22, durationMs: 950, radiusPx: 52 },
  BASE_SPORES: { intensity: .22, durationMs: 950, radiusPx: 52 },
  TURRET_SPORES: { intensity: .22, durationMs: 950, radiusPx: 52 },
  TURRET_FLAME: { intensity: 1, durationMs: 220, radiusPx: 104 },
};

/**
 * Recipe geometry in display px (display size / Blender ortho scale, 40 / 2.8): the plasma charge
 * sits .16 BU behind the pivot with a .187 BU radius; the flamer's nozzle sleeve centres .8 BU ahead
 * and its muzzle lip ends at 1.28 BU.
 */
const PLASMA_CORE = { forwardPx: -2.3, diameterPx: 6.2, bloomPx: 17, frameMs: 62, spin: .0011, flareMs: 380 };
const FLAME_HEAT = { bodyForwardPx: 6, bodyPx: 64, nozzleForwardPx: 17, nozzlePx: 36, riseMs: 120, fallMs: 520,
  bodyTint: 0xff5a14, nozzleTint: 0xffb050 } as const;
const TEX_HEAT_GLOW = '__turret_heat_glow';

/** The plasma turret's churning charge over its core, with a soft bloom that flares on a shot. */
interface PlasmaCore { readonly sprite: Phaser.GameObjects.Sprite; readonly bloom: Phaser.GameObjects.Image; phase: number; flare: number }
/** The flamer's burner heat while it fires: a bloom over the body and a hot glow at the nozzle. */
interface FlameHeat { readonly body: Phaser.GameObjects.Image; readonly nozzle: Phaser.GameObjects.Image; level: number; phase: number }

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
  /** This weapon's shot light, in its glow colour; null without a glow. */
  shotLight: LightOverrides | null;
  core: PlasmaCore | null;
  heat: FlameHeat | null;
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
    const color = glow ? turretEmissionColor(asset) : null;
    const binding: Binding = { sprite, glow, weaponId, asset,
      clip: asset.clips.find((clip) => clip.name === 'fire')!, activeUntil: 0,
      shotLight: color === null ? null : { ...SHOT_LIGHT[weaponId], color },
      core: glow && weaponId === 'SPORE_TURRET_PLASMA' ? createPlasmaCore(sprite) : null,
      heat: glow && weaponId === 'TURRET_FLAME' ? createFlameHeat(sprite) : null, dispose };
    this.bindings.set(id, binding);
    this.syncGlow(binding);
    this.syncExtras(binding, 0);
    sprite.once('destroy', dispose);
  }

  unbind(id: string): void {
    const binding = this.bindings.get(id);
    if (!binding) return;
    this.bindings.delete(id);
    if (binding.controlGlow && !binding.sprite.isDestroyed) removeInternalFx(binding.sprite, binding.controlGlow);
    binding.sprite.off('destroy', binding.dispose);
    binding.glow?.destroy();
    binding.core?.sprite.destroy(); binding.core?.bloom.destroy();
    binding.heat?.body.destroy(); binding.heat?.nozzle.destroy();
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

  /**
   * The plasma charge churns over the core disc and flares with a shot; the flamer's heat rises while
   * it fires and dies down after. Both follow the sprite's pose and visibility.
   */
  private syncExtras(binding: Binding, delta: number): void {
    const sprite = binding.sprite, visible = sprite.visible && sprite.active;
    const cos = Math.cos(sprite.rotation), sin = Math.sin(sprite.rotation);
    const core = binding.core;
    if (core) {
      core.flare = Math.max(0, core.flare - delta / PLASMA_CORE.flareMs);
      core.sprite.setVisible(visible); core.bloom.setVisible(visible);
      if (visible) {
        const x = sprite.x + cos * PLASMA_CORE.forwardPx, y = sprite.y + sin * PLASMA_CORE.forwardPx;
        const frame = Math.floor((this.now + core.phase) / PLASMA_CORE.frameMs) % PLASMA_CORE_FRAMES;
        if (String(core.sprite.frame.name) !== String(frame)) core.sprite.setFrame(frame);
        const swell = 1 + .22 * core.flare;
        core.sprite.setPosition(x, y).setRotation(sprite.rotation + (this.now + core.phase) * PLASMA_CORE.spin)
          .setDisplaySize(PLASMA_CORE.diameterPx * swell, PLASMA_CORE.diameterPx * swell).setAlpha(sprite.alpha);
        const breathe = .5 + .5 * Math.sin((this.now + core.phase) * .0037);
        core.bloom.setPosition(x, y).setDisplaySize(PLASMA_CORE.bloomPx * swell, PLASMA_CORE.bloomPx * swell)
          .setAlpha(emissiveAlpha(sprite.alpha * Math.min(1, .3 + .14 * breathe + .55 * core.flare)));
      }
    }
    const heat = binding.heat;
    if (heat) {
      const firing = this.now < binding.activeUntil;
      heat.level = firing ? Math.min(1, heat.level + delta / FLAME_HEAT.riseMs) : Math.max(0, heat.level - delta / FLAME_HEAT.fallMs);
      const shown = visible && heat.level > 0;
      heat.body.setVisible(shown); heat.nozzle.setVisible(shown);
      if (shown) {
        const t = (this.now + heat.phase) / 1000;
        // Two incommensurate flickers: a burner roars unevenly, but never strobes.
        const flicker = .82 + .1 * Math.sin(t * 23.7) + .08 * Math.sin(t * 9.3 + 1.7);
        const alpha = emissiveAlpha(sprite.alpha * heat.level * flicker);
        heat.body.setPosition(sprite.x + cos * FLAME_HEAT.bodyForwardPx, sprite.y + sin * FLAME_HEAT.bodyForwardPx)
          .setRotation(sprite.rotation).setAlpha(alpha * .7);
        heat.nozzle.setPosition(sprite.x + cos * FLAME_HEAT.nozzleForwardPx, sprite.y + sin * FLAME_HEAT.nozzleForwardPx)
          .setAlpha(Math.min(1, alpha)).setDisplaySize(FLAME_HEAT.nozzlePx * flicker, FLAME_HEAT.nozzlePx * flicker);
      }
    }
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
    if (binding.shotLight && this.lighting && binding.sprite.visible) {
      this.lighting.pulse('turretGlow', binding.sprite.x, binding.sprite.y, binding.shotLight);
    }
    if (binding.core) binding.core.flare = 1;
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
      this.syncExtras(binding, Math.max(0, delta));
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

function createPlasmaCore(sprite: Phaser.GameObjects.Sprite): PlasmaCore {
  const scene = sprite.scene;
  if (!scene.textures.exists(TEX_PLASMA_CORE)) ensurePlasmaCoreTexture(scene);
  ensureHeatGlowTexture(scene);
  return {
    // Self-lit above the emission glow: it covers the sprite's core disc and that disc's glow.
    sprite: scene.add.sprite(sprite.x, sprite.y, TEX_PLASMA_CORE, 0).setDepth(DEPTH_LIGHTING + 0.085),
    bloom: scene.add.image(sprite.x, sprite.y, TEX_HEAT_GLOW).setTint(0x52d8ff)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_LIGHTING + 0.09),
    phase: Math.random() * 10_000, flare: 0,
  };
}

function createFlameHeat(sprite: Phaser.GameObjects.Sprite): FlameHeat {
  const scene = sprite.scene;
  ensureHeatGlowTexture(scene);
  const glow = (tint: number, width: number, height: number) => scene.add.image(sprite.x, sprite.y, TEX_HEAT_GLOW)
    .setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH_LIGHTING + 0.09).setDisplaySize(width, height).setVisible(false);
  return {
    body: glow(FLAME_HEAT.bodyTint, FLAME_HEAT.bodyPx * 1.3, FLAME_HEAT.bodyPx * .8),
    nozzle: glow(FLAME_HEAT.nozzleTint, FLAME_HEAT.nozzlePx, FLAME_HEAT.nozzlePx),
    level: 0, phase: Math.random() * 10_000,
  };
}

function ensureHeatGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_HEAT_GLOW)) return;
  fillRadialGradientTexture(scene.textures, TEX_HEAT_GLOW, 64,
    [[0, 'rgba(255,255,255,0.9)'], [.25, 'rgba(255,255,255,0.5)'], [.6, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]);
}
