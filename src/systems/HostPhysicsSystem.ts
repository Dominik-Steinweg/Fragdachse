import Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { CombatSystem }  from './CombatSystem';
import { PLAYER_SPEED }       from '../config';

export class HostPhysicsSystem {
  private scene:         Phaser.Scene;
  private playerManager: PlayerManager;
  private bridge:        NetworkBridge;
  private combatSystem:  CombatSystem;
  private rockGroup:     Phaser.Physics.Arcade.StaticGroup;
  private collidersSetup = new Set<string>();

  constructor(
    scene:         Phaser.Scene,
    playerManager: PlayerManager,
    bridge:        NetworkBridge,
    combatSystem:  CombatSystem,
    rockGroup:     Phaser.Physics.Arcade.StaticGroup,
  ) {
    this.scene         = scene;
    this.playerManager = playerManager;
    this.bridge        = bridge;
    this.combatSystem  = combatSystem;
    this.rockGroup     = rockGroup;
  }

  /**
   * Jeden Frame – nur auf dem Host aktiv.
   * Setzt Velocities basierend auf Spieler-Input; tote Spieler werden übersprungen.
   * Gibt keine Werte zurück – GameScene liest Positionen direkt von den Sprites.
   */
  update(): void {
    if (!this.bridge.isHost()) return;

    for (const player of this.playerManager.getAllPlayers()) {
      // Collider mit Felsen lazy anlegen
      if (!this.collidersSetup.has(player.id)) {
        this.scene.physics.add.collider(player.sprite, this.rockGroup);
        this.collidersSetup.add(player.id);
      }

      // Tote Spieler: Physik ist bereits deaktiviert (body.enable = false durch CombatSystem)
      if (!this.combatSystem.isAlive(player.id)) continue;

      // Input lesen, Velocity setzen (mit Diagonal-Normalisierung)
      const input = this.bridge.getPlayerInput(player.id);
      const dx    = input?.dx ?? 0;
      const dy    = input?.dy ?? 0;
      const len   = Math.sqrt(dx * dx + dy * dy);

      if (len > 0) {
        player.body.setVelocity((dx / len) * PLAYER_SPEED, (dy / len) * PLAYER_SPEED);
      } else {
        player.body.setVelocity(0, 0);
      }
    }
  }
}
