import Phaser from 'phaser';
import { bridge }           from '../../network/bridge';
import { NET_TICK_INTERVAL_MS, COLORS, DASH_T2_S } from '../../config';
import { UTILITY_CONFIGS, WEAPON_CONFIGS }          from '../../loadout/LoadoutConfig';
import type { PlaceableTurretUtilityConfig }        from '../../loadout/LoadoutConfig';
import { buildLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { isVelocityMoving }  from '../../loadout/SpreadMath';
import { dequantizeAngle }   from '../../utils/angle';
import { PICKUP_RADIUS, NUKE_CONFIG } from '../../powerups/PowerUpConfig';
import { CAPTURE_THE_BEER_MODE, isTeamGameMode } from '../../gameModes';
import type { ArenaContext }      from './ArenaContext';
import type { LocalPlayerState }  from './LocalPlayerState';
import type { RockVisualHelper }  from './RockVisualHelper';
import type { RendererBundle }    from './RendererBundle';
import type { PlayerEntity }      from '../../entities/PlayerEntity';
import type { PlayerAimNetState, PlayerNetState, TeamId, TrackedProjectile } from '../../types';

/**
 * Runs every frame on the host.
 *
 * Owns the 20 Hz network-tick accumulator, leaderboard caching,
 * and all host-side simulation: physics, combat, projectiles, AoE,
 * area-effects, turrets, train, armageddon meteors, and state publishing.
 */
export class HostUpdateCoordinator {
  private active = true;
  private netTickAccumulator = 0;
  private leaderboardSignature = '';
  private cachedLeaderboardEntries: { name: string; colorHex: number; frags: number; ping: number; teamId: TeamId | null; teamScore?: number }[] = [];
  private readonly dashPhase2StartTimes = new Map<string, number>();
  private readonly prevDashPhases       = new Map<string, number>();
  private readonly dashTrailTimers      = new Map<string, number>();
  private readonly prevBurrowPhases     = new Map<string, import('../../types').BurrowPhase>();
  private readonly prevStealthStates    = new Map<string, boolean>();
  private trainSpawned = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly renderers: RendererBundle,
    private readonly localPlayerState: LocalPlayerState,
    private readonly rockVisualHelper: RockVisualHelper,
  ) {}

  setActive(v: boolean): void { this.active = v; }

  setTrainSpawned(v: boolean): void { this.trainSpawned = v; }
  getTrainSpawned(): boolean { return this.trainSpawned; }

  resetPerRound(): void {
    this.active = true;
    this.netTickAccumulator = 0;
    this.leaderboardSignature = '';
    this.cachedLeaderboardEntries = [];
    this.dashPhase2StartTimes.clear();
    this.prevDashPhases.clear();
    this.dashTrailTimers.clear();
    this.prevBurrowPhases.clear();
    this.prevStealthStates.clear();
    this.trainSpawned = false;
  }

  runHostUpdate(delta: number): void {
    if (!this.active) return;
    const countdownActive = bridge.isArenaCountdownActive();
    const now = Date.now();

    if (!countdownActive && this.ctx.resourceSystem && this.ctx.burrowSystem) {
      for (const player of this.ctx.playerManager.getAllPlayers()) {
        if (!this.ctx.burrowSystem.isBurrowed(player.id)) {
          this.ctx.resourceSystem.regenTick(player.id, delta);
        }
      }
      this.ctx.burrowSystem.update(delta);
    }

    if (!countdownActive) {
      this.ctx.loadoutManager?.update(delta);
      this.ctx.powerUpSystem?.update(delta);
    }

    this.ctx.hostPhysics.update(countdownActive);
    const decoys = countdownActive ? [] : this.ctx.decoySystem.hostUpdate(now);
    if (!countdownActive) {
      this.ctx.detonationSystem?.checkProjectileDetonations();
      this.ctx.combatSystem.update();
      this.ctx.combatSystem.updateBurnEffects(now);
    }

    const { synced: projectiles, explodedProjectiles, explodedGrenades, countdownEvents } = countdownActive
      ? { synced: [], explodedProjectiles: [], explodedGrenades: [], countdownEvents: [] }
      : this.ctx.projectileManager.hostUpdate(delta);

    for (const evt of countdownEvents) {
      bridge.broadcastGrenadeCountdown(evt.x, evt.y, evt.value);
    }

    const detonations = countdownActive ? [] : (this.ctx.detonationSystem?.flushDetonations() ?? []);
    for (const det of detonations) {
      this.ctx.combatSystem.applyAoeDamage(
        det.x, det.y, det.effect.aoeRadius, det.effect.aoeDamage, det.detonatorOwnerId,
        false,
        { category: 'explosion', weaponName: 'Detonation' },
      );
      if ((det.effect.knockback ?? 0) > 0) {
        this.ctx.hostPhysics.applyRadialImpulse(
          det.x, det.y, det.effect.aoeRadius,
          det.effect.knockback ?? 0, det.detonatorOwnerId,
          det.effect.selfKnockbackMult ?? 1,
        );
      }
      this.applyAoeEnvironmentDamage(
        det.x, det.y, det.effect.aoeRadius, det.effect.aoeDamage,
        det.effect.rockDamageMult ?? 1, det.effect.trainDamageMult ?? 1, det.detonatorOwnerId,
      );
      const detonatorColor = bridge.getPlayerColor(det.detonatorOwnerId);
      bridge.broadcastExplosionEffect(
        det.x, det.y, det.effect.aoeRadius,
        det.effect.explosionColor ?? detonatorColor,
        det.effect.explosionVisualStyle,
      );
    }

    for (const explosion of explodedProjectiles) {
      this.ctx.combatSystem.applyExplosionDamage(
        explosion.x,
        explosion.y,
        explosion.effect,
        explosion.ownerId,
        explosion.sourceSlot,
        explosion.weaponName ?? 'Explosion',
      );
      this.ctx.hostPhysics.applyRadialImpulse(
        explosion.x, explosion.y, explosion.effect.radius,
        explosion.effect.knockback, explosion.ownerId,
        explosion.effect.selfKnockbackMult ?? 1,
      );
      this.applyExplosionEnvironmentDamage(explosion.x, explosion.y, explosion.effect, explosion.ownerId);
      bridge.broadcastExplosionEffect(
        explosion.x, explosion.y, explosion.effect.radius,
        explosion.effect.color, explosion.effect.visualStyle,
      );
    }

    for (const g of explodedGrenades) {
      if (g.effect.type === 'damage') {
        this.ctx.combatSystem.applyAoeDamage(g.x, g.y, g.effect.radius, g.effect.damage, g.ownerId, false, {
          category: 'explosion',
          allowTeamDamage: g.effect.allowTeamDamage,
          weaponName: 'Granate',
          sourceSlot: 'utility',
        });
        this.applyAoeEnvironmentDamage(
          g.x, g.y, g.effect.radius, g.effect.damage,
          g.effect.rockDamageMult ?? 1, g.effect.trainDamageMult ?? 1, g.ownerId,
        );
        bridge.broadcastExplosionEffect(g.x, g.y, g.effect.radius, undefined, g.effect.visualStyle);
      } else if (g.effect.type === 'fire') {
        this.ctx.fireSystem.hostCreateZone(g.x, g.y, g.effect, g.ownerId);
      } else {
        this.ctx.smokeSystem.hostCreateCloud(g.x, g.y, g.effect);
      }
    }

    const smokes = countdownActive ? [] : this.ctx.smokeSystem.hostUpdate(Date.now());
    const { synced: fires, damageEvents: fireDamageEvents } = countdownActive
      ? { synced: [], damageEvents: [] }
      : this.ctx.fireSystem.hostUpdate(Date.now());

    const { synced: stinkClouds, damageEvents: stinkDmg } = countdownActive
      ? { synced: [], damageEvents: [] }
      : this.ctx.stinkCloudSystem.hostUpdate(Date.now(), (id) => {
          const player = this.ctx.playerManager.getPlayer(id);
          if (!player) return null;
          const profile = bridge.getConnectedPlayers().find(p => p.id === id);
          return {
            x:        player.sprite.x,
            y:        player.sprite.y,
            alive:    this.ctx.combatSystem.isAlive(id),
            burrowed: this.ctx.burrowSystem?.isBurrowed(id) ?? false,
            color:    profile?.colorHex ?? 0xffffff,
          };
        });

    if (!countdownActive) {
      const turretCfg    = UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig;
      const turretWeapon = WEAPON_CONFIGS[turretCfg.weaponId as keyof typeof WEAPON_CONFIGS];
      this.ctx.turretSystem?.hostUpdate(Date.now(), turretCfg, turretWeapon);
    }

    const teslaDomes = countdownActive ? [] : (this.ctx.teslaDomeSystem?.hostUpdate(Date.now()) ?? []);
    const energyShields = countdownActive ? [] : (this.ctx.energyShieldSystem?.hostUpdate(Date.now()) ?? []);
    this.renderers.teslaDome.syncVisuals(teslaDomes);
    this.renderers.energyShield.syncVisuals(energyShields);

    for (const ev of fireDamageEvents) {
      this.ctx.combatSystem.applyAoeDamage(ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, true, {
        category: 'damage_over_time',
        weaponName: 'Feuer',
        sourceSlot: 'utility',
      });
      this.applyAoeEnvironmentDamage(
        ev.x, ev.y, ev.radius, ev.damage,
        ev.rockDamageMult, ev.trainDamageMult, ev.ownerId,
      );
    }

    for (const ev of stinkDmg) {
      this.ctx.combatSystem.applyAoeDamage(ev.x, ev.y, ev.radius, ev.damage, ev.ownerId, false, {
        category: 'damage_over_time',
        weaponName: 'Gas',
        sourceSlot: 'utility',
      });
      this.applyAoeEnvironmentDamage(
        ev.x, ev.y, ev.radius, ev.damage,
        ev.rockDamageMult, ev.trainDamageMult, ev.ownerId,
      );
    }

    const meteorImpacts = countdownActive ? [] : (this.ctx.armageddonSystem?.update(Date.now(), delta) ?? []);
    for (const mi of meteorImpacts) {
      this.ctx.combatSystem.applyAoeDamage(
        mi.x, mi.y, mi.radius, mi.damage, mi.ownerId,
        mi.selfDamageMult > 0,
        { category: 'explosion', weaponName: 'Meteor', sourceSlot: 'ultimate' },
      );
      this.applyAoeEnvironmentDamage(
        mi.x, mi.y, mi.radius, mi.damage,
        mi.rockDamageMult, mi.trainDamageMult, mi.ownerId,
      );
      bridge.broadcastExplosionEffect(mi.x, mi.y, mi.radius, 0xff6622);
    }

    if (!countdownActive && this.ctx.trainManager) {
      if (!this.trainSpawned) {
        const trainEvent = bridge.getTrainEvent();
        if (trainEvent && Date.now() >= trainEvent.spawnAt) {
          this.ctx.trainManager.spawn();
          this.trainSpawned = true;
          this.ctx.combatSystem.setTrainSegments(this.ctx.trainManager.getSegObjects());
        }
      }
      if (this.trainSpawned) {
        this.ctx.trainManager.update(delta);
      }
    }

    const rocks = this.ctx.rockRegistry?.getNetSnapshot() ?? [];

    // Host-local visuals each frame
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const hp    = this.ctx.combatSystem.getHP(player.id);
      const armor = this.ctx.combatSystem.getArmor(player.id);
      const alive = this.ctx.combatSystem.isAlive(player.id);
      player.updateHP(hp);
      player.updateArmor(armor);
      player.updateBurnStacks(this.ctx.combatSystem.getBurnStackCount(player.id));
      player.setVisible(alive);
      player.setRageTint(this.ctx.loadoutManager?.isUltimateActive(player.id) ?? false);
      const isStealthed = this.ctx.decoySystem.isStealthed(player.id);
      const wasStealthed = this.prevStealthStates.get(player.id) ?? false;
      if (isStealthed !== wasStealthed) {
        this.ctx.effectSystem.playStealthTransitionEffect(player.sprite.x, player.sprite.y, !isStealthed, player.color);
      }
      player.setDecoyStealth(isStealthed);
      this.prevStealthStates.set(player.id, isStealthed);
      player.syncBar();
      const dashPhase = this.ctx.hostPhysics.getDashPhase(player.id);
      if (dashPhase === 0) this.dashTrailTimers.delete(player.id);
      this.applyDashVisual(player, player.id, dashPhase, false);
    }

    const powerups  = this.ctx.powerUpSystem?.getNetSnapshot()       ?? [];
    const pedestals = this.ctx.powerUpSystem?.getPedestalSnapshot()  ?? [];
    const nukes     = this.ctx.powerUpSystem?.getNukeSnapshot()      ?? [];
    const meteors   = this.ctx.armageddonSystem?.getSnapshot()       ?? [];
    const train     = this.ctx.trainManager?.getNetSnapshot()        ?? null;
    const captureTheBeer = this.ctx.captureTheBeerSystem?.hostUpdate(!countdownActive) ?? null;
    const syncedNow = bridge.getSynchronizedNow();

    this.renderers.train?.update(train);
    this.renderers.beer.sync(captureTheBeer?.beers ?? []);
    this.renderers.powerUp.syncPedestals(pedestals);
    this.renderers.powerUp.sync(powerups);
    this.renderers.powerUp.updatePedestals(syncedNow);
    this.renderers.nuke.sync(nukes);
    this.renderers.meteor.sync(meteors);
    this.checkLocalPickup(powerups);

    const localId = bridge.getLocalPlayerId();
    for (const p of this.ctx.playerManager.getAllPlayers()) {
      if (p.id === localId) continue;
      const remoteInput = bridge.getPlayerInput(p.id);
      if (remoteInput) p.setRotation(dequantizeAngle(remoteInput.aim));
    }

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const burrowPhase = this.ctx.burrowSystem?.getPhase(player.id) ?? 'idle';
      this.applyBurrowVisual(player, burrowPhase);
    }

    // Local host HUD
    const localPlayer = this.ctx.playerManager.getPlayer(localId);
    if (localPlayer) {
      const isMovingLocal = isVelocityMoving(localPlayer.body.velocity.x, localPlayer.body.velocity.y);
      const aimLocal      = this.ctx.loadoutManager?.getAimNetState(localId, isMovingLocal)
                          ?? this.getDefaultAimState(isMovingLocal);
      this.ctx.aimSystem?.setAuthoritativeState(aimLocal);
      this.ctx.inputSystem.setLocalState(
        this.ctx.burrowSystem?.isStunned(localId) ?? false,
        this.ctx.burrowSystem?.isBurrowed(localId) ?? false,
        this.ctx.burrowSystem?.getPhase(localId) ?? 'idle',
      );
      localPlayer.setRotation(this.ctx.inputSystem.getAimAngle());
      const now = Date.now();
      const utilCfg   = this.ctx.loadoutManager?.getEquippedUtilityConfig(localId);
      const ultCfg    = this.ctx.loadoutManager?.getEquippedUltimateConfig(localId) ?? this.getFallbackUltimateConfig();
      const weapon2Cfg = this.ctx.loadoutManager?.getEquippedWeaponConfig(localId, 'weapon2');
      const activePowerUps = this.ctx.powerUpSystem?.getActiveBuffsForHUD(localId) ?? [];
      const stealthBuff = this.ctx.decoySystem.getStealthBuff(localId, now);
      const shieldBuff = this.ctx.loadoutManager?.getShieldBuffHudState(localId, now);
      const ultimateThresholds = this.ctx.loadoutManager?.getUltimateThresholds(localId) ?? [ultCfg?.rageRequired ?? 300];
      const hudData = buildLocalArenaHudData({
        hp:                      this.ctx.combatSystem.getHP(localId),
        armor:                   this.ctx.combatSystem.getArmor(localId),
        adrenaline:              this.ctx.resourceSystem?.getAdrenaline(localId) ?? 0,
        rage:                    this.ctx.resourceSystem?.getRage(localId) ?? 0,
        isUltimateActive:        this.ctx.loadoutManager?.isUltimateActive(localId) ?? false,
        ultimateRequiredRage:    ultCfg?.rageRequired ?? 300,
        ultimateThresholds,
        weapon1CooldownFrac:     this.ctx.loadoutManager?.getCooldownFrac(localId, 'weapon1', now) ?? 0,
        weapon2CooldownFrac:     this.ctx.loadoutManager?.getCooldownFrac(localId, 'weapon2', now) ?? 0,
        utilityCooldownFrac:     this.getLocalUtilityCooldownFrac(),
        utilityDisplayName:      utilCfg?.displayName,
        adrenalineSyringeActive: (this.ctx.powerUpSystem?.getRegenMultiplier(localId) ?? 1) > 1,
        isUtilityOverridden:     bridge.getPlayerUtilityOverrideName(localId) !== '',
        activePowerUps:          stealthBuff ? [...activePowerUps, stealthBuff] : activePowerUps,
        shieldBuff,
        weapon2AdrenalineCost:   weapon2Cfg?.adrenalinCost ?? 0,
      });
      this.ctx.leftPanel.updateArenaHUD(hudData);
      this.ctx.playerStatusRing?.update(hudData);
      this.localPlayerState.alive    = this.ctx.combatSystem.isAlive(localId);
      this.localPlayerState.burrowed = this.ctx.burrowSystem?.isBurrowed(localId) ?? false;
    }

    this.ctx.stinkCloudSystem.clientUpdate(delta);

    // ── Network tick throttle ─────────────────────────────────────────────
    this.netTickAccumulator += delta;
    if (this.netTickAccumulator < NET_TICK_INTERVAL_MS) return;
    this.netTickAccumulator -= NET_TICK_INTERVAL_MS;
    if (this.netTickAccumulator > NET_TICK_INTERVAL_MS) this.netTickAccumulator = 0;

    for (const expiredRock of this.ctx.placementSystem?.update(now) ?? []) {
      if (expiredRock.kind === 'turret') {
        this.rockVisualHelper.spawnTurretDeathCloud(expiredRock);
      }
      this.rockVisualHelper.removePlaceableRockVisual(expiredRock, true);
    }

    const players: Record<string, PlayerNetState> = {};
    for (const player of this.ctx.playerManager.getAllPlayers()) {
      const hp         = this.ctx.combatSystem.getHP(player.id);
      const armor      = this.ctx.combatSystem.getArmor(player.id);
      const alive      = this.ctx.combatSystem.isAlive(player.id);
      const adrenaline = this.ctx.resourceSystem?.getAdrenaline(player.id) ?? 0;
      const rage       = this.ctx.resourceSystem?.getRage(player.id) ?? 0;
      const isBurrowed = this.ctx.burrowSystem?.isBurrowed(player.id) ?? false;
      const isStunned  = this.ctx.burrowSystem?.isStunned(player.id)  ?? false;
      const burrowPhase = this.ctx.burrowSystem?.getPhase(player.id) ?? 'idle';
      const isRaging   = this.ctx.loadoutManager?.isUltimateActive(player.id) ?? false;
      const burnStacks = this.ctx.combatSystem.getBurnStackCount(player.id);
      const isChargingUltimate = this.ctx.loadoutManager?.isUltimateCharging(player.id) ?? false;
      const ultimateChargeFraction = this.ctx.loadoutManager?.getUltimateChargeFraction(player.id, now) ?? 0;
      const ultimateChargeRange    = this.ctx.loadoutManager?.getUltimateChargeRange(player.id) ?? 0;
      const isDecoyStealthed = this.ctx.decoySystem.isStealthed(player.id);
      const decoyStealthRemainingFrac = this.ctx.decoySystem.getStealthRemainingFrac(player.id, now);
      const isMoving = isVelocityMoving(player.body.velocity.x, player.body.velocity.y);
      const aim      = this.ctx.loadoutManager?.getAimNetState(player.id, isMoving)
                     ?? this.getDefaultAimState(isMoving);

      bridge.publishAdrSyringeActive(player.id, (this.ctx.powerUpSystem?.getRegenMultiplier(player.id) ?? 1) > 1);
      const activeBuffs = this.ctx.powerUpSystem?.getActiveBuffsForHUD(player.id) ?? [];
      const stealthBuff = this.ctx.decoySystem.getStealthBuff(player.id, now);
      bridge.publishActiveBuffs(player.id, stealthBuff ? [...activeBuffs, stealthBuff] : activeBuffs);
      bridge.publishShieldBuffHud(player.id, this.ctx.loadoutManager?.getShieldBuffHudState(player.id, now) ?? {
        visible: false,
        defId: 'SHIELD_OVERCHARGE',
        value: 0,
        maxValue: 1,
        damageBonusPct: 0,
      });

      const playerInput = bridge.getPlayerInput(player.id);
      players[player.id] = {
        x: Math.round(player.sprite.x),
        y: Math.round(player.sprite.y),
        rot: playerInput?.aim ?? 0,
        hp,
        armor,
        alive,
        adrenaline: Math.round(adrenaline),
        rage: Math.round(rage),
        isBurrowed,
        isStunned,
        burrowPhase,
        isRaging,
        burnStacks,
        isChargingUltimate,
        ultimateChargeFraction,
        ultimateChargeRange,
        isDecoyStealthed,
        decoyStealthRemainingFrac,
        dashPhase: this.ctx.hostPhysics.getDashPhase(player.id),
        aim: {
          revision:             aim.revision,
          isMoving:             aim.isMoving,
          weapon1DynamicSpread: Math.round(aim.weapon1DynamicSpread * 10) / 10,
          weapon2DynamicSpread: Math.round(aim.weapon2DynamicSpread * 10) / 10,
        },
      };
    }

    bridge.publishGameState({
      players,
      projectiles,
      rocks,
      placeableRocks: this.ctx.placementSystem?.getNetSnapshot() ?? [],
      decoys,
      smokes,
      fires,
      stinkClouds,
      teslaDomes,
      energyShields,
      powerups,
      pedestals,
      nukes,
      meteors,
      train,
      captureTheBeer,
    });

    if (projectiles.some(p => p.style === 'bfg')) {
      this.scene.cameras.main.shake(100, 0.003);
    }
  }

  getLeaderboardEntries(): { name: string; colorHex: number; frags: number; ping: number; teamId: TeamId | null; teamScore?: number }[] {
    const playerIds = bridge.getConnectedPlayerIds();
    const signatureParts: string[] = [];
    const blueTeamScore = this.resolveTeamObjectiveScore('blue');
    const redTeamScore = this.resolveTeamObjectiveScore('red');
    if (blueTeamScore !== null || redTeamScore !== null) {
      signatureParts.push(`ctb:${blueTeamScore ?? 0}:${redTeamScore ?? 0}`);
    }
    for (const playerId of playerIds) {
      signatureParts.push(`${playerId}:${bridge.getPlayerName(playerId)}:${bridge.getPlayerColor(playerId) ?? 0xffffff}:${bridge.getPlayerFrags(playerId)}:${bridge.getPlayerPing(playerId)}:${isTeamGameMode(bridge.getGameMode()) ? bridge.getPlayerTeam(playerId) ?? 'none' : 'none'}`);
    }
    const nextSignature = signatureParts.join('|');
    if (nextSignature === this.leaderboardSignature) return this.cachedLeaderboardEntries;
    this.leaderboardSignature = nextSignature;
    this.cachedLeaderboardEntries = playerIds
      .map(playerId => ({
        name:     bridge.getPlayerName(playerId),
        colorHex: bridge.getPlayerColor(playerId) ?? 0xffffff,
        frags:    bridge.getPlayerFrags(playerId),
        ping:     bridge.getPlayerPing(playerId),
        teamId:   isTeamGameMode(bridge.getGameMode()) ? bridge.getPlayerTeam(playerId) : null,
        teamScore: this.resolveEntryTeamScore(playerId, blueTeamScore, redTeamScore),
      }))
      .sort((a, b) => b.frags - a.frags);
    return this.cachedLeaderboardEntries;
  }

  private resolveTeamObjectiveScore(teamId: TeamId): number | null {
    if (bridge.getGameMode() !== CAPTURE_THE_BEER_MODE) return null;
    if (bridge.isHost()) {
      return this.ctx.captureTheBeerSystem?.getTeamScore(teamId) ?? 0;
    }
    return bridge.getLatestGameState()?.captureTheBeer?.scores[teamId] ?? 0;
  }

  private resolveEntryTeamScore(
    playerId: string,
    blueTeamScore: number | null,
    redTeamScore: number | null,
  ): number | undefined {
    if (bridge.getGameMode() !== CAPTURE_THE_BEER_MODE) return undefined;
    const teamId = bridge.getPlayerTeam(playerId);
    if (teamId === 'blue') return blueTeamScore ?? 0;
    if (teamId === 'red') return redTeamScore ?? 0;
    return undefined;
  }

  // ── AoE helpers ──────────────────────────────────────────────────────────

  applyAoeEnvironmentDamage(
    x: number, y: number, radius: number, damage: number,
    rockMult: number, trainMult: number, attackerId: string,
  ): void {
    const arenaResult = this.ctx.arenaResult;

    if (rockMult !== 0 && arenaResult) {
      const rockObjects = arenaResult.rockObjects;
      for (let i = 0; i < rockObjects.length; i++) {
        const rock = rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(x, y, rock.x, rock.y);
        if (dist > radius) continue;
        const newHp = this.rockVisualHelper.applyObstacleDamageById(i, damage * rockMult, attackerId);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(i, 'damage');
      }
    }

    if (trainMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        for (const seg of this.ctx.trainManager.getSegObjects()) {
          if (!seg.active) continue;
          const b  = seg.getBounds();
          const dx = Math.max(b.left - x, 0, x - b.right);
          const dy = Math.max(b.top  - y, 0, y - b.bottom);
          if (Math.sqrt(dx * dx + dy * dy) <= radius) {
            this.ctx.trainManager.applyDamage(damage * trainMult, attackerId);
            break;
          }
        }
      }
    }
  }

  applyExplosionEnvironmentDamage(
    x: number, y: number,
    effect: import('../../types').ProjectileExplosionConfig,
    attackerId: string,
  ): void {
    const arenaResult = this.ctx.arenaResult;
    const rockMult  = effect.rockDamageMult  ?? 1;
    const trainMult = effect.trainDamageMult ?? 1;

    if (rockMult !== 0 && arenaResult) {
      const rockObjects = arenaResult.rockObjects;
      for (let i = 0; i < rockObjects.length; i++) {
        const rock = rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(x, y, rock.x, rock.y);
        if (dist > effect.radius) continue;
        const t = Phaser.Math.Clamp(dist / effect.radius, 0, 1);
        const damage = Math.round(Phaser.Math.Linear(effect.maxDamage, effect.minDamage, t) * rockMult);
        if (damage <= 0) continue;
        const newHp = this.rockVisualHelper.applyObstacleDamageById(i, damage, attackerId);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(i, 'damage');
      }
    }

    if (trainMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        let minDist = Infinity;
        for (const seg of this.ctx.trainManager.getSegObjects()) {
          if (!seg.active) continue;
          const b  = seg.getBounds();
          const dx = Math.max(b.left - x, 0, x - b.right);
          const dy = Math.max(b.top  - y, 0, y - b.bottom);
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) minDist = d;
        }
        if (minDist <= effect.radius) {
          const t = Phaser.Math.Clamp(minDist / effect.radius, 0, 1);
          const damage = Math.round(Phaser.Math.Linear(effect.maxDamage, effect.minDamage, t) * trainMult);
          if (damage > 0) this.ctx.trainManager.applyDamage(damage, attackerId);
        }
      }
    }
  }

  applyNukeEnvironmentDamage(x: number, y: number, radius: number, triggeredBy: string): void {
    const arenaResult = this.ctx.arenaResult;
    const rockMult:  number = NUKE_CONFIG.rockDamageMult;
    const trainMult: number = NUKE_CONFIG.trainDamageMult;

    if (rockMult !== 0 && arenaResult) {
      for (let i = 0; i < arenaResult.rockObjects.length; i++) {
        const rock = arenaResult.rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(x, y, rock.x, rock.y);
        if (dist > radius) continue;
        const t = Phaser.Math.Clamp(dist / radius, 0, 1);
        const baseDmg = Phaser.Math.Linear(NUKE_CONFIG.maxDamage, NUKE_CONFIG.minDamage, t);
        const newHp = this.rockVisualHelper.applyObstacleDamageById(i, Math.round(baseDmg * rockMult), triggeredBy);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(i, 'damage');
      }
    }

    if (trainMult !== 0 && this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        let minDist = Infinity;
        for (const seg of this.ctx.trainManager.getSegmentPositions()) {
          const d = Phaser.Math.Distance.Between(x, y, seg.x, seg.y);
          if (d < minDist) minDist = d;
        }
        if (minDist <= radius) {
          const t = Phaser.Math.Clamp(minDist / radius, 0, 1);
          const baseDmg = Phaser.Math.Linear(NUKE_CONFIG.maxDamage, NUKE_CONFIG.minDamage, t);
          this.ctx.trainManager.applyDamage(Math.round(baseDmg * trainMult), triggeredBy);
        }
      }
    }
  }

  resolveBfgLasers(proj: TrackedProjectile): void {
    const radius = proj.bfgLaserRadius ?? 256;
    const damage = proj.bfgLaserDamage ?? 10;
    const px = proj.sprite.x;
    const py = proj.sprite.y;
    const laserLines: { sx: number; sy: number; ex: number; ey: number }[] = [];

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      if (player.id === proj.ownerId) continue;
      if (!this.ctx.combatSystem.isAlive(player.id)) continue;
      if (this.ctx.burrowSystem?.isBurrowed(player.id)) continue;
      const dist = Phaser.Math.Distance.Between(px, py, player.sprite.x, player.sprite.y);
      if (dist > radius) continue;
      if (!this.ctx.combatSystem.hasLineOfSight(px, py, player.sprite.x, player.sprite.y)) continue;
      if (!this.ctx.combatSystem.canDamageTarget(proj.ownerId, player.id, proj.allowTeamDamage)) continue;
      if (this.ctx.energyShieldSystem?.tryBlockDamage({
        targetId: player.id,
        category: 'hitscan',
        damage,
        sourceX: px,
        sourceY: py,
        now: Date.now(),
      })) {
        continue;
      }
      this.ctx.combatSystem.applyDamage(player.id, damage, false, proj.ownerId, 'BFG', {
        sourceX: px,
        sourceY: py,
      }, {
        allowTeamDamage: proj.allowTeamDamage,
      });
      laserLines.push({ sx: px, sy: py, ex: player.sprite.x, ey: player.sprite.y });
    }

    const arenaResult = this.ctx.arenaResult;
    if (arenaResult) {
      for (let i = 0; i < arenaResult.rockObjects.length; i++) {
        const rock = arenaResult.rockObjects[i];
        if (!rock?.active) continue;
        const dist = Phaser.Math.Distance.Between(px, py, rock.x, rock.y);
        if (dist > radius) continue;
        if (!this.ctx.combatSystem.hasLineOfSight(px, py, rock.x, rock.y, i)) continue;
        const newHp = this.rockVisualHelper.applyObstacleDamageById(i, damage, proj.ownerId);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(i, 'damage');
        laserLines.push({ sx: px, sy: py, ex: rock.x, ey: rock.y });
      }
    }

    if (this.ctx.trainManager) {
      const trainState = this.ctx.trainManager.getNetSnapshot();
      if (trainState?.alive) {
        const segments = this.ctx.trainManager.getSegmentPositions();
        for (const seg of segments) {
          const dist = Phaser.Math.Distance.Between(px, py, seg.x, seg.y);
          if (dist > radius) continue;
          if (!this.ctx.combatSystem.hasLineOfSight(px, py, seg.x, seg.y)) continue;
          this.ctx.trainManager.applyDamage(damage, proj.ownerId);
          laserLines.push({ sx: px, sy: py, ex: seg.x, ey: seg.y });
          break;
        }
      }
    }

    bridge.broadcastBfgLaserBatch(laserLines, COLORS.GREEN_2);
  }

  applyTeslaRockDamage(index: number, damage: number, ownerId: string): void {
    if (!this.ctx.arenaResult || !this.ctx.currentLayout) return;
    const newHp = this.rockVisualHelper.applyObstacleDamageById(index, damage, ownerId);
    if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(index, 'damage');
  }

  applyTeslaTurretDamage(id: number, damage: number, ownerId: string): void {
    const newHp = this.rockVisualHelper.applyObstacleDamageById(id, damage, ownerId);
    if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(id, 'damage');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private applyDashVisual(player: PlayerEntity, id: string, curPhase: number, setScale = true): void {
    if (curPhase === 1) {
      if (setScale) player.setDashScale(0.5);
      const now = this.scene.time.now;
      const nextGhost = this.dashTrailTimers.get(id) ?? 0;
      if (now >= nextGhost) {
        this.ctx.effectSystem.playDashTrailGhost(player.sprite.x, player.sprite.y, player.color, 0.5, player.sprite.rotation);
        this.dashTrailTimers.set(id, now + 50);
      }
    } else if (curPhase === 2) {
      if (setScale) {
        const p2Start = this.dashPhase2StartTimes.get(id);
        const t = p2Start !== undefined
          ? Math.min(1, (this.scene.time.now - p2Start) / (DASH_T2_S * 1000))
          : 1;
        player.setDashScale(0.5 + 0.5 * t * t);
      }
    } else if (setScale) {
      player.setDashScale(1.0);
    }
  }

  private applyBurrowVisual(player: PlayerEntity, phase: import('../../types').BurrowPhase): void {
    const previousPhase = this.prevBurrowPhases.get(player.id) ?? 'idle';
    const shouldAnimate = previousPhase !== phase
      && ((phase === 'windup' && previousPhase === 'idle')
        || (phase === 'recovery' && (previousPhase === 'underground' || previousPhase === 'trapped')));

    if (shouldAnimate) {
      this.ctx.effectSystem.playBurrowPhaseEffect(player.sprite.x, player.sprite.y, phase);
    }
    player.setBurrowPhase(phase, shouldAnimate);
    this.ctx.effectSystem.syncBurrowState(player.id, phase, player.sprite);
    this.prevBurrowPhases.set(player.id, phase);
  }

  private checkLocalPickup(powerups: import('../../types').SyncedPowerUp[]): void {
    const localId = bridge.getLocalPlayerId();
    const player  = this.ctx.playerManager.getPlayer(localId);
    if (!player || !player.sprite.active) return;
    if (this.ctx.burrowSystem?.isBurrowed(localId)) return;

    const px = player.sprite.x;
    const py = player.sprite.y;

    for (const pu of powerups) {
      const dist = Phaser.Math.Distance.Between(px, py, pu.x, pu.y);
      if (dist <= PICKUP_RADIUS * 2) {
        this.ctx.powerUpSystem?.tryPickup(localId, pu.uid, px, py);
        return;
      }
    }
  }

  private getLocalUtilityCooldownFrac(): number {
    const localId = bridge.getLocalPlayerId();
    const cooldownUntil = bridge.getPlayerUtilityCooldownUntil(localId);
    const remaining = cooldownUntil - bridge.getSynchronizedNow();
    if (remaining <= 0) return 0;
    const config = this.ctx.loadoutManager?.getEquippedUtilityConfig(localId);
    if (!config || config.cooldown <= 0) return 0;
    return Math.min(1, remaining / config.cooldown);
  }

  private getFallbackUltimateConfig() {
    return { rageRequired: 300 };
  }

  private getDefaultAimState(isMoving: boolean): PlayerAimNetState {
    return { revision: 0, isMoving, weapon1DynamicSpread: 0, weapon2DynamicSpread: 0 };
  }
}
