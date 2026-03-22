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
import type { PlayerInput, PlayerProfile, PlayerNetState, SyncedProjectile, SyncedHitscanTrace, SyncedMeleeSwing, SyncedSmokeCloud, SyncedFireZone, SyncedPowerUp, SyncedNukeStrike, SyncedMeteorStrike, GamePhase, ArenaLayout, RockNetState, LoadoutSlot, LoadoutUseParams, TrainEventConfig, SyncedTrainState } from '../types';
import { MAX_PLAYERS } from '../config';

const HOST_RPC_CHANNEL = 'rpc_host';
const ALL_RPC_CHANNEL  = 'rpc_all';

// ── Interne State-Keys – nie nach außen exportiert ───────────────────────────
const KEY_INPUT        = 'inp';
const KEY_PLAYERS      = 'plr';
const KEY_PROJECTILES  = 'prj';
const KEY_READY        = 'isr';   // per-player boolean: isReady
const KEY_NAME         = 'pnm';   // per-player string: Anzeigename (überschreibt Playroom-Profil)
const KEY_GAME_PHASE   = 'gph';   // global: 'LOBBY' | 'ARENA'
const KEY_ARENA_START  = 'ast';   // global: number (timestamp ms ab dem Input/Game freigegeben wird)
const KEY_ROUND_END    = 'ret';   // global: number (timestamp ms)
const KEY_HOST_ID      = 'hid';   // global: string (Player-ID des Match-Hosts)
const KEY_ARENA_LAYOUT = 'aly';   // global: ArenaLayout (reliable, einmalig pro Runde)
const KEY_ROCK_HP      = 'rck';   // global: RockNetState[] (unreliable, Delta-Snapshot)
const KEY_AVAIL_COLORS = 'avc';   // global: number[] (verfügbarer Farbpool, reliable)
const KEY_PLAYER_COLOR = 'clr';   // per-player: number (benutzerdefinierte Spielerfarbe)
const KEY_LOADOUT_W1   = 'lw1';   // per-player: string (weapon1 item ID)
const KEY_LOADOUT_W2   = 'lw2';   // per-player: string (weapon2 item ID)
const KEY_LOADOUT_UT   = 'lut';   // per-player: string (utility item ID)
const KEY_LOADOUT_UL   = 'lul';   // per-player: string (ultimate item ID)
const KEY_UTILITY_CD_UNTIL = 'ucd'; // per-player: number (Date.now()-Timestamp bis Utility wieder bereit)
const KEY_UTILITY_OVERRIDE_NAME = 'uon'; // per-player: string (display name of overridden utility, empty = no override)
const KEY_ADR_SYRINGE  = 'asr';   // per-player: boolean (Adrenalinspritze aktiv, regen multiplier > 1)
const KEY_ACTIVE_BUFFS = 'abf';   // per-player: {defId,remainingFrac}[] (aktive Buffs für HUD)
const KEY_FRAGS        = 'frg';   // per-player: number (Frag-Zähler)
const KEY_ROUND_RESULTS = 'rrs'; // global reliable: RoundResult[] (Rundenabschluss-Snapshot)
// KEY_HITSCAN_TRACES und KEY_MELEE_SWINGS entfernt – werden jetzt per RPC gesendet
const KEY_SMOKE_CLOUDS   = 'smk'; // global: SyncedSmokeCloud[] (unreliable, host-authoritative Sichtbehinderung)
const KEY_FIRE_ZONES     = 'fzn'; // global: SyncedFireZone[]   (unreliable, host-authoritative Feuerzonen)
const KEY_POWERUPS       = 'pup'; // global: SyncedPowerUp[]    (unreliable, host-authoritative Power-Ups auf dem Boden)
const KEY_NUKE_STRIKES   = 'nks'; // global: SyncedNukeStrike[] (unreliable, host-authoritative aktive Nukes)
const KEY_TRAIN_EVENT    = 'tev'; // global: TrainEventConfig   (reliable,   einmalig pro Runde)
const KEY_TRAIN_STATE    = 'trs'; // global: SyncedTrainState   (unreliable, per-frame Zug-Snapshot)
const KEY_PING           = 'png'; // per-player: number (Roundtrip-Zeit in ms, unreliable)
const KEY_GAME_STATE     = 'gs';  // global: komprimierter Game State (unreliable, single setState)

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
}

