import Phaser from 'phaser';
import type { PlayerProfile } from '../types';
import type { ArenaLayout }   from '../types';
import { PlayerEntity }       from './PlayerEntity';
import {
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  CELL_SIZE, GRID_COLS, GRID_ROWS,
} from '../config';

export class PlayerManager {
  private scene:   Phaser.Scene;
  private players: Map<string, PlayerEntity> = new Map();
  private layout:  ArenaLayout | null = null;
  private localPlayerId: string | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  /**
   * Übergibt das aktuelle Arena-Layout.
   * Muss vor addPlayer() und vor Respawns aufgerufen werden.
   */
  setLayout(layout: ArenaLayout): void {
    this.layout = layout;
  }

  /** Erstellt eine PlayerEntity an einer zufällig freien Arena-Position.
   *  Wird nur aufgerufen wenn isReady === true. */
  addPlayer(profile: PlayerProfile): void {
    if (this.players.has(profile.id)) return;
    const spawn = this.getSpawnPoint();
    const entity = new PlayerEntity(
      this.scene, profile,
      ARENA_OFFSET_X + spawn.x,
      ARENA_OFFSET_Y + spawn.y,
      this.localPlayerId !== null && profile.id !== this.localPlayerId,
    );
    this.players.set(profile.id, entity);
  }

  /** Zerstört die PlayerEntity. */
  removePlayer(id: string): void {
    const entity = this.players.get(id);
    if (entity) {
      entity.destroy();
      this.players.delete(id);
    }
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  getPlayer(id: string): PlayerEntity | undefined {
    return this.players.get(id);
  }

  getAllPlayers(): PlayerEntity[] {
    return Array.from(this.players.values());
  }

  /**
   * Gibt eine zufällige freie Arena-Zelle zurück (relative Arena-Koordinaten).
   * Schließt blockierte Zellen (Fels, Trunk) und aktuell belegte Spieler-Zellen aus.
   * Wird sowohl für Initial-Spawn als auch für Respawns verwendet.
   */
  getSpawnPoint(): { x: number; y: number } {
    const blocked = new Set<string>();

    // Felsen, Baumstümpfe und Gleise aus dem Layout blockieren
    if (this.layout) {
      for (const r of this.layout.rocks) blocked.add(`${r.gridX}_${r.gridY}`);
      for (const t of this.layout.trees) blocked.add(`${t.gridX}_${t.gridY}`);
      for (const track of this.layout.tracks) {
        blocked.add(`${track.gridX}_${track.gridY}`);
        blocked.add(`${track.gridX + 1}_${track.gridY}`);
      }
      for (const pedestal of this.layout.powerUpPedestals) {
        blocked.add(`${pedestal.gridX}_${pedestal.gridY}`);
      }
    }

    // Aktuell belegte Spieler-Zellen ausschließen
    for (const p of this.players.values()) {
      if (!p.sprite.active) continue;
      const gx = Math.floor((p.sprite.x - ARENA_OFFSET_X) / CELL_SIZE);
      const gy = Math.floor((p.sprite.y - ARENA_OFFSET_Y) / CELL_SIZE);
      blocked.add(`${gx}_${gy}`);
    }

    // Alle freien Zellen sammeln
    const free: Array<{ x: number; y: number }> = [];
    for (let gy = 0; gy < GRID_ROWS; gy++) {
      for (let gx = 0; gx < GRID_COLS; gx++) {
        if (!blocked.has(`${gx}_${gy}`)) {
          free.push({
            x: gx * CELL_SIZE + CELL_SIZE / 2,
            y: gy * CELL_SIZE + CELL_SIZE / 2,
          });
        }
      }
    }

    // Zufällig wählen – Math.random reicht (Spawn-Zeitpunkt nicht vorhersehbar)
    if (free.length === 0) {
      return { x: CELL_SIZE / 2, y: CELL_SIZE / 2 }; // Notfall-Fallback
    }
    return free[Math.floor(Math.random() * free.length)];
  }
}
