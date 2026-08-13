import type * as Phaser from 'phaser';
import { PLAYER_SIZE } from '../config';
import { resolveCoopDefenseEnemyConfigs } from '../config/coopDefenseEnemies';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { WeaponFireExecutor } from '../loadout/WeaponFireExecutor';
import type { LightingSystem } from '../effects/LightingSystem';
import { AmbientActorRegistry } from './AmbientActorRegistry';
import { AmbientCombatWorld } from './AmbientCombatWorld';
import { orderAmbientTemplateCandidates } from './AmbientSequenceCatalog';
import { AmbientSequenceCompiler, type CompiledActorPlan, type CompiledSequence } from './AmbientSequenceCompiler';
import { AmbientSequenceHistory } from './AmbientSequenceHistory';
import { LobbyAmbientActor } from './LobbyAmbientActor';
import { LobbyInspector } from './LobbyInspector';
import type { LobbyNavigation } from './LobbyNavigation';
import type { LobbyObstacleWorld } from './LobbyObstacleWorld';
import type { GraphicsQuality } from '../graphics/GraphicsQuality';
import { getStoredGraphicsQuality } from '../utils/localPreferences';

/** Obergrenze der Actors je Qualitätsprofil. */
function maxActorsFor(quality: GraphicsQuality): number {
  switch (quality) {
    case 'low':    return 2;
    case 'medium': return 4;
    default:       return 6;
  }
}

/** Faktor auf die Ruhephase zwischen zwei Sequenzen. */
function quietStretchFor(quality: GraphicsQuality): number {
  switch (quality) {
    case 'low':    return 2;
    case 'medium': return 1.35;
    default:       return 1;
  }
}

/** Tag des detonierbaren ASMD-Balls; die Semantik stammt unverändert aus dem Gameplay. */
const ASMD_BALL_TAG = 'asmd_ball';
/** So lange fliegt der Ball sichtbar, bevor die Primärwaffe ihn zündet. */
const ASMD_BALL_FLIGHT_MS = 420;

/** Neutraler Glow der Ambient-Dachse. Bewusst keine Spielerfarbe. */
const AMBIENT_BADGER_GLOW = 0xb9c4cf;
/** Ruhe vor der ersten Sequenz. */
const INITIAL_QUIET_MS = 4_000;
const QUIET_MIN_MS = 6_000;
const QUIET_MAX_MS = 12_000;
/** Bewegungstempo eines Ambient-Dachses in Pixeln pro Sekunde. */
const BADGER_MOVE_SPEED = 150;
/** Wie oft ein Actor seinen Pfad und sein Ziel überdenkt. */
const RETARGET_INTERVAL_MS = 420;
/** So weit ausserhalb der Arenakante beginnt und endet ein Auftritt. */
const OFFSTAGE_MARGIN_PX = 96;
/** So lange darf eine Figur zum Rand laufen, bevor sie sich stattdessen eingräbt. */
const EXIT_WALK_MS = 5_000;
/** Zusatzzeit für die Grabbewegung, danach ist die Sequenz in jedem Fall beendet. */
const BURROW_GRACE_MS = 900;
/** Ab dieser Gehstrecke zum Rand gräbt sich eine Figur lieber ein. */
const BURROW_PREFERRED_DISTANCE_PX = 420;
/** Anteil der Abgänge, die auch bei kurzem Weg im Boden enden. */
const BURROW_CHANCE = 0.35;
/**
 * Zeitzuschlag für den Auftritt.
 *
 * Die Gefechtsdauer eines Templates meint das Gefecht, nicht den Anmarsch. Ohne diesen
 * Zuschlag lief die Sequenz ab, bevor Dachse und Gegner überhaupt aufeinandergetroffen sind.
 */
const ENTRY_ALLOWANCE_MS = 3_000;

type DirectorPhase = 'quiet' | 'running' | 'exiting' | 'repair' | 'disabled';

interface RunningActor {
  actor: LobbyAmbientActor;
  plan: CompiledActorPlan;
  weapon: WeaponConfig | null;
  secondary: WeaponConfig | null;
  nextShotAtMs: number;
  shotsFired: number;
  nextRetargetAtMs: number;
}

