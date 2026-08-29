/**
 * NetworkBridge – die Grenze zwischen Spiellogik und Netzwerk.
 * Kapselt alle Netzwerkoperationen hinter einer spiellogik-agnostischen API.
 *
 * Nutzung:
 *   1. NetworkBridge.connect() einmalig im Boot aufrufen (erzeugt/betritt den Raum)
 *   2. bridge.onPlayerJoin() / onPlayerQuit() beliebig oft registrieren
 *   3. bridge.activate() einmalig in main.ts aufrufen
 *   4. In der ArenaScene: bridge.clearPlayerCallbacks() aufrufen,
 *      dann neue join/quit-Callbacks registrieren
 *
 * Der Transport liegt darunter in `src/network/peer/`: direkte WebRTC-Verbindungen
 * zwischen Client und Host, PeerJS ausschließlich als Signaling-Broker.
 */
import { isActivityOfWorld, parseActivityDescriptor, type ActivityDescriptor } from '../world/ActivityDescriptor';
import { resolveActiveGameMode } from '../world/arenaDescriptorAdapter';
import {
  normalizeWorldLoadProgress,
  parseWorldLoadReadyState,
  type WorldLoadReadyState,
  type WorldLoadStage,
} from '../world/WorldLoadReady';
import { parseWorldDescriptor, type WorldDescriptor } from '../world/WorldDescriptor';
import {
  encodeWorldParticipationState,
  listWorldParticipants,
  maySendWorldInput,
  parseWorldParticipationState,
  readWorldParticipation,
  type WorldParticipation,
  type WorldParticipationState,
} from '../world/WorldParticipation';
import { isCurrentWorldRevision } from '../world/WorldRevision';
import {
  createHostSession,
  joinHostSession,
  getActiveSession,
  leaveActiveSession,
  requireRoom,
  TransportDiagnostics,
  createPeerNetworkError,
  type LinkDiagnostics,
  type PeerPlayerHandle,
  type PeerReconnectStatus,
  type PeerPayloadDiagnostics,
} from './peer';
import { getOrCreateRoomResumeToken, readRoomCodeFromUrl } from '../utils/roomQuality';
import type { BurrowPhase, CaptureTheBeerFxEvent, CoopDefenseEncounterPresentationState, CoopDefenseMapEventPresentationState, CoopDefenseMapEventLifecycleState, CoopDefenseMapEventType, CoopDefenseMissionProgressPresentationState, CoopDefenseSecondaryObjectivePresentationState, CoopDefenseRespawnBudgetPlayerState, CoopDefenseRespawnBudgetState, ExplosionVisualStyle, FireChunkTarget, GameMode, GroundFireVisualStyle, HostHeldActionKind, HitscanImpactKind, HitscanVisualPreset, LoadoutCommitSnapshot, LoadoutSlot, LoadoutToolRef, LoadoutUseParams, LoadoutUseResult, LobbyLoadoutPreviewState, PlacementPreviewNetState, PlayerInput, PlayerProfile, PlayerNetState, RoomQualitySnapshot, RoundParticipationState, ShieldBuffHudState, ShotAudioKey, SlimeBloomTarget, SpawnFront, SyncedActiveHudBuff, SyncedAirstrikeStrike, SyncedBaseState, SyncedBurningGroundSnapshot, SyncedCaptureTheBeerState, SyncedCoopDefenseCarryState, SyncedCombatEffect, SyncedDecoy, SyncedEnergyInjectorEffect, SyncedEnergyInjectorFocus, SyncedEnergyShield, SyncedEnemySnapshot, SyncedFireZone, SyncedGuardianSpirit, SyncedHitscanTrace, SyncedMeleeSwing, SyncedMeteorStrike, SyncedNukeStrike, SyncedPlaceableRock, SyncedPowerUp, SyncedPowerUpPedestal, SyncedPowerUpPedestalSnapshot, SyncedPowerUpSnapshot, SyncedProjectile, SyncedProjectileSnapshot, SyncedProjectileStatic, SyncedRemoteControlTurret, SyncedRepairDrone, SyncedReinforcementMatrix, SyncedRockSnapshot, SyncedSlimeTrailSnapshot, SyncedSmokeCloud, SyncedStinkCloud, SyncedTeslaDome, SyncedTimeBubble, SyncedTargetVulnerability, SyncedTrainState, SyncedTunnel, TeamId, TrainEventConfig, GamePhase, RockNetState } from '../types';
import { DEFAULT_SPAWN_FRONT, isSpawnFront } from '../utils/spawnFront';
import {
  clonePersistentPlayerBaseContribution,
  sanitizePersistentPlayerBaseContribution,
  type PersistentPlayerBaseContribution,
} from '../persistentBase/PersistentBaseTypes';
import {
  clonePersistentBaseRewardGrant,
  sanitizePersistentBaseRewardGrantIds,
  sanitizePersistentBaseRewardGrant,
  clonePersistentBaseRewardSessionState,
  sanitizePersistentBaseRewardPlacementRequest,
  sanitizePersistentBaseRewardSessionState,
  type PersistentBaseRewardGrant,
  type PersistentBaseRewardId,
  type PersistentBaseRewardPlacementRequest,
  type PersistentBaseRewardSessionState,
} from '../persistentBase/PersistentBaseRewardTypes';
import type { SyncedAk47StrategicTarget } from '../types';
import {
  NET_TICK_RATE_HZ,
  NET_DEBUG_PROJECTILE_SYNC_METRICS,
  NET_DEBUG_PROJECTILE_SYNC_METRICS_WINDOW_MS,
  COOP_DEFENSE_BASE_TURRET_OWNER_ID,
  TEAM_BLUE_COLOR,
  TEAM_RED_COLOR,
  ARENA_COUNTDOWN_SEC,
} from '../config';
import { KEY_FAST_PING_PROBE, NetworkPingController } from './NetworkPingController';
import { isCompleteGameStatePayload } from './FullGameStateBootstrap';
import { decodePlayerStates, encodePlayerStates } from './playerStateCodec';
import {
  EMPTY_FULL_PROJECTILE_SNAPSHOT,
  applyProjectileSnapshot,
  countProjectileDynamics,
} from './projectileSnapshotCodec';
import { sanitizePlayerName } from '../utils/playerName';
import { COOP_DEFENSE_MODE, getMinPlayersForMode, hasTeamSelection, isCoopDefenseMode, isTeamGameMode, usesTeamColors } from '../gameModes';
import { canJoinLobbyTeam, LOBBY_TEAM_CAPACITY, pickAutomaticTeam } from '../lobby/LobbyRosterLayout';
import { isCommittedLoadoutEqual, isCoopDefenseReadyLoadoutComplete, resolveLoadoutSelectionIds, sanitizeCommittedLoadoutForMode } from '../loadout/LoadoutRules';
import { DEFAULT_LOADOUT, getUtilityBaseId, ULTIMATE_CONFIGS, UTILITY_CONFIGS, WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { HeldItemSlot } from '../loadout/HeldItemSlotTracker';
import { DEFAULT_COOP_DEFENSE_MAP_ID, getCoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { getWorldDefinition } from '../config/authoring/authoredScenarios';
import { COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS, normalizeConstructionId } from '../config/coopDefenseConstructions';
import { getCoopDefenseLevelForXp } from '../utils/coopDefenseProgression';
import { sanitizeCoopDefenseUpgradeProfile } from '../utils/coopDefenseUpgrades';
import { sanitizeCoopDefenseEquippedItems } from '../utils/coopDefenseItems';
import { DEFAULT_TIME_OF_DAY_MINUTES, normalizeTimeOfDay } from '../effects/TimeOfDay';
import { isCoopDefenseClassId } from '../config/coopDefenseClasses';
import type { UtilityOverrideDescriptor } from '../types';
import {
  canRoundPlayerReceiveRewards,
  canRoundPlayerSpawnOrRespawn,
  createRoundParticipationState,
  enterRoundSpectator,
  getRoundPlayerRole,
  getRoundResultEligibleIds,
  markRoundLateJoiner,
} from '../scenes/arena/RoundParticipationPolicy';
import {
  RoomStatisticsLedger,
  ROOM_STATISTICS_COUNTERS,
  type RoomPlayerStatistics,
  type RoomStatisticsCounter,
} from './RoomStatistics';

export type { RoomPlayerStatistics } from './RoomStatistics';

/**
 * Zustandsobjekt eines Spielers. Absichtlich schmal: nur `id`, `getState` und `setState`
 * werden im Projekt gebraucht, deshalb ist der Handle des Substrats direkt der Typ.
 */
type PlayerState = PeerPlayerHandle;

// ── Substrat-Zugriff ─────────────────────────────────────────────────────────
// Diese Helfer entsprechen 1:1 den globalen Zustandsfunktionen der frueheren Bibliothek und
// halten den Rest der Datei frei von Transportdetails.

function isHost(): boolean {
  return requireRoom().isHost();
}

function myPlayer(): PlayerState {
  const room = requireRoom();
  const handle = room.getPlayerHandle(room.getLocalPlayerId());
  if (!handle && room.isKicked()) {
    // Ein Kick entfernt den lokalen Handle absichtlich aus dem Roster. Die Scene laeuft aber
    // noch bis zur Navigation weiter und fragt in dieser Zeit Ping-/Lobbydaten ab. Dieser
    // terminale Fallback bewahrt die bestehende API, ohne erneut Zustand zu senden.
    return {
      id: room.getLocalPlayerId(),
      getState: () => undefined,
      setState: () => undefined,
      onQuit: () => undefined,
    };
  }
  if (!handle) throw new Error('Lokaler Spieler ist im Raum nicht registriert.');
  return handle;
}

function setState(key: string, value: unknown, reliable = false): void {
  requireRoom().setGlobal(key, value, reliable);
}

function getState(key: string): unknown {
  return requireRoom().getGlobal(key);
}

// ── Interne State-Keys – nie nach außen exportiert ───────────────────────────
const KEY_INPUT        = 'inp';
const KEY_PLACEMENT_PREVIEW = 'ppv';
const KEY_PLAYERS      = 'plr';
const KEY_READY        = 'isr';   // per-player boolean: isReady
const KEY_WORLD_LOAD_READY = 'wlr'; // per-player reliable: WorldLoadReadyState
const KEY_NAME         = 'pnm';   // per-player string: selbst gesetzter Anzeigename
const KEY_GAME_PHASE   = 'gph';   // global: 'LOBBY' | 'ARENA'
const KEY_GAME_MODE    = 'gmd';   // global: 'deathmatch' | 'team_deathmatch' | 'capture_the_beer'
const KEY_COOP_MAP_ID  = 'cmd';   // global: string (ausgewaehlte Coop-Defense-Map)
const KEY_TIME_OF_DAY  = 'tod';   // global reliable: number (Lobby-Uhrzeit in Minuten seit Mitternacht)
const KEY_ARENA_START  = 'ast';   // global: number (timestamp ms ab dem Input/Game freigegeben wird)
const KEY_ROUND_END    = 'ret';   // global: number (timestamp ms)
const KEY_HOST_ID      = 'hid';   // global: string (Player-ID des Match-Hosts)
const KEY_WORLD_DESCRIPTOR = 'wld'; // global reliable: WorldDescriptor | null (der eine World-Kanal)
const KEY_ACTIVITY_DESCRIPTOR = 'act'; // global reliable: ActivityDescriptor | null
const KEY_WORLD_PARTICIPATION = 'wpp'; // global reliable: WorldParticipationState | null (world-scoped)
const KEY_ROCK_HP      = 'rck';   // global: RockNetState[] (unreliable, Delta-Snapshot)
const KEY_AVAIL_COLORS = 'avc';   // global: number[] (verfügbarer Farbpool, reliable)
const KEY_PLAYER_COLOR = 'clr';   // per-player: number (benutzerdefinierte Spielerfarbe)
const KEY_PLAYER_TEAM  = 'ptm';   // per-player: 'blue' | 'red' (gemerkte TDM-Teamwahl)
const KEY_LOADOUT_W1   = 'lw1';   // per-player: string (weapon1 item ID)
const KEY_LOADOUT_W2   = 'lw2';   // per-player: string (weapon2 item ID)
const KEY_LOADOUT_UT   = 'lut';   // per-player: string (utility item ID)
const KEY_LOADOUT_UL   = 'lul';   // per-player: string (ultimate item ID)
const KEY_LOADOUT_COMMITTED = 'lcm'; // per-player: verbindlicher LoadoutCommitSnapshot fuer Ready-Spieler
const KEY_LOBBY_LOADOUT_PREVIEW = 'llp'; // per-player: laufender Live-Build {c: classId, p: profile, i: items, t: tool refs}
const KEY_UTILITY_CD_UNTIL = 'ucd'; // per-player: Record<utilityId, number> (legacy number wird als __default__ gelesen)
const KEY_HELD_SLOT    = 'hld';   // per-player: HeldItemSlot (welches Item die Figur sichtbar traegt)
const KEY_UTILITY_OVERRIDE_ID = 'uon'; // per-player: string (stable utility ID, empty = no override)
const KEY_UTILITY_OVERRIDE_DESCRIPTOR = 'uod'; // per-player: mission override metadata or null
const KEY_ADR_SYRINGE  = 'asr';   // per-player: boolean (Adrenalinspritze aktiv, regen multiplier > 1)
const KEY_ACTIVE_BUFFS = 'abf';   // per-player: {defId,remainingFrac}[] (aktive Buffs für HUD)
const KEY_SHIELD_BUFF  = 'sbf';   // per-player: ShieldBuffHudState (HUD-State des Energie-Schild-Buffs)
const KEY_FRAGS        = 'frg';   // per-player: number (Frag-Zähler)
const KEY_ROOM_STATS   = 'rst';   // global reliable: kompakter, kumulierter Raum-Statistik-Snapshot
const KEY_COOP_ROUND_XP = 'crx';  // global: number (gemeinsame, matchweite Coop-Defense-XP)
const KEY_COOP_XP      = 'cxp';   // per-player: number (lokal persistierte Coop-Defense-XP fuer Lobby-Anzeige)
const KEY_ROUND_RESULTS = 'rrs'; // global reliable: RoundResult[] (Rundenabschluss-Snapshot)
const KEY_ROUND_STATE  = 'rds';   // global reliable: RoundState | null (aktueller/finaler Rundenstatus)
const KEY_ROUND_PARTICIPATION = 'rpt'; // global reliable: RoundParticipationState | null
const KEY_COOP_RESPAWN_BUDGET = 'crb'; // global reliable: CoopDefenseRespawnBudgetState | null
const KEY_COOP_ENCOUNTER_PRESENTATION = 'cep'; // global reliable: CoopDefenseEncounterPresentationState | null
const KEY_COOP_MAP_EVENT_PRESENTATION = 'cme'; // global reliable: CoopDefenseMapEventPresentationState | null
const KEY_COOP_SECONDARY_OBJECTIVE_PRESENTATION = 'cso'; // global reliable: Objective-Presentationseinträge | null
const KEY_COOP_MISSION_PROGRESS_PRESENTATION = 'cmp'; // global reliable: route/checkpoint snapshot | null
const MAX_COOP_MAP_EVENT_PRESENTATION_ENTRIES = 64;
const MAX_COOP_SECONDARY_OBJECTIVE_PRESENTATION_ENTRIES = 32;
// KEY_HITSCAN_TRACES und KEY_MELEE_SWINGS entfernt – werden jetzt per RPC gesendet
const KEY_SMOKE_CLOUDS   = 'smk'; // global: SyncedSmokeCloud[] (unreliable, host-authoritative Sichtbehinderung)
const KEY_FIRE_ZONES     = 'fzn'; // global: SyncedFireZone[]   (unreliable, host-authoritative Feuerzonen)
const KEY_POWERUPS       = 'pup'; // global: SyncedPowerUp[]    (unreliable, host-authoritative Power-Ups auf dem Boden)
const KEY_NUKE_STRIKES   = 'nks'; // global: SyncedNukeStrike[]      (unreliable, host-authoritative aktive Nukes)
const KEY_AIR_STRIKES    = 'ask'; // global: SyncedAirstrikeStrike[] (unreliable, host-authoritative Luftangriffe)
const KEY_TRAIN_EVENT    = 'tev'; // global: TrainEventConfig|null (reliable, pro Einfahrt aktualisiert)
const KEY_TRAIN_STATE    = 'trs'; // global: SyncedTrainState   (unreliable, per-frame Zug-Snapshot)
const KEY_PING           = 'png'; // per-player: number (Roundtrip-Zeit in ms, unreliable)
const KEY_GAME_STATE     = 'gs';  // global: komprimierter Game State (unreliable, single setState)
const KEY_GAME_STATE_INITIAL = 'gsi'; // global reliable: vollstaendiger Bootstrap-Snapshot der laufenden Runde
const KEY_ROOM_QUALITY   = 'rql'; // global reliable: aktuelle Lobby-Raumqualitaet fuer Startschutz/Retry-UX
const KEY_LOBBY_SYNC     = 'lsy'; // global reliable: host-autoritativer Lobby-Snapshot {m:mode, c:mapId, p:playerIds} für den Bereit-Konsistenz-Check
const KEY_PB_CONTRIBUTION = 'pbo'; // per-player reliable: angebotener PersistentPlayerBaseContribution
const KEY_PB_CONFIRMED   = 'pbk'; // per-player reliable: host-bestaetigter Beitrag nach einem Sieg
const KEY_PB_REWARD_GRANT = 'pbr'; // per-player reliable: host-bestaetigte kumulative Reward-IDs
const KEY_PB_REWARD_SESSION = 'pbrs'; // global reliable: host-autoritativer Placement-Vollzustand

export interface NetworkPingSample {
  m: number;
  s: number;
}

export type KickPlayerFailure = 'host-only' | 'lobby-only' | 'self' | 'unknown-player' | 'not-connected';
export type KickPlayerResult = { ok: true } | { ok: false; reason: KickPlayerFailure };

/**
 * Per-Spieler-Keys, die ausschliesslich der Host liest. Der Host reicht sie nicht an die
 * uebrigen Clients weiter, was bei voller Lobby den Grossteil des Relay-Verkehrs spart.
 *
 * KEY_INPUT wird ausschließlich vom Host gelesen. Die visuelle Platzierungsvorschau nutzt
 * den separaten, relaybaren KEY_PLACEMENT_PREVIEW.
 */
const HOST_ONLY_PLAYER_KEYS: readonly string[] = [KEY_FAST_PING_PROBE, KEY_INPUT];
const WELCOME_EXCLUDED_PLAYER_KEYS: readonly string[] = [KEY_INPUT, KEY_PLACEMENT_PREVIEW];
const CLIENT_OWNED_PLAYER_KEYS: readonly string[] = [KEY_PLACEMENT_PREVIEW];

// ── Öffentliche Typen ─────────────────────────────────────────────────────────

/** Kill-Ereignis für den Killfeed (Host → Alle per RPC) */
export interface KillEvent {
  killerId:    string;
  killerName:  string;
  killerColor: number;
  sourceId:    string;
  victimId:    string;
  victimName:  string;
  victimColor: number;
}

/** Rundenabschluss-Snapshot eines Spielers */
export interface RoundResult {
  id:       string;
  name:     string;
  colorHex: number;
  frags:    number;
  teamId:   TeamId | null;
  /** Gemeinsame Match-Metadaten; pro Zeile wiederholt, damit Ergebnis und Kontext atomar replizieren. */
  roundEndedAt: number;
  gameMode: GameMode;
  mapName: string;
  teamScore?: number;
  sharedXp?: number;
  /** Gemeinsame, autoritative B8-Epic-Garantie; pro berechtigter Zeile wiederholt. */
  epicGuaranteeCount?: number;
}

export type RoundOutcome = 'victory' | 'defeat';

/**
 * Wie eine Runde geendet hat. `aborted` ist der host-seitige Abbruch über das Optionsmenü und
 * damit kein Spielausgang: Er zählt weder als Sieg noch als Niederlage, beendet die Runde aber
 * in jedem Modus regulär (inklusive Endstand und – im Coop – der bis dahin erspielten XP).
 */
export type RoundConclusion = RoundOutcome | 'aborted';

export interface RoundState {
  status: 'active' | RoundConclusion;
  roundStartTime: number;
  // Autoritative Uhrzeit dieser Runde. Coop Defense nutzt weiterhin die Map-Vorgabe;
  // alle anderen Modi uebernehmen die Host-Auswahl aus der Lobby.
  timeOfDayMinutes?: number;
  /** Einmaliger reliable Anker des tatsaechlich erfolgreichen Coop-Boss-Spawns. */
  coopDefenseBossSpawnedAtMs?: number;
  coopDefenseHumanPlayerCount?: number;
  // Historischer Ergebnis-/Round-Snapshot. Der aktive World-Aufbau liest die Map aus dem
  // WorldDescriptor; dieses Feld bleibt nur fuer Ergebnisdarstellung und Unlock-Auswertung.
  coopDefenseMapId?: string;
  /** Spieler, die beim Abschluss fuer Ergebnisse/Belohnungen qualifiziert waren. */
  resultEligiblePlayerIds?: string[];
  endedAt?: number;
}

export interface GameState {
  /** World-Instanz, zu der dieser Snapshot gehoert. */
  worldRevision: number;
  roundStartTime: number;
  players:      Record<string, PlayerNetState>;
  projectiles:  SyncedProjectile[];
  rockRemovals: number[];
  enemies:      SyncedEnemySnapshot | null;
  rocks:        RockNetState[];   // Delta: nur beschädigte Felsen (abwesend = voll HP)
  placeableRocks: SyncedPlaceableRock[];
  reinforcementMatrices: SyncedReinforcementMatrix[];
  energyInjectorEffects: SyncedEnergyInjectorEffect[];
  energyInjectorFocus: SyncedEnergyInjectorFocus[];
  remoteControlTurrets: SyncedRemoteControlTurret[];
  decoys:       SyncedDecoy[];
  smokes:       SyncedSmokeCloud[];
  fires:        SyncedFireZone[];
  powerups:     SyncedPowerUp[];  // Power-Ups auf dem Boden
  pedestals:    SyncedPowerUpPedestal[]; // feste Power-Up-Podeste
  nukes:        SyncedNukeStrike[];
  airstrikes:   SyncedAirstrikeStrike[];  // Luftangriff-Strikes (Warn- + Einschlagsphase)
  meteors:      SyncedMeteorStrike[];     // Armageddon-Meteore (Warn- + Einschlagsphase)
  tunnels:      SyncedTunnel[];
  train:        SyncedTrainState | null;  // aktueller Zug-Zustand (null = kein Zug aktiv)
  bases:        SyncedBaseState[];        // Coop-Basen: beschädigte Basen plus Zielwinkel aktiver Basistürme
  captureTheBeer: SyncedCaptureTheBeerState | null;
  coopDefenseCarry: SyncedCoopDefenseCarryState;
  stinkClouds:  SyncedStinkCloud[];      // Stinkdrüsen-Gaswolken (spieler-folgend)
  timeBubbles:  SyncedTimeBubble[];
  teslaDomes:   SyncedTeslaDome[];
  energyShields: SyncedEnergyShield[];
  guardianSpirits: SyncedGuardianSpirit[];
  repairDrones: SyncedRepairDrone[];
  slimeTrail: SyncedSlimeTrailSnapshot;
  targetVulnerabilities: SyncedTargetVulnerability[];
  ak47StrategicTargets: SyncedAk47StrategicTarget[];
  burningGround: SyncedBurningGroundSnapshot;
  // Hitscan-Traces und Melee-Swings werden per RPC gesendet (nicht mehr Teil des GameState)
}

interface OutboundGameState {
  /** Optionaler Test-/Host-Anker; die Bridge schreibt immer die aktuelle World-Revision. */
  worldRevision?: number;
  roundStartTime: number;
  players:      Record<string, PlayerNetState>;
  projectiles:  SyncedProjectileSnapshot | null;
  enemies:      SyncedEnemySnapshot | null;
  rocks:        SyncedRockSnapshot | null;
  placeableRocks: SyncedPlaceableRock[];
  reinforcementMatrices: SyncedReinforcementMatrix[];
  energyInjectorEffects: SyncedEnergyInjectorEffect[];
  energyInjectorFocus: SyncedEnergyInjectorFocus[];
  remoteControlTurrets: SyncedRemoteControlTurret[];
  decoys:       SyncedDecoy[];
  smokes:       SyncedSmokeCloud[];
  fires:        SyncedFireZone[];
  powerups:     SyncedPowerUpSnapshot | null;
  pedestals:    SyncedPowerUpPedestalSnapshot | null;
  nukes:        SyncedNukeStrike[];
  airstrikes:   SyncedAirstrikeStrike[];
  meteors:      SyncedMeteorStrike[];
  tunnels:      SyncedTunnel[];
  train:        SyncedTrainState | null;
  bases:        SyncedBaseState[];
  captureTheBeer: SyncedCaptureTheBeerState | null;
  coopDefenseCarry: SyncedCoopDefenseCarryState;
  stinkClouds:  SyncedStinkCloud[];
  timeBubbles:  SyncedTimeBubble[];
  teslaDomes:   SyncedTeslaDome[];
  energyShields: SyncedEnergyShield[];
  guardianSpirits: SyncedGuardianSpirit[];
  repairDrones: SyncedRepairDrone[];
  slimeTrail: SyncedSlimeTrailSnapshot;
  targetVulnerabilities: SyncedTargetVulnerability[];
  ak47StrategicTargets: SyncedAk47StrategicTarget[];
  burningGround: SyncedBurningGroundSnapshot;
}

type EncodedSlimeTrailSnapshot = [
  Array<[number, number, number, number, number]>,
  Array<[string, number, number, number]>,
];

function encodeSlimeTrailSnapshot(snapshot: SyncedSlimeTrailSnapshot): EncodedSlimeTrailSnapshot {
  return [
    snapshot.cells.map(cell => [cell.id, cell.x, cell.y, cell.size, cell.alpha]),
    snapshot.affectedEnemies.map(enemy => [enemy.enemyId, enemy.x, enemy.y, enemy.alpha]),
  ];
}

function decodeSlimeTrailSnapshot(raw: unknown): SyncedSlimeTrailSnapshot {
  if (!Array.isArray(raw)) return { cells: [], affectedEnemies: [] };
  const encoded = raw as EncodedSlimeTrailSnapshot;
  return {
    cells: (encoded[0] ?? []).map(([id, x, y, size, alpha]) => ({ id, x, y, size, alpha })),
    affectedEnemies: (encoded[1] ?? []).map(([enemyId, x, y, alpha]) => ({ enemyId, x, y, alpha })),
  };
}

type EncodedTargetVulnerability = [string, string, number];

function encodeTargetVulnerabilities(entries: readonly SyncedTargetVulnerability[]): EncodedTargetVulnerability[] {
  return entries.map(entry => [entry.targetType, entry.targetId, entry.expiresAt]);
}

function decodeTargetVulnerabilities(raw: unknown): SyncedTargetVulnerability[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).flatMap((entry) => {
    if (!Array.isArray(entry)) return [];
    // Alte Snapshots enthielten nur [enemyId, expiresAt]. Sie bleiben als Gegnerstatus lesbar.
    if (entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
      return [{ targetType: 'enemy' as const, targetId: entry[0], expiresAt: entry[1] }];
    }
    if (entry.length !== 3 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' || typeof entry[2] !== 'number') return [];
    return [{ targetType: entry[0] as SyncedTargetVulnerability['targetType'], targetId: entry[1], expiresAt: entry[2] }];
  });
}

type EncodedBurningGroundCell = [number, number, number, number, number, number];
interface EncodedBurningGroundDelta {
  f?: EncodedBurningGroundCell[];
  u?: EncodedBurningGroundCell[];
  r?: number[];
}

function encodeBurningGroundCell(cell: SyncedBurningGroundSnapshot['cells'][number]): EncodedBurningGroundCell {
  return [cell.id, cell.gridX, cell.gridY, cell.expiresAt, cell.intensity, cell.visualStyle === 'void' ? 1 : 0];
}

function decodeBurningGroundCell([id, gridX, gridY, expiresAt, intensity, visualStyle]: EncodedBurningGroundCell) {
  return {
    id,
    gridX,
    gridY,
    expiresAt,
    intensity: Math.max(1, intensity ?? 1),
    visualStyle: visualStyle === 1 ? 'void' as const : 'normal' as const,
  };
}

type LoadoutUseHandler = (
  slot: LoadoutSlot,
  angle: number,
  targetX: number,
  targetY: number,
  senderId: string,
  shotId?: number,
  params?: LoadoutUseParams,
  clientX?: number,
  clientY?: number,
  clientNow?: number,
) => LoadoutUseResult;

type PersistentBaseRewardPlacementHandler = (
  playerId: string,
  request: PersistentBaseRewardPlacementRequest,
) => LoadoutUseResult;

interface Weapon2PredictionState {
  nextContiguousAck: number;
  completedPredictionIds: Set<number>;
  finalResults: Map<number, LoadoutUseResult>;
}

type ExplosionEffectHandler = (x: number, y: number, radius: number, color?: number, visualStyle?: ExplosionVisualStyle) => void;
type SlimeBloomEffectHandler = (x: number, y: number, targets: readonly SlimeBloomTarget[]) => void;
/** `lifetimeMs <= 0` bedeutet: Leiche verbraucht, Marker sofort entfernen. */
type CorpseMarkerHandler = (
  corpseId: number,
  x: number,
  y: number,
  enemySize: number,
  lifetimeMs: number,
) => void;
type FireChunkEffectHandler = (
  x: number,
  y: number,
  targets: readonly FireChunkTarget[],
  landsAt: number,
  visualStyle: GroundFireVisualStyle,
) => void;
type BlackHoleEffectHandler = (x: number, y: number, radius: number, durationMs: number) => void;
type MiniRocketCollectionEffectHandler = (x: number, y: number, color: number) => void;
type MiniRocketDestructionEffectHandler = (x: number, y: number, color: number) => void;
type GrenadeCountdownHandler = (x: number, y: number, value: number) => void;
type EffectHandler = (effect: SyncedCombatEffect) => void;
type HitscanTracerHandler = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: number,
  thickness: number,
  impactKind?: HitscanImpactKind,
  visualPreset?: HitscanVisualPreset,
  shooterId?: string,
  shotId?: number,
  shotAudioKey?: ShotAudioKey,
  visualStartX?: number,
  visualStartY?: number,
) => void;
type DashHandler = (playerId: string, dx: number, dy: number) => void;
type BurrowHandler = (playerId: string, wantsBurrowed: boolean) => void;
type ShockwaveEffectHandler = (x: number, y: number) => void;
type TrainBurrowSparksHandler = (x: number, y: number) => void;
type BurrowVisualHandler = (playerId: string, phase: BurrowPhase) => void;
type ColorRequestHandler = (requestedColor: number, requesterId: string) => void;
type ColorAcceptedHandler = (requesterId: string, color: number) => void;
type ColorDeniedHandler = (requesterId: string) => void;
type ColorChangeHandler = (playerId: string, color: number) => void;
type KillEventHandler = (event: KillEvent) => void;
type CoopDefenseXpPopupHandler = (x: number, y: number, xp: number) => void;
type MeleeSwingHandler = (swing: SyncedMeleeSwing) => void;
type PowerUpPickupHandler = (uid: number, playerId: string) => boolean;
type DecoyStealthBreakHandler = (playerId: string) => void;
type TrainDestroyedHandler = () => void;
type TranslocatorFlashHandler = (
  x: number,
  y: number,
  color: number,
  type: 'start' | 'end',
  subjectId?: string,
) => void;
type CaptureTheBeerFxHandler = (event: CaptureTheBeerFxEvent) => void;
type CoopDefenseCarryDeliveredFxHandler = (x: number, y: number) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

/** Farbe eines Spielers, solange der Host ihm noch keine aus dem Pool zugewiesen hat. */
const DEFAULT_PLAYER_COLOR = 0xffffff;

/** Platzhaltername, bis der Spieler seinen eigenen Namen setzt. */
function defaultPlayerName(playerId: string): string {
  return `Dachs ${playerId.toUpperCase()}`;
}

/** Spaetestens nach dieser Zeit wird die Eingabe auch unveraendert erneut gesendet. */
const NET_INPUT_KEEPALIVE_MS = 100;
const NET_PLACEMENT_PREVIEW_REFRESH_MS = 150;
const NET_PLACEMENT_PREVIEW_TTL_MS = 600;

function isSamePlacementPreview(
  left: PlacementPreviewNetState | null,
  right: PlacementPreviewNetState | null,
): boolean {
  if (!left || !right) return !left && !right;
  return left.active === right.active
    && left.worldRevision === right.worldRevision
    && left.kind === right.kind
    && left.gridX === right.gridX
    && left.gridY === right.gridY
    && left.x === right.x
    && left.y === right.y
    && left.isValid === right.isValid
    && left.frame === right.frame
    && left.stage === right.stage
    && left.anchorGridX === right.anchorGridX
    && left.anchorGridY === right.anchorGridY
    && left.anchorX === right.anchorX
    && left.anchorY === right.anchorY
    && left.constructionId === right.constructionId
    && left.powerUpDefId === right.powerUpDefId;
}

function normalizePlacementPreview(preview: PlacementPreviewNetState | null): PlacementPreviewNetState | null {
  return preview?.active ? preview : null;
}

function isSamePlayerInput(input: PlayerInput, previous: PlayerInput | null): boolean {
  if (!previous) return false;
  return input.dx === previous.dx
    && input.dy === previous.dy
    && input.aim === previous.aim
    && input.dashHeld === previous.dashHeld
    && input.worldRevision === previous.worldRevision;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeMissionProgressPresentationState(
  raw: unknown,
): CoopDefenseMissionProgressPresentationState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = raw as Partial<CoopDefenseMissionProgressPresentationState>;
  if (!Number.isSafeInteger(state.roundRevision) || (state.roundRevision ?? 0) <= 0
    || !Number.isSafeInteger(state.missionRevision) || (state.missionRevision ?? -1) < 0
    || !Array.isArray(state.activatedCheckpoints) || state.activatedCheckpoints.length > 128
    || !Array.isArray(state.resolvedDefenses) || state.resolvedDefenses.length > 64
    || !Array.isArray(state.barriers) || state.barriers.length > 128
    || !isValidNullableMissionId(state.nextCheckpointId)
    || !isValidNullableMissionId(state.respawnCheckpointId)
    || !isValidNullableMissionId(state.routeLockDefenseId)
    || typeof state.routeComplete !== 'boolean') return null;

  const checkpointIds = new Set<string>();
  const activatedCheckpoints: CoopDefenseMissionProgressPresentationState['activatedCheckpoints'][number][] = [];
  for (const rawCheckpoint of state.activatedCheckpoints) {
    const checkpoint = rawCheckpoint as Partial<CoopDefenseMissionProgressPresentationState['activatedCheckpoints'][number]>;
    if (!isValidMissionId(checkpoint.checkpointId) || checkpointIds.has(checkpoint.checkpointId)
      || !isFiniteNumber(checkpoint.activatedAtRoundMs) || checkpoint.activatedAtRoundMs < 0) return null;
    checkpointIds.add(checkpoint.checkpointId);
    activatedCheckpoints.push({ checkpointId: checkpoint.checkpointId, activatedAtRoundMs: checkpoint.activatedAtRoundMs });
  }

  const defenseIds = new Set<string>();
  const resolvedDefenses: CoopDefenseMissionProgressPresentationState['resolvedDefenses'][number][] = [];
  for (const rawDefense of state.resolvedDefenses) {
    const defense = rawDefense as Partial<CoopDefenseMissionProgressPresentationState['resolvedDefenses'][number]>;
    if (!isValidMissionId(defense.defenseId) || defenseIds.has(defense.defenseId)
      || (defense.outcome !== 'completed' && defense.outcome !== 'failed')
      || !isFiniteNumber(defense.resolvedAtRoundMs) || defense.resolvedAtRoundMs < 0) return null;
    defenseIds.add(defense.defenseId);
    resolvedDefenses.push({
      defenseId: defense.defenseId,
      outcome: defense.outcome,
      resolvedAtRoundMs: defense.resolvedAtRoundMs,
    });
  }

  const barrierIds = new Set<string>();
  const barriers: CoopDefenseMissionProgressPresentationState['barriers'][number][] = [];
  for (const rawBarrier of state.barriers) {
    const barrier = rawBarrier as Partial<CoopDefenseMissionProgressPresentationState['barriers'][number]>;
    if (!isValidMissionId(barrier.barrierId) || barrierIds.has(barrier.barrierId)
      || typeof barrier.open !== 'boolean') return null;
    barrierIds.add(barrier.barrierId);
    barriers.push({ barrierId: barrier.barrierId, open: barrier.open });
  }

  return {
    roundRevision: state.roundRevision as number,
    missionRevision: state.missionRevision as number,
    activatedCheckpoints,
    nextCheckpointId: state.nextCheckpointId ?? null,
    respawnCheckpointId: state.respawnCheckpointId ?? null,
    routeLockDefenseId: state.routeLockDefenseId ?? null,
    resolvedDefenses,
    barriers,
    routeComplete: state.routeComplete,
  };
}

function isValidMissionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 96 && value.trim() === value;
}

