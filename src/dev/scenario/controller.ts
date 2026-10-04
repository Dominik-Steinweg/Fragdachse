import { loadingTimeline } from '../../diagnostics/LoadingTimeline';
import { EnemyMeshReview } from './EnemyMeshReview';
import { ArmageddonReview } from './ArmageddonReview';
import { setCharacterMaterialSuppressed, setCharacterMaterialView, characterMaterialStatus } from '../../effects/CharacterMaterialLighting';
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
import { getVisibleWorldView } from '../../graphics/CameraWorldView';
import type { TrainDevPassOptions } from '../../train/TrainManager';
import { setCameraBaseScroll } from '../../graphics/cameraBaseScroll';
import { ScenarioClock } from './clock';
import { visualTest } from './visualTest';
import { getGraphicsQualityController, type GraphicsQuality } from '../../graphics/GraphicsQuality';
import { decodeScenario, defaultScenario, encodeScenario, parseScenario, scenarioLoadout, type DevScenario, type GridPoint } from './config';
import { createScenarioPanel } from './panel';
import { installScenarioApi } from './api';
import { ScenarioBots } from './bots';
import { SUN_TUNING_DEFAULTS, validateSunTuning } from '../../effects/sunlight/SunTuning';
import { enemyReadabilityPlacements } from './enemyReadabilityRecipe';
import { trainFocusPoint, type TrainShowcaseFocus, trainExplosionZoom, trainHasEntered, trainObserverPosition, trainView, trainVisibility } from './trainShowcase';
import { resolveFogRockLighting, resolveRockAerialPerspective, type FogRockLightingOptions } from '../../effects/groundFog/FogRockLighting';

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
  private enemyMeshReview: EnemyMeshReview | null = null;
  private armageddonReview: ArmageddonReview | null = null;
  arrangeArmageddonReview(options: {count:number;progress:number;quality:import('../../graphics/GraphicsQuality').GraphicsQuality;impacts:boolean;singleImpact?:boolean;variant:'normal'|'void'}):void {
    this.requireReady(); this.armageddonReview?.destroy();
    const point=this.world(this.aim);
    this.armageddonReview=new ArmageddonReview(this.scene,this.runtime,{...options,...point});
  }
  arrangeEnemyMeshReview(count: number, pose: number, kinds?: readonly CoopDefenseEnemyKind[]): void {
    if (!kinds && this.enemyMeshReview?.count === count) { this.enemyMeshReview.setPose(pose); return; }
    this.requireReady(); this.clearEnemies(); this.stop();
    this.enemyMeshReview = new EnemyMeshReview(this.scene, this.runtime);
    this.enemyMeshReview.arrange(count, pose, kinds);
    this.cameraAtTarget = false; this.zoom = count <= 8 ? 2 : .85;
    this.syncCamera();
  }
  measureEnemyMeshReview(mesh: boolean): void {
    this.requireReady(); if (!this.enemyMeshReview) throw Error('Arrange enemyMeshReview first');
    this.enemyMeshReview.measure(mesh);
  }
  private debugTargets: ReturnType<ArenaRuntime['getScenarioLightingTargets']> | null = null;
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
    this.clock.holdLoadingTime = () => this.runtime.getScenarioLoadingState().work?.renderReady === false;
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
    this.armageddonReview?.destroy(); this.armageddonReview = null;
    const config = parseScenario(value);
    this.enemyMeshReview?.destroy(); this.enemyMeshReview = null;
    this.clearRenderDebug();
    const run = loadingTimeline.begin('scenario', String(performance.now()));
    run.gate('lobby', false); run.gate('scenario-setup', false);
    this.worldLighting?.reset();
    this.stop();
    this.captureCancel?.();
    this.captureRevision++;
    this.clock.paused = false; this.clock.speed = 1;
    this.clock.preparing = visualTest.enabled;
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
  setRenderDebug(disable: readonly string[], composite: import('../../effects/sunlight/WorldSunComposite').SunCompositeDebugView = 'normal', probe = false, characterShadowSolid = false,
    characterMaterialView: import('../../effects/CharacterMaterialModel').CharacterMaterialView = 'material',
    fogOptions: FogRockLightingOptions & { lobbyTimeOfDay?: number } = {}): void {
    // World-only render diagnosis is also available in the fresh dev tab's authored lobby.
    const lobby=this.state==='idle'&&bridge.getGamePhase()==='LOBBY'&&this.lobbyReady()
      &&this.runtime.getWorldDescriptor()?.definitionId==='world:lobby';
    if(!lobby)this.requireReady();
    const fogStrength=resolveFogRockLighting(fogOptions);
    const aerialStrength=resolveRockAerialPerspective(fogOptions);
    if(fogOptions.lobbyTimeOfDay!==undefined&&(!lobby||!Number.isFinite(fogOptions.lobbyTimeOfDay)
      ||fogOptions.lobbyTimeOfDay<0||fogOptions.lobbyTimeOfDay>=1440))throw new Error('lobbyTimeOfDay: bereite Lobby und Minute 0…1439 erwartet.');
    const targets = this.runtime.getScenarioLightingTargets();
    const worldPasses = ['sunComposite', 'fogDisplay', 'fogRockContact', 'fogRockSunShadow', 'rockAerialPerspective', 'lightmap', 'characterShadows', 'rockSurface', 'rockGround', 'rockFoliage', 'rockOverlays', 'enemyContour', 'characterMaterial'];
    // Validate the entire request before changing any world output.
    targets.postFx.setDebugDisabled(disable.filter(name => !worldPasses.includes(name)));
    if(fogOptions.lobbyTimeOfDay!==undefined) {
      bridge.setLobbyTimeOfDayMinutes(fogOptions.lobbyTimeOfDay);
      this.runtime.syncLobbyTimeOfDay();
    }
    targets.fog?.setDebugRockLighting(disable.includes('fogRockContact'),disable.includes('fogRockSunShadow'),
      disable.includes('rockAerialPerspective')?{...fogOptions,rockAerialPerspective:false}:fogOptions);
    targets.sunlight?.setDebugCompositeSuppressed(disable.includes('sunComposite'));
    targets.sunlight?.setDebugCharacterShadowsSuppressed(disable.includes('characterShadows'));
    targets.sunlight?.setDebugCharacterShadowSolid(characterShadowSolid);
    targets.sunlight?.setDebugCompositeView(composite);
    targets.fog?.setDebugDisplaySuppressed(disable.includes('fogDisplay'));
    targets.lighting.setCompositeSuppressed(disable.includes('lightmap'));
    targets.rocks?.setDebugFormationSuppressed(disable.includes('rockSurface'),disable.includes('rockGround'),disable.includes('rockFoliage'));
    targets.rockOverlays?.setVisible(!disable.includes('rockOverlays'));
    targets.enemyReadability.setSuppressed(disable.includes('enemyContour'));
    setCharacterMaterialSuppressed(this.scene, disable.includes('characterMaterial'));
    setCharacterMaterialView(this.scene, characterMaterialView);
    this.debugTargets = disable.length || composite !== 'normal' || characterShadowSolid || characterMaterialView !== 'material'
      ||fogOptions.fogRockContactStrength!==undefined||fogOptions.fogRockSunShadowStrength!==undefined
      ||fogOptions.rockAerialPerspective!==undefined||fogOptions.rockAerialPerspectiveStrength!==undefined ? targets : null;
    this.lastAction = { renderDebug: targets.postFx.getDebugPasses(),
      worldOutputs: worldPasses.map(name => ({ name, disabled: disable.includes(name) })), composite, characterShadowSolid, characterMaterialView,
      fogRockLighting:{contactStrength:disable.includes('fogRockContact')?0:fogStrength[0],sunShadowStrength:disable.includes('fogRockSunShadow')?0:fogStrength[1]},
      rockAerialPerspective:{enabled:aerialStrength>0&&!disable.includes('rockAerialPerspective'),strength:disable.includes('rockAerialPerspective')?0:aerialStrength},
      ...(lobby?{lobbyTimeOfDay:bridge.getLobbyTimeOfDayMinutes()}:{}),
      material: probe ? targets.sunlight?.inspectDebugCompositeMaterial() ?? null : undefined };
  }
  private clearRenderDebug(): void {
    setCharacterMaterialView(this.scene, 'material');
    setCharacterMaterialSuppressed(this.scene, false);
    const targets = this.debugTargets;
    targets?.postFx.setDebugDisabled([]);
    targets?.sunlight?.setDebugCompositeSuppressed(false);
    targets?.sunlight?.setDebugCharacterShadowsSuppressed(false);
    targets?.sunlight?.setDebugCharacterShadowSolid(false);
    targets?.sunlight?.setDebugCompositeView('normal');
    targets?.fog?.setDebugDisplaySuppressed(false);
    targets?.fog?.setDebugRockLighting(false,false);
    targets?.lighting.setCompositeSuppressed(false);
    targets?.rocks?.setDebugFormationSuppressed(false,false,false);
    targets?.rockOverlays?.setVisible(true);
    targets?.enemyReadability.setSuppressed(false);
    this.debugTargets = null;
  }
  setSunTuning(values: unknown, reset = false): void {
    this.requireReady();
    const patch = reset ? undefined : validateSunTuning(values);
    this.worldLighting ??= new WorldLightingMeasurement(this.scene, () => this.runtime.getScenarioLightingTargets());
    this.worldLighting.update(this.config.timeOfDay,this.clock.now);
    this.worldLighting.tuneSun(patch,reset);
    if (this.clock.paused) this.step();
  }
  measureWorldLighting(mode: 'stationary' | 'destruction' | 'explosion' | 'traverse' | 'walk' = 'stationary',radius=2.5): void {
    this.requireReady(); if (this.clock.paused) this.resume();
    this.stop();
    this.worldLighting ??= new WorldLightingMeasurement(this.scene, () => this.runtime.getScenarioLightingTargets());
    this.worldLighting.update(this.config.timeOfDay,this.clock.now);
    if(mode==='stationary'){this.worldLighting.measure();return;}
    const savedAim={...this.aim},savedFocus=this.cameraAtTarget;
    const restore=()=>{this.aim=savedAim;this.cameraAtTarget=savedFocus;this.syncCamera();};
    const pending=()=>{const loading=this.runtime.getScenarioLoadingState();return (loading.ground?.pendingWork??0)>0||(loading.overlay?.pendingWork??0)>0;};
    if(mode==='destruction'||mode==='explosion') {
      const rock=this.runtime.devScenarioPort.findDestructibleRock(this.aim.gridX,this.aim.gridY);
      if(!rock)throw new Error('Kein zerstörbarer Fels innerhalb von 8 Zellen um das Ziel.');
      this.aim={gridX:rock.gridX,gridY:rock.gridY};this.cameraAtTarget=true;this.syncCamera();
      this.worldLighting.measure({mode,durationMs:5000,restore,pending,advance:()=>{},start:()=>{
        if(mode==='explosion'){const ids=this.runtime.devScenarioPort.destroyRocksNear(rock.gridX,rock.gridY,radius);return {rockIds:ids,gridX:rock.gridX,gridY:rock.gridY,radius,authoritative:true};}
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
  spawn(kind: CoopDefenseEnemyKind, pinned: boolean, hp: number | null, point = this.aim, remember = true): string {
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
    return id;
  }
  arrangeEnemyReadability(surface: 'woodland' | 'gravel' = 'woodland'): void {
    this.requireReady();
    if (this.config.mapId !== '1' || this.config.seed !== 12345) throw new Error('Zuerst enemyReadabilityScene starten.');
    this.clearEnemies(); this.stop();
    const placements = enemyReadabilityPlacements(surface).map(placement => {
      // Rock/canopy stations are not legal spawn cells: spawn on the free player cell, then pin.
      let id: string;
      try { id = this.spawn(placement.kind, true, 1000000, placement); }
      catch { id = this.spawn(placement.kind, true, 1000000, { gridX: 27, gridY: 28 }); }
      // Diagnostic pose override only: use the existing pinned-target port, including rock
      // cells that normal gameplay correctly excludes when finding a legal spawn point.
      const position = this.world(placement);
      this.pinned.set(id, position);
      this.runtime.weaponBalanceLabPort.pinTarget(id, position.x, position.y);
      return { id, ...placement, position };
    });
    this.aim = { gridX: surface === 'gravel' ? 130 : 28, gridY: 21 }; this.cameraAtTarget = true; this.zoom = 1.4;
    this.syncCamera(); this.lastAction = { enemyReadability: placements };
  }
  clearEnemies(): void {
    this.enemyMeshReview?.destroy(); this.enemyMeshReview = null;
    this.requireReady(); this.runtime.navigationLabPort.removeEnemies(); this.pinned.clear();
    this.config.enemies = []; this.saveLink();
  }
  spawnPowerUp(defId: string, point = this.aim): void {
    this.requireReady();
    const position = this.free(point, 11);
    const uid = this.runtime.devScenarioPort.spawnPowerUp(defId, position.x, position.y);
    if (uid === null) throw new Error('Power-Up konnte nicht erzeugt werden.');
    this.lastAction = { ok: true, powerUpUid: uid, defId, position };
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
    this.pendingTrainShowcase = null; this.activeTrainShowcase = null; this.trainReadyOwner = null; this.trainFollow = false;
    this.trainCameraPoint = null; this.trainExplosionDeadline = null;
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
  private pendingTrainShowcase: { follow: boolean; zoom: number; reason: string; targetDefinition?: string; motion: TrainDevPassOptions; focus: TrainShowcaseFocus } | null = null;
  private trainReadyOwner: number | null = null;
  private activeTrainShowcase: { follow: boolean; zoom: number; ownerId: number; motion: TrainDevPassOptions; focus: TrainShowcaseFocus } | null = null;
  private lastTrainStartReason: string | null = null;
  private trainFollow = false;
  private trainCenterFollow = false;
  private trainFocus: TrainShowcaseFocus = 'overview';
  private trainCameraPoint: { x: number; y: number } | null = null;
  private trainExplosionDeadline: number | null = null;

  startTrainShowcase(follow = true, zoom = .8, motion: TrainDevPassOptions = { park: 'center', speedPxPerSec: 0 }, focus: TrainShowcaseFocus = 'overview'): void {
    motion = { ...motion, focus: focus === 'overview' ? 'center' : focus };
    // Repeated commands during admission update the intent, never restart the same map.
    if (this.pendingTrainShowcase) {
      Object.assign(this.pendingTrainShowcase, { follow, zoom, motion, focus });
      return;
    }
    const current = this.state === 'ready' ? this.runtime.devScenarioPort.readTrain() : null;
    if (this.state === 'ready' && !this.setupPending && current && this.trainWorldReady()) {
      this.prepareTrainShowcase(follow, zoom, 'showcase-existing-world', motion, focus);
      return;
    }
    const alreadyOnTrainMap = this.config.mapId === '7'
      && (this.state === 'loading' || this.state === 'waiting-lobby' || this.state === 'ready');
    if (!alreadyOnTrainMap) this.start({ ...defaultScenario(), mapId: '7', seed: 12345 });
    this.pendingTrainShowcase = { follow, zoom, motion, focus, reason: 'showcase-after-ready',
      targetDefinition: 'world:coop-defense:7' };
    this.lastTrainStartReason = 'showcase-waiting-for-ready';
    this.trainReadyOwner = null;
  }

  private trainWorldReady(): boolean {
    const loading = this.runtime.getScenarioLoadingState();
    return bridge.getGamePhase() === 'ARENA' && bridge.isArenaStarted() && !this.runtime.isMatchTerminated()
      && this.runtime.navigationLabPort.isReady() && loading.roundStartPrepared
      && loading.localArenaLoadReady !== false && this.runtime.navigationLabPort.getPlayerPosition()?.alive === true;
  }

  /** Runs after host reconciliation, and acknowledges only the final World/Activity train owner. */
  private flushTrainShowcase(): void {
    if (!this.pendingTrainShowcase && !this.activeTrainShowcase) return;
    const train = this.runtime.devScenarioPort.readTrain();
    const ownerId = train?.devPass?.ownerId ?? null;
    if (this.activeTrainShowcase && ownerId !== this.activeTrainShowcase.ownerId) {
      this.pendingTrainShowcase = { ...this.activeTrainShowcase, reason: 'showcase-world-replaced' };
      this.activeTrainShowcase = null;
      this.trainReadyOwner = null;
    }
    const request = this.pendingTrainShowcase;
    if (!request) return;
    const world = this.runtime.getWorldDescriptor();
    if (this.setupPending || !this.trainWorldReady() || !train || ownerId === null
      || (request.targetDefinition && world?.definitionId !== request.targetDefinition)) {
      this.trainReadyOwner = null;
      return;
    }
    // Ready was observed for this owner after a complete host frame. Start on the next
    // post-host boundary; whenReady remains pending throughout this acknowledgement.
    if (this.trainReadyOwner !== ownerId) { this.trainReadyOwner = ownerId; return; }
    this.prepareTrainShowcase(request.follow, request.zoom, request.reason, request.motion, request.focus);
  }

  private prepareTrainShowcase(follow: boolean, zoom: number, reason: string, motion: TrainDevPassOptions, focus: TrainShowcaseFocus): void {
    this.requireReady();
    const train = this.runtime.devScenarioPort.readTrain();
    if (!train) throw new Error('Keine Zugstrecke für die Vorführung verfügbar.');
    const observer = trainObserverPosition(this.runtime.navigationLabPort.getFreePositions(24), train);
    if (!observer) throw new Error('Keine freie Beobachterposition mit Sicherheitsabstand zum Gleis.');
    this.stop();
    this.teleport(this.grid(observer), false);
    this.config.freezeMission = true; this.config.suppressWaves = true;
    this.zoom = zoom; this.trainFollow = follow; this.trainFocus = focus;
    this.trainCameraPoint = { x: (train.trackBounds.left + train.trackBounds.right) / 2,
      y: (train.trackBounds.top + train.trackBounds.bottom) / 2 };
    this.startTrain(true, reason, motion);
    const started = this.runtime.devScenarioPort.readTrain();
    if (!started?.state?.alive) throw new Error('Zugstart nicht bestätigt; status().train prüfen.');
    if (started.devPass) this.activeTrainShowcase = { follow, zoom, motion, focus, ownerId: started.devPass.ownerId };
    this.trainCenterFollow = motion.park === 'center';
    if (this.trainCenterFollow) {
      this.trainCameraPoint = { x: (started.bounds.left + started.bounds.right) / 2,
        y: (started.bounds.top + started.bounds.bottom) / 2 };
      if (focus === 'overview') this.zoom = trainExplosionZoom({ ...started, explosionCenter: this.trainCameraPoint }, zoom);
    }
    if (focus !== 'overview') this.trainCameraPoint = trainFocusPoint(started, focus);
    // Restore integrity of the freshly started pass without advancing simulation time.
    this.runtime.devScenarioPort.updateTrain(0, true);
    this.updateTrainShowcase();
    this.syncCamera();
    this.lastAction = { trainShowcase: true, observer, follow, zoom };
    this.message = 'Zug-Vorführung bereit; Beobachter steht abseits des Gleises.';
  }

  private updateTrainShowcase(): void {
    if (!this.trainFollow && this.trainExplosionDeadline === null) return;
    const train = this.runtime.devScenarioPort.readTrain();
    if (this.trainFollow && train?.state?.alive) {
      this.trainCameraPoint = this.trainFocus !== 'overview' ? trainFocusPoint(train, this.trainFocus) : { x: train.state.x,
        y: this.trainCenterFollow ? (train.bounds.top + train.bounds.bottom) / 2
          : Math.max(train.trackBounds.top, Math.min(train.trackBounds.bottom, train.state.y)) };
    }
    if (this.trainExplosionDeadline === null) return;
    if (train && this.trainFocus !== 'overview') {
      const v = getVisibleWorldView(this.scene.cameras.main);
      if (trainVisibility(train, { left: v.x, top: v.y, right: v.right, bottom: v.bottom }).visible) {
        this.destroyTrain(); return;
      }
    }
    if (train && this.trainFocus === 'overview' && trainHasEntered(train)) {
      this.zoom = trainExplosionZoom(train, this.zoom);
      this.trainCameraPoint = train.explosionCenter;
      this.syncCamera();
      if (trainVisibility(train, trainView(this.trainCameraPoint!, this.zoom)).fullyVisible) this.destroyTrain();
    } else if (this.clock.now > this.trainExplosionDeadline) {
      this.trainExplosionDeadline = null;
      throw new Error('Zug nicht rechtzeitig eingefahren. trainShowcase erneut starten.');
    }
  }

  private trainStatus() {
    const train = this.state === 'ready' ? this.runtime.devScenarioPort.readTrain?.() : null;
    const diagnostics = { lastStartReason: this.pendingTrainShowcase?.reason ?? train?.devPass?.lastStartReason ?? this.lastTrainStartReason,
      devPassState: this.pendingTrainShowcase ? 'waiting-for-ready' : train?.devPass?.state ?? 'unavailable',
      devPassOwnerId: train?.devPass?.ownerId ?? null, devPassStartCount: train?.devPass?.startCount ?? 0,
      devPassSimulationMs: train?.devPass?.simulatedMs ?? 0,
      worldRevision: this.runtime.getWorldDescriptor()?.worldRevision ?? null };
    if (!train) return { available: false, preparing: this.pendingTrainShowcase !== null, ...diagnostics };
    const camera = this.scene.cameras.main;
    const cameraView = getVisibleWorldView(camera);
    const view = { left: cameraView.x, top: cameraView.y, right: cameraView.right, bottom: cameraView.bottom };
    return { available: true, ...diagnostics, position: train.state ? { x: train.state.x, y: train.state.y } : null,
      alive: train.state?.alive ?? false, speed: train.speed, coordinateSpace: 'world',
      ...trainVisibility(train, view), cameraBounds: view, bounds: train.bounds, trackBounds: train.trackBounds,
      explosionCenter: train.explosionCenter, follow: this.trainFollow, focus: this.trainFocus,
      pendingExplosion: this.trainExplosionDeadline !== null, cameraCenter: this.trainCameraPoint };
  }
  startTrain(invulnerable = false, reason = 'train-command', motion?: TrainDevPassOptions): void {
    this.requireReady();
    this.trainInvulnerable = invulnerable;
    this.lastTrainUpdate = this.clock.now;
    this.lastTrainStartReason = reason;
    if (!this.runtime.devScenarioPort.startTrain(reason, motion)) throw new Error('Diese Map hat keine Zugstrecke.');
  }
  destroyTrain(whenVisible = false): void {
    this.requireReady();
    if (whenVisible) {
      if (!this.runtime.devScenarioPort.readTrain()) throw new Error('Keine Zugstrecke; zuerst trainShowcase starten.');
      this.trainExplosionDeadline = this.clock.now + 30000;
      this.lastAction = { trainExplosion: 'waiting-for-entry-and-framing' };
      this.updateTrainShowcase();
      return;
    }
    const train = this.runtime.devScenarioPort.readTrain();
    if (train?.explosionCenter && this.trainFocus === 'overview') {
      this.trainCameraPoint = train.explosionCenter;
      this.zoom = trainExplosionZoom(train, this.zoom);
      this.trainFollow = false;
      this.syncCamera();
    }
    this.trainFollow = false;
    this.trainExplosionDeadline = null;
    if (!this.runtime.devScenarioPort.destroyTrain()) throw new Error('Kein lebender Zug. Zuerst train starten und einfahren lassen.');
    this.trainInvulnerable = false;
    this.lastAction = { trainExplosion: 'detonated', center: this.trainCameraPoint, zoom: this.zoom };
  }
  aimBot(index: number, point: GridPoint | null): void { this.bots.aim(index, point ? this.world(point) : null); }
  private requirePresentation(): void {
    if (this.state === 'idle' && this.lobbyReady()) return;
    this.requireReady();
  }
  setQuality(level: GraphicsQuality): void { getGraphicsQualityController(this.scene)?.setLevel(level); }
  pause(): void { this.requirePresentation(); this.worldLighting?.stopMeasurement(); this.clock.paused = true; }
  resume(): void { this.clock.paused = false; }
  step(frames = 1): void { this.requirePresentation(); this.clock.step(frames); }
  settle(frames = 1): void { this.requirePresentation(); this.clock.settle(frames); }
  private pauseVisualTest(): void {
    if (this.clock.preparing) { this.clock.preparing = false; this.clock.paused = true; }
  }
  update(): void {
    if (this.disposed) return;
    try {
      if (this.state === 'idle' && this.lobbyReady()) this.pauseVisualTest();
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
      this.flushTrainShowcase();
      this.updateTrainShowcase();
      if (!this.setupPending && !this.pendingTrainShowcase) this.pauseVisualTest();
    } catch (error) { this.fail(error); this.stop(); this.state = 'error'; }
  }
  setPanelCollapsed(collapsed: boolean): void { this.panel.setCollapsed(collapsed); }
  syncPanel(): void { this.panel.sync(); }
  syncCamera(): void {
    if (this.state !== 'ready') return;
    let point: { x: number; y: number } | null;
    try { point = this.trainCameraPoint ?? (this.cameraAtTarget ? this.world(this.aim) : this.runtime.navigationLabPort.getPlayerPosition()); }
    catch (error) { this.cameraAtTarget = false; this.fail(error); return; }
    if (!point) return;
    const camera = this.scene.cameras.main;
    camera.removeBounds();
    camera.setZoom(this.scene.scale.width / GAME_WIDTH * this.zoom, this.scene.scale.height / GAME_HEIGHT * this.zoom);
    if (this.trainCameraPoint) {
      // Arena uses origin (0,0); Phaser centerOn assumes the unzoomed half viewport.
      // Invert the actual origin/zoom instead, also valid after a DPR or viewport resize.
      camera.stopFollow();
      const view = getVisibleWorldView(camera);
      camera.setScroll(camera.scrollX + point.x - view.centerX, camera.scrollY + point.y - view.centerY);
    } else camera.setScroll(point.x - GAME_WIDTH / this.zoom / 2, point.y - GAME_HEIGHT / this.zoom / 2);
    setCameraBaseScroll(this.scene, camera.scrollX, camera.scrollY);
  }
  snapshot(): Record<string, unknown> {
    return { state: this.state, ready: this.state === 'ready' && !this.setupPending && !this.pendingTrainShowcase, message: this.message, isolated: true, network: 'local-only',
      initialPosition: this.initialPosition, mission: this.runtime.devScenarioPort.readMission(),
      train: this.trainStatus(),
      bots: this.bots.ids().map((id, index) => ({ index, id, ...(this.state === 'ready' ? this.bots.position(index) : null) })),
      readyAfterMs: this.readyAt === null ? null : Math.round(this.readyAt - this.startedAt),
      elapsedWallMs: Math.round(performance.now() - this.startedAt), simulationMs: this.clock.now,
      paused: this.clock.paused, pendingSteps: this.clock.pendingSteps, lobbyReady: this.lobbyReady(), visualTest: visualTest.enabled,
      quality: getGraphicsQualityController(this.scene)?.getLevel() ?? 'high',
      speed: this.clock.speed, trigger: this.trigger, moving: this.movement,
      pendingSetupConstructions: this.pendingConstructions.length,
      rendererSize: { width: this.scene.game.canvas.width, height: this.scene.game.canvas.height },
      sunTuning: { ...(this.worldLighting?.sunTuning ?? SUN_TUNING_DEFAULTS) },
      sun: this.worldLighting?.sunStatus ?? null,
      characterShadows: this.state === 'ready' ? this.runtime.getScenarioLightingTargets().sunlight?.getCharacterShadowsStatus() ?? null : null,
      enemyMeshShadows: this.state === 'ready' ? this.runtime.getScenarioLightingTargets().shadow?.getEnemyShadowsStatus() ?? null : null,
      enemyMeshMeasurement: this.enemyMeshReview?.measurement ?? null,
      armageddonReview: this.armageddonReview?.status() ?? null,
      enemyMeshFixture: this.enemyMeshReview?.inspect() ?? null,
      enemyContour: this.state === 'ready' ? this.runtime.getScenarioLightingTargets().enemyReadability.getDiagnostics() : null,
      characterMaterial: characterMaterialStatus(this.scene),
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
    this.armageddonReview?.destroy(); this.armageddonReview = null;
    if (this.disposed) return;
    this.enemyMeshReview?.destroy(); this.enemyMeshReview = null;
    this.clearRenderDebug();
    loadingTimeline.get('scenario')?.finish('cancelled');
    this.disposed = true; this.stop(); bridge.setDevScenarioPlayerFreeForAll(false); clearInterval(this.refreshTimer);
    this.worldLighting?.destroy(); this.worldLighting = null;
    window.removeEventListener('hashchange', this.onHashChange); this.api.destroy(); this.captureCancel?.();
    this.panel.destroy(); this.clock.destroy();
  }
}