export interface LobbyAmbientDirectorDeps {
  readonly scene: Phaser.Scene;
  readonly world: LobbyObstacleWorld;
  readonly navigation: LobbyNavigation;
  readonly actors: AmbientActorRegistry;
  readonly combat: AmbientCombatWorld;
  readonly inspector: LobbyInspector;
  readonly lighting: LightingSystem | null;
  /** Aktuell gewählte weapon1/weapon2 – wird pro Sequenz frisch gelesen. */
  readonly getSelectedWeaponIds: () => readonly (string | null | undefined)[];
  readonly rng: () => number;
}

/**
 * Taktgeber der Lobby-Inszenierung.
 *
 * Er plant Situationen, garantiert aber keine Ergebnisse: Was die echte Mechanik anrichtet,
 * bleibt stehen. Zwischen zwei Gefechten liegt Ruhe, und solange der Inspector arbeitet,
 * startet keine neue Sequenz.
 *
 * Alles hier ist lokal. Zwei Clients sehen unterschiedliche Sequenzen – das ist Absicht.
 */
export class LobbyAmbientDirector {
  private readonly compiler = new AmbientSequenceCompiler();
  private readonly history = new AmbientSequenceHistory();
  private readonly fire: WeaponFireExecutor;
  private readonly enemyConfigs = resolveCoopDefenseEnemyConfigs(1);

  private phase: DirectorPhase = 'quiet';
  private clockMs = 0;
  private phaseEndsAtMs = INITIAL_QUIET_MS;
  private sequence: CompiledSequence | null = null;
  private running: RunningActor[] = [];

  constructor(private readonly deps: LobbyAmbientDirectorDeps) {
    this.fire = new WeaponFireExecutor(deps.combat);
  }

  getPhase(): DirectorPhase {
    return this.phase;
  }

  /** Läuft gerade eine Sequenz oder Reparatur? Grundlage der Teardown-Invarianten. */
  isBusy(): boolean {
    return this.phase === 'running' || this.phase === 'repair';
  }

  update(deltaMs: number): void {
    if (this.phase === 'disabled') return;
    this.clockMs += deltaMs;

    try {
      this.deps.actors.update(deltaMs);
      this.deps.combat.update(deltaMs);

      switch (this.phase) {
        case 'quiet':   this.updateQuiet(); break;
        case 'running': this.updateRunning(deltaMs); break;
        case 'exiting': this.updateExiting(); break;
        case 'repair':  this.updateRepair(deltaMs); break;
      }
    } catch (error) {
      // Ein Lobby-Fehler darf den Matchstart nie verhindern.
      console.error('[LobbyAmbientDirector] Ambient deaktiviert nach Fehler', error);
      this.disable();
    }
  }

  /** Bricht alles ab und räumt vollständig auf. Danach existiert kein Ambient-Zustand mehr. */
  stop(): void {
    this.abortSequence();
    this.deps.inspector.abort();
    this.deps.combat.destroy();
    this.deps.actors.clear();
    this.history.reset();
    this.phase = 'quiet';
    this.clockMs = 0;
    this.phaseEndsAtMs = INITIAL_QUIET_MS;
  }

  /** Schaltet die Inszenierung dauerhaft ab, ohne die Lobby zu stören. */
  disable(): void {
    this.stop();
    this.phase = 'disabled';
  }

  // ── Phasen ─────────────────────────────────────────────────────────────────

  private updateQuiet(): void {
    if (this.clockMs < this.phaseEndsAtMs) return;
    if (!this.startSequence()) {
      // Kein Template ließ sich auflösen – kurz warten und erneut versuchen.
      this.phaseEndsAtMs = this.clockMs + QUIET_MIN_MS;
    }
  }

  private updateRunning(deltaMs: number): void {
    void deltaMs;
    for (const entry of this.running) this.updateActor(entry);

    const everyoneDown = this.running.every((entry) => !entry.actor.isAlive());
    if (this.clockMs >= this.phaseEndsAtMs || everyoneDown) this.beginExit();
  }

