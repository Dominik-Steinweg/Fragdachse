import * as Phaser from 'phaser';
import { CELL_SIZE, ROCK_HP_MAX } from '../config';
import type { ArenaLayout, AudioKey, ProjectileSpawnConfig } from '../types';
import { ProjectileManager } from '../entities/ProjectileManager';
import { DetonationSystem } from '../systems/DetonationSystem';
import { CombatGeometry } from '../systems/CombatGeometry';
import { RockHpRegistry } from '../arena/RockHpRegistry';
import {
  applyRadialEnvironmentDamage,
  type EnvironmentRockSink,
} from '../systems/EnvironmentDamageResolver';
import { resolveDetonations, type DetonationEffectSink } from '../systems/DetonationResolver';
import type {
  HitscanShotRequest,
  MeleeSwingRequest,
  WeaponFireSink,
} from '../loadout/WeaponFireExecutor';
import type { EffectSystem } from '../effects/EffectSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { wireProjectileRenderers, type RendererBundle } from '../scenes/arena/RendererBundle';
import type { AmbientActorRegistry } from './AmbientActorRegistry';
import type { LobbyAmbientActor } from './LobbyAmbientActor';
import type { LobbyObstacleWorld } from './LobbyObstacleWorld';
import type { LobbyRockBodyPool, LobbyZoneRect } from './LobbyRockBodyPool';

/** Ambient-Basislautstärke laut GDD; räumliches Panning und Distanzlogik bleiben aktiv. */
export const AMBIENT_AUDIO_VOLUME_SCALE = 0.25;

/** Rollen der Felsen; strukturelle nehmen keinen Schaden. */
export type AmbientRockRoleLookup = (rockId: number) => 'structural' | 'ambient';

export interface AmbientCombatDeps {
  readonly scene: Phaser.Scene;
  readonly layout: ArenaLayout;
  readonly world: LobbyObstacleWorld;
  readonly actors: AmbientActorRegistry;
  readonly bodyPool: LobbyRockBodyPool;
  readonly renderers: RendererBundle;
  readonly effects: EffectSystem;
  readonly audio: GameAudioSystem;
  readonly rockRole: AmbientRockRoleLookup;
  /** Meldet dem Vorschau-Renderer, dass ein Fels verschwunden oder zurück ist. */
  readonly onRockAliveChanged: (rockId: number, alive: boolean) => void;
}

/** Ein Fels, der in dieser Sequenz Schaden genommen hat. */
export interface AmbientRockDamageRecord {
  rockId: number;
  destroyed: boolean;
}

/**
 * Der lokale Gefechtsraum der Lobby.
 *
 * Führt einen eigenen {@link ProjectileManager} und ein eigenes {@link DetonationSystem} –
 * dieselben Klassen, dieselben Projektilparameter, Bounce-, Homing- und
 * Anti-Tunneling-Regeln, dieselben Renderer. Hitscan, Nahkampf und Umgebungsschaden laufen
 * über die gemeinsamen Kerne ({@link CombatGeometry}, Environment- und Detonations-Resolver);
 * es gibt keine zweite Trefferrechnung und keine Ambient-Sonderregeln.
 *
 * Alles hier ist rein lokal: keine RPCs, kein Raumzustand, keine Host-Autorität.
 */
export class AmbientCombatWorld implements WeaponFireSink {
  readonly projectiles: ProjectileManager;
  readonly detonations: DetonationSystem;
  /** Fels-HP ohne Netzwerkschicht – dieselbe Semantik wie im Gameplay. */
  readonly rockHp: RockHpRegistry;

  private readonly geometry: CombatGeometry;
  private readonly damagedRocks = new Map<number, AmbientRockDamageRecord>();
  /** Streuwert der Blutspritzer; dieselbe Rolle wie der replizierte Seed im Gameplay. */
  private hitEffectSeed = 1;
  private readonly scratchLine = new Phaser.Geom.Line();

