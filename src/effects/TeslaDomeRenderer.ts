import type { TurretAnimationController } from './TurretAnimationController';
import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome, TeslaDomeTargetType } from '../types';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { LightingSystem } from './LightingSystem';
import type { TeslaNovaRenderer } from './TeslaNovaRenderer';
import { mixColors, registerGraphicsObject } from './EffectUtils';
import { TESLA_ELECTRIC_RECIPE, TeslaFieldVisual, writeTeslaPalette, type TeslaFieldState } from './TeslaFieldVisual';

type TeslaDomeConfig = WeaponConfig & { fire: TeslaDomeWeaponFireConfig };

interface TeslaDomeVisual {
  ownerColor: number;
  config?: TeslaDomeConfig;
  field: TeslaFieldVisual;
  fieldState: TeslaFieldState;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  currentRadius: number;
  targetRadius: number;
  currentAlpha: number;
  targetAlpha: number;
  /** Weich nachgeführte Kampfaktivität: 1 mit Zielen, 0 im Leerlauf. */
  activity: number;
  targets: TeslaBoltTargetState[];
  /** Absolute Ladestufe; die Darstellung normalisiert sie bewusst nicht über MaxCharge. */
  chargeStacks: number;
  /** Weich nachgeführte Ladestufe, damit Radius- und Intensitätssprünge nicht hart schalten. */
  currentCharge: number;
  lastPulseSequence: number;
  overchargePulseEnabled: boolean;
  stormEnabled: boolean;
  /** Solange gesetzt, läuft der Überladungsschlag über Hülle und Primärstrahlen. */
  overchargeFlashUntil: number;
}

interface TeslaBoltTargetState {
  /** Stabile logische Zielidentität; sie und nicht der Array-Index hält den Strahl ruhig. */
  targetKey: string;
  slotIndex: number;
  type: TeslaDomeTargetType;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
}

const DOME_SMOOTH_TIME_MS = 52;
const TARGET_SMOOTH_TIME_MS = 38;
const CHARGE_SMOOTH_TIME_MS = 130;
const ACTIVITY_SMOOTH_TIME_MS = 160;
/** Dauer des Überladungsschlags über Hülle und Primärstrahlen. */
const OVERCHARGE_FLASH_MS = 190;

/**
 * Tesla-Kuppel als prozedurale Energiehülle aus der Draufsicht.
 *
 * Die Darstellung übernimmt `TeslaFieldVisual` (Fragment-Shader für Hülle und Zielstrahlen);
 * dieser Renderer übersetzt replizierte Kuppeln in geglätteten Feldzustand, Licht, Audio und
 * die pulsgebundenen Boss-Effekte.
 */