  /**
   * Abgang statt Verschwinden: Jeder überlebende Actor läuft zu seinem Exitpunkt und über die
   * Arenakante hinaus. Erst dort wird er entfernt.
   */
  /**
   * Wählt für jede Figur einen Abgang.
   *
   * Eingraben ist eine gleichwertige Alternative, kein Notbehelf: Wer tief in der
   * Felslandschaft steht, weit vom Rand entfernt ist oder schlicht ausgelost wird, verschwindet
   * im Boden statt quer über die ganze Fläche zu laufen. Ohne diese Wahl liefe praktisch jede
   * Figur zum nächsten Rand – die Zonen liegen fast alle an der Arenakante.
   */
  private beginExit(): void {
    this.phase = 'exiting';
    this.phaseEndsAtMs = this.clockMs + EXIT_WALK_MS;
    for (const entry of this.running) {
      if (!entry.actor.isAlive()) continue;
      const walkDistance = this.planExitPath(entry.actor, entry.plan.exit);
      const burrows = walkDistance === null
        || walkDistance > BURROW_PREFERRED_DISTANCE_PX
        || this.deps.rng() < BURROW_CHANCE;
      if (burrows) entry.actor.beginBurrow();
    }
  }

  /**
   * Abgang. Zwei zulässige Ausgänge, kein dritter:
   *
   * - über die Arenakante hinauslaufen, oder
   * - sich sichtbar eingraben und unter der Erde verschwinden.
   *
   * Wer den Rand in der Gehzeit nicht erreicht – weil er tief in der Felslandschaft steht
   * oder ein Weg zugebaut wurde – gräbt sich ein. Eine Figur löst sich nie mitten im Bild auf.
   */
  private updateExiting(): void {
    const walkTimeUp = this.clockMs >= this.phaseEndsAtMs;

    for (const entry of this.running) {
      const { actor } = entry;
      if (!actor.isAlive() || actor.isUnderground()) continue;

      // Auch auf dem Weg hinaus blickt die Figur dorthin, wohin sie läuft.
      const heading = actor.getMovementAngle();
      if (heading !== null) actor.setAimAngle(heading);

      if (!this.deps.world.containsWorldPoint(actor.x, actor.y)) {
        actor.setStageVisible(false);
        continue;
      }
      // Kein Weg mehr oder Zeit abgelaufen: eingraben statt stehenzubleiben.
      if ((walkTimeUp || !actor.hasPath()) && !actor.isBurrowing()) actor.beginBurrow();
    }

    const gone = this.running.every((entry) => !entry.actor.isAlive()
      || entry.actor.isUnderground()
      || !this.deps.world.containsWorldPoint(entry.actor.x, entry.actor.y));
    if (gone || this.clockMs >= this.phaseEndsAtMs + BURROW_GRACE_MS) this.finishSequence();
  }

  private updateRepair(deltaMs: number): void {
    if (this.deps.inspector.update(deltaMs)) return;
    this.enterQuiet();
  }

  // ── Sequenz ────────────────────────────────────────────────────────────────

  private startSequence(): boolean {
    const context = {
      world: this.deps.world,
      navigation: this.deps.navigation,
      history: this.history,
      selectedWeaponIds: this.deps.getSelectedWeaponIds(),
      nowMs: this.clockMs,
      rng: this.deps.rng,
    };

    const maxActors = maxActorsFor(getStoredGraphicsQuality());
    for (const template of orderAmbientTemplateCandidates(this.history, this.clockMs, this.deps.rng)) {
      const compiled = this.compiler.compile(template.id, context);
      if (!compiled) continue;
      // Auf mittlerer und niedriger Qualität treten weniger Actors auf; die Situation selbst
      // bleibt dieselbe.
      if (compiled.actors.length > maxActors) compiled.actors.length = maxActors;
      if (compiled.actors.length === 0) continue;
      this.spawnSequence(compiled);
      return true;
    }
    return false;
  }

