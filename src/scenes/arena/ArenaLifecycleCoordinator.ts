import { bridge }            from '../../network/bridge';
import { ArenaBuilder }      from '../../arena/ArenaBuilder';
import { ArenaGenerator }    from '../../arena/ArenaGenerator';
import { RockRegistry }      from '../../arena/RockRegistry';
import { PlacementSystem }   from '../../systems/PlacementSystem';
import { ResourceSystem }    from '../../systems/ResourceSystem';
import { TeslaDomeSystem }   from '../../systems/TeslaDomeSystem';
import { EnergyShieldSystem } from '../../systems/EnergyShieldSystem';
import { ShieldBuffSystem }   from '../../systems/ShieldBuffSystem';
import { TurretSystem }      from '../../systems/TurretSystem';
import { BurrowSystem }      from '../../systems/BurrowSystem';
import { LoadoutManager }    from '../../loadout/LoadoutManager';
import { TranslocatorSystem } from '../../systems/TranslocatorSystem';
import { PowerUpSystem }     from '../../powerups/PowerUpSystem';
import { DetonationSystem }  from '../../systems/DetonationSystem';
import { ArmageddonSystem }  from '../../systems/ArmageddonSystem';
import { TrainManager }      from '../../train/TrainManager';
import { TrainRenderer }     from '../../train/TrainRenderer';
import { TranslocatorTeleportRenderer } from '../../effects/TranslocatorTeleportRenderer';
import { UTILITY_CONFIGS, WEAPON_CONFIGS, ULTIMATE_CONFIGS, DEFAULT_LOADOUT } from '../../loadout/LoadoutConfig';
import type { PlaceableUtilityConfig, PlaceableTurretUtilityConfig } from '../../loadout/LoadoutConfig';
import type { LoadoutSelection } from '../../loadout/LoadoutManager';
import { buildInitialLocalArenaHudData } from '../../ui/LocalArenaHudData';
import { ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC, PLAYER_COLORS, ARENA_OFFSET_X, CELL_SIZE, ARENA_HEIGHT, ARENA_OFFSET_Y } from '../../config';
import { PLAYER_SPEED } from '../../config';
import { TRAIN }             from '../../train/TrainConfig';
import { TRAIN_DROP_COUNT }  from '../../powerups/PowerUpConfig';
import type { ArenaContext }          from './ArenaContext';
import type { RendererBundle }        from './RendererBundle';
import type { RockVisualHelper }      from './RockVisualHelper';
import type { PlacementPreviewRenderer } from './PlacementPreviewRenderer';
import type { HostUpdateCoordinator } from './HostUpdateCoordinator';
import type { ClientUpdateCoordinator } from './ClientUpdateCoordinator';
import type { LobbyOverlay }          from '../LobbyOverlay';
import type { ArenaLayout, LoadoutCommitSnapshot, RoomQualitySnapshot } from '../../types';
import type { RoundResult }           from '../../network/NetworkBridge';
import type { RoomQualityMonitor }    from '../../network/RoomQualityMonitor';

/**
 * Manages the arena round lifecycle.
 *
 * Responsibilities: buildArena / tearDownArena, LOBBY ↔ ARENA phase transitions,
 * host quality checks, round result saving, train event setup.
 * Mutates ArenaContext round-scoped fields (arenaResult, currentLayout, etc.).
 */
export class ArenaLifecycleCoordinator {
  private matchTerminated   = false;
  private roundStartPending = false;
  private isLocalReady      = false;
  private lastPhase: import('../../types').GamePhase = 'LOBBY';
  private trainDestroyedShown = false;