  constructor(private readonly deps: AmbientCombatDeps) {
    this.geometry = deps.world.geometry;
    this.rockHp = new RockHpRegistry(deps.layout);
    this.projectiles = new ProjectileManager(deps.scene);
    this.detonations = new DetonationSystem(this.projectiles);

    // Dieselben Projektil-Renderer wie die Arena. Ohne diese Verdrahtung fiele der Manager
    // auf seine nackten Ersatzformen zurück – Kugeln wären Kreise ohne Spur und Mündungsfeuer.
    wireProjectileRenderers(deps.renderers, this.projectiles, deps.actors);

    this.projectiles.setObstacleIndex(deps.world.obstacleIndex);
    this.projectiles.setRockHitCallback((rockId, damage) => this.damageRock(rockId, damage));
    this.projectiles.setAudioSystem(deps.audio);
    // In der Lobby gibt es keine beweglichen Blocker; die Schusslinie ist dort die Sichtlinie.
    this.projectiles.setHomingLineOfFireChecker((sx, sy, ex, ey) => this.geometry.hasLineOfSight(sx, sy, ex, ey));
  }

  // ── Zonenwechsel ───────────────────────────────────────────────────────────

  /**
   * Rüstet den Gefechtsraum für eine Sequenzzone aus. Fels-Kollisionskörper entstehen nur
   * hier, damit die Vorschau nicht dauerhaft hunderte Körper mitschleppt.
   */
  enterZone(zone: LobbyZoneRect): void {
    this.deps.bodyPool.acquireForZone(zone);
    this.projectiles.setRockGroup(
      this.deps.bodyPool.getGroup(),
      this.deps.bodyPool.getObjects(),
      this.deps.bodyPool.getTrunkGroup(),
    );
  }

  /**
   * Gibt die Zonenkörper frei; danach existiert kein Ambient-Kollisionskörper mehr.
   *
   * Die Reihenfolge ist zwingend: Jedes Projektil hält Arcade-Kollider auf die Fels-Gruppe.
   * Wird die Gruppe zerstört, während noch ein Projektil fliegt, greift der nächste
   * Physikschritt auf ihre abgeräumte Kinderliste zu und der Frame bricht ab. Erst die
   * Projektile abräumen, dann die Gruppe lösen, dann freigeben.
   */
  leaveZone(): void {
    this.projectiles.destroyAll();
    this.projectiles.setRockGroup(null, null, null);
    this.deps.bodyPool.release();
  }

  // ── WeaponFireSink ─────────────────────────────────────────────────────────

  spawnProjectile(x: number, y: number, angle: number, ownerId: string, cfg: ProjectileSpawnConfig): void {
    this.projectiles.spawnProjectile(x, y, angle, ownerId, cfg);
  }

  /**
   * Hitscan über den gemeinsamen geometrischen Kern: nächstes Hindernis, nächster Actor,
   * und – falls die Waffe ein Detonator ist – die echte Detonationsprüfung.
   */
  resolveHitscan(request: HitscanShotRequest): boolean {
    const shooter = this.deps.actors.get(request.shooterId);
    const dirX = Math.cos(request.angle);
    const dirY = Math.sin(request.angle);
    const endX = request.startX + dirX * request.range;
    const endY = request.startY + dirY * request.range;
    const line = this.scratchLine.setTo(request.startX, request.startY, endX, endY);

    const obstacleHit = this.geometry.nearestObstacleHit(line);
    let closest = obstacleHit?.distance ?? request.range;
    let hitActor: LobbyAmbientActor | null = null;

    for (const target of this.deps.actors.all()) {
      if (!target.isAlive() || target.id === request.shooterId) continue;
      if (target.isBurrowing()) continue;
      if (shooter && target.team === shooter.team) continue;
      const hit = this.geometry.nearestCircleHit(
        line,
        target.x,
        target.y,
        target.collisionRadius + request.traceThickness * 0.5,
      );
      if (!hit || hit.distance > closest) continue;
      closest = hit.distance;
      hitActor = target;
    }

    const impactX = request.startX + dirX * closest;
    const impactY = request.startY + dirY * closest;

    if (request.detonator) {
      this.detonations.checkHitscanDetonations(
        request.startX, request.startY, impactX, impactY, request.shooterId, request.detonator,
      );
    }

    if (hitActor) {
      this.damageActor(hitActor, request.damage, dirX, dirY, request.shooterId);
    } else if (obstacleHit?.kind === 'rock' && obstacleHit.index !== undefined) {
      this.damageRock(obstacleHit.index, Math.round(request.damage * request.rockDamageMult));
    }

    const visualStart = request.visualMuzzleOrigin ?? { x: request.startX, y: request.startY };
    this.deps.effects.playHitscanTracer(
      visualStart.x, visualStart.y, impactX, impactY,
      request.color, request.traceThickness,
      hitActor ? 'player' : obstacleHit ? 'environment' : 'none',
      request.visualPreset,
    );
    this.deps.renderers.muzzleFlash.playHitscanFlash(
      visualStart.x, visualStart.y, dirX, dirY, request.visualPreset, request.color,
    );
    this.playAmbientSound(request.shotAudioKey, visualStart.x, visualStart.y);
    return true;
  }