  private spawnSequence(compiled: CompiledSequence): void {
    this.sequence = compiled;
    this.deps.combat.enterZone(compiled.zoneRect);

    for (const plan of compiled.actors) {
      const spawn = this.deps.world.cellToWorld(plan.spawn.gridX, plan.spawn.gridY);
      const target = this.deps.world.cellToWorld(plan.moveTo.gridX, plan.moveTo.gridY);
      const aim = Math.atan2(target.y - spawn.y, target.x - spawn.x);

      const actor = plan.team === 'badger'
        ? new LobbyAmbientActor(this.deps.scene, {
            id: plan.id,
            team: 'badger',
            x: spawn.x,
            y: spawn.y,
            aimAngle: aim,
            hp: PLAYER_SIZE * 3,
            moveSpeed: BADGER_MOVE_SPEED,
            weaponId: plan.weapon?.id,
            glowColor: AMBIENT_BADGER_GLOW,
          }, this.deps.lighting)
        : new LobbyAmbientActor(this.deps.scene, {
            id: plan.id,
            team: 'enemy',
            x: spawn.x,
            y: spawn.y,
            aimAngle: aim,
            moveSpeed: this.enemyConfigs[plan.enemyKind!].moveSpeed,
            enemyKind: plan.enemyKind!,
            config: this.enemyConfigs[plan.enemyKind!],
          }, this.deps.lighting);

      this.deps.actors.add(actor);
      // Auftritt von aussen: Der Actor startet unsichtbar jenseits der Arenakante und läuft
      // hinein. Ohne das erschiene er mitten im Bild aus dem Nichts.
      this.enterFromOffstage(actor, plan.spawn, target);

      this.running.push({
        actor,
        plan,
        weapon: plan.weapon?.config ?? null,
        secondary: plan.secondaryWeaponId
          ? (WEAPON_CONFIGS[plan.secondaryWeaponId as keyof typeof WEAPON_CONFIGS] as WeaponConfig)
          : null,
        // Ein kurzer Vorlauf, damit nicht alle im selben Frame losfeuern.
        nextShotAtMs: this.clockMs + 350 + Math.floor(this.deps.rng() * 500),
        shotsFired: 0,
        nextRetargetAtMs: this.clockMs + RETARGET_INTERVAL_MS,
      });
    }

    this.phase = 'running';
    this.phaseEndsAtMs = this.clockMs + ENTRY_ALLOWANCE_MS + compiled.durationMs;
  }

  private finishSequence(): void {
    const compiled = this.sequence;
    const damaged = this.deps.combat.takeDamagedRocks();
    const destroyed = damaged.filter((record) => record.destroyed);

    if (compiled) {
      this.history.record({
        template: compiled.template.id,
        zoneId: compiled.zone.id,
        intensity: compiled.template.intensity,
        weaponIds: compiled.actors.map((plan) => plan.weapon?.id).filter((id): id is string => !!id),
        weaponFamilies: compiled.actors.map((plan) => plan.weapon?.family).filter((family) => !!family) as never,
        enemyKinds: compiled.actors.map((plan) => plan.enemyKind).filter((kind): kind is string => !!kind),
        destroyedRocks: destroyed.length,
        usedLoadoutFocus: compiled.actors.some((plan) => (plan.weapon?.weight ?? 0) > 1),
        atMs: this.clockMs,
      });
    }

    this.abortSequence();

    // Der Inspector erscheint nur, wenn wirklich ein Fels zerstört wurde. Reine Schäden
    // triggern ihn nicht – dann bleiben sie bis zur nächsten Zerstörung stehen.
    if (destroyed.length > 0) {
      this.history.recordInspectorAppearance(this.clockMs);
      this.deps.inspector.begin(damaged);
      this.phase = 'repair';
      return;
    }

    this.enterQuiet();
  }

  private abortSequence(): void {
    for (const entry of this.running) this.deps.actors.remove(entry.actor.id);
    this.running = [];
    this.sequence = null;
    this.deps.combat.leaveZone();
  }

  /**
   * Ruhephase bis zur nächsten Sequenz.
   *
   * Bei niedriger Grafikqualität wird sie gestreckt: Die Inszenierung ist Dekoration und darf
   * ein schwaches Gerät nicht dauerhaft belasten. Mechanik und Trefferlogik bleiben identisch –
   * es gibt keine zweite, sparsamere Implementierung.
   */
  private enterQuiet(): void {
    this.phase = 'quiet';
    const span = QUIET_MIN_MS + Math.floor(this.deps.rng() * (QUIET_MAX_MS - QUIET_MIN_MS));
    this.phaseEndsAtMs = this.clockMs + Math.round(span * quietStretchFor(getStoredGraphicsQuality()));
  }

