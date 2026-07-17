/**
 * NetworkBridge – einzige Datei im Projekt, die 'playroomkit' importiert.
 * Kapselt alle Netzwerkoperationen hinter einer spiellogik-agnostischen API.
 *
 * Nutzung:
 *   1. bridge.onPlayerJoin() / onPlayerQuit() beliebig oft registrieren
 *   2. bridge.activate() einmalig in main.ts aufrufen
 *   3. In der ArenaScene: bridge.clearPlayerCallbacks() aufrufen,
 *      dann neue join/quit-Callbacks registrieren
 */
import { insertCoin, onPlayerJoin, isHost, myPlayer, setState, getState, RPC } from 'playroomkit';
import type { PlayerState } from 'playroomkit';
import type { BurrowPhase, CaptureTheBeerFxEvent, ExplosionVisualStyle, GameMode, HitscanImpactKind, HitscanVisualPreset, LoadoutCommitSnapshot, LoadoutSlot, LoadoutUseParams, LoadoutUseResult, PlayerInput, PlayerProfile, PlayerNetState, RoomQualitySnapshot, ShieldBuffHudState, ShotAudioKey, SlimeBloomTarget, SyncedActiveHudBuff, SyncedAirstrikeStrike, SyncedBaseState, SyncedBurningGroundSnapshot, SyncedCaptureTheBeerState, SyncedCombatEffect, SyncedDecoy, SyncedEnergyShield, SyncedEnemySnapshot, SyncedFireZone, SyncedGuardianSpirit, SyncedHitscanTrace, SyncedMeleeSwing, SyncedMeteorStrike, SyncedNukeStrike, SyncedPlaceableRock, SyncedPowerUp, SyncedPowerUpPedestal, SyncedPowerUpPedestalSnapshot, SyncedPowerUpSnapshot, SyncedProjectile, SyncedRockSnapshot, SyncedSlimeTrailSnapshot, SyncedSmokeCloud, SyncedStinkCloud, SyncedTeslaDome, SyncedTimeBubble, SyncedTrainState, SyncedTunnel, TeamId, TrainEventConfig, GamePhase, ArenaLayout, RockNetState } from '../types';
import {
  MAX_PLAYERS,
  NET_DEBUG_ENEMY_SYNC_METRICS,
  NET_DEBUG_ENEMY_SYNC_METRICS_WINDOW_MS,
  NET_TICK_RATE_HZ,
  COOP_DEFENSE_BASE_TURRET_OWNER_ID,
  TEAM_BLUE_COLOR,
  TEAM_RED_COLOR,
} from '../config';
import { NetworkPingController } from './NetworkPingController';
import { countEnemyUpserts } from './enemySnapshotCodec';
import { decodePlayerStates, encodePlayerStates } from './playerStateCodec';
import type { HostRoomQualityProbeResult } from './NetworkPingController';
import { sanitizePlayerName } from '../utils/playerName';
import { getMinPlayersForMode, isCoopDefenseMode, isTeamGameMode, usesTeamColors } from '../gameModes';
import { isCommittedLoadoutEqual, resolveLoadoutSelectionIds, sanitizeCommittedLoadoutForMode } from '../loadout/LoadoutRules';
import { ULTIMATE_CONFIGS, UTILITY_CONFIGS, WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import { DEFAULT_COOP_DEFENSE_MAP_ID, getCoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { getCoopDefenseLevelForXp } from '../utils/coopDefenseProgression';
import { sanitizeCoopDefenseUpgradeProfile } from '../utils/coopDefenseUpgrades';
export type { HostRoomQualityProbeResult } from './NetworkPingController';

const HOST_RPC_CHANNEL = 'rpc_host';
const ALL_RPC_CHANNEL  = 'rpc_all';
const OUTBOUND_RPC_BACKOFF_MS = 5000;

// ── Interne State-Keys – nie nach außen exportiert ───────────────────────────
const KEY_INPUT        = 'inp';
const KEY_PLAYERS      = 'plr';
const KEY_PROJECTILES  = 'prj';
const KEY_READY        = 'isr';   // per-player boolean: isReady
const KEY_NAME         = 'pnm';   // per-player string: Anzeigename (überschreibt Playroom-Profil)
const KEY_GAME_PHASE   = 'gph';   // global: 'LOBBY' | 'ARENA'
const KEY_GAME_MODE    = 'gmd';   // global: 'deathmatch' | 'team_deathmatch' | 'capture_the_beer'
const KEY_COOP_MAP_ID  = 'cmd';   // global: string (ausgewaehlte Coop-Defense-Map)
const KEY_ARENA_START  = 'ast';   // global: number (timestamp ms ab dem Input/Game freigegeben wird)
const KEY_ROUND_END    = 'ret';   // global: number (timestamp ms)
const KEY_HOST_ID      = 'hid';   // global: string (Player-ID des Match-Hosts)
const KEY_ARENA_LAYOUT = 'aly';   // global: ArenaLayout (reliable, einmalig pro Runde)
const KEY_ROCK_HP      = 'rck';   // global: RockNetState[] (unreliable, Delta-Snapshot)
const KEY_AVAIL_COLORS = 'avc';   // global: number[] (verfügbarer Farbpool, reliable)
const KEY_PLAYER_COLOR = 'clr';   // per-player: number (benutzerdefinierte Spielerfarbe)
const KEY_PLAYER_TEAM  = 'ptm';   // per-player: 'blue' | 'red' (gemerkte TDM-Teamwahl)
const KEY_LOADOUT_W1   = 'lw1';   // per-player: string (weapon1 item ID)
const KEY_LOADOUT_W2   = 'lw2';   // per-player: string (weapon2 item ID)
const KEY_LOADOUT_UT   = 'lut';   // per-player: string (utility item ID)
const KEY_LOADOUT_UL   = 'lul';   // per-player: string (ultimate item ID)
const KEY_LOADOUT_COMMITTED = 'lcm'; // per-player: verbindlicher LoadoutCommitSnapshot fuer Ready-Spieler
const KEY_UTILITY_CD_UNTIL = 'ucd'; // per-player: number (Date.now()-Timestamp bis Utility wieder bereit)
const KEY_UTILITY_OVERRIDE_NAME = 'uon'; // per-player: string (display name of overridden utility, empty = no override)
const KEY_ADR_SYRINGE  = 'asr';   // per-player: boolean (Adrenalinspritze aktiv, regen multiplier > 1)
const KEY_ACTIVE_BUFFS = 'abf';   // per-player: {defId,remainingFrac}[] (aktive Buffs für HUD)
const KEY_SHIELD_BUFF  = 'sbf';   // per-player: ShieldBuffHudState (HUD-State des Energie-Schild-Buffs)
const KEY_FRAGS        = 'frg';   // per-player: number (Frag-Zähler)
const KEY_COOP_ROUND_XP = 'crx';  // global: number (gemeinsame, matchweite Coop-Defense-XP)
const KEY_COOP_XP      = 'cxp';   // per-player: number (lokal persistierte Coop-Defense-XP fuer Lobby-Anzeige)
const KEY_ROUND_RESULTS = 'rrs'; // global reliable: RoundResult[] (Rundenabschluss-Snapshot)
const KEY_ROUND_STATE  = 'rds';   // global reliable: RoundState | null (aktueller/finaler Rundenstatus)
// KEY_HITSCAN_TRACES und KEY_MELEE_SWINGS entfernt – werden jetzt per RPC gesendet
const KEY_SMOKE_CLOUDS   = 'smk'; // global: SyncedSmokeCloud[] (unreliable, host-authoritative Sichtbehinderung)
const KEY_FIRE_ZONES     = 'fzn'; // global: SyncedFireZone[]   (unreliable, host-authoritative Feuerzonen)
const KEY_POWERUPS       = 'pup'; // global: SyncedPowerUp[]    (unreliable, host-authoritative Power-Ups auf dem Boden)
const KEY_NUKE_STRIKES   = 'nks'; // global: SyncedNukeStrike[]      (unreliable, host-authoritative aktive Nukes)
const KEY_AIR_STRIKES    = 'ask'; // global: SyncedAirstrikeStrike[] (unreliable, host-authoritative Luftangriffe)
const KEY_TRAIN_EVENT    = 'tev'; // global: TrainEventConfig   (reliable,   einmalig pro Runde)
const KEY_TRAIN_STATE    = 'trs'; // global: SyncedTrainState   (unreliable, per-frame Zug-Snapshot)
const KEY_PING           = 'png'; // per-player: number (Roundtrip-Zeit in ms, unreliable)
const KEY_GAME_STATE     = 'gs';  // global: komprimierter Game State (unreliable, single setState)
const KEY_ROOM_QUALITY   = 'rql'; // global reliable: aktuelle Lobby-Raumqualitaet fuer Startschutz/Retry-UX
const KEY_LOBBY_SYNC     = 'lsy'; // global reliable: host-autoritativer Lobby-Snapshot {m:mode, c:mapId, p:playerIds} für den Bereit-Konsistenz-Check

interface EnemySyncMetricsWindow {
  startedAtMs: number;
  tickCount: number;
  totalPayloadBytes: number;
  enemyPayloadBytes: number;
  enemyCountSum: number;
  fullTickCount: number;
  upsertCountSum: number;
  removalCountSum: number;
  maxEnemyCount: number;
  maxTotalPayloadBytes: number;
  maxEnemyPayloadBytes: number;
  slicePayloadBytesSums: Record<string, number>;
  slicePayloadBytesPeaks: Record<string, number>;
}

const GAME_STATE_SLICE_LABELS: Readonly<Record<string, string>> = {
  _s: 'seq',
  rt: 'round',
  p: 'players',
  j: 'projectiles',
  e: 'enemies',
  r: 'rocks',
  br: 'placeableRocks',
  dc: 'decoys',
  s: 'smokes',
  f: 'fires',
  sc: 'stinkClouds',
  tb: 'timeBubbles',
  td: 'teslaDomes',
  es: 'energyShields',
  g: 'guardianSpirits',
  sl: 'slimeTrail',
  fg: 'burningGround',
  u: 'powerups',
  pd: 'pedestals',
  n: 'nukes',
  ak: 'airstrikes',
  mt: 'meteors',
  tn: 'tunnels',
  t: 'train',
  b: 'bases',
  cb: 'captureTheBeer',
};

// ── Öffentliche Typen ─────────────────────────────────────────────────────────

/** Kill-Ereignis für den Killfeed (Host → Alle per RPC) */
export interface KillEvent {
  killerId:    string;
  killerName:  string;
  killerColor: number;
  weapon:      string;
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
  teamScore?: number;
  sharedXp?: number;
}

export type RoundOutcome = 'victory' | 'defeat';

export interface RoundState {
  status: 'active' | RoundOutcome;
  roundStartTime: number;
  coopDefenseHumanPlayerCount?: number;
  // Authoritative Coop-Defense-Map dieser Runde. Bewusst Teil des (reliable) RoundState, damit der
  // Client Basen/Map race-frei aus EINEM Objekt baut, statt den separaten KEY_COOP_MAP_ID parallel
  // abzuwarten (sonst kann eine Basis beim Client fehlen, wenn der Key später als die Phase ankommt).
  coopDefenseMapId?: string;
  endedAt?: number;
}

export interface GameState {
  roundStartTime: number;
  players:      Record<string, PlayerNetState>;
  projectiles:  SyncedProjectile[];
  enemies:      SyncedEnemySnapshot | null;
  rocks:        RockNetState[];   // Delta: nur beschädigte Felsen (abwesend = voll HP)
  placeableRocks: SyncedPlaceableRock[];
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
  stinkClouds:  SyncedStinkCloud[];      // Stinkdrüsen-Gaswolken (spieler-folgend)
  timeBubbles:  SyncedTimeBubble[];
  teslaDomes:   SyncedTeslaDome[];
  energyShields: SyncedEnergyShield[];
  guardianSpirits: SyncedGuardianSpirit[];
  slimeTrail: SyncedSlimeTrailSnapshot;
  burningGround: SyncedBurningGroundSnapshot;
  // Hitscan-Traces und Melee-Swings werden per RPC gesendet (nicht mehr Teil des GameState)
}

interface OutboundGameState {
  roundStartTime: number;
  players:      Record<string, PlayerNetState>;
  projectiles:  SyncedProjectile[];
  enemies:      SyncedEnemySnapshot | null;
  rocks:        SyncedRockSnapshot | null;
  placeableRocks: SyncedPlaceableRock[];
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
  stinkClouds:  SyncedStinkCloud[];
  timeBubbles:  SyncedTimeBubble[];
  teslaDomes:   SyncedTeslaDome[];
  energyShields: SyncedEnergyShield[];
  guardianSpirits: SyncedGuardianSpirit[];
  slimeTrail: SyncedSlimeTrailSnapshot;
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

type EncodedBurningGroundCell = [number, number, number, number];
interface EncodedBurningGroundDelta {
  f?: EncodedBurningGroundCell[];
  u?: EncodedBurningGroundCell[];
  r?: number[];
}

function encodeBurningGroundCell(cell: SyncedBurningGroundSnapshot['cells'][number]): EncodedBurningGroundCell {
  return [cell.id, cell.gridX, cell.gridY, cell.expiresAt];
}

function decodeBurningGroundCell([id, gridX, gridY, expiresAt]: EncodedBurningGroundCell) {
  return { id, gridX, gridY, expiresAt };
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

type ExplosionEffectHandler = (x: number, y: number, radius: number, color?: number, visualStyle?: ExplosionVisualStyle) => void;
type SlimeBloomEffectHandler = (x: number, y: number, targets: readonly SlimeBloomTarget[]) => void;
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
type PowerUpPickupHandler = (uid: number, playerId: string) => void;
type DecoyStealthBreakHandler = (playerId: string) => void;
type TrainDestroyedHandler = () => void;
type TranslocatorFlashHandler = (x: number, y: number, color: number, type: 'start' | 'end') => void;
type CaptureTheBeerFxHandler = (event: CaptureTheBeerFxEvent) => void;

interface RpcEnvelope {
  type: string;
  payload: unknown;
}

const TEAM_IDS: readonly TeamId[] = ['blue', 'red'];

export class NetworkBridge {
  private playerStateMap   = new Map<string, PlayerState>();
  private connectedPlayers = new Map<string, PlayerProfile>();
  private cachedConnectedPlayers: PlayerProfile[] = [];
  private connectedPlayersCacheDirty = true;

  private joinCbs: Array<(profile: PlayerProfile) => void> = [];
  private quitCbs: Array<(id: string) => void>             = [];

  private activated = false;
  private hostDispatcherRegistered = false;
  private allDispatcherRegistered = false;
  private knownPlayerColors: readonly number[] = [];
  private pingController: NetworkPingController;
  private hostRpcHandlers = new Map<string, (payload: unknown, caller: PlayerState) => Promise<unknown> | unknown>();
  private allRpcHandlers = new Map<string, (payload: unknown) => Promise<unknown> | unknown>();

  private loadoutUseHandler: LoadoutUseHandler | null = null;
  private explosionEffectHandler: ExplosionEffectHandler | null = null;
  private slimeBloomEffectHandler: SlimeBloomEffectHandler | null = null;
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
  private decoyStealthBreakHandler: DecoyStealthBreakHandler | null = null;
  private trainDestroyedHandler: TrainDestroyedHandler | null = null;
  private translocatorFlashHandler: TranslocatorFlashHandler | null = null;
  private captureTheBeerFxHandler: CaptureTheBeerFxHandler | null = null;
  private bfgLaserHandler: ((lines: { sx: number; sy: number; ex: number; ey: number }[], color: number, visualPreset?: HitscanVisualPreset) => void) | null = null;
  private enemySyncMetricsWindow: EnemySyncMetricsWindow | null = null;
  private outboundRpcBlockedUntilMs = 0;
  private lastOutboundRpcWarningAtMs = 0;

  constructor() {
    this.pingController = new NetworkPingController({
      isHost: () => isHost(),
      getLocalPlayerId: () => myPlayer().id,
      setLocalPing: (pingMs: number) => { myPlayer().setState(KEY_PING, pingMs); },
      sendHostRpc: (type: string, payload: unknown) => this.sendHostRpc(type, payload),
      broadcastRpc: (type: string, payload: unknown) => this.broadcastRpc(type, payload),
      registerHostRpcHandler: (type, handler) => this.registerHostRpcHandler(type, handler),
      registerAllRpcHandler: (type, handler) => this.registerAllRpcHandler(type, handler),
      callHostRpc: (type: string, payload: unknown, timeoutMs: number) => this.callHostRpc(type, payload, timeoutMs),
    });

    this.registerHostRpcHandler('tmr', async (payload: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return false;
      const teamId = (payload as { teamId?: unknown } | null)?.teamId;
      if (teamId !== 'blue' && teamId !== 'red') return false;
      return this.hostHandleTeamRequest(teamId, caller.id);
    });
  }

  // ── Lobby-Initialisierung (einmalig vor activate()) ────────────────────────
  static async initializeLobby(): Promise<void> {
    // skipLobby:true überspringt PlayroomKits eigenes Lobby-UI für alle Spieler –
    // auch für Late-Joiner, die sonst die Namensänderung verpassen würden.
    // Die eigene LobbyOverlay in der ArenaScene übernimmt alle Vorspiel-UI.
    await insertCoin({ maxPlayersPerRoom: MAX_PLAYERS, skipLobby: true });
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

  /**
   * Löscht alle Join- und Quit-Callbacks.
   * Muss am Anfang von create() der ArenaScene aufgerufen werden,
   * bevor neue Callbacks registriert werden.
   */
  clearPlayerCallbacks(): void {
    this.joinCbs = [];
    this.quitCbs = [];
  }

  // ── Einmalige Aktivierung (in main.ts aufrufen) ────────────────────────────

  /**
   * Startet den Playroom-Listener.
   * Darf nur EINMAL aufgerufen werden (nach insertCoin).
   */
  activate(): void {
    if (this.activated) return;
    this.activated = true;

    onPlayerJoin((state: PlayerState) => {
      this.playerStateMap.set(state.id, state);
      this.connectedPlayersCacheDirty = true;

      state.onQuit(() => {
        const hadColor = this.getPlayerColor(state.id) !== undefined;
        this.playerStateMap.delete(state.id);
        this.connectedPlayers.delete(state.id);
        this.connectedPlayersCacheDirty = true;
        if (hadColor) this.reconcileColorPool();
        this.quitCbs.forEach(cb => cb(state.id));
        this.hostPublishLobbySync();
      });

      const profile = this.extractProfile(state);
      this.connectedPlayers.set(state.id, profile);
      this.joinCbs.forEach(cb => cb(profile));
      this.hostPublishLobbySync();
    });
  }

  // ── Lobby-Sync-Konsistenz (Frühwarnung gegen Desync beim Bereit-Klick) ─────

  /**
   * Host-only: Veröffentlicht einen autoritativen Lobby-Snapshot (reliable, ein Objekt):
   * verbundene Spieler-IDs, aktueller Game-Mode und Coop-Map.
   *
   * Clients vergleichen beim "Bereit"-Klick ihren *separat* propagierten Stand gegen diesen
   * gebündelten Snapshot. Da die Einzel-Keys (Roster via Join-Callbacks, KEY_GAME_MODE, KEY_COOP_MAP_ID)
   * unabhängig voneinander ankommen, deckt der Vergleich genau die Fälle auf, in denen ein Client
   * noch nicht aufgeschlossen hat – z. B. einen Mitspieler nicht kennt (Bug A/B) oder mit veraltetem
   * Modus bereit würde (und so ein für den Modus ungültiges Loadout committen könnte).
   */
  private hostPublishLobbySync(): void {
    if (!isHost()) return;
    setState(KEY_LOBBY_SYNC, {
      m: this.getGameMode(),
      c: this.getCoopDefenseMapId(),
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
    const snapshot = getState(KEY_LOBBY_SYNC) as { m?: GameMode; c?: string; p?: string[] } | undefined;
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

    return { consistent: issues.length === 0, hostStatePresent: true, issues };
  }

  // ── Identität ──────────────────────────────────────────────────────────────
  isHost(): boolean          { return isHost(); }
  getLocalPlayerId(): string { return myPlayer().id; }

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
    return (getState(KEY_GAME_MODE) as GameMode | undefined) ?? 'deathmatch';
  }

  setGameMode(mode: GameMode): void {
    if (!isHost()) return;
    if (this.getGameMode() === mode) return;
    setState(KEY_GAME_MODE, mode, true);
    if (isTeamGameMode(mode)) {
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
        this.hostSetPlayerLoadoutSlot(playerId, 'weapon2', snapshot.weapon2);
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
    if (usesTeamColors(this.getGameMode())) {
      const teamId = this.getPlayerTeam(playerId);
      if (teamId) return this.getTeamColor(teamId);
    }
    return this.getStoredPlayerColor(playerId);
  }

  getPlayerDmColor(playerId: string): number | undefined {
    return this.getStoredPlayerColor(playerId);
  }

  areTeammates(firstPlayerId: string, secondPlayerId: string): boolean {
    if (firstPlayerId === secondPlayerId) return true;
    if (!isTeamGameMode(this.getGameMode())) return false;
    if (isCoopDefenseMode(this.getGameMode())) {
      if (firstPlayerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID) {
        return this.connectedPlayers.has(secondPlayerId);
      }
      if (secondPlayerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID) {
        return this.connectedPlayers.has(firstPlayerId);
      }
    }
    const firstTeam = this.getPlayerTeam(firstPlayerId);
    const secondTeam = this.getPlayerTeam(secondPlayerId);
    return firstTeam !== null && firstTeam === secondTeam;
  }

  isEnemyPair(firstPlayerId: string, secondPlayerId: string): boolean {
    if (firstPlayerId === secondPlayerId) return false;
    if (!isTeamGameMode(this.getGameMode())) return true;
    const firstTeam = this.getPlayerTeam(firstPlayerId);
    const secondTeam = this.getPlayerTeam(secondPlayerId);
    if (!firstTeam || !secondTeam) return true;
    return firstTeam !== secondTeam;
  }

  canPlayerChangeTeam(playerId: string): boolean {
    if (isCoopDefenseMode(this.getGameMode())) return false;
    return !this.getPlayerReady(playerId);
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
    const teamId: TeamId = isCoopDefenseMode(this.getGameMode()) ? 'blue' : this.pickBalancedTeam();
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
    const unassigned = playerIds.filter((playerId) => !this.getPlayerTeam(playerId));
    if (unassigned.length === 0) return;
    unassigned.sort(() => Math.random() - 0.5);
    for (const playerId of unassigned) {
      this.playerStateMap.get(playerId)?.setState(KEY_PLAYER_TEAM, this.pickBalancedTeam(), true);
    }
    this.connectedPlayersCacheDirty = true;
  }

  // ── Input: Client → Host (pro Spieler, unreliable) ────────────────────────
  sendLocalInput(input: PlayerInput): void {
    myPlayer().setState(KEY_INPUT, input);
  }

  getPlayerInput(playerId: string): PlayerInput | undefined {
    return this.playerStateMap.get(playerId)?.getState(KEY_INPUT) as PlayerInput | undefined;
  }

  // ── Anzeigename: pro Spieler ──────────────────────────────────────────────

  /** Setzt den eigenen Anzeigenamen (überschreibt Playroom-Profil-Name). */
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

  /** Liest den verbindlichen Ready-Loadout-Snapshot eines Spielers. */
  getPlayerCommittedLoadout(playerId: string): LoadoutCommitSnapshot | null {
    const raw = this.playerStateMap.get(playerId)?.getState(KEY_LOADOUT_COMMITTED) as Partial<LoadoutCommitSnapshot> | null | undefined;
    if (!raw || typeof raw !== 'object') return null;
    if (
      typeof raw.weapon1 !== 'string'
      || typeof raw.weapon2 !== 'string'
      || typeof raw.utility !== 'string'
      || typeof raw.ultimate !== 'string'
    ) {
      return null;
    }
    return {
      weapon1: raw.weapon1,
      weapon2: raw.weapon2,
      utility: raw.utility,
      ultimate: raw.ultimate,
      coopDefenseProfile: raw.coopDefenseProfile == null ? null : sanitizeCoopDefenseUpgradeProfile(raw.coopDefenseProfile),
    };
  }

  /** Liest eine committed Loadout-Slot-ID eines Spielers. */
  getPlayerCommittedLoadoutSlot(playerId: string, slot: LoadoutSlot): string | undefined {
    return this.getPlayerCommittedLoadout(playerId)?.[slot];
  }

  /** True, wenn ein Spieler einen vollstaendigen verbindlichen Ready-Snapshot hat. */
  hasCommittedLoadout(playerId: string): boolean {
    return this.getPlayerCommittedLoadout(playerId) !== null;
  }

  hasCommittedCoopDefenseProfile(playerId: string): boolean {
    return this.getPlayerCommittedLoadout(playerId)?.coopDefenseProfile !== null;
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
    return this.getGamePhase() === 'ARENA' && effectiveNow < this.getArenaStartTime();
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

  // ── Arena Layout: Host → Alle (global, reliable, einmalig pro Runde) ─────────
  publishArenaLayout(layout: ArenaLayout): void {
    setState(KEY_ARENA_LAYOUT, layout, true);   // reliable=true: kommt garantiert vor Phase-Wechsel an
  }

  getArenaLayout(): ArenaLayout | undefined {
    return getState(KEY_ARENA_LAYOUT) as ArenaLayout | undefined;
  }

  // ── Game State: Host → Alle (global, unreliable) ──────────────────────────

  // Client-seitiger Cache für Partial-State-Merge (leere Arrays werden nicht gesendet)
  private cachedGameState: GameState | undefined;
  // Host-seitige Sequenznummer: wird bei jedem publishGameState() inkrementiert
  private publishSeq = 0;
  private burningGroundPublishTicks = 0;
  private readonly lastPublishedBurningGround = new Map<number, EncodedBurningGroundCell>();
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
    this.lastSeenSeq = -1;
    this.burningGroundPublishTicks = 0;
    this.lastPublishedBurningGround.clear();
  }

  /**
   * Sendet den Game State als einzelnen setState-Aufruf.
   * Leere Arrays und null-Werte werden weggelassen, um Bandbreite zu sparen.
   * Enthält eine Sequenznummer (_s) für zuverlässige Change-Detection auf Clients.
   */
  publishGameState(state: OutboundGameState): void {
    const payload: Record<string, unknown> = { p: encodePlayerStates(state.players), _s: ++this.publishSeq };
    payload.rt = state.roundStartTime;
    if (state.projectiles.length > 0)  payload.j = state.projectiles;
    if (state.enemies)                 payload.e = state.enemies;
    if (state.rocks)                   payload.r = state.rocks;
    if (state.placeableRocks.length > 0) payload.br = state.placeableRocks;
    if (state.decoys.length > 0)       payload.dc = state.decoys;
    if (state.smokes.length > 0)       payload.s = state.smokes;
    if (state.fires.length > 0)        payload.f = state.fires;
    if (state.stinkClouds.length > 0)  payload.sc = state.stinkClouds;
    if (state.timeBubbles.length > 0)  payload.tb = state.timeBubbles;
    if (state.teslaDomes.length > 0)   payload.td = state.teslaDomes;
    if (state.energyShields.length > 0) payload.es = state.energyShields;
    if (state.guardianSpirits.length > 0) payload.g = state.guardianSpirits;
    if (state.slimeTrail.cells.length > 0 || state.slimeTrail.affectedEnemies.length > 0) {
      payload.sl = encodeSlimeTrailSnapshot(state.slimeTrail);
    }
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
    this.recordEnemySyncMetrics(payload, state.enemies);
    setState(KEY_GAME_STATE, payload, false);
  }

  private recordEnemySyncMetrics(payload: Record<string, unknown>, enemySnapshot: SyncedEnemySnapshot | null): void {
    if (!NET_DEBUG_ENEMY_SYNC_METRICS || !isHost() || !enemySnapshot) return;

    const now = Date.now();
    const totalPayloadBytes = JSON.stringify(payload).length;
    const enemyPayloadBytes = payload.e ? JSON.stringify(payload.e).length : 0;
    const enemyCount = enemySnapshot.c;
    const window = this.enemySyncMetricsWindow ?? {
      startedAtMs: now,
      tickCount: 0,
      totalPayloadBytes: 0,
      enemyPayloadBytes: 0,
      enemyCountSum: 0,
      fullTickCount: 0,
      upsertCountSum: 0,
      removalCountSum: 0,
      maxEnemyCount: 0,
      maxTotalPayloadBytes: 0,
      maxEnemyPayloadBytes: 0,
      slicePayloadBytesSums: {},
      slicePayloadBytesPeaks: {},
    } satisfies EnemySyncMetricsWindow;
    const slicePayloadBytes = this.measurePayloadSlices(payload);

    window.tickCount += 1;
    window.totalPayloadBytes += totalPayloadBytes;
    window.enemyPayloadBytes += enemyPayloadBytes;
    window.enemyCountSum += enemyCount;
    window.fullTickCount += enemySnapshot.a ? 1 : 0;
    window.upsertCountSum += countEnemyUpserts(enemySnapshot.u);
    window.removalCountSum += enemySnapshot.r.length;
    window.maxEnemyCount = Math.max(window.maxEnemyCount, enemyCount);
    window.maxTotalPayloadBytes = Math.max(window.maxTotalPayloadBytes, totalPayloadBytes);
    window.maxEnemyPayloadBytes = Math.max(window.maxEnemyPayloadBytes, enemyPayloadBytes);
    for (const [key, bytes] of Object.entries(slicePayloadBytes)) {
      window.slicePayloadBytesSums[key] = (window.slicePayloadBytesSums[key] ?? 0) + bytes;
      window.slicePayloadBytesPeaks[key] = Math.max(window.slicePayloadBytesPeaks[key] ?? 0, bytes);
    }
    this.enemySyncMetricsWindow = window;

    if (now - window.startedAtMs < NET_DEBUG_ENEMY_SYNC_METRICS_WINDOW_MS) return;

    const avgEnemyCount = window.enemyCountSum / Math.max(1, window.tickCount);
    const avgTotalPayloadBytes = window.totalPayloadBytes / Math.max(1, window.tickCount);
    const avgEnemyPayloadBytes = window.enemyPayloadBytes / Math.max(1, window.tickCount);
    const avgEnemyPayloadShare = avgTotalPayloadBytes > 0
      ? (avgEnemyPayloadBytes / avgTotalPayloadBytes) * 100
      : 0;
    const avgUpserts = window.upsertCountSum / Math.max(1, window.tickCount);
    const avgRemovals = window.removalCountSum / Math.max(1, window.tickCount);
    const topAvgSlices = this.formatTopSliceMetrics(window.slicePayloadBytesSums, window.tickCount, 'avg');
    const topPeakSlices = this.formatTopSliceMetrics(window.slicePayloadBytesPeaks, 1, 'peak');

    console.log(
      `[NET][enemy-sync] ticks=${window.tickCount} fullTicks=${window.fullTickCount} avgEnemies=${avgEnemyCount.toFixed(1)} maxEnemies=${window.maxEnemyCount} avgUpserts=${avgUpserts.toFixed(1)} avgRemovals=${avgRemovals.toFixed(1)} avgPayload=${avgTotalPayloadBytes.toFixed(0)}B avgEnemy=${avgEnemyPayloadBytes.toFixed(0)}B enemyShare=${avgEnemyPayloadShare.toFixed(1)}% peakPayload=${window.maxTotalPayloadBytes}B peakEnemy=${window.maxEnemyPayloadBytes}B`,
    );
    console.log(`[NET][game-state] topAvg=${topAvgSlices} topPeak=${topPeakSlices}`);

    this.enemySyncMetricsWindow = {
      startedAtMs: now,
      tickCount: 0,
      totalPayloadBytes: 0,
      enemyPayloadBytes: 0,
      enemyCountSum: 0,
      fullTickCount: 0,
      upsertCountSum: 0,
      removalCountSum: 0,
      maxEnemyCount: enemyCount,
      maxTotalPayloadBytes: totalPayloadBytes,
      maxEnemyPayloadBytes: enemyPayloadBytes,
      slicePayloadBytesSums: {},
      slicePayloadBytesPeaks: {},
    };
  }

  private measurePayloadSlices(payload: Record<string, unknown>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(payload)) {
      result[key] = JSON.stringify(value).length;
    }
    return result;
  }

  private formatTopSliceMetrics(
    sliceBytes: Record<string, number>,
    divisor: number,
    mode: 'avg' | 'peak',
  ): string {
    const entries = Object.entries(sliceBytes)
      .filter(([key, bytes]) => bytes > 0 && key !== '_s' && key !== 'rt')
      .map(([key, bytes]) => ({
        label: GAME_STATE_SLICE_LABELS[key] ?? key,
        bytes: mode === 'avg' ? bytes / Math.max(1, divisor) : bytes,
      }))
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 5);

    if (entries.length === 0) return 'none';

    return entries
      .map((entry) => `${entry.label}:${entry.bytes.toFixed(0)}B`)
      .join(', ');
  }

  getLatestGameState(): GameState | undefined {
    const raw = getState(KEY_GAME_STATE) as Record<string, unknown> | undefined;
    if (!raw || !raw.p) return this.cachedGameState;
    // Sequenznummer vergleichen: nur parsen wenn neue Daten vom Host eingetroffen sind
    const seq = raw._s as number | undefined;
    if (seq !== undefined && seq === this.lastSeenSeq) return this.cachedGameState;
    if (seq !== undefined) this.lastSeenSeq = seq;

    const roundStartTime = (raw.rt as number | undefined) ?? 0;
    const expectedRoundStartTime = this.getArenaStartTime();
    if (this.getGamePhase() === 'ARENA' && expectedRoundStartTime > 0 && roundStartTime !== expectedRoundStartTime) {
      this.cachedGameState = undefined;
      return undefined;
    }

    const nextRocks = this.mergeRockSnapshot(
      raw.r as SyncedRockSnapshot | undefined,
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
      roundStartTime,
      players:       decodePlayerStates(raw.p as Parameters<typeof decodePlayerStates>[0]),
      projectiles:   (raw.j as SyncedProjectile[]  | undefined) ?? [],
      enemies:       (raw.e as SyncedEnemySnapshot | undefined) ?? null,
      rocks:         nextRocks,
      placeableRocks: (raw.br as SyncedPlaceableRock[] | undefined) ?? [],
      decoys:        (raw.dc as SyncedDecoy[]       | undefined) ?? [],
      smokes:        (raw.s as SyncedSmokeCloud[]   | undefined) ?? [],
      fires:         (raw.f as SyncedFireZone[]      | undefined) ?? [],
      stinkClouds:   (raw.sc as SyncedStinkCloud[]   | undefined) ?? [],
      timeBubbles:   (raw.tb as SyncedTimeBubble[]   | undefined) ?? [],
      teslaDomes:    (raw.td as SyncedTeslaDome[]    | undefined) ?? [],
      energyShields: (raw.es as SyncedEnergyShield[] | undefined) ?? [],
      guardianSpirits: (raw.g as SyncedGuardianSpirit[] | undefined) ?? [],
      slimeTrail: decodeSlimeTrailSnapshot(raw.sl),
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
    };
    this.cachedGameState = state;
    this.gameStateVersion++;
    return state;
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
      return [...snapshot.upserts].sort((left, right) => left.id - right.id);
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

  // ── Zug-Event: Host → Alle (global, reliable, einmalig pro Runde) ──────────

  /** Host-only: Veröffentlicht die Zug-Konfiguration für die Runde. */
  publishTrainEvent(cfg: TrainEventConfig): void {
    setState(KEY_TRAIN_EVENT, cfg, true);
  }

  /** Liest die Zug-Event-Konfiguration (undefined = noch nicht gesetzt). */
  getTrainEvent(): TrainEventConfig | undefined {
    return getState(KEY_TRAIN_EVENT) as TrainEventConfig | undefined;
  }

  // ── Zug-Zerstörung: Host → Alle (RPC, einmalig) ───────────────────────────

  /** Host-only: Broadcastet, dass der Zug zerstört wurde. */
  broadcastTrainDestroyed(): void {
    this.broadcastRpc('trdes', {});
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
  ): Promise<LoadoutUseResult | null> {
    if (isHost()) {
      return this.loadoutUseHandler?.(slot, angle, targetX, targetY, myPlayer().id, shotId, params, clientX, clientY, clientNow) ?? { ok: false, reason: 'invalid' };
    }
    if (!awaitResult) {
      this.sendHostRpc('lu', { slot, angle, tx: targetX, ty: targetY, sid: shotId, prm: params, px: clientX, py: clientY, ts: clientNow });
      return null;
    }
    const result = await this.callHostRpc('lu', { slot, angle, tx: targetX, ty: targetY, sid: shotId, prm: params, px: clientX, py: clientY, ts: clientNow }, 1200);
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
      const { slot, angle, tx, ty, sid, prm, px, py, ts } = data as {
        slot: LoadoutSlot;
        angle: number;
        tx: number;
        ty: number;
        sid?: number;
        prm?: LoadoutUseParams;
        px?: number;
        py?: number;
        ts?: number;
      };
      // Verwende Client-Timestamp für Cooldown-Tracking (verhindert Schussverlust bei variierender RPC-Latenz).
      // Plausibilitätsprüfung: Max. 200ms Abweichung vom Host-Time (Anti-Cheat).
      const hostNow = Date.now();
      const clientNow = (typeof ts === 'number' && Math.abs(hostNow - ts) <= 200) ? ts : hostNow;
      return loadoutUseHandler(slot, angle, tx, ty, caller.id, sid, prm, px, py, clientNow);
    });
  }

  // ── Power-Up-Pickup-RPC: Client → Host ────────────────────────────────────

  sendPickupPowerUp(uid: number): void {
    if (isHost()) {
      this.powerUpPickupHandler?.(uid, myPlayer().id);
      return;
    }
    this.sendHostRpc('pup', { uid });
  }

  registerPickupPowerUpHandler(handler: (uid: number, playerId: string) => void): void {
    this.powerUpPickupHandler = handler;
    this.registerHostRpcHandler('pup', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return undefined;
      const cb = this.powerUpPickupHandler;
      if (!cb) return undefined;
      const { uid } = data as { uid: number };
      cb(uid, caller.id);
      return undefined;
    });
  }

  sendDecoyStealthBreakRequest(): void {
    if (isHost()) {
      this.decoyStealthBreakHandler?.(myPlayer().id);
      return;
    }
    this.sendHostRpc('dbr', {});
  }

  registerDecoyStealthBreakHandler(handler: (playerId: string) => void): void {
    this.decoyStealthBreakHandler = handler;
    this.registerHostRpcHandler('dbr', async (_data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return undefined;
      this.decoyStealthBreakHandler?.(caller.id);
      return undefined;
    });
  }

  // ── Explosions-Effekt-RPC: Host → Alle ────────────────────────────────────

  broadcastExplosionEffect(x: number, y: number, radius: number, color?: number, visualStyle?: ExplosionVisualStyle): void {
    this.broadcastRpc('xfx', { x, y, r: radius, c: color, s: visualStyle });
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
    this.broadcastRpc('sbfx', { x, y, p: targets.flatMap(target => [target.x, target.y]) });
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

  broadcastBlackHoleEffect(x: number, y: number, radius: number, durationMs: number): void {
    this.broadcastRpc('bhfx', { x, y, r: radius, d: durationMs });
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
    this.broadcastRpc('gcnt', { x, y, v: value });
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
      this.broadcastRpc('fxb', batch);
    }
    if (this.pendingXpPopups.length > 0) {
      const popups = this.pendingXpPopups;
      this.pendingXpPopups = [];
      this.broadcastRpc('cdxpb', popups);
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
    this.broadcastRpc('sfx', { id: shooterId, d: duration, i: intensity });
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
  ): void {
    this.broadcastRpc('htfx', { sx: startX, sy: startY, ex: endX, ey: endY, c: color, t: thickness, ik: impactKind, vp: visualPreset, id: shooterId, sid: shotId, sa: shotAudioKey });
  }

  registerHitscanTracerHandler(handler: HitscanTracerHandler): void {
    this.hitscanTracerHandler = handler;
    this.registerAllRpcHandler('htfx', async (data: unknown): Promise<unknown> => {
      const hitscanTracerHandler = this.hitscanTracerHandler;
      if (!hitscanTracerHandler) return undefined;
      const { sx, sy, ex, ey, c, t, ik, vp, id, sid, sa } = data as {
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
      };
      hitscanTracerHandler(sx, sy, ex, ey, c, t, ik, vp, id, sid, sa);
      return undefined;
    });
  }

  // ── Translocator-Effekt-RPC: Host → Alle ───────────────────────────────────

  broadcastTranslocatorFlash(x: number, y: number, color: number, type: 'start' | 'end'): void {
    this.broadcastRpc('tlfx', { x, y, c: color, t: type });
  }

  registerTranslocatorFlashHandler(handler: TranslocatorFlashHandler): void {
    this.translocatorFlashHandler = handler;
    this.registerAllRpcHandler('tlfx', async (data: unknown): Promise<unknown> => {
      const translocatorFlashHandler = this.translocatorFlashHandler;
      if (!translocatorFlashHandler) return undefined;
      const { x, y, c, t } = data as { x: number; y: number; c: number; t: 'start' | 'end' };
      translocatorFlashHandler(x, y, c, t);
      return undefined;
    });
  }

  broadcastCaptureTheBeerFx(event: CaptureTheBeerFxEvent): void {
    if (event.kind === 'drop' || event.kind === 'score') {
      this.broadcastRpc('btfx', {
        k: event.kind,
        bt: event.beerTeamId,
        x: event.x,
        y: event.y,
        ...(event.kind === 'score' ? { st: event.scoreTeamId, sn: event.scorerName, sc: event.scorerColor } : {}),
      });
      return;
    }

    this.broadcastRpc('btfx', {
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

  // ── Melee-Swing-RPC: Host → Alle ──────────────────────────────────────────

  broadcastMeleeSwing(swing: SyncedMeleeSwing): void {
    this.broadcastRpc('msfx', {
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
    this.sendHostRpc('dash', { dx, dy });
  }

  registerDashHandler(cb: (playerId: string, dx: number, dy: number) => void): void {
    this.dashHandler = cb;
    this.registerHostRpcHandler('dash', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return;
      const dashHandler = this.dashHandler;
      if (!dashHandler) return undefined;
      const { dx, dy } = data as { dx: number; dy: number };
      dashHandler(caller.id, dx, dy);
      return undefined;
    });
  }

  // ── Burrow-RPC: Client → Host ─────────────────────────────────────────────

  sendBurrowRequest(wantsBurrowed: boolean): void {
    this.sendHostRpc('burrow', { want: wantsBurrowed });
  }

  registerBurrowHandler(cb: (playerId: string, wantsBurrowed: boolean) => void): void {
    this.burrowHandler = cb;
    this.registerHostRpcHandler('burrow', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return;
      const burrowHandler = this.burrowHandler;
      if (!burrowHandler) return undefined;
      const { want } = data as { want: boolean };
      burrowHandler(caller.id, want);
      return undefined;
    });
  }

  // ── Schockwellen-Effekt: Host → Alle ─────────────────────────────────────

  broadcastShockwaveEffect(x: number, y: number): void {
    this.broadcastRpc('shockfx', { x, y });
  }

  broadcastTrainBurrowSparks(x: number, y: number): void {
    this.broadcastRpc('tbsparks', { x, y });
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

  broadcastBfgLaserBatch(lines: { sx: number; sy: number; ex: number; ey: number }[], color: number, visualPreset?: HitscanVisualPreset): void {
    if (lines.length === 0) return;
    this.broadcastRpc('bfl', { l: lines, c: color, v: visualPreset });
  }

  broadcastMiniRocketCollectionEffect(x: number, y: number, color: number): void {
    this.broadcastRpc('mrcfx', { x, y, c: color });
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
    this.broadcastRpc('mrdfx', { x, y, c: color });
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

  registerBfgLaserBatchHandler(handler: (lines: { sx: number; sy: number; ex: number; ey: number }[], color: number, visualPreset?: HitscanVisualPreset) => void): void {
    this.bfgLaserHandler = handler;
    this.registerAllRpcHandler('bfl', async (data: unknown): Promise<unknown> => {
      const cb = this.bfgLaserHandler;
      if (!cb) return undefined;
      const { l, c, v } = data as { l: { sx: number; sy: number; ex: number; ey: number }[]; c: number; v?: HitscanVisualPreset };
      cb(l, c, v);
      return undefined;
    });
  }

  // ── Burrow-Visualisierung: Host → Alle ────────────────────────────────────

  broadcastBurrowVisual(playerId: string, phase: BurrowPhase): void {
    this.broadcastRpc('bfx', { id: playerId, p: phase });
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

  /** Host-only: Publiziert bis wann die Utility eines Spielers im Cooldown ist. */
  publishUtilityCooldownUntil(playerId: string, cooldownUntil: number): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_UTILITY_CD_UNTIL, cooldownUntil, true);
  }

  /** Liest den autoritativen Utility-Cooldown-Endzeitpunkt eines Spielers (0 = bereit). */
  getPlayerUtilityCooldownUntil(playerId: string): number {
    return (this.playerStateMap.get(playerId)?.getState(KEY_UTILITY_CD_UNTIL) as number | undefined) ?? 0;
  }

  /** Host-only: Publiziert den Display-Namen einer Utility-Override (z.B. BFG, Heilige Handgranate). Leerstring = kein Override. */
  publishUtilityOverrideName(playerId: string, name: string): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_UTILITY_OVERRIDE_NAME, name, true);
  }

  /** Liest den aktuellen Utility-Override-Namen eines Spielers (leer = kein Override). */
  getPlayerUtilityOverrideName(playerId: string): string {
    return (this.playerStateMap.get(playerId)?.getState(KEY_UTILITY_OVERRIDE_NAME) as string | undefined) ?? '';
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
    if (!isHost()) return;
    const ps = this.playerStateMap.get(killerId);
    if (!ps) return;
    const current = (ps.getState(KEY_FRAGS) as number | undefined) ?? 0;
    ps.setState(KEY_FRAGS, current + 1);
  }

  /** Host-only: Erhöht den Frag-Zähler eines Spielers um einen beliebigen Betrag. */
  addPlayerFrags(playerId: string, amount: number): void {
    if (!isHost()) return;
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

  /** Liest den gemessenen Roundtrip-Ping eines Spielers in ms (Standard: 0 für Host). */
  getPlayerPing(playerId: string): number {
    return (this.playerStateMap.get(playerId)?.getState(KEY_PING) as number | undefined) ?? 0;
  }

  publishRoomQuality(snapshot: RoomQualitySnapshot | null): void {
    setState(KEY_ROOM_QUALITY, snapshot, true);
  }

  getRoomQuality(): RoomQualitySnapshot | null {
    return (getState(KEY_ROOM_QUALITY) as RoomQualitySnapshot | null | undefined) ?? null;
  }

  async measureHostRoomLoopback(sampleCount: number, timeoutMs: number): Promise<HostRoomQualityProbeResult> {
    return await this.pingController.measureHostRoomLoopback(sampleCount, timeoutMs);
  }

  /**
   * Client-only: Sendet einen Ping-Request an den Host.
   * Für den Host kein-Op (bleibt bei Default-Ping 0 ms).
   */
  sendPingToHost(): void {
    this.pingController.sendPingToHost();
  }

  /**
   * Registriert die RPC-Handler für die Round-Trip-Ping-Messung.
   * Muss einmalig in ArenaScene.create() aufgerufen werden.
   *
   * Ablauf:
   *   Client → Host ('png'):  sendet { ts, id }
   *   Host   → Alle ('pong'): broadcastet { ts, id } zurück
   *   Client ('pong'):        misst RTT, schreibt per-player-State KEY_PING
   */
  setupPingMeasurement(): void {
    this.pingController.setupPingMeasurement();
  }

  // ── Rundenabschluss-Snapshot: Host → Alle (global, reliable) ─────────────

  /** Host-only: Speichert den Endstand der Runde für die Lobby-Anzeige. */
  publishRoundResults(results: RoundResult[]): void {
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
    this.broadcastRpc('kev', event);
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

  private sendHostRpc(type: string, payload: unknown): void {
    if (this.isOutboundRpcBlocked()) return;
    this.ensureRpcDispatchersRegistered();
    RPC.call(HOST_RPC_CHANNEL, { type, payload }, RPC.Mode.HOST).catch((error: unknown) => {
      this.handleOutboundRpcError(type, error);
    });
  }

  private callHostRpc(type: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    if (this.isOutboundRpcBlocked()) {
      return Promise.reject(new Error(`RPC temporarily unavailable: ${type}`));
    }
    this.ensureRpcDispatchersRegistered();
    const rpcPromise = RPC.call(HOST_RPC_CHANNEL, { type, payload }, RPC.Mode.HOST).catch((error: unknown) => {
      this.handleOutboundRpcError(type, error);
      throw error;
    });
    return Promise.race([
      rpcPromise,
      new Promise((_, reject) => window.setTimeout(() => reject(new Error(`RPC timeout: ${type}`)), timeoutMs)),
    ]);
  }

  private broadcastRpc(type: string, payload: unknown): void {
    if (this.isOutboundRpcBlocked()) return;
    this.ensureRpcDispatchersRegistered();
    RPC.call(ALL_RPC_CHANNEL, { type, payload }, RPC.Mode.ALL).catch((error: unknown) => {
      this.handleOutboundRpcError(type, error);
    });
  }

  private isOutboundRpcBlocked(): boolean {
    return Date.now() < this.outboundRpcBlockedUntilMs;
  }

  private handleOutboundRpcError(type: string, error: unknown): void {
    if (this.isExpectedRpcTransportClose(error)) {
      const now = Date.now();
      this.outboundRpcBlockedUntilMs = Math.max(this.outboundRpcBlockedUntilMs, now + OUTBOUND_RPC_BACKOFF_MS);
      if (now - this.lastOutboundRpcWarningAtMs >= OUTBOUND_RPC_BACKOFF_MS) {
        this.lastOutboundRpcWarningAtMs = now;
        console.warn(`[NetworkBridge] Suppressing outbound RPCs for ${OUTBOUND_RPC_BACKOFF_MS}ms after transport closed while sending '${type}'.`);
      }
      return;
    }
    console.error(error);
  }

  private isExpectedRpcTransportClose(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /websocket is already in closing or closed state/i.test(message)
      || /socket.*closing|socket.*closed/i.test(message);
  }

  private registerHostRpcHandler(
    type: string,
    handler: (payload: unknown, caller: PlayerState) => Promise<unknown> | unknown,
  ): void {
    this.hostRpcHandlers.set(type, handler);
    this.ensureRpcDispatchersRegistered();
  }

  private registerAllRpcHandler(
    type: string,
    handler: (payload: unknown) => Promise<unknown> | unknown,
  ): void {
    this.allRpcHandlers.set(type, handler);
    this.ensureRpcDispatchersRegistered();
  }

  private ensureRpcDispatchersRegistered(): void {
    if (!this.hostDispatcherRegistered) {
      this.hostDispatcherRegistered = true;
      RPC.register(HOST_RPC_CHANNEL, async (data: unknown, caller: PlayerState): Promise<unknown> => {
        const envelope = this.parseRpcEnvelope(data);
        if (!envelope) return undefined;
        const handler = this.hostRpcHandlers.get(envelope.type);
        if (!handler) return undefined;
        return await handler(envelope.payload, caller);
      });
    }

    if (!this.allDispatcherRegistered) {
      this.allDispatcherRegistered = true;
      RPC.register(ALL_RPC_CHANNEL, async (data: unknown): Promise<unknown> => {
        const envelope = this.parseRpcEnvelope(data);
        if (!envelope) return undefined;
        const handler = this.allRpcHandlers.get(envelope.type);
        if (!handler) return undefined;
        return await handler(envelope.payload);
      });
    }
  }

  private parseRpcEnvelope(data: unknown): RpcEnvelope | null {
    if (!data || typeof data !== 'object') return null;
    const envelope = data as Partial<RpcEnvelope>;
    if (typeof envelope.type !== 'string') return null;
    return { type: envelope.type, payload: envelope.payload };
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
    let changed = this.connectedPlayersCacheDirty;

    for (const state of this.playerStateMap.values()) {
      const nextProfile = this.syncConnectedProfile(state);
      if (this.connectedPlayers.get(state.id) !== nextProfile) changed = true;
    }

    if (!changed && this.cachedConnectedPlayers.length === this.connectedPlayers.size) return;

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
  private extractProfile(state: PlayerState): PlayerProfile {
    const profile    = state.getProfile();
    const stateName  = state.getState(KEY_NAME)         as string | undefined;
    const effectiveColor = this.getEffectivePlayerColor(state.id);
    const teamId = this.getPlayerTeam(state.id);

    let colorHex: number;
    if (effectiveColor !== undefined) {
      colorHex = effectiveColor;
    } else {
      const rawHex = (profile.color as unknown as Record<string, unknown> | undefined)?.hex ?? '#ffffff';
      const parsed = parseInt(String(rawHex).replace('#', ''), 16);
      colorHex = isNaN(parsed) ? 0xffffff : parsed;
    }

    return {
      id:       state.id,
      name:     sanitizePlayerName(stateName || profile.name || '') || 'Player',
      colorHex,
      teamId,
    };
  }

  private getStoredPlayerColor(playerId: string): number | undefined {
    return this.playerStateMap.get(playerId)?.getState(KEY_PLAYER_COLOR) as number | undefined;
  }

  private hostHandleTeamRequest(teamId: TeamId, requesterId: string): boolean {
    if (!isHost()) return false;
    if (!this.canPlayerChangeTeam(requesterId)) return false;
    this.playerStateMap.get(requesterId)?.setState(KEY_PLAYER_TEAM, teamId, true);
    this.connectedPlayersCacheDirty = true;
    return true;
  }

  private pickBalancedTeam(): TeamId {
    const blueCount = this.getTeamPlayerCount('blue');
    const redCount = this.getTeamPlayerCount('red');
    if (blueCount < redCount) return 'blue';
    if (redCount < blueCount) return 'red';
    return Math.random() < 0.5 ? 'blue' : 'red';
  }

  private getTeamPlayerCount(teamId: TeamId): number {
    let count = 0;
    for (const playerId of this.connectedPlayers.keys()) {
      if (this.getPlayerTeam(playerId) === teamId) count++;
    }
    return count;
  }
}