  /** Nahkampf über denselben Bogen- und Hindernistest wie das Gameplay. */
  resolveMelee(request: MeleeSwingRequest): boolean {
    const shooter = this.deps.actors.get(request.shooterId);
    const halfArcRad = (request.arcDegrees * Math.PI / 180) / 2;

    for (const target of this.deps.actors.all()) {
      if (!target.isAlive() || target.id === request.shooterId) continue;
      if (target.isBurrowing()) continue;
      if (shooter && target.team === shooter.team) continue;

      const dx = target.x - request.x;
      const dy = target.y - request.y;
      const distance = Math.hypot(dx, dy);
      if (distance > request.range + target.collisionRadius) continue;
      if (!CombatGeometry.isWithinArc(dx, dy, request.angle, halfArcRad)) continue;

      this.scratchLine.setTo(request.x, request.y, target.x, target.y);
      if (this.geometry.isPathBlocked(this.scratchLine, distance - target.collisionRadius)) continue;

      this.damageActor(target, request.damage, dx / distance, dy / distance, request.shooterId);
    }

    // Felsen im Bogen nehmen ebenfalls Schaden – dieselbe Regel wie in der Arena.
    if (request.rockDamageMult > 0) {
      this.damageRocksInMeleeArc(request, halfArcRad);
    }

    this.deps.effects.playMeleeSwingEffect(
      request.x, request.y, request.angle, request.arcDegrees, request.range, request.color,
    );
    this.playAmbientSound(request.shotAudioKey, request.x, request.y);
    return true;
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  update(deltaMs: number): void {
    this.detonations.checkProjectileDetonations();
    const { explodedProjectiles, explodedGrenades } = this.projectiles.hostUpdate(deltaMs);
    // Nach dem Flugschritt, damit die überstrichene Strecke dieses Frames geprüft wird.
    this.resolveProjectileActorHits();

    for (const explosion of explodedProjectiles) {
      this.applyExplosion(
        explosion.x, explosion.y,
        explosion.effect.radius, explosion.effect.maxDamage,
        explosion.effect.rockDamageMult ?? 1,
        explosion.ownerId,
        explosion.effect.falloffReduction !== undefined || explosion.effect.minDamage !== undefined
          ? { minDamage: explosion.effect.minDamage ?? 0 }
          : undefined,
        explosion.effect.visualStyle,
        undefined,
      );
    }

    for (const grenade of explodedGrenades) {
      if (grenade.effect.type !== 'damage') continue;
      this.applyExplosion(
        grenade.x, grenade.y,
        grenade.effect.radius, grenade.effect.damage,
        grenade.effect.rockDamageMult ?? 1,
        grenade.ownerId,
        undefined,
        undefined,
        undefined,
      );
    }

    resolveDetonations(this.detonationSink, this.detonations.flushDetonations());
  }

  // ── Fels- und Explosionswirkung ────────────────────────────────────────────

  /**
   * Umgebungsschaden über den gemeinsamen Resolver – identischer Falloff, identischer
   * `rockDamageMult`, keine künstliche Begrenzung der Trefferzahl.
   */
  applyExplosion(
    x: number, y: number, radius: number, damage: number,
    rockDamageMult: number,
    attackerId: string,
    falloff: { minDamage: number } | undefined,
    visualStyle: Parameters<EffectSystem['playExplosionEffect']>[4] | undefined,
    color: number | undefined,
  ): void {
    applyRadialEnvironmentDamage(
      this.environmentSink,
      { x, y, radius, damage, rockDamageMult, falloff },
      attackerId,
      false,
    );

    this.damageActorsInRadius(x, y, radius, damage, falloff, attackerId);
    this.deps.effects.playExplosionEffect(x, y, radius, color, visualStyle ?? 'default');
  }

  /**
   * Einziger Weg, auf dem ein Ambient-Actor Schaden nimmt.
   *
   * Er erzeugt dabei denselben Trefferabdruck wie das Gameplay – Blutspritzer, Zielreaktion
   * und Trefferton laufen über `EffectSystem` und `HitFeedbackRenderer`, nicht über eine
   * lobbyeigene Darstellung.
   */
  private damageActor(
    target: LobbyAmbientActor,
    damage: number,
    dirX: number,
    dirY: number,
    shooterId: string,
  ): void {
    if (damage <= 0 || !target.isAlive()) return;
    const before = target.getHp();
    const remaining = target.applyDamage(damage);
    const dealt = before - remaining;
    if (dealt <= 0) return;

    this.deps.effects.playLocalHitEffect({
      type: 'hit',
      x: target.x,
      y: target.y,
      targetId: target.id,
      shooterId,
      targetColor: target.color,
      totalDamage: dealt,
      hpLost: dealt,
      armorLost: 0,
      isKill: remaining <= 0,
      dirX,
      dirY,
      seed: (this.hitEffectSeed = (this.hitEffectSeed + 0x9e3779b1) >>> 0),
    });
  }

  private damageActorsInRadius(
    x: number, y: number, radius: number, damage: number,
    falloff: { minDamage: number } | undefined,
    attackerId: string,
  ): void {
    for (const actor of this.deps.actors.all()) {
      if (!actor.isAlive() || actor.isBurrowing()) continue;
      const dx = actor.x - x;
      const dy = actor.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const share = falloff
        ? Math.max(falloff.minDamage, damage * (1 - distance / Math.max(1, radius)))
        : damage;
      const length = Math.max(0.001, distance);
      this.damageActor(actor, Math.round(share), dx / length, dy / length, attackerId);
    }
  }

  /**
   * Projektiltreffer auf Ambient-Actors.
   *
   * Der geteilte Projektilmanager kennt nur Felsen, Basen und den Zug – Figuren prüft im
   * Gameplay das `CombatSystem`. Die Lobby braucht denselben Schritt, und zwar überstrichen:
   * Ein schnelles Geschoss legt pro Frame mehr zurück als ein Dachs breit ist und würde bei
   * einer reinen Punktprüfung durch ihn hindurchfliegen.
   */
  private resolveProjectileActorHits(): void {
    for (const projectile of [...this.projectiles.getActiveProjectiles()]) {
      if (projectile.pendingDestroy) continue;
      const owner = this.deps.actors.get(projectile.ownerId);
      const line = this.scratchLine.setTo(
        projectile.lastX, projectile.lastY, projectile.sprite.x, projectile.sprite.y,
      );

      let hit: LobbyAmbientActor | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const target of this.deps.actors.all()) {
        if (!target.isAlive() || target.id === projectile.ownerId) continue;
        if (target.isBurrowing()) continue;
        if (owner && target.team === owner.team) continue;

        const radius = target.collisionRadius + projectile.sprite.displayWidth * 0.5;
        // Der Startpunkt kann bereits im Ziel liegen; dann zählt der Abstand selbst.
        const inside = Math.hypot(target.x - line.x1, target.y - line.y1) <= radius;
        const swept = inside ? 0 : this.geometry.nearestCircleHit(line, target.x, target.y, radius)?.distance;
        if (swept === undefined || swept >= bestDistance) continue;
        bestDistance = swept;
        hit = target;
      }
      if (!hit) continue;

      const velocity = projectile.body?.velocity;
      const speed = velocity ? Math.hypot(velocity.x, velocity.y) : 0;
      const dirX = speed > 0 ? velocity!.x / speed : 1;
      const dirY = speed > 0 ? velocity!.y / speed : 0;
      this.damageActor(hit, projectile.damage, dirX, dirY, projectile.ownerId);

      // Sprenggeschosse wirken auch auf die Umgebung – derselbe Weg wie beim Einschlag am Fels.
      if (projectile.explosion) {
        this.applyExplosion(
          hit.x, hit.y,
          projectile.explosion.radius, projectile.explosion.maxDamage,
          projectile.explosion.rockDamageMult ?? 1,
          projectile.ownerId,
          projectile.explosion.minDamage === undefined ? undefined : { minDamage: projectile.explosion.minDamage },
          projectile.explosion.visualStyle,
          projectile.color,
        );
      }
      this.projectiles.destroyProjectile(projectile.id);
    }
  }