export interface GameState {
  players:      Record<string, PlayerNetState>;
  projectiles:  SyncedProjectile[];
  rocks:        RockNetState[];   // Delta: nur beschädigte Felsen (abwesend = voll HP)
  smokes:       SyncedSmokeCloud[];
  fires:        SyncedFireZone[];
  powerups:     SyncedPowerUp[];  // Power-Ups auf dem Boden
  nukes:        SyncedNukeStrike[];
  meteors:      SyncedMeteorStrike[];     // Armageddon-Meteore (Warn- + Einschlagsphase)
  train:        SyncedTrainState | null;  // aktueller Zug-Zustand (null = kein Zug aktiv)
  // Hitscan-Traces und Melee-Swings werden per RPC gesendet (nicht mehr Teil des GameState)
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
) => void;

type ExplosionEffectHandler = (x: number, y: number, radius: number, color?: number, isHoly?: boolean) => void;
type GrenadeCountdownHandler = (x: number, y: number, value: number) => void;
type EffectHandler = (type: 'hit' | 'death', x: number, y: number, shooterId?: string) => void;
type HitscanTracerHandler = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: number,
  thickness: number,
  shooterId?: string,
  shotId?: number,
) => void;
type DashHandler = (playerId: string, dx: number, dy: number) => void;
type BurrowHandler = (playerId: string, wantsBurrowed: boolean) => void;
type ShockwaveEffectHandler = (x: number, y: number) => void;
type BurrowVisualHandler = (playerId: string, isBurrowed: boolean) => void;
type ColorRequestHandler = (requestedColor: number, requesterId: string) => void;
type ColorAcceptedHandler = (requesterId: string, color: number) => void;
type ColorDeniedHandler = (requesterId: string) => void;
type ColorChangeHandler = (playerId: string, color: number) => void;
type KillEventHandler = (event: KillEvent) => void;
type MeleeSwingHandler = (swing: SyncedMeleeSwing) => void;
type PowerUpPickupHandler = (uid: number, playerId: string) => void;
type TrainDestroyedHandler = () => void;

interface RpcEnvelope {
  type: string;
  payload: unknown;
}

export class NetworkBridge {
  private playerStateMap   = new Map<string, PlayerState>();
  private connectedPlayers = new Map<string, PlayerProfile>();

  private joinCbs: Array<(profile: PlayerProfile) => void> = [];
  private quitCbs: Array<(id: string) => void>             = [];

  private activated = false;
  private hostDispatcherRegistered = false;
  private allDispatcherRegistered = false;
  private knownPlayerColors: readonly number[] = [];
  private hostClockOffsetMs = 0;
  private bestClockSyncRttMs = Number.POSITIVE_INFINITY;
  private hostRpcHandlers = new Map<string, (payload: unknown, caller: PlayerState) => Promise<unknown> | unknown>();
  private allRpcHandlers = new Map<string, (payload: unknown) => Promise<unknown> | unknown>();

