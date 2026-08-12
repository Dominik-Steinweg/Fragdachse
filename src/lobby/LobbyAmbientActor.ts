import type * as Phaser from 'phaser';
import { PLAYER_SIZE } from '../config';
import type { CoopDefenseEnemyKind, ResolvedCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { EnemyEntity } from '../entities/EnemyEntity';
import { PlayerEntity } from '../entities/PlayerEntity';
import type { LightingSystem } from '../effects/LightingSystem';
import type { NavWaypoint } from './LobbyNavigation';

/** Zu welcher Seite ein Ambient-Actor gehört. Rein lokal – keine Teams, keine Spieleridentität. */
export type AmbientActorTeam = 'badger' | 'enemy';

/** Wo der Actor in seiner Sequenz steht. */
export type AmbientActorPhase = 'idle' | 'moving' | 'engaging' | 'retreating' | 'dead';

export interface AmbientBadgerSpawn {
  id:        string;
  team:      'badger';
  x:         number;
  y:         number;
  aimAngle:  number;
  hp:        number;
  moveSpeed: number;
  /** Getragene Waffe; nur Darstellung, der Schuss läuft über den WeaponFireExecutor. */
  weaponId?: string;
  /** Neutraler Glow. Bewusst keine Spielerfarbe. */
  glowColor: number;
}

export interface AmbientEnemySpawn {
  id:        string;
  team:      'enemy';
  x:         number;
  y:         number;
  aimAngle:  number;
  moveSpeed: number;
  enemyKind: CoopDefenseEnemyKind;
  config:    ResolvedCoopDefenseEnemyConfig;
}

export type AmbientActorSpawn = AmbientBadgerSpawn | AmbientEnemySpawn;

/** Wie nah ein Wegpunkt erreicht sein muss, bevor der nächste gilt. */
const WAYPOINT_ARRIVAL_PX = 4;
/** Maximale Drehgeschwindigkeit des Zielwinkels in Radiant pro Sekunde. */
const AIM_TURN_RATE = Math.PI * 2.6;

/**
 * Ein Darsteller der Lobby-Inszenierung.
 *
 * Bewusst ein dünner Wrapper: Er führt Identität, Rolle, lokale HP, Bewegung, Zielrichtung,
 * aktive Waffe und Sequenzstatus – mehr nicht. Die Darstellung liegt vollständig in
 * {@link PlayerEntity} (Presentation-Modus) beziehungsweise {@link EnemyEntity} (nicht
 * autoritativer Modus); es gibt keine lobbyeigene Renderer-Klasse.
 *
 * Bewegung läuft über vorberechnete Wegpunkte der {@link LobbyNavigation}, nicht über Physik:
 * Die Felsen der Lobby existieren als leichte Hindernisproxies ohne Kollisionskörper, und die
 * Navigation respektiert deren Hitboxen bereits.
 */
export class LobbyAmbientActor {
  readonly id: string;
  readonly team: AmbientActorTeam;

  private readonly badger: PlayerEntity | null;
  private readonly enemy: EnemyEntity | null;

  private hp: number;
  private readonly maxHp: number;
  private moveSpeed: number;
  private aimAngle: number;
  private targetAimAngle: number;
  private weaponId: string | null;
  private phase: AmbientActorPhase = 'idle';

  private path: NavWaypoint[] = [];
  private pathIndex = 0;
  /** Topologiestand, für den der aktuelle Pfad geplant wurde. */
  private pathTopologyVersion = -1;

  constructor(scene: Phaser.Scene, spawn: AmbientActorSpawn, lighting: LightingSystem | null) {
    this.id = spawn.id;
    this.team = spawn.team;
    this.aimAngle = spawn.aimAngle;
    this.targetAimAngle = spawn.aimAngle;
    this.moveSpeed = spawn.moveSpeed;

    if (spawn.team === 'badger') {
      this.enemy = null;
      this.badger = new PlayerEntity(
        scene,
        // Kein Name, keine Spielerfarbe, keine Spieleridentität – nur die Figur.
        { id: spawn.id, name: '', colorHex: spawn.glowColor },
        spawn.x,
        spawn.y,
        false,
        lighting,
        { presentation: true },
      );
      this.badger.setRotation(spawn.aimAngle);
      this.weaponId = spawn.weaponId ?? null;
      if (this.weaponId) this.badger.setHeldItemId(this.weaponId);
      this.hp = spawn.hp;
      this.maxHp = spawn.hp;
    } else {
      this.badger = null;
      this.weaponId = null;
      this.enemy = new EnemyEntity(
        scene,
        spawn.id,
        spawn.x,
        spawn.y,
        // Nicht autoritativ: keine Waffen, keine Angriffslogik, reine Darstellung.
        false,
        spawn.enemyKind,
        spawn.config,
      );
      this.enemy.setLightingSystem(lighting);
      this.enemy.setTargetRotation(spawn.aimAngle);
      this.hp = spawn.config.maxHp;
      this.maxHp = spawn.config.maxHp;
      this.enemy.setHp(this.hp, this.maxHp);
    }
  }

  get x(): number {
    return this.badger?.sprite.x ?? this.enemy?.sprite.x ?? 0;
  }

  get y(): number {
    return this.badger?.sprite.y ?? this.enemy?.sprite.y ?? 0;
  }

  get visible(): boolean {
    return this.badger?.sprite.visible ?? this.enemy?.sprite.visible ?? false;
  }

  /** Neutraler Glow beziehungsweise Tint – speist die geteilte Renderkette. */
  get color(): number {
    return this.badger?.color ?? this.enemy?.getTintColor() ?? 0xffffff;
  }

  get collisionRadius(): number {
    return this.enemy?.getCollisionRadius() ?? PLAYER_SIZE * 0.5;
  }

  getPhase(): AmbientActorPhase {
    return this.phase;
  }

  setPhase(phase: AmbientActorPhase): void {
    this.phase = phase;
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  getHp(): number {
    return this.hp;
  }

  getWeaponId(): string | null {
    return this.weaponId;
  }

  /**
   * Wechselt die getragene Waffe. Wird vom Compiler **vor** dem Start einer Sequenz gesetzt;
   * eine laufende Sequenz ändert ihre Waffe nicht mehr.
   */
  setWeaponId(weaponId: string | null): void {
    this.weaponId = weaponId;
    this.badger?.setHeldItemId(weaponId);
  }

  setAimAngle(angle: number): void {
    this.targetAimAngle = angle;
  }

  /** Richtet den Actor sofort aus, ohne die Drehung zu animieren (Sequenzstart). */
  snapAimAngle(angle: number): void {
    this.aimAngle = angle;
    this.targetAimAngle = angle;
    this.applyAim();
  }

  getAimAngle(): number {
    return this.aimAngle;
  }

  aimAt(x: number, y: number): void {
    this.setAimAngle(Math.atan2(y - this.y, x - this.x));
  }

  /** Der Punkt, an dem Projektile und Strahlen entstehen. */
  getMuzzleOrigin(): NavWaypoint {
    return { x: this.x, y: this.y };
  }

  setPath(path: NavWaypoint[], topologyVersion: number): void {
    this.path = path;
    this.pathIndex = 0;
    this.pathTopologyVersion = topologyVersion;
  }

  clearPath(): void {
    this.path = [];
    this.pathIndex = 0;
  }

  hasPath(): boolean {
    return this.pathIndex < this.path.length;
  }

  /**
   * Muss der Pfad neu geplant werden? Wahr, sobald sich die Felslandschaft geändert hat –
   * eine Explosion kann den geplanten Weg zugeschüttet oder einen kürzeren geöffnet haben.
   */
  needsRepath(topologyVersion: number): boolean {
    return this.hasPath() && this.pathTopologyVersion !== topologyVersion;
  }

  /** Verbleibendes Ziel des aktuellen Pfads. */
  getPathTarget(): NavWaypoint | null {
    return this.path.length > 0 ? this.path[this.path.length - 1] : null;
  }

  applyDamage(amount: number): number {
    if (amount <= 0 || this.hp <= 0) return this.hp;
    this.hp = Math.max(0, this.hp - amount);
    this.enemy?.setHp(this.hp, this.maxHp);
    if (this.hp <= 0) {
      this.phase = 'dead';
      // Death-VFX der jeweiligen Entity; kein lobbyeigener Todeseffekt.
      this.badger?.setVisible(false);
      this.enemy?.sprite.setVisible(false);
    }
    return this.hp;
  }

  update(deltaMs: number): void {
    this.advanceAlongPath(deltaMs);
    this.turnTowardsTargetAim(deltaMs);
  }

  destroy(): void {
    this.badger?.destroy();
    this.enemy?.destroy();
  }

  private advanceAlongPath(deltaMs: number): void {
    if (!this.hasPath() || this.hp <= 0) return;

    let remaining = (this.moveSpeed * deltaMs) / 1000;
    let x = this.x;
    let y = this.y;

    while (remaining > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      const dx = target.x - x;
      const dy = target.y - y;
      const distance = Math.hypot(dx, dy);

      if (distance <= Math.max(remaining, WAYPOINT_ARRIVAL_PX)) {
        x = target.x;
        y = target.y;
        remaining -= distance;
        this.pathIndex += 1;
        continue;
      }

      x += (dx / distance) * remaining;
      y += (dy / distance) * remaining;
      remaining = 0;
    }

    this.setPosition(x, y);
  }

  private setPosition(x: number, y: number): void {
    this.badger?.setPosition(x, y);
    this.enemy?.setPosition(x, y);
  }

  private turnTowardsTargetAim(deltaMs: number): void {
    let diff = this.targetAimAngle - this.aimAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const maxStep = (AIM_TURN_RATE * deltaMs) / 1000;
    this.aimAngle += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
    this.applyAim();
  }

  private applyAim(): void {
    this.badger?.setRotation(this.aimAngle);
    this.enemy?.setTargetRotation(this.aimAngle);
    this.enemy?.lerpStep(1);
  }
}