function isValidNullableMissionId(value: unknown): value is string | null {
  return value === null || isValidMissionId(value);
}

const TEAM_IDS: readonly TeamId[] = ['blue', 'red'];
let networkPayloadDiagnosticsSink: ((info: PeerPayloadDiagnostics) => void) | null = null;

export class NetworkBridge {
  private playerStateMap   = new Map<string, PlayerState>();
  /** Host-only: lebt laenger als eine Runde und wird nur mit KEY_ROOM_STATS veroeffentlicht. */
  private readonly roomStatistics = new RoomStatisticsLedger();
  /**
   * Cache fuer {@link getPlayerCommittedLoadout}, geschluesselt auf die Referenz des rohen
   * Netzwerk-Zustands. Ein neuer Snapshot bringt ein neues Rohobjekt und invalidiert den
   * Eintrag damit von selbst.
   */
  private committedLoadoutCache = new Map<string, {
    raw: Partial<LoadoutCommitSnapshot> | null | undefined;
    value: LoadoutCommitSnapshot | null;
  }>();
  /**
   * Derselbe Referenz-Cache für {@link getCoopDefenseSecondaryObjectivePresentationState}. Der
   * Zustand wird pro Frame mehrfach gelesen – HUD, Weltmarkierung und das Dormanz-Gate jeder
   * noch schlafenden Basis –, ändert sich aber nur bei einem echten Host-Update.
   */
  private secondaryObjectivePresentationCache: {
    raw: unknown;
    value: CoopDefenseSecondaryObjectivePresentationState | null;
  } | null = null;
  private missionProgressPresentationCache: {
    raw: unknown;
    expectedRoundRevision: number | null;
    value: CoopDefenseMissionProgressPresentationState | null;
  } | null = null;
  /**
   * Reliable Map-Event-Snapshots werden vom HUD pro Frame gelesen. Der Transport behält bei
   * unverändertem Zustand dieselbe Raw-Referenz; deshalb wird die Fail-Closed-Sanitization nur
   * bei einem echten Snapshot-Wechsel erneut ausgeführt.
   */
  private mapEventPresentationCache: {
    raw: unknown;
    value: CoopDefenseMapEventPresentationState | null;
  } | null = null;
  private connectedPlayers = new Map<string, PlayerProfile>();
  private cachedConnectedPlayers: PlayerProfile[] = [];
  private connectedPlayersCacheDirty = true;
  private lastLocalWorldLoadStateKey: string | null = null;

  private joinCbs: Array<(profile: PlayerProfile) => void> = [];
  private quitCbs: Array<(id: string) => void>             = [];
  private spectatorEnteredCbs: Array<(id: string) => void> = [];

  private activated = false;
  private rpcDispatchersActive = false;
  private readonly registeredRpcTypes = new Map<string, 'host' | 'all'>();
  private knownPlayerColors: readonly number[] = [];
  private pingController: NetworkPingController;
  private hostRpcHandlers = new Map<string, (payload: unknown, caller: PlayerState) => Promise<unknown> | unknown>();
  private allRpcHandlers = new Map<string, (payload: unknown) => Promise<unknown> | unknown>();
  /** Host-only, feature-specific exactly-once state for predicted Weapon2 requests. */
  private readonly weapon2PredictionStates = new Map<number, Map<string, Weapon2PredictionState>>();

  private loadoutUseHandler: LoadoutUseHandler | null = null;
  private persistentBaseRewardPlacementHandler: PersistentBaseRewardPlacementHandler | null = null;
  private heldActionHandler: ((
    playerId: string,
    operation: 'start' | 'cancel',
    actionId: string,
    kind?: HostHeldActionKind,
    durationMs?: number,
    toolRef?: LoadoutToolRef,
  ) => boolean) | null = null;
  private explosionEffectHandler: ExplosionEffectHandler | null = null;
  private slimeBloomEffectHandler: SlimeBloomEffectHandler | null = null;
  private corpseMarkerHandler: CorpseMarkerHandler | null = null;
  private fireChunkEffectHandler: FireChunkEffectHandler | null = null;
  private blackHoleEffectHandler: BlackHoleEffectHandler | null = null;
  private miniRocketCollectionEffectHandler: MiniRocketCollectionEffectHandler | null = null;
  private miniRocketDestructionEffectHandler: MiniRocketDestructionEffectHandler | null = null;
  private grenadeCountdownHandler: GrenadeCountdownHandler | null = null;
  private effectHandler: EffectHandler | null = null;
  // Pro Frame gesammelte Treffer-/Todes-Effekte und XP-Popups (Host), gebündelt via flushEffects().
  private pendingEffects: SyncedCombatEffect[] = [];
  private pendingXpPopups: { x: number; y: number; xp: number }[] = [];
  private hitscanTracerHandler: HitscanTracerHandler | null = null;
  private dashHandler: DashHandler | null = null;
  private burrowHandler: BurrowHandler | null = null;
  private shockwaveEffectHandler: ShockwaveEffectHandler | null = null;
  private trainBurrowSparksHandler: TrainBurrowSparksHandler | null = null;
  private burrowVisualHandler: BurrowVisualHandler | null = null;
  private colorRequestHandler: ColorRequestHandler | null = null;
  private colorAcceptedHandler: ColorAcceptedHandler | null = null;
  private colorDeniedHandler: ColorDeniedHandler | null = null;
  private colorChangeHandler: ColorChangeHandler | null = null;
  private killEventHandler: KillEventHandler | null = null;
  private coopDefenseXpPopupHandler: CoopDefenseXpPopupHandler | null = null;
  private meleeSwingHandler: MeleeSwingHandler | null = null;
  private powerUpPickupHandler: PowerUpPickupHandler | null = null;
  private worldParticipationRequestHandler: ((playerId: string, join: boolean) => boolean) | null = null;
  private decoyStealthBreakHandler: DecoyStealthBreakHandler | null = null;
  private trainDestroyedHandler: TrainDestroyedHandler | null = null;
  private translocatorFlashHandler: TranslocatorFlashHandler | null = null;
  private captureTheBeerFxHandler: CaptureTheBeerFxHandler | null = null;
  private coopDefenseCarryDeliveredFxHandler: CoopDefenseCarryDeliveredFxHandler | null = null;
  private bfgLaserHandler: ((lines: { sx: number; sy: number; ex: number; ey: number }[], color: number, visualPreset?: HitscanVisualPreset, projectileId?: number) => void) | null = null;
  private diagnostics: TransportDiagnostics | null = null;
  private networkFailureCbs: Array<(message: string) => void> = [];
  private reconnectStatusCbs: Array<(status: PeerReconnectStatus) => void> = [];
  private kickedCbs: Array<() => void> = [];
  private lastSentInput: PlayerInput | null = null;
  private lastInputSentAtMs = 0;
  private lastSentPlacementPreview: PlacementPreviewNetState | null = null;
  private lastPlacementPreviewSentAtMs = 0;
  private lastObservedRttSampleCount = 0;
  private publishedPingSequence = 0;
  private fullGameStateRequested = false;

  constructor() {
    this.pingController = new NetworkPingController({
      isHost: () => isHost(),
      getLocalPlayerId: () => myPlayer().id,
      getLocalPlayer: () => myPlayer(),
      getPlayers: () => [...this.playerStateMap.values()],
    });

    this.registerHostRpcHandler('tmr', async (payload: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return false;
      const teamId = (payload as { teamId?: unknown } | null)?.teamId;
      if (teamId !== 'blue' && teamId !== 'red') return false;
      return this.hostHandleTeamRequest(teamId, caller.id);
    });

    this.registerHostRpcHandler('spt', (_payload: unknown, caller: PlayerState): boolean => {
      return this.hostEnterSpectator(caller.id);
    });

    this.registerHostRpcHandler('kck', (payload: unknown, caller: PlayerState): KickPlayerResult => {
      const targetId = (payload as { playerId?: unknown } | null)?.playerId;
      if (!isHost() || caller.id !== requireRoom().getHostPlayerId()) {
        return { ok: false, reason: 'host-only' };
      }
      if (this.getGamePhase() !== 'LOBBY') return { ok: false, reason: 'lobby-only' };
      if (typeof targetId !== 'string' || targetId.length === 0 || targetId === caller.id) {
        return { ok: false, reason: 'self' };
      }
      if (targetId === requireRoom().getHostPlayerId()) return { ok: false, reason: 'self' };
      if (!this.playerStateMap.has(targetId)) return { ok: false, reason: 'unknown-player' };
      if (!requireRoom().kickPlayer(targetId)) return { ok: false, reason: 'not-connected' };

      // Ein Kick invalidiert alle verbleibenden Ready-/Loadout-Commits, damit die Lobby nach
      // dem Rosterwechsel nicht mit einem veralteten vollständigen Ready-Satz startet.
      this.hostResetAllLobbyReady();
      this.hostPublishLobbySync();
      return { ok: true };
    });
  }

  // ── Verbindungsaufbau (einmalig vor activate()) ────────────────────────────

  /**
   * Eröffnet einen Raum oder tritt dem Raum aus dem URL-Hash bei.
   *
   * Die Adresszeile des Hosts bleibt bewusst ohne Raumcode: Er würde nach einem Reload sonst
   * versuchen, seinem eigenen, gerade beendeten Raum beizutreten. Ein Reload eröffnet beim
   * Host also einen neuen Raum, beim Client führt er zurück in denselben. Den Einladungslink
   * baut `buildRoomShareUrl()` aus dem Raumcode.
   *
   * Scheitert der Aufbau, wirft die Methode einen `PeerNetworkError` mit verständlicher
   * Meldung – es gibt bewusst keinen stillen Fallback auf einen anderen Transportweg.
   */
  static async connect(): Promise<void> {
    const roomCode = readRoomCodeFromUrl();
    const session = roomCode === null
      ? await createHostSession({
        hostOnlyPlayerKeys: HOST_ONLY_PLAYER_KEYS,
        welcomeExcludedPlayerKeys: WELCOME_EXCLUDED_PLAYER_KEYS,
        clientOwnedPlayerKeys: CLIENT_OWNED_PLAYER_KEYS,
        onPayloadDiagnostics: null,
      })
      : await joinHostSession(roomCode, {
        hostOnlyPlayerKeys: HOST_ONLY_PLAYER_KEYS,
        welcomeExcludedPlayerKeys: WELCOME_EXCLUDED_PLAYER_KEYS,
        clientOwnedPlayerKeys: CLIENT_OWNED_PLAYER_KEYS,
        resumeToken: getOrCreateRoomResumeToken(roomCode),
        onPayloadDiagnostics: null,
      });
    console.info(`[Netz] Raum ${session.roomCode} – Rolle ${session.room.isHost() ? 'Host' : 'Client'}`);
  }

  setPayloadDiagnosticsSink(sink: ((info: PeerPayloadDiagnostics) => void) | null): void {
    networkPayloadDiagnosticsSink = sink;
    getActiveSession()?.room.setPayloadDiagnosticsSink(sink);
  }

  /** Beendet den aktuellen Raum bewusst; ein Client kündigt das dem Host explizit an. */
  leaveRoom(): void {
    leaveActiveSession();
  }

  // ── Callbacks registrieren ─────────────────────────────────────────────────

  /**
   * Registriert einen Join-Callback.
   * Feuert sofort für alle bereits verbundenen Spieler (Replay),
   * damit Szenen, die nach dem ersten Join starten, alle Spieler sehen.
   */
  onPlayerJoin(cb: (profile: PlayerProfile) => void): void {
    this.joinCbs.push(cb);
    // Replay für bereits verbundene Spieler
    for (const profile of this.connectedPlayers.values()) {
      cb(profile);
    }
  }

  onPlayerQuit(cb: (id: string) => void): void {
    this.quitCbs.push(cb);
  }

  /** Wird auf dem Host unmittelbar nach dem autoritativen Rollenwechsel ausgelöst. */
  onSpectatorEntered(cb: (id: string) => void): void {
    this.spectatorEnteredCbs.push(cb);
  }

  /**
   * Löscht alle Join- und Quit-Callbacks.
   * Muss am Anfang von create() der ArenaScene aufgerufen werden,
   * bevor neue Callbacks registriert werden.
   */
  clearPlayerCallbacks(): void {
    this.joinCbs = [];
    this.quitCbs = [];
    this.spectatorEnteredCbs = [];
  }

  // ── Einmalige Aktivierung (in main.ts aufrufen) ────────────────────────────

  /**
   * Startet den Roster-Listener. Darf nur EINMAL aufgerufen werden (nach `connect()`).
   */
  activate(): void {
    if (this.activated) return;
    this.activated = true;

    this.rpcDispatchersActive = true;
    for (const [type, scope] of this.registeredRpcTypes) this.bindRpcDispatcher(type, scope);
    this.setupTransportDiagnostics();

    requireRoom().onReconnectStatus((status) => {
      if (status.state === 'resumed') {
        this.resetGameStateCache();
        this.lastObservedRttSampleCount = 0;
        this.lastSentInput = null;
        this.lastInputSentAtMs = 0;
        this.lastSentPlacementPreview = null;
        this.lastPlacementPreviewSentAtMs = 0;
        for (const state of this.playerStateMap.values()) {
          this.connectedPlayers.set(state.id, this.extractProfile(state));
        }
        this.connectedPlayersCacheDirty = true;
      }
      if (status.state === 'player-disconnected' && isHost()) {
        const previous = requireRoom().getPlayerState(status.playerId, KEY_INPUT) as PlayerInput | undefined;
        requireRoom().setPlayerState(status.playerId, KEY_PLACEMENT_PREVIEW, null, false);
        requireRoom().setPlayerState(status.playerId, KEY_INPUT, {
          dx: 0,
          dy: 0,
          aim: previous?.aim ?? 0,
          dashHeld: false,
        } satisfies PlayerInput, true);
      }
      for (const callback of this.reconnectStatusCbs) callback(status);
    });

    requireRoom().onKicked(() => {
      for (const callback of this.kickedCbs) callback();
    });

    requireRoom().onPlayerJoin((state: PlayerState) => {
      this.playerStateMap.set(state.id, state);
      this.connectedPlayersCacheDirty = true;
      if (isHost()) {
        this.hostEnsureTeamAssignment(state.id);
        this.hostInitializeRoomStatistics(state.id);
      }

      state.onQuit(() => {
        const hadColor = this.getPlayerColor(state.id) !== undefined;
        this.playerStateMap.delete(state.id);
        this.connectedPlayers.delete(state.id);
        this.connectedPlayersCacheDirty = true;
        this.pingController.removePlayer(state.id);
        this.clearWeapon2PredictionState(state.id);
        if (hadColor) this.reconcileColorPool();
        this.quitCbs.forEach(cb => cb(state.id));
        this.hostPublishLobbySync();
      });

      const profile = this.extractProfile(state);
      this.connectedPlayers.set(state.id, profile);
      if (isHost()) {
        this.hostInitializeRoomStatistics(state.id);
        this.hostPublishRoomStatistics();
      }
      if (isHost() && this.getGamePhase() === 'ARENA') {
        // Der Rosterbeitritt ist bereits bekannt, die Runde bleibt aber unveraendert: Der neue
        // Spieler bekommt nur die Spectator-Rolle und einen verlaesslichen Full-Snapshot.
        this.hostRegisterLateJoiner(state.id);
        this.requestFullGameState();
      }
      this.joinCbs.forEach(cb => cb(profile));
      this.hostPublishLobbySync();
    });
  }

  /**
   * Verschickt die im Frame gesammelten ersetzbaren Zustaende. Am Ende jedes Frames aufrufen,
   * damit Snapshots und Input noch im selben Frame rausgehen.
   */
  flushNetwork(): void {
    requireRoom().update();
  }

  /** Meldet den Abriss der Verbindung (Host weg, Broker weg, kein direkter Weg moeglich). */
  onNetworkFailure(callback: (message: string) => void): void {
    this.networkFailureCbs.push(callback);
  }

  onReconnectStatus(callback: (status: PeerReconnectStatus) => void): () => void {
    this.reconnectStatusCbs.push(callback);
    return () => {
      const index = this.reconnectStatusCbs.indexOf(callback);
      if (index >= 0) this.reconnectStatusCbs.splice(index, 1);
    };
  }

  /** Die einzige World-Identitaet, die auch RPC-Antworten und Ressourcenrevisionen bindet. */
  getCurrentWorldRevision(): number | null {
    return this.getWorldDescriptor()?.worldRevision ?? null;
  }

  /** Host-seitiger, zusammenhaengender ACK des lokalen Weapon2-Prediction-Stroms eines Spielers. */
  getWeapon2PredictionAck(playerId: string): number {
    const worldRevision = this.getCurrentWorldRevision();
    if (worldRevision === null) return 0;
    return this.getWeapon2PredictionState(worldRevision, playerId).nextContiguousAck;
  }

  /** Wird beim Verlassen der World bzw. des Raums aufgerufen; alte Prediction-IDs sind dann wertlos. */
  clearWeapon2PredictionState(playerId: string): void {
    for (const players of this.weapon2PredictionStates.values()) players.delete(playerId);
  }

  onKicked(callback: () => void): void {
    this.kickedCbs.push(callback);
  }

  /** Aktuelle Transportkennzahlen je Verbindung. Fuer Debug-Overlay und Lobby-Anzeige. */
  getTransportDiagnostics(): LinkDiagnostics[] {
    return this.diagnostics?.getSnapshots() ?? [];
  }

  /** Verbindung mit der hoechsten gemessenen Latenz, oder null ohne Mitspieler. */
  getWorstTransportDiagnostics(): LinkDiagnostics | null {
    return this.diagnostics?.getWorstSnapshot() ?? null;
  }

  private setupTransportDiagnostics(): void {
    const session = getActiveSession();
    if (!session) return;

    this.diagnostics = new TransportDiagnostics({
      getLinks: () => session.transport.getLinks(),
      // Den Anwendungs-Ping misst nur der Client fuer seine Verbindung zum Host; auf dem
      // Host gibt es keinen Umlauf zu messen.
      getAppPingMs: () => this.pingController.getAppPingMs() ?? 0,
      // Ohne konfiguriertes TURN darf kein Relay-Kandidat gewaehlt werden. Passiert es doch,
      // ist die ICE-Konfiguration kaputt: Verbindung trennen statt still ueber einen fremden
      // Server weiterspielen.
      onRelayDetected: (link) => {
        link.close();
        this.reportNetworkFailure(createPeerNetworkError('relay-rejected').message);
      },
    });

    requireRoom().onFatal((error) => this.reportNetworkFailure(error.message));
  }

  private reportNetworkFailure(message: string): void {
    for (const callback of this.networkFailureCbs) callback(message);
  }

  // ── Lobby-Sync-Konsistenz (Frühwarnung gegen Desync beim Bereit-Klick) ─────

