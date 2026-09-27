import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { TeslaDomeWeaponFireConfig } from '../loadout/LoadoutConfig';
import { registerGraphicsObject } from './EffectUtils';
import type { LightingSystem } from './LightingSystem';
import { TESLA_VOID_RECIPE, TeslaFieldVisual, writeTeslaPalette, type TeslaFieldState } from './TeslaFieldVisual';

/** Aufgehelltes Violett der Kuppel – die satte Feldfarbe trägt als Licht zu wenig Grün. */
const MINI_DOME_LIGHT_COLOR = 0xdfb4ff;
/** Satte Grundfarbe, falls die Waffe keine eigene Projektilfarbe trägt. */
const MINI_DOME_FALLBACK_COLOR = 0x9b32ff;
/** Freie Entladungen vom Kern zur Hülle; der Gegner hat keine replizierten Strahlziele. */
const IDLE_ARC_COUNT = 3;

interface MiniDomeVisual {
  field: TeslaFieldVisual;
  state: TeslaFieldState;
  phase: number;
}

/**
 * Kleine, satt violette Tesla-Variante für Teleporter-Gegner.
 *
 * Nutzt dieselbe prozedurale Energiehülle wie die Spieler- und Turmkuppel, liegt aber unter der
 * Gegnerfigur und zeigt statt Zielstrahlen kurze, pulsierende Entladungen vom Kern zur Hülle.
 */
export class MiniTeslaDomeRenderer {
  private readonly visuals = new Map<string, MiniDomeVisual>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  syncEnemies(enemies: readonly EnemyVisualSource[]): void {
    const activeIds = new Set<string>();
    const weapon = WEAPON_CONFIGS.MINI_TESLA_DOME;
    if (weapon.fire.type !== 'tesla_dome') return;

    for (const enemy of enemies) {
      if (!enemy.sprite.active || enemy.getHp() <= 0) continue;
      if (!getCoopDefenseEnemyConfig(enemy.kind).weapons.some(entry => entry.weaponId === 'MINI_TESLA_DOME')) continue;
      activeIds.add(enemy.id);
      this.syncDome(enemy, weapon.fire.radius);
    }

    for (const [enemyId, visual] of this.visuals) {
      if (activeIds.has(enemyId)) continue;
      this.lighting?.releaseLight(lightKey(enemyId));
      visual.field.destroy();
      this.visuals.delete(enemyId);
    }
  }

  update(delta: number): void {
    const weapon = WEAPON_CONFIGS.MINI_TESLA_DOME;
    if (weapon.fire.type !== 'tesla_dome') return;
    const fire: TeslaDomeWeaponFireConfig = weapon.fire;
    const color = weapon.projectileColor ?? MINI_DOME_FALLBACK_COLOR;
    const now = this.scene.time.now;

    for (const [enemyId, visual] of this.visuals) {
      const { field, state } = visual;
      writeTeslaPalette(field.palette, color, TESLA_VOID_RECIPE, fire.visualWhiteness);

      // Jede Entladung zündet phasenversetzt, hält kurz und erlischt – nie alle gleichzeitig.
      for (let index = 0; index < IDLE_ARC_COUNT; index++) {
        const phase = visual.phase + index * 2.1;
        if (Math.sin(now * 0.0043 + phase) < -0.15) continue;
        const angle = now * 0.0011 + phase;
        const reach = state.radius * (0.62 + 0.14 * Math.sin(now * 0.0031 + index));
        field.setBolt(index, {
          endX: state.x + Math.cos(angle) * reach,
          endY: state.y + Math.sin(angle) * reach,
          thickness: fire.visualBoltThicknessMin,
          amplitude: fire.visualJitter,
          branch: fire.visualBranchChance,
          impact: fire.visualImpactBurstScale * 0.4,
          surge: 0,
        });
      }

      state.veil = fire.visualFieldAlpha;
      state.rim = Math.min(0.9, fire.visualIndicatorAlpha * 10);
      state.arcs = fire.visualIdleArcCount * 0.5;
      state.waveSpeed = fire.visualPulseSpeed * 100;
      field.render(state, delta);

      this.lighting?.setLight(lightKey(enemyId), 'electricField', state.x, state.y, {
        radiusPx: Math.max(state.radius * 1.5, 70),
        color: MINI_DOME_LIGHT_COLOR,
        intensity: 0.5,
      });
    }
  }

  destroyAll(): void {
    for (const [enemyId, visual] of this.visuals) {
      this.lighting?.releaseLight(lightKey(enemyId));
      visual.field.destroy();
    }
    this.visuals.clear();
  }

  private syncDome(enemy: EnemyVisualSource, radius: number): void {
    let visual = this.visuals.get(enemy.id);
    if (!visual) {
      const state: TeslaFieldState = {
        x: enemy.sprite.x,
        y: enemy.sprite.y,
        radius,
        alpha: 1,
        charge: 1,
        activity: 0.6,
        surge: 0,
        surgeFront: 1,
        veil: 0,
        rim: 0,
        arcs: 0,
        waveSpeed: 0,
      };
      const phase = Phaser.Math.FloatBetween(0, Math.PI * 2);
      visual = {
        field: new TeslaFieldVisual(this.scene, {
          seed: Math.floor(phase * 1000),
          // Unter der Gegnerfigur: der Träger bleibt lesbar, die Entladungen liegen darüber.
          depth: DEPTH.PLAYERS - 0.14,
          boltDepth: DEPTH.PLAYERS + 0.12,
          register: object => registerGraphicsObject(this.scene, 'miniTeslaDomeEffects', object),
        }, state),
        state,
        phase,
      };
      this.visuals.set(enemy.id, visual);
    }

    visual.state.x = enemy.sprite.x;
    visual.state.y = enemy.sprite.y;
    visual.state.radius = radius;
  }
}

function lightKey(enemyId: string): string {
  return `minidome:${enemyId}`;
}
