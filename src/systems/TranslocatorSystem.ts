import Phaser from 'phaser';
import { bridge } from '../network/bridge';
import { ProjectileManager } from '../entities/ProjectileManager';
import { PlayerManager } from '../entities/PlayerManager';
import { CombatSystem } from './CombatSystem';
import { TrainManager } from '../train/TrainManager';
import { UTILITY_CONFIGS } from '../loadout/LoadoutConfig';

export class TranslocatorSystem {
  // Map von playerId -> id des aktiven Pucks
  private activePucks = new Map<string, number>();

  constructor(
    private playerManager: PlayerManager,
    private projectileManager: ProjectileManager,
    private combatSystem: CombatSystem,
    private trainManager?: TrainManager | null
  ) {}

  public setTrainManager(tm: TrainManager | null): void {
    this.trainManager = tm;
  }

  public getActivePuckId(playerId: string): number | undefined {
    return this.activePucks.get(playerId);
  }

  /**
   * Called by LoadoutManager when a player uses the Translocator utility.
   */
  public handleUse(
    playerId: string,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    params: any
  ): boolean {
    const existingPuckId = this.activePucks.get(playerId);

    if (existingPuckId !== undefined) {
      const puck = this.projectileManager.getProjectileById(existingPuckId);
      if (puck) {
        return this.teleportToPuck(playerId, puck, now);
      } else {
        // Puck wurde mittlerweile zerstört (Arena-Grenze, etc.), Referenz entfernen und Werfen erlauben
        this.activePucks.delete(playerId);
      }
    }

    return this.throwPuck(playerId, angle, now, params);
  }

  private throwPuck(playerId: string, angle: number, now: number, params: any): boolean {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return false;

    const cfg = UTILITY_CONFIGS.TRANSLOCATOR;
    const speed = cfg.projectileSpeed ?? 1200;
    
    let throwSpeed = speed;
    if (params?.utilityChargeFraction !== undefined) {
      const frac = Phaser.Math.Clamp(params.utilityChargeFraction, 0, 1);
      const minFraction = (cfg.activation as any).minChargeFraction ?? 0.3;
      const minSpeed = speed * minFraction;
      throwSpeed = minSpeed + frac * (speed - minSpeed);
    }

    const playerExtents = 16;
    const spawnX = player.sprite.x + Math.cos(angle) * playerExtents;
    const spawnY = player.sprite.y + Math.sin(angle) * playerExtents;

    const projId = this.projectileManager.spawnProjectile(spawnX, spawnY, angle, playerId, {
      speed: throwSpeed,
      size: cfg.projectileSize ?? 16,
      damage: 0,
      color: cfg.projectileColor ?? 0xffffff,
      ownerColor: bridge.getPlayerColor(playerId),
      lifetime: 9999999, // Bleibt (nahezu) unendlich liegen bis zum Teleport
      maxBounces: cfg.maxBounces ?? 1,
      isGrenade: true,   // Bounced auf dem Boden/an Wänden wie eine Granate
      adrenalinGain: 0,
      projectileStyle: cfg.projectileStyle,
      frictionDelayMs: cfg.frictionDelayMs,
      airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
      bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
      stopSpeedThreshold: cfg.stopSpeedThreshold,
    });

    this.activePucks.set(playerId, projId);
    
    // Kein Server-Utility-Cooldown starten (das Starten des Cooldowns passiert erst beim Teleport)
    return true; 
  }

  private teleportToPuck(playerId: string, puck: any, now: number): boolean {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return false;

    // 1. Puck Koordinaten lesen und Puck zerstören
    const targetX = puck.sprite.x;
    const targetY = puck.sprite.y;
    this.projectileManager.destroyProjectile(puck.id);
    this.activePucks.delete(playerId);

    const playerColor = bridge.getPlayerColor(playerId) ?? 0xffffff;

    // 2. Start-VFX RPC senden 
    bridge.broadcastTranslocatorFlash(player.sprite.x, player.sprite.y, playerColor, 'start');

    // 3. Teleport durchführen
    player.sprite.x = targetX;
    player.sprite.y = targetY;
    player.body.reset(targetX, targetY);

    // 4. Ziel-VFX RPC senden
    bridge.broadcastTranslocatorFlash(targetX, targetY, playerColor, 'end');

    // 5. Hazard & Telefrag Checks am Zielort anwenden
    this.checkTeleportHazards(playerId, targetX, targetY);

    // 6. Utility-Cooldown starten
    const cd = UTILITY_CONFIGS.TRANSLOCATOR.cooldown;
    bridge.publishUtilityCooldownUntil(playerId, now + cd);

    return true;
  }

  private checkTeleportHazards(playerId: string, x: number, y: number): void {
    const radius = 16; // Spieler-Radius
    const bounds = new Phaser.Geom.Rectangle(x - radius, y - radius, radius * 2, radius * 2);

    // A) Telefrag (andere Spieler)
    for (const otherPlayer of this.playerManager.getAllPlayers()) {
      if (otherPlayer.id === playerId) continue;
      if (!this.combatSystem.isAlive(otherPlayer.id)) continue;
      // Burrowed Spieler können auch getelefragged werden? Ja, Translocator überschreibt alles.

      const otherBounds = otherPlayer.sprite.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, otherBounds)) {
        // Telefrag! Mache extrem hohen Schaden
        this.combatSystem.applyDamage(otherPlayer.id, 9999, true, playerId, 'Translocator', {
          sourceX: x,
          sourceY: y,
        });
      }
    }

    // B) Train Hazard
    if (this.trainManager) {
      const trainSegments = this.trainManager.getSegmentPositions();
      for (const seg of trainSegments) {
        // Zugmasse ist ca 64x64 pro Segment
        const segBounds = new Phaser.Geom.Rectangle(seg.x - 32, seg.y - 32, 64, 64);
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, segBounds)) {
          // Spieler in den Zug teleportiert
          this.combatSystem.applyDamage(playerId, 9999, true, 'train', 'Zug', {
            sourceX: seg.x,
            sourceY: seg.y,
          });
          break;
        }
      }
    }
  }

  public removePlayer(playerId: string): void {
    const puckId = this.activePucks.get(playerId);
    if (puckId !== undefined) {
      this.projectileManager.destroyProjectile(puckId);
      this.activePucks.delete(playerId);
    }
  }
}