  /**
   * Eigenes fliegendes, detonierbares Projektil eines Actors – der ASMD-Ball.
   *
   * Der Actor richtet seine Primärwaffe darauf aus, statt blind in Zielrichtung zu schiessen.
   * Gezündet wird danach über die echte Detonationsmechanik; es gibt keine lobbyeigene
   * ASMD-Explosion.
   */
  findOwnDetonable(ownerId: string, tag: string): { x: number; y: number } | null {
    for (const projectile of this.projectiles.getActiveProjectiles()) {
      if (projectile.ownerId !== ownerId) continue;
      if (projectile.detonable?.tag !== tag) continue;
      return { x: projectile.sprite.x, y: projectile.sprite.y };
    }
    return null;
  }

  /** Felsen, die in dieser Sequenz beschädigt oder zerstört wurden – Auftrag für den Inspector. */
  takeDamagedRocks(): AmbientRockDamageRecord[] {
    const records = [...this.damagedRocks.values()];
    this.damagedRocks.clear();
    return records;
  }

  /** Baut einen zerstörten Fels als neutralen Landschaftsfels wieder auf. */
  restoreRock(rockId: number): void {
    this.rockHp.register(rockId, ROCK_HP_MAX);
    this.deps.world.setRockAlive(rockId, true);
    this.deps.bodyPool.restoreBody(rockId);
    this.deps.onRockAliveChanged(rockId, true);
  }