  private layoutRetryCount = 0;
  private arenaEnteredAt   = 0;
  private arenaBuilt       = false;
  private static readonly LAYOUT_RETRY_LIMIT = 312; // ~5s at 16ms per retry

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly ctx: ArenaContext,
    private readonly renderers: RendererBundle,
    private readonly rockVisualHelper: RockVisualHelper,
    private readonly placementPreview: PlacementPreviewRenderer,
    private readonly lobbyOverlay: LobbyOverlay,
    private readonly hostUpdate: HostUpdateCoordinator,
    private readonly clientUpdate: ClientUpdateCoordinator,
    private readonly roomQualityMonitor: RoomQualityMonitor,
  ) {}

  // ── Public state accessors ────────────────────────────────────────────────

  isMatchTerminated(): boolean { return this.matchTerminated; }
  getIsLocalReady(): boolean   { return this.isLocalReady; }
  isTrainDestroyedShown(): boolean { return this.trainDestroyedShown; }

  setIsLocalReady(v: boolean): void {
    this.isLocalReady = v;
    this.lobbyOverlay.setReadyButtonState(v);
    this.ctx.leftPanel.setLobbyFieldsLocked(v);
  }

  onTrainDestroyed(): void {
    this.trainDestroyedShown = true;
  }

  initialize(): void {
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.lastPhase = bridge.getGamePhase();

    // If the scene was created after the host already transitioned to ARENA,
    // detectPhaseChange() will never see LOBBY→ARENA. Schedule the transition
    // on the next frame so all create()-time setup (RPC, callbacks) completes first.
    if (this.lastPhase === 'ARENA') {
      this.scene.time.delayedCall(0, () => {
        if (bridge.getGamePhase() === 'ARENA' && !this.arenaBuilt && !this.matchTerminated) {
          this.onTransitionToArena();
        }
      });
    }
  }

  // ── Phase detection ───────────────────────────────────────────────────────

  detectPhaseChange(): void {
    const current = bridge.getGamePhase();

    if (this.matchTerminated) {
      if (current !== this.lastPhase) this.lastPhase = current;
      if (current === 'LOBBY') this.matchTerminated = false;
      return;
    }

    if (current === this.lastPhase) {
      // Safety net: if we've been in ARENA for >5s without having built the
      // arena, something went wrong during the transition — recover gracefully.
      if (current === 'ARENA' && !this.arenaBuilt) {
        const now = Date.now();
        if (this.arenaEnteredAt === 0) {
          this.arenaEnteredAt = now;
        } else if (now - this.arenaEnteredAt > 5_000) {
          this.arenaEnteredAt = 0;
          this.terminateMatch();
        }
      }
      return;
    }

    const prev     = this.lastPhase;
    this.lastPhase = current;
    if (prev === 'LOBBY' && current === 'ARENA') {
      this.arenaEnteredAt = Date.now();
      this.onTransitionToArena();
    }
    if (prev === 'ARENA' && current === 'LOBBY') this.onTransitionToLobby();
  }

  // ── Host helpers called from ArenaScene.update() ─────────────────────────

  hostCheckReadyToStart(): void {
    if (this.roundStartPending || !bridge.areAllPlayersReady()) return;
    if (this.roomQualityMonitor.shouldBlockStart()) return;
    this.roundStartPending = true;
    this.lobbyOverlay.lockButton();
    bridge.setMatchHostId();
    bridge.resetAllFrags();
    const arenaStartTime = Date.now() + ARENA_COUNTDOWN_SEC * 1000;
    const layout = ArenaGenerator.generate(Date.now());
    bridge.publishArenaLayout(layout);
    bridge.setArenaStartTime(arenaStartTime);
    bridge.setRoundEndTime(arenaStartTime + ARENA_DURATION_SEC * 1000);
    bridge.setGamePhase('ARENA');
  }

  spawnReadyPlayers(): void {
    if (!bridge.isHost()) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.ctx.playerManager.hasPlayer(profile.id)) {
        this.ctx.playerManager.addPlayer(profile);
        this.ctx.combatSystem.initPlayer(profile.id);
        this.ctx.resourceSystem?.initPlayer(profile.id);
        this.ctx.burrowSystem?.initPlayer(profile.id);
        this.ctx.loadoutManager?.resetUltimateState(profile.id);
        this.ctx.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
      }
    }
  }

  syncHostLoadoutsFromCommittedSelections(): void {
    if (!bridge.isHost() || !this.ctx.loadoutManager) return;
    for (const profile of bridge.getConnectedPlayers()) {
      if (!this.ctx.playerManager.hasPlayer(profile.id)) continue;
      this.ctx.loadoutManager.syncSelectedLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
    }
  }

  hostSaveRoundResults(): void {
    if (!bridge.isHost()) return;
    const results: RoundResult[] = bridge.getConnectedPlayers().map(p => ({
      id:       p.id,
      name:     p.name,
      colorHex: p.colorHex,
      frags:    bridge.getPlayerFrags(p.id),
    }));
    bridge.publishRoundResults(results);
  }

  terminateMatch(): void {
    if (this.matchTerminated) return;
    this.matchTerminated = true;
    this.arenaBuilt = false;
    this.arenaEnteredAt = 0;

    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;
    this.ctx.arenaCountdown?.clear();

    for (const p of [...this.ctx.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) {
        this.ctx.combatSystem.removePlayer(p.id);
        this.ctx.resourceSystem?.removePlayer(p.id);
        this.ctx.burrowSystem?.removePlayer(p.id);
        this.ctx.loadoutManager?.removePlayer(p.id);
      }
      this.ctx.playerManager.removePlayer(p.id);
    }

    this.tearDownArena();
    this.ctx.leftPanel.transitionToLobby();
    this.ctx.leftPanel.setLobbyFieldsLocked(false);
    this.ctx.rightPanel.transitionToLobby();
    this.hostUpdate.setActive(false);

    if (bridge.isHost()) {
      bridge.setGamePhase('LOBBY');
    }

    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
    this.lobbyOverlay.showHostDisconnectedMessage();
  }

  // ── Arena build / teardown ────────────────────────────────────────────────

  buildArena(layout: ArenaLayout): void {
    this.tearDownArena();

    this.ctx.currentLayout = layout;
    const builder = new ArenaBuilder(this.scene);
    this.ctx.arenaResult = builder.buildDynamic(layout);
    this.ctx.placementSystem = new PlacementSystem(layout, this.ctx.arenaResult.rockGrid, this.ctx.playerManager);

    this.ctx.playerManager.setLayout(layout);

    this.ctx.projectileManager.setRockGroup(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.rockObjects,
      this.ctx.arenaResult.trunkGroup,
    );
    this.ctx.decoySystem.setObstacleGroups(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.trunkGroup,
    );
    this.ctx.combatSystem.setArenaObstacles(this.ctx.arenaResult.rockObjects, this.ctx.arenaResult.trunkObjects);

    this.ctx.combatSystem.setRockDamageCallback((rockIndex, damage, attackerId) => {
      const newHp = this.rockVisualHelper.applyObstacleDamageById(rockIndex, damage, attackerId);
      if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(rockIndex, 'damage');
    });
    this.ctx.combatSystem.setTrainDamageCallback((damage, attackerId) => {
      this.ctx.trainManager?.applyDamage(damage, attackerId);
    });
    this.ctx.combatSystem.setProjectileImpactCallback((projectileId, x, y) => {
      const projectile = this.ctx.projectileManager.getProjectileById(projectileId);
      if (!projectile) return;
      this.spawnImpactCloudFromProjectile(projectile, x, y);
    });
    this.ctx.projectileManager.setProjectileImpactCallback((proj, x, y) => {
      this.spawnImpactCloudFromProjectile(proj, x, y);
    });
    this.ctx.hostPhysics.setRockGroup(
      this.ctx.arenaResult.rockGroup,
      this.ctx.arenaResult.trunkGroup,
    );

    if (bridge.isHost()) {
      this.ctx.resourceSystem = new ResourceSystem();
      this.ctx.shieldBuffSystem = new ShieldBuffSystem();
      this.ctx.teslaDomeSystem = new TeslaDomeSystem(
        this.ctx.playerManager,
        this.ctx.combatSystem,
        this.ctx.resourceSystem,
      );
      this.ctx.energyShieldSystem = new EnergyShieldSystem(
        this.ctx.playerManager,
        this.ctx.resourceSystem,
        bridge,
        this.ctx.shieldBuffSystem,
      );
      this.ctx.turretSystem = new TurretSystem(
        this.ctx.playerManager,
        this.ctx.combatSystem,
      );
      this.ctx.teslaDomeSystem.setLineOfSightChecker((sx, sy, ex, ey, skipRockIndex) => {
        return this.ctx.combatSystem.hasLineOfSight(sx, sy, ex, ey, skipRockIndex);
      });
      this.ctx.turretSystem.setLineOfSightChecker((sx, sy, ex, ey, skipRockIndex) => {
        return this.ctx.combatSystem.hasLineOfSight(sx, sy, ex, ey, skipRockIndex);
      });
      this.ctx.turretSystem.setTurretProvider(
        () => this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
        (id, angle) => this.ctx.placementSystem?.updateAngle(id, angle),
      );
      this.ctx.teslaDomeSystem.setRockCallbacks(
        () => (this.ctx.arenaResult?.rockObjects ?? [])
          .flatMap((rock, index) => (rock && rock.active)
            ? [{ index, x: rock.x, y: rock.y }]
            : []),
        (index, damage, ownerId) => this.hostUpdate.applyTeslaRockDamage(index, damage, ownerId),
      );
      this.ctx.teslaDomeSystem.setTurretCallbacks(
        () => (this.ctx.placementSystem?.getAllRuntimeRocks() ?? [])
          .filter(r => r.kind === 'turret')
          .map(r => ({
            id: r.id,
            x: ARENA_OFFSET_X + r.gridX * CELL_SIZE + CELL_SIZE / 2,
            y: ARENA_OFFSET_Y + r.gridY * CELL_SIZE + CELL_SIZE / 2,
            ownerId: r.ownerId,
          })),
        (id, damage, ownerId) => this.hostUpdate.applyTeslaTurretDamage(id, damage, ownerId),
      );
      this.ctx.teslaDomeSystem.setEnergyShieldSystem(this.ctx.energyShieldSystem);
      this.ctx.teslaDomeSystem.setTrainCallbacks(
        () => this.ctx.trainManager?.getNetSnapshot()?.alive ? this.ctx.trainManager.getSegmentPositions() : [],
        (damage, ownerId) => this.ctx.trainManager?.applyDamage(damage, ownerId),
      );
      this.ctx.burrowSystem = new BurrowSystem(
        this.ctx.resourceSystem,
        this.ctx.playerManager,
        this.ctx.combatSystem,
        this.ctx.hostPhysics,
        bridge,
      );
      this.ctx.burrowSystem.setGroups(this.ctx.arenaResult.rockGroup, this.ctx.arenaResult.trunkGroup);

      this.ctx.loadoutManager = new LoadoutManager(
        this.ctx.playerManager,
        this.ctx.projectileManager,
        this.ctx.resourceSystem,
        bridge,
      );
      this.ctx.decoySystem.setCombatStateReader(this.ctx.combatSystem);
      this.ctx.decoySystem.setRunSpeedResolver((playerId) => {
        return PLAYER_SPEED * (this.ctx.loadoutManager?.getSpeedMultiplier(playerId) ?? 1);
      });
      this.ctx.decoySystem.setCooldownStarter((playerId, utilityId, when) => {
        this.ctx.loadoutManager?.beginUtilityCooldown(playerId, utilityId, when);
      });

      this.ctx.translocatorSystem = new TranslocatorSystem(
        this.ctx.playerManager,
        this.ctx.projectileManager,
        this.ctx.combatSystem,
        null,
      );

      this.ctx.loadoutManager.setCombatSystem(this.ctx.combatSystem);
      this.ctx.loadoutManager.setDashBurstChecker(id => this.ctx.hostPhysics.isDashBurst(id));
      this.ctx.loadoutManager.setPhysicsSystem(this.ctx.hostPhysics);
      this.ctx.loadoutManager.setTeslaDomeSystem(this.ctx.teslaDomeSystem);
      this.ctx.loadoutManager.setEnergyShieldSystem(this.ctx.energyShieldSystem);
      this.ctx.loadoutManager.setShieldBuffSystem(this.ctx.shieldBuffSystem);
      this.ctx.loadoutManager.setTranslocatorSystem(this.ctx.translocatorSystem);
      this.ctx.loadoutManager.setDecoySystem(this.ctx.decoySystem);
      this.ctx.turretSystem.setFireHandler((ownerId, color, x, y, angle, targetX, targetY) => {
        const turretCfg = UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig;
        const weapon    = WEAPON_CONFIGS[turretCfg.weaponId as keyof typeof WEAPON_CONFIGS];
        this.ctx.loadoutManager?.fireAutomatedWeapon(weapon, x, y, angle, targetX, targetY, ownerId, color);
      });
      this.ctx.loadoutManager.setPlaceableRockHandler((cfg, playerId, x, y, targetX, targetY, now, playerColor) => {
        return this.placePlaceableRock(cfg, playerId, x, y, targetX, targetY, now, playerColor);
      });
      this.ctx.loadoutManager.setActionBlockedChecker((playerId, slot) => {
        if (!this.ctx.combatSystem.isAlive(playerId)) return true;
        if (slot === 'weapon1' || slot === 'weapon2') {
          if (this.ctx.burrowSystem?.isWeaponBlocked(playerId)) return true;
        }
        if (slot === 'utility' || slot === 'ultimate') {
          if (this.ctx.burrowSystem?.isUtilityBlocked(playerId)) return true;
        }
        return false;
      });
      this.ctx.loadoutManager.setNukeStrikeHandler((playerId, targetX, targetY) => {
        return this.ctx.powerUpSystem?.scheduleNukeStrike(playerId, targetX, targetY) ?? false;
      });
      this.ctx.combatSystem.setBurrowSystem(this.ctx.burrowSystem);
      this.ctx.combatSystem.setResourceSystem(this.ctx.resourceSystem);
      this.ctx.combatSystem.setLoadoutManager(this.ctx.loadoutManager);
      this.ctx.combatSystem.setEnergyShieldSystem(this.ctx.energyShieldSystem);
      this.ctx.combatSystem.setDecoySystem(this.ctx.decoySystem);

      this.ctx.powerUpSystem = new PowerUpSystem(this.ctx.playerManager, this.ctx.combatSystem, layout, {
        onNukePickup: (playerId) => {
          this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.NUKE, 1);
        },
        onNukeExploded: (x, y, radius, triggeredBy) => {
          bridge.broadcastExplosionEffect(x, y, radius, 0xffd26a, 'nuke');
          this.hostUpdate.applyNukeEnvironmentDamage(x, y, radius, triggeredBy);
        },
        onHolyHandGrenadePickup: (playerId) => {
          this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.HOLY_HAND_GRENADE, 1);
        },
        onBfgPickup: (playerId) => {
          this.ctx.loadoutManager?.overrideUtility(playerId, UTILITY_CONFIGS.BFG, 1);
        },
      });
      this.ctx.powerUpSystem.setArenaStartTime(bridge.getArenaStartTime());
      this.ctx.combatSystem.setPowerUpSystem(this.ctx.powerUpSystem);
      this.ctx.resourceSystem.setPowerUpSystem(this.ctx.powerUpSystem);

      this.ctx.detonationSystem = new DetonationSystem(this.ctx.projectileManager);
      this.ctx.combatSystem.setDetonationSystem(this.ctx.detonationSystem);

      this.ctx.armageddonSystem = new ArmageddonSystem();
      this.ctx.armageddonSystem.setRockGrid(this.ctx.arenaResult.rockGrid);
      this.ctx.loadoutManager.setArmageddonSystem(this.ctx.armageddonSystem);
      this.ctx.loadoutManager.setStinkCloudSystem(this.ctx.stinkCloudSystem);
      this.ctx.combatSystem.setStinkCloudSystem(this.ctx.stinkCloudSystem);
      this.ctx.burrowSystem.setStinkCloudSystem(this.ctx.stinkCloudSystem);

      this.ctx.projectileManager.setBfgLaserCallback((proj) => {
        this.hostUpdate.resolveBfgLasers(proj);
      });

      this.ctx.hostPhysics.setBurrowSystem(this.ctx.burrowSystem);
      this.ctx.hostPhysics.setLoadoutManager(this.ctx.loadoutManager);

      this.ctx.combatSystem.setKillCallback((killerId, victimId, weapon, x, y) => {
        if (killerId === TRAIN.TRAIN_KILLER_ID) {
          this.ctx.powerUpSystem?.onPlayerKilled(x, y);
          const victimProfile = bridge.getConnectedPlayers().find(p => p.id === victimId);
          if (victimProfile) {
            bridge.broadcastKillEvent({
              killerId:    TRAIN.TRAIN_KILLER_ID,
              killerName:  'RB 54',
              killerColor: 0xcf573c,
              weapon:      'überfahren',
              victimId,
              victimName:  victimProfile.name,
              victimColor: victimProfile.colorHex,
            });
          }
          return;
        }
        bridge.incrementPlayerFrags(killerId);
        const allPlayers    = bridge.getConnectedPlayers();
        const killerProfile = allPlayers.find(p => p.id === killerId);
        const victimProfile  = allPlayers.find(p => p.id === victimId);
        if (killerProfile && victimProfile) {
          bridge.broadcastKillEvent({
            killerId,
            killerName:  killerProfile.name,
            killerColor: killerProfile.colorHex,
            weapon,
            victimId,
            victimName:  victimProfile.name,
            victimColor: victimProfile.colorHex,
          });
        }
        this.ctx.powerUpSystem?.onPlayerKilled(x, y);
      });

      this.ctx.rockRegistry = new RockRegistry(layout);

      this.ctx.projectileManager.setRockHitCallback((rockId, damage, attackerId) => {
        if (!this.ctx.arenaResult) return;
        const newHp = this.rockVisualHelper.applyObstacleDamageById(rockId, damage, attackerId);
        if (newHp <= 0) this.rockVisualHelper.handleDestroyedRock(rockId, 'damage');
      });

      const trackCell = layout.tracks?.[0];
      if (trackCell !== undefined) {
        this.setupHostTrainEvent(trackCell.gridX);
      }
    }

    // Round-scoped renderers (all clients)
    this.renderers.train = new TrainRenderer(this.scene);
    this.renderers.translocatorTeleport = new TranslocatorTeleportRenderer(this.scene);
    this.renderers.shadow.rebuildArenaStaticShadows(
      this.ctx.currentLayout,
      this.ctx.arenaResult,
      this.ctx.placementSystem?.getAllRuntimeRocks() ?? [],
    );

    // Reset per-round state in coordinators
    this.hostUpdate.resetPerRound();
    this.clientUpdate.resetPerRound();
    this.trainDestroyedShown = false;
  }

  tearDownArena(): void {
    this.ctx.projectileManager.destroyAll();
    this.ctx.smokeSystem.destroyAll();
    this.ctx.fireSystem.destroyAll();
    this.ctx.stinkCloudSystem.destroyAll();
    this.ctx.decoySystem.clearAll();
    this.renderers.teslaDome.destroyAll();
    this.renderers.energyShield.destroyAll();
    this.ctx.effectSystem.clearAllBurrowStates();
    this.placementPreview.clearForTeardown();
    this.rockVisualHelper.destroyAllTurretVisuals();

    if (this.ctx.arenaResult) {
      ArenaBuilder.destroyDynamic(this.ctx.arenaResult);
      this.ctx.arenaResult = null;
    }
    this.ctx.rockRegistry   = null;
    this.ctx.currentLayout  = null;
    this.ctx.placementSystem = null;
    this.ctx.powerUpSystem?.reset();
    this.ctx.powerUpSystem  = null;
    this.ctx.shieldBuffSystem = null;
    this.ctx.energyShieldSystem = null;
    this.ctx.teslaDomeSystem = null;
    this.ctx.turretSystem    = null;
    this.ctx.resourceSystem?.setPowerUpSystem(null);
    this.ctx.resourceSystem  = null;
    this.ctx.burrowSystem    = null;
    this.ctx.combatSystem.setDetonationSystem(null);
    this.ctx.detonationSystem?.reset();
    this.ctx.detonationSystem = null;
    this.ctx.loadoutManager?.setCombatSystem(null);
    this.ctx.loadoutManager?.setTeslaDomeSystem(null);
    this.ctx.loadoutManager?.setEnergyShieldSystem(null);
    this.ctx.loadoutManager?.setShieldBuffSystem(null);
    this.ctx.loadoutManager?.setDecoySystem(null);
    this.ctx.loadoutManager?.setPlaceableRockHandler(null);
    this.ctx.loadoutManager?.setActionBlockedChecker(null);
    this.ctx.loadoutManager?.resetAllUltimateStates();
    this.ctx.loadoutManager = null;
    this.ctx.combatSystem.setBurrowSystem(null);
    this.ctx.combatSystem.setResourceSystem(null);
    this.ctx.combatSystem.setLoadoutManager(null);
    this.ctx.combatSystem.setEnergyShieldSystem(null);
    this.ctx.combatSystem.setDecoySystem(null);
    this.ctx.combatSystem.setPowerUpSystem(null);
    this.ctx.combatSystem.setStinkCloudSystem(null);
    this.ctx.combatSystem.setArenaObstacles(null, null);
    this.ctx.combatSystem.setTrainSegments(null);
    this.ctx.combatSystem.setRockDamageCallback(null);
    this.ctx.combatSystem.setTrainDamageCallback(null);
    this.ctx.combatSystem.setProjectileImpactCallback(null);
    this.ctx.combatSystem.setKillCallback(() => { /* noop */ });
    this.ctx.hostPhysics.setBurrowSystem(null);
    this.ctx.hostPhysics.setLoadoutManager(null);
    this.ctx.decoySystem.setCombatStateReader(null);
    this.ctx.decoySystem.setRunSpeedResolver(null);
    this.ctx.decoySystem.setCooldownStarter(null);
    this.ctx.decoySystem.setObstacleGroups(null, null);
    this.ctx.projectileManager.setRockGroup(null, null, null);
    this.ctx.projectileManager.setRockHitCallback(() => { /* noop */ });
    this.ctx.projectileManager.setProjectileImpactCallback(null);
    this.ctx.projectileManager.setBfgLaserCallback(null);
    this.ctx.hostPhysics.setRockGroup(null, null);

    this.renderers.powerUp.clear();
    this.renderers.nuke.clear();
    this.renderers.meteor.clear();
    this.ctx.armageddonSystem?.destroyAll();
    this.ctx.armageddonSystem = null;

    this.ctx.trainManager?.destroy();
    this.ctx.trainManager = null;
    this.renderers.train?.destroy();
    this.renderers.train = null;
    this.renderers.shadow.clear();
    this.renderers.translocatorTeleport = null;
    this.ctx.projectileManager.setTrainGroup(null);
    this.ctx.projectileManager.setTrainHitCallback(null);
    this.ctx.rightPanel.hideTrainWidget();
    this.clientUpdate.clientUtilityOverride = null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private onTransitionToArena(): void {
    const layout = bridge.getArenaLayout();
    if (!layout) {
      this.layoutRetryCount++;
      if (this.layoutRetryCount >= ArenaLifecycleCoordinator.LAYOUT_RETRY_LIMIT) {
        this.layoutRetryCount = 0;
        this.terminateMatch();
        return;
      }
      this.scene.time.delayedCall(16, () => this.onTransitionToArena());
      return;
    }
    this.layoutRetryCount = 0;

    this.buildArena(layout);
    this.arenaBuilt = true;

    for (const profile of bridge.getConnectedPlayers()) {
      if (bridge.getPlayerReady(profile.id) && !this.ctx.playerManager.hasPlayer(profile.id)) {
        this.ctx.playerManager.addPlayer(profile);
        if (bridge.isHost()) {
          this.ctx.combatSystem.initPlayer(profile.id);
          this.ctx.resourceSystem?.initPlayer(profile.id);
          this.ctx.burrowSystem?.initPlayer(profile.id);
          this.ctx.loadoutManager?.assignDefaultLoadout(profile.id, this.resolveCommittedLoadoutSelection(profile.id));
        }
      }
    }

    this.ctx.leftPanel.transitionToGame();
    this.ctx.rightPanel.transitionToGame();
    this.syncHostLoadoutsFromCommittedSelections();
    this.resetLocalArenaHudState();
    this.localPlayerState.overlayTrackedAlive = null;
    this.ctx.arenaCountdown?.syncTo(bridge.getArenaStartTime());
    this.lobbyOverlay.lockButton();
    this.lobbyOverlay.hide();
    this.hostUpdate.setActive(true);
  }

  private get localPlayerState() { return this.hostUpdate['localPlayerState']; }

  private onTransitionToLobby(): void {
    this.arenaBuilt = false;
    this.arenaEnteredAt = 0;
    this.isLocalReady = false;
    bridge.setLocalReady(false);
    this.roundStartPending = false;
    this.localPlayerState.overlayTrackedAlive = null;
    this.clientUpdate.clientUtilityOverride = null;
    this.ctx.arenaCountdown?.clear();
    this.resetLocalArenaHudState();

    for (const p of [...this.ctx.playerManager.getAllPlayers()]) {
      if (bridge.isHost()) {
        this.ctx.combatSystem.removePlayer(p.id);
        this.ctx.resourceSystem?.removePlayer(p.id);
        this.ctx.burrowSystem?.removePlayer(p.id);
        this.ctx.loadoutManager?.removePlayer(p.id);
      }
      this.ctx.playerManager.removePlayer(p.id);
    }

    this.tearDownArena();

    this.ctx.leftPanel.transitionToLobby();
    this.ctx.leftPanel.setLobbyFieldsLocked(false);
    this.ctx.rightPanel.transitionToLobby();
    this.ctx.rightPanel.showRoundResults(bridge.getRoundResults());
    this.lobbyOverlay.setReadyButtonState(false);
    this.lobbyOverlay.show();
  }

  private setupHostTrainEvent(trackGridX: number): void {
    const trackX     = ARENA_OFFSET_X + trackGridX * CELL_SIZE + CELL_SIZE;
    const direction: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const spawnAt    = bridge.getArenaStartTime() + TRAIN.SPAWN_DELAY_S * 1000;

    bridge.publishTrainEvent({ trackX, direction, spawnAt });

    this.ctx.trainManager = new TrainManager(this.scene, this.ctx.playerManager, trackX, direction);
    this.ctx.translocatorSystem?.setTrainManager(this.ctx.trainManager);
    this.hostUpdate.setTrainSpawned(false);

    this.ctx.projectileManager.setTrainGroup(this.ctx.trainManager.getGroup());
    this.ctx.projectileManager.setTrainHitCallback((damage, attackerId) => {
      this.ctx.trainManager?.applyDamage(damage, attackerId);
    });

    this.ctx.trainManager.setCanHitPlayerCallback((playerId) => {
      return !this.ctx.burrowSystem?.isBurrowed(playerId);
    });
    this.ctx.trainManager.setPlayerHitCallback((playerId, sourceX, sourceY) => {
      this.ctx.combatSystem.applyDamage(playerId, 9999, true, TRAIN.TRAIN_KILLER_ID, 'Zug RB 54', {
        sourceX,
        sourceY,
      });
    });

    this.ctx.trainManager.setDestroyCallback((result) => {
      if (result.lastHitterId) {
        bridge.addPlayerFrags(result.lastHitterId, TRAIN.KILL_FRAGS);
        const allPlayers = bridge.getConnectedPlayers();
        const hitter = allPlayers.find(p => p.id === result.lastHitterId);
        if (hitter) {
          bridge.broadcastKillEvent({
            killerId:    hitter.id,
            killerName:  hitter.name,
            killerColor: hitter.colorHex,
            weapon:      'Zug RB 54',
            victimId:    '__train__',
            victimName:  'RB 54',
            victimColor: 0xcf573c,
          });
        }
      }
      for (const seg of result.segmentPositions) {
        bridge.broadcastExplosionEffect(seg.x, seg.y, 80);
      }
      bridge.broadcastExplosionEffect(result.centerX, result.centerY, 160);

      const arenaTop    = ARENA_OFFSET_Y;
      const arenaBottom = ARENA_OFFSET_Y + ARENA_HEIGHT;
      const validSegs = result.segmentPositions.filter(seg => seg.y >= arenaTop && seg.y <= arenaBottom);
      const dropSegs  = validSegs.length > 0 ? validSegs : result.segmentPositions;
      for (let i = 0; i < TRAIN_DROP_COUNT; i++) {
        const idx     = Math.floor(i * dropSegs.length / TRAIN_DROP_COUNT);
        const seg     = dropSegs[idx];
        const scatter = 28;
        const ox = (Math.random() - 0.5) * scatter;
        const oy = (Math.random() - 0.5) * scatter;
        this.ctx.powerUpSystem?.spawnFromTable('TRAIN_DESTROY', seg.x + ox, seg.y + oy);
      }
      bridge.broadcastTrainDestroyed();
    });

    this.ctx.trainManager.setExitedCallback(() => {
      const currentEvent = bridge.getTrainEvent();
      if (!currentEvent) return;
      const newDirection: 1 | -1 = currentEvent.direction === 1 ? -1 : 1;
      const newSpawnAt = Date.now() + TRAIN.SPAWN_DELAY_S * 1000;
      bridge.publishTrainEvent({ trackX: currentEvent.trackX, direction: newDirection, spawnAt: newSpawnAt });
      this.ctx.trainManager?.prepareReentry(newDirection);
      this.hostUpdate.setTrainSpawned(false);
    });
  }

  private placePlaceableRock(
    cfg: PlaceableUtilityConfig,
    playerId: string,
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
    now: number,
    playerColor: number,
  ): boolean {
    const rock = this.ctx.placementSystem?.tryPlaceRock(cfg, playerId, playerColor, originX, originY, targetX, targetY, now);
    if (!rock) return false;
    this.rockVisualHelper.materializePlaceableRock(rock, true);
    return true;
  }

  private spawnImpactCloudFromProjectile(proj: import('../../types').TrackedProjectile, x: number, y: number): void {
    if (!proj.impactCloud) return;
    const ownerColor = proj.ownerColor ?? bridge.getPlayerColor(proj.ownerId) ?? proj.color;
    this.ctx.stinkCloudSystem.hostCreateStationaryCloud(
      proj.ownerId, ownerColor, x, y,
      proj.impactCloud.radius,
      proj.impactCloud.duration,
      proj.impactCloud.damagePerTick,
      proj.impactCloud.tickInterval,
      proj.impactCloud.rockDamageMult ?? 1,
      proj.impactCloud.trainDamageMult ?? 1,
    );
  }

  private resetLocalArenaHudState(): void {
    const config = this.clientUpdate.getLocalUltimateConfig();
    const hudData = buildInitialLocalArenaHudData({
      ultimateRequiredRage: config.rageRequired,
      ultimateThresholds:   this.clientUpdate.getLocalUltimateThresholds(),
      utilityDisplayName:   this.clientUpdate.getLocalUtilityConfig().displayName,
      weapon2AdrenalineCost: this.clientUpdate.getLocalWeaponConfig('weapon2').adrenalinCost ?? 0,
    });
    this.ctx.leftPanel.updateArenaHUD(hudData);
    this.ctx.playerStatusRing?.update(hudData);
  }

  private resolveCommittedLoadoutSelection(playerId: string): LoadoutSelection {
    const committed = bridge.getPlayerCommittedLoadout(playerId);
    if (!committed) return this.resolveLoadoutSelection(playerId);
    return {
      weapon1:  WEAPON_CONFIGS[committed.weapon1  as keyof typeof WEAPON_CONFIGS],
      weapon2:  WEAPON_CONFIGS[committed.weapon2  as keyof typeof WEAPON_CONFIGS],
      utility:  UTILITY_CONFIGS[committed.utility  as keyof typeof UTILITY_CONFIGS],
      ultimate: ULTIMATE_CONFIGS[committed.ultimate as keyof typeof ULTIMATE_CONFIGS],
    };
  }

  private resolveLoadoutSelection(playerId: string): LoadoutSelection {
    const w1Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon1');
    const w2Id = bridge.getPlayerLoadoutSlot(playerId, 'weapon2');
    const utId = bridge.getPlayerLoadoutSlot(playerId, 'utility');
    const ulId = bridge.getPlayerLoadoutSlot(playerId, 'ultimate');
    return {
      weapon1:  w1Id ? WEAPON_CONFIGS[w1Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      weapon2:  w2Id ? WEAPON_CONFIGS[w2Id  as keyof typeof WEAPON_CONFIGS]   : undefined,
      utility:  utId ? UTILITY_CONFIGS[utId  as keyof typeof UTILITY_CONFIGS]   : undefined,
      ultimate: ulId ? ULTIMATE_CONFIGS[ulId as keyof typeof ULTIMATE_CONFIGS]: undefined,
    };
  }
}
