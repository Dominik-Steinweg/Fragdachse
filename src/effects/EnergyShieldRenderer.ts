import * as Phaser from 'phaser';
import type { SyncedEnergyShield } from '../types';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { LightingSystem } from './LightingSystem';
import { mixColors } from './EffectUtils';
import { EnergyShieldGpuLayer, type EnergyShieldGpuItem } from './gpu/EnergyShieldGpuLayer';
import {
  ENERGY_SHIELD_GROW_S,
  ENERGY_SHIELD_IMPACT_S,
  ENERGY_SHIELD_RELEASE_S,
  ENERGY_SHIELD_STYLE,
} from './gpu/EnergyShieldShader';

interface ShieldVisual {
  currentX:          number;
  currentY:          number;
  targetX:           number;
  targetY:           number;
  currentAngle:      number;
  targetAngle:       number;
  anchorDistance:    number;
  currentRadius:     number;
  targetRadius:      number;
  currentThickness:  number;
  targetThickness:   number;
  currentAlpha:      number;
  targetAlpha:       number;
  currentFlashAlpha: number;
  targetFlashAlpha:  number;
  arcDegrees:        number;
  color:             number;
  isDome:            boolean;
  /** Enemy frontal shields follow the enemy body instead of a player owner. */
  enemyOwner:        boolean;
  createdAt:         number;
  /** Set when the owner lowered the shield; the membrane collapses, then the visual is dropped. */
  releasedAt:        number | null;
  impactAt:          number;
  seed:              number;
}

const SHIELD_SMOOTH_TIME_MS = 46;
/** A rise of the replicated flash by at least this much starts a new impact ripple. */
const IMPACT_FLASH_RISE = 0.2;

/**
 * Energy shields (player arc, energy dome, enemy frontal shields) as one GPU membrane batch.
 * Owns smoothing, owner following, spawn/release timing, impact detection, the shield light and
 * the activation sound; all drawing lives in EnergyShieldShader.
 */