  private loadoutUseHandler: LoadoutUseHandler | null = null;
  private explosionEffectHandler: ExplosionEffectHandler | null = null;
  private grenadeCountdownHandler: GrenadeCountdownHandler | null = null;
  private effectHandler: EffectHandler | null = null;
  private hitscanTracerHandler: HitscanTracerHandler | null = null;
  private dashHandler: DashHandler | null = null;
  private burrowHandler: BurrowHandler | null = null;
  private shockwaveEffectHandler: ShockwaveEffectHandler | null = null;
  private burrowVisualHandler: BurrowVisualHandler | null = null;
  private colorRequestHandler: ColorRequestHandler | null = null;
  private colorAcceptedHandler: ColorAcceptedHandler | null = null;
  private colorDeniedHandler: ColorDeniedHandler | null = null;
  private colorChangeHandler: ColorChangeHandler | null = null;
  private killEventHandler: KillEventHandler | null = null;
  private meleeSwingHandler: MeleeSwingHandler | null = null;
  private powerUpPickupHandler: PowerUpPickupHandler | null = null;
  private trainDestroyedHandler: TrainDestroyedHandler | null = null;
  private bfgLaserHandler: ((lines: { sx: number; sy: number; ex: number; ey: number }[], color: number) => void) | null = null;

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

      state.onQuit(() => {
        const hadColor = this.getPlayerColor(state.id) !== undefined;
        this.playerStateMap.delete(state.id);
        this.connectedPlayers.delete(state.id);
        if (hadColor) this.reconcileColorPool();
        this.quitCbs.forEach(cb => cb(state.id));
      });

