import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { WeaponSlot, ConstructionId, LoadoutUseResult } from '../../types';
import { bridge } from '../../network/bridge';
import { quantizeAngle } from '../../utils/angle';
import { isDevScenarioMode } from '../../utils/devScenarioMode';
import { NavigationGeometry } from '../../systems/navigation/NavigationGeometry';
import { COOP_DEFENSE_ENEMY_CONFIGS, type CoopDefenseEnemyKind } from '../../config/coopDefenseEnemies';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../config/coopDefenseConstructions';
import { GAME_WIDTH, GAME_HEIGHT } from '../../config';
import { setCameraBaseScroll } from '../../graphics/cameraBaseScroll';
import { ScenarioClock } from './clock';
import { decodeScenario, defaultScenario, encodeScenario, parseScenario, scenarioLoadout, type DevScenario, type GridPoint } from './config';
import { createScenarioPanel } from './panel';

export class DevScenarioController {
  readonly clock: ScenarioClock;
  config = defaultScenario();
  state: 'idle' | 'waiting-lobby' | 'loading' | 'ready' | 'error' = 'idle';
  message = 'Szenario konfigurieren und starten.';
  lastAction: unknown = null;
  aim: GridPoint = { gridX: 10, gridY: 10 };
  zoom = 1;
  cameraAtTarget = false;
  private trigger: WeaponSlot | null = null;
  private inputStarted = false;
  private sequence = 0;
  private movement = { dx: 0, dy: 0, until: 0 };
  private heldUtility: { id: string; until: number } | null = null;
  private pinned = new Map<string, { x: number; y: number }>();
  private pendingConstructions: DevScenario['constructions'] = [];
  private nextBuildAt = 0;
  private startedAt = performance.now();
  private lobbyFrames = 0;
  private readyAt: number | null = null;
  private readonly panel: ReturnType<typeof createScenarioPanel>;
  private readonly refreshTimer: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(private scene: Phaser.Scene, private runtime: ArenaRuntime,
    private setInput: (angle: number, trigger: WeaponSlot | null) => void,
    private lobbyReady: () => boolean) {
    if (!isDevScenarioMode()) throw new Error('Dev entry required.');
    this.clock = new ScenarioClock(scene.game.loop);
    let imported: DevScenario | null = null;
    try { imported = decodeScenario(location.hash); } catch (error) { this.fail(error); }
    this.panel = createScenarioPanel(this);
    this.refreshTimer = setInterval(() => this.panel.refresh(), 300);
    if (imported) { this.config = imported; this.panel.sync(); this.start(imported); }
  }
  private requireReady(): void {
    if (this.state !== 'ready' || !bridge.isArenaStarted() || this.runtime.isMatchTerminated()) throw new Error('Szenario ist noch nicht bereit oder die Runde ist beendet.');
  }
  fail(error: unknown): void {
    this.message = error instanceof Error ? error.message : String(error);
    this.lastAction = { ok: false, error: this.message };
  }
  start(value: unknown): void {
    const config = parseScenario(value);
    this.stop();
    this.clock.paused = false; this.clock.speed = 1;
    this.config = config;
    this.saveLink();
    this.pinned.clear(); this.pendingConstructions = [];
    if (bridge.getGamePhase() !== 'LOBBY') this.runtime.hostDiscardRound();
    bridge.setLocalReady(false); this.runtime.setIsLocalReady(false);
    this.state = 'waiting-lobby'; this.lobbyFrames = 0;
    this.startedAt = performance.now(); this.readyAt = null;
    this.message = 'Warte auf Lobby und normalen Rundenstart …';
  }
  saveLink(): void { history.replaceState(null, '', encodeScenario(this.config)); }
  private world(point: GridPoint): { x: number; y: number } {
    const metrics = this.runtime.getWorldMetrics();
    if (!metrics || !Number.isFinite(point.gridX + point.gridY) || point.gridX < 0 || point.gridY < 0
      || point.gridX >= metrics.gridCols || point.gridY >= metrics.gridRows) throw new Error('Ziel liegt außerhalb der Map.');
    return { x: metrics.offsetX + point.gridX * 32 + 16, y: metrics.offsetY + point.gridY * 32 + 16 };
  }
  grid(point: { x: number; y: number }): GridPoint {
    const metrics = this.runtime.getWorldMetrics()!;
    return { gridX: Math.round(((point.x - metrics.offsetX - 16) / 32) * 100) / 100,
      gridY: Math.round(((point.y - metrics.offsetY - 16) / 32) * 100) / 100 };
  }
  private free(point: GridPoint, radius: number): { x: number; y: number } {
    const position = this.world(point), snapshot = this.runtime.navigationLabPort.getGeometry();
    if (!snapshot || !new NavigationGeometry(snapshot).isFree(position.x, position.y, radius)) throw new Error('Ziel ist blockiert. „Freie Zelle suchen“ verwenden oder andere Koordinaten wählen.');
    return position;
  }
  findFree(): GridPoint {
    this.requireReady();
    const target = this.world(this.aim);
    const positions = this.runtime.navigationLabPort.getFreePositions(24);
    let best: { x: number; y: number } | undefined, distance = Infinity;
    for (const position of positions) {
      const candidate = (position.x - target.x) ** 2 + (position.y - target.y) ** 2;
      if (candidate < distance) { best = position; distance = candidate; }
    }
    if (!best) throw new Error('Keine freie Zelle gefunden.');
    this.aim = this.grid(best); return this.aim;
  }
  teleport(point = this.aim, remember = true): void {
    this.requireReady(); const position = this.free(point, 16);
    this.stop(); this.runtime.navigationLabPort.placePlayer(position.x, position.y);
    if (remember) { this.config.player = { ...point }; this.saveLink(); }
    this.message = 'Spieler versetzt.';
  }
  spawn(kind: CoopDefenseEnemyKind, pinned: boolean, hp: number | null, point = this.aim, remember = true): void {
    this.requireReady();
    if (!COOP_DEFENSE_ENEMY_CONFIGS[kind] || (hp !== null && (!Number.isFinite(hp) || hp < 1 || hp > 10000000))) throw new Error('Gegner oder HP ungültig.');
    if (this.runtime.navigationLabPort.readEnemies().length >= 200) throw new Error('Maximal 200 Gegner im Dev-Szenario.');
    const position = this.free(point, COOP_DEFENSE_ENEMY_CONFIGS[kind].size / 2);
    const id = this.runtime.navigationLabPort.spawnEnemy(position.x, position.y, kind, false);
    if (!id) throw new Error('Gegner konnte nicht erzeugt werden.');
    if (hp !== null) this.runtime.devScenarioPort.setEnemyHp(id, hp);
    if (pinned) this.pinned.set(id, position);
    if (remember) { this.config.enemies.push({ ...point, kind, pinned, hp }); this.saveLink(); }
    this.lastAction = { ok: true, enemyId: id, position };
  }
  clearEnemies(): void {
    this.requireReady(); this.runtime.navigationLabPort.removeEnemies(); this.pinned.clear();
    this.config.enemies = []; this.saveLink();
  }
  build(id: ConstructionId, point = this.aim, remember = true): LoadoutUseResult {
    this.requireReady(); const position = this.world(point);
    const result = this.runtime.rpcPorts.construction.placeInspectorConstruction(bridge.getLocalPlayerId(), id, position.x, position.y, bridge.getSynchronizedNow());
    this.lastAction = result;
    if (!result.ok) throw new Error(`Bauen abgelehnt: ${result.reason}. Freischaltung, Werkzeug-Slot, Reichweite, Baufläche und Kapazität beachten.`);
    if (remember) { this.config.constructions.push({ ...point, id }); this.saveLink(); }
    return result;
  }
  move(dx: number, dy: number, duration: number): void {
    this.requireReady();
    if (![dx, dy, duration].every(Number.isFinite) || duration < 0 || duration > 10000) throw new Error('Bewegung: 0…10000 ms.');
    const length = Math.max(1, Math.hypot(dx, dy));
    this.movement = { dx: dx / length, dy: dy / length, until: this.clock.now + duration };
  }
  fire(slot: WeaponSlot, continuous: boolean): void {
    this.requireReady();
    if (continuous) { this.trigger = slot; this.inputStarted = true; }
    else this.attack(slot, true);
  }
  private attack(slot: WeaponSlot, started: boolean): void {
    const target = this.world(this.aim), player = this.runtime.navigationLabPort.getPlayerPosition();
    if (!player) return;
    this.lastAction = this.runtime.weaponBalanceLabPort.useWeaponAction(slot, bridge.getLocalPlayerId(),
      Math.atan2(target.y - player.y, target.x - player.x), target.x, target.y, bridge.getSynchronizedNow(), ++this.sequence, started);
  }
  utility(): void {
    this.requireReady();
    const config = this.runtime.rpcPorts.playerLoadout.getEquippedUtilityConfig(bridge.getLocalPlayerId());
    if (!config) throw new Error('Kein Utility ausgerüstet. Das erste Utility im Werkzeug-Loadout wird verwendet.');
    if (['charged_throw', 'charged_gate', 'charged_alternate'].includes(config.activation.type)) {
      const activation = config.activation;
      if (activation.type !== 'charged_throw' && activation.type !== 'charged_gate' && activation.type !== 'charged_alternate') return;
      const id = `dev:${++this.sequence}`;
      if (!this.runtime.rpcPorts.playerLoadout.startUtilityHeldAction(bridge.getLocalPlayerId(), id, activation.type, bridge.getSynchronizedNow())) throw new Error('Utility-Aufladung abgelehnt.');
      this.heldUtility = { id, until: this.clock.now + activation.fullChargeDuration };
      this.message = 'Utility lädt; bei Pause Zeitschritte ausführen.';
    } else this.releaseUtility();
  }
  private releaseUtility(): void {
    const target = this.world(this.aim), player = this.runtime.navigationLabPort.getPlayerPosition()!;
    this.lastAction = this.runtime.rpcPorts.playerLoadout.usePlayerAction({ category: 'utility', playerId: bridge.getLocalPlayerId(),
      angle: Math.atan2(target.y - player.y, target.x - player.x), targetX: target.x, targetY: target.y,
      hostNowMs: bridge.getSynchronizedNow(), source: { kind: 'equipped' }, params: { heldActionId: this.heldUtility?.id } });
    this.heldUtility = null;
  }
  ultimate(action: 'press' | 'release' = 'press'): void {
    this.requireReady(); const target = this.world(this.aim), player = this.runtime.navigationLabPort.getPlayerPosition()!;
    if (action === 'press') this.runtime.prepareScenarioRage();
    this.lastAction = this.runtime.rpcPorts.playerLoadout.usePlayerAction({ category: 'ultimate', playerId: bridge.getLocalPlayerId(),
      angle: Math.atan2(target.y - player.y, target.x - player.x), targetX: target.x, targetY: target.y,
      hostNowMs: bridge.getSynchronizedNow(), params: { ultimateAction: action } });
  }
  stop(): void {
    this.trigger = null; this.heldUtility = null; this.movement = { dx: 0, dy: 0, until: 0 };
    this.setInput(0, null);
    bridge.sendLocalInput({ dx: 0, dy: 0, aim: 0, dashHeld: false });
    this.runtime.rpcPorts.heldAction.clearPlayer(bridge.getLocalPlayerId());
    this.runtime.stopScenarioUltimate();
  }
  pause(): void { this.requireReady(); this.clock.paused = true; }
  resume(): void { this.clock.paused = false; }
  step(frames = 1): void { this.requireReady(); this.clock.step(frames); }
  update(): void {
    if (this.disposed) return;
    try {
      if ((this.state === 'waiting-lobby' || this.state === 'loading') && performance.now() - this.startedAt > 180000) throw new Error('Start überschreitet 180 s; Ladezustand im Bericht prüfen.');
      if (this.state === 'waiting-lobby' && bridge.getGamePhase() === 'LOBBY' && this.lobbyReady() && ++this.lobbyFrames >= 2) {
        bridge.setGameMode('coop_defense'); bridge.setCoopDefenseMapId(this.config.mapId);
        this.runtime.navigationLabPort.setNextRoundSeed(this.config.seed);
        bridge.setLocalReadyWithCommittedLoadout(scenarioLoadout(this.config)); this.runtime.setIsLocalReady(true);
        this.state = 'loading'; this.message = 'Map lädt, Szenario wartet auf die Ready-Barriere …';
      }
      if (this.state === 'loading') {
        this.runtime.devScenarioPort.suppressEncounters(true);
        if (!this.runtime.navigationLabPort.isReady() || !bridge.isArenaStarted()) return;
        this.state = 'ready'; this.readyAt = performance.now();
        if (this.config.player) this.teleport(this.config.player, false);
        const player = this.runtime.navigationLabPort.getPlayerPosition();
        if (player) this.aim = this.grid({ x: player.x + 128, y: player.y });
        this.pendingConstructions = [...this.config.constructions]; this.nextBuildAt = 0;
        if (!this.pendingConstructions.length) this.spawnConfiguredEnemies();
        this.message = 'Szenario bereit. Alle Eingaben verwenden normale Gameplay-Aktionen.';
        this.panel.syncTarget();
      }
      if (this.state !== 'ready') return;
      if (this.runtime.isMatchTerminated() || bridge.getGamePhase() !== 'ARENA') {
        this.stop(); this.state = 'idle'; this.message = 'Runde beendet. Szenario erneut starten.'; return;
      }
      const now = this.clock.now, id = bridge.getLocalPlayerId();
      this.runtime.devScenarioPort.suppressEncounters(this.config.suppressWaves || this.pendingConstructions.length > 0);
      this.runtime.setTimeOfDayDebugOverride(this.config.timeOfDay);
      if (this.config.refillAdrenaline) this.runtime.weaponBalanceLabPort.setAdrenaline(id, this.runtime.weaponBalanceLabPort.getMaxAdrenaline(id));
      if (this.config.refillHp) { const combat = this.runtime.getWorldCombatCore(); combat?.heal(id, combat.getMaxHp(id)); }
      for (const [enemyId, position] of this.pinned) this.runtime.weaponBalanceLabPort.pinTarget(enemyId, position.x, position.y);
      if (this.pendingConstructions.length && now >= this.nextBuildAt) {
        const construction = this.pendingConstructions[0];
        const previous = this.runtime.navigationLabPort.getPlayerPosition();
        if (!previous) throw new Error('Spieler fehlt beim Szenario-Aufbau.');
        // Place through the real action from a valid nearby builder position, then restore the
        // requested observer position. This also rebuilds fixtures spread across several islands.
        const destination = this.world(construction);
        const range = COOP_DEFENSE_CONSTRUCTIONS[construction.id].placementRange;
        const candidate = this.runtime.navigationLabPort.getFreePositions(16).find(position => {
          const distance = Math.hypot(position.x - destination.x, position.y - destination.y);
          return distance >= 64 && distance <= range * 0.8;
        });
        if (!candidate) throw new Error(`Keine Bauposition für ${construction.id} gefunden.`);
        this.runtime.navigationLabPort.placePlayer(candidate.x, candidate.y);
        try { this.build(construction.id, construction, false); }
        finally { this.runtime.navigationLabPort.placePlayer(previous.x, previous.y); }
        this.pendingConstructions.shift();
        this.nextBuildAt = now + COOP_DEFENSE_CONSTRUCTIONS[construction.id].buildCooldownMs + 100;
        if (!this.pendingConstructions.length) this.spawnConfiguredEnemies();
      }
      const target = this.world(this.aim), player = this.runtime.navigationLabPort.getPlayerPosition();
      const angle = player ? Math.atan2(target.y - player.y, target.x - player.x) : 0;
      const moving = now < this.movement.until;
      this.setInput(angle, this.trigger);
      bridge.sendLocalInput({ dx: moving ? this.movement.dx : 0, dy: moving ? this.movement.dy : 0, aim: quantizeAngle(angle), dashHeld: false });
      if (this.trigger) { this.attack(this.trigger, this.inputStarted); this.inputStarted = false; }
      if (this.heldUtility && now >= this.heldUtility.until) this.releaseUtility();
    } catch (error) { this.fail(error); this.stop(); this.state = 'error'; }
  }
  private spawnConfiguredEnemies(): void {
    for (const enemy of this.config.enemies) this.spawn(enemy.kind, enemy.pinned, enemy.hp, enemy, false);
  }
  syncCamera(): void {
    if (this.state !== 'ready') return;
    let point: { x: number; y: number } | null;
    try { point = this.cameraAtTarget ? this.world(this.aim) : this.runtime.navigationLabPort.getPlayerPosition(); }
    catch (error) { this.cameraAtTarget = false; this.fail(error); return; }
    if (!point) return;
    const camera = this.scene.cameras.main;
    camera.removeBounds();
    camera.setZoom(this.scene.scale.width / GAME_WIDTH * this.zoom, this.scene.scale.height / GAME_HEIGHT * this.zoom);
    camera.setScroll(point.x - GAME_WIDTH / this.zoom / 2, point.y - GAME_HEIGHT / this.zoom / 2);
    setCameraBaseScroll(this.scene, camera.scrollX, camera.scrollY);
  }
  snapshot(): Record<string, unknown> {
    return { state: this.state, message: this.message, isolated: true, network: 'local-only',
      readyAfterMs: this.readyAt === null ? null : Math.round(this.readyAt - this.startedAt),
      elapsedWallMs: Math.round(performance.now() - this.startedAt), simulationMs: this.clock.now,
      paused: this.clock.paused, speed: this.clock.speed, trigger: this.trigger, moving: this.movement,
      pendingSetupConstructions: this.pendingConstructions.length,
      rendererSize: { width: this.scene.game.canvas.width, height: this.scene.game.canvas.height },
      camera: { zoom: this.zoom, focusTarget: this.cameraAtTarget, scrollX: this.scene.cameras.main.scrollX,
        scrollY: this.scene.cameras.main.scrollY, zoomX: this.scene.cameras.main.zoomX, zoomY: this.scene.cameras.main.zoomY },
      config: this.config, committedLoadout: bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId()),
      phase: bridge.getGamePhase(), world: this.runtime.getWorldDescriptor(), metrics: this.runtime.getWorldMetrics(),
      loading: this.runtime.getScenarioLoadingState(), player: this.runtime.navigationLabPort.getPlayerPosition(),
      aim: this.aim, enemies: this.runtime.navigationLabPort.readEnemies(), effects: this.runtime.getScenarioObservation(), lastAction: this.lastAction };
  }
  capture(callback: (url: string) => void): void {
    this.requireReady();
    this.scene.game.renderer.snapshot(image => {
      if (image instanceof HTMLImageElement) callback(image.src);
      else this.fail(new Error('Renderer lieferte kein PNG.'));
    }, 'image/png');
    if (this.clock.paused) this.clock.step();
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true; this.stop(); clearInterval(this.refreshTimer);
    this.panel.destroy(); this.clock.destroy();
  }
}