export class TeslaDomeRenderer {
  private readonly visuals = new Map<string, TeslaDomeVisual>();
  private readonly heardActivations = new Map<string, number>();
  private audioScope: unknown;
  private audioPrimed = false;
  private readonly configs = new Map<string, TeslaDomeConfig>();
  private audioSystem: GameAudioSystem | null = null;
  private lighting: LightingSystem | null = null;
  private novaRenderer: TeslaNovaRenderer | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly turretAnimations?: TurretAnimationController) {}

  setAudioSystem(system: GameAudioSystem): void {
    this.audioSystem = system;
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  /** Die Blitznova hängt am Feldpuls der Kuppel und wird deshalb von hier ausgelöst. */
  setNovaRenderer(renderer: TeslaNovaRenderer | null): void {
    this.novaRenderer = renderer;
  }

  setWeaponConfig(ownerId: string, config: TeslaDomeConfig): void {
    this.configs.set(ownerId, config);
  }

  clearWeaponConfig(ownerId: string): void {
    this.configs.delete(ownerId);
  }

  syncVisuals(domes: SyncedTeslaDome[], audioScope?: unknown): void {
    if (audioScope !== this.audioScope) {
      this.audioScope = audioScope;
      this.audioPrimed = false;
      this.heardActivations.clear();
    }
    const baseline = !this.audioPrimed;
    this.audioPrimed = true;
    this.turretAnimations?.syncTesla(domes);
    const activeIds = new Set(domes.map(dome => dome.ownerId));

    for (const [ownerId, visual] of this.visuals) {
      if (activeIds.has(ownerId)) continue;
      this.lighting?.releaseLight(lightKey(ownerId));
      this.destroyVisual(visual);
      this.visuals.delete(ownerId);
    }

    for (const dome of domes) {
      let visual = this.visuals.get(dome.ownerId);
      if (!visual) {
        visual = this.createVisual(dome, this.resolveWeaponConfig(dome));
        this.visuals.set(dome.ownerId, visual);
      }

      const activation = dome.activationSequence;
      if (activation !== undefined && activation > (this.heardActivations.get(dome.ownerId) ?? -1)) {
        this.heardActivations.set(dome.ownerId, activation);
        if (!baseline) this.audioSystem?.playSound('sfx_tesla_activate', dome.x, dome.y, dome.ownerId);
      }

      visual.config = this.resolveWeaponConfig(dome) ?? visual.config;

      visual.targetX = dome.x;
      visual.targetY = dome.y;
      visual.targetRadius = dome.radius;
      visual.targetAlpha = dome.alpha;
      visual.ownerColor = dome.color;
      visual.chargeStacks = dome.chargeStacks ?? 0;
      visual.overchargePulseEnabled = dome.overchargePulseEnabled === true;
      visual.stormEnabled = dome.stormEnabled === true;

      // Strahlzustand hängt an der stabilen Zielidentität. Wechselt die Array-Reihenfolge,
      // behält jeder Strahl trotzdem seine geglättete Position.
      const previousByKey = new Map(visual.targets.map(target => [target.targetKey, target]));
      visual.targets = dome.targets.map((target) => {
        const previous = previousByKey.get(target.targetKey);
        return {
          targetKey: target.targetKey,
          slotIndex: target.slotIndex,
          type: target.type,
          currentX: previous?.currentX ?? visual.currentX,
          currentY: previous?.currentY ?? visual.currentY,
          targetX: target.x,
          targetY: target.y,
        };
      });

      this.consumeFieldPulse(dome, visual);
    }
  }

  /**
   * Löst die pulsgebundenen Boss-Darstellungen aus.
   *
   * `pulseSequence` ist der einzige Trigger: der Renderer leitet nichts aus der Aktivierungsdauer
   * ab und bleibt damit auch bei Paketverlust oder wechselnder Snapshot-Rate synchron.
   */
  private consumeFieldPulse(dome: SyncedTeslaDome, visual: TeslaDomeVisual): void {
    const sequence = dome.pulseSequence ?? 0;
    if (sequence <= visual.lastPulseSequence) {
      visual.lastPulseSequence = sequence;
      return;
    }
    const isFirstSnapshot = visual.lastPulseSequence < 0;
    visual.lastPulseSequence = sequence;
    if (isFirstSnapshot) return;

    if (visual.overchargePulseEnabled) {
      visual.overchargeFlashUntil = this.scene.time.now + OVERCHARGE_FLASH_MS;
    }
    if (visual.stormEnabled) {
      this.novaRenderer?.play(dome.x, dome.y, dome.radius, this.resolveOwnerColor(visual, visual.config));
    }
  }

  update(delta: number): void {
    const domeLerp = 1 - Math.exp(-delta / DOME_SMOOTH_TIME_MS);
    const targetLerp = 1 - Math.exp(-delta / TARGET_SMOOTH_TIME_MS);
    const chargeLerp = 1 - Math.exp(-delta / CHARGE_SMOOTH_TIME_MS);
    const activityLerp = 1 - Math.exp(-delta / ACTIVITY_SMOOTH_TIME_MS);

    for (const [ownerId, visual] of this.visuals) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, domeLerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, domeLerp);
      visual.currentRadius = Phaser.Math.Linear(visual.currentRadius, visual.targetRadius, domeLerp);
      visual.currentAlpha = Phaser.Math.Linear(visual.currentAlpha, visual.targetAlpha, domeLerp);
      visual.currentCharge = Phaser.Math.Linear(visual.currentCharge, visual.chargeStacks, chargeLerp);
      visual.activity = Phaser.Math.Linear(visual.activity, visual.targets.length > 0 ? 1 : 0, activityLerp);

      for (const target of visual.targets) {
        target.currentX = Phaser.Math.Linear(target.currentX, target.targetX, targetLerp);
        target.currentY = Phaser.Math.Linear(target.currentY, target.targetY, targetLerp);
      }

      this.updateVisual(visual, delta);

      // Dauerlicht am Lebenszyklus des Visuals. Die Kuppel steht sichtbar unter Strom,
      // muss also auch ihre Umgebung beleuchten. Farbe deutlich aufgehellt: eine rohe
      // Spielerfarbe wäre für Licht zu gesättigt.
      this.lighting?.setLight(
        lightKey(ownerId),
        'electricField',
        visual.currentX,
        visual.currentY,
        {
          radiusPx: Math.max(visual.currentRadius * 1.25, 90),
          color: mixColors(this.resolveOwnerColor(visual, visual.config), 0xbfe6ff, 0.45),
          intensity: (0.62 + visual.activity * 0.12) * chargeIntensity(visual) * Phaser.Math.Clamp(visual.currentAlpha, 0, 1),
        },
      );
    }
  }

  destroyAll(): void {
    for (const [ownerId, visual] of this.visuals) {
      this.lighting?.releaseLight(lightKey(ownerId));
      this.destroyVisual(visual);
    }
    this.visuals.clear();
  }

  private createVisual(dome: SyncedTeslaDome, config?: TeslaDomeConfig): TeslaDomeVisual {
    const fieldState: TeslaFieldState = {
      x: dome.x,
      y: dome.y,
      radius: dome.radius,
      alpha: dome.alpha,
      charge: 1,
      activity: dome.targets.length > 0 ? 1 : 0,
      surge: 0,
      surgeFront: 1,
      veil: 0,
      rim: 0,
      arcs: 0,
      waveSpeed: 0,
    };
    return {
      ownerColor: dome.color,
      config,
      field: new TeslaFieldVisual(this.scene, {
        seed: computeOwnerSeed(dome.ownerId),
        depth: DEPTH.FIRE + 0.05,
        boltDepth: DEPTH.FIRE + 0.2,
        register: object => registerGraphicsObject(this.scene, 'teslaDomeEffects', object),
      }, fieldState),
      fieldState,
      currentX: dome.x,
      currentY: dome.y,
      targetX: dome.x,
      targetY: dome.y,
      currentRadius: dome.radius,
      targetRadius: dome.radius,
      currentAlpha: dome.alpha,
      targetAlpha: dome.alpha,
      activity: fieldState.activity,
      targets: dome.targets.map(target => ({
        targetKey: target.targetKey,
        slotIndex: target.slotIndex,
        type: target.type,
        currentX: target.x,
        currentY: target.y,
        targetX: target.x,
        targetY: target.y,
      })),
      chargeStacks: dome.chargeStacks ?? 0,
      currentCharge: dome.chargeStacks ?? 0,
      // Negativ, damit der erste Snapshot einer laufenden Kuppel keinen Puls nachfeuert.
      lastPulseSequence: -1,
      overchargePulseEnabled: dome.overchargePulseEnabled === true,
      stormEnabled: dome.stormEnabled === true,
      overchargeFlashUntil: 0,
    };
  }

  private updateVisual(visual: TeslaDomeVisual, delta: number): void {
    const field = visual.field;
    const fire = this.getFireConfig(visual.config);
    const surge = this.getOverchargeSurge(visual, this.scene.time.now);
    const whiteness = Phaser.Math.Clamp(fire.visualWhiteness + visual.currentCharge * 0.06, 0, 1);
    writeTeslaPalette(field.palette, this.resolveOwnerColor(visual, visual.config), TESLA_ELECTRIC_RECIPE, whiteness);

    for (const target of visual.targets) {
      const targetIntensity = this.getTargetIntensity(target.type);
      const distance = Math.hypot(target.currentX - visual.currentX, target.currentY - visual.currentY);
      field.setBolt(target.slotIndex, {
        endX: target.currentX,
        endY: target.currentY,
        thickness: Phaser.Math.Clamp(
          fire.visualBoltThicknessMin + distance / 240,
          fire.visualBoltThicknessMin,
          fire.visualBoltThicknessMax,
        ) * (0.9 + targetIntensity * 0.15),
        amplitude: fire.visualJitter * targetIntensity * Phaser.Math.Clamp(distance / 130, 0.45, 1.5) * (1 + surge * 0.7),
        branch: Phaser.Math.Clamp(fire.visualBranchChance * (1.1 + targetIntensity * 0.9) + surge * 0.5, 0, 0.95),
        impact: fire.visualImpactBurstScale * this.getImpactStrength(target.type),
        surge,
      });
    }

    const state = visual.fieldState;
    state.x = visual.currentX;
    state.y = visual.currentY;
    state.radius = visual.currentRadius;
    state.alpha = Phaser.Math.Clamp(visual.currentAlpha, 0, 1);
    state.charge = chargeIntensity(visual);
    state.activity = visual.activity;
    state.surge = surge;
    state.surgeFront = 1 - Math.sqrt(surge);
    state.veil = fire.visualFieldAlpha;
    state.rim = Math.min(1, fire.visualIndicatorAlpha * 10);
    state.arcs = Math.round(fire.visualIdleArcCount * 0.75 + visual.activity + visual.currentCharge * 0.5);
    state.waveSpeed = fire.visualPulseSpeed * 100 * (1 + visual.currentCharge * 0.16);
    field.render(state, delta);
  }

  /**
   * Kurzer, quadratisch auslaufender Schlag über Hülle und Primärstrahlen.
   *
   * Er ist bewusst deutlich stärker als der normale Tick, damit der Überladungsimpuls auch bei
   * voller Kuppelaktivität als eigenes Ereignis lesbar bleibt.
   */
  private getOverchargeSurge(visual: TeslaDomeVisual, time: number): number {
    const remaining = visual.overchargeFlashUntil - time;
    if (remaining <= 0) return 0;
    const progress = 1 - remaining / OVERCHARGE_FLASH_MS;
    return (1 - progress) ** 2;
  }

  private getImpactStrength(type: TeslaDomeTargetType): number {
    switch (type) {
      case 'players':
      case 'enemies':
        return 1;
      case 'train':
        return 1.05;
      case 'bases':
        return 0.95;
      case 'turrets':
        return 0.85;
      case 'rocks':
      default:
        return 0.55;
    }
  }

  private getTargetIntensity(type: TeslaDomeTargetType): number {
    switch (type) {
      case 'players':
      case 'enemies':
        return 1.18;
      case 'turrets':
        return 1.02;
      case 'bases':
        return 1.08;
      case 'train':
        return 1.14;
      case 'rocks':
      default:
        return 0.82;
    }
  }

  private destroyVisual(visual: TeslaDomeVisual): void {
    visual.field?.destroy();
  }

  private getFireConfig(config?: TeslaDomeConfig): TeslaDomeWeaponFireConfig {
    return (config ?? (WEAPON_CONFIGS.TESLA_DOME as TeslaDomeConfig)).fire;
  }

  private resolveWeaponConfig(dome: SyncedTeslaDome): TeslaDomeConfig | undefined {
    if (dome.weaponId) {
      const config = WEAPON_CONFIGS[dome.weaponId as keyof typeof WEAPON_CONFIGS];
      if (config?.fire.type === 'tesla_dome') {
        return config as TeslaDomeConfig;
      }
    }
    return this.configs.get(dome.ownerId);
  }

  private resolveOwnerColor(visual: TeslaDomeVisual, config?: TeslaDomeConfig): number {
    const domeConfig = config ?? (WEAPON_CONFIGS.TESLA_DOME as TeslaDomeConfig);
    return domeConfig.projectileColor ?? visual.ownerColor;
  }
}

function computeOwnerSeed(ownerId: string): number {
  let hash = 0;
  for (let index = 0; index < ownerId.length; index++) {
    hash = ((hash << 5) - hash) + ownerId.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

/**
 * Sichtbare Verdichtung des Feldes je Ladestufe.
 *
 * Bewusst linear und ungedeckelt an der absoluten Stufe: Stufe 3 sieht mit MaxCharge 3 genauso
 * aus wie mit MaxCharge 6.
 */
function chargeIntensity(visual: TeslaDomeVisual): number {
  return 1 + visual.currentCharge * 0.22;
}

function lightKey(ownerId: string): string {
  return `tesladome:${ownerId}`;
}