  /**
   * Host-only: Veröffentlicht einen autoritativen Lobby-Snapshot (reliable, ein Objekt):
   * verbundene Spieler-IDs, aktueller Game-Mode, Coop-Map und Lobby-Uhrzeit.
   *
   * Clients vergleichen beim "Bereit"-Klick ihren *separat* propagierten Stand gegen diesen
   * gebündelten Snapshot. Da die Einzel-Keys (Roster via Join-Callbacks, KEY_GAME_MODE, KEY_COOP_MAP_ID)
   * unabhängig voneinander ankommen, deckt der Vergleich genau die Fälle auf, in denen ein Client
   * noch nicht aufgeschlossen hat – z. B. einen Mitspieler nicht kennt (Bug A/B) oder mit veraltetem
   * Modus bereit würde (und so ein für den Modus ungültiges Loadout committen könnte).
   */
  private hostPublishLobbySync(): void {
    if (!isHost()) return;
    // Alte/neu erstellte Raeume besitzen den optionalen Key noch nicht. Einmalig mit dem
    // Default anlegen, damit auch Clients den Slider sofort als autoritativen Zustand sehen.
    if (getState(KEY_TIME_OF_DAY) === undefined) {
      setState(KEY_TIME_OF_DAY, DEFAULT_TIME_OF_DAY_MINUTES, true);
    }
    setState(KEY_LOBBY_SYNC, {
      m: this.getGameMode(),
      c: this.getCoopDefenseMapId(),
      t: this.getLobbyTimeOfDayMinutes(),
      p: [...this.connectedPlayers.keys()].sort(),
    }, true);
  }

  /** Host-only: Veröffentlicht den aktuellen Lobby-Snapshot erneut (z. B. final unmittelbar vor Rundenstart). */
  publishLobbySync(): void {
    this.hostPublishLobbySync();
  }

  /**
   * Vergleicht den lokal propagierten Lobby-Stand mit dem host-autoritativen Snapshot.
   * `issues` listet die konkreten Abweichungen (für Logging). `hostStatePresent=false`, solange noch
   * kein Snapshot angekommen ist (dann keine Blockade, um Fehlalarme zu vermeiden).
   */
  getLobbySyncConsistency(): { consistent: boolean; hostStatePresent: boolean; issues: string[] } {
    const snapshot = getState(KEY_LOBBY_SYNC) as { m?: GameMode; c?: string; t?: number; p?: string[] } | undefined;
    if (!snapshot || !Array.isArray(snapshot.p)) {
      return { consistent: true, hostStatePresent: false, issues: [] };
    }

    const issues: string[] = [];

    const known = new Set(this.connectedPlayers.keys());
    const missingIds = snapshot.p.filter((id) => !known.has(id));
    if (missingIds.length > 0) {
      issues.push(`unbekannte Spieler: [${missingIds.join(', ')}]`);
    }

    if (snapshot.m !== undefined && snapshot.m !== this.getGameMode()) {
      issues.push(`Modus: lokal=${this.getGameMode()} host=${snapshot.m}`);
    }

    if (isCoopDefenseMode(snapshot.m ?? this.getGameMode())
      && snapshot.c !== undefined && snapshot.c !== this.getCoopDefenseMapId()) {
      issues.push(`Coop-Map: lokal=${this.getCoopDefenseMapId()} host=${snapshot.c}`);
    }

    if (!isCoopDefenseMode(snapshot.m ?? this.getGameMode())
      && snapshot.t !== undefined
      && normalizeTimeOfDay(snapshot.t) !== this.getLobbyTimeOfDayMinutes()) {
      issues.push(`Uhrzeit: lokal=${this.getLobbyTimeOfDayMinutes()} host=${normalizeTimeOfDay(snapshot.t)}`);
    }

    return { consistent: issues.length === 0, hostStatePresent: true, issues };
  }

  // ── Identität ──────────────────────────────────────────────────────────────
  isHost(): boolean          { return isHost(); }
  getLocalPlayerId(): string { return myPlayer().id; }

  /** Menschenlesbarer Raumcode; identisch mit dem Hash-Teil der Einladungs-URL. */
  getRoomCode(): string { return getActiveSession()?.roomCode ?? '—'; }

  /**
   * Spieler-ID des Hosts. Anders als `getMatchHostId()` (erst ab Rundenstart gesetzt) steht
   * dieser Wert ab dem Verbindungsaufbau bereit und gilt auch in der Lobby.
   */
  getHostPlayerId(): string { return requireRoom().getHostPlayerId(); }

  /** Host-only Lobby-Aktion. Die Vorprüfungen sind UX, die identischen Regeln im RPC-Handler
   * bleiben die eigentliche Netzwerkschranke gegen gefälschte oder verspätete UI-Aufrufe. */
  kickPlayer(playerId: string): Promise<KickPlayerResult> {
    if (!isHost()) return Promise.resolve({ ok: false, reason: 'host-only' });
    if (this.getGamePhase() !== 'LOBBY') return Promise.resolve({ ok: false, reason: 'lobby-only' });
    if (playerId === this.getLocalPlayerId() || playerId === this.getHostPlayerId()) {
      return Promise.resolve({ ok: false, reason: 'self' });
    }
    if (!this.playerStateMap.has(playerId)) return Promise.resolve({ ok: false, reason: 'unknown-player' });

    return this.callHostRpc('kck', { playerId }, 1_000)
      .then((result): KickPlayerResult => {
        if (result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === true) {
          return { ok: true };
        }
        const reason = result && typeof result === 'object' ? (result as { reason?: unknown }).reason : undefined;
        return reason === 'host-only' || reason === 'lobby-only' || reason === 'self'
          || reason === 'unknown-player' || reason === 'not-connected'
          ? { ok: false, reason }
          : { ok: false, reason: 'not-connected' };
      })
      .catch(() => ({ ok: false, reason: 'not-connected' }));
  }

  getConnectedPlayerIds(): string[] {
    return [...this.connectedPlayers.keys()];
  }

  /** Gibt aktuelle Profile zurück. Name wird dynamisch aus dem Player-State gelesen,
   *  sodass Namensänderungen sofort ohne Rejoin sichtbar sind. */
  getConnectedPlayers(): PlayerProfile[] {
    this.syncConnectedPlayers();
    return this.cachedConnectedPlayers;
  }

  getPlayerName(playerId: string): string {
    return this.getPlayerProfile(playerId)?.name ?? 'Player';
  }

  getPlayerProfile(playerId: string): PlayerProfile | undefined {
    const state = this.playerStateMap.get(playerId);
    if (!state) return this.connectedPlayers.get(playerId);
    return this.syncConnectedProfile(state);
  }

  getGameMode(): GameMode {
    return (getState(KEY_GAME_MODE) as GameMode | undefined) ?? COOP_DEFENSE_MODE;
  }

  /** Fachlich aktiver Modus aus Activity, authored World-Kontext oder Raum-Lobby. */
  getActiveGameMode(): GameMode {
    const activity = this.getActivityDescriptor();
    return resolveActiveGameMode({
      activityKind: activity?.kind ?? null,
      roomGameMode: this.getGameMode(),
      worldDefinitionId: this.getWorldDescriptor()?.definitionId ?? null,
    });
  }

  setGameMode(mode: GameMode): void {
    if (!isHost()) return;
    const previousMode = this.getGameMode();
    if (previousMode === mode) return;
    setState(KEY_GAME_MODE, mode, true);
    if (hasTeamSelection(mode) && !hasTeamSelection(previousMode)) {
      this.hostRedistributeSelectableTeams();
    } else if (isTeamGameMode(mode)) {
      this.hostAssignMissingTeams(mode);
    }
    this.hostReconcileLoadoutsForMode(mode);
    this.hostInvalidateLobbyReadyStateForAllPlayers();
    this.connectedPlayersCacheDirty = true;
    this.hostPublishLobbySync();
  }

  getCoopDefenseMapId(): string {
    const stateValue = getState(KEY_COOP_MAP_ID) as string | undefined;
    if (typeof stateValue !== 'string' || stateValue.length === 0) {
      return DEFAULT_COOP_DEFENSE_MAP_ID;
    }
    return getCoopDefenseMapConfig(stateValue).mapId;
  }

  /** Host-gesteuerte Uhrzeit der Lobby, in Minuten seit Mitternacht. */
  getLobbyTimeOfDayMinutes(): number {
    const stateValue = getState(KEY_TIME_OF_DAY);
    return normalizeTimeOfDay(typeof stateValue === 'number' ? stateValue : DEFAULT_TIME_OF_DAY_MINUTES);
  }

  /** Setzt die Lobby-Uhrzeit und macht sie fuer alle Clients reliable sichtbar. */
  setLobbyTimeOfDayMinutes(minutes: number): void {
    if (!isHost()) return;
    const normalized = normalizeTimeOfDay(minutes);
    if (this.getLobbyTimeOfDayMinutes() === normalized && getState(KEY_TIME_OF_DAY) !== undefined) return;
    setState(KEY_TIME_OF_DAY, normalized, true);
    this.hostInvalidateLobbyReadyStateForAllPlayers();
    this.hostPublishLobbySync();
  }

  setCoopDefenseMapId(mapId: string): void {
    if (!isHost()) return;
    const normalizedMapId = getCoopDefenseMapConfig(mapId).mapId;
    if (this.getCoopDefenseMapId() === normalizedMapId) return;
    setState(KEY_COOP_MAP_ID, normalizedMapId, true);
    this.hostInvalidateLobbyReadyStateForAllPlayers();
    this.hostPublishLobbySync();
  }

  hostReconcileLoadoutsForMode(mode: GameMode): void {
    if (!isHost()) return;

    for (const playerId of this.connectedPlayers.keys()) {
      const snapshot = resolveLoadoutSelectionIds({
        weapon1: WEAPON_CONFIGS[this.getPlayerLoadoutSlot(playerId, 'weapon1') as keyof typeof WEAPON_CONFIGS],
        weapon2: WEAPON_CONFIGS[this.getPlayerLoadoutSlot(playerId, 'weapon2') as keyof typeof WEAPON_CONFIGS],
        utility: UTILITY_CONFIGS[this.getPlayerLoadoutSlot(playerId, 'utility') as keyof typeof UTILITY_CONFIGS],
        ultimate: ULTIMATE_CONFIGS[this.getPlayerLoadoutSlot(playerId, 'ultimate') as keyof typeof ULTIMATE_CONFIGS],
      }, mode);

      const currentCommitted = this.getPlayerCommittedLoadout(playerId);
      const sanitizedCommitted = sanitizeCommittedLoadoutForMode(currentCommitted, mode);
      const slotChanged = this.getPlayerLoadoutSlot(playerId, 'weapon1') !== snapshot.weapon1
        || this.getPlayerLoadoutSlot(playerId, 'weapon2') !== snapshot.weapon2
        || this.getPlayerLoadoutSlot(playerId, 'utility') !== snapshot.utility
        || this.getPlayerLoadoutSlot(playerId, 'ultimate') !== snapshot.ultimate;
      const committedChanged = !isCommittedLoadoutEqual(currentCommitted, sanitizedCommitted);

      if (slotChanged) {
        this.hostSetPlayerLoadoutSlot(playerId, 'weapon1', snapshot.weapon1);
        if (snapshot.weapon2) this.hostSetPlayerLoadoutSlot(playerId, 'weapon2', snapshot.weapon2);
        this.hostSetPlayerLoadoutSlot(playerId, 'utility', snapshot.utility);
        this.hostSetPlayerLoadoutSlot(playerId, 'ultimate', snapshot.ultimate);
      }

      if (slotChanged || committedChanged) {
        this.hostSetPlayerReady(playerId, false);
        this.hostSetPlayerCommittedLoadout(playerId, null);
      }
    }
  }

  hostSetPlayerLoadoutSlot(playerId: string, slot: LoadoutSlot, itemId: string): void {
    if (!isHost()) return;
    const state = this.playerStateMap.get(playerId);
    if (!state) return;
    const key = { weapon1: KEY_LOADOUT_W1, weapon2: KEY_LOADOUT_W2, utility: KEY_LOADOUT_UT, ultimate: KEY_LOADOUT_UL }[slot];
    state.setState(key, itemId, true);
  }

  hostSetPlayerReady(playerId: string, ready: boolean): void {
    if (!isHost()) return;
    const state = this.playerStateMap.get(playerId);
    if (!state) return;
    state.setState(KEY_READY, ready, true);
  }

  hostSetPlayerCommittedLoadout(playerId: string, snapshot: LoadoutCommitSnapshot | null): void {
    if (!isHost()) return;
    const state = this.playerStateMap.get(playerId);
    if (!state) return;
    state.setState(KEY_LOADOUT_COMMITTED, snapshot, true);
  }

  private hostInvalidateLobbyReadyStateForAllPlayers(): void {
    if (!isHost()) return;
    for (const playerId of this.connectedPlayers.keys()) {
      this.hostSetPlayerReady(playerId, false);
      this.hostSetPlayerCommittedLoadout(playerId, null);
    }
  }

  /**
   * Host-only: Setzt ALLE verbundenen Spieler autoritativ auf "nicht bereit" und verwirft ihre
   * committed Loadouts (reliable). Beim Rundenwechsel aufrufen, damit der Host-Zustandsspeicher
   * garantiert sauber ist – unabhängig davon, ob jeder Client seinen eigenen Ready-Status rechtzeitig
   * zurücksetzt. Verhindert u. a. einen ungewollten Sofort-Neustart durch stehengebliebene Ready-Flags.
   */
  hostResetAllLobbyReady(): void {
    this.hostInvalidateLobbyReadyStateForAllPlayers();
  }

  getPlayerTeam(playerId: string): TeamId | null {
    const teamId = this.playerStateMap.get(playerId)?.getState(KEY_PLAYER_TEAM) as TeamId | undefined;
    return teamId === 'blue' || teamId === 'red' ? teamId : null;
  }

  getTeamColor(teamId: TeamId): number {
    return teamId === 'blue' ? TEAM_BLUE_COLOR : TEAM_RED_COLOR;
  }

  getPlayerColor(playerId: string): number | undefined {
    return this.getEffectivePlayerColor(playerId);
  }

  getEffectivePlayerColor(playerId: string): number | undefined {
    if (!this.usesFreeForAllWorldRelationships() && usesTeamColors(this.getActiveGameMode())) {
      const teamId = this.getPlayerTeam(playerId);
      if (teamId) return this.getTeamColor(teamId);
    }
    return this.getStoredPlayerColor(playerId);
  }

  getPlayerDmColor(playerId: string): number | undefined {
    return this.getStoredPlayerColor(playerId);
  }

  /** Explizite World-Sonderregel; die LobbyWorld verwendet bewusst `game-mode`. */
  private usesFreeForAllWorldRelationships(): boolean {
    if (this.getActivityDescriptor() !== null) return false;
    const definitionId = this.getWorldDescriptor()?.definitionId;
    if (!definitionId) return false;
    return getWorldDefinition(definitionId)?.actionPolicy?.playerRelationships === 'free-for-all';
  }

  areTeammates(firstPlayerId: string, secondPlayerId: string): boolean {
    if (firstPlayerId === secondPlayerId) return true;
    if (this.usesFreeForAllWorldRelationships()) return false;
    const mode = this.getActiveGameMode();
    if (!isTeamGameMode(mode)) return false;
    if (isCoopDefenseMode(mode)) {
      if (firstPlayerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID) {
        return this.connectedPlayers.has(secondPlayerId);
      }
      if (secondPlayerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID) {
        return this.connectedPlayers.has(firstPlayerId);
      }
      // Coop is a shared faction even if stale team state from an earlier team mode is still
      // present for one frame. The connected player roster is the authoritative player set.
      return this.connectedPlayers.has(firstPlayerId) && this.connectedPlayers.has(secondPlayerId);
    }
    const firstTeam = this.getPlayerTeam(firstPlayerId);
    const secondTeam = this.getPlayerTeam(secondPlayerId);
    return firstTeam !== null && firstTeam === secondTeam;
  }

  isEnemyPair(firstPlayerId: string, secondPlayerId: string): boolean {
    if (firstPlayerId === secondPlayerId) return false;
    if (this.usesFreeForAllWorldRelationships()) return true;
    const mode = this.getActiveGameMode();
    if (isCoopDefenseMode(mode)
      && this.connectedPlayers.has(firstPlayerId)
      && this.connectedPlayers.has(secondPlayerId)) return false;
    if (!isTeamGameMode(mode)) return true;
    const firstTeam = this.getPlayerTeam(firstPlayerId);
    const secondTeam = this.getPlayerTeam(secondPlayerId);
    if (!firstTeam || !secondTeam) return true;
    return firstTeam !== secondTeam;
  }

  canPlayerChangeTeam(playerId: string, targetTeamId?: TeamId): boolean {
    if (!hasTeamSelection(this.getGameMode()) || this.getPlayerReady(playerId)) return false;
    const currentTeam = this.getPlayerTeam(playerId);
    const target = targetTeamId ?? (currentTeam === 'blue' ? 'red' : 'blue');
    if (target === currentTeam) return true;
    return canJoinLobbyTeam(
      target,
      this.getTeamPlayerCount('blue'),
      this.getTeamPlayerCount('red'),
    );
  }

  async requestTeamChange(teamId: TeamId): Promise<boolean> {
    const playerId = this.getLocalPlayerId();
    if (this.getPlayerTeam(playerId) === teamId) return true;
    if (this.isHost()) {
      return this.hostHandleTeamRequest(teamId, playerId);
    }
    const result = await this.callHostRpc('tmr', { teamId }, 1000).catch(() => false);
    return result === true;
  }

  hostEnsureTeamAssignment(playerId: string): void {
    if (!isHost()) return;
    if (this.getPlayerTeam(playerId)) return;
    const teamId = isCoopDefenseMode(this.getGameMode()) ? 'blue' : this.pickBalancedTeam();
    if (!teamId) return;
    this.playerStateMap.get(playerId)?.setState(KEY_PLAYER_TEAM, teamId, true);
    this.connectedPlayersCacheDirty = true;
  }

  hostAssignMissingTeams(mode: GameMode = this.getGameMode()): void {
    if (!isHost()) return;
    const playerIds = [...this.connectedPlayers.keys()];
    if (isCoopDefenseMode(mode)) {
      // Coop: ALLE Spieler werden auf Blau gesetzt, auch wenn sie aus einem vorherigen Team-Modus
      // bereits eine (ggf. rote) Zuweisung hatten.
      let changed = false;
      for (const playerId of playerIds) {
        if (this.getPlayerTeam(playerId) !== 'blue') {
          this.playerStateMap.get(playerId)?.setState(KEY_PLAYER_TEAM, 'blue' as TeamId, true);
          changed = true;
        }
      }
      if (changed) this.connectedPlayersCacheDirty = true;
      return;
    }
    if (hasTeamSelection(mode)
      && (this.getTeamPlayerCount('blue') > LOBBY_TEAM_CAPACITY
        || this.getTeamPlayerCount('red') > LOBBY_TEAM_CAPACITY)) {
      this.hostRedistributeSelectableTeams();
      return;
    }

    const unassigned = playerIds.filter((playerId) => !this.getPlayerTeam(playerId));
    if (unassigned.length === 0) return;
    for (const playerId of unassigned) {
      const teamId = this.pickBalancedTeam();
      if (!teamId) break;
      this.playerStateMap.get(playerId)?.setState(KEY_PLAYER_TEAM, teamId, true);
    }
    this.connectedPlayersCacheDirty = true;
  }

  // ── Input: Client → Host (pro Spieler, unreliable) ────────────────────────

  /**
   * Eingabe des lokalen Spielers. Wird jeden Frame aufgerufen, geht aber nur raus, wenn sich
   * etwas geaendert hat – plus ein Keepalive, damit ein verlorenes Paket den Host nicht auf
   * einem alten Stand stehen laesst. Aenderungen gehen immer sofort raus; hier wird nichts
   * verzoegert, was sich anfuehlbar auswirken koennte.
   */
  sendLocalInput(input: PlayerInput): void {
    // World-Input ist an die aktuelle World gebunden. Die World-Participation ist dabei die
    // einzige lokale Eintrittsentscheidung; Round-Phase und Round-Eligibility sind dafuer
    // keine Ersatzquelle.
    const worldRevision = this.getWorldDescriptor()?.worldRevision;
    // Zwischen alter und neuer LobbyWorld gibt es bewusst kein World-Input-Fallback. Dadurch
    // kann ein bereits laufender Input-Loop die gerade beendete Instanz nicht wiederbeleben.
    if (worldRevision === undefined) return;
    if (!maySendWorldInput(this.getLocalWorldParticipation())) {
      input = {
        dx: 0,
        dy: 0,
        aim: input.aim,
        dashHeld: false,
        worldRevision,
      } satisfies PlayerInput;
    } else input = { ...input, worldRevision };
    const now = Date.now();
    if (now - this.lastInputSentAtMs < NET_INPUT_KEEPALIVE_MS && isSamePlayerInput(input, this.lastSentInput)) {
      return;
    }
    this.lastInputSentAtMs = now;
    this.lastSentInput = input;
    myPlayer().setState(KEY_INPUT, input);
  }

  /** Sendet den rein visuellen Placement-Presence-State über den ersetzbaren Kanal. */
  sendLocalPlacementPreview(preview: PlacementPreviewNetState | null): void {
    let next = normalizePlacementPreview(preview);
    const world = this.getWorldDescriptor();
    if (world && !maySendWorldInput(this.getLocalWorldParticipation())) next = null;
    else if (world && next) next = { ...next, worldRevision: world.worldRevision };

    const now = Date.now();
    const changed = !isSamePlacementPreview(next, this.lastSentPlacementPreview);
    const refreshDue = next !== null
      && now - this.lastPlacementPreviewSentAtMs >= NET_PLACEMENT_PREVIEW_REFRESH_MS;
    if (!changed && !refreshDue) return;

    this.lastSentPlacementPreview = next;
    this.lastPlacementPreviewSentAtMs = now;
    myPlayer().setState(KEY_PLACEMENT_PREVIEW, next, false);
  }

  getPlayerInput(playerId: string): PlayerInput | undefined {
    const input = this.playerStateMap.get(playerId)?.getState(KEY_INPUT) as PlayerInput | undefined;
    const world = this.getWorldDescriptor();
    if (!world) return undefined;
    return input?.worldRevision !== undefined
      && isCurrentWorldRevision(world.worldRevision, input.worldRevision)
      ? input
      : undefined;
  }

  getPlayerPlacementPreview(playerId: string): PlacementPreviewNetState | null {
    const preview = this.playerStateMap.get(playerId)?.getState(KEY_PLACEMENT_PREVIEW) as
      PlacementPreviewNetState | null | undefined;
    if (!preview?.active) return null;
    const world = this.getWorldDescriptor();
    if (!world || preview.worldRevision !== world.worldRevision) return null;
    if (playerId === this.getLocalPlayerId()) return preview;

    const receivedAt = requireRoom().getPlayerStateUpdatedAt(playerId, KEY_PLACEMENT_PREVIEW);
    if (receivedAt === undefined || Date.now() - receivedAt > NET_PLACEMENT_PREVIEW_TTL_MS) return null;
    return preview;
  }

  // ── Anzeigename: pro Spieler ──────────────────────────────────────────────

  /** Setzt den eigenen Anzeigenamen (ersetzt den Platzhalter aus der Spieler-ID). */
  setLocalName(name: string): void {
    myPlayer().setState(KEY_NAME, sanitizePlayerName(name) || 'Player');
  }

  // ── Bereitschaftsstatus: pro Spieler ──────────────────────────────────────
  setLocalReady(ready: boolean): void {
    if (!ready) {
      myPlayer().setState(KEY_READY, false);
      myPlayer().setState(KEY_LOADOUT_COMMITTED, null, true);
      return;
    }
    myPlayer().setState(KEY_READY, ready);
  }

  /**
   * Friert das aktuelle Lobby-Loadout als verbindlichen Snapshot ein und markiert den Spieler als bereit.
   * Die Reihenfolge ist bewusst: erst Snapshot, dann Ready-Flag.
   */
  setLocalReadyWithCommittedLoadout(snapshot: LoadoutCommitSnapshot): void {
    myPlayer().setState(KEY_LOADOUT_COMMITTED, snapshot, true);
    myPlayer().setState(KEY_READY, true);
  }

  getPlayerReady(playerId: string): boolean {
    return (this.playerStateMap.get(playerId)?.getState(KEY_READY) as boolean | undefined) ?? false;
  }

  /**
   * Liest den verbindlichen Ready-Loadout-Snapshot eines Spielers.
   *
   * Das Ergebnis wird pro Spieler zwischengespeichert und ueber die Referenz des rohen
   * Netzwerk-Zustands invalidiert. Der Aufbau ist teuer – er sanitisiert das Coop-Profil, was
   * intern alle Upgrade-Definitionen durchlaeuft – und die Methode wird pro Frame mehrfach
   * aufgerufen (HUD, Loadout-Getter, Platzierungs-Vorschau). Ohne Cache war das der groesste
   * Einzelposten im Client-Frame; zusaetzlich lieferte jeder Aufruf ein neues Objekt, wodurch
   * referenzbasierte Caches der Aufrufer grundsaetzlich nie trafen.
   */
  getPlayerCommittedLoadout(playerId: string): LoadoutCommitSnapshot | null {
    const raw = this.playerStateMap.get(playerId)?.getState(KEY_LOADOUT_COMMITTED) as Partial<LoadoutCommitSnapshot> | null | undefined;
    const cached = this.committedLoadoutCache.get(playerId);
    if (cached && cached.raw === raw) return cached.value;
    const value = this.buildCommittedLoadout(raw);
    this.committedLoadoutCache.set(playerId, { raw, value });
    return value;
  }