      const profile = this.extractProfile(state);
      this.connectedPlayers.set(state.id, profile);
      this.joinCbs.forEach(cb => cb(profile));
    });
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
    return [...this.playerStateMap.values()].map(s => this.extractProfile(s));
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
    myPlayer().setState(KEY_NAME, name.trim() || 'Player');
  }

  // ── Bereitschaftsstatus: pro Spieler ──────────────────────────────────────
  setLocalReady(ready: boolean): void {
    myPlayer().setState(KEY_READY, ready);
  }

  getPlayerReady(playerId: string): boolean {
    return (this.playerStateMap.get(playerId)?.getState(KEY_READY) as boolean | undefined) ?? false;
  }

  /** Gibt zurück ob ALLE aktuell verbundenen Spieler bereit sind (min. 2). */
  areAllPlayersReady(): boolean {
    const ids = [...this.connectedPlayers.keys()];
    if (ids.length < 2) return false;
    return ids.every(id => this.getPlayerReady(id));
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
    return isHost() ? Date.now() : Date.now() + this.hostClockOffsetMs;
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
  // Client-seitig: zuletzt gesehene Sequenznummer für Change-Detection
  private lastSeenSeq = -1;
  // Monoton steigender Zähler: wird nur bei tatsächlich neuem Server-State inkrementiert
  private gameStateVersion = 0;

  /**
   * Sendet den Game State als einzelnen setState-Aufruf.
   * Leere Arrays und null-Werte werden weggelassen, um Bandbreite zu sparen.
   * Enthält eine Sequenznummer (_s) für zuverlässige Change-Detection auf Clients.
   */
  publishGameState(state: GameState): void {
    const payload: Record<string, unknown> = { p: state.players, _s: ++this.publishSeq };
    if (state.projectiles.length > 0)  payload.j = state.projectiles;
    if (state.rocks.length > 0)        payload.r = state.rocks;
    if (state.smokes.length > 0)       payload.s = state.smokes;
    if (state.fires.length > 0)        payload.f = state.fires;
    if (state.powerups.length > 0)     payload.u = state.powerups;
    if (state.nukes.length > 0)        payload.n = state.nukes;
    if (state.meteors.length > 0)      payload.mt = state.meteors;
    if (state.train)                   payload.t = state.train;
    setState(KEY_GAME_STATE, payload, false);
  }

  getLatestGameState(): GameState | undefined {
    const raw = getState(KEY_GAME_STATE) as Record<string, unknown> | undefined;
    if (!raw || !raw.p) return this.cachedGameState;
    // Sequenznummer vergleichen: nur parsen wenn neue Daten vom Host eingetroffen sind
    const seq = raw._s as number | undefined;
    if (seq !== undefined && seq === this.lastSeenSeq) return this.cachedGameState;
    if (seq !== undefined) this.lastSeenSeq = seq;
    const state: GameState = {
      players:       raw.p as Record<string, PlayerNetState>,
      projectiles:   (raw.j as SyncedProjectile[]  | undefined) ?? [],
      rocks:         (raw.r as RockNetState[]       | undefined) ?? [],
      smokes:        (raw.s as SyncedSmokeCloud[]   | undefined) ?? [],
      fires:         (raw.f as SyncedFireZone[]      | undefined) ?? [],
      powerups:      (raw.u as SyncedPowerUp[]       | undefined) ?? [],
      nukes:         (raw.n as SyncedNukeStrike[]    | undefined) ?? [],
      meteors:       (raw.mt as SyncedMeteorStrike[] | undefined) ?? [],
      train:         (raw.t as SyncedTrainState      | undefined) ?? null,
    };
    this.cachedGameState = state;
    this.gameStateVersion++;
    return state;
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

  sendLoadoutUse(
    slot: LoadoutSlot,
    angle: number,
    targetX: number,
    targetY: number,
    shotId?: number,
    params?: LoadoutUseParams,
    clientX?: number,
    clientY?: number,
  ): void {
    if (isHost()) {
      this.loadoutUseHandler?.(slot, angle, targetX, targetY, myPlayer().id, shotId, params, clientX, clientY);
      return;
    }
    this.sendHostRpc('lu', { slot, angle, tx: targetX, ty: targetY, sid: shotId, prm: params, px: clientX, py: clientY });
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
    ) => void,
  ): void {
    this.loadoutUseHandler = handler;
    this.registerHostRpcHandler('lu', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return undefined;
      const loadoutUseHandler = this.loadoutUseHandler;
      if (!loadoutUseHandler) return undefined;
      const { slot, angle, tx, ty, sid, prm, px, py } = data as {
        slot: LoadoutSlot;
        angle: number;
        tx: number;
        ty: number;
        sid?: number;
        prm?: LoadoutUseParams;
        px?: number;
        py?: number;
      };
      loadoutUseHandler(slot, angle, tx, ty, caller.id, sid, prm, px, py);
      return undefined;
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

  // ── Explosions-Effekt-RPC: Host → Alle ────────────────────────────────────

  broadcastExplosionEffect(x: number, y: number, radius: number, color?: number, isHoly?: boolean): void {
    this.broadcastRpc('xfx', { x, y, r: radius, c: color, h: isHoly || undefined });
  }

  registerExplosionEffectHandler(handler: (x: number, y: number, radius: number, color?: number, isHoly?: boolean) => void): void {
    this.explosionEffectHandler = handler;
    this.registerAllRpcHandler('xfx', async (data: unknown): Promise<unknown> => {
      const explosionEffectHandler = this.explosionEffectHandler;
      if (!explosionEffectHandler) return undefined;
      const { x, y, r, c, h } = data as { x: number; y: number; r: number; c?: number; h?: boolean };
      explosionEffectHandler(x, y, r, c, h);
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
  broadcastEffect(type: 'hit' | 'death', x: number, y: number, shooterId?: string): void {
    this.broadcastRpc('fx', { type, x, y, shooterId });
  }

  registerEffectHandler(cb: (type: 'hit' | 'death', x: number, y: number, shooterId?: string) => void): void {
    this.effectHandler = cb;
    this.registerAllRpcHandler('fx', async (data: unknown): Promise<unknown> => {
      const effectHandler = this.effectHandler;
      if (!effectHandler) return undefined;
      const { type, x, y, shooterId } = data as { type: 'hit' | 'death'; x: number; y: number; shooterId?: string };
      effectHandler(type, x, y, shooterId);
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
    shooterId?: string,
    shotId?: number,
  ): void {
    this.broadcastRpc('htfx', { sx: startX, sy: startY, ex: endX, ey: endY, c: color, t: thickness, id: shooterId, sid: shotId });
  }

  registerHitscanTracerHandler(handler: HitscanTracerHandler): void {
    this.hitscanTracerHandler = handler;
    this.registerAllRpcHandler('htfx', async (data: unknown): Promise<unknown> => {
      const hitscanTracerHandler = this.hitscanTracerHandler;
      if (!hitscanTracerHandler) return undefined;
      const { sx, sy, ex, ey, c, t, id, sid } = data as {
        sx: number;
        sy: number;
        ex: number;
        ey: number;
        c: number;
        t: number;
        id?: string;
        sid?: number;
      };
      hitscanTracerHandler(sx, sy, ex, ey, c, t, id, sid);
      return undefined;
    });
  }

  // ── Melee-Swing-RPC: Host → Alle ──────────────────────────────────────────

  broadcastMeleeSwing(swing: SyncedMeleeSwing): void {
    this.broadcastRpc('msfx', {
      sid: swing.swingId, x: swing.x, y: swing.y,
      a: swing.angle, ad: swing.arcDegrees, r: swing.range,
      c: swing.color, id: swing.shooterId,
    });
  }

  registerMeleeSwingHandler(handler: (swing: SyncedMeleeSwing) => void): void {
    this.meleeSwingHandler = handler;
    this.registerAllRpcHandler('msfx', async (data: unknown): Promise<unknown> => {
      const meleeSwingHandler = this.meleeSwingHandler;
      if (!meleeSwingHandler) return undefined;
      const { sid, x, y, a, ad, r, c, id } = data as {
        sid: number; x: number; y: number;
        a: number; ad: number; r: number;
        c: number; id: string;
      };
      meleeSwingHandler({ swingId: sid, x, y, angle: a, arcDegrees: ad, range: r, color: c, shooterId: id });
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

  broadcastBfgLaserBatch(lines: { sx: number; sy: number; ex: number; ey: number }[], color: number): void {
    if (lines.length === 0) return;
    this.broadcastRpc('bfl', { l: lines, c: color });
  }

  registerBfgLaserBatchHandler(handler: (lines: { sx: number; sy: number; ex: number; ey: number }[], color: number) => void): void {
    this.bfgLaserHandler = handler;
    this.registerAllRpcHandler('bfl', async (data: unknown): Promise<unknown> => {
      const cb = this.bfgLaserHandler;
      if (!cb) return undefined;
      const { l, c } = data as { l: { sx: number; sy: number; ex: number; ey: number }[]; c: number };
      cb(l, c);
      return undefined;
    });
  }

  // ── Burrow-Visualisierung: Host → Alle ────────────────────────────────────

  broadcastBurrowVisual(playerId: string, isBurrowed: boolean): void {
    this.broadcastRpc('bfx', { id: playerId, b: isBurrowed });
  }

  registerBurrowVisualHandler(cb: (playerId: string, isBurrowed: boolean) => void): void {
    this.burrowVisualHandler = cb;
    this.registerAllRpcHandler('bfx', async (data: unknown): Promise<unknown> => {
      const burrowVisualHandler = this.burrowVisualHandler;
      if (!burrowVisualHandler) return undefined;
      const { id, b } = data as { id: string; b: boolean };
      burrowVisualHandler(id, b);
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

  /** Liest die benutzerdefinierte Farbe eines Spielers (undefined = noch keine). */
  getPlayerColor(playerId: string): number | undefined {
    return this.playerStateMap.get(playerId)?.getState(KEY_PLAYER_COLOR) as number | undefined;
  }

  /**
   * Host-only: Weist einem Spieler automatisch eine zufällige verfügbare Farbe zu
   * und aktualisiert den Farbpool. Kein-Op wenn Spieler bereits eine Farbe hat.
   */
  hostAssignColor(playerId: string): void {
    if (!isHost()) return;
    if (this.getPlayerColor(playerId) !== undefined) return;
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
    const color = this.getPlayerColor(playerId);
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
  publishActiveBuffs(playerId: string, buffs: { defId: string; remainingFrac: number }[]): void {
    if (!isHost()) return;
    const ps = this.playerStateMap.get(playerId);
    if (!ps) return;
    ps.setState(KEY_ACTIVE_BUFFS, buffs, true);
  }

  /** Liest die aktiven Buffs eines Spielers für die HUD-Anzeige. */
  getPlayerActiveBuffs(playerId: string): { defId: string; remainingFrac: number }[] {
    return (this.playerStateMap.get(playerId)?.getState(KEY_ACTIVE_BUFFS) as { defId: string; remainingFrac: number }[] | undefined) ?? [];
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

  // ── Ping-Messung: Client → Host → Alle ────────────────────────────────────

  /** Liest den gemessenen Roundtrip-Ping eines Spielers in ms (Standard: 0 für Host). */
  getPlayerPing(playerId: string): number {
    return (this.playerStateMap.get(playerId)?.getState(KEY_PING) as number | undefined) ?? 0;
  }

  /**
   * Client-only: Sendet einen Ping-Request an den Host.
   * Für den Host kein-Op (bleibt bei Default-Ping 0 ms).
   */
  sendPingToHost(): void {
    if (isHost()) return;
    this.sendHostRpc('png', { ts: Date.now(), id: myPlayer().id });
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
    this.registerHostRpcHandler('png', async (data: unknown): Promise<unknown> => {
      if (!isHost()) return undefined;
      const { ts, id } = data as { ts: number; id: string };
      this.broadcastRpc('pong', { ts, id, hostTs: Date.now() });
      return undefined;
    });
    this.registerAllRpcHandler('pong', async (data: unknown): Promise<unknown> => {
      const { ts, id, hostTs } = data as { ts: number; id: string; hostTs?: number };
      if (id !== myPlayer().id) return undefined;
      const now = Date.now();
      const rtt = now - ts;
      myPlayer().setState(KEY_PING, rtt);

      if (!isHost() && typeof hostTs === 'number') {
        const estimatedOffset = hostTs - (ts + rtt / 2);
        if (!Number.isFinite(this.bestClockSyncRttMs)) {
          this.bestClockSyncRttMs = rtt;
          this.hostClockOffsetMs = estimatedOffset;
          return undefined;
        }
        if (rtt <= this.bestClockSyncRttMs + 10) {
          this.bestClockSyncRttMs = Math.min(this.bestClockSyncRttMs, rtt);
          this.hostClockOffsetMs += (estimatedOffset - this.hostClockOffsetMs) * 0.35;
        }
      }

      return undefined;
    });
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
    this.ensureRpcDispatchersRegistered();
    RPC.call(HOST_RPC_CHANNEL, { type, payload }, RPC.Mode.HOST).catch(console.error);
  }

  private broadcastRpc(type: string, payload: unknown): void {
    this.ensureRpcDispatchersRegistered();
    RPC.call(ALL_RPC_CHANNEL, { type, payload }, RPC.Mode.ALL).catch(console.error);
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
      const color = this.getPlayerColor(id);
      if (color !== undefined) usedColors.add(color);
    }
    return this.knownPlayerColors.filter(color => !usedColors.has(color));
  }

  private reconcileColorPool(): void {
    if (!isHost()) return;
    if (this.knownPlayerColors.length === 0) return;
    this.setAvailableColors(this.computeAvailableColors());
  }

  // ── Interner Helfer: PlayerState → PlayerProfile ──────────────────────────
  private extractProfile(state: PlayerState): PlayerProfile {
    const profile    = state.getProfile();
    const stateName  = state.getState(KEY_NAME)         as string | undefined;
    const stateColor = state.getState(KEY_PLAYER_COLOR) as number | undefined;

    let colorHex: number;
    if (stateColor !== undefined) {
      colorHex = stateColor;
    } else {
      const rawHex = (profile.color as unknown as Record<string, unknown> | undefined)?.hex ?? '#ffffff';
      const parsed = parseInt(String(rawHex).replace('#', ''), 16);
      colorHex = isNaN(parsed) ? 0xffffff : parsed;
    }

    return {
      id:       state.id,
      name:     stateName || profile.name || 'Player',
      colorHex,
    };
  }
}
