import type { NetworkBridge }     from '../network/NetworkBridge';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';

export class ShootingSystem {
  private bridge:            NetworkBridge;
  private playerManager:     PlayerManager;
  private projectileManager: ProjectileManager;

  constructor(
    bridge:            NetworkBridge,
    playerManager:     PlayerManager,
    projectileManager: ProjectileManager,
  ) {
    this.bridge            = bridge;
    this.playerManager     = playerManager;
    this.projectileManager = projectileManager;
  }

  /** RPC-Handler registrieren – läuft auf dem Host. */
  setup(): void {
    this.bridge.registerShootHandler((angle: number, shooterId: string) => {
      const player = this.playerManager.getPlayer(shooterId);
      if (!player) return;
      this.projectileManager.spawnProjectile(
        player.sprite.x, player.sprite.y, angle, shooterId,
      );
    });
  }

  /** Vom InputSystem aufgerufen wenn der lokale Spieler klickt. */
  fireShot(angle: number): void {
    this.bridge.sendShoot(angle);
  }
}
