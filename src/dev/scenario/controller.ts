import { loadingTimeline } from '../../diagnostics/LoadingTimeline';
import { WorldLightingMeasurement } from './WorldLightingMeasurement';
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
import { installScenarioApi } from './api';
import { ScenarioBots } from './bots';
import { SUN_TUNING_DEFAULTS, validateSunTuning } from '../../effects/sunlight/SunTuning';

export class DevScenarioController {
  readonly clock: ScenarioClock;
  readonly bots: ScenarioBots;
  config = defaultScenario();
  state: 'idle' | 'waiting-lobby' | 'loading' | 'ready' | 'error' = 'idle';
  message = 'Szenario konfigurieren und starten.';
  lastAction: unknown = null;
  aim: GridPoint = { gridX: 10, gridY: 10 };
  zoom = 1;
  cameraAtTarget = false;
  private worldLighting: WorldLightingMeasurement | null = null;
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
  private setupPending = false;
  private initialPosition: { requested: GridPoint | null; applied: { x: number; y: number } | null; verified: boolean } = { requested: null, applied: null, verified: false };
  private readonly api: ReturnType<typeof installScenarioApi>;
  private captureCancel: (() => void) | null = null;
  private captureRevision = 0;
  private readonly onHashChange = () => {
    try {
      const config = decodeScenario(location.hash);
      if (!config) throw new Error('URL enthält kein Szenario-Rezept.');
      this.start(config); this.panel.sync();
    } catch (error) { this.fail(error); }
  };
  private readonly panel: ReturnType<typeof createScenarioPanel>;
  private readonly refreshTimer: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(private scene: Phaser.Scene, private runtime: ArenaRuntime,
    private setInput: (angle: number, trigger: WeaponSlot | null) => void,
    private lobbyReady: () => boolean) {
    if (!isDevScenarioMode()) throw new Error('Dev entry required.');
    this.clock = new ScenarioClock(scene.game.loop);
    this.bots = new ScenarioBots(runtime, () => this.clock.now);
    let imported: DevScenario | null = null;
    try { imported = decodeScenario(location.hash); } catch (error) { this.fail(error); }
    this.panel = createScenarioPanel(this);
    this.api = installScenarioApi(this);
    window.addEventListener('hashchange', this.onHashChange);
    this.refreshTimer = setInterval(() => this.panel.refresh(), 300);
    if (imported) { this.config = imported; this.panel.sync(); this.start(imported); }
  }
  requireReadyForBots(): void { this.requireReady(); }
  hidesAim(): boolean { return this.state === 'ready' && this.config.hideAim; }
  private requireReady(): void {
    if (this.state !== 'ready' || !bridge.isArenaStarted() || this.runtime.isMatchTerminated()) throw new Error('Szenario ist noch nicht bereit oder die Runde ist beendet.');
  }
  fail(error: unknown): void {
    loadingTimeline.get('scenario')?.finish('failed');
    this.message = error instanceof Error ? error.message : String(error);
    this.lastAction = { ok: false, error: this.message };
  }
  start(value: unknown): void {
    const config = parseScenario(value);
    const run = loadingTimeline.begin('scenario', String(performance.now()));
    run.gate('lobby', false); run.gate('scenario-setup', false);
    this.worldLighting?.reset();
    this.stop();
    this.captureCancel?.();
    this.captureRevision++;
    this.clock.paused = false; this.clock.speed = 1;
    this.config = config;
    this.saveLink();
    this.pinned.clear(); this.pendingConstructions = [];
    if (bridge.getGamePhase() !== 'LOBBY') this.runtime.hostDiscardRound();
    bridge.setLocalReady(false); this.runtime.setIsLocalReady(false);
    this.state = 'waiting-lobby'; this.lobbyFrames = 0;
    this.startedAt = performance.now(); this.readyAt = null;
    this.setupPending = false;
    this.initialPosition = { requested: config.player, applied: null, verified: false };
    this.message = 'Warte auf Lobby und normalen Rundenstart …';
  }
  saveLink(): void { history.replaceState(null, '', encodeScenario(this.config)); }
  setSunTuning(values: unknown, reset = false): void {
    this.requireReady();
    const patch = reset ? undefined : validateSunTuning(values);
    this.worldLighting ??= new WorldLightingMeasurement(this.scene, () => this.runtime.getScenarioLightingTargets());
    this.worldLighting.update(this.config.timeOfDay,this.clock.now);
    this.worldLighting.tuneSun(patch,reset);
    if (this.clock.paused) this.step();
  }
  measureWorldLighting(mode: 'stationary' | 'destruction' | 'traverse' | 'walk' = 'stationary'): void {
    this.requireReady(); if (this.clock.paused) this.resume();
    this.stop();
    this.worldLighting ??= new WorldLightingMeasurement(this.scene, () => this.runtime.getScenarioLightingTargets());
    this.worldLighting.update(this.config.timeOfDay,this.clock.now);
    if(mode==='stationary'){this.worldLighting.measure();return;}
    const savedAim={...this.aim},savedFocus=this.cameraAtTarget;
    const restore=()=>{this.aim=savedAim;this.cameraAtTarget=savedFocus;this.syncCamera();};
    const pending=()=>{const loading=this.runtime.getScenarioLoadingState();return (loading.ground?.pendingWork??0)>0||(loading.overlay?.pendingWork??0)>0;};
    if(mode==='destruction') {
      const rock=this.runtime.devScenarioPort.findDestructibleRock(this.aim.gridX,this.aim.gridY);
      if(!rock)throw new Error('Kein zerstörbarer Fels innerhalb von 8 Zellen um das Ziel.');
      this.aim={gridX:rock.gridX,gridY:rock.gridY};this.cameraAtTarget=true;this.syncCamera();
      this.worldLighting.measure({mode,durationMs:5000,restore,pending,advance:()=>{},start:()=>{
        if(!this.runtime.devScenarioPort.destroyRock(rock.id))throw new Error('Der ausgewählte Fels wurde nicht autoritativ zerstört.');
        return {rockId:rock.id,gridX:rock.gridX,gridY:rock.gridY,authoritative:true};
      }});
    } else {
      const metrics=this.runtime.getWorldMetrics();if(!metrics)throw new Error('Keine aktive World.');
      const from={gridX:4,gridY:Math.max(4,Math.floor(metrics.gridRows*.3))};
      const to=mode==='walk'?{gridX:Math.min(metrics.gridCols-5,from.gridX+72),gridY:from.gridY}
        :{gridX:metrics.gridCols-5,gridY:Math.min(metrics.gridRows-5,Math.floor(metrics.gridRows*.7))};
      const durationMs=mode==='walk'?30000:12000,half=durationMs/2;
      const speedWorldPxPerSecond=Math.hypot(to.gridX-from.gridX,to.gridY-from.gridY)*32/(half/1000);
      if(to.gridX-from.gridX<32)throw new Error('Die Kameraroute benötigt mindestens drei Fels-Chunks in der Breite.');
      this.aim=from;this.cameraAtTarget=true;this.syncCamera();
      this.worldLighting.measure({mode,durationMs,restore,pending,start:()=>({route:[from,to,from],durationMs,speedWorldPxPerSecond,
        cameraOnly:true,coordinateSpace:'grid'}),
        advance:elapsed=>{
          const t=elapsed<=half?elapsed/half:(durationMs-elapsed)/half;
          this.aim={gridX:from.gridX+(to.gridX-from.gridX)*t,gridY:from.gridY+(to.gridY-from.gridY)*t};this.syncCamera();
        }});
    }
  }
  worldLightingMeasurement() { return this.worldLighting?.measurement ?? null; }
  worldLightingStatus() { return this.runtime.getScenarioLightingTargets().rocks?.getFormationDiagnostics() ?? null; }
  focusLightingTree(): void {
    this.requireReady();
    const player = this.runtime.navigationLabPort.getPlayerPosition();
    if (!player) return;
    const trees = this.runtime.getScenarioLightingTargets().canopies;
    const nearest = trees.reduce<typeof trees[number] | null>((best, tree) => !best
      || Math.hypot(tree.worldX - player.x, tree.worldY - player.y) < Math.hypot(best.worldX - player.x, best.worldY - player.y) ? tree : best, null);
    if (!nearest) throw new Error('Diese Map hat keine Baumkrone.');
    this.aim = this.grid({ x: nearest.worldX, y: nearest.worldY }); this.cameraAtTarget = true;
    if (this.clock.paused) this.step();
  }
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
    // A position change cancels walking, but must not release a held weapon/utility/ultimate.
    this.movement = { dx: 0, dy: 0, until: 0 };
    bridge.sendLocalInput({ dx: 0, dy: 0, aim: 0, dashHeld: false });
    this.runtime.navigationLabPort.placePlayer(position.x, position.y);
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
  /** Same host request as the burrow key; adrenaline, cooldown and exit rules stay authoritative. */
  burrow(enter: boolean): void {
    this.requireReady();
    this.runtime.rpcPorts.playerLoadout.handleBurrowRequest(bridge.getLocalPlayerId(), enter);
    this.lastAction = { ok: true, burrow: enter ? 'enter' : 'exit' };
  }
  ultimate(action: 'press' | 'release' = 'press'): void {
    this.requireReady(); const target = this.world(this.aim), player = this.runtime.navigationLabPort.getPlayerPosition()!;
    if (action === 'press') this.runtime.prepareScenarioRage();
    this.lastAction = this.runtime.rpcPorts.playerLoadout.usePlayerAction({ category: 'ultimate', playerId: bridge.getLocalPlayerId(),
      angle: Math.atan2(target.y - player.y, target.x - player.x), targetX: target.x, targetY: target.y,
      hostNowMs: bridge.getSynchronizedNow(), params: { ultimateAction: action } });
  }
  stop(): void {
    this.worldLighting?.stopMeasurement();
    this.trigger = null; this.heldUtility = null; this.movement = { dx: 0, dy: 0, until: 0 };
    this.setInput(0, null);
    bridge.sendLocalInput({ dx: 0, dy: 0, aim: 0, dashHeld: false });
    this.runtime.rpcPorts.heldAction.clearPlayer(bridge.getLocalPlayerId());
    this.runtime.stopScenarioUltimate();
    this.bots.stop();
    this.localTemporary.held = null;
  }
  private readonly localTemporary: { id: string; held: { instanceId: string; heldId?: string; releaseAt: number } | null } = { id: '', held: null };
  /** Pickup-only utilities (NUKE, BFG, HOLY_HAND_GRENADE …) for the scenario player, aimed at the target. */
  temporaryUtility(utilityId: string, chargeMs?: number): void {
    this.requireReady();
    this.localTemporary.id = bridge.getLocalPlayerId();
    this.bots.useTemporaryUtility(this.localTemporary, utilityId, chargeMs);
  }
  /** Places a bot on a free grid cell. */
  placeBot(index: number, point: GridPoint): void {
    this.requireReady();
    const position = this.free(point, 16);
    this.bots.place(index, position.x, position.y);
  }
  private lastTrainUpdate = 0;
  private trainInvulnerable = false;
  startTrain(invulnerable = false): void {
    this.requireReady();
    this.trainInvulnerable = invulnerable;
    this.lastTrainUpdate = this.clock.now;
    if (!this.runtime.devScenarioPort.startTrain()) throw new Error('Diese Map hat keine Zugstrecke.');
  }
  aimBot(index: number, point: GridPoint | null): void { this.bots.aim(index, point ? this.world(point) : null); }
  pause(): void { this.requireReady(); this.worldLighting?.stopMeasurement(); this.clock.paused = true; }
  resume(): void { this.clock.paused = false; }
  step(frames = 1): void { this.requireReady(); this.clock.step(frames); }
  update(): void {
    if (this.disposed) return;
    try {
      if ((this.state === 'waiting-lobby' || this.state === 'loading') && performance.now() - this.startedAt > 180000) throw new Error('Start überschreitet 180 s; Ladezustand im Bericht prüfen.');
      if (this.state === 'waiting-lobby' && bridge.getGamePhase() === 'LOBBY' && this.lobbyReady() && ++this.lobbyFrames >= 2) {
        bridge.setGameMode('coop_defense'); bridge.setCoopDefenseMapId(this.config.mapId);
        this.runtime.navigationLabPort.setNextRoundSeed(this.config.seed);
        this.bots.prepare(this.config);
        bridge.setLocalReadyWithCommittedLoadout(scenarioLoadout(this.config)); this.runtime.setIsLocalReady(true);
        loadingTimeline.get('scenario')?.gate('lobby', true);
        this.state = 'loading'; this.message = 'Map lädt, Szenario wartet auf die Ready-Barriere …';
      }
      if (this.state === 'waiting-lobby' || this.state === 'loading') this.bots.acknowledgeWorld();
      if (this.state === 'loading') {
        this.runtime.devScenarioPort.suppressEncounters(true);
        this.runtime.devScenarioPort.setOptions(this.config.freezeMission, this.config.hideTutorial);
        const run = loadingTimeline.get('scenario');
        run?.gate('navigation-ready', this.runtime.navigationLabPort.isReady());
        run?.gate('arena-started', bridge.isArenaStarted());
        run?.gate('round-start-prepared', this.runtime.getScenarioLoadingState().roundStartPrepared);
        run?.gate('player-alive', this.runtime.navigationLabPort.getPlayerPosition()?.alive === true);
        if (!this.runtime.navigationLabPort.isReady() || !bridge.isArenaStarted()
          || !this.runtime.getScenarioLoadingState().roundStartPrepared
          || !this.runtime.navigationLabPort.getPlayerPosition()?.alive) return;
        this.state = 'ready'; this.setupPending = true;
        if (this.config.player) this.teleport(this.config.player, false);
        this.config.bots.forEach((bot, index) => { if (bot.player) this.placeBot(index, bot.player); });
        const player = this.runtime.navigationLabPort.getPlayerPosition();
        if (player) this.aim = this.grid({ x: player.x + 128, y: player.y });
        this.pendingConstructions = [...this.config.constructions]; this.nextBuildAt = 0;
        if (!this.pendingConstructions.length) this.spawnConfiguredEnemies();
        this.message = 'Szenario-Aufbau wird im Host-Frame geprüft …';
        this.panel.syncTarget();
      }
      if (this.state !== 'ready') return;
      if (this.runtime.isMatchTerminated() || bridge.getGamePhase() !== 'ARENA') {
        this.stop(); this.state = 'idle'; this.message = 'Runde beendet. Szenario erneut starten.'; return;
      }
      const now = this.clock.now, id = bridge.getLocalPlayerId();
      this.runtime.devScenarioPort.suppressEncounters(this.config.suppressWaves || this.pendingConstructions.length > 0);
      this.runtime.devScenarioPort.setOptions(this.config.freezeMission, this.config.hideTutorial);
      this.worldLighting?.update(this.config.timeOfDay,this.clock.now);
      this.runtime.setTimeOfDayDebugOverride(this.config.timeOfDay);
      bridge.setDevScenarioPlayerFreeForAll(this.config.playerFreeForAll);
      this.runtime.devScenarioPort.updateTrain(Math.max(0, now - this.lastTrainUpdate), this.trainInvulnerable); this.lastTrainUpdate = now;
      this.bots.update();
      this.bots.releaseDue(this.localTemporary, this.world(this.aim));
      if (this.config.refillAdrenaline) {
        for (const playerId of [id, ...this.bots.ids()]) this.runtime.weaponBalanceLabPort.setAdrenaline(playerId, this.runtime.weaponBalanceLabPort.getMaxAdrenaline(playerId));
      }
      if (this.config.refillHp) {
        const combat = this.runtime.getWorldCombatCore(); combat?.heal(id, combat.getMaxHp(id));
        for (const botId of this.bots.ids()) this.runtime.devScenarioPort.healPlayer(botId);
      }
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
  /** Final placement belongs after normal spawn/physics reconciliation, before camera/render. */
  afterHostFrame(): void {
    if (this.state !== 'ready') return;
    try {
      for (const [id, point] of this.pinned) this.runtime.weaponBalanceLabPort.pinTarget(id, point.x, point.y);
      if (this.setupPending && this.pendingConstructions.length === 0) {
        const requested = this.initialPosition.requested;
        if (requested) this.teleport(requested, false);
        const player = this.runtime.navigationLabPort.getPlayerPosition();
        if (!player?.alive) return;
        this.initialPosition.applied = { x: player.x, y: player.y };
        const expected = requested ? this.world(requested) : player;
        if (Math.hypot(player.x - expected.x, player.y - expected.y) > 0.01) throw new Error('Startposition konnte nicht übernommen werden.');
        this.initialPosition.verified = true; this.setupPending = false; this.readyAt = performance.now();
        loadingTimeline.get('scenario')?.gate('scenario-setup', true);
        loadingTimeline.get('scenario')?.finish();
        this.message = 'Szenario bereit. Startposition und Aufbau geprüft.';
      }
    } catch (error) { this.fail(error); this.stop(); this.state = 'error'; }
  }
  setPanelCollapsed(collapsed: boolean): void { this.panel.setCollapsed(collapsed); }
  syncPanel(): void { this.panel.sync(); }
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
    return { state: this.state, ready: this.state === 'ready' && !this.setupPending, message: this.message, isolated: true, network: 'local-only',
      initialPosition: this.initialPosition, mission: this.runtime.devScenarioPort.readMission(),
      bots: this.bots.ids().map((id, index) => ({ index, id, ...(this.state === 'ready' ? this.bots.position(index) : null) })),
      readyAfterMs: this.readyAt === null ? null : Math.round(this.readyAt - this.startedAt),
      elapsedWallMs: Math.round(performance.now() - this.startedAt), simulationMs: this.clock.now,
      paused: this.clock.paused, speed: this.clock.speed, trigger: this.trigger, moving: this.movement,
      pendingSetupConstructions: this.pendingConstructions.length,
      rendererSize: { width: this.scene.game.canvas.width, height: this.scene.game.canvas.height },
      sunTuning: { ...(this.worldLighting?.sunTuning ?? SUN_TUNING_DEFAULTS) },
      sun: this.worldLighting?.sunStatus ?? null,
      worldLightingMeasurement:this.worldLightingMeasurement(),
      camera: { zoom: this.zoom, focusTarget: this.cameraAtTarget, scrollX: this.scene.cameras.main.scrollX,
        scrollY: this.scene.cameras.main.scrollY, zoomX: this.scene.cameras.main.zoomX, zoomY: this.scene.cameras.main.zoomY },
      config: this.config, committedLoadout: bridge.getPlayerCommittedLoadout(bridge.getLocalPlayerId()),
      phase: bridge.getGamePhase(), world: this.runtime.getWorldDescriptor(), metrics: this.runtime.getWorldMetrics(),
      loading: this.runtime.getScenarioLoadingState(), player: this.runtime.navigationLabPort.getPlayerPosition(),
      aim: this.aim, enemies: this.runtime.navigationLabPort.readEnemies().map(enemy => ({ ...enemy,
        pinned: this.pinned.has(enemy.id), pinnedPosition: this.pinned.get(enemy.id) ?? null,
        desiredMovement: { moving: enemy.moving, vx: enemy.vx, vy: enemy.vy },
        moving: this.pinned.has(enemy.id) ? false : enemy.moving,
        vx: this.pinned.has(enemy.id) ? 0 : enemy.vx, vy: this.pinned.has(enemy.id) ? 0 : enemy.vy })),
      effects: this.runtime.getScenarioObservation(), lastAction: this.lastAction };
  }
  capture(): Promise<string> {
    this.requireReady();
    if (this.captureCancel) return Promise.reject(new Error('Eine Aufnahme läuft bereits.'));
    return new Promise((resolve, reject) => {
      const finish = (error: Error | null, url = '') => {
        if (this.captureCancel !== cancel) return;
        this.captureCancel = null; clearTimeout(timeout);
        if (error) reject(error); else resolve(url);
      };
      const cancel = () => finish(new Error('Aufnahme durch Szenario-Wechsel beendet.'));
      const timeout = setTimeout(() => finish(new Error('Keine Aufnahme nach 10 s; Browser-Pane sichtbar halten.')), 10000);
      this.captureCancel = cancel;
      try {
        this.scene.game.renderer.snapshot(image => {
          if (image instanceof HTMLImageElement) finish(null, image.src);
          else finish(new Error('Renderer lieferte kein PNG.'));
        }, 'image/png');
        if (this.clock.paused) this.clock.step();
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  async saveReportToWorkspace(): Promise<{ path: string; url: string; status: Record<string, unknown> }> {
    if(this.disposed||!isDevScenarioMode())throw new Error('Aktives Dev-Szenario erforderlich.');
    const status=structuredClone(this.snapshot()),body=new Blob([JSON.stringify(status,null,2)],{type:'application/json'});
    if(body.size>4*1024*1024)throw new Error('Bericht überschreitet 4 MiB.');
    const response=await fetch('/__dev-scenario-report',{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error??'Bericht konnte nicht gespeichert werden.');
    return {path:result.path,url:result.url,status};
  }
  async captureToWorkspace(): Promise<{ path: string; url: string; status: Record<string, unknown> }> {
    const revision = this.captureRevision;
    const url = await this.capture();
    const status = structuredClone(this.snapshot());
    const png = await (await fetch(url)).blob();
    const response = await fetch('/__dev-scenario-capture', { method: 'POST', headers: { 'content-type': 'image/png' }, body: png, signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (revision !== this.captureRevision || this.disposed) throw new Error('Aufnahme gehört zu einem inzwischen beendeten Szenario.');
    if (!response.ok) throw new Error(result.error ?? 'PNG konnte nicht gespeichert werden.');
    return { path: result.path, url: result.url, status };
  }
  destroy(): void {
    if (this.disposed) return;
    loadingTimeline.get('scenario')?.finish('cancelled');
    this.disposed = true; this.stop(); bridge.setDevScenarioPlayerFreeForAll(false); clearInterval(this.refreshTimer);
    this.worldLighting?.destroy(); this.worldLighting = null;
    window.removeEventListener('hashchange', this.onHashChange); this.api.destroy(); this.captureCancel?.();
    this.panel.destroy(); this.clock.destroy();
  }
}
