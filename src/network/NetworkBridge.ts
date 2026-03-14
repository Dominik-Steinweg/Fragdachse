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
import type { PlayerInput, PlayerProfile, PlayerNetState, SyncedProjectile, GamePhase, ArenaLayout, RockNetState, LoadoutSlot } from '../types';
import { MAX_PLAYERS } from '../config';

// ── Interne State-Keys – nie nach außen exportiert ───────────────────────────
const KEY_INPUT       = 'inp';
const KEY_PLAYERS     = 'plr';
const KEY_PROJECTILES = 'prj';
const KEY_READY       = 'isr';   // per-player boolean: isReady
const KEY_NAME        = 'pnm';   // per-player string: Anzeigename (überschreibt Playroom-Profil)
const KEY_GAME_PHASE  = 'gph';   // global: 'LOBBY' | 'ARENA'
const KEY_ROUND_END   = 'ret';   // global: number (timestamp ms)
const KEY_HOST_ID      = 'hid';   // global: string (Player-ID des Match-Hosts)
const KEY_ARENA_LAYOUT = 'aly';   // global: ArenaLayout (reliable, einmalig pro Runde)
const KEY_ROCK_HP      = 'rck';   // global: RockNetState[] (unreliable, Delta-Snapshot)

// ── Öffentliche Typen ─────────────────────────────────────────────────────────
export interface GameState {
  players:     Record<string, PlayerNetState>;
  projectiles: SyncedProjectile[];
  rocks:       RockNetState[];   // Delta: nur beschädigte Felsen (abwesend = voll HP)
}

export class NetworkBridge {
  private playerStateMap   = new Map<string, PlayerState>();
  private connectedPlayers = new Map<string, PlayerProfile>();

  private joinCbs: Array<(profile: PlayerProfile) => void> = [];
  private quitCbs: Array<(id: string) => void>             = [];

  private activated = false;

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
        this.playerStateMap.delete(state.id);
        this.connectedPlayers.delete(state.id);
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
    return Math.max(0, Math.ceil((this.getRoundEndTime() - Date.now()) / 1000));
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
  publishGameState(state: GameState): void {
    setState(KEY_PLAYERS,     state.players,     false);
    setState(KEY_PROJECTILES, state.projectiles, false);
    setState(KEY_ROCK_HP,         state.rocks,       false);
  }

  getLatestGameState(): GameState | undefined {
    const players     = getState(KEY_PLAYERS)     as Record<string, PlayerNetState> | undefined;
    const projectiles = getState(KEY_PROJECTILES) as SyncedProjectile[]             | undefined;
    const rocks       = getState(KEY_ROCK_HP)     as RockNetState[]                 | undefined;
    if (!players) return undefined;
    return { players, projectiles: projectiles ?? [], rocks: rocks ?? [] };
  }

  // ── Loadout-RPC: Client → Host ────────────────────────────────────────────

  sendLoadoutUse(slot: LoadoutSlot, angle: number, targetX: number, targetY: number): void {
    RPC.call('lu', { slot, angle, tx: targetX, ty: targetY }, RPC.Mode.HOST).catch(console.error);
  }

  registerLoadoutUseHandler(
    handler: (slot: LoadoutSlot, angle: number, targetX: number, targetY: number, senderId: string) => void,
  ): void {
    RPC.register('lu', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return undefined;
      const { slot, angle, tx, ty } = data as { slot: LoadoutSlot; angle: number; tx: number; ty: number };
      handler(slot, angle, tx, ty, caller.id);
      return undefined;
    });
  }

  // ── Explosions-Effekt-RPC: Host → Alle ────────────────────────────────────

  broadcastExplosionEffect(x: number, y: number, radius: number): void {
    RPC.call('xfx', { x, y, r: radius }, RPC.Mode.ALL).catch(console.error);
  }

  registerExplosionEffectHandler(handler: (x: number, y: number, radius: number) => void): void {
    RPC.register('xfx', async (data: unknown): Promise<unknown> => {
      const { x, y, r } = data as { x: number; y: number; r: number };
      handler(x, y, r);
      return undefined;
    });
  }

  // ── Effekt-RPC: Host → Alle (visuelles Feedback) ──────────────────────────
  broadcastEffect(type: 'hit' | 'death', x: number, y: number): void {
    RPC.call('fx', { type, x, y }, RPC.Mode.ALL).catch(console.error);
  }

  registerEffectHandler(cb: (type: 'hit' | 'death', x: number, y: number) => void): void {
    RPC.register('fx', async (data: unknown): Promise<unknown> => {
      const { type, x, y } = data as { type: 'hit' | 'death'; x: number; y: number };
      cb(type, x, y);
      return undefined;
    });
  }

  // ── Dash-RPC: Client → Host ───────────────────────────────────────────────

  sendDash(dx: number, dy: number): void {
    RPC.call('dash', { dx, dy }, RPC.Mode.HOST).catch(console.error);
  }

  registerDashHandler(cb: (playerId: string, dx: number, dy: number) => void): void {
    RPC.register('dash', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return;
      const { dx, dy } = data as { dx: number; dy: number };
      cb(caller.id, dx, dy);
      return undefined;
    });
  }

  // ── Burrow-RPC: Client → Host ─────────────────────────────────────────────

  sendBurrowRequest(wantsBurrowed: boolean): void {
    RPC.call('burrow', { want: wantsBurrowed }, RPC.Mode.HOST).catch(console.error);
  }

  registerBurrowHandler(cb: (playerId: string, wantsBurrowed: boolean) => void): void {
    RPC.register('burrow', async (data: unknown, caller: PlayerState): Promise<unknown> => {
      if (!isHost()) return;
      const { want } = data as { want: boolean };
      cb(caller.id, want);
      return undefined;
    });
  }

  // ── Schockwellen-Effekt: Host → Alle ─────────────────────────────────────

  broadcastShockwaveEffect(x: number, y: number): void {
    RPC.call('shockfx', { x, y }, RPC.Mode.ALL).catch(console.error);
  }

  registerShockwaveEffectHandler(cb: (x: number, y: number) => void): void {
    RPC.register('shockfx', async (data: unknown): Promise<unknown> => {
      const { x, y } = data as { x: number; y: number };
      cb(x, y);
      return undefined;
    });
  }

  // ── Burrow-Visualisierung: Host → Alle ────────────────────────────────────

  broadcastBurrowVisual(playerId: string, isBurrowed: boolean): void {
    RPC.call('bfx', { id: playerId, b: isBurrowed }, RPC.Mode.ALL).catch(console.error);
  }

  registerBurrowVisualHandler(cb: (playerId: string, isBurrowed: boolean) => void): void {
    RPC.register('bfx', async (data: unknown): Promise<unknown> => {
      const { id, b } = data as { id: string; b: boolean };
      cb(id, b);
      return undefined;
    });
  }

  // ── Interner Helfer: PlayerState → PlayerProfile ──────────────────────────
  private extractProfile(state: PlayerState): PlayerProfile {
    const profile   = state.getProfile();
    const rawHex    = (profile.color as unknown as Record<string, unknown> | undefined)?.hex ?? '#ffffff';
    const colorNum  = parseInt(String(rawHex).replace('#', ''), 16);
    // KEY_NAME hat Vorrang vor dem Playroom-Profil-Namen (Late-Joiner-Fix)
    const stateName = state.getState(KEY_NAME) as string | undefined;
    return {
      id:       state.id,
      name:     stateName || profile.name || 'Player',
      colorHex: isNaN(colorNum) ? 0xffffff : colorNum,
    };
  }
}