  // ── Actor-Steuerung ────────────────────────────────────────────────────────

  private updateActor(entry: RunningActor): void {
    const { actor } = entry;
    if (!actor.isAlive()) return;

    // Sichtbar wird er erst, wenn er die Arenafläche wirklich betreten hat.
    if (!actor.visible && this.deps.world.containsWorldPoint(actor.x, actor.y)) {
      actor.setStageVisible(true);
    }

    if (actor.needsRepath(this.deps.world.getTopologyVersion())) {
      const target = actor.getPathTarget();
      if (target) this.planPath(actor, target.x, target.y);
    }

    const opponent = this.pickOpponent(entry);
    // ASMD-Kombination: Sobald der eigene Ball fliegt, richtet sich der Actor auf ihn aus –
    // die Primärwaffe zündet ihn, sie schiesst nicht am Ziel vorbei.
    const ball = entry.secondary ? this.deps.combat.findOwnDetonable(actor.id, ASMD_BALL_TAG) : null;
    if (ball) {
      actor.aimAt(ball.x, ball.y);
    } else if (opponent) {
      actor.aimAt(opponent.x, opponent.y);
    } else {
      // Ohne Gegner blickt die Figur dorthin, wohin sie läuft – sonst schiebt sie sich
      // seitwärts oder rückwärts über die Fläche.
      const heading = actor.getMovementAngle();
      if (heading !== null) actor.setAimAngle(heading);
    }

    if (this.clockMs >= entry.nextRetargetAtMs) {
      entry.nextRetargetAtMs = this.clockMs + RETARGET_INTERVAL_MS;
      if (!actor.hasPath()) this.planNextLeg(entry);
    }

    if (!entry.weapon) return;
    if (this.clockMs < entry.nextShotAtMs) return;

    // Der Ball ist das Ziel des zweiten Schusses; auf ihn braucht es keine Sichtlinienprüfung
    // gegen den Gegner.
    if (ball) {
      this.fireWeapon(entry, ball.x, ball.y);
      return;
    }
    if (!opponent) return;
    if (!this.deps.world.geometry.hasLineOfSight(actor.x, actor.y, opponent.x, opponent.y)) return;

    this.fireWeapon(entry, opponent.x, opponent.y);
  }

  /**
   * Wählt die Waffe des Schusses.
   *
   * Die echten `WeaponConfig`-Werte bleiben Choreographie-Metadaten: Die Primärwaffe darf
   * mehrfach feuern, eine teure Sekundärwaffe typischerweise nur ein- bis zweimal, und das
   * Cooldown-Verhältnis zwischen beiden bleibt glaubwürdig. Simuliert wird dabei nichts –
   * weder Adrenalin noch Munition noch Rage.
   */
  private fireWeapon(entry: RunningActor, targetX: number, targetY: number): void {
    const { actor } = entry;
    // Die ASMD-Kombination ist die einzige Zwei-Waffen-Ausnahme: Erst fliegt der echte Ball,
    // danach richtet derselbe Actor die Primärwaffe darauf aus.
    const useSecondary = entry.secondary !== null && entry.shotsFired > 0;
    const weapon = useSecondary ? entry.secondary! : entry.weapon!;

    const muzzle = actor.getMuzzleOrigin();
    this.fire.fire(weapon, {
      x: muzzle.x,
      y: muzzle.y,
      visualMuzzleOrigin: actor.getVisualMuzzleOrigin() ?? undefined,
      angle: actor.getAimAngle(),
      targetX,
      targetY,
      ownerId: actor.id,
      ownerColor: actor.color,
      sourceSlot: 'weapon1',
    });

    entry.shotsFired += 1;
    // Nach dem Sekundärschuss muss der Ball erst sichtbar fliegen, bevor die Primärwaffe
    // ausgerichtet wird und zündet.
    entry.nextShotAtMs = this.clockMs + (entry.secondary && !useSecondary
      ? ASMD_BALL_FLIGHT_MS
      : Math.max(120, weapon.cooldown));
  }

