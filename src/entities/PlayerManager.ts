import Phaser from 'phaser';
import type { PlayerProfile } from '../types';
import { PlayerEntity } from './PlayerEntity';
import { SPAWN_POINTS, ARENA_OFFSET_X, ARENA_OFFSET_Y } from '../config';

export class PlayerManager {
  private scene:             Phaser.Scene;
  private players:           Map<string, PlayerEntity>              = new Map();
  private playerSpawnPoints: Map<string, { x: number; y: number }> = new Map();
  private spawnIndex         = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Erstellt eine PlayerEntity und registriert den Spawn-Punkt.
   *  Wird nur aufgerufen wenn isReady === true. */
  addPlayer(profile: PlayerProfile): void {
    if (this.players.has(profile.id)) return;
    const spawn = SPAWN_POINTS[this.spawnIndex % SPAWN_POINTS.length];
    this.spawnIndex++;
    this.playerSpawnPoints.set(profile.id, spawn);
    const entity = new PlayerEntity(
      this.scene, profile,
      ARENA_OFFSET_X + spawn.x,
      ARENA_OFFSET_Y + spawn.y,
    );
    this.players.set(profile.id, entity);
  }

  /** Zerstört die PlayerEntity und gibt den Spawn-Punkt frei. */
  removePlayer(id: string): void {
    const entity = this.players.get(id);
    if (entity) {
      entity.destroy();
      this.players.delete(id);
    }
    this.playerSpawnPoints.delete(id);
  }

  /** Gibt true zurück wenn für diese id eine PlayerEntity existiert. */
  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  getPlayer(id: string): PlayerEntity | undefined {
    return this.players.get(id);
  }

  getAllPlayers(): PlayerEntity[] {
    return Array.from(this.players.values());
  }

  /** Gibt den ursprünglichen Spawn-Point des Spielers zurück (für Respawn). */
  getSpawnPoint(id: string): { x: number; y: number } {
    return this.playerSpawnPoints.get(id) ?? SPAWN_POINTS[0];
  }
}