  /** Repariert einen beschädigten, noch stehenden Fels. Zerstörte bleiben unberührt. */
  repairRock(rockId: number, amount: number): number {
    const before = this.rockHp.getHP(rockId);
    if (before <= 0 || amount <= 0) return 0;
    const maxHp = this.rockHp.getMaxHP(rockId);
    if (before >= maxHp) return 0;
    this.rockHp.setHP(rockId, Math.min(maxHp, before + amount));
    return this.rockHp.getHP(rockId) - before;
  }

  destroy(): void {
    // Gleiche Reihenfolge wie in {@link leaveZone}: erst die Projektile mit ihren Kollidern.
    this.projectiles.destroyAll();
    this.projectiles.setRockGroup(null, null, null);
    this.detonations.reset();
    this.damagedRocks.clear();
    this.deps.bodyPool.release();
  }

  // ── Senken der gemeinsamen Resolver ────────────────────────────────────────

  private readonly environmentSink: EnvironmentRockSink = {
    forEachActiveRock: (visit) => {
      const rocks = this.deps.layout.rocks;
      for (let id = 0; id < rocks.length; id += 1) {
        if (!this.deps.world.isRockAlive(id)) continue;
        const world = this.deps.world.cellToWorld(rocks[id].gridX, rocks[id].gridY);
        visit(id, world.x, world.y);
      }
    },
    // Strukturelle Felsen tragen das Layout der Oberfläche und sind unzerstörbar.
    resolveRockDamage: (rockId, damage) => (this.deps.rockRole(rockId) === 'structural' ? 0 : damage),
    applyRockDamage: (rockId, damage) => this.rockHp.applyDamage(rockId, damage),
    onRockDestroyed: (rockId) => this.destroyRock(rockId),
  };