export class EnergyShieldRenderer {
  private readonly visuals = new Map<string, ShieldVisual>();
  private readonly layer: EnergyShieldGpuLayer;
  private ownerPositionProvider: ((ownerId: string) => { x: number; y: number } | null) | null = null;
  private enemyPositionProvider: ((enemyId: string) => { x: number; y: number } | null) | null = null;
  private audioSystem: GameAudioSystem | null = null;
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = new EnergyShieldGpuLayer(scene);
  }

  setAudioSystem(system: GameAudioSystem): void {
    this.audioSystem = system;
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  setOwnerPositionProvider(provider: ((ownerId: string) => { x: number; y: number } | null) | null): void {
    this.ownerPositionProvider = provider;
  }

  /** Body position for enemy frontal shields (`ownerKind: 'enemy'`); without it they use the synced anchor. */
  setEnemyPositionProvider(provider: ((enemyId: string) => { x: number; y: number } | null) | null): void {
    this.enemyPositionProvider = provider;
  }

  syncVisuals(shields: SyncedEnergyShield[]): void {
    const now = this.scene.time.now;
    const activeIds = new Set(shields.map(shield => shield.ownerId));

    for (const [ownerId, visual] of this.visuals) {
      if (!activeIds.has(ownerId) && visual.releasedAt === null) visual.releasedAt = now;
    }

    for (const shield of shields) {
      let visual = this.visuals.get(shield.ownerId);
      // Switching between arc and dome (or owner kind) starts a fresh membrane.
      if (visual && (visual.isDome !== shield.isDome || visual.enemyOwner !== (shield.ownerKind === 'enemy'))) {
        this.visuals.delete(shield.ownerId);
        visual = undefined;
      }
      if (visual && visual.releasedAt !== null) {
        // Raised again while collapsing: grow back from where it is, without a new activation sound.
        const collapsed = Math.min(1, (now - visual.releasedAt) / (ENERGY_SHIELD_RELEASE_S * 1000));
        visual.createdAt = now - (1 - collapsed) * ENERGY_SHIELD_GROW_S * 1000;
        visual.releasedAt = null;
      }
      if (!visual) {
        visual = this.createVisual(shield, now);
        this.visuals.set(shield.ownerId, visual);
        // The activation sound is the player's weapon feedback; an enemy raising its shield stays silent.
        if (!visual.enemyOwner) this.audioSystem?.playSound('sfx_shield_activate', shield.x, shield.y, shield.ownerId);
      }
      if (shield.flashAlpha >= visual.targetFlashAlpha + IMPACT_FLASH_RISE) visual.impactAt = now;
      visual.targetX           = shield.x;
      visual.targetY           = shield.y;
      visual.targetAngle       = shield.angle;
      visual.anchorDistance    = shield.anchorDistance;
      visual.targetRadius      = shield.radius;
      visual.targetThickness   = shield.thickness;
      visual.targetAlpha       = shield.alpha;
      visual.targetFlashAlpha  = shield.flashAlpha;
      visual.arcDegrees        = shield.arcDegrees;
      visual.color             = shield.color;
    }
  }

  update(delta: number): void {
    const lerp = 1 - Math.exp(-delta / SHIELD_SMOOTH_TIME_MS);
    const now  = this.scene.time.now;
    const items: { item: EnergyShieldGpuItem; enemy: boolean }[] = [];

    for (const [ownerId, visual] of this.visuals) {
      const fade = visual.releasedAt === null ? 1 : 1 - (now - visual.releasedAt) / (ENERGY_SHIELD_RELEASE_S * 1000);
      if (fade <= 0) {
        this.lighting?.releaseLight(lightKey(ownerId));
        this.visuals.delete(ownerId);
        continue;
      }
      const ownerPos = (visual.enemyOwner
        ? this.enemyPositionProvider?.(ownerId)
        : this.ownerPositionProvider?.(ownerId)) ?? null;
      if (ownerPos) {
        visual.currentX = ownerPos.x + Math.cos(visual.targetAngle) * visual.anchorDistance;
        visual.currentY = ownerPos.y + Math.sin(visual.targetAngle) * visual.anchorDistance;
      } else {
        visual.currentX = visual.targetX;
        visual.currentY = visual.targetY;
      }
      visual.currentAngle      = Phaser.Math.Angle.RotateTo(visual.currentAngle, visual.targetAngle, lerp * Math.PI);
      visual.currentRadius     = Phaser.Math.Linear(visual.currentRadius,     visual.targetRadius,     lerp);
      visual.currentThickness  = Phaser.Math.Linear(visual.currentThickness,  visual.targetThickness,  lerp);
      visual.currentAlpha      = Phaser.Math.Linear(visual.currentAlpha,      visual.targetAlpha,      lerp);
      visual.currentFlashAlpha = Phaser.Math.Linear(visual.currentFlashAlpha, visual.targetFlashAlpha, lerp);

      const isDome = visual.isDome;
      items.push({ enemy: visual.enemyOwner, item: {
        x: visual.currentX, y: visual.currentY, angle: visual.currentAngle,
        radius: Math.max(4, visual.currentRadius),
        thickness: isDome ? Math.max(2.5, visual.currentThickness * 0.6) : Math.max(1.2, visual.currentThickness),
        halfArc: isDome ? Math.PI : Phaser.Math.DegToRad(visual.arcDegrees) * 0.5,
        alpha: Phaser.Math.Clamp(visual.currentAlpha, 0, 1),
        flash: Phaser.Math.Clamp(visual.currentFlashAlpha, 0, 1),
        color: visual.color,
        style: visual.enemyOwner ? ENERGY_SHIELD_STYLE.enemy : isDome ? ENERGY_SHIELD_STYLE.dome : ENERGY_SHIELD_STYLE.arc,
        impactAgeS: Math.min(ENERGY_SHIELD_IMPACT_S + 1, (now - visual.impactAt) / 1000),
        lifeS: Math.min(60, (now - visual.createdAt) / 1000),
        fade,
        seed: visual.seed,
      } });

      // The dome encloses its carrier and is lit from the carrier with a brightness floor so a
      // low shield alpha does not swallow it at night; the directional shield stays subtler.
      // A block flares the light together with the membrane.
      const lightX = isDome && ownerPos ? ownerPos.x : visual.currentX;
      const lightY = isDome && ownerPos ? ownerPos.y : visual.currentY;
      const alphaFactor = isDome
        ? Phaser.Math.Clamp(0.55 + visual.currentAlpha * 0.45, 0, 1)
        : visual.currentAlpha;
      this.lighting?.setLight(lightKey(ownerId), 'shieldField', lightX, lightY, {
        radiusPx: Math.max(visual.currentRadius * (isDome ? 1.3 : 1.5), 90),
        color: mixColors(visual.color, 0xffffff, 0.6),
        intensity: Phaser.Math.Clamp(
          ((isDome ? 1.0 : 0.72) + visual.currentFlashAlpha * 0.4) * alphaFactor * fade,
          0,
          1,
        ),
      });
    }

    // Player shields and domes first: under batch pressure only enemy shields are dropped.
    this.layer.begin(now);
    for (const entry of items) if (!entry.enemy) this.layer.add(entry.item);
    for (const entry of items) if (entry.enemy) this.layer.add(entry.item);
    this.layer.flush();
  }

  destroyAll(): void {
    for (const ownerId of this.visuals.keys()) this.lighting?.releaseLight(lightKey(ownerId));
    this.visuals.clear();
    this.layer.clear();
  }

  private createVisual(shield: SyncedEnergyShield, now: number): ShieldVisual {
    return {
      currentX:          shield.x,
      currentY:          shield.y,
      targetX:           shield.x,
      targetY:           shield.y,
      currentAngle:      shield.angle,
      targetAngle:       shield.angle,
      anchorDistance:    shield.anchorDistance,
      currentRadius:     shield.radius,
      targetRadius:      shield.radius,
      currentThickness:  shield.thickness,
      targetThickness:   shield.thickness,
      currentAlpha:      shield.alpha,
      targetAlpha:       shield.alpha,
      currentFlashAlpha: shield.flashAlpha,
      targetFlashAlpha:  shield.flashAlpha,
      arcDegrees:        shield.arcDegrees,
      color:             shield.color,
      isDome:            shield.isDome,
      enemyOwner:        shield.ownerKind === 'enemy',
      createdAt:         now,
      releasedAt:        null,
      impactAt:          -Infinity,
      seed:              seedOf(shield.ownerId),
    };
  }
}

function lightKey(ownerId: string): string {
  return `shield:${ownerId}`;
}

function seedOf(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 1000) / 1000;
}