  private buildCommittedLoadout(raw: Partial<LoadoutCommitSnapshot> | null | undefined): LoadoutCommitSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    if (
      typeof raw.weapon1 !== 'string'
      || (raw.weapon2 !== null && typeof raw.weapon2 !== 'string')
      || typeof raw.utility !== 'string'
      || typeof raw.ultimate !== 'string'
    ) {
      return null;
    }
    const coopDefenseClassId = isCoopDefenseClassId(raw.coopDefenseClassId)
      ? raw.coopDefenseClassId
      : null;
    return {
      weapon1: raw.weapon1,
      weapon2: raw.weapon2,
      utility: raw.utility,
      ultimate: raw.ultimate,
      coopDefenseClassId,
      coopDefenseProfile: raw.coopDefenseProfile == null
        ? null
        : sanitizeCoopDefenseUpgradeProfile(raw.coopDefenseProfile, coopDefenseClassId ?? undefined),
      tools: coopDefenseClassId === 'inspector_gadachs'
        ? sanitizeCoopDefenseUpgradeProfile(raw.coopDefenseProfile, coopDefenseClassId).toolLoadout?.map((tool) => ({ ...tool }))
        : undefined,
      // Ausruestung wird an derselben Stelle validiert wie die Utility-Slots: unbekannte Items
      // und Eigenschaften fallen weg, Werte werden auf ihren Wurfbereich geklemmt.
      equippedItems: sanitizeCoopDefenseEquippedItems(raw.equippedItems),
    };
  }

  /** Liest eine committed Loadout-Slot-ID eines Spielers. */
  getPlayerCommittedLoadoutSlot(playerId: string, slot: LoadoutSlot): string | undefined {
    return this.getPlayerCommittedLoadout(playerId)?.[slot] ?? undefined;
  }

  /** True, wenn ein Spieler einen vollstaendigen verbindlichen Ready-Snapshot hat. */
  hasCommittedLoadout(playerId: string): boolean {
    return this.getPlayerCommittedLoadout(playerId) !== null;
  }

  hasCommittedCoopDefenseProfile(playerId: string): boolean {
    const committed = this.getPlayerCommittedLoadout(playerId);
    return committed !== null && isCoopDefenseReadyLoadoutComplete(committed);
  }

  /** Gibt zurück ob ALLE aktuell verbundenen Spieler bereit sind (modusabhängige Mindestspielerzahl). */
  areAllPlayersReady(): boolean {
    const mode = this.getGameMode();
    const ids = [...this.connectedPlayers.keys()];
    if (ids.length < getMinPlayersForMode(mode)) return false;
    const requiresCoopDefenseProfile = isCoopDefenseMode(mode);
    return ids.every((id) => (
      this.getPlayerReady(id)
      && this.hasCommittedLoadout(id)
      && (!requiresCoopDefenseProfile || this.hasCommittedCoopDefenseProfile(id))
    ));
  }

  // ── Rundenteilnahme / Spectator-Rolle: Host → Alle (global, reliable) ─────

  getRoundParticipation(): RoundParticipationState | null {
    const raw = getState(KEY_ROUND_PARTICIPATION) as RoundParticipationState | null | undefined;
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.participantIds) || !Array.isArray(raw.spectatorIds)) return null;
    const roundStartTime = typeof raw.roundStartTime === 'number' && Number.isFinite(raw.roundStartTime)
      ? raw.roundStartTime
      : 0;
    const roundRevision = typeof raw.roundRevision === 'number' && Number.isFinite(raw.roundRevision)
      ? raw.roundRevision
      : roundStartTime;
    return {
      roundStartTime,
      roundRevision,
      participantIds: [...raw.participantIds],
      spectatorIds: [...raw.spectatorIds],
    };
  }

  /** Host-only: friert die Teilnehmerliste beim Wechsel in die Arena ein. */
  hostStartRoundParticipants(
    participantIds: readonly string[],
    roundStartTime: number,
    roundRevision = roundStartTime,
  ): void {
    if (!isHost()) return;
    const participation = createRoundParticipationState(roundStartTime, participantIds, roundRevision);
    setState(
      KEY_ROUND_PARTICIPATION,
      participation,
      true,
    );
    // Die Ladebarriere haengt an der World-Instanz, nicht an der Runde. Solange beide aus
    // derselben monotonen Quelle stammen, ist die Rundenrevision zugleich die World-Revision;
    // die Bindung macht ein verspaetetes reliable Paket der Vorinstanz harmlos.
    const worldRevision = roundRevision;
    for (const playerId of participation.participantIds) {
      this.playerStateMap.get(playerId)?.setState(KEY_WORLD_LOAD_READY, {
        worldRevision,
        progress: 0,
        stage: 'generating',
        ready: false,
      } satisfies WorldLoadReadyState, true);
    }
    this.lastLocalWorldLoadStateKey = null;
  }

  /** Publishes only stage changes or meaningful progress steps for the current world. */
  setLocalWorldLoadProgress(
    worldRevision: number,
    progress: number,
    stage: WorldLoadStage,
    ready = stage === 'ready',
  ): void {
    const normalizedProgress = ready || stage === 'ready'
      ? 100
      : Math.min(95, Math.floor(normalizeWorldLoadProgress(progress) / 5) * 5);
    const normalizedReady = ready === true && normalizedProgress >= 100 && stage === 'ready';
    const stateKey = `${worldRevision}|${stage}|${normalizedProgress}|${normalizedReady}`;
    if (this.lastLocalWorldLoadStateKey === stateKey) return;
    this.lastLocalWorldLoadStateKey = stateKey;
    myPlayer().setState(KEY_WORLD_LOAD_READY, {
      worldRevision,
      progress: normalizedProgress,
      stage,
      ready: normalizedReady,
    } satisfies WorldLoadReadyState, true);
  }

  /** Local peer acknowledgement that its current world working set is complete. */
  setLocalWorldLoadReady(worldRevision: number, ready = true): void {
    if (ready) {
      this.setLocalWorldLoadProgress(worldRevision, 100, 'ready', true);
      return;
    }
    this.setLocalWorldLoadProgress(worldRevision, 0, 'generating', false);
  }

  getPlayerWorldLoadState(playerId: string, worldRevision: number): WorldLoadReadyState | null {
    return parseWorldLoadReadyState(
      this.playerStateMap.get(playerId)?.getState(KEY_WORLD_LOAD_READY),
      worldRevision,
    );
  }

  getPlayerWorldLoadReady(playerId: string, worldRevision: number): boolean {
    return this.getPlayerWorldLoadState(playerId, worldRevision)?.ready === true;
  }

  isLocalWorldLoadReady(worldRevision: number): boolean {
    return this.getPlayerWorldLoadReady(this.getLocalPlayerId(), worldRevision);
  }

  /**
   * World-Ladebarriere: jeder Teilnehmer dieser World-Instanz hat sie fertig geladen.
   *
   * Sie haengt an der World, nicht an der Runde - eine World ohne Activity laedt genauso. Wer
   * nicht teilnimmt, laedt sie auch nicht und wird deshalb nicht erwartet.
   */
  areWorldParticipantsLoadReady(): boolean {
    if (!isHost()) return false;
    const world = this.getWorldDescriptor();
    if (!world) return false;
    const connected = new Set([...this.connectedPlayers.keys(), this.getLocalPlayerId()]);
    const participants = this.getWorldParticipants().filter((id) => connected.has(id));
    if (participants.length === 0) return false;
    return participants.every((id) => this.getPlayerWorldLoadReady(id, world.worldRevision));
  }

  /** Host-only: setzt einen spaeter beigetretenen Roster-Eintrag auf Spectator. */
  private hostRegisterLateJoiner(playerId: string): void {
    if (!isHost() || this.getGamePhase() !== 'ARENA') return;
    const current = this.getRoundParticipation();
    if (!current) return;
    setState(KEY_ROUND_PARTICIPATION, markRoundLateJoiner(current, playerId), true);
  }

  /** Host-only: schaltet einen aktiven Teilnehmer unwiderruflich auf Spectator. */
  hostEnterSpectator(playerId: string): boolean {
    if (!isHost() || this.getGamePhase() !== 'ARENA') return false;
    const current = this.getRoundParticipation();
    if (!current || getRoundPlayerRole(current, playerId) !== 'participant') return false;

    setState(KEY_ROUND_PARTICIPATION, enterRoundSpectator(current, playerId), true);
    const player = this.playerStateMap.get(playerId);
    const previous = player?.getState(KEY_INPUT) as PlayerInput | undefined;
    player?.setState(KEY_PLACEMENT_PREVIEW, null, false);
    player?.setState(KEY_INPUT, {
      dx: 0,
      dy: 0,
      aim: previous?.aim ?? 0,
      dashHeld: false,
    } satisfies PlayerInput, false);
    for (const callback of this.spectatorEnteredCbs) callback(playerId);
    return true;
  }

  /** Lokale UI-Aktion; die eigentliche Entscheidung bleibt beim Host-RPC. */
  async requestSpectatorMode(): Promise<boolean> {
    const localId = this.getLocalPlayerId();
    if (!this.canPlayerAct(localId)) return false;
    if (isHost()) return this.hostEnterSpectator(localId);
    const result = await this.callHostRpc('spt', {}, 1_000).catch(() => false);
    return result === true;
  }

  /** Host-only: naechster Net-Tick muss einen verlaesslichen Full-Snapshot senden. */
  requestFullGameState(): void {
    if (isHost()) this.fullGameStateRequested = true;
  }

  consumeFullGameStateRequest(): boolean {
    if (!isHost()) return false;
    const requested = this.fullGameStateRequested;
    this.fullGameStateRequested = false;
    return requested;
  }

  /** Host-only: Rollen-Snapshot nach Rundenende loeschen; in der naechsten Lobby gilt normaler Join. */
  hostResetRoundParticipation(): void {
    if (!isHost()) return;
    setState(KEY_ROUND_PARTICIPATION, null, true);
  }

  getRoundRole(playerId: string): import('../types').RoundPlayerRole {
    if (this.getGamePhase() !== 'ARENA') return 'participant';
    return getRoundPlayerRole(this.getRoundParticipation(), playerId);
  }

  isRoundSpectator(playerId: string): boolean {
    return this.getRoundRole(playerId) === 'spectator';
  }

  isLocalSpectator(): boolean {
    return this.isRoundSpectator(this.getLocalPlayerId());
  }

  canPlayerSpawnOrRespawn(playerId: string): boolean {
    return this.getGamePhase() === 'ARENA'
      && canRoundPlayerSpawnOrRespawn(this.getRoundParticipation(), playerId);
  }

  /** Initialspawn/Reconnect eines noch lebenden Spielers; tote Spieler nutzen den Respawnpfad. */
  canPlayerInitialSpawn(playerId: string): boolean {
    if (!this.canPlayerSpawnOrRespawn(playerId)) return false;
    const state = this.getCoopDefenseRespawnBudgetState()?.players[playerId];
    return state === undefined || (!state.eliminated && state.alive);
  }

  /** Echter Post-Death-Respawn; der Initialspawn benutzt separat canPlayerInitialSpawn(). */
  canPlayerRespawn(playerId: string): boolean {
    if (!this.canPlayerSpawnOrRespawn(playerId)) return false;
    const budget = this.getCoopDefenseRespawnBudgetState();
    if (!budget) return true; // Maps ohne authored Budget respawnen unbegrenzt.
    const state = budget.players[playerId];
    // Der Host publiziert den Zustand vor dem Arenaphasenwechsel. Ein fehlender Snapshot darf
    // einen bestehenden Spieler trotzdem nicht dauerhaft blockieren.
    if (!state) return true;
    return !state.eliminated && !state.alive && state.remainingRespawns > 0;
  }

  canPlayerAct(playerId: string): boolean {
    if (!this.canPlayerSpawnOrRespawn(playerId)) return false;
    return this.getCoopDefenseRespawnBudgetState()?.players[playerId]?.eliminated !== true;
  }

  canPlayerReceiveRoundRewards(playerId: string): boolean {
    return canRoundPlayerReceiveRewards(this.getRoundParticipation(), playerId);
  }


  getRoundResultEligiblePlayerIds(): string[] {
    return getRoundResultEligibleIds(this.getRoundParticipation(), this.getConnectedPlayerIds());
  }

  publishCoopDefenseRespawnBudgetState(state: CoopDefenseRespawnBudgetState | null): void {
    if (!isHost()) return;
    setState(KEY_COOP_RESPAWN_BUDGET, state, true);
  }

  getCoopDefenseRespawnBudgetState(): CoopDefenseRespawnBudgetState | null {
    const raw = getState(KEY_COOP_RESPAWN_BUDGET) as Partial<CoopDefenseRespawnBudgetState> | null | undefined;
    if (!raw || typeof raw !== 'object' || typeof raw.respawnsPerPlayer !== 'number'
      || !Number.isFinite(raw.respawnsPerPlayer) || raw.respawnsPerPlayer < 0
      || !raw.players || typeof raw.players !== 'object') return null;

    const players: Record<string, CoopDefenseRespawnBudgetPlayerState> = {};
    for (const [playerId, value] of Object.entries(raw.players)) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as Partial<CoopDefenseRespawnBudgetPlayerState>;
      if (typeof candidate.remainingRespawns !== 'number'
        || !Number.isFinite(candidate.remainingRespawns) || candidate.remainingRespawns < 0
        || typeof candidate.alive !== 'boolean' || typeof candidate.eliminated !== 'boolean') continue;
      players[playerId] = {
        remainingRespawns: Math.floor(candidate.remainingRespawns),
        alive: candidate.alive,
        eliminated: candidate.eliminated,
      };
    }
    return {
      respawnsPerPlayer: Math.floor(raw.respawnsPerPlayer),
      players,
    };
  }

  /** Host-only: publiziert ausschließlich den aktuellen, kleinen Encounter-Präsentationszustand. */
  publishCoopDefenseEncounterPresentationState(state: CoopDefenseEncounterPresentationState | null): void {
    if (!isHost()) return;
    setState(KEY_COOP_ENCOUNTER_PRESENTATION, state, true);
  }

  getCoopDefenseEncounterPresentationState(): CoopDefenseEncounterPresentationState | null {
    const raw = getState(KEY_COOP_ENCOUNTER_PRESENTATION) as Partial<CoopDefenseEncounterPresentationState> | null | undefined;
    if (!raw || typeof raw !== 'object' || typeof raw.encounterId !== 'string' || raw.encounterId.length === 0) return null;
    const sequenceIndex = raw.sequenceIndex;
    const sequenceCount = raw.sequenceCount;
    const phaseStartedAtMs = raw.phaseStartedAtMs;
    const phase = raw.phase;
    if (typeof sequenceIndex !== 'number' || !Number.isSafeInteger(sequenceIndex) || sequenceIndex < 1
      || typeof sequenceCount !== 'number' || !Number.isSafeInteger(sequenceCount) || sequenceCount < sequenceIndex
      || typeof phaseStartedAtMs !== 'number' || !Number.isFinite(phaseStartedAtMs) || phaseStartedAtMs < 0
      || !['incoming', 'active', 'cleared', 'rest', 'complete'].includes(phase ?? '')) return null;

    const phaseEndsAtMs = raw.phaseEndsAtMs ?? null;
    if (phaseEndsAtMs !== null
      && (typeof phaseEndsAtMs !== 'number'
        || !Number.isFinite(phaseEndsAtMs)
        || phaseEndsAtMs < phaseStartedAtMs)) return null;
    const spawnComplete = raw.spawnComplete;
    if (spawnComplete !== undefined && typeof spawnComplete !== 'boolean') return null;
    const rawEncounterFronts = raw.encounterFronts ?? raw.fronts;
    const rawFronts = raw.fronts;
    if (rawEncounterFronts !== undefined && !Array.isArray(rawEncounterFronts)) return null;
    if (rawFronts !== undefined && !Array.isArray(rawFronts)) return null;
    const encounterFronts: SpawnFront[] = [];
    for (const front of rawEncounterFronts ?? [DEFAULT_SPAWN_FRONT]) {
      if (!isSpawnFront(front) || encounterFronts.includes(front)) return null;
      encounterFronts.push(front);
    }
    if (encounterFronts.length === 0) encounterFronts.push(DEFAULT_SPAWN_FRONT);
    const fronts: SpawnFront[] = [];
    for (const front of rawFronts ?? [DEFAULT_SPAWN_FRONT]) {
      if (!isSpawnFront(front) || fronts.includes(front)) return null;
      fronts.push(front);
    }
    if (fronts.length === 0) fronts.push(DEFAULT_SPAWN_FRONT);
    // Die Gegnerzahlen sind optional und rein darstellend: Ein unplausibles Paar wird
    // verworfen, nicht repariert – das Panel fällt dann auf die Phasenanzeige zurück.
    const enemiesTotal = raw.enemiesTotal;
    const enemiesDefeated = raw.enemiesDefeated;
    const hasEnemyProgress = typeof enemiesTotal === 'number' && Number.isSafeInteger(enemiesTotal) && enemiesTotal > 0
      && typeof enemiesDefeated === 'number' && Number.isSafeInteger(enemiesDefeated)
      && enemiesDefeated >= 0 && enemiesDefeated <= enemiesTotal;
    return {
      encounterId: raw.encounterId,
      sequenceIndex,
      sequenceCount,
      phase: phase as CoopDefenseEncounterPresentationState['phase'],
      phaseStartedAtMs,
      phaseEndsAtMs,
      encounterFronts,
      fronts,
      ...(spawnComplete === undefined ? {} : { spawnComplete }),
      ...(hasEnemyProgress ? { enemiesDefeated, enemiesTotal } : {}),
    } as CoopDefenseEncounterPresentationState;
  }

  /** Host-only: publiziert ausschließlich den kleinen Secondary-Objective-Präsentationszustand. */
  /** Host-only: publiziert den kleinen, reliable Map-Event-Lifecycle-Snapshot. */
  publishCoopDefenseMapEventPresentationState(state: CoopDefenseMapEventPresentationState | null): void {
    if (!isHost()) return;
    setState(KEY_COOP_MAP_EVENT_PRESENTATION, state, true);
  }

  getCoopDefenseMapEventPresentationState(): CoopDefenseMapEventPresentationState | null {
    const raw = getState(KEY_COOP_MAP_EVENT_PRESENTATION) as unknown;
    const cached = this.mapEventPresentationCache;
    if (cached && cached.raw === raw) return cached.value;
    const value = this.sanitizeCoopDefenseMapEventPresentationState(raw);
    this.mapEventPresentationCache = { raw, value };
    return value;
  }

  /** Fail-closed: Ein einziger unplausibler Eintrag verwirft den ganzen Snapshot. */
  private sanitizeCoopDefenseMapEventPresentationState(
    raw: unknown,
  ): CoopDefenseMapEventPresentationState | null {
    if (!Array.isArray(raw) || raw.length > MAX_COOP_MAP_EVENT_PRESENTATION_ENTRIES) return null;

    const eventIds = new Set<string>();
    const sanitized: CoopDefenseMapEventPresentationState[number][] = [];
    for (const rawEntry of raw) {
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return null;
      const entry = rawEntry as Partial<CoopDefenseMapEventPresentationState[number]>;
      if (
        typeof entry.eventId !== 'string'
        || entry.eventId.length === 0
        || entry.eventId.trim() !== entry.eventId
        || eventIds.has(entry.eventId)
        || !['train', 'airstrike', 'ground-hazard'].includes(entry.eventType ?? '')
        || !['dormant', 'scheduled', 'active', 'waiting-repeat', 'completed'].includes(entry.state ?? '')
        || typeof entry.occurrence !== 'number'
        || !Number.isSafeInteger(entry.occurrence)
        || entry.occurrence < 0
        || typeof entry.stateChangedAtMs !== 'number'
        || !Number.isFinite(entry.stateChangedAtMs)
        || entry.stateChangedAtMs < 0
      ) return null;
      if (entry.state === 'dormant' && entry.occurrence !== 0) return null;
      if (entry.state !== 'dormant' && entry.occurrence < 1) return null;
      if (entry.nextActionAtMs !== undefined && (
        typeof entry.nextActionAtMs !== 'number'
        || !Number.isFinite(entry.nextActionAtMs)
        || entry.nextActionAtMs < entry.stateChangedAtMs
      )) return null;
      eventIds.add(entry.eventId);
      sanitized.push({
        eventId: entry.eventId,
        eventType: entry.eventType as CoopDefenseMapEventType,
        state: entry.state as CoopDefenseMapEventLifecycleState,
        occurrence: entry.occurrence,
        stateChangedAtMs: entry.stateChangedAtMs,
        ...(entry.nextActionAtMs === undefined ? {} : { nextActionAtMs: entry.nextActionAtMs }),
      });
    }
    return sanitized;
  }

  publishCoopDefenseSecondaryObjectivePresentationState(
    state: CoopDefenseSecondaryObjectivePresentationState | null,
  ): void {
    if (!isHost()) return;
    setState(KEY_COOP_SECONDARY_OBJECTIVE_PRESENTATION, state, true);
  }

  getCoopDefenseSecondaryObjectivePresentationState(): CoopDefenseSecondaryObjectivePresentationState | null {
    const raw = getState(KEY_COOP_SECONDARY_OBJECTIVE_PRESENTATION) as unknown;
    const cached = this.secondaryObjectivePresentationCache;
    if (cached && cached.raw === raw) return cached.value;
    const value = this.sanitizeCoopDefenseSecondaryObjectivePresentationState(raw);
    this.secondaryObjectivePresentationCache = { raw, value };
    return value;
  }

  publishCoopDefenseMissionProgressPresentationState(
    state: CoopDefenseMissionProgressPresentationState | null,
  ): void {
    if (!isHost()) return;
    setState(KEY_COOP_MISSION_PROGRESS_PRESENTATION, state, true);
  }

  getCoopDefenseMissionProgressPresentationState(): CoopDefenseMissionProgressPresentationState | null {
    const raw = getState(KEY_COOP_MISSION_PROGRESS_PRESENTATION) as unknown;
    const expectedRoundRevision = this.getActiveRoundRevision();
    const cached = this.missionProgressPresentationCache;
    if (cached
      && cached.raw === raw
      && cached.expectedRoundRevision === expectedRoundRevision) {
      return cached.value;
    }

    const sanitized = sanitizeMissionProgressPresentationState(raw);
    const value = expectedRoundRevision !== null
      && sanitized?.roundRevision === expectedRoundRevision
      ? sanitized
      : null;
    this.missionProgressPresentationCache = { raw, expectedRoundRevision, value };
    return value;
  }

  /** Only an active Arena participation snapshot defines the current mission round. */
  private getActiveRoundRevision(): number | null {
    if (this.getGamePhase() !== 'ARENA') return null;
    const roundRevision = this.getRoundParticipation()?.roundRevision;
    return typeof roundRevision === 'number'
      && Number.isSafeInteger(roundRevision)
      && roundRevision > 0
      ? roundRevision
      : null;
  }

  /** Fail-closed: Ein einziger unplausibler Eintrag verwirft den ganzen Snapshot. */
  private sanitizeCoopDefenseSecondaryObjectivePresentationState(
    raw: unknown,
  ): CoopDefenseSecondaryObjectivePresentationState | null {
    if (!Array.isArray(raw) || raw.length > MAX_COOP_SECONDARY_OBJECTIVE_PRESENTATION_ENTRIES) return null;

    const objectiveIds = new Set<string>();
    let focusedCount = 0;
    const sanitized: CoopDefenseSecondaryObjectivePresentationState[number][] = [];
    for (const rawEntry of raw) {
      if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return null;
      const entry = rawEntry as Partial<CoopDefenseSecondaryObjectivePresentationState[number]>;
      if (typeof entry.objectiveId !== 'string'
        || entry.objectiveId.length === 0
        || entry.objectiveId.trim() !== entry.objectiveId
        || objectiveIds.has(entry.objectiveId)
        || !['destroy', 'hold', 'carry'].includes(entry.type ?? '')
        || !['dormant', 'active', 'completed', 'failed'].includes(entry.state ?? '')
        || typeof entry.focused !== 'boolean') return null;
      objectiveIds.add(entry.objectiveId);
      if (entry.focused) {
        focusedCount += 1;
        if (focusedCount > 1) return null;
      }

      const progressCurrent = entry.progressCurrent;
      const progressTotal = entry.progressTotal;
      const stateChangedAtMs = entry.stateChangedAtMs;
      if (typeof progressCurrent !== 'number' || !Number.isSafeInteger(progressCurrent) || progressCurrent < 0
        || typeof progressTotal !== 'number' || !Number.isSafeInteger(progressTotal) || progressTotal <= 0
        || progressCurrent > progressTotal
        || typeof stateChangedAtMs !== 'number' || !Number.isFinite(stateChangedAtMs) || stateChangedAtMs < 0) {
        return null;
      }

      sanitized.push({
        objectiveId: entry.objectiveId,
        type: entry.type as CoopDefenseSecondaryObjectivePresentationState[number]['type'],
        state: entry.state as CoopDefenseSecondaryObjectivePresentationState[number]['state'],
        focused: entry.focused,
        progressCurrent,
        progressTotal,
        stateChangedAtMs,
      });
    }

    return sanitized;
  }

  getLocalCoopDefenseRespawnBudgetState(): CoopDefenseRespawnBudgetPlayerState | null {
    const state = this.getCoopDefenseRespawnBudgetState()?.players[this.getLocalPlayerId()];
    return state ? { ...state } : null;
  }

  isLocalRoundResultEligible(results = this.getRoundResults()): boolean {
    const localId = this.getLocalPlayerId();
    if (results) return results.some((result) => result.id === localId);
    const finalIds = this.getRoundState()?.resultEligiblePlayerIds;
    return finalIds?.includes(localId) === true;
  }

  // ── Spielphase: Host → Alle (global, reliable) ────────────────────────────

  /** Host-only: Setzt die globale Spielphase. */
  setGamePhase(phase: GamePhase): void {
    setState(KEY_GAME_PHASE, phase, true);
  }

  /** Liest die aktuelle globale Spielphase (Standard: 'LOBBY'). */
  getGamePhase(): GamePhase {
    return (getState(KEY_GAME_PHASE) as GamePhase | undefined) ?? 'LOBBY';
  }

  /** Lokale Schätzung der Host-Zeitbasis für hostseitige Timestamps. */
  getSynchronizedNow(): number {
    return this.pingController.getSynchronizedNow();
  }

  // ── Arena-Startzeit / Countdown: Host → Alle (global, reliable) ─────────

  /** Host-only: Setzt den Zeitstempel, ab dem ARENA-Input und Match-Timer freigegeben sind. */
  setArenaStartTime(ts: number): void {
    setState(KEY_ARENA_START, ts, true);
  }

  /** Liest den autoritativen ARENA-Startzeitpunkt (Standard: 0). */
  getArenaStartTime(): number {
    return (getState(KEY_ARENA_START) as number | undefined) ?? 0;
  }

  /** true solange die Runde bereits in ARENA ist, aber der Start-Countdown noch läuft. */
  isArenaCountdownActive(now?: number): boolean {
    const effectiveNow = now ?? this.getSynchronizedNow();
    const start = this.getArenaStartTime();
    const countdownBegin = start - ARENA_COUNTDOWN_SEC * 1000;
    return this.getGamePhase() === 'ARENA'
      && start > 0
      && effectiveNow >= countdownBegin
      && effectiveNow < start;
  }

  /** True once the arena may be revealed, including the visible countdown and live round. */
  isArenaCountdownVisible(now?: number): boolean {
    const effectiveNow = now ?? this.getSynchronizedNow();
    const start = this.getArenaStartTime();
    return this.getGamePhase() === 'ARENA'
      && start > 0
      && effectiveNow >= start - ARENA_COUNTDOWN_SEC * 1000;
  }

  /** True while the local round is still building or waiting for the common start time. */
  isArenaLoading(now?: number): boolean {
    const effectiveNow = now ?? this.getSynchronizedNow();
    const start = this.getArenaStartTime();
    return this.getGamePhase() === 'ARENA'
      && (start <= 0 || effectiveNow < start - ARENA_COUNTDOWN_SEC * 1000);
  }

  /** Exact gameplay gate shared by input, simulation and all round timers. */
  isArenaStarted(now?: number): boolean {
    const effectiveNow = now ?? this.getSynchronizedNow();
    const start = this.getArenaStartTime();
    return this.getGamePhase() === 'ARENA' && start > 0 && effectiveNow >= start;
  }

  /** Verbleibende Countdown-Sekunden als 3,2,1 (sonst 0). */
  computeArenaCountdownSecondsLeft(now?: number): number {
    const effectiveNow = now ?? this.getSynchronizedNow();
    if (!this.isArenaCountdownActive(effectiveNow)) return 0;
    return Math.max(0, Math.ceil((this.getArenaStartTime() - effectiveNow) / 1000));
  }

  // ── Rundenende-Zeitstempel: Host → Alle (global, reliable) ────────────────

  /** Host-only: Setzt den Rundenende-Zeitstempel (Date.now() + Dauer). */
  setRoundEndTime(ts: number): void {
    setState(KEY_ROUND_END, ts, true);
  }

  /** Liest den Rundenende-Zeitstempel (Standard: 0). */
  getRoundEndTime(): number {
    return (getState(KEY_ROUND_END) as number | undefined) ?? 0;
  }

  /**
   * Berechnet die verbleibenden Sekunden LOKAL.
   * Wird niemals über das Netzwerk gesendet.
   */
  computeSecondsLeft(): number {
    const now = this.getSynchronizedNow();
    const effectiveNow = Math.max(now, this.getArenaStartTime());
    return Math.max(0, Math.ceil((this.getRoundEndTime() - effectiveNow) / 1000));
  }

  // ── Match-Host-ID: Host → Alle (global, reliable) ────────────────────────

  /**
   * Host-only: Speichert die eigene Player-ID als authoritativer Match-Host.
   * Wird einmalig beim Rundenstart aufgerufen, damit Clients den
   * Host-Disconnect erkennen können.
   */
  setMatchHostId(): void {
    setState(KEY_HOST_ID, myPlayer().id, true);
  }

  /**
   * Liest die gespeicherte Match-Host-ID (Standard: null).
   * Clients vergleichen damit incoming onQuit-IDs.
   */
  getMatchHostId(): string | null {
    return (getState(KEY_HOST_ID) as string | undefined) ?? null;
  }

  // ── World-Kanal: Host → Alle (global, reliable, einmalig pro World-Instanz) ──
  /**
   * Der eine kanonische World-Kanal. Mission, PvP und jede spaetere friedliche World
   * beschreiben ihre Welt hierueber – es gibt keinen zweiten World-Vertrag daneben.
   *
   * World und Activity werden gemeinsam gesetzt, damit auf dem Draht nie eine Activity ohne
   * ihre World steht. `activity = null` ist dabei ein regulaerer Zustand: eine World ohne
   * laufende Activity.
   */
  publishWorldAndActivity(world: WorldDescriptor, activity: ActivityDescriptor | null): void {
    if (!isHost()) return;
    if (activity && activity.worldRevision !== world.worldRevision) {
      throw new Error(
        `[NetworkBridge] Activity ${activity.definitionId} belongs to world revision `
        + `${activity.worldRevision}, not ${world.worldRevision}`,
      );
    }
    const previous = this.getWorldDescriptor();
    setState(KEY_WORLD_DESCRIPTOR, world, true);
    setState(KEY_ACTIVITY_DESCRIPTOR, activity, true);
    // Eine neue World-Instanz startet ohne Teilnehmer. Wer teilnimmt, entscheidet der Host
    // danach ausdruecklich - Teilnahme wird nie aus einer Vorinstanz uebernommen.
    if (previous?.worldRevision !== world.worldRevision) {
      setState(KEY_WORLD_PARTICIPATION, encodeWorldParticipationState({
        worldRevision: world.worldRevision,
        participants: {},
      }), true);
    }
  }

  /** Host-only: ändert nur die Activity innerhalb der unveränderten World-Instanz. */
  publishActivity(activity: ActivityDescriptor | null): void {
    if (!isHost()) return;
    const world = this.getWorldDescriptor();
    if (!world) return;
    if (activity && !isActivityOfWorld(activity, world)) {
      throw new Error(
        `[NetworkBridge] Activity ${activity.definitionId} belongs to world revision `
        + `${activity.worldRevision}, not ${world.worldRevision}`,
      );
    }
    setState(KEY_ACTIVITY_DESCRIPTOR, activity, true);
  }

  /** Beendet die replizierte World-Instanz; danach existiert weltweit keine mehr. */
  clearWorldAndActivity(): void {
    if (!isHost()) return;
    setState(KEY_ACTIVITY_DESCRIPTOR, null, true);
    setState(KEY_WORLD_DESCRIPTOR, null, true);
    setState(KEY_WORLD_PARTICIPATION, null, true);
    setState(KEY_PB_REWARD_SESSION, null, true);
  }

  getWorldDescriptor(): WorldDescriptor | null {
    return parseWorldDescriptor(getState(KEY_WORLD_DESCRIPTOR));
  }

  /**
   * Die Activity gilt nur zusammen mit ihrer World. Ein Descriptor, der auf eine andere
   * World-Instanz zeigt, ist ein verspaetetes Paket und wird hier zentral verworfen.
   */
  getActivityDescriptor(): ActivityDescriptor | null {
    const world = this.getWorldDescriptor();
    if (!world) return null;
    const activity = parseActivityDescriptor(getState(KEY_ACTIVITY_DESCRIPTOR));
    return activity && isActivityOfWorld(activity, world) ? activity : null;
  }

  // -- World Participation: Host -> Alle (global, reliable, world-scoped) ----

  /**
   * Der kanonische Teilnahmestand der laufenden World-Instanz.
   *
   * Er wird nicht aus Runden- oder Phasenzustaenden rekonstruiert: der Host schreibt ihn, alle
   * Peers lesen denselben Wert. Ohne laufende World existiert keine Teilnahme.
   */
  getWorldParticipationState(): WorldParticipationState | null {
    const world = this.getWorldDescriptor();
    if (!world) return null;
    return parseWorldParticipationState(getState(KEY_WORLD_PARTICIPATION), world.worldRevision);
  }

  /** Teilnahme eines Spielers an der laufenden World-Instanz. */
  getWorldParticipation(playerId: string): WorldParticipation {
    return readWorldParticipation(this.getWorldParticipationState(), playerId);
  }

  getLocalWorldParticipation(): WorldParticipation {
    return this.getWorldParticipation(this.getLocalPlayerId());
  }

  /** Alle Spieler, die an der laufenden World teilnehmen. */
  getWorldParticipants(): readonly string[] {
    return listWorldParticipants(this.getWorldParticipationState());
  }

  /**
   * Host-only: schreibt den Teilnahmestand der laufenden World-Instanz.
   *
   * Der Stand traegt die `worldRevision` seiner World. Ohne laufende World gibt es nichts zu
   * beschreiben - der Aufruf wird dann verworfen, statt eine fremde Instanz zu bespielen.
   */
  hostPublishWorldParticipation(participants: Readonly<Record<string, WorldParticipation>>): void {
    if (!isHost()) return;
    const world = this.getWorldDescriptor();
    if (!world) return;
    const cleaned: Record<string, WorldParticipation> = {};
    for (const [playerId, participation] of Object.entries(participants)) {
      if (participation !== 'none') cleaned[playerId] = participation;
    }
    // Der Stand ist reliable. Ihn unveraendert erneut zu schreiben kostet Bandbreite, ohne
    // etwas mitzuteilen - deshalb geht nur eine echte Aenderung raus.
    const current = this.getWorldParticipationState();
    if (current && current.worldRevision === world.worldRevision) {
      const before = Object.keys(current.participants).sort();
      const after = Object.keys(cleaned).sort();
      if (before.length === after.length
        && before.every((id, i) => id === after[i] && current.participants[id] === cleaned[id])) {
        return;
      }
    }
    setState(KEY_WORLD_PARTICIPATION, encodeWorldParticipationState({
      worldRevision: world.worldRevision,
      participants: cleaned,
    }), true);
  }

  /** Host-only: setzt die Teilnahme genau eines Spielers. */
  hostSetWorldParticipation(playerId: string, participation: WorldParticipation): void {
    if (!isHost()) return;
    const current = this.getWorldParticipationState();
    if (!current) return;
    if (readWorldParticipation(current, playerId) === participation) return;
    this.hostPublishWorldParticipation({ ...current.participants, [playerId]: participation });
  }

  /**
   * Eintritts-/Austrittswunsch eines Spielers an der laufenden World.
   *
   * Er ist bewusst **kein** World-Input: wer eintreten will, nimmt noch nicht teil und koennte
   * deshalb ueber `sendWorldRpc()` gar nichts senden. Die Bindung an die World bleibt trotzdem
   * dieselbe – die Nutzlast traegt die `worldRevision`, und der Host verwirft ueber
   * `acceptsWorldRpc()` jeden Wunsch, der zu einer anderen Instanz gehoert.
   *
   * Der Host entscheidet; die Antwort sagt nur, ob der Wunsch angenommen wurde.
   */
  async requestWorldParticipation(join: boolean): Promise<boolean> {
    const world = this.getWorldDescriptor();
    if (!world) return false;
    if (isHost()) {
      return this.worldParticipationRequestHandler?.(myPlayer().id, join) === true;
    }
    const result = await this
      .callHostRpc('wpr', { join, wr: world.worldRevision }, 1_200)
      .catch(() => false);
    return result === true;
  }

  registerWorldParticipationRequestHandler(handler: (playerId: string, join: boolean) => boolean): void {
    this.worldParticipationRequestHandler = handler;
    this.registerHostRpcHandler('wpr', (data: unknown, caller: PlayerState): boolean => {
      if (!isHost() || !this.acceptsWorldRpc(data)) return false;
      const { join } = data as { join?: unknown };
      if (typeof join !== 'boolean') return false;
      // Der Absender ist der Antragsteller. Eine Spieler-ID in der Nutzlast gaebe es nicht,
      // gerade damit niemand fuer einen anderen eintreten oder ihn hinauswerfen kann.
      return this.worldParticipationRequestHandler?.(caller.id, join) === true;
    });
  }

  // ── Persistente Basis: persoenliche Beitraege ─────────────────────────────

  /**
   * Bietet den eigenen persoenlichen Basisbeitrag im aktuellen Raum an.
   *
   * Bewusst ein per-player State und kein RPC: Der Beitrag ist ein Zustand, kein Ereignis, und
   * ein spaeter beitretender Host liest ihn ohne Nachfrage. Weil jeder Peer ausschliesslich
   * seinen eigenen per-player State schreiben kann, kann niemand fuer einen anderen anbieten.
   *
   * Angeboten wird nur - materialisiert wird nichts. Was davon in der Welt steht, entscheidet
   * allein der Host.
   */
  offerPersistentBaseContribution(contribution: PersistentPlayerBaseContribution | null): void {
    const next = contribution ? clonePersistentPlayerBaseContribution(contribution) : null;
    const current = myPlayer().getState(KEY_PB_CONTRIBUTION);
    if (JSON.stringify(current ?? null) === JSON.stringify(next)) return;
    myPlayer().setState(KEY_PB_CONTRIBUTION, next, true);
  }

  /** Der von diesem Spieler angebotene Beitrag; ungueltige Nutzlast wird ganz verworfen. */
  getPlayerPersistentBaseContribution(playerId: string): PersistentPlayerBaseContribution | null {
    const raw = this.playerStateMap.get(playerId)?.getState(KEY_PB_CONTRIBUTION);
    return sanitizePersistentPlayerBaseContribution(raw);
  }

  /**
   * Host-only: bestaetigt einem Spieler seinen fortgeschriebenen Beitrag.
   *
   * Das ist nach Lobby-Sofort-Commit oder Missionssieg die einzige Quelle, aus der ein Client
   * seinen persoenlichen Save fortschreiben darf.
   * Ohne sie koennte ein manipulierter Client zwar Requests senden, aber nie seine eigene
   * Revision erhoehen und ungeprueftes Bauwerk dauerhaft in den autoritativen Fluss druecken.
   */
  hostConfirmPersistentBaseContribution(
    playerId: string,
    contribution: PersistentPlayerBaseContribution,
  ): void {
    if (!isHost()) return;
    const player = this.playerStateMap.get(playerId);
    if (!player) return;
    player.setState(KEY_PB_CONFIRMED, clonePersistentPlayerBaseContribution(contribution), true);
  }

  /** Der host-bestaetigte eigene Beitrag; nur er darf lokal persistiert werden. */
  getConfirmedPersistentBaseContribution(): PersistentPlayerBaseContribution | null {
    return sanitizePersistentPlayerBaseContribution(myPlayer().getState(KEY_PB_CONFIRMED));
  }

  /** Host-only: confirms the cumulative personal reward grant for exactly one player. */
  hostConfirmPersistentBaseRewardGrant(
    playerId: string,
    grant: PersistentBaseRewardGrant,
  ): void {
    if (!isHost()) return;
    const sanitized = sanitizePersistentBaseRewardGrant(grant);
    if (!sanitized) return;
    const player = this.playerStateMap.get(playerId);
    if (!player) return;
    const current = sanitizePersistentBaseRewardGrant(player.getState(KEY_PB_REWARD_GRANT));
    if (current && (
      sanitized.revision < current.revision
      || (sanitized.revision === current.revision
        && JSON.stringify(sanitized) !== JSON.stringify(current))
      || current.rewardIds.some((rewardId) => !sanitized.rewardIds.includes(rewardId))
    )) return;
    if (current && sanitized.revision === current.revision) return;
    player.setState(KEY_PB_REWARD_GRANT, clonePersistentBaseRewardGrant(sanitized), true);
  }

  /**
   * Host-side grant operation. The reliable per-player state is the only cumulative history:
   * every call reads it, appends only missing IDs, and confirms the merged state.
   */
  hostGrantPersistentBaseRewards(
    playerId: string,
    rewardIds: readonly PersistentBaseRewardId[],
  ): readonly PersistentBaseRewardId[] {
    if (!isHost() || typeof playerId !== 'string' || !this.playerStateMap.has(playerId)) return [];
    const normalized = sanitizePersistentBaseRewardGrantIds(rewardIds);
    if (!normalized) return [];
    const current = this.getPlayerPersistentBaseRewardGrant(playerId);
    const previousIds = current?.rewardIds ?? [];
    const newlyGranted = normalized.filter((rewardId) => !previousIds.includes(rewardId));
    if (newlyGranted.length === 0) return [];
    this.hostConfirmPersistentBaseRewardGrant(playerId, {
      revision: (current?.revision ?? 0) + 1,
      rewardIds: [...previousIds, ...newlyGranted],
    });
    return newlyGranted;
  }

  /** Host-side read of the state offered by one player; invalid payloads are ignored. */
  getPlayerPersistentBaseRewardGrant(playerId: string): PersistentBaseRewardGrant | null {
    return sanitizePersistentBaseRewardGrant(this.playerStateMap.get(playerId)?.getState(KEY_PB_REWARD_GRANT));
  }

  /** Reads only the locally owned, host-confirmed grant state. */
  getConfirmedPersistentBaseRewardGrant(): PersistentBaseRewardGrant | null {
    return sanitizePersistentBaseRewardGrant(myPlayer().getState(KEY_PB_REWARD_GRANT));
  }

  /** Publishes the complete host-owned reward projection for the current World. */
  publishPersistentBaseRewardSessionState(state: PersistentBaseRewardSessionState | null): void {
    if (!isHost()) return;
    if (state !== null) {
      const world = this.getWorldDescriptor();
      if (!world || state.worldRevision !== world.worldRevision) return;
      const sanitized = sanitizePersistentBaseRewardSessionState(state);
      if (!sanitized) return;
      const current = sanitizePersistentBaseRewardSessionState(getState(KEY_PB_REWARD_SESSION));
      if (current && current.worldRevision === sanitized.worldRevision
        && (sanitized.revision < current.revision
          || (sanitized.revision === current.revision
            && JSON.stringify(sanitized) !== JSON.stringify(current)))) return;
      setState(KEY_PB_REWARD_SESSION, clonePersistentBaseRewardSessionState(sanitized), true);
      return;
    }
    setState(KEY_PB_REWARD_SESSION, null, true);
  }

  /** Reads the current complete reward projection, rejecting stale World revisions. */
  getPersistentBaseRewardSessionState(): PersistentBaseRewardSessionState | null {
    const world = this.getWorldDescriptor();
    if (!world) return null;
    const state = sanitizePersistentBaseRewardSessionState(getState(KEY_PB_REWARD_SESSION));
    return state?.worldRevision === world.worldRevision ? state : null;
  }

  /** Sends one world-bound placement request; the host invokes its handler synchronously. */
  async sendPersistentBaseRewardPlacement(
    request: PersistentBaseRewardPlacementRequest,
  ): Promise<LoadoutUseResult> {
    const sanitized = sanitizePersistentBaseRewardPlacementRequest(request);
    const world = this.getWorldDescriptor();
    if (!sanitized || !world || sanitized.worldRevision !== world.worldRevision) {
      return { ok: false, reason: 'blocked' };
    }
    if (isHost()) {
      const handler = this.persistentBaseRewardPlacementHandler;
      return handler?.(myPlayer().id, sanitized) ?? { ok: false, reason: 'blocked' };
    }
    const result = await this.callHostRpc('pbrp', {
      wr: sanitized.worldRevision,
      rid: sanitized.rewardId,
      gx: sanitized.relativeGridX,
      gy: sanitized.relativeGridY,
      angle: sanitized.angle,
    }, 1200);
    return (result as LoadoutUseResult | undefined) ?? { ok: false, reason: 'invalid' };
  }

  registerPersistentBaseRewardPlacementHandler(
    handler: PersistentBaseRewardPlacementHandler,
  ): void {
    this.persistentBaseRewardPlacementHandler = handler;
    this.registerHostRpcHandler('pbrp', (data: unknown, caller: PlayerState): LoadoutUseResult => {
      if (!isHost() || !this.acceptsWorldRpc(data)) return { ok: false, reason: 'blocked' };
      const payload = data as Record<string, unknown>;
      const request = sanitizePersistentBaseRewardPlacementRequest({
        worldRevision: payload.wr,
        rewardId: payload.rid,
        relativeGridX: payload.gx,
        relativeGridY: payload.gy,
        angle: payload.angle,
      });
      if (!request) return { ok: false, reason: 'invalid' };
      return handler(caller.id, request);
    });
  }

  // ── Game State: Host → Alle (global, unreliable) ──────────────────────────

  // Client-seitiger Cache für Partial-State-Merge (leere Arrays werden nicht gesendet)
  private cachedGameState: GameState | undefined;
  /** Revision des World-Snapshots, auf dem der Merge-Cache basiert. */
  private cachedGameStateWorldRevision: number | null = null;
  // Host-seitige Sequenznummer: wird bei jedem publishGameState() inkrementiert
  private publishSeq = 0;
  private burningGroundPublishTicks = 0;
  private readonly lastPublishedBurningGround = new Map<number, EncodedBurningGroundCell>();
  // Client-seitiger Statik-Cache der Projektile. Nur die Statik wird gecacht – die Dynamik kommt
  // jeden Tick vollstaendig, weshalb es keinen SyncedProjectile-Cache braucht.
  private readonly projectileStaticCache = new Map<number, SyncedProjectileStatic>();
  // Debug-only, hinter NET_DEBUG_PROJECTILE_SYNC_METRICS: rollierendes Fenster ueber die Groesse
  // des `j`-Slices, damit sich der Effekt der Kompaktierung im Netz-Overlay (Taste P) ablesen laesst.
  private readonly projectileSyncSamples: Array<{ at: number; chars: number; count: number }> = [];
  // Client-seitig: zuletzt gesehene Sequenznummer für Change-Detection
  private lastSeenSeq = -1;
  // Monoton steigender Zähler: wird nur bei tatsächlich neuem Server-State inkrementiert
  private gameStateVersion = 0;

  /**
   * Verwirft den clientseitigen Game-State-Merge-Cache.
   *
   * Die Delta-Slices (rocks/powerups/pedestals) werden auf den zuletzt gecachten Stand gemerged –
   * "abwesend = unverändert". Bei einem Rundenwechsel muss dieser Baseline-Stand verworfen werden,
   * sonst trägt der Client z. B. beschädigte Felsen aus der Vorrunde in die neue Runde, bis zufällig
   * ein Full-Resync ankommt. Wird beim Arena-Aufbau aufgerufen.
   */
  resetGameStateCache(): void {
    this.cachedGameState = undefined;
    this.cachedGameStateWorldRevision = this.getWorldDescriptor()?.worldRevision ?? null;
    this.lastSeenSeq = -1;
    this.burningGroundPublishTicks = 0;
    this.lastPublishedBurningGround.clear();
    this.projectileStaticCache.clear();
    this.mapEventPresentationCache = null;
    this.secondaryObjectivePresentationCache = null;
  }

  /**
   * Sendet den Game State als einzelnen setState-Aufruf.
   * Leere Arrays und null-Werte werden weggelassen, um Bandbreite zu sparen.
   * Enthält eine Sequenznummer (_s) für zuverlässige Change-Detection auf Clients.
   */
  publishGameState(state: OutboundGameState, fullSnapshot = false): void {
    const worldRevision = this.getWorldDescriptor()?.worldRevision;
    if (worldRevision === undefined) return;
    if (state.worldRevision !== undefined && state.worldRevision !== worldRevision) return;
    if (fullSnapshot) {
      this.publishFullGameState(state, worldRevision);
      return;
    }
    const payload: Record<string, unknown> = {
      wr: worldRevision,
      p: encodePlayerStates(state.players),
      _s: ++this.publishSeq,
    };
    payload.rt = state.roundStartTime;
    // Fehlender Schluessel heisst hier "keine aktiven Projektile": der Dynamik-Strom fuehrt jeden
    // Tick alle aktiven Projektile, ein leerer Snapshot kann also nur eine leere Arena bedeuten.
    if (state.projectiles)             payload.j = state.projectiles;
    if (state.enemies)                 payload.e = state.enemies;
    if (state.rocks)                   payload.r = state.rocks;
    if (state.placeableRocks.length > 0) payload.br = state.placeableRocks;
    if (state.reinforcementMatrices.length > 0) payload.oc = state.reinforcementMatrices;
    if (state.energyInjectorEffects.length > 0) payload.ei = state.energyInjectorEffects;
    if (state.energyInjectorFocus.length > 0) payload.fi = state.energyInjectorFocus;
    if (state.remoteControlTurrets.length > 0) payload.rc = state.remoteControlTurrets;
    if (state.decoys.length > 0)       payload.dc = state.decoys;
    if (state.smokes.length > 0)       payload.s = state.smokes;
    if (state.fires.length > 0)        payload.f = state.fires;
    if (state.stinkClouds.length > 0)  payload.sc = state.stinkClouds;
    if (state.timeBubbles.length > 0)  payload.tb = state.timeBubbles;
    if (state.teslaDomes.length > 0)   payload.td = state.teslaDomes;
    if (state.energyShields.length > 0) payload.es = state.energyShields;
    if (state.guardianSpirits.length > 0) payload.g = state.guardianSpirits;
    if (state.repairDrones.length > 0) payload.rd = state.repairDrones;
    if (state.slimeTrail.cells.length > 0 || state.slimeTrail.affectedEnemies.length > 0) {
      payload.sl = encodeSlimeTrailSnapshot(state.slimeTrail);
    }
    // Der Schluessel entfaellt vollstaendig, solange kein Gegner verwundbar ist – der Regelfall.
    if (state.targetVulnerabilities.length > 0) {
      payload.vu = encodeTargetVulnerabilities(state.targetVulnerabilities);
    }
    if (state.ak47StrategicTargets.length > 0) payload.st = state.ak47StrategicTargets;
    const burningGroundDelta = this.buildBurningGroundDelta(state.burningGround);
    if (burningGroundDelta) payload.fg = burningGroundDelta;
    if (state.powerups)                payload.u = state.powerups;
    if (state.pedestals)               payload.pd = state.pedestals;
    if (state.nukes.length > 0)        payload.n  = state.nukes;
    if (state.airstrikes.length > 0)   payload.ak = state.airstrikes;
    if (state.meteors.length > 0)      payload.mt = state.meteors;
    if (state.tunnels.length > 0)      payload.tn = state.tunnels;
    if (state.train)                   payload.t = state.train;
    if (state.bases.length > 0)        payload.b = state.bases;
    if (state.captureTheBeer)          payload.cb = state.captureTheBeer;
    // Unlike delta-friendly world slices, Carry must publish an empty array after delivery so
    // a completed item cannot survive in a client's merge cache.
    payload.cc = state.coopDefenseCarry;
    this.sampleProjectileSyncPayload(state.projectiles);
    setState(KEY_GAME_STATE, payload, false);
  }

  /**
   * Debug-only: misst die tatsaechliche Groesse des Projektil-Slices auf dem Draht.
   *
   * Das `JSON.stringify` hier ist der Grund fuer das Flag – es ist die einzige Stelle, an der die
   * Messung Rechenzeit kostet, und sie laeuft nur, wenn jemand die Zahl wirklich sehen will.
   */
  private sampleProjectileSyncPayload(snapshot: SyncedProjectileSnapshot | null): void {
    if (!NET_DEBUG_PROJECTILE_SYNC_METRICS) return;
    const now = Date.now();
    this.projectileSyncSamples.push({
      at: now,
      chars: snapshot ? JSON.stringify(snapshot).length : 0,
      count: snapshot ? countProjectileDynamics(snapshot.u) : 0,
    });
    const cutoff = now - NET_DEBUG_PROJECTILE_SYNC_METRICS_WINDOW_MS;
    while (this.projectileSyncSamples.length > 0 && this.projectileSyncSamples[0].at < cutoff) {
      this.projectileSyncSamples.shift();
    }
  }

  /**
   * Aggregierte Projektil-Sync-Metriken fuer das Netz-Overlay. `null`, solange das Debug-Flag aus
   * ist oder noch kein Tick gemessen wurde – dann blendet das Overlay die Zeile aus.
   */
  getProjectileSyncMetrics(): {
    avgCharsPerTick: number;
    maxCharsPerTick: number;
    avgActiveCount: number;
    estimatedKbPerSec: number;
  } | null {
    const samples = this.projectileSyncSamples;
    if (!NET_DEBUG_PROJECTILE_SYNC_METRICS || samples.length === 0) return null;
    let totalChars = 0;
    let maxChars = 0;
    let totalCount = 0;
    for (const sample of samples) {
      totalChars += sample.chars;
      totalCount += sample.count;
      if (sample.chars > maxChars) maxChars = sample.chars;
    }
    const avgCharsPerTick = totalChars / samples.length;
    return {
      avgCharsPerTick,
      maxCharsPerTick: maxChars,
      avgActiveCount: totalCount / samples.length,
      // Grobe Schaetzung je Empfaenger: ein Zeichen entspricht im JSON-Transport einem Byte.
      estimatedKbPerSec: (avgCharsPerTick * NET_TICK_RATE_HZ) / 1024,
    };
  }

  /** Baut einen vollstaendigen Bootstrap-Payload und veroeffentlicht ihn reliable. */
  private publishFullGameState(state: OutboundGameState, worldRevision: number): void {
    const payload: Record<string, unknown> = {
      wr: worldRevision,
      p: encodePlayerStates(state.players),
      _s: ++this.publishSeq,
      _full: true,
      rt: state.roundStartTime,
      j: state.projectiles ?? EMPTY_FULL_PROJECTILE_SNAPSHOT,
      e: state.enemies,
      r: state.rocks ?? { full: true, count: 0, upserts: [], removals: [] } satisfies SyncedRockSnapshot,
      br: state.placeableRocks,
      oc: state.reinforcementMatrices,
      ei: state.energyInjectorEffects,
      fi: state.energyInjectorFocus,
      rc: state.remoteControlTurrets,
      dc: state.decoys,
      s: state.smokes,
      f: state.fires,
      sc: state.stinkClouds,
      tb: state.timeBubbles,
      td: state.teslaDomes,
      es: state.energyShields,
      g: state.guardianSpirits,
      rd: state.repairDrones,
      sl: encodeSlimeTrailSnapshot(state.slimeTrail),
      vu: encodeTargetVulnerabilities(state.targetVulnerabilities),
      st: state.ak47StrategicTargets,
      fg: this.buildFullBurningGroundDelta(state.burningGround),
      u: state.powerups ?? { full: true, count: 0, upserts: [], removals: [] } satisfies SyncedPowerUpSnapshot,
      pd: state.pedestals ?? { full: true, upserts: [], removals: [] } satisfies SyncedPowerUpPedestalSnapshot,
      n: state.nukes,
      ak: state.airstrikes,
      mt: state.meteors,
      tn: state.tunnels,
      t: state.train,
      b: state.bases,
      cb: state.captureTheBeer,
      cc: state.coopDefenseCarry,
    };
    this.sampleProjectileSyncPayload(state.projectiles);
    // Die unreliable Kopie hält bereits verbundene Clients aktuell; der reliable Key ist der
    // Bootstrap für neue Teilnehmer und bleibt bis zum nächsten Full-Resync erhalten.
    setState(KEY_GAME_STATE, payload, false);
    setState(KEY_GAME_STATE_INITIAL, payload, true);
  }

  getLatestGameState(): GameState | undefined {
    const expectedWorldRevision = this.getWorldDescriptor()?.worldRevision ?? null;
    this.ensureGameStateWorldRevision(expectedWorldRevision);
    if (expectedWorldRevision === null) return undefined;

    const fastRaw = getState(KEY_GAME_STATE) as Record<string, unknown> | undefined;
    const initialRaw = getState(KEY_GAME_STATE_INITIAL) as Record<string, unknown> | undefined;
    const expectedRoundStartTime = this.getArenaStartTime();
    const inArena = this.getGamePhase() === 'ARENA' && expectedRoundStartTime > 0;
    const isCurrentRound = (candidate: Record<string, unknown> | undefined): boolean => {
      if (!candidate || !candidate.p || !isCurrentWorldRevision(expectedWorldRevision, candidate.wr)) return false;
      if (!inArena) return true;
      return candidate.rt === expectedRoundStartTime;
    };
    const validFast = isCurrentRound(fastRaw) ? fastRaw : undefined;
    const validInitial = isCurrentRound(initialRaw) && isCompleteGameStatePayload(initialRaw)
      ? initialRaw
      : undefined;

    // Ein Latejoiner darf einen Delta-State nicht als Baseline interpretieren. Er wartet auf den
    // reliable Full-Snapshot, statt fehlende Slices fälschlich als leere Arena zu behandeln.
    if (inArena && !this.cachedGameState && !validInitial) return undefined;

    const candidates = [validFast, validInitial].filter(
      (candidate): candidate is Record<string, unknown> => candidate !== undefined,
    );
    if (candidates.length === 0) return this.cachedGameState;
    const raw = !this.cachedGameState && validInitial
      ? validInitial
      : candidates.sort((left, right) => {
        const leftSeq = typeof left._s === 'number' ? left._s : -1;
        const rightSeq = typeof right._s === 'number' ? right._s : -1;
        if (leftSeq !== rightSeq) return rightSeq - leftSeq;
        return left._full === true ? -1 : 1;
      })[0];

    // Sequenznummer vergleichen: nur parsen wenn neue Daten vom Host eingetroffen sind.
    const seq = raw._s as number | undefined;
    if (seq !== undefined && seq <= this.lastSeenSeq) return this.cachedGameState;
    if (seq !== undefined) this.lastSeenSeq = seq;

    const roundStartTime = (raw.rt as number | undefined) ?? 0;
    if (this.getGamePhase() === 'ARENA' && expectedRoundStartTime > 0 && roundStartTime !== expectedRoundStartTime) {
      this.cachedGameState = undefined;
      return undefined;
    }

    const rockSnapshot = raw.r as SyncedRockSnapshot | undefined;
    const nextRocks = this.mergeRockSnapshot(
      rockSnapshot,
      this.cachedGameState?.rocks ?? [],
    );
    const nextPowerUps = this.mergePowerUpSnapshot(
      raw.u as SyncedPowerUpSnapshot | undefined,
      this.cachedGameState?.powerups ?? [],
    );
    const nextPedestals = this.mergePedestalSnapshot(
      raw.pd as SyncedPowerUpPedestalSnapshot | undefined,
      this.cachedGameState?.pedestals ?? [],
    );
    const nextBurningGround = this.mergeBurningGroundDelta(
      raw.fg as EncodedBurningGroundDelta | undefined,
      this.cachedGameState?.burningGround ?? { cells: [] },
    );

    const state: GameState = {
      worldRevision: expectedWorldRevision,
      roundStartTime,
      players:       decodePlayerStates(raw.p as Parameters<typeof decodePlayerStates>[0]),
      projectiles:   applyProjectileSnapshot(
        this.projectileStaticCache,
        raw.j as SyncedProjectileSnapshot | undefined,
      ),
      enemies:       (raw.e as SyncedEnemySnapshot | undefined) ?? null,
      rocks:         nextRocks,
      rockRemovals:  rockSnapshot?.removals ?? [],
      placeableRocks: (raw.br as SyncedPlaceableRock[] | undefined) ?? [],
      reinforcementMatrices: (raw.oc as SyncedReinforcementMatrix[] | undefined) ?? [],
      energyInjectorEffects: (raw.ei as SyncedEnergyInjectorEffect[] | undefined) ?? [],
      energyInjectorFocus: (raw.fi as SyncedEnergyInjectorFocus[] | undefined) ?? [],
      remoteControlTurrets: (raw.rc as SyncedRemoteControlTurret[] | undefined) ?? [],
      decoys:        (raw.dc as SyncedDecoy[]       | undefined) ?? [],
      smokes:        (raw.s as SyncedSmokeCloud[]   | undefined) ?? [],
      fires:         (raw.f as SyncedFireZone[]      | undefined) ?? [],
      stinkClouds:   (raw.sc as SyncedStinkCloud[]   | undefined) ?? [],
      timeBubbles:   (raw.tb as SyncedTimeBubble[]   | undefined) ?? [],
      teslaDomes:    (raw.td as SyncedTeslaDome[]    | undefined) ?? [],
      energyShields: (raw.es as SyncedEnergyShield[] | undefined) ?? [],
      guardianSpirits: (raw.g as SyncedGuardianSpirit[] | undefined) ?? [],
      repairDrones: (raw.rd as SyncedRepairDrone[] | undefined) ?? [],
      slimeTrail: decodeSlimeTrailSnapshot(raw.sl),
      targetVulnerabilities: decodeTargetVulnerabilities(raw.vu),
      ak47StrategicTargets: (raw.st as SyncedAk47StrategicTarget[] | undefined) ?? [],
      burningGround: nextBurningGround,
      powerups:      nextPowerUps,
      pedestals:     nextPedestals,
      nukes:         (raw.n  as SyncedNukeStrike[]       | undefined) ?? [],
      airstrikes:    (raw.ak as SyncedAirstrikeStrike[] | undefined) ?? [],
      meteors:       (raw.mt as SyncedMeteorStrike[]    | undefined) ?? [],
      tunnels:       (raw.tn as SyncedTunnel[]          | undefined) ?? [],
      train:         (raw.t as SyncedTrainState      | undefined) ?? null,
      bases:         (raw.b as SyncedBaseState[]     | undefined) ?? [],
      captureTheBeer: (raw.cb as SyncedCaptureTheBeerState | undefined) ?? null,
      coopDefenseCarry: (raw.cc as SyncedCoopDefenseCarryState | undefined) ?? [],
    };
    this.cachedGameState = state;
    this.gameStateVersion++;
    return state;
  }

  private ensureGameStateWorldRevision(worldRevision: number | null): void {
    if (this.cachedGameStateWorldRevision === worldRevision) return;
    this.cachedGameStateWorldRevision = worldRevision;
    this.cachedGameState = undefined;
    this.lastSeenSeq = -1;
    this.projectileStaticCache.clear();
  }

  private mergePowerUpSnapshot(snapshot: SyncedPowerUpSnapshot | undefined, previous: readonly SyncedPowerUp[]): SyncedPowerUp[] {
    if (!snapshot) return [...previous];
    if (snapshot.full) {
      return [...snapshot.upserts].sort((left, right) => left.uid - right.uid);
    }

    const next = new Map<number, SyncedPowerUp>();
    for (const powerUp of previous) {
      next.set(powerUp.uid, powerUp);
    }
    for (const uid of snapshot.removals) {
      next.delete(uid);
    }
    for (const powerUp of snapshot.upserts) {
      next.set(powerUp.uid, powerUp);
    }
    return [...next.values()].sort((left, right) => left.uid - right.uid);
  }

  private mergePedestalSnapshot(
    snapshot: SyncedPowerUpPedestalSnapshot | undefined,
    previous: readonly SyncedPowerUpPedestal[],
  ): SyncedPowerUpPedestal[] {
    if (!snapshot) return [...previous];
    if (snapshot.full) {
      return [...snapshot.upserts].sort((left, right) => left.id - right.id);
    }

    const next = new Map<number, SyncedPowerUpPedestal>();
    for (const pedestal of previous) {
      next.set(pedestal.id, pedestal);
    }
    for (const id of snapshot.removals) {
      next.delete(id);
    }
    for (const pedestal of snapshot.upserts) {
      next.set(pedestal.id, pedestal);
    }
    return [...next.values()].sort((left, right) => left.id - right.id);
  }

  private mergeRockSnapshot(snapshot: SyncedRockSnapshot | undefined, previous: readonly RockNetState[]): RockNetState[] {
    if (!snapshot) return [...previous];
    if (snapshot.full) {
      const next = new Map<number, RockNetState>();
      for (const rock of snapshot.upserts) {
        next.set(rock.id, rock);
      }
      for (const id of snapshot.removals) {
        next.delete(id);
      }
      return [...next.values()].sort((left, right) => left.id - right.id);
    }

    const next = new Map<number, RockNetState>();
    for (const rock of previous) {
      next.set(rock.id, rock);
    }
    for (const id of snapshot.removals) {
      next.delete(id);
    }
    for (const rock of snapshot.upserts) {
      next.set(rock.id, rock);
    }
    return [...next.values()].sort((left, right) => left.id - right.id);
  }

  /** Monoton steigender Zähler, wird nur bei tatsächlich neuem Server-State inkrementiert. */
  getGameStateVersion(): number { return this.gameStateVersion; }

  // ── Zug-Event: Host → Alle (global, reliable, je Einfahrt aktualisiert) ────

  /**
   * Host-only: Veröffentlicht die nächste Zug-Einfahrt. Wird pro Runde mehrfach gesendet –
   * jede Wiedereinfahrt trägt eine neue Richtung und ein neues `spawnAt`.
   */
  publishTrainEvent(cfg: TrainEventConfig): void {
    setState(KEY_TRAIN_EVENT, cfg, true);
  }

  /** Host-only: Löscht das Zug-Event (Map ohne Zug bzw. keine weitere Einfahrt). */
  clearTrainEvent(): void {
    setState(KEY_TRAIN_EVENT, null, true);
  }

  /** Liest die Zug-Event-Konfiguration (undefined = kein Zug bzw. keine weitere Einfahrt). */
  getTrainEvent(): TrainEventConfig | undefined {
    return (getState(KEY_TRAIN_EVENT) as TrainEventConfig | null | undefined) ?? undefined;
  }

  // ── Zug-Zerstörung: Host → Alle (RPC, einmalig) ───────────────────────────

  /** Host-only: Broadcastet, dass der Zug zerstört wurde. */
  broadcastTrainDestroyed(): void {
    this.broadcastGameplayEvent('trdes', {});
  }

  /** Registriert einen Handler für die Zug-Zerstörung (alle Clients inkl. Host). */
  registerTrainDestroyedHandler(cb: () => void): void {
    this.trainDestroyedHandler = cb;
    this.registerAllRpcHandler('trdes', async (): Promise<unknown> => {
      this.trainDestroyedHandler?.();
      return undefined;
    });
  }

  // ── Loadout-RPC: Client → Host ────────────────────────────────────────────

  sendHeldActionStart(actionId: string, kind: HostHeldActionKind, durationMs: number, toolRef?: LoadoutToolRef): void {
    if (this.getWorldActionRevision() === null) return;
    if (isHost()) {
      this.heldActionHandler?.(myPlayer().id, 'start', actionId, kind, durationMs, toolRef);
      return;
    }
    this.sendWorldRpc('hact', { op: 'start', aid: actionId, kind, dur: durationMs, toolRef });
  }

  sendHeldActionCancel(actionId: string): void {
    if (this.getWorldActionRevision() === null) return;
    if (isHost()) {
      this.heldActionHandler?.(myPlayer().id, 'cancel', actionId);
      return;
    }
    this.sendWorldRpc('hact', { op: 'cancel', aid: actionId });
  }

  registerHeldActionHandler(
    handler: (
      playerId: string,
      operation: 'start' | 'cancel',
      actionId: string,
      kind?: HostHeldActionKind,
      durationMs?: number,
      toolRef?: LoadoutToolRef,
    ) => boolean,
  ): void {
    this.heldActionHandler = handler;
    this.registerHostRpcHandler('hact', (data: unknown, caller: PlayerState): boolean => {
      if (!isHost() || !this.acceptsWorldRpc(data)) return false;
      const { op, aid, kind, dur, toolRef: rawToolRef } = data as {
        op?: unknown;
        aid?: unknown;
        kind?: unknown;
        dur?: unknown;
        toolRef?: unknown;
      };
      if ((op !== 'start' && op !== 'cancel')
        || typeof aid !== 'string' || aid.length === 0 || aid.length > 80 || aid.trim() !== aid) return false;
      if (op === 'cancel') return this.heldActionHandler?.(caller.id, op, aid) === true;
      if ((kind !== 'charged_throw' && kind !== 'charged_gate' && kind !== 'global_dismantle')
        || !isFiniteNumber(dur) || dur <= 0 || dur > 30_000) return false;
      if (rawToolRef !== undefined
        && (!isRecord(rawToolRef) || rawToolRef.kind !== 'utility' || typeof rawToolRef.id !== 'string')) {
        return false;
      }
      const toolRef = rawToolRef === undefined
        ? undefined
        : { kind: 'utility' as const, id: (rawToolRef as { id: string }).id };
      return this.heldActionHandler?.(caller.id, op, aid, kind, dur, toolRef) === true;
    });
  }

  async sendLoadoutUse(
    slot: LoadoutSlot,
    angle: number,
    targetX: number,
    targetY: number,
    shotId?: number,
    params?: LoadoutUseParams,
    clientX?: number,
    clientY?: number,
    clientNow?: number,
    awaitResult = false,
    predictionId?: number,
  ): Promise<LoadoutUseResult | null> {
    const worldRevision = this.getWorldActionRevision();
    if (worldRevision === null) return { ok: false, reason: 'blocked' };
    if (isHost()) {
      return this.loadoutUseHandler?.(slot, angle, targetX, targetY, myPlayer().id, shotId, params, clientX, clientY, clientNow) ?? { ok: false, reason: 'invalid' };
    }
    const payload = {
      slot,
      angle,
      tx: targetX,
      ty: targetY,
      sid: shotId,
      prm: params,
      px: clientX,
      py: clientY,
      ts: clientNow,
      pid: predictionId,
      // Every client action is bound to the World it was created in. The host rejects it if the
      // World was restarted while the RPC was in flight.
      wr: worldRevision,
    };
    if (!awaitResult) {
      this.sendHostRpc('lu', payload);
      return null;
    }
    const result = await this.callHostRpc('lu', payload, 1200);
    return (result as LoadoutUseResult | undefined) ?? { ok: false, reason: 'invalid' };
  }

  registerLoadoutUseHandler(
    handler: (
      slot: LoadoutSlot,
      angle: number,
      targetX: number,
      targetY: number,
      senderId: string,
      shotId?: number,
      params?: LoadoutUseParams,
      clientX?: number,
      clientY?: number,
      clientNow?: number,
    ) => LoadoutUseResult,
  ): void {
    this.loadoutUseHandler = handler;
    this.registerHostRpcHandler('lu', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return undefined;
      const loadoutUseHandler = this.loadoutUseHandler;
      if (!loadoutUseHandler) return undefined;
      const { slot, angle, tx, ty, sid, prm, px, py, ts, wr } = data as {
        slot: LoadoutSlot;
        angle: number;
        tx: number;
        ty: number;
        sid?: number;
        prm?: LoadoutUseParams;
        px?: number;
        py?: number;
        ts?: number;
        wr?: number;
        pid?: number;
      };
      const predictionId = (data as { pid?: unknown }).pid;
      const isWeapon2Prediction = slot === 'weapon2'
        && Number.isSafeInteger(predictionId)
        && (predictionId as number) > 0
        && Number.isSafeInteger(wr);
      const finish = (result: LoadoutUseResult): LoadoutUseResult => {
        const withWorld = isWeapon2Prediction
          ? { ...result, worldRevision: wr } satisfies LoadoutUseResult
          : result;
        if (!isWeapon2Prediction || !this.acceptsWorldRpc(data)) return withWorld;
        const state = this.getWeapon2PredictionState(wr as number, caller.id);
        const id = predictionId as number;
        const cached = state.finalResults.get(id);
        if (cached) {
          this.recordWeapon2PredictionCompleted(state, id);
          return {
            ...cached,
            worldRevision: wr,
            weapon2PredictionAck: state.nextContiguousAck,
          };
        }
        const finalResult = {
          ...withWorld,
          weapon2PredictionAck: state.nextContiguousAck,
        } satisfies LoadoutUseResult;
        state.finalResults.set(id, finalResult);
        this.recordWeapon2PredictionCompleted(state, id);
        return {
          ...finalResult,
          weapon2PredictionAck: state.nextContiguousAck,
        };
      };
      if (!this.acceptsWorldRpc(data)) return { ok: false, reason: 'blocked' };
      if (!['weapon1', 'weapon2', 'utility', 'ultimate'].includes(slot)
        || !isFiniteNumber(angle)
        || !isFiniteNumber(tx)
        || !isFiniteNumber(ty)
        || (sid !== undefined && !isFiniteNumber(sid))
        || (px !== undefined && !isFiniteNumber(px))
        || (py !== undefined && !isFiniteNumber(py))
        || (ts !== undefined && !isFiniteNumber(ts))
        || (prm !== undefined && !isRecord(prm))) {
        return finish({ ok: false, reason: 'invalid' });
      }
      if (isWeapon2Prediction) {
        const state = this.getWeapon2PredictionState(wr as number, caller.id);
        const cached = state.finalResults.get(predictionId as number);
        if (cached) {
          this.recordWeapon2PredictionCompleted(state, predictionId as number);
          return {
            ...cached,
            worldRevision: wr,
            weapon2PredictionAck: state.nextContiguousAck,
          };
        }
      }
      // Verwende Client-Timestamp für Cooldown-Tracking (verhindert Schussverlust bei variierender RPC-Latenz).
      // Plausibilitätsprüfung: Max. 200ms Abweichung vom Host-Time (Anti-Cheat).
      const hostNow = Date.now();
      const clientNow = (typeof ts === 'number' && Math.abs(hostNow - ts) <= 200) ? ts : hostNow;
      return finish(loadoutUseHandler(slot, angle, tx, ty, caller.id, sid, prm, px, py, clientNow));
    });
  }

  // ── Power-Up-Pickup-RPC: Client → Host ────────────────────────────────────

  async sendPickupPowerUp(uid: number): Promise<boolean> {
    const worldRevision = this.getWorldActionRevision();
    if (worldRevision === null) return false;
    if (isHost()) {
      return this.powerUpPickupHandler?.(uid, myPlayer().id) === true;
    }
    const result = await this.callHostRpc('pup', { uid, wr: worldRevision }, 1_200).catch(() => false);
    return result === true;
  }

  registerPickupPowerUpHandler(handler: (uid: number, playerId: string) => boolean): void {
    this.powerUpPickupHandler = handler;
    this.registerHostRpcHandler('pup', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return undefined;
      const cb = this.powerUpPickupHandler;
      if (!cb) return undefined;
      if (!this.acceptsWorldRpc(data)) return undefined;
      const { uid } = data as { uid: number; wr: number };
      if (!Number.isSafeInteger(uid) || uid < 0) return undefined;
      return cb(uid, caller.id);
    });
  }

  sendDecoyStealthBreakRequest(): void {
    if (this.getWorldActionRevision() === null) return;
    if (isHost()) {
      this.decoyStealthBreakHandler?.(myPlayer().id);
      return;
    }
    this.sendWorldRpc('dbr', {});
  }

  registerDecoyStealthBreakHandler(handler: (playerId: string) => void): void {
    this.decoyStealthBreakHandler = handler;
    this.registerHostRpcHandler('dbr', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost() || !this.acceptsWorldRpc(data)) return undefined;
      this.decoyStealthBreakHandler?.(caller.id);
      return undefined;
    });
  }

  // ── Explosions-Effekt-RPC: Host → Alle ────────────────────────────────────

  broadcastExplosionEffect(x: number, y: number, radius: number, color?: number, visualStyle?: ExplosionVisualStyle): void {
    this.broadcastGameplayEvent('xfx', { x, y, r: radius, c: color, s: visualStyle });
  }

  registerExplosionEffectHandler(handler: (x: number, y: number, radius: number, color?: number, visualStyle?: ExplosionVisualStyle) => void): void {
    this.explosionEffectHandler = handler;
    this.registerAllRpcHandler('xfx', async (data: unknown): Promise<unknown> => {
      const explosionEffectHandler = this.explosionEffectHandler;
      if (!explosionEffectHandler) return undefined;
      const { x, y, r, c, s } = data as { x: number; y: number; r: number; c?: number; s?: ExplosionVisualStyle };
      explosionEffectHandler(x, y, r, c, s);
      return undefined;
    });
  }

  private buildBurningGroundDelta(snapshot: SyncedBurningGroundSnapshot): EncodedBurningGroundDelta | null {
    this.burningGroundPublishTicks++;
    const current = new Map<number, EncodedBurningGroundCell>();
    for (const cell of snapshot.cells) current.set(cell.id, encodeBurningGroundCell(cell));

    const sendFull = this.burningGroundPublishTicks === 1
      || this.burningGroundPublishTicks % NET_TICK_RATE_HZ === 0;
    if (sendFull) {
      this.lastPublishedBurningGround.clear();
      for (const [id, encoded] of current) this.lastPublishedBurningGround.set(id, encoded);
      return { f: [...current.values()] };
    }

    const upserts: EncodedBurningGroundCell[] = [];
    const removals: number[] = [];
    for (const [id, encoded] of current) {
      const previous = this.lastPublishedBurningGround.get(id);
      if (!previous || previous.some((value, index) => value !== encoded[index])) upserts.push(encoded);
    }
    for (const id of this.lastPublishedBurningGround.keys()) {
      if (!current.has(id)) removals.push(id);
    }
    this.lastPublishedBurningGround.clear();
    for (const [id, encoded] of current) this.lastPublishedBurningGround.set(id, encoded);
    if (upserts.length === 0 && removals.length === 0) return null;
    return {
      ...(upserts.length > 0 ? { u: upserts } : {}),
      ...(removals.length > 0 ? { r: removals } : {}),
    };
  }

  private buildFullBurningGroundDelta(snapshot: SyncedBurningGroundSnapshot): EncodedBurningGroundDelta {
    this.burningGroundPublishTicks += 1;
    this.lastPublishedBurningGround.clear();
    const full = snapshot.cells.map((cell) => {
      const encoded = encodeBurningGroundCell(cell);
      this.lastPublishedBurningGround.set(cell.id, encoded);
      return encoded;
    });
    return { f: full };
  }

  private mergeBurningGroundDelta(
    delta: EncodedBurningGroundDelta | undefined,
    previous: SyncedBurningGroundSnapshot,
  ): SyncedBurningGroundSnapshot {
    const now = Date.now();
    if (delta?.f) {
      return { cells: delta.f.map(decodeBurningGroundCell).filter(cell => cell.expiresAt > now) };
    }
    const cells = new Map(previous.cells.filter(cell => cell.expiresAt > now).map(cell => [cell.id, cell]));
    for (const id of delta?.r ?? []) cells.delete(id);
    for (const encoded of delta?.u ?? []) {
      const cell = decodeBurningGroundCell(encoded);
      if (cell.expiresAt > now) cells.set(cell.id, cell);
    }
    return { cells: [...cells.values()].sort((left, right) => left.id - right.id) };
  }

  /** Repliziert die Zielzellen der Schleimbluete fuer identische Einschlagsorte auf allen Clients. */
  broadcastSlimeBloomEffect(x: number, y: number, targets: readonly SlimeBloomTarget[]): void {
    this.broadcastGameplayEvent('sbfx', { x, y, p: targets.flatMap(target => [target.x, target.y]) });
  }

  registerSlimeBloomEffectHandler(handler: SlimeBloomEffectHandler): void {
    this.slimeBloomEffectHandler = handler;
    this.registerAllRpcHandler('sbfx', async (data: unknown): Promise<unknown> => {
      const slimeBloomEffectHandler = this.slimeBloomEffectHandler;
      if (!slimeBloomEffectHandler) return undefined;
      const { x, y, p } = data as { x: number; y: number; p: number[] };
      const targets: SlimeBloomTarget[] = [];
      for (let index = 0; index + 1 < p.length; index += 2) {
        targets.push({ x: p[index], y: p[index + 1] });
      }
      slimeBloomEffectHandler(x, y, targets);
      return undefined;
    });
  }

  /**
   * Repliziert die Leichen-Marker der Nekromantie. Der Host ist die einzige Stelle, die weiß,
   * welche Leichen überhaupt verwertbar sind; Clients zeichnen nur nach.
   */
  broadcastCorpseMarker(corpseId: number, x: number, y: number, enemySize: number, lifetimeMs: number): void {
    this.broadcastGameplayEvent('ncfx', { i: corpseId, x, y, s: enemySize, t: lifetimeMs });
  }

  broadcastCorpseMarkerRemoval(corpseId: number): void {
    this.broadcastGameplayEvent('ncfx', { i: corpseId, x: 0, y: 0, s: 0, t: 0 });
  }

  registerCorpseMarkerHandler(handler: CorpseMarkerHandler): void {
    this.corpseMarkerHandler = handler;
    this.registerAllRpcHandler('ncfx', async (data: unknown): Promise<unknown> => {
      const corpseMarkerHandler = this.corpseMarkerHandler;
      if (!corpseMarkerHandler) return undefined;
      const { i, x, y, s, t } = data as { i: number; x: number; y: number; s: number; t: number };
      corpseMarkerHandler(i, x, y, s, t);
      return undefined;
    });
  }

  broadcastFireChunkEffect(
    x: number,
    y: number,
    targets: readonly FireChunkTarget[],
    landsAt: number,
    visualStyle: GroundFireVisualStyle = 'normal',
  ): void {
    this.broadcastGameplayEvent('fcfx', {
      x,
      y,
      t: landsAt,
      p: targets.flatMap(target => [target.x, target.y]),
      ...(visualStyle === 'void' ? { v: 1 } : {}),
    });
  }

  registerFireChunkEffectHandler(handler: FireChunkEffectHandler): void {
    this.fireChunkEffectHandler = handler;
    this.registerAllRpcHandler('fcfx', async (data: unknown): Promise<unknown> => {
      const fireChunkEffectHandler = this.fireChunkEffectHandler;
      if (!fireChunkEffectHandler) return undefined;
      const { x, y, t, p, v } = data as { x: number; y: number; t: number; p: number[]; v?: number };
      const targets: FireChunkTarget[] = [];
      for (let index = 0; index + 1 < p.length; index += 2) targets.push({ x: p[index], y: p[index + 1] });
      fireChunkEffectHandler(x, y, targets, t, v === 1 ? 'void' : 'normal');
      return undefined;
    });
  }

  broadcastBlackHoleEffect(x: number, y: number, radius: number, durationMs: number): void {
    this.broadcastGameplayEvent('bhfx', { x, y, r: radius, d: durationMs });
  }

  registerBlackHoleEffectHandler(handler: BlackHoleEffectHandler): void {
    this.blackHoleEffectHandler = handler;
    this.registerAllRpcHandler('bhfx', async (data: unknown): Promise<unknown> => {
      const blackHoleEffectHandler = this.blackHoleEffectHandler;
      if (!blackHoleEffectHandler) return undefined;
      const { x, y, r, d } = data as { x: number; y: number; r: number; d: number };
      blackHoleEffectHandler(x, y, r, d);
      return undefined;
    });
  }

  // ── Granaten-Countdown-RPC: Host → Alle ──────────────────────────────────

  broadcastGrenadeCountdown(x: number, y: number, value: number): void {
    this.broadcastGameplayEvent('gcnt', { x, y, v: value });
  }

  registerGrenadeCountdownHandler(handler: (x: number, y: number, value: number) => void): void {
    this.grenadeCountdownHandler = handler;
    this.registerAllRpcHandler('gcnt', async (data: unknown): Promise<unknown> => {
      const cb = this.grenadeCountdownHandler;
      if (!cb) return undefined;
      const { x, y, v } = data as { x: number; y: number; v: number };
      cb(x, y, v);
      return undefined;
    });
  }

  // ── Effekt-RPC: Host → Alle (visuelles Feedback) ──────────────────────────
  /**
   * Reiht einen Treffer-/Todes-Effekt zur Sammelübertragung ein, statt sofort ein eigenes RPC zu senden.
   * Bei flächigem Schaden (eine Explosion trifft Dutzende Gegner) entstand sonst pro Treffer ein
   * RPC.call im selben Frame – der Hauptgrund für die Host-`step`-Spikes. {@link flushEffects} sendet
   * alle gesammelten Effekte einmal pro Frame als ein einziges Batch-RPC.
   */
  broadcastEffect(effect: SyncedCombatEffect): void {
    this.pendingEffects.push(effect);
  }

  /**
   * Sendet alle in diesem Frame gesammelten Effekte und XP-Popups als je ein Batch-RPC.
   * Host-seitig einmal pro Frame aufrufen.
   */
  flushEffects(): void {
    if (this.pendingEffects.length > 0) {
      const batch = this.pendingEffects;
      this.pendingEffects = [];
      this.broadcastGameplayEvent('fxb', batch);
    }
    if (this.pendingXpPopups.length > 0) {
      const popups = this.pendingXpPopups;
      this.pendingXpPopups = [];
      this.broadcastGameplayEvent('cdxpb', popups);
    }
  }

  registerEffectHandler(cb: (effect: SyncedCombatEffect) => void): void {
    this.effectHandler = cb;
    this.registerAllRpcHandler('fxb', async (data: unknown): Promise<unknown> => {
      const effectHandler = this.effectHandler;
      if (!effectHandler) return undefined;
      const effects = data as SyncedCombatEffect[];
      for (let i = 0; i < effects.length; i += 1) {
        effectHandler(effects[i]);
      }
      return undefined;
    });
  }

  // ── Shot-Feedback-RPC: Host → Alle (Screenshake bei Schuss) ───────────────
  broadcastShotFx(shooterId: string, duration: number, intensity: number): void {
    this.broadcastGameplayEvent('sfx', { id: shooterId, d: duration, i: intensity });
  }

  registerShotFxHandler(cb: (shooterId: string, duration: number, intensity: number) => void): void {
    this.registerAllRpcHandler('sfx', async (data: unknown): Promise<unknown> => {
      const { id, d, i } = data as { id: string; d: number; i: number };
      cb(id, d, i);
      return undefined;
    });
  }

  broadcastHitscanTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    color: number,
    thickness: number,
    impactKind?: HitscanImpactKind,
    visualPreset?: HitscanVisualPreset,
    shooterId?: string,
    shotId?: number,
    shotAudioKey?: ShotAudioKey,
    visualStartX?: number,
    visualStartY?: number,
  ): void {
    this.broadcastGameplayEvent('htfx', { sx: startX, sy: startY, ex: endX, ey: endY, c: color, t: thickness, ik: impactKind, vp: visualPreset, id: shooterId, sid: shotId, sa: shotAudioKey, vsx: visualStartX, vsy: visualStartY });
  }

  registerHitscanTracerHandler(handler: HitscanTracerHandler): void {
    this.hitscanTracerHandler = handler;
    this.registerAllRpcHandler('htfx', async (data: unknown): Promise<unknown> => {
      const hitscanTracerHandler = this.hitscanTracerHandler;
      if (!hitscanTracerHandler) return undefined;
      const { sx, sy, ex, ey, c, t, ik, vp, id, sid, sa, vsx, vsy } = data as {
        sx: number;
        sy: number;
        ex: number;
        ey: number;
        c: number;
        t: number;
        ik?: HitscanImpactKind;
        vp?: HitscanVisualPreset;
        id?: string;
        sid?: number;
        sa?: ShotAudioKey;
        vsx?: number;
        vsy?: number;
      };
      hitscanTracerHandler(sx, sy, ex, ey, c, t, ik, vp, id, sid, sa, vsx, vsy);
      return undefined;
    });
  }

  // ── Translocator-Effekt-RPC: Host → Alle ───────────────────────────────────

  /**
   * @param subjectId Wer sich teleportiert – Spieler-ID oder Gegner-ID. Nur dadurch kann der
   *   Client entscheiden, ob es der **lokale** Spieler war; die Farbe taugt dafür nicht, weil
   *   sie auch Gegner tragen. Optional, damit ältere Sender weiterhin gültig bleiben.
   */
  broadcastTranslocatorFlash(
    x: number,
    y: number,
    color: number,
    type: 'start' | 'end',
    subjectId?: string,
  ): void {
    this.broadcastGameplayEvent('tlfx', { x, y, c: color, t: type, s: subjectId });
  }

  registerTranslocatorFlashHandler(handler: TranslocatorFlashHandler): void {
    this.translocatorFlashHandler = handler;
    this.registerAllRpcHandler('tlfx', async (data: unknown): Promise<unknown> => {
      const translocatorFlashHandler = this.translocatorFlashHandler;
      if (!translocatorFlashHandler) return undefined;
      const { x, y, c, t, s } = data as {
        x: number; y: number; c: number; t: 'start' | 'end'; s?: string;
      };
      translocatorFlashHandler(x, y, c, t, s);
      return undefined;
    });
  }

  broadcastCaptureTheBeerFx(event: CaptureTheBeerFxEvent): void {
    if (event.kind === 'drop' || event.kind === 'score') {
      this.broadcastGameplayEvent('btfx', {
        k: event.kind,
        bt: event.beerTeamId,
        x: event.x,
        y: event.y,
        ...(event.kind === 'score' ? { st: event.scoreTeamId, sn: event.scorerName, sc: event.scorerColor } : {}),
      });
      return;
    }

    this.broadcastGameplayEvent('btfx', {
      k: 'reset',
      bt: event.beerTeamId,
      sx: event.sourceX,
      sy: event.sourceY,
      tx: event.targetX,
      ty: event.targetY,
    });
  }

  registerCaptureTheBeerFxHandler(handler: CaptureTheBeerFxHandler): void {
    this.captureTheBeerFxHandler = handler;
    this.registerAllRpcHandler('btfx', async (data: unknown): Promise<unknown> => {
      const captureTheBeerFxHandler = this.captureTheBeerFxHandler;
      if (!captureTheBeerFxHandler) return undefined;
      const payload = data as {
        k: CaptureTheBeerFxEvent['kind'];
        bt: TeamId;
        x?: number;
        y?: number;
        st?: TeamId;
        sn?: string;
        sc?: number;
        sx?: number;
        sy?: number;
        tx?: number;
        ty?: number;
      };

      if (payload.k === 'reset') {
        captureTheBeerFxHandler({
          kind: 'reset',
          beerTeamId: payload.bt,
          sourceX: payload.sx ?? 0,
          sourceY: payload.sy ?? 0,
          targetX: payload.tx ?? 0,
          targetY: payload.ty ?? 0,
        });
        return undefined;
      }

      if (payload.k === 'score') {
        captureTheBeerFxHandler({
          kind: 'score',
          beerTeamId: payload.bt,
          scoreTeamId: payload.st ?? payload.bt,
          scorerName: payload.sn ?? 'Unknown',
          scorerColor: payload.sc ?? 0xe0e0e0,
          x: payload.x ?? 0,
          y: payload.y ?? 0,
        });
        return undefined;
      }

      captureTheBeerFxHandler({
        kind: 'drop',
        beerTeamId: payload.bt,
        x: payload.x ?? 0,
        y: payload.y ?? 0,
      });
      return undefined;
    });
  }

  /**
   * Abgabe eines Coop-Defense-Carry-Objekts. Eigenes Ereignis statt `btfx`: Der Burst gehört
   * hier zu einem Missionsschritt, nicht zu einem Team-Punktestand, und darf deshalb nicht an
   * die Capture-The-Beer-Nutzlast (Team, Scorer-Name) gebunden werden.
   */
  broadcastCoopDefenseCarryDeliveredFx(x: number, y: number): void {
    this.broadcastGameplayEvent('cdcfx', { x, y });
  }

  registerCoopDefenseCarryDeliveredFxHandler(handler: CoopDefenseCarryDeliveredFxHandler): void {
    this.coopDefenseCarryDeliveredFxHandler = handler;
    this.registerAllRpcHandler('cdcfx', async (data: unknown): Promise<unknown> => {
      const coopDefenseCarryDeliveredFxHandler = this.coopDefenseCarryDeliveredFxHandler;
      if (!coopDefenseCarryDeliveredFxHandler) return undefined;
      const { x, y } = data as { x: number; y: number };
      coopDefenseCarryDeliveredFxHandler(x, y);
      return undefined;
    });
  }

  // ── Melee-Swing-RPC: Host → Alle ──────────────────────────────────────────

  broadcastMeleeSwing(swing: SyncedMeleeSwing): void {
    this.broadcastGameplayEvent('msfx', {
      sid: swing.swingId, x: swing.x, y: swing.y,
      a: swing.angle, ad: swing.arcDegrees, r: swing.range,
      c: swing.color, id: swing.shooterId,
      vp: swing.visualPreset,
      hp: swing.hitPlayer,
      hx: swing.impactX,
      hy: swing.impactY,
      sa: swing.shotAudioKey,
    });
  }

  registerMeleeSwingHandler(handler: (swing: SyncedMeleeSwing) => void): void {
    this.meleeSwingHandler = handler;
    this.registerAllRpcHandler('msfx', async (data: unknown): Promise<unknown> => {
      const meleeSwingHandler = this.meleeSwingHandler;
      if (!meleeSwingHandler) return undefined;
      const { sid, x, y, a, ad, r, c, id, vp, hp, hx, hy, sa } = data as {
        sid: number; x: number; y: number;
        a: number; ad: number; r: number;
        c: number; id: string;
        vp?: SyncedMeleeSwing['visualPreset'];
        hp?: boolean;
        hx?: number;
        hy?: number;
        sa?: string;
      };
      meleeSwingHandler({ swingId: sid, x, y, angle: a, arcDegrees: ad, range: r, color: c, shooterId: id, visualPreset: vp, hitPlayer: hp, impactX: hx, impactY: hy, shotAudioKey: sa });
      return undefined;
    });
  }

  // ── Dash-RPC: Client → Host ───────────────────────────────────────────────

  sendDash(dx: number, dy: number): void {
    if (this.getWorldActionRevision() === null) return;
    if (isHost()) {
      this.dashHandler?.(myPlayer().id, dx, dy);
      return;
    }
    this.sendWorldRpc('dash', { dx, dy });
  }

  registerDashHandler(cb: (playerId: string, dx: number, dy: number) => void): void {
    this.dashHandler = cb;
    this.registerHostRpcHandler('dash', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return;
      const dashHandler = this.dashHandler;
      if (!dashHandler) return undefined;
      if (!this.acceptsWorldRpc(data)) return undefined;
      const { dx, dy } = data as { dx: number; dy: number; wr: number };
      if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) return undefined;
      dashHandler(caller.id, dx, dy);
      return undefined;
    });
  }

  // ── Burrow-RPC: Client → Host ─────────────────────────────────────────────

  sendBurrowRequest(wantsBurrowed: boolean): void {
    if (this.getWorldActionRevision() === null) return;
    if (isHost()) {
      this.burrowHandler?.(myPlayer().id, wantsBurrowed);
      return;
    }
    this.sendWorldRpc('burrow', { want: wantsBurrowed });
  }

  registerBurrowHandler(cb: (playerId: string, wantsBurrowed: boolean) => void): void {
    this.burrowHandler = cb;
    this.registerHostRpcHandler('burrow', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return;
      const burrowHandler = this.burrowHandler;
      if (!burrowHandler) return undefined;
      if (!this.acceptsWorldRpc(data)) return undefined;
      const { want } = data as { want: boolean; wr: number };
      if (typeof want !== 'boolean') return undefined;
      burrowHandler(caller.id, want);
      return undefined;
    });
  }

  // ── Schockwellen-Effekt: Host → Alle ─────────────────────────────────────

  broadcastShockwaveEffect(x: number, y: number): void {
    this.broadcastGameplayEvent('shockfx', { x, y });
  }

  broadcastTrainBurrowSparks(x: number, y: number): void {
    this.broadcastGameplayEvent('tbsparks', { x, y });
  }

  registerTrainBurrowSparksHandler(cb: (x: number, y: number) => void): void {
    this.trainBurrowSparksHandler = cb;
    this.registerAllRpcHandler('tbsparks', async (data: unknown): Promise<unknown> => {
      const handler = this.trainBurrowSparksHandler;
      if (!handler) return undefined;
      const { x, y } = data as { x: number; y: number };
      handler(x, y);
      return undefined;
    });
  }

  registerShockwaveEffectHandler(cb: (x: number, y: number) => void): void {
    this.shockwaveEffectHandler = cb;
    this.registerAllRpcHandler('shockfx', async (data: unknown): Promise<unknown> => {
      const shockwaveEffectHandler = this.shockwaveEffectHandler;
      if (!shockwaveEffectHandler) return undefined;
      const { x, y } = data as { x: number; y: number };
      shockwaveEffectHandler(x, y);
      return undefined;
    });
  }

  // ── BFG-Laser-RPC: Host → Alle ──────────────────────────────────────────

  broadcastBfgLaserBatch(
    lines: { sx: number; sy: number; ex: number; ey: number }[],
    color: number,
    visualPreset?: HitscanVisualPreset,
    projectileId?: number,
  ): void {
    if (lines.length === 0) return;
    this.broadcastGameplayEvent('bfl', { l: lines, c: color, v: visualPreset, pid: projectileId });
  }

  broadcastMiniRocketCollectionEffect(x: number, y: number, color: number): void {
    this.broadcastGameplayEvent('mrcfx', { x, y, c: color });
  }

  registerMiniRocketCollectionEffectHandler(handler: MiniRocketCollectionEffectHandler): void {
    this.miniRocketCollectionEffectHandler = handler;
    this.registerAllRpcHandler('mrcfx', async (data: unknown): Promise<unknown> => {
      const collectionHandler = this.miniRocketCollectionEffectHandler;
      if (!collectionHandler) return undefined;
      const { x, y, c } = data as { x: number; y: number; c: number };
      collectionHandler(x, y, c);
      return undefined;
    });
  }

  broadcastMiniRocketDestructionEffect(x: number, y: number, color: number): void {
    this.broadcastGameplayEvent('mrdfx', { x, y, c: color });
  }

  registerMiniRocketDestructionEffectHandler(handler: MiniRocketDestructionEffectHandler): void {
    this.miniRocketDestructionEffectHandler = handler;
    this.registerAllRpcHandler('mrdfx', async (data: unknown): Promise<unknown> => {
      const destructionHandler = this.miniRocketDestructionEffectHandler;
      if (!destructionHandler) return undefined;
      const { x, y, c } = data as { x: number; y: number; c: number };
      destructionHandler(x, y, c);
      return undefined;
    });
  }

  registerBfgLaserBatchHandler(handler: (lines: { sx: number; sy: number; ex: number; ey: number }[], color: number, visualPreset?: HitscanVisualPreset, projectileId?: number) => void): void {
    this.bfgLaserHandler = handler;
    this.registerAllRpcHandler('bfl', async (data: unknown): Promise<unknown> => {
      const cb = this.bfgLaserHandler;
      if (!cb) return undefined;
      const { l, c, v, pid } = data as { l: { sx: number; sy: number; ex: number; ey: number }[]; c: number; v?: HitscanVisualPreset; pid?: number };
      cb(l, c, v, pid);
      return undefined;
    });
  }

  // ── Burrow-Visualisierung: Host → Alle ────────────────────────────────────

  broadcastBurrowVisual(playerId: string, phase: BurrowPhase): void {
    this.broadcastGameplayEvent('bfx', { id: playerId, p: phase });
  }

  registerBurrowVisualHandler(cb: (playerId: string, phase: BurrowPhase) => void): void {
    this.burrowVisualHandler = cb;
    this.registerAllRpcHandler('bfx', async (data: unknown): Promise<unknown> => {
      const burrowVisualHandler = this.burrowVisualHandler;
      if (!burrowVisualHandler) return undefined;
      const { id, p } = data as { id: string; p: BurrowPhase };
      burrowVisualHandler(id, p);
      return undefined;
    });
  }

  // ── Farbpool: Host → Alle (global, reliable) ─────────────────────────────

  /**
   * Host-only: Initialisiert den Farbpool falls noch nicht vorhanden.
   * Nur beim allerersten Start gesetzt, damit Reconnects bestehende Farben erhalten.
   */
  initColorPool(allColors: readonly number[]): void {
    if (!isHost()) return;
    this.knownPlayerColors = [...allColors];
    this.reconcileColorPool();
    // Wer beitritt, bevor die Szene den Pool kennt, bekaeme sonst nie eine Farbe:
    // hostAssignColor bricht bei leerem Pool ab und wird fuer ihn nie erneut aufgerufen.
    for (const playerId of this.connectedPlayers.keys()) this.hostAssignColor(playerId);
  }

  /** Liest den aktuellen Farbpool (kann von allen Clients gelesen werden). */
  getAvailableColors(): number[] {
    return (getState(KEY_AVAIL_COLORS) as number[] | undefined) ?? [];
  }

  /** Host-only: Überschreibt den Farbpool. */
  setAvailableColors(colors: number[]): void {
    setState(KEY_AVAIL_COLORS, colors, true);
  }

  // ── Spielerfarbe: pro Spieler ─────────────────────────────────────────────

  /**
   * Host-only: Weist einem Spieler automatisch eine zufällige verfügbare Farbe zu
   * und aktualisiert den Farbpool. Kein-Op wenn Spieler bereits eine Farbe hat.
   */
  hostAssignColor(playerId: string): void {
    if (!isHost()) return;
    if (this.getStoredPlayerColor(playerId) !== undefined) return;
    const available = this.computeAvailableColors();
    if (available.length === 0) return;
    const idx   = Math.floor(Math.random() * available.length);
    const color = available[idx];
    this.playerStateMap.get(playerId)?.setState(KEY_PLAYER_COLOR, color, true);
    this.reconcileColorPool();
    this.broadcastColorChange(playerId, color);
  }

  /**
   * Host-only: Gibt die Farbe eines Spielers bei Disconnect zurück in den Pool.
   */
  hostReclaimColor(playerId: string): void {
    if (!isHost()) return;
    const color = this.getStoredPlayerColor(playerId);
    if (color === undefined) return;
    this.reconcileColorPool();
  }

  /**
   * Host-only: Verarbeitet eine Farbwechsel-Anfrage eines Clients.
   * Gibt Farbe frei/reserviert und broadcastet das Ergebnis.
   */
  hostHandleColorRequest(requestedColor: number, requesterId: string): void {
    if (!isHost()) return;
    const available = this.computeAvailableColors();
    if (available.includes(requestedColor)) {
      this.playerStateMap.get(requesterId)?.setState(KEY_PLAYER_COLOR, requestedColor, true);
      this.reconcileColorPool();
      this.broadcastColorAccepted(requesterId, requestedColor);
      this.broadcastColorChange(requesterId, requestedColor);
    } else {
      this.broadcastColorDenied(requesterId);
    }
  }

  // ── Farb-RPCs ─────────────────────────────────────────────────────────────

  /** Client → Host: Farbwechsel-Anfrage. */
  sendColorRequest(color: number): void {
    this.sendHostRpc('crq', { c: color });
  }

  /** Host-only: Empfänger für Farbwechsel-Anfragen. */
  registerColorRequestHandler(
    handler: (requestedColor: number, requesterId: string) => void,
  ): void {
    this.colorRequestHandler = handler;
    this.registerHostRpcHandler('crq', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return undefined;
      const colorRequestHandler = this.colorRequestHandler;
      if (!colorRequestHandler) return undefined;
      colorRequestHandler((data as { c: number }).c, caller.id);
      return undefined;
    });
  }

  /** Host → Alle: Farbwechsel akzeptiert (alle Clients zeigen neue Farbe). */
  broadcastColorAccepted(requesterId: string, color: number): void {
    this.broadcastRpc('cac', { id: requesterId, c: color });
  }

  registerColorAcceptedHandler(
    handler: (requesterId: string, color: number) => void,
  ): void {
    this.colorAcceptedHandler = handler;
    this.registerAllRpcHandler('cac', async (data: unknown): Promise<unknown> => {
      const colorAcceptedHandler = this.colorAcceptedHandler;
      if (!colorAcceptedHandler) return undefined;
      const { id, c } = data as { id: string; c: number };
      colorAcceptedHandler(id, c);
      return undefined;
    });
  }

  /** Host → Alle: Farbwechsel abgelehnt (nur Requester zeigt Feedback). */
  broadcastColorDenied(requesterId: string): void {
    this.broadcastRpc('cdnd', { id: requesterId });
  }

  registerColorDeniedHandler(handler: (requesterId: string) => void): void {
    this.colorDeniedHandler = handler;
    this.registerAllRpcHandler('cdnd', async (data: unknown): Promise<unknown> => {
      const colorDeniedHandler = this.colorDeniedHandler;
      if (!colorDeniedHandler) return undefined;
      colorDeniedHandler((data as { id: string }).id);
      return undefined;
    });
  }

  /** Host → Alle: Farbzuweisung (auto-assign beim Join). */
  broadcastColorChange(playerId: string, color: number): void {
    this.broadcastRpc('cch', { id: playerId, c: color });
  }

  registerColorChangeHandler(
    handler: (playerId: string, color: number) => void,
  ): void {
    this.colorChangeHandler = handler;
    this.registerAllRpcHandler('cch', async (data: unknown): Promise<unknown> => {
      const colorChangeHandler = this.colorChangeHandler;
      if (!colorChangeHandler) return undefined;
      const { id, c } = data as { id: string; c: number };
      colorChangeHandler(id, c);
      return undefined;
    });
  }

  // ── Loadout-Auswahl: pro Spieler (per-player, reliable) ──────────────────

  /** Setzt die Loadout-Auswahl für einen Slot lokal (reliable). */
  setLocalLoadoutSlot(slot: LoadoutSlot, itemId: string): void {
    const key = { weapon1: KEY_LOADOUT_W1, weapon2: KEY_LOADOUT_W2, utility: KEY_LOADOUT_UT, ultimate: KEY_LOADOUT_UL }[slot];
    myPlayer().setState(key, itemId, true);
  }

  /** Liest die Loadout-Auswahl eines Spielers für einen Slot. */
  getPlayerLoadoutSlot(playerId: string, slot: LoadoutSlot): string | undefined {
    const key = { weapon1: KEY_LOADOUT_W1, weapon2: KEY_LOADOUT_W2, utility: KEY_LOADOUT_UT, ultimate: KEY_LOADOUT_UL }[slot];
    return this.playerStateMap.get(playerId)?.getState(key) as string | undefined;
  }

  /**
   * Publiziert die laufende Lobby-Auswahl des lokalen Spielers. Dieser Zustand ist bewusst
   * getrennt vom Ready-Commit: Eine Activity-lose World darf den aktuellen Coop-Build direkt
   * verwenden, ohne den verbindlichen LoadoutCommitSnapshot vorzeitig zu verwenden.
   */
  setLocalLobbyLoadoutPreview(preview: LobbyLoadoutPreviewState): void {
    const classId = isCoopDefenseClassId(preview.coopDefenseClassId)
      ? preview.coopDefenseClassId
      : null;
    const profile = preview.coopDefenseProfile != null
      ? sanitizeCoopDefenseUpgradeProfile(preview.coopDefenseProfile, classId ?? undefined)
      : null;
    const tools = classId === 'inspector_gadachs'
      ? this.sanitizeLobbyLoadoutTools(preview.tools)
      : [];
    const equippedItems = sanitizeCoopDefenseEquippedItems(preview.equippedItems);
    const next = { c: classId, p: profile, i: equippedItems, t: tools };
    const current = myPlayer().getState(KEY_LOBBY_LOADOUT_PREVIEW);
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    myPlayer().setState(KEY_LOBBY_LOADOUT_PREVIEW, next, true);
  }

  /** Liest den laufenden Live-Build; der Ready-Commit bleibt dafuer absichtlich unberuehrt. */
  getPlayerLobbyLoadoutPreview(playerId: string): LobbyLoadoutPreviewState | null {
    const raw = this.playerStateMap.get(playerId)?.getState(KEY_LOBBY_LOADOUT_PREVIEW);
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as { c?: unknown; p?: unknown; i?: unknown; t?: unknown };
    const classId = isCoopDefenseClassId(value.c) ? value.c : null;
    const profile = value.p != null
      ? sanitizeCoopDefenseUpgradeProfile(value.p, classId ?? undefined)
      : null;
    // `t` ist der kanonische aktive Tool-Slot. Das Profil bleibt die Rueckfallquelle fuer bereits
    // verbundene Peers, die nur die fruehere Inspector-Vorschau kennen.
    const tools = classId === 'inspector_gadachs'
      ? this.sanitizeLobbyLoadoutTools(value.t ?? profile?.toolLoadout)
      : [];
    return {
      coopDefenseClassId: classId,
      coopDefenseProfile: profile,
      equippedItems: sanitizeCoopDefenseEquippedItems(value.i),
      tools,
    };
  }

  /**
   * Aktuelle Loadout-Projektion fuer World-Gameplay. Bei laufender Activity bleibt der
   * Commit-Snapshot die Quelle; ohne Activity werden Slots plus Live-Build kombiniert.
   */
  getPlayerCurrentLoadoutSnapshot(playerId: string): LoadoutCommitSnapshot | null {
    if (this.getActivityDescriptor() !== null) return this.getPlayerCommittedLoadout(playerId);
    if (!this.playerStateMap.has(playerId)) return null;

    const preview = this.getPlayerLobbyLoadoutPreview(playerId);
    const mode = this.getGameMode();
    const weapon1 = this.getPlayerLoadoutSlot(playerId, 'weapon1') ?? DEFAULT_LOADOUT.weapon1.id;
    const weapon2 = this.getPlayerLoadoutSlot(playerId, 'weapon2') ?? DEFAULT_LOADOUT.weapon2.id;
    const utility = this.getPlayerLoadoutSlot(playerId, 'utility') ?? DEFAULT_LOADOUT.utility.id;
    const ultimate = this.getPlayerLoadoutSlot(playerId, 'ultimate') ?? DEFAULT_LOADOUT.ultimate.id;
    const coopDefenseClassId = isCoopDefenseMode(mode) ? preview?.coopDefenseClassId ?? null : null;
    return {
      weapon1,
      weapon2,
      utility,
      ultimate,
      coopDefenseClassId,
      coopDefenseProfile: isCoopDefenseMode(mode) ? preview?.coopDefenseProfile ?? null : null,
      tools: coopDefenseClassId === 'inspector_gadachs' ? preview?.tools.map((tool) => ({ ...tool })) : undefined,
      equippedItems: isCoopDefenseMode(mode) ? preview?.equippedItems ?? [] : [],
    };
  }

  private sanitizeLobbyLoadoutTools(raw: unknown): LoadoutToolRef[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((tool): tool is { kind: 'construction' | 'utility'; id: string } => (
        !!tool
        && typeof tool === 'object'
        && ((tool as { kind?: unknown }).kind === 'construction'
          || (tool as { kind?: unknown }).kind === 'utility')
        && typeof (tool as { id?: unknown }).id === 'string'
      ))
      .map((tool): LoadoutToolRef | null => {
        if (tool.kind === 'construction') {
          const id = normalizeConstructionId(tool.id);
          return id ? { kind: 'construction', id } : null;
        }
        const id = getUtilityBaseId(tool.id) ?? tool.id;
        return UTILITY_CONFIGS[id as keyof typeof UTILITY_CONFIGS] !== undefined
          ? { kind: 'utility', id }
          : null;
      })
      .filter((tool): tool is LoadoutToolRef => tool !== null)
      .slice(0, COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS);
  }

  /** Host-only: Publiziert bis wann die Utility eines Spielers im Cooldown ist. */
  publishUtilityCooldownUntil(playerId: string, cooldownUntil: number, utilityId = '__default__'): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    if (utilityId === '__clear__') {
      ps.setState(KEY_UTILITY_CD_UNTIL, {}, true);
      return;
    }
    const current = ps.getState(KEY_UTILITY_CD_UNTIL);
    const cooldowns: Record<string, number> = typeof current === 'number'
      ? { __default__: current }
      : (current && typeof current === 'object' ? { ...(current as Record<string, number>) } : {});
    cooldowns[utilityId] = cooldownUntil;
    ps.setState(KEY_UTILITY_CD_UNTIL, cooldowns, true);
  }

  /** Liest den autoritativen Utility-Cooldown-Endzeitpunkt eines Spielers (0 = bereit). */
  getPlayerUtilityCooldownUntil(playerId: string, utilityId = '__default__'): number {
    const value = this.playerStateMap.get(playerId)?.getState(KEY_UTILITY_CD_UNTIL);
    if (typeof value === 'number') return utilityId === '__default__' ? value : 0;
    if (!value || typeof value !== 'object') return 0;
    return (value as Record<string, number>)[utilityId] ?? 0;
  }

  /**
   * Host-only: Publiziert, welchen Slot die Figur eines Spielers sichtbar traegt.
   *
   * Bewusst reliable und nur bei einer Aenderung: Der Wert wechselt beim Waffenwechsel, also
   * hoechstens ein paar Mal pro Sekunde – im Delta-Snapshot mitzulaufen waere dauerhafte Last fuer
   * einen Zustand, der fast immer gleich bleibt. Repliziert wird der Slot, nicht die Item-ID: die
   * Loadout-Auswahl steht ohnehin schon je Spieler im Netzzustand.
   */
  publishHeldItemSlot(playerId: string, slot: HeldItemSlot): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    if (ps.getState(KEY_HELD_SLOT) === slot) return;
    ps.setState(KEY_HELD_SLOT, slot, true);
  }

  /** Slot, dessen Item die Figur eines Spielers sichtbar traegt. Vor dem ersten Einsatz: Waffe 1. */
  getPlayerHeldItemSlot(playerId: string): HeldItemSlot {
    const value = this.playerStateMap.get(playerId)?.getState(KEY_HELD_SLOT);
    return value === 'weapon2' || value === 'utility' ? value : 'weapon1';
  }

  /**
   * Loadout-Item-ID, die die Figur eines Spielers sichtbar traegt, oder `null`.
   *
   * Der verbindliche Ready-Snapshot hat Vorrang vor der laufenden Lobby-Auswahl: waehrend einer
   * Runde zaehlt, womit der Spieler angetreten ist. Ein temporaeres Utility-Override (Heilige
   * Handgranate, Missions-Item) ersetzt den Utility-Slot, weil genau dieses Item geworfen wird.
   */
  getPlayerHeldItemId(playerId: string): string | null {
    const slot = this.getPlayerHeldItemSlot(playerId);
    if (slot === 'utility') {
      const override = this.getPlayerUtilityOverrideDescriptor(playerId);
      if (override?.kind === 'utility') return override.utilityId;
    }
    return this.getPlayerCommittedLoadoutSlot(playerId, slot)
      ?? this.getPlayerLoadoutSlot(playerId, slot)
      ?? null;
  }

  /** Host-only: Publishes the stable ID of a temporary utility override. */
  publishUtilityOverrideId(playerId: string, utilityId: string): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_UTILITY_OVERRIDE_ID, utilityId, true);
  }

  /** Reads the current stable utility override ID (empty = no override). */
  getPlayerUtilityOverrideId(playerId: string): string {
    return (this.playerStateMap.get(playerId)?.getState(KEY_UTILITY_OVERRIDE_ID) as string | undefined) ?? '';
  }

  /** Host-only: Publishes the metadata required to reconstruct a temporary utility override. */
  publishUtilityOverrideDescriptor(playerId: string, descriptor: UtilityOverrideDescriptor | null): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_UTILITY_OVERRIDE_DESCRIPTOR, descriptor, true);
  }

  /** Reads the authoritative temporary utility override, if one is active. */
  getPlayerUtilityOverrideDescriptor(playerId: string): UtilityOverrideDescriptor | null {
    const value = this.playerStateMap.get(playerId)?.getState(KEY_UTILITY_OVERRIDE_DESCRIPTOR);
    if (!isRecord(value) || typeof value.kind !== 'string') return null;
    if (value.kind === 'utility') {
      if (typeof value.utilityId !== 'string' || value.utilityId.length === 0) return null;
      return { kind: 'utility', utilityId: value.utilityId };
    }
    if (value.kind === 'objective-placement') {
      if (typeof value.objectiveId !== 'string' || value.objectiveId.length === 0
        || typeof value.powerUpDefId !== 'string' || value.powerUpDefId.length === 0) return null;
      return {
        kind: 'objective-placement',
        objectiveId: value.objectiveId,
        powerUpDefId: value.powerUpDefId,
      };
    }
    return null;
  }

  /** Host-only: Publiziert ob die Adrenalinspritze eines Spielers aktiv ist. */
  publishAdrSyringeActive(playerId: string, active: boolean): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_ADR_SYRINGE, active, true);
  }

  /** Liest ob die Adrenalinspritze eines Spielers aktiv ist. */
  getPlayerAdrSyringeActive(playerId: string): boolean {
    return (this.playerStateMap.get(playerId)?.getState(KEY_ADR_SYRINGE) as boolean | undefined) ?? false;
  }

  /** Host-only: Publiziert die aktiven Buffs eines Spielers für die HUD-Anzeige. */
  publishActiveBuffs(playerId: string, buffs: SyncedActiveHudBuff[]): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_ACTIVE_BUFFS, buffs, true);
  }

  /** Liest die aktiven Buffs eines Spielers für die HUD-Anzeige. */
  getPlayerActiveBuffs(playerId: string): SyncedActiveHudBuff[] {
    return (this.playerStateMap.get(playerId)?.getState(KEY_ACTIVE_BUFFS) as SyncedActiveHudBuff[] | undefined) ?? [];
  }

  publishShieldBuffHud(playerId: string, state: ShieldBuffHudState): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_SHIELD_BUFF, state, true);
  }

  getPlayerShieldBuffHud(playerId: string): ShieldBuffHudState {
    return (this.playerStateMap.get(playerId)?.getState(KEY_SHIELD_BUFF) as ShieldBuffHudState | undefined) ?? {
      visible: false,
      defId: 'SHIELD_OVERCHARGE',
      value: 0,
      maxValue: 1,
      damageBonusPct: 0,
    };
  }

  // ── Frag-Tracking: pro Spieler (per-player state) ────────────────────────

  /** Liest den Frag-Zähler eines Spielers (Standard: 0). */
  getPlayerFrags(playerId: string): number {
    return (this.playerStateMap.get(playerId)?.getState(KEY_FRAGS) as number | undefined) ?? 0;
  }

  /** Host-only: Erhöht den Frag-Zähler eines Spielers um 1. */
  incrementPlayerFrags(killerId: string): void {
    if (!isHost() || !this.canPlayerReceiveRoundRewards(killerId)) return;
    const ps = this.playerStateMap.get(killerId);
    if (!ps) return;
    const current = (ps.getState(KEY_FRAGS) as number | undefined) ?? 0;
    ps.setState(KEY_FRAGS, current + 1);
  }

  /** Host-only: Erhöht den Frag-Zähler eines Spielers um einen beliebigen Betrag. */
  addPlayerFrags(playerId: string, amount: number): void {
    if (!isHost() || !this.canPlayerReceiveRoundRewards(playerId)) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    const current = (ps.getState(KEY_FRAGS) as number | undefined) ?? 0;
    ps.setState(KEY_FRAGS, current + amount);
  }

  /** Host-only: Setzt die Frags aller verbundenen Spieler auf 0 zurück. */
  resetAllFrags(): void {
    if (!isHost()) return;
    for (const ps of this.playerStateMap.values()) {
      ps.setState(KEY_FRAGS, 0);
    }
  }

  // ── Raum-Statistik: pro Spieler, bewusst nicht rundengebunden ──────────

  /** Liest den kumulierten, tatsächlich verursachten Schaden eines Spielers. */
  getPlayerRoomDamage(playerId: string): number {
    const entry = isHost()
      ? this.roomStatistics.get(playerId)
      : this.getRoomPlayerStatistics().find((candidate) => candidate.id === playerId);
    return entry?.damageDealt ?? 0;
  }

  /** Liest die kumulierten tatsächlichen Spielertode eines Spielers. */
  getPlayerRoomDeaths(playerId: string): number {
    const entry = isHost()
      ? this.roomStatistics.get(playerId)
      : this.getRoomPlayerStatistics().find((candidate) => candidate.id === playerId);
    return (entry?.pvpDeaths ?? 0) + (entry?.pveDeaths ?? 0);
  }

  /** Host-only: addiert tatsächlich verursachten Schaden ohne Rundungs-/Overkill-Verlust. */
  addRoomStatistic(playerId: string, counter: RoomStatisticsCounter, amount = 1): void {
    if (!isHost() || !this.canPlayerReceiveRoundRewards(playerId)) return;
    this.roomStatistics.add(playerId, counter, amount);
  }

  addPlayerRoomDamage(playerId: string, amount: number): void {
    this.addRoomStatistic(playerId, 'damageDealt', amount);
  }

  recordPlayerDamageTaken(playerId: string, hpLost: number, armorLost: number): void {
    this.addRoomStatistic(playerId, 'damageTaken', Math.max(0, hpLost) + Math.max(0, armorLost));
  }

  recordPlayerDeath(playerId: string): void {
    this.addRoomStatistic(playerId, isCoopDefenseMode(this.getGameMode()) ? 'pveDeaths' : 'pvpDeaths');
  }

  recordPlayerKill(playerId: string, kind: 'pvp' | 'pve'): void {
    this.addRoomStatistic(playerId, kind === 'pvp' ? 'pvpKills' : 'pveKills');
  }

  recordHealingReceived(playerId: string, amount: number): void {
    this.addRoomStatistic(playerId, 'healingReceived', amount);
  }

  recordArmorReceived(playerId: string, amount: number): void {
    this.addRoomStatistic(playerId, 'armorReceived', amount);
  }

  recordPowerUpCollected(playerId: string): void {
    this.addRoomStatistic(playerId, 'powerUpsCollected');
  }

  recordUtilityUsed(playerId: string): void {
    this.addRoomStatistic(playerId, 'utilitiesUsed');
  }

  recordConstructionBuilt(playerId: string): void {
    this.addRoomStatistic(playerId, 'constructionsBuilt');
  }

  recordUltimateUsed(playerId: string): void {
    this.addRoomStatistic(playerId, 'ultimatesUsed');
  }

  recordCompletedPvpMatch(eligiblePlayerIds: readonly string[], winnerIds: ReadonlySet<string>): void {
    if (!isHost()) return;
    this.roomStatistics.recordCompletedPvpMatch(eligiblePlayerIds, winnerIds);
  }

  /** Host-only: erhöht den Raum-Todeszähler für einen bestätigten Spielertod. */
  incrementPlayerRoomDeaths(playerId: string): void {
    this.recordPlayerDeath(playerId);
  }

  /** Liefert die Raumstatistik für alle aktuell verbundenen Spieler. */
  getRoomPlayerStatistics(): RoomPlayerStatistics[] {
    if (isHost()) {
      for (const profile of this.getConnectedPlayers()) this.roomStatistics.ensurePlayer(profile);
      return this.roomStatistics.snapshot();
    }
    const raw = getState(KEY_ROOM_STATS);
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is RoomPlayerStatistics => this.isValidRoomStatisticsEntry(entry))
      .map((entry) => ({ ...entry }));
  }

  hostPublishRoomStatistics(): void {
    if (!isHost()) return;
    setState(KEY_ROOM_STATS, this.roomStatistics.snapshot(), true);
  }

  /** Neue Spieler erhalten Defaults; Resume und Rundenwechsel behalten ihre Werte. */
  private hostInitializeRoomStatistics(playerId: string): void {
    if (!isHost()) return;
    const state = this.playerStateMap.get(playerId);
    if (!state) return;
    this.roomStatistics.ensurePlayer(this.extractProfile(state));
  }

  private isValidRoomStatisticsEntry(value: unknown): value is RoomPlayerStatistics {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<RoomPlayerStatistics>;
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string'
      || typeof entry.colorHex !== 'number'
      || (entry.teamId !== null && entry.teamId !== 'blue' && entry.teamId !== 'red')) return false;
    return ROOM_STATISTICS_COUNTERS.every((key) => {
      const counter = entry[key];
      return typeof counter === 'number' && Number.isFinite(counter) && counter >= 0;
    });
  }

  getCoopDefenseRoundXp(): number {
    const rawXp = getState(KEY_COOP_ROUND_XP) as number | undefined;
    if (typeof rawXp !== 'number' || !Number.isFinite(rawXp)) return 0;
    return Math.max(0, Math.floor(rawXp));
  }

  setCoopDefenseRoundXp(totalXp: number): void {
    if (!isHost()) return;
    setState(KEY_COOP_ROUND_XP, Math.max(0, Math.floor(totalXp)), true);
  }

  addCoopDefenseRoundXp(amount: number): number {
    if (!isHost()) return this.getCoopDefenseRoundXp();
    const nextTotal = this.getCoopDefenseRoundXp() + Math.max(0, Math.floor(amount));
    this.setCoopDefenseRoundXp(nextTotal);
    return nextTotal;
  }

  /** Host-only, mit Teilnehmerberechtigungs-Gate fuer Kill-/XP-Quellen. */
  addCoopDefenseRoundXpForPlayer(playerId: string, amount: number): number {
    if (!isHost() || !this.canPlayerReceiveRoundRewards(playerId)) {
      return this.getCoopDefenseRoundXp();
    }
    return this.addCoopDefenseRoundXp(amount);
  }

  resetCoopDefenseRoundXp(): void {
    this.setCoopDefenseRoundXp(0);
  }

  setLocalCoopDefenseTotalXp(totalXp: number): void {
    const nextTotalXp = Math.max(0, Math.floor(totalXp));
    myPlayer().setState(KEY_COOP_XP, nextTotalXp, true);
  }

  getPlayerCoopDefenseTotalXp(playerId: string): number {
    const rawXp = this.playerStateMap.get(playerId)?.getState(KEY_COOP_XP) as number | undefined;
    if (typeof rawXp !== 'number' || !Number.isFinite(rawXp)) return 0;
    return Math.max(0, Math.floor(rawXp));
  }

  getPlayerCoopDefenseLevel(playerId: string): number {
    return getCoopDefenseLevelForXp(this.getPlayerCoopDefenseTotalXp(playerId));
  }

  // ── Ping-Messung: Client → Host → Alle ────────────────────────────────────

  /**
   * Netzwerk-RTT eines Spielers in ms, `null` solange nichts gemessen wurde.
   *
   * Die Unterscheidung ist wichtig: 0 ms ist ein gültiges Ergebnis (gleiches LAN oder
   * derselbe Rechner) und darf nicht mit "noch keine Messung" verwechselt werden.
   * Der Host misst sich nicht selbst und liefert deshalb 0.
   */
  getPlayerPing(playerId: string): number | null {
    if (playerId === this.getLocalPlayerId() && isHost()) return 0;
    const value = this.playerStateMap.get(playerId)?.getState(KEY_PING);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') return null;
    const ping = (value as Partial<NetworkPingSample>).m;
    return typeof ping === 'number' && Number.isFinite(ping) ? ping : null;
  }

  getPlayerPingSample(playerId: string): NetworkPingSample | null {
    const value = this.playerStateMap.get(playerId)?.getState(KEY_PING);
    if (!value || typeof value !== 'object') return null;
    const sample = value as Partial<NetworkPingSample>;
    if (typeof sample.m !== 'number' || !Number.isFinite(sample.m)
      || typeof sample.s !== 'number' || !Number.isSafeInteger(sample.s) || sample.s < 1) return null;
    return { m: sample.m, s: sample.s };
  }

  publishRoomQuality(snapshot: RoomQualitySnapshot | null): void {
    setState(KEY_ROOM_QUALITY, snapshot, true);
  }

  getRoomQuality(): RoomQualitySnapshot | null {
    return (getState(KEY_ROOM_QUALITY) as RoomQualitySnapshot | null | undefined) ?? null;
  }

  /**
   * Client-only: Sendet einen Ping-Request an den Host.
   * Für den Host kein-Op (bleibt bei Default-Ping 0 ms).
   */
  sendPingToHost(): void {
    this.pingController.sendPingToHost();
  }

  // ── Rundenabschluss-Snapshot: Host → Alle (global, reliable) ─────────────

  /** Host-only: Speichert den Endstand der Runde für die Lobby-Anzeige. */
  publishRoundResults(results: RoundResult[]): void {
    if (!isHost()) return;
    setState(KEY_ROUND_RESULTS, results, true);
  }

  /** Liest den gespeicherten Endstand (null = noch keine Runde gespielt). */
  getRoundResults(): RoundResult[] | null {
    return (getState(KEY_ROUND_RESULTS) as RoundResult[] | undefined) ?? null;
  }

  /** Host-only: speichert den aktuellen bzw. finalen Rundenstatus. */
  publishRoundState(state: RoundState | null): void {
    if (!isHost()) return;
    setState(KEY_ROUND_STATE, state, true);
  }

  /** Liest den aktuellen bzw. letzten finalen Rundenstatus. */
  getRoundState(): RoundState | null {
    return (getState(KEY_ROUND_STATE) as RoundState | null | undefined) ?? null;
  }

  /** Reiht einen XP-Popup ein; bei Massensterben sonst ein RPC pro Kill (siehe {@link flushEffects}). */
  broadcastCoopDefenseXpPopup(x: number, y: number, xp: number): void {
    this.pendingXpPopups.push({ x, y, xp: Math.max(0, Math.floor(xp)) });
  }

  registerCoopDefenseXpPopupHandler(handler: CoopDefenseXpPopupHandler): void {
    this.coopDefenseXpPopupHandler = handler;
    this.registerAllRpcHandler('cdxpb', async (data: unknown): Promise<unknown> => {
      const popupHandler = this.coopDefenseXpPopupHandler;
      if (!popupHandler) return undefined;
      const popups = data as { x: number; y: number; xp: number }[];
      for (let i = 0; i < popups.length; i += 1) {
        popupHandler(popups[i].x, popups[i].y, popups[i].xp);
      }
      return undefined;
    });
  }

  // ── Kill-Ereignis-RPC: Host → Alle ────────────────────────────────────────

  /** Host-only: Sendet ein Kill-Ereignis an alle Clients (inkl. Host selbst). */
  broadcastKillEvent(event: KillEvent): void {
    this.broadcastGameplayEvent('kev', event);
  }

  /** Registriert einen Handler für eingehende Kill-Ereignisse (alle Clients). */
  registerKillEventHandler(cb: (event: KillEvent) => void): void {
    this.killEventHandler = cb;
    this.registerAllRpcHandler('kev', async (data: unknown): Promise<unknown> => {
      const killEventHandler = this.killEventHandler;
      if (!killEventHandler) return undefined;
      killEventHandler(data as KillEvent);
      return undefined;
    });
  }

  /** Ping-Auswertung und Transportmessung. Am Anfang jedes Frames aufrufen. */
  updateNetwork(): void {
    this.pingController.update();
    this.diagnostics?.update();
    this.publishLocalPing();
  }

  /**
   * Veröffentlicht den eigenen Ping, damit ihn alle Spieler in der Lobby sehen.
   *
   * Angezeigt wird die **Netzwerk-RTT** des ICE-Kandidatenpaars, nicht die Zeit durch die
   * Spielschleifen: Der ICE-Stack misst sie per STUN außerhalb des Main-Threads, sie ist
   * daher unabhängig von der Bildrate und mit der Ping-Anzeige üblicher Shooter vergleichbar.
   * Solange noch keine STUN-Antwort vorliegt, dient der Anwendungs-Ping als Notbehelf.
   */
  private publishLocalPing(): void {
    if (isHost()) return;
    const link = this.diagnostics?.getWorstSnapshot();
    if (!link || link.medianRttMs === null || link.rttSampleCount <= this.lastObservedRttSampleCount) return;
    this.lastObservedRttSampleCount = link.rttSampleCount;
    myPlayer().setState(KEY_PING, {
      m: Math.round(link.medianRttMs),
      s: ++this.publishedPingSequence,
    } satisfies NetworkPingSample);
  }

  /**
   * Kurzlebige Ereignisse an alle. Laeuft ueber den geordneten, zuverlaessigen Kanal:
   * ein verlorener Killfeed-Eintrag oder eine ausgefallene Explosion waere sichtbar, und
   * die Nachrichten sind klein genug, dass sie den Kanal nicht belasten.
   */
  private broadcastGameplayEvent(type: string, payload: unknown): void {
    this.broadcastRpc(type, payload);
  }

  private sendHostRpc(type: string, payload: unknown): void {
    requireRoom().sendHost(type, payload);
  }

  private callHostRpc(type: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    return requireRoom().callHost(type, payload, timeoutMs);
  }

  private broadcastRpc(type: string, payload: unknown): void {
    requireRoom().broadcast(type, payload);
  }

  private registerHostRpcHandler(
    type: string,
    handler: (payload: unknown, caller: PlayerState) => Promise<unknown> | unknown,
  ): void {
    this.hostRpcHandlers.set(type, handler);
    this.ensureRpcDispatcherRegistered(type, 'host');
  }

  private registerAllRpcHandler(
    type: string,
    handler: (payload: unknown) => Promise<unknown> | unknown,
  ): void {
    this.allRpcHandlers.set(type, handler);
    this.ensureRpcDispatcherRegistered(type, 'all');
  }

  /**
   * Meldet den Nachrichtennamen beim Substrat an. Die Handler selbst bleiben in den Maps
   * dieser Klasse, damit `executeGameplayCommand`/`dispatchGameplayEvent` denselben Einstieg
   * behalten und Handler jederzeit ersetzt werden koennen.
   *
   * Der Konstruktor laeuft beim Modulladen, also vor dem Verbindungsaufbau. Registrierungen
   * aus dieser Phase werden gesammelt und in `activate()` nachgezogen.
   */
  private ensureRpcDispatcherRegistered(type: string, scope: 'host' | 'all'): void {
    const registeredScope = this.registeredRpcTypes.get(type);
    if (registeredScope !== undefined) {
      // Derselbe Name in beiden Richtungen waere ein stiller Fehler: das Substrat entscheidet
      // anhand des Namens, ob eine Nachricht host-gerichtet oder ein Broadcast ist.
      if (registeredScope !== scope) {
        console.error(`[NetworkBridge] RPC-Name '${type}' ist bereits als '${registeredScope}' registriert.`);
      }
      return;
    }
    this.registeredRpcTypes.set(type, scope);
    if (this.rpcDispatchersActive) this.bindRpcDispatcher(type, scope);
  }

  private bindRpcDispatcher(type: string, scope: 'host' | 'all'): void {
    const room = requireRoom();
    if (scope === 'host') {
      room.registerHostHandler(type, (payload, senderId) => {
        const handler = this.hostRpcHandlers.get(type);
        if (!handler) return undefined;
        const caller = room.getPlayerHandle(senderId);
        if (!caller) return undefined;
        return handler(payload, caller);
      });
      return;
    }

    room.registerAllHandler(type, (payload) => {
      const handler = this.allRpcHandlers.get(type);
      if (!handler) return undefined;
      return handler(payload);
    });
  }

  private computeAvailableColors(): number[] {
    if (this.knownPlayerColors.length === 0) return this.getAvailableColors();
    const usedColors = new Set<number>();
    for (const id of this.connectedPlayers.keys()) {
      const color = this.getStoredPlayerColor(id);
      if (color !== undefined) usedColors.add(color);
    }
    return this.knownPlayerColors.filter(color => !usedColors.has(color));
  }

  private reconcileColorPool(): void {
    if (!isHost()) return;
    if (this.knownPlayerColors.length === 0) return;
    this.setAvailableColors(this.computeAvailableColors());
  }

  private syncConnectedPlayers(): void {
    for (const state of this.playerStateMap.values()) {
      this.syncConnectedProfile(state);
    }

    // Das Dirty-Flag erst NACH der Schleife lesen: syncConnectedProfile setzt es, wenn sich ein
    // Profil geaendert hat. Frueher gelesen, haette der Cache jede Aenderung um einen Frame
    // verzoegert – sichtbar z. B. als kurz weiss bleibender Name nach der Farbzuweisung.
    if (!this.connectedPlayersCacheDirty && this.cachedConnectedPlayers.length === this.connectedPlayers.size) return;

    this.cachedConnectedPlayers = [...this.connectedPlayers.values()];
    this.connectedPlayersCacheDirty = false;
  }

  private syncConnectedProfile(state: PlayerState): PlayerProfile {
    const previous = this.connectedPlayers.get(state.id);
    const stateName = state.getState(KEY_NAME) as string | undefined;
    const effectiveColor = this.getEffectivePlayerColor(state.id);
    const teamId = this.getPlayerTeam(state.id);

    if (previous) {
      const nextName = sanitizePlayerName(stateName || previous.name || '') || 'Player';
      const nextColor = effectiveColor ?? previous.colorHex;
      if (nextName === previous.name && nextColor === previous.colorHex && previous.teamId === teamId) {
        return previous;
      }
      const nextProfile: PlayerProfile = { id: state.id, name: nextName, colorHex: nextColor, teamId };
      this.connectedPlayers.set(state.id, nextProfile);
      this.connectedPlayersCacheDirty = true;
      return nextProfile;
    }

    const profile = this.extractProfile(state);
    this.connectedPlayers.set(state.id, profile);
    this.connectedPlayersCacheDirty = true;
    return profile;
  }

  // ── Interner Helfer: PlayerState → PlayerProfile ──────────────────────────

  /**
   * Der Transport liefert kein Profil mehr. Bis ein Spieler seinen Namen setzt (KEY_NAME,
   * beim Start aus den lokalen Einstellungen), traegt er einen aus seiner Spieler-ID
   * abgeleiteten Platzhalter – stabil und ohne Kollisionen innerhalb eines Raums.
   */
  private extractProfile(state: PlayerState): PlayerProfile {
    const stateName  = state.getState(KEY_NAME) as string | undefined;

    return {
      id:       state.id,
      name:     sanitizePlayerName(stateName || '') || defaultPlayerName(state.id),
      colorHex: this.getEffectivePlayerColor(state.id) ?? DEFAULT_PLAYER_COLOR,
      teamId:   this.getPlayerTeam(state.id),
    };
  }

  private getStoredPlayerColor(playerId: string): number | undefined {
    return this.playerStateMap.get(playerId)?.getState(KEY_PLAYER_COLOR) as number | undefined;
  }

  private hostHandleTeamRequest(teamId: TeamId, requesterId: string): boolean {
    if (!isHost()) return false;
    if (!this.canPlayerChangeTeam(requesterId, teamId)) return false;
    this.playerStateMap.get(requesterId)?.setState(KEY_PLAYER_TEAM, teamId, true);
    this.connectedPlayersCacheDirty = true;
    return true;
  }

  private pickBalancedTeam(): TeamId | null {
    const blueCount = this.getTeamPlayerCount('blue');
    const redCount = this.getTeamPlayerCount('red');
    return pickAutomaticTeam(blueCount, redCount);
  }

  /** Beim Eintritt aus DM/Coop: stabile Reihenfolge, Gleichstand immer Blau, maximal sechs. */
  private hostRedistributeSelectableTeams(): void {
    if (!isHost()) return;
    let blueCount = 0;
    let redCount = 0;
    for (const playerId of this.connectedPlayers.keys()) {
      const teamId = pickAutomaticTeam(blueCount, redCount);
      if (!teamId) break;
      this.playerStateMap.get(playerId)?.setState(KEY_PLAYER_TEAM, teamId, true);
      if (teamId === 'blue') blueCount += 1;
      else redCount += 1;
    }
    this.connectedPlayersCacheDirty = true;
  }

  private getTeamPlayerCount(teamId: TeamId): number {
    let count = 0;
    for (const playerId of this.connectedPlayers.keys()) {
      if (this.getPlayerTeam(playerId) === teamId) count++;
    }
    return count;
  }

  /** Revision fuer jede World-Aktion; ohne interaktive Teilnahme gibt es keinen Versand. */
  private getWorldActionRevision(): number | null {
    const world = this.getWorldDescriptor();
    if (!world || !maySendWorldInput(this.getLocalWorldParticipation())) return null;
    return world.worldRevision;
  }

  private getWeapon2PredictionState(worldRevision: number, playerId: string): Weapon2PredictionState {
    let players = this.weapon2PredictionStates.get(worldRevision);
    if (!players) {
      players = new Map();
      this.weapon2PredictionStates.set(worldRevision, players);
    }
    let state = players.get(playerId);
    if (!state) {
      state = {
        nextContiguousAck: 0,
        completedPredictionIds: new Set(),
        finalResults: new Map(),
      };
      players.set(playerId, state);
    }
    // There is no useful cross-World cache. Keep only the active World so an old response or
    // a reused predictionId can never be mistaken for a new World request.
    for (const revision of this.weapon2PredictionStates.keys()) {
      if (revision !== worldRevision) this.weapon2PredictionStates.delete(revision);
    }
    return state;
  }

  private recordWeapon2PredictionCompleted(state: Weapon2PredictionState, predictionId: number): void {
    state.completedPredictionIds.add(predictionId);
    while (state.completedPredictionIds.has(state.nextContiguousAck + 1)) {
      state.completedPredictionIds.delete(state.nextContiguousAck + 1);
      state.nextContiguousAck += 1;
    }
  }

  private sendWorldRpc(type: string, payload: Readonly<Record<string, unknown>>): boolean {
    const worldRevision = this.getWorldActionRevision();
    if (worldRevision === null) return false;
    this.sendHostRpc(type, { ...payload, wr: worldRevision });
    return true;
  }

  /** Verwirft RPCs aus einer alten World, bevor Gameplay-Handler sie erreichen. */
  private acceptsWorldRpc(payload: unknown): payload is Record<string, unknown> {
    if (!isRecord(payload)) return false;
    const world = this.getWorldDescriptor();
    const worldRevision = payload.wr;
    return world !== null
      && Number.isSafeInteger(worldRevision)
      && isCurrentWorldRevision(world.worldRevision, worldRevision);
  }
}