  private pickOpponent(entry: RunningActor): LobbyAmbientActor | null {
    let best: LobbyAmbientActor | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of this.deps.actors.opponentsOf(entry.actor)) {
      const distance = Math.hypot(candidate.x - entry.actor.x, candidate.y - entry.actor.y);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = candidate;
    }
    return best;
  }

  /** Nach dem Bewegungsziel geht es in Deckung, danach zum Exitpunkt. */
  private planNextLeg(entry: RunningActor): void {
    const next = entry.shotsFired === 0 && entry.plan.cover
      ? entry.plan.cover
      : entry.plan.exit;
    const world = this.deps.world.cellToWorld(next.gridX, next.gridY);
    this.planPath(entry.actor, world.x, world.y);
  }

  /**
   * Setzt den Actor unsichtbar hinter die nächste Arenakante und lässt ihn hineinlaufen.
   *
   * Findet sich keine freie Randzelle, beginnt er direkt an seiner Startposition – ein
   * unmöglicher Auftritt ist kein Grund, die Sequenz fallenzulassen.
   */
  private enterFromOffstage(
    actor: LobbyAmbientActor,
    spawnCell: { gridX: number; gridY: number },
    target: { x: number; y: number },
  ): void {
    const edge = this.deps.world.findStageEdgeCell(spawnCell);
    if (!edge) {
      this.planPath(actor, target.x, target.y);
      return;
    }

    const edgeWorld = this.deps.world.cellToWorld(edge.gridX, edge.gridY);
    const frame = this.deps.world.getWorldFrame();
    const outward = {
      x: edgeWorld.x + Math.sign(edgeWorld.x - (frame.offsetX + frame.width / 2)) * OFFSTAGE_MARGIN_PX,
      y: edgeWorld.y + Math.sign(edgeWorld.y - (frame.offsetY + frame.height / 2)) * OFFSTAGE_MARGIN_PX,
    };

    actor.teleportTo(outward.x, outward.y);
    actor.setStageVisible(false);
    actor.snapAimAngle(Math.atan2(edgeWorld.y - outward.y, edgeWorld.x - outward.x));

    const inbound = this.deps.navigation.findPath(edgeWorld.x, edgeWorld.y, target.x, target.y);
    actor.setPath([edgeWorld, ...(inbound ?? [])], this.deps.world.getTopologyVersion());
  }

  /**
   * Weg zum Exitpunkt und von dort über die Arenakante hinaus.
   *
   * Liefert die Gehstrecke in Pixeln, oder `null`, wenn es keinen Weg hinaus gibt – dann
   * bleibt nur das Eingraben.
   */
  private planExitPath(actor: LobbyAmbientActor, exitCell: { gridX: number; gridY: number }): number | null {
    // Der geplante Exitpunkt bestimmt nur noch die *Richtung* des Abgangs, nicht die Route.
    // Ihn als Zwischenstation abzulaufen ergab einen sichtbaren Knick mitten auf der Fläche.
    const edge = this.deps.world.findStageEdgeCell(exitCell);
    if (!edge) return null;

    const edgeWorld = this.deps.world.cellToWorld(edge.gridX, edge.gridY);
    const toEdge = this.deps.navigation.findPath(actor.x, actor.y, edgeWorld.x, edgeWorld.y);
    if (!toEdge) return null;

    const frame = this.deps.world.getWorldFrame();
    const waypoints = [...toEdge, {
      x: edgeWorld.x + Math.sign(edgeWorld.x - (frame.offsetX + frame.width / 2)) * OFFSTAGE_MARGIN_PX,
      y: edgeWorld.y + Math.sign(edgeWorld.y - (frame.offsetY + frame.height / 2)) * OFFSTAGE_MARGIN_PX,
    }];
    actor.setPath(waypoints, this.deps.world.getTopologyVersion());

    let distance = 0;
    let fromX = actor.x;
    let fromY = actor.y;
    for (const point of waypoints) {
      distance += Math.hypot(point.x - fromX, point.y - fromY);
      fromX = point.x;
      fromY = point.y;
    }
    return distance;
  }

  private planPath(actor: LobbyAmbientActor, targetX: number, targetY: number): void {
    const path = this.deps.navigation.findPath(actor.x, actor.y, targetX, targetY);
    if (!path) {
      actor.clearPath();
      return;
    }
    actor.setPath(path, this.deps.world.getTopologyVersion());
  }
}