  private readonly detonationSink: DetonationEffectSink = {
    // Ambient simuliert keine Ressourcen.
    addComboAdrenaline: () => {},
    applyAoeDamage: (x, y, radius, damage, attackerId, falloff) => {
      for (const actor of this.deps.actors.all()) {
        if (!actor.isAlive()) continue;
        const distance = Math.hypot(actor.x - x, actor.y - y);
        if (distance > radius) continue;
        const share = falloff
          ? Math.max(falloff.minDamage, damage * (1 - distance / Math.max(1, radius)))
          : damage;
        void attackerId;
        actor.applyDamage(Math.round(share));
      }
    },
    // Kein Physik-Rückstoß: Ambient-Actors bewegen sich über Wegpunkte, nicht über Körper.
    applyRadialImpulse: () => {},
    applyEnvironmentDamage: (x, y, radius, damage, rockMult, _trainMult, attackerId, falloff) => {
      applyRadialEnvironmentDamage(
        this.environmentSink,
        { x, y, radius, damage, rockDamageMult: rockMult, falloff },
        attackerId,
        false,
      );
    },
    playExplosion: (x, y, radius, color, visualStyle) => {
      this.deps.effects.playExplosionEffect(x, y, radius, color, visualStyle ?? 'default');
    },
    // Flächen über Zeit gehören zum Rundenzustand und werden nicht inszeniert.
    spawnDotArea: () => {},
    resolveOwnerColor: (ownerId) => this.deps.actors.get(ownerId)?.color,
  };

  // ── Intern ─────────────────────────────────────────────────────────────────

  private damageRock(rockId: number, damage: number): void {
    if (damage <= 0) return;
    if (this.deps.rockRole(rockId) === 'structural') return;
    if (!this.deps.world.isRockAlive(rockId)) return;

    const remaining = this.rockHp.applyDamage(rockId, damage);
    this.noteDamagedRock(rockId, remaining <= 0);
    if (remaining <= 0) this.destroyRock(rockId);
  }

  private destroyRock(rockId: number): void {
    if (!this.deps.world.setRockAlive(rockId, false)) return;
    this.rockHp.remove(rockId);
    this.noteDamagedRock(rockId, true);

    // Die Lobby nutzt noch klassische Bodies, reicht dem gemeinsamen VFX-Pfad aber denselben
    // rendererunabhaengigen Snapshot wie die Arena.
    const body = this.deps.bodyPool.getObjects()?.[rockId];
    if (body) this.deps.renderers.rockDestruction.playDestruction({
      x: body.x,
      y: body.y,
      frame: Number(body.frame.name),
      size: Math.max(1, body.frame.width),
      tint: body.tintTopLeft ?? 0xffffff,
      angle: body.angle,
      alpha: body.alpha,
      scaleX: body.displayWidth / Math.max(1, body.frame.width),
      scaleY: body.displayHeight / Math.max(1, body.frame.height),
    });
    this.deps.bodyPool.removeBody(rockId);
    this.deps.onRockAliveChanged(rockId, false);
  }

  private noteDamagedRock(rockId: number, destroyed: boolean): void {
    const existing = this.damagedRocks.get(rockId);
    if (existing) {
      existing.destroyed ||= destroyed;
      return;
    }
    this.damagedRocks.set(rockId, { rockId, destroyed });
  }

  private damageRocksInMeleeArc(request: MeleeSwingRequest, halfArcRad: number): void {
    const rocks = this.deps.layout.rocks;
    const reach = request.range + CELL_SIZE;
    for (let id = 0; id < rocks.length; id += 1) {
      if (!this.deps.world.isRockAlive(id)) continue;
      const world = this.deps.world.cellToWorld(rocks[id].gridX, rocks[id].gridY);
      const dx = world.x - request.x;
      const dy = world.y - request.y;
      if (Math.hypot(dx, dy) > reach) continue;
      if (!CombatGeometry.isWithinArc(dx, dy, request.angle, halfArcRad)) continue;
      this.damageRock(id, Math.round(request.damage * request.rockDamageMult));
    }
  }

  private playAmbientSound(key: string | undefined, x: number, y: number): void {
    if (!key) return;
    this.deps.audio.playSound(key as AudioKey, x, y, undefined, AMBIENT_AUDIO_VOLUME_SCALE);
  }
}
