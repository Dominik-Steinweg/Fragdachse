import * as Phaser from 'phaser';
import { bridge }                from '../network/bridge';
import { ArenaBuilder }          from '../arena/ArenaBuilder';
import { preloadArenaDecalAssets } from '../arena/DecalConfig';
import { MENU_ARENA_PREVIEW_CONFIG } from '../arena/MenuArenaPreviewConfig';
import { MenuArenaPreviewRenderer } from '../arena/MenuArenaPreviewRenderer';
import { PlayerManager }         from '../entities/PlayerManager';
import { ProjectileManager }     from '../entities/ProjectileManager';
import { InputSystem }           from '../systems/InputSystem';
import { HostPhysicsSystem }     from '../systems/HostPhysicsSystem';
import { CombatSystem }          from '../systems/CombatSystem';
import { DecoySystem }           from '../systems/DecoySystem';
import { EffectSystem }          from '../effects/EffectSystem';
import { SmokeSystem }           from '../effects/SmokeSystem';
import { FireSystem }            from '../effects/FireSystem';
import { StinkCloudSystem }      from '../effects/StinkCloudSystem';
import { preloadAllAudio }        from '../audio/AudioCatalog';
import { GameAudioSystem }        from '../audio/GameAudioSystem';
import { AimSystem, UtilityChargeIndicator } from '../ui/AimSystem';
import { ScopeOverlay } from '../ui/ScopeOverlay';
import { ArenaCountdownOverlay } from '../ui/ArenaCountdownOverlay';
import { EnemyHoverNameLabel }  from '../ui/EnemyHoverNameLabel';
import { PlayerStatusRing }      from '../ui/PlayerStatusRing';
import { CoopDefenseXpDebugOverlay } from '../ui/CoopDefenseXpDebugOverlay';
import { CoopDefenseUpgradesOverlay } from '../ui/CoopDefenseUpgradesOverlay';
import { LeftSidePanel }         from '../ui/LeftSidePanel';
import { RightSidePanel }        from '../ui/RightSidePanel';
import { CenterHUD }             from '../ui/CenterHUD';
import { LobbyOverlay }          from './LobbyOverlay';
import { RoomQualityMonitor }    from '../network/RoomQualityMonitor';
import {
  ARENA_COUNTDOWN_SEC, ARENA_DURATION_SEC,
  PLAYER_COLORS, ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_MAX_X, ARENA_VIEWPORT_WIDTH, GAME_WIDTH, CELL_SIZE, COLORS, DEPTH,
  NET_SMOOTH_TIME_MS,
  applyArenaMetricsForMode,
} from '../config';
import { DEFAULT_LOADOUT, WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import { resolveLoadoutSelectionIds } from '../loadout/LoadoutRules';
import type { PlaceableUtilityConfig } from '../loadout/LoadoutConfig';
import { copyCurrentRoomShareUrl, restartRoomForQualityRetry } from '../utils/roomQuality';
import {
  addStoredCoopDefenseXp,
  getStoredCoopDefenseProgress,
  getStoredEffectsVolume,
  getStoredMasterVolume,
  getStoredMusicVolume,
  markStoredCoopDefenseBossMapCompleted,
  markStoredCoopDefenseRoundProcessed,
  setStoredCoopDefenseCheatProgress,
  setStoredCoopDefenseUpgradeProfile,
} from '../utils/localPreferences';
import { getCoopDefenseProgressSnapshot, type CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  buildDefaultCoopDefenseUpgradeProfile,
  cloneCoopDefenseUpgradeProfile,
  levelDownCoopDefenseUpgrade,
  levelUpCoopDefenseUpgrade,
  getCoopDefenseUpgradeTextureKey,
} from '../utils/coopDefenseUpgrades';
import type { CoopDefenseUpgradeProfile } from '../types';
import type { GamePhase, LoadoutCommitSnapshot, LoadoutSlot, LoadoutUseResult, PlayerProfile, RoomQualitySnapshot, SyncedProjectile } from '../types';
import { isCoopDefenseMode, isTeamGameMode, usesDynamicCamera } from '../gameModes';
import { getCoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../config/coopDefenseEnemies';
import { TunnelRenderer } from './arena/TunnelRenderer';
import { EnemyFlowFieldDebugOverlay } from './arena/EnemyFlowFieldDebugOverlay';
import { ArenaRuntimeProfiler } from './arena/ArenaRuntimeProfiler';

import {
  type ArenaContext,
  type RendererBundle,
  LocalPlayerState,
  RockVisualHelper,
  PlacementPreviewRenderer,
  ClientUpdateCoordinator,
  HostUpdateCoordinator,
  RpcCoordinator,
  ArenaLifecycleCoordinator,
  GaussWarningRenderer,
  createRendererBundle,
  wireRenderersToProjManager,
  wireRenderersToEffectSystem,
  wireRenderersToAudioSystem,
} from './arena';

function resolveSpawnProjectileDangerRadius(projectile: SyncedProjectile): number {
  const baseRadius = Math.max(CELL_SIZE * 2, projectile.size * 4);

  switch (projectile.style) {
    case 'rocket':
    case 'bfg':
      return Math.max(baseRadius, CELL_SIZE * 4);
    case 'grenade':
    case 'holy_grenade':
      return Math.max(baseRadius, CELL_SIZE * 3.5);
    case 'energy_ball':
    case 'hydra':
    case 'spore':
      return Math.max(baseRadius, CELL_SIZE * 3);
    case 'flame':
      return Math.max(baseRadius, CELL_SIZE * 1.5);
    default:
      return baseRadius;
  }
}

export class ArenaScene extends Phaser.Scene {
  // ── Phaser-scoped objects (must stay in scene) ────────────────────────────
  private arenaBuilder!: ArenaBuilder;
  private arenaClipMaskShape: Phaser.GameObjects.Graphics | null = null;
  private arenaClipMask: Phaser.Display.Masks.GeometryMask | null = null;
  private lastArenaMaskOffsetX = Number.NaN;
  private lastArenaMaskViewportWidth = Number.NaN;
  private utilityChargeIndicator: UtilityChargeIndicator | null = null;
  private ultimateChargeIndicator: UtilityChargeIndicator | null = null;
  private playerStatusRing: PlayerStatusRing | null = null;
  private enemyHoverNameLabel: EnemyHoverNameLabel | null = null;
  private scopeOverlay: ScopeOverlay | null = null;
  private menuArenaPreview: MenuArenaPreviewRenderer | null = null;

  // ── Coordinators ──────────────────────────────────────────────────────────
  private ctx!: ArenaContext;
  private renderers!: RendererBundle;
  private localPlayerState!: LocalPlayerState;
  private rockVisualHelper!: RockVisualHelper;
  private placementPreview!: PlacementPreviewRenderer;
  private tunnelRenderer!: TunnelRenderer;
  private gaussWarning!: GaussWarningRenderer;
  private hostUpdate!: HostUpdateCoordinator;
  private clientUpdate!: ClientUpdateCoordinator;
  private rpcCoordinator!: RpcCoordinator;
  private lifecycle!: ArenaLifecycleCoordinator;

  // ── Lobby / Room-quality (not round-scoped) ───────────────────────────────
  private lobbyOverlay!: LobbyOverlay;
  private roomQualityMonitor!: RoomQualityMonitor;
  private roomQualitySnapshot: RoomQualitySnapshot | null = null;
  private lastCameraScrollX = 0;
  private arenaPanelTabKey: Phaser.Input.Keyboard.Key | null = null;
  private coopDefenseDebugDamageKey: Phaser.Input.Keyboard.Key | null = null;
  private arenaPanelsHeld = false;
  private optionsHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private coopDefenseXpDebugHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private flowFieldDebugOverlay: EnemyFlowFieldDebugOverlay | null = null;
  private coopDefenseXpDebugOverlay: CoopDefenseXpDebugOverlay | null = null;
  private coopDefenseUpgradesOverlay: CoopDefenseUpgradesOverlay | null = null;
  private coopDefenseProgress: CoopDefenseProgressSnapshot = getCoopDefenseProgressSnapshot(0);
  // Profil-Stand beim Oeffnen des Upgrade-Overlays – fuer "Abbruch" (Wiederherstellen).
  private coopDefenseUpgradeProfileSnapshot: CoopDefenseUpgradeProfile | null = null;
  private coopDefenseLastProcessedRoundEndedAt: number | null = null;
  private lastObservedGamePhase: GamePhase | null = null;
  private runtimeProfiler: ArenaRuntimeProfiler | null = null;

  constructor() {
    super({ key: 'ArenaScene' });
  }

  preload(): void {
    preloadAllAudio(this.load);
    this.load.image('gras_bg_dm', './assets/sprites/gras_bg_dm.png');
    this.load.image('gras_bg_ctb', './assets/sprites/gras_bg_ctb.png');
    this.load.image('lobby_bg', './assets/sprites/lobby_bg.png');
    this.load.image('bg_tracks',  './assets/sprites/64x32tracks.png');
    this.load.spritesheet('rocks', './assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('dirt',  './assets/sprites/dirt47blob.png',  { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('base',  './assets/sprites/base47blob.png',  { frameWidth: 32, frameHeight: 32 });
    preloadArenaDecalAssets(this.load);
    this.load.image('bg_canopy',  './assets/sprites/192x192canopy01.png');
    this.load.image('lobby_logo', './assets/sprites/fragdachselogo.png');
    this.load.image('powerup_hp',  './assets/sprites/16x16HP.png');
    this.load.image('powerup_arm', './assets/sprites/16x16Armor.png');
    this.load.image('powerup_adr', './assets/sprites/16x16adrenalin.png');
    this.load.image('powerup_dam', './assets/sprites/16x16damageamp.png');
    this.load.image('powerup_hhg', './assets/sprites/16x16holy_grenade.png');
    this.load.image('powerup_nuk', './assets/sprites/16x16nuke.png');
    this.load.image('powerup_bfg', './assets/sprites/16x16bfg.png');
    this.load.image('badger',      './assets/sprites/32x32dachsweapon01.png');
    for (const enemyConfig of Object.values(COOP_DEFENSE_ENEMY_CONFIGS)) {
      this.load.image(
        enemyConfig.imageKey,
        `./assets/sprites/enemies/${enemyConfig.imageKey}.png`,
      );
    }
    this.load.atlas('dachs_death', './assets/player/dachs_death_ani3.png', './assets/player/dachs_death_ani3.json');

    // Preload Loadout & Upgrade Icons
    for (const key of Object.keys(WEAPON_CONFIGS)) {
      this.load.image(key, `./assets/sprites/Loadout/${key}.png`);
    }
    for (const key of Object.keys(UTILITY_CONFIGS)) {
      this.load.image(key, `./assets/sprites/Loadout/${key}.png`);
    }
    for (const key of Object.keys(ULTIMATE_CONFIGS)) {
      this.load.image(key, `./assets/sprites/Loadout/${key}.png`);
    }

    // Upgrade-Icons direkt aus den Definitionen ableiten, damit neue Upgrades
    // automatisch geladen werden (kein manuelles Pflegen einer Liste noetig).
    const queuedUpgradeTextures = new Set<string>();
    for (const definition of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
      if (definition.kind !== 'upgrade') continue;
      const key = getCoopDefenseUpgradeTextureKey(definition.id);
      if (queuedUpgradeTextures.has(key)) continue;
      queuedUpgradeTextures.add(key);
      this.load.image(key, `./assets/sprites/Loadout/${key}.png`);
    }
  }

  create(): void {
    applyArenaMetricsForMode(bridge.getGameMode(), bridge.getGamePhase());

    this.anims.create({
      key:       'player_death',
      frames:    this.anims.generateFrameNames('dachs_death', {
        prefix:  'Animation test (Dachs tot) (geist dunkler fade)-NEU ',
        suffix:  '.aseprite',
        start:   0,
        end:     37,
      }),
      frameRate: 60,
      repeat:    0,
    });

    bridge.clearPlayerCallbacks();
    this.input.mouse?.disableContextMenu();

    // ── Static arena (never destroyed) ────────────────────────────────────
    this.arenaBuilder = new ArenaBuilder(this);
    this.arenaBuilder.buildStatic(bridge.getGameMode(), bridge.getGamePhase());
    this.menuArenaPreview = new MenuArenaPreviewRenderer(this, MENU_ARENA_PREVIEW_CONFIG);
    this.menuArenaPreview.build();
    this.menuArenaPreview.setVisible(bridge.getGamePhase() === 'LOBBY');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.menuArenaPreview?.destroy();
      this.menuArenaPreview = null;
    });
    this.ensureArenaClipMask();


    // ── Scene-lifetime systems ─────────────────────────────────────────────
    const playerManager    = new PlayerManager(this);
    playerManager.setLocalPlayerId(bridge.getLocalPlayerId());
    playerManager.setRelationshipResolver((localPlayerId, otherPlayerId) => bridge.isEnemyPair(localPlayerId, otherPlayerId));
    playerManager.setTeamResolver((playerId) => bridge.getPlayerTeam(playerId));
    const projectileManager = new ProjectileManager(this);
    const combatSystem     = new CombatSystem(playerManager, projectileManager, bridge);
    const decoySystem      = new DecoySystem(this, playerManager, bridge);
    const effectSystem     = new EffectSystem(this, bridge);
    const gameAudioSystem  = new GameAudioSystem(
      this,
      () => bridge.getLocalPlayerId(),
      () => {
        const sprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
        return sprite ? { x: sprite.x, y: sprite.y } : null;
      },
      getStoredMasterVolume(),
      getStoredEffectsVolume(),
      getStoredMusicVolume(),
    );
    const smokeSystem      = new SmokeSystem(this);
    const fireSystem       = new FireSystem(this);
    const stinkCloudSystem = new StinkCloudSystem(this);
    const hostPhysics      = new HostPhysicsSystem(this, playerManager, bridge, combatSystem);
    const inputSystem      = new InputSystem(
      this, bridge, () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );
    projectileManager.setAudioSystem(gameAudioSystem);
    effectSystem.setAudioSystem(gameAudioSystem);

    // ── UI (scene-lifetime) ────────────────────────────────────────────────
    const leftPanel  = new LeftSidePanel(this, bridge, gameAudioSystem);
    leftPanel.build();
    const rightPanel = new RightSidePanel(this);
    rightPanel.build();
    const centerHUD  = new CenterHUD(this);
    centerHUD.build();
    centerHUD.setPuContainer(leftPanel.getPuContainer());

    const aimSystem = new AimSystem(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      (slot) => this.clientUpdate.getLocalWeaponConfig(slot),
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.scopeOverlay = new ScopeOverlay(this);
    this.utilityChargeIndicator = new UtilityChargeIndicator(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.ultimateChargeIndicator = new UtilityChargeIndicator(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      () => bridge.getPlayerColor(bridge.getLocalPlayerId()) ?? PLAYER_COLORS[0],
    );
    this.playerStatusRing = new PlayerStatusRing(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
      () => this.localPlayerState?.alive ?? false,
      () => this.localPlayerState?.burrowed ?? false,
    );
    this.enemyHoverNameLabel = new EnemyHoverNameLabel(this);
    this.coopDefenseXpDebugOverlay = new CoopDefenseXpDebugOverlay(
      () => this.coopDefenseProgress.totalXp,
      () => this.coopDefenseProgress.earnedBossPoints,
      (totalXp, bossPoints) => {
        setStoredCoopDefenseCheatProgress(totalXp, bossPoints);
        this.refreshStoredCoopDefenseProgress();
        this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
      },
    );
    this.coopDefenseUpgradesOverlay = new CoopDefenseUpgradesOverlay(
      this,
      () => this.coopDefenseProgress,
      (upgradeId) => this.levelUpCoopDefenseUpgrade(upgradeId),
      (upgradeId) => this.levelDownCoopDefenseUpgrade(upgradeId),
      () => this.fullRespecCoopDefenseUpgrades(),
      () => this.cancelCoopDefenseUpgradeChanges(),
      () => this.applyCoopDefenseUpgradeChanges(),
    );
    this.coopDefenseUpgradesOverlay.build();

    const arenaCountdown = new ArenaCountdownOverlay(
      this,
      () => playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite,
    );
    arenaCountdown.setAudioSystem(gameAudioSystem);

    // ── Assemble ArenaContext ──────────────────────────────────────────────
    this.ctx = {
      playerManager, projectileManager, combatSystem, effectSystem,
      gameAudioSystem,
      decoySystem,
      smokeSystem, fireSystem, stinkCloudSystem, hostPhysics, inputSystem,
      leftPanel, rightPanel, centerHUD, aimSystem, arenaCountdown,
      playerStatusRing: this.playerStatusRing,
      // Round-scoped (start null)
      arenaResult: null, currentLayout: null, placementSystem: null, rockRegistry: null, captureTheBeerSystem: null, baseManager: null, enemyManager: null,
      resourceSystem: null, burrowSystem: null, loadoutManager: null,
      powerUpSystem: null, detonationSystem: null, armageddonSystem: null, airstrikeSystem: null,
      shieldBuffSystem: null, energyShieldSystem: null,
      timeBubbleSystem: null,
      teslaDomeSystem: null, turretSystem: null, coopDefensePlayerModifierSystem: null, guardianSpiritSystem: null, slimeTrailSystem: null, flamethrowerUpgradeSystem: null, necromancySystem: null, coopDefenseEnemyAttackSystem: null, coopDefenseEnemyAbilitySystem: null, coopDefenseEnemyTrainAwarenessSystem: null, coopDefenseRoundStateSystem: null, coopDefenseWaveSpawner: null, translocatorSystem: null, tunnelSystem: null, trainManager: null,
      enemyFlowFieldService: null,
      enemyPlayerFlowFieldService: null,
      enemyBossFlowFieldService: null,
      allyFlowFieldServices: new Map(),
    };

    playerManager.setSpawnContextProvider((playerId) => {
      const latestState = bridge.getLatestGameState();
      const runtimePlaceables = this.ctx.placementSystem?.getAllRuntimeRocks() ?? latestState?.placeableRocks ?? [];
      const turretRange = UTILITY_CONFIGS.FLIEGENPILZ.placeable.targetRange;

      return {
        fires: latestState?.fires ?? [],
        stinkClouds: latestState?.stinkClouds ?? [],
        teslaDomes: latestState?.teslaDomes ?? [],
        nukes: latestState?.nukes ?? [],
        meteors: latestState?.meteors ?? [],
        turrets: runtimePlaceables
          .filter((placeable) => (
            placeable.kind === 'turret'
            && playerId !== null
            && combatSystem.canDamageTarget(placeable.ownerId, playerId)
          ))
          .map((placeable) => ({
            x: ARENA_OFFSET_X + placeable.gridX * CELL_SIZE + CELL_SIZE * 0.5,
            y: ARENA_OFFSET_Y + placeable.gridY * CELL_SIZE + CELL_SIZE * 0.5,
            ownerId: placeable.ownerId,
            range: turretRange,
          })),
        projectiles: (latestState?.projectiles ?? [])
          .filter((projectile) => playerId !== null && combatSystem.canDamageTarget(projectile.ownerId, playerId, projectile.allowTeamDamage))
          .map((projectile) => ({
            x: projectile.x,
            y: projectile.y,
            ownerId: projectile.ownerId,
            radius: resolveSpawnProjectileDangerRadius(projectile),
          })),
        // Coop-Defense: Lebende Gegner mit ihrer effektiven Angriffsreichweite
        // veröffentlichen, damit der Spawn nicht in deren Wirkungskreis fällt.
        enemyThreats: (this.ctx.enemyManager?.getAllEnemies() ?? [])
          .filter((enemy) => enemy.sprite.active && combatSystem.isAlive(enemy.id))
          .map((enemy) => ({
            x: enemy.sprite.x,
            y: enemy.sprite.y,
            attackRange: Math.max(
              0,
              ...enemy.getAttackWeapons().map((attackWeapon) => (
                attackWeapon.weapon.config.fire.type === 'tesla_dome'
                  ? attackWeapon.weapon.config.fire.radius
                  : attackWeapon.weapon.config.range
              )),
            ),
          })),
        // Coop-Defense: IDs der noch verteidigten Basen → Leftmost-Spawn-Bias
        // ignoriert zerstörte Basen automatisch.
        livingCoopBaseIds: this.ctx.baseManager?.getActiveBaseIds(),
        isRelevantOpponent: (otherPlayerId) => playerId === null
          ? combatSystem.isAlive(otherPlayerId)
          : combatSystem.isAlive(otherPlayerId) && bridge.isEnemyPair(playerId, otherPlayerId),
        hasLineOfSight: (sx, sy, ex, ey) => combatSystem.hasLineOfSight(sx, sy, ex, ey),
      };
    });

    // ── Renderers ─────────────────────────────────────────────────────────
    this.renderers = createRendererBundle(this, playerManager, this.arenaClipMask);
    wireRenderersToProjManager(this.renderers, projectileManager, playerManager);
    wireRenderersToEffectSystem(this.renderers, effectSystem);
    wireRenderersToAudioSystem(this.renderers, gameAudioSystem);

    // Homing providers (closed over ctx, read at call-time → safe after teardown)
    projectileManager.setHomingTargetProvider((_config, ownerId) => {
      if (!bridge.isHost()) return [];
      const targets = [];
      for (const player of playerManager.getAllPlayers()) {
        if (player.id === ownerId) continue;
        if (!player.sprite.active) continue;
        if (!combatSystem.isAlive(player.id)) continue;
        if (this.ctx.burrowSystem?.isBurrowed(player.id)) continue;
        if (!combatSystem.canDamageTarget(ownerId, player.id)) continue;
        targets.push({ id: player.id, type: 'players' as const, x: player.sprite.x, y: player.sprite.y });
      }
      for (const enemy of this.ctx.enemyManager?.getAllEnemies() ?? []) {
        if (!enemy.sprite.active) continue;
        if (!combatSystem.isAlive(enemy.id)) continue;
        if (!combatSystem.canDamageTarget(ownerId, enemy.id)) continue;
        targets.push({ id: enemy.id, type: 'enemies' as const, x: enemy.sprite.x, y: enemy.sprite.y });
      }
      return targets;
    });
    projectileManager.setHomingLineOfSightChecker((sx, sy, ex, ey) => {
      return combatSystem.hasLineOfSight(sx, sy, ex, ey);
    });

    effectSystem.setup(() => { aimSystem.notifyConfirmedHit(); });

    // ── Shared state & helpers ─────────────────────────────────────────────
    this.localPlayerState = new LocalPlayerState();
    this.rockVisualHelper  = new RockVisualHelper(this, this.ctx, this.arenaClipMask, this.renderers.shadow, this.renderers.rockDestruction);
    this.placementPreview  = new PlacementPreviewRenderer(this, this.ctx);
    this.tunnelRenderer    = new TunnelRenderer(this);
    this.gaussWarning      = new GaussWarningRenderer(this);

    // ── Coordinators ──────────────────────────────────────────────────────
    this.hostUpdate   = new HostUpdateCoordinator(this, this.ctx, this.renderers, this.localPlayerState, this.rockVisualHelper);
    this.clientUpdate = new ClientUpdateCoordinator(this, this.ctx, this.localPlayerState, this.rockVisualHelper);
    this.runtimeProfiler = new ArenaRuntimeProfiler();

    // ── Input setup ───────────────────────────────────────────────────────
    inputSystem.setup();
    inputSystem.setAudioSystem(gameAudioSystem);
    inputSystem.setupUtilityConfigProvider(() => this.clientUpdate.getLocalUtilityConfig());
    inputSystem.setupUtilityCooldownProvider(() => bridge.getPlayerUtilityCooldownUntil(bridge.getLocalPlayerId()));
    inputSystem.setupUltimateConfigProvider(() => this.clientUpdate.getLocalUltimateConfig());
    inputSystem.setupLocalRageProvider(() => this.clientUpdate.getLocalRage());

    // ── Debug Hotkeys ─────────────────────────────────────────────────────
    inputSystem.setupDebugHotkeys((type) => {
      if (!bridge.isHost()) return;

      const service = type === 'flowfield_players'
        ? this.ctx.enemyPlayerFlowFieldService
        : this.ctx.enemyFlowFieldService;
      if (!service) return;

      if (!this.flowFieldDebugOverlay) {
        console.log('[ArenaScene] Creating EnemyFlowFieldDebugOverlay');
        this.flowFieldDebugOverlay = new EnemyFlowFieldDebugOverlay(this, service);
      }

      console.log(`[ArenaScene] Showing ${type} overlay`);
      this.flowFieldDebugOverlay.showForService(service);
    });
    const playLocalFailureSound = (slot: LoadoutSlot): void => {
      if (slot === 'weapon1' || slot === 'weapon2') {
        const shotAudio = this.clientUpdate.getLocalWeaponConfig(slot).shotAudio;
        gameAudioSystem.playLocalSound(shotAudio?.failureKey);
        return;
      }

      if (slot === 'ultimate') {
        const ultimate = this.clientUpdate.getLocalUltimateConfig();
        if (ultimate.type === 'gauss') {
          gameAudioSystem.playLocalSound(ultimate.shotAudio?.failureKey);
        }
      }
    };
    const isWeapon2AdrenalineInsufficient = (assumeRecentLocalShot = false): boolean => {
      const localId = bridge.getLocalPlayerId();
      const weapon2Config = this.clientUpdate.getLocalWeaponConfig('weapon2');
      const fireSuperiorityActive = this.ctx.loadoutManager?.isAk47FireSuperiorityActive(localId)
        ?? (weapon2Config.id === 'AK47'
          && bridge.getPlayerActiveBuffs(localId).some((buff) => buff.defId === 'AK47_FIRE_SUPERIORITY'));
      if (fireSuperiorityActive) return false;
      const adrenalineCost = weapon2Config.adrenalinCost ?? 0;
      if (adrenalineCost <= 0) return false;

      const localAdrenaline = this.clientUpdate.getLocalAdrenaline();
      if (localAdrenaline < adrenalineCost) return true;
      if (!assumeRecentLocalShot) return false;

      return localAdrenaline < adrenalineCost * 2;
    };
    const handleLocalFailureFeedback = (
      slot: LoadoutSlot,
      reason: 'cooldown' | 'resource',
      inputStarted: boolean,
      resourceKind?: LoadoutUseResult['resourceKind'],
      assumeRecentLocalWeapon2Shot = false,
    ): void => {
      if (!inputStarted) return;

      if (
        slot === 'weapon2'
        && ((reason === 'resource' && resourceKind === 'adrenaline')
          || (reason === 'cooldown' && isWeapon2AdrenalineInsufficient(assumeRecentLocalWeapon2Shot)))
      ) {
        this.playerStatusRing?.notifyAdrenalineInsufficientShot();
      }

      if (slot === 'ultimate' && reason === 'resource' && resourceKind === 'rage') {
        this.ctx.centerHUD.flashUltimateInsufficientRage();
      }

      playLocalFailureSound(slot);
    };
    inputSystem.setupWeapon2ConfigProvider(() => this.clientUpdate.getLocalWeaponConfig('weapon2'));
    inputSystem.setupCanStartScopeCheck(() => {
      const wepConfig = this.clientUpdate.getLocalWeaponConfig('weapon2');
      const lastFired = this.clientUpdate.weaponLastFiredRecord()['weapon2'];
      const cooldownOk = lastFired === 0 || Date.now() - lastFired >= wepConfig.cooldown;
      const adrenalineOk = wepConfig.adrenalinCost === 0
        || this.clientUpdate.getLocalAdrenaline() >= wepConfig.adrenalinCost;
      if (!cooldownOk) {
        handleLocalFailureFeedback('weapon2', 'cooldown', true, undefined, true);
        return false;
      }
      if (!adrenalineOk) {
        handleLocalFailureFeedback('weapon2', 'resource', true, 'adrenaline');
        return false;
      }
      return true;
    });
    inputSystem.setupUtilityPlacementPreviewProvider(() => this.getLocalPlacementPreview());
    inputSystem.setupUltimatePlacementPreviewProvider(() => this.getLocalUltimatePlacementPreview());
    inputSystem.setupTranslocatorRecallCheck(() => {
      const cfg = this.clientUpdate.getLocalUtilityConfig();
      if (!cfg || cfg.type !== 'translocator') return false;
      return this.ctx.translocatorSystem?.getActivePuckId(bridge.getLocalPlayerId()) !== undefined;
    });
    inputSystem.onUtilityPressedDuringCooldown = () => {
      const localId       = bridge.getLocalPlayerId();
      const cooldownUntil = bridge.getPlayerUtilityCooldownUntil(localId);
      const remaining     = Math.max(0, cooldownUntil - bridge.getSynchronizedNow());
      const config        = this.clientUpdate.getLocalUtilityConfig();
      const frac          = config && config.cooldown > 0 ? Math.min(1, remaining / config.cooldown) : 0.8;
      const displayName   = config?.displayName ?? 'Utility';
      this.ctx.centerHUD.flashUtilityCooldown(frac, displayName);
    };
    inputSystem.onUltimatePressedWithoutRage = () => {
      this.ctx.centerHUD.flashUltimateInsufficientRage();
    };
    const handleLocalLoadoutFailure = (
      slot: LoadoutSlot,
      result: LoadoutUseResult | null,
      inputStarted: boolean,
    ): void => {
      if (!result || result.ok) return;

      if (slot === 'ultimate') {
        inputSystem.cancelLocalUltimateChargePreview();
      }

      if ((slot === 'weapon1' || slot === 'weapon2') && (result.reason === 'cooldown' || result.reason === 'resource')) {
        this.clientUpdate.rollbackRejectedLoadoutFire(slot);
      }

      if (result.reason === 'cooldown' || result.reason === 'resource') {
        handleLocalFailureFeedback(slot, result.reason, inputStarted, result.resourceKind);
      }
    };
    inputSystem.setupLoadoutListener((slot, angle, targetX, targetY, params) => {
      if (!this.localPlayerState.alive || this.localPlayerState.burrowed) return;

      let shotId: number | undefined;
      const inputStarted = params?.inputStarted === true;

      if (slot === 'weapon1' || slot === 'weapon2') {
        // scopeHolding: kein Schuss, nur holdSpeedFactor auf Host-Seite aktiv halten.
        // Weder Cooldown-Check noch notifyLoadoutFired – sonst würde der echte Schuss blockiert.
        if (params?.scopeHolding) {
          bridge.sendLoadoutUse(slot, angle, targetX, targetY, undefined, params);
          return;
        }
        const now = Date.now();
        const lastFired = this.clientUpdate.weaponLastFiredRecord()[slot];
        const wepConfig = this.clientUpdate.getLocalWeaponConfig(slot);
        if (lastFired > 0 && now - lastFired < wepConfig.cooldown) {
          handleLocalFailureFeedback(slot, 'cooldown', inputStarted, undefined, slot === 'weapon2');
          return;
        }
        shotId = this.clientUpdate.notifyLoadoutFired(slot, angle, targetX, targetY);
      }
      if (slot === 'utility') {
        const utilityCooldownUntil = bridge.getPlayerUtilityCooldownUntil(bridge.getLocalPlayerId());
        if (utilityCooldownUntil > Date.now()) {
          if (inputStarted) {
            const utilityShotAudio = this.clientUpdate.getLocalUtilityConfig()?.shotAudio;
            gameAudioSystem.playLocalSound(utilityShotAudio?.failureKey);
          }
          return;
        }
        this.clientUpdate.notifyUtilityFired();
      }

      const localSprite = playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
      const awaitResult = (slot === 'utility'
        && inputSystem.isUtilityPlacementActive()
        && this.clientUpdate.getLocalUtilityConfig().activation.type === 'placement_mode')
        || (slot === 'ultimate'
          && inputSystem.isUltimatePlacementActive()
          && params?.tunnelAction === 'commit');
      const awaitFailureResult = inputStarted && (slot === 'weapon2' || slot === 'ultimate');
      const loadoutPromise = bridge.sendLoadoutUse(slot, angle, targetX, targetY, shotId, params, localSprite?.x, localSprite?.y, Date.now(), awaitResult || awaitFailureResult);
      if (awaitFailureResult) {
        void loadoutPromise.then((result) => {
          handleLocalLoadoutFailure(slot, result, inputStarted);
        });
      }
      if (awaitResult) {
        void loadoutPromise.then((result) => {
          if (!result?.ok) this.placementPreview.showPlacementError('Bau fehlgeschlagen');
        }).catch(() => {
          this.placementPreview.showPlacementError('Bau fehlgeschlagen');
        });
      }
    });

    // ── Lobby overlay & room-quality ───────────────────────────────────────
    this.lobbyOverlay = new LobbyOverlay(
      this, bridge,
      () => this.onReadyToggled(),
      () => { void this.onCopyRoomLink(); },
      () => this.onRetryRoom(),
      () => bridge.toggleGameplayTransportMode(),
      () => this.openCoopDefenseUpgradesOverlay(),
    );
    this.lobbyOverlay.build();
    this.lobbyOverlay.show();

    this.roomQualityMonitor = new RoomQualityMonitor(bridge);

    // ── RPC + Lifecycle coordinators ──────────────────────────────────────
    this.rpcCoordinator = new RpcCoordinator(this, this.ctx, this.renderers, this.clientUpdate, leftPanel);
    this.lifecycle      = new ArenaLifecycleCoordinator(
      this, this.ctx, this.renderers,
      this.rockVisualHelper, this.placementPreview,
      this.lobbyOverlay, this.hostUpdate, this.clientUpdate,
      this.roomQualityMonitor,
    );
    this.rpcCoordinator.setLifecycle(this.lifecycle);
    this.rpcCoordinator.registerAll();

    if (bridge.isHost()) {
      bridge.initColorPool(PLAYER_COLORS);
    }

    bridge.onPlayerJoin(profile => this.onPlayerJoined(profile));
    bridge.onPlayerQuit(id      => this.onPlayerLeft(id));

    this.lifecycle.initialize();
    this.registerArenaPanelHotkeys();
    bridge.setupPingMeasurement();
    bridge.sendPingToHost();
    this.time.addEvent({ delay: 1000, callback: () => bridge.sendPingToHost(), loop: true });
    this.initializeRoomQuality();
    this.refreshStoredCoopDefenseProgress();
    this.lastObservedGamePhase = bridge.getGamePhase();
  }

  update(_time: number, delta: number): void {
    const frameStartMs = performance.now();
    let primaryStepMs = 0;
    this.syncArenaMetrics();
    this.lifecycle.detectPhaseChange();
    bridge.updateGameplayTransport();

    const phase           = bridge.getGamePhase();
    const enteredLobbyFromArena = this.lastObservedGamePhase === 'ARENA' && phase === 'LOBBY';
    const inGame          = phase === 'ARENA';
    const countdownActive = bridge.isArenaCountdownActive();
    const terminated      = this.lifecycle.isMatchTerminated();
    const optionsOpen     = this.ctx?.leftPanel.isOptionsOverlayOpen() ?? false;

    if (phase === 'LOBBY') {
      this.clearDebugModes();
      if (!isCoopDefenseMode(bridge.getGameMode())) {
        this.coopDefenseXpDebugOverlay?.hide();
        this.coopDefenseUpgradesOverlay?.hide();
      }
    } else {
      this.coopDefenseXpDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
    }

    this.syncMainCamera(delta, inGame && !terminated);

    this.arenaPanelsHeld = !!(inGame && !terminated && this.arenaPanelTabKey?.isDown);

    if (!inGame && this.arenaPanelsHeld) {
      this.arenaPanelsHeld = false;
    }

    this.menuArenaPreview?.setVisible(phase === 'LOBBY');

    if (inGame) {
      this.ctx.inputSystem.setInputEnabled(!countdownActive && !optionsOpen);
      this.ctx.inputSystem.update();
    } else {
      this.ctx.inputSystem.setInputEnabled(false);
    }

    if (!terminated && phase === 'LOBBY') {
      if (!this.lobbyOverlay.isVisible()) this.lobbyOverlay.show();
      const players = bridge.getConnectedPlayers();
      // Lokalen Ready-Stand an den autoritativen Netzwerkwert angleichen. Setzt der Host beim
      // Rundenwechsel (oder bei Modus-/Map-Wechsel) den Spieler auf "nicht bereit", folgt hier sowohl
      // das interne Flag als auch der Button – so ist der Client-Zustandsspeicher garantiert konsistent.
      const localReady = bridge.getPlayerReady(bridge.getLocalPlayerId());
      if (localReady !== this.lifecycle.getIsLocalReady()) {
        this.lifecycle.setIsLocalReady(localReady);
        this.lobbyOverlay.setReadyButtonState(localReady);
      }
      this.updateRoomQuality(this.time.now, players);
      this.lobbyOverlay.setRoomQuality(this.roomQualitySnapshot, bridge.isHost());
      this.lobbyOverlay.refreshPlayerList(players);
      this.ctx.rightPanel.showRoundResults(bridge.getRoundResults(), bridge.getRoundState());
      this.processCoopDefenseRoundXp(enteredLobbyFromArena);
      this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
      const localProfile = players.find(p => p.id === bridge.getLocalPlayerId());
      if (localProfile) this.ctx.leftPanel.updateLocalName(localProfile.name);
      this.ctx.leftPanel.refreshColorIndicator();
      this.ctx.leftPanel.refreshColorPickerIfOpen();
      this.ctx.leftPanel.updateLobby();
      if (bridge.isHost()) this.lifecycle.hostCheckReadyToStart();
    } else if (!terminated && this.lobbyOverlay.isVisible()) {
      this.coopDefenseXpDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
      this.lobbyOverlay.setCoopDefenseProgress(null);
      this.lobbyOverlay.hide();
    } else {
      this.coopDefenseXpDebugOverlay?.hide();
      this.coopDefenseUpgradesOverlay?.hide();
      this.lobbyOverlay.setCoopDefenseProgress(null);
    }

    this.lastObservedGamePhase = phase;

    if (inGame && !terminated) {
      const secs = bridge.computeSecondsLeft();
      const activeMapConfig = isCoopDefenseMode(bridge.getGameMode())
        ? getCoopDefenseMapConfig(bridge.getRoundState()?.coopDefenseMapId ?? bridge.getCoopDefenseMapId())
        : null;
      this.ctx.centerHUD.updateTimer(secs, secs <= 0 && !!activeMapConfig?.boss);

      // Train widget
      const trainEvent = bridge.getTrainEvent();
      if (trainEvent) {
        if (!this.lifecycle.isTrainDestroyedShown()) {
          const latestState = bridge.getLatestGameState();
          const trainState  = latestState?.train ?? null;
          if (trainState?.alive) {
            this.ctx.centerHUD.updateTrainHP(trainState.hp, trainState.maxHp);
          } else if (bridge.getSynchronizedNow() < trainEvent.spawnAt) {
            const arrivalTimerSecs = Math.max(0, Math.ceil((bridge.getRoundEndTime() - trainEvent.spawnAt) / 1000));
            this.ctx.centerHUD.setTrainArrival(arrivalTimerSecs);
          }
        }
      }

      if (bridge.isHost()) {
        const hostStepStartMs = performance.now();
        if (isCoopDefenseMode(bridge.getGameMode()) && this.coopDefenseDebugDamageKey && Phaser.Input.Keyboard.JustDown(this.coopDefenseDebugDamageKey)) {
          this.ctx.coopDefenseRoundStateSystem?.applyDebugBaseDamage(50);
        }
        this.lifecycle.spawnReadyPlayers();
        if (countdownActive) this.lifecycle.syncHostLoadoutsFromCommittedSelections();
        this.hostUpdate.runHostUpdate(delta);
        const coopRoundOutcome = this.ctx.coopDefenseRoundStateSystem?.update() ?? null;
        if (coopRoundOutcome) {
          this.lifecycle.hostCompleteRound(coopRoundOutcome);
        } else if (!isCoopDefenseMode(bridge.getGameMode()) && !countdownActive && secs <= 0) {
          this.lifecycle.hostCompleteRound();
        }
        primaryStepMs += performance.now() - hostStepStartMs;
      } else {
        const clientStepStartMs = performance.now();
        this.clientUpdate.runClientUpdate(delta);

        // Sync renderers that HostUpdateCoordinator handles for host but client needs too
        const state = bridge.getLatestGameState();
        if (state) {
          this.ctx.captureTheBeerSystem?.syncSnapshot(state.captureTheBeer ?? null);
          this.renderers.beer.sync(state.captureTheBeer?.beers ?? []);
          this.renderers.timeBubble.syncVisuals(state.timeBubbles ?? []);
          this.renderers.teslaDome.syncVisuals(state.teslaDomes ?? []);
          this.renderers.energyShield.syncVisuals(state.energyShields ?? []);
          this.renderers.guardianSpirit.syncVisuals(state.guardianSpirits ?? []);
          this.renderers.slimeTrail.syncVisuals(state.slimeTrail ?? { cells: [], affectedEnemies: [] });
          this.renderers.flamethrowerUpgrades.syncGround(state.burningGround ?? { cells: [] });
          this.renderers.flamethrowerUpgrades.syncRings(state.players);
          this.renderers.train?.setTarget(state.train ?? null);
          this.renderers.powerUp.syncPedestals(state.pedestals ?? []);
          this.renderers.powerUp.sync(state.powerups ?? []);
          this.renderers.nuke.sync(state.nukes ?? []);
          this.renderers.airstrike.sync(state.airstrikes ?? []);
          this.renderers.meteor.sync(state.meteors ?? []);
        }
        this.renderers.powerUp.updatePedestals(bridge.getSynchronizedNow());
        this.renderers.train?.render(1 - Math.exp(-delta / NET_SMOOTH_TIME_MS));
        primaryStepMs += performance.now() - clientStepStartMs;
      }

      this.ctx.rightPanel.updateLeaderboard(this.hostUpdate.getLeaderboardEntries());

      if (this.ctx.arenaResult) {
        const localSprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite ?? null;
        ArenaBuilder.updateCanopyTransparency(this.ctx.arenaResult.canopyObjects, localSprite);
      }
    }

    this.syncArenaPanelOverlayState(inGame && !terminated);

    const visualsStartMs = performance.now();

    // ── Per-frame visuals (always) ─────────────────────────────────────────
    const inArena = inGame && !terminated;
    this.syncMainCamera(delta, inArena);
    this.playerStatusRing?.setActive(inArena);
    this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.setWorldBarsVisible(!inArena);
    if (inArena) {
      this.enemyHoverNameLabel?.sync(this.getEnemyHoverNameTarget());
    } else {
      this.enemyHoverNameLabel?.clear(true);
    }
    this.syncArenaFogOverlay(bridge.getSynchronizedNow(), inArena, countdownActive);
    this.renderers.beer.update(bridge.getSynchronizedNow(), delta);
    this.renderers.timeBubble.update(delta);
    this.renderers.teslaDome.update(delta);
    const auraEnemies = inArena ? (this.ctx.enemyManager?.getAllEnemies() ?? []) : [];
    this.ctx.enemyManager?.syncHostVisuals();
    this.renderers.healingAura.syncEnemies(auraEnemies);
    this.renderers.healingAura.update(delta);
    this.renderers.miniTeslaDome.syncEnemies(auraEnemies);
    this.renderers.miniTeslaDome.update(delta);
    this.renderers.energyShield.update(delta);
    this.renderers.guardianSpirit.update(delta);
    this.renderers.slimeTrail.update(delta);
    this.renderers.flamethrowerUpgrades.update(bridge.getSynchronizedNow());

    const utilityTargeting    = this.ctx.inputSystem.getUtilityTargetingPreviewState();
    const airstrikeTargeting  = this.ctx.inputSystem.getAirstrikeTargetingPreviewState();
    const utilityPlacement    = this.getLocalPlacementPreview();
    const ultimatePlacement   = this.getLocalUltimatePlacementPreview();
    const activePlacement     = ultimatePlacement ?? utilityPlacement;
    const ultimatePreview     = this.ctx.inputSystem.getUltimateChargePreviewState();
    const showAim = inArena
      && !optionsOpen
      && this.localPlayerState.alive
      && !this.localPlayerState.burrowed
      && !this.ctx.inputSystem.isUtilityChargePreviewActive()
      && !this.ctx.inputSystem.isUtilityPlacementActive()
      && !this.ctx.inputSystem.isUltimatePlacementActive();
    const scopeProgress = this.ctx.inputSystem.getScopeProgress();
    this.ctx.aimSystem?.setScopeProgress(scopeProgress);
    const targetingForReticle = utilityTargeting ?? airstrikeTargeting;
    this.ctx.aimSystem?.update(
      (showAim || targetingForReticle !== undefined) && !optionsOpen,
      inArena && !optionsOpen,
      delta,
      optionsOpen ? undefined : targetingForReticle,
      optionsOpen ? undefined : ultimatePreview,
    );

    // Scope-Overlay (Sichtverdunkelung bei AWP und anderen Scope-Waffen)
    if (this.scopeOverlay) {
      const scopeCfg = this.ctx.inputSystem.getWeapon2ScopeConfig();
      if (scopeCfg) {
        const pointer = this.input.activePointer;
        this.scopeOverlay.update(scopeProgress, pointer.x, pointer.y, delta, scopeCfg);
      } else {
        // Keine Scope-Waffe ausgerüstet – Overlay ausblenden
        this.scopeOverlay.update(0, 0, 0, delta, { scopeInMs: 1, fullScopeViewRadius: 0, edgeSoftnessPx: 0, unscopedSpreadDeg: 0, unscopeSpeedMs: 200 });
      }
    }

    this.utilityChargeIndicator?.update(this.ctx.inputSystem.getUtilityChargePreviewState());
    this.ultimateChargeIndicator?.update(ultimatePreview);

    this.gaussWarning.update(inArena);
    this.placementPreview.syncUtilityTargetingHint(inArena, utilityTargeting !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.syncAirstrikeTargetingHint(inArena, airstrikeTargeting !== undefined, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.syncPlaceableUtilityHint(inArena, activePlacement, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderPlacementPreview(inArena, activePlacement, this.localPlayerState.alive, this.localPlayerState.burrowed);
    this.placementPreview.renderRemotePlacementPreviews(inArena);
    const tunnelSnapshot = bridge.isHost()
      ? (this.ctx.tunnelSystem?.getSnapshot() ?? [])
      : (bridge.getLatestGameState()?.tunnels ?? []);
    this.tunnelRenderer.sync(inArena ? tunnelSnapshot : []);
    this.tunnelRenderer.update(this.time.now);

    const visualStepMs = performance.now() - visualsStartMs;
    const shadowStepStartMs = performance.now();
    this.syncWorldShadows(inArena);
    const shadowStepMs = performance.now() - shadowStepStartMs;
    const frameCostMs = performance.now() - frameStartMs;
    if (inGame) {
      const role = bridge.isHost() ? 'host' : 'client';
      const firePerformance = this.ctx.fireSystem.takePerformanceMetrics();
      this.runtimeProfiler?.record({
        role,
        deltaMs: delta,
        frameCostMs,
        primaryStepMs,
        visualStepMs,
        shadowStepMs,
        fireSimulationMs: firePerformance.simulationMs,
        fireCreationMs: firePerformance.creationMs,
        fireVisualMs: this.renderers.flamethrowerUpgrades.getLastUpdateCostMs(),
        enemyCount: this.ctx.enemyManager?.getAllEnemies().length ?? 0,
        projectileCount: this.ctx.projectileManager.getDebugActiveProjectileCount(),
        playerCount: this.ctx.playerManager.getAllPlayers().length,
        displayObjectCount: this.children.list.length,
        sceneBreakdown: this.runtimeProfiler?.shouldCaptureSceneBreakdown(role, delta)
          ? this.describeSceneObjectBreakdown()
          : null,
      });
    }
  }

  // ── Network events ────────────────────────────────────────────────────────

  private onPlayerJoined(profile: PlayerProfile): void {
    if (bridge.isHost()) {
      bridge.hostAssignColor(profile.id);
      if (isTeamGameMode(bridge.getGameMode())) {
        bridge.hostEnsureTeamAssignment(profile.id);
      }
    }
  }

  private onPlayerLeft(id: string): void {
    if (bridge.isHost()) bridge.hostReclaimColor(id);
    if (this.ctx.playerManager.hasPlayer(id)) {
      if (bridge.isHost()) {
        this.ctx.combatSystem.removePlayer(id);
        this.ctx.resourceSystem?.removePlayer(id);
        this.ctx.burrowSystem?.removePlayer(id);
        this.ctx.loadoutManager?.removePlayer(id);
        this.ctx.tunnelSystem?.removePlayer(id);
      }
      this.ctx.effectSystem.clearBurrowState(id);
      this.clientUpdate.removeBurrowPhase(id);
      this.ctx.hostPhysics.removePlayer(id);
      this.ctx.playerManager.removePlayer(id);
    }
    if (bridge.getGamePhase() === 'ARENA' && id === bridge.getMatchHostId()) {
      this.lifecycle.terminateMatch();
    }
  }

  // ── Lobby callbacks ───────────────────────────────────────────────────────

  private onReadyToggled(): void {
    const nowReady = !this.lifecycle.getIsLocalReady();
    if (nowReady) {
      // Frühwarnung gegen Lobby-Desync (Bug A/B): Nur bereit machen, wenn dieser Client mit dem
      // host-autoritativen Lobby-Stand aufgeschlossen ist (Spieler-Roster, Modus, Coop-Map). Sonst
      // könnte er einen Mitspieler nicht rendern oder ein für den Modus ungültiges Loadout committen.
      // Weiches Blockieren (kein Dauerblock) + Logging; löst sich, sobald der Stand konvergiert.
      const lobbySync = bridge.getLobbySyncConsistency();
      if (!lobbySync.consistent) {
        console.warn(
          `[LobbySync] BEREIT blockiert – lokaler Stand weicht vom Host ab: ${lobbySync.issues.join(' | ')}. `
          + `Lokal bekannt: [${bridge.getConnectedPlayerIds().join(', ')}].`,
        );
        this.lobbyOverlay.showReadySyncNotice();
        return;
      }
      bridge.setLocalReadyWithCommittedLoadout(this.buildLocalCommittedLoadoutSnapshot());
    } else {
      bridge.setLocalReady(false);
    }
    this.lifecycle.setIsLocalReady(nowReady);
  }

  private openCoopDefenseUpgradesOverlay(): void {
    if (bridge.getGamePhase() !== 'LOBBY' || !isCoopDefenseMode(bridge.getGameMode())) return;

    this.coopDefenseXpDebugOverlay?.hide();
    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    this.refreshStoredCoopDefenseProgress();
    this.coopDefenseUpgradeProfileSnapshot = cloneCoopDefenseUpgradeProfile(getStoredCoopDefenseProgress().profile);
    this.coopDefenseUpgradesOverlay?.show();
  }

  private cancelCoopDefenseUpgradeChanges(): void {
    const snapshot = this.coopDefenseUpgradeProfileSnapshot;
    this.coopDefenseUpgradeProfileSnapshot = null;
    if (!snapshot) return;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(snapshot);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
  }

  private applyCoopDefenseUpgradeChanges(): void {
    // Aenderungen wurden bereits live uebernommen; Snapshot verwerfen.
    this.coopDefenseUpgradeProfileSnapshot = null;
  }

  private levelUpCoopDefenseUpgrade(upgradeId: string): boolean {
    const stored = getStoredCoopDefenseProgress();
    const nextProfile = levelUpCoopDefenseUpgrade(
      stored.profile,
      upgradeId,
      this.coopDefenseProgress.level,
      stored.completedBossMapIds.length,
    );
    if (!nextProfile) return false;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    return true;
  }

  private levelDownCoopDefenseUpgrade(upgradeId: string): boolean {
    const stored = getStoredCoopDefenseProgress();
    const nextProfile = levelDownCoopDefenseUpgrade(stored.profile, upgradeId);
    if (!nextProfile) return false;

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    return true;
  }

  private fullRespecCoopDefenseUpgrades(): boolean {
    const nextProfile = buildDefaultCoopDefenseUpgradeProfile();

    bridge.setLocalReady(false);
    this.lifecycle.setIsLocalReady(false);
    setStoredCoopDefenseUpgradeProfile(nextProfile);
    this.refreshStoredCoopDefenseProgress();
    this.lobbyOverlay.setCoopDefenseProgress(isCoopDefenseMode(bridge.getGameMode()) ? this.coopDefenseProgress : null);
    return true;
  }

  private async onCopyRoomLink(): Promise<void> {
    const copied = await copyCurrentRoomShareUrl();
    if (copied) this.lobbyOverlay.showCopySuccess();
  }

  private onRetryRoom(): void {
    restartRoomForQualityRetry();
  }

  // ── Visual helpers ────────────────────────────────────────────────────────

  private syncArenaFogOverlay(now: number, inArena: boolean, countdownActive: boolean): void {
    if (!this.ctx.arenaCountdown) return;

    if (!inArena) {
      this.localPlayerState.overlayTrackedAlive = null;
      this.ctx.arenaCountdown.clear();
      return;
    }

    if (countdownActive) {
      this.localPlayerState.overlayTrackedAlive = this.localPlayerState.alive;
      this.ctx.arenaCountdown.update(now);
      return;
    }

    if (this.localPlayerState.alive) {
      if (this.localPlayerState.overlayTrackedAlive === false) {
        this.ctx.arenaCountdown.playRespawnReveal();
      }
    } else if (this.localPlayerState.overlayTrackedAlive !== false) {
      this.ctx.arenaCountdown.showDeathVeil();
    }

    this.localPlayerState.overlayTrackedAlive = this.localPlayerState.alive;
    this.ctx.arenaCountdown.update(now);
  }

  private getLocalPlacementPreview() {
    const sprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    const cfg = this.clientUpdate.getLocalUtilityConfig();
    if (!sprite || !this.ctx.placementSystem || !this.ctx.inputSystem.isUtilityPlacementActive()) return undefined;
    if (cfg.activation.type !== 'placement_mode') return undefined;
    const pointer = this.getPointerWorldPoint();
    return this.ctx.placementSystem.getPlacementPreview(cfg as PlaceableUtilityConfig, sprite.x, sprite.y, pointer.x, pointer.y);
  }

  private getLocalUltimatePlacementPreview() {
    const sprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    const cfg = this.clientUpdate.getLocalUltimateConfig();
    if (!sprite || !this.ctx.placementSystem || !this.ctx.inputSystem.isUltimatePlacementActive()) return undefined;
    if (cfg.type !== 'tunnel') return undefined;
    const pointer = this.getPointerWorldPoint();
    return this.ctx.placementSystem.getTunnelPlacementPreview(
      cfg,
      sprite.x,
      sprite.y,
      pointer.x,
      pointer.y,
      this.ctx.inputSystem.getUltimatePlacementAnchor(),
    );
  }

  private buildLocalCommittedLoadoutSnapshot(): LoadoutCommitSnapshot {
    const localId = bridge.getLocalPlayerId();
    const coopDefenseProfile = getStoredCoopDefenseProgress().profile;
    return resolveLoadoutSelectionIds({
      weapon1:  (bridge.getPlayerLoadoutSlot(localId, 'weapon1')  ?? DEFAULT_LOADOUT.weapon1.id) in WEAPON_CONFIGS
        ? WEAPON_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'weapon1') ?? DEFAULT_LOADOUT.weapon1.id) as keyof typeof WEAPON_CONFIGS]
        : DEFAULT_LOADOUT.weapon1,
      weapon2:  (bridge.getPlayerLoadoutSlot(localId, 'weapon2')  ?? DEFAULT_LOADOUT.weapon2.id) in WEAPON_CONFIGS
        ? WEAPON_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'weapon2') ?? DEFAULT_LOADOUT.weapon2.id) as keyof typeof WEAPON_CONFIGS]
        : DEFAULT_LOADOUT.weapon2,
      utility:  (bridge.getPlayerLoadoutSlot(localId, 'utility')  ?? DEFAULT_LOADOUT.utility.id) in UTILITY_CONFIGS
        ? UTILITY_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'utility') ?? DEFAULT_LOADOUT.utility.id) as keyof typeof UTILITY_CONFIGS]
        : DEFAULT_LOADOUT.utility,
      ultimate: (bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? DEFAULT_LOADOUT.ultimate.id) in ULTIMATE_CONFIGS
        ? ULTIMATE_CONFIGS[(bridge.getPlayerLoadoutSlot(localId, 'ultimate') ?? DEFAULT_LOADOUT.ultimate.id) as keyof typeof ULTIMATE_CONFIGS]
        : DEFAULT_LOADOUT.ultimate,
    }, bridge.getGameMode(), coopDefenseProfile);
  }

  private getEnemyHoverNameTarget(): { name: string; x: number; y: number } | null {
    const pointer = this.getPointerWorldPoint();
    const localId = bridge.getLocalPlayerId();
    let nearest: { name: string; x: number; y: number; distanceSq: number } | null = null;

    for (const player of this.ctx.playerManager.getAllPlayers()) {
      if (player.id === localId) continue;

      const sprite = player.sprite;
      if (!sprite.active || !sprite.visible) continue;

      const dx = pointer.x - sprite.x;
      const dy = pointer.y - sprite.y;
      const radius = Math.max(sprite.displayWidth, sprite.displayHeight) * 0.5;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > radius * radius) continue;

      if (!nearest || distanceSq < nearest.distanceSq) {
        nearest = {
          name: bridge.getPlayerName(player.id),
          x: sprite.x,
          y: sprite.y,
          distanceSq,
        };
      }
    }

    const decoyTarget = this.ctx.decoySystem.getHoverNameTarget(pointer.x, pointer.y);
    if (decoyTarget && (!nearest || decoyTarget.distanceSq < nearest.distanceSq)) {
      nearest = decoyTarget;
    }

    if (!nearest) return null;
    return { name: nearest.name, x: nearest.x, y: nearest.y };
  }

  private registerArenaPanelHotkeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    this.arenaPanelTabKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB, true);
    this.coopDefenseDebugDamageKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K, true);
    if (this.optionsHotkeyHandler) {
      keyboard.off('keydown-O', this.optionsHotkeyHandler);
      this.optionsHotkeyHandler = null;
    }

    this.optionsHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat || !this.ctx) return;

      const phase = bridge.getGamePhase();
      if ((phase !== 'LOBBY' && phase !== 'ARENA') || this.lifecycle.isMatchTerminated()) return;
      if (this.ctx.leftPanel.isHotkeyInputBlocked()) return;
      if (this.ctx.leftPanel.isHelpOverlayOpen()) return;
      if (this.coopDefenseUpgradesOverlay?.isOpen()) return;
      if (this.coopDefenseXpDebugOverlay?.isOpen()) return;

      this.ctx.leftPanel.toggleOptionsOverlay();
    };

    keyboard.on('keydown-O', this.optionsHotkeyHandler);
    if (this.coopDefenseXpDebugHotkeyHandler) {
      keyboard.off('keydown-L', this.coopDefenseXpDebugHotkeyHandler);
      this.coopDefenseXpDebugHotkeyHandler = null;
    }

    this.coopDefenseXpDebugHotkeyHandler = (event: KeyboardEvent) => {
      if (event.repeat || !this.ctx) return;

      const phase = bridge.getGamePhase();
      if (phase !== 'LOBBY' || this.lifecycle.isMatchTerminated()) return;
      if (!isCoopDefenseMode(bridge.getGameMode())) return;
      if (this.ctx.leftPanel.isHotkeyInputBlocked()) return;
      if (this.ctx.leftPanel.isHelpOverlayOpen()) return;
      if (this.ctx.leftPanel.isOptionsOverlayOpen()) return;
      if (this.coopDefenseUpgradesOverlay?.isOpen()) return;

      this.coopDefenseXpDebugOverlay?.toggle();
    };

    keyboard.on('keydown-L', this.coopDefenseXpDebugHotkeyHandler);
    this.events.once('shutdown', () => {
      if (!this.optionsHotkeyHandler) return;
      keyboard.off('keydown-O', this.optionsHotkeyHandler);
      this.optionsHotkeyHandler = null;
      if (this.coopDefenseXpDebugHotkeyHandler) {
        keyboard.off('keydown-L', this.coopDefenseXpDebugHotkeyHandler);
        this.coopDefenseXpDebugHotkeyHandler = null;
      }
      this.coopDefenseXpDebugOverlay?.destroy();
      this.coopDefenseXpDebugOverlay = null;
      this.coopDefenseUpgradesOverlay?.destroy();
      this.coopDefenseUpgradesOverlay = null;
    });
  }

  private syncArenaPanelOverlay(visible: boolean, immediate = false): void {
    if (!this.ctx) return;
    this.ctx.leftPanel.setArenaOverlayVisible(visible, immediate);
    this.ctx.rightPanel.setArenaOverlayVisible(visible, immediate);
  }

  private clearDebugModes(): void {
    this.flowFieldDebugOverlay?.destroy();
    this.flowFieldDebugOverlay = null;
  }

  private syncArenaPanelOverlayState(inArena = bridge.getGamePhase() === 'ARENA' && !this.lifecycle?.isMatchTerminated()): void {
    if (!this.ctx) return;
    const shouldShow = inArena && (bridge.isArenaCountdownActive() || this.arenaPanelsHeld || !this.localPlayerState.alive);
    this.syncArenaPanelOverlay(shouldShow);
  }

  private ensureArenaClipMask(): void {
    // GeometryMask is Canvas-only in Phaser 4. Keep the world on WebGL and
    // rely on arena bounds, object clamping and visibility checks instead.
    this.arenaClipMask = null;
    this.renderers?.shadow.setArenaMask(null);
    this.renderers?.beer.setArenaMask(null);
  }

  private redrawArenaClipMask(): void {
    // No-op under Phaser 4 WebGL.
  }

  private syncArenaMetrics(): void {
    applyArenaMetricsForMode(bridge.getGameMode(), bridge.getGamePhase());
    this.arenaBuilder?.syncStaticBackdrop(bridge.getGameMode(), bridge.getGamePhase());
    this.redrawArenaClipMask();
    this.physics.world.setBounds(ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT);
    this.cameras.main.setBounds(0, 0, Math.max(GAME_WIDTH, ARENA_MAX_X + ARENA_OFFSET_X), this.scale.height);
    this.ctx?.combatSystem.syncArenaBounds();
  }

  private syncMainCamera(delta: number, inArena: boolean): void {
    const camera = this.cameras.main;
    camera.scrollY = 0;

    if (!inArena || !usesDynamicCamera(bridge.getGameMode())) {
      this.lastCameraScrollX = 0;
      camera.scrollX = 0;
      return;
    }

    const localSprite = this.ctx.playerManager.getPlayer(bridge.getLocalPlayerId())?.sprite;
    if (!localSprite?.active || !this.localPlayerState.alive) {
      camera.scrollX = this.lastCameraScrollX;
      return;
    }

    const maxScrollX = Math.max(0, ARENA_MAX_X - (ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH));
    const focusScreenX = ARENA_OFFSET_X + ARENA_VIEWPORT_WIDTH * 0.5;
    const targetScrollX = Phaser.Math.Clamp(localSprite.x - focusScreenX, 0, maxScrollX);
    const followLerp = 1 - Math.exp(-delta / 120);
    camera.scrollX = Phaser.Math.Linear(camera.scrollX, targetScrollX, followLerp);
    this.lastCameraScrollX = camera.scrollX;
  }

  private getPointerWorldPoint(): Phaser.Math.Vector2 {
    const pointer = this.input.activePointer;
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }

  private syncWorldShadows(inArena: boolean): void {
    if (!inArena || !this.ctx.currentLayout || !this.ctx.arenaResult) {
      this.renderers.shadow.clear();
      return;
    }

    const trainState = this.renderers.train?.getShadowState()
      ?? (bridge.isHost()
        ? (this.ctx.trainManager?.getNetSnapshot() ?? null)
        : (bridge.getLatestGameState()?.train ?? null));

    this.renderers.shadow.syncDynamicShadows(
      this.ctx.playerManager.getAllPlayers(),
      this.ctx.projectileManager.getShadowSamples(),
      trainState,
    );
  }

  private describeSceneObjectBreakdown(): string {
    const counts = new Map<string, number>();
    let visibleCount = 0;
    let activeCount = 0;

    for (const child of this.children.list) {
      const gameObject = child as Phaser.GameObjects.GameObject & {
        visible?: boolean;
        active?: boolean;
        type?: string;
        texture?: { key?: string };
      };

      if (gameObject.visible !== false) visibleCount += 1;
      if (gameObject.active !== false) activeCount += 1;

      const baseType = gameObject.type || gameObject.constructor.name || 'Unknown';
      const textureKey = typeof gameObject.texture?.key === 'string' && gameObject.texture.key.length > 0
        ? gameObject.texture.key
        : null;
      const label = textureKey ? `${baseType}:${textureKey}` : baseType;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    const topEntries = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([label, count]) => `${label}:${count}`)
      .join(', ');

    return `visible=${visibleCount} active=${activeCount} top=${topEntries}`;
  }

  private initializeRoomQuality(): void {
    this.roomQualityMonitor.initialize(this.time.now);
    this.roomQualitySnapshot = this.roomQualityMonitor.getSnapshot();
  }

  private updateRoomQuality(now: number, players: PlayerProfile[]): void {
    this.roomQualitySnapshot = this.roomQualityMonitor.update(now, players);
  }

  private refreshStoredCoopDefenseProgress(): void {
    const stored = getStoredCoopDefenseProgress();
    this.coopDefenseProgress = getCoopDefenseProgressSnapshot(
      stored.totalXp,
      stored.profile,
      stored.completedBossMapIds.length,
    );
    this.coopDefenseLastProcessedRoundEndedAt = stored.lastProcessedRoundEndedAt;
    bridge.setLocalCoopDefenseTotalXp(this.coopDefenseProgress.totalXp);
    this.coopDefenseUpgradesOverlay?.refresh();
  }

  private processCoopDefenseRoundXp(enteredLobbyFromArena: boolean): void {
    if (!enteredLobbyFromArena || !isCoopDefenseMode(bridge.getGameMode())) return;

    const roundState = bridge.getRoundState();
    const results = bridge.getRoundResults();
    const endedAt = roundState?.endedAt ?? null;
    if (!endedAt || !results) return;

    if (this.coopDefenseLastProcessedRoundEndedAt !== null && this.coopDefenseLastProcessedRoundEndedAt >= endedAt) {
      return;
    }

    const sharedRoundXp = Math.max(
      0,
      Math.floor(
        results.find((result) => typeof result.sharedXp === 'number')?.sharedXp
          ?? bridge.getCoopDefenseRoundXp(),
      ),
    );
    if (sharedRoundXp > 0) {
      addStoredCoopDefenseXp(sharedRoundXp);
    }
    const completedMapId = roundState?.coopDefenseMapId;
    if (
      roundState?.status === 'victory'
      && completedMapId
      && getCoopDefenseMapConfig(completedMapId).boss
    ) {
      markStoredCoopDefenseBossMapCompleted(completedMapId);
    }
    markStoredCoopDefenseRoundProcessed(endedAt);
    this.refreshStoredCoopDefenseProgress();
  }
}
