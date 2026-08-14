import type * as Phaser from 'phaser';
import { PLAYER_SIZE, ROCK_HP_MAX } from '../config';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { PlaceableRockUtilityConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { LightingSystem } from '../effects/LightingSystem';
import type { EffectSystem } from '../effects/EffectSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import { WeaponFireExecutor } from '../loadout/WeaponFireExecutor';
import type { AmbientActorRegistry } from './AmbientActorRegistry';
import { AMBIENT_AUDIO_VOLUME_SCALE, type AmbientCombatWorld, type AmbientRockDamageRecord } from './AmbientCombatWorld';
import { LobbyAmbientActor } from './LobbyAmbientActor';
import type { LobbyNavigation, NavCell } from './LobbyNavigation';
import type { LobbyObstacleWorld } from './LobbyObstacleWorld';

/** Neutraler Glow – der Inspector trägt bewusst keine Sonderfarbe. */
const INSPECTOR_GLOW = 0xb9c4cf;
const INSPECTOR_MOVE_SPEED = 165;
/** Pause zwischen zwei sichtbaren Neubauten. */
const REBUILD_PAUSE_MIN_MS = 250;
const REBUILD_PAUSE_MAX_MS = 450;
/** Reparaturmenge je Strahlpuls; entspricht dem `healPerHit` des Plasmabrenners. */
const REPAIR_PER_PULSE = 10;
/** Wie oft der Strahl pulst. */
const REPAIR_PULSE_INTERVAL_MS = 120;
/** Sicherheitsnetz gegen einen Auftrag, der sich nicht abarbeiten lässt. */
const TASK_TIMEOUT_MS = 6_000;

type InspectorTaskKind = 'repair' | 'rebuild';

interface InspectorTask {
  kind:   InspectorTaskKind;
  rockId: number;
}

/**
 * Inspector Gadachs.
 *
 * Erscheint ausschliesslich, wenn mindestens ein Ambient-Fels **vollständig zerstört** wurde.
 * Nur beschädigte Felsen holen ihn nicht; kommt er aber ohnehin, repariert er sie mit.
 *
 * Keine Sonderfarbe, keine Namensplakette, keine Aura, keine Spezialtextur – ihn
 * identifizieren seine Handlungen. Er benutzt den echten Plasmabrenner und den echten
 * ROCK_BARRIER-Weg; zerstörte Felsen lassen sich nicht per Strahl wiederbeleben, sie brauchen
 * einen sichtbaren Neubau.
 */
export class LobbyInspector {
  private actor: LobbyAmbientActor | null = null;
  private queue: InspectorTask[] = [];
  private current: InspectorTask | null = null;
  private waitMs = 0;
  private taskElapsedMs = 0;
  private nextPulseInMs = 0;

  private readonly repairWeapon = WEAPON_CONFIGS.PLASMA_BURNER as WeaponConfig;
  private readonly buildConfig = UTILITY_CONFIGS.ROCK_BARRIER as PlaceableRockUtilityConfig;
  private readonly fire: WeaponFireExecutor;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: LobbyObstacleWorld,
    private readonly navigation: LobbyNavigation,
    private readonly actors: AmbientActorRegistry,
    private readonly combat: AmbientCombatWorld,
    private readonly effects: EffectSystem,
    private readonly audio: GameAudioSystem,
    private readonly lighting: LightingSystem | null,
    private readonly rng: () => number,
  ) {
    this.fire = new WeaponFireExecutor(combat);
  }

  isBusy(): boolean {
    return this.actor !== null;
  }

  /** Wie viele Aufträge noch offen sind – auch ein Ausreißer wird vollständig abgearbeitet. */
  pendingTaskCount(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  /**
   * Nimmt den Auftrag einer beendeten Sequenz an.
   *
   * Zerstörte Felsen werden zuerst neu gebaut – sie sind die Lücken im Bild – danach werden
   * die verbliebenen Schäden repariert.
   */
  begin(damaged: readonly AmbientRockDamageRecord[]): void {
    const destroyed = damaged.filter((record) => record.destroyed);
    if (destroyed.length === 0) return;

    this.queue = [
      ...destroyed.map((record): InspectorTask => ({ kind: 'rebuild', rockId: record.rockId })),
      ...damaged
        .filter((record) => !record.destroyed)
        .map((record): InspectorTask => ({ kind: 'repair', rockId: record.rockId })),
    ];

    this.spawnActor();
    this.advance();
  }

  /**
   * Ein Frame Inspector-Arbeit. Gibt `true` zurück, solange noch etwas zu tun ist.
   *
   * Vor Abschluss startet keine neue Combat-Sequenz – der Director wartet auf dieses `false`.
   */
  update(deltaMs: number): boolean {
    if (!this.actor) return false;
    this.actor.update(deltaMs);

    if (this.waitMs > 0) {
      this.waitMs -= deltaMs;
      return true;
    }

    const task = this.current;
    if (!task) return false;

    this.taskElapsedMs += deltaMs;
    const cell = this.world.getWorkCell(task.rockId);
    if (!cell) {
      this.completeTask();
      return true;
    }

    const target = this.world.cellToWorld(cell.gridX, cell.gridY);
    this.actor.aimAt(target.x, target.y);

    const inRange = Math.hypot(this.actor.x - target.x, this.actor.y - target.y)
      <= (task.kind === 'rebuild' ? this.buildConfig.placeable.range : this.repairWeapon.range);
    if (!inRange) {
      // Der Weg kann sich unter ihm ändern; ein abgelaufener Auftrag wird verworfen statt
      // die Reparaturphase endlos offen zu halten.
      if (this.taskElapsedMs > TASK_TIMEOUT_MS) this.completeTask();
      return true;
    }

    if (task.kind === 'rebuild') this.performRebuild(task.rockId, target);
    else this.performRepair(task.rockId, deltaMs, target);
    return true;
  }

  /** Bricht die Arbeit ab und entfernt den Inspector. */
  abort(): void {
    if (this.actor) this.actors.remove(this.actor.id);
    this.actor = null;
    this.queue = [];
    this.current = null;
    this.waitMs = 0;
  }

  // ── Intern ─────────────────────────────────────────────────────────────────

  private spawnActor(): void {
    if (this.actor) return;
    // Auftritt von der nächsten Arenakante beim ersten Auftrag, nicht aus dem Nichts mitten
    // im Bild.
    const firstTask = this.queue[0];
    const firstCell = firstTask ? this.world.getWorkCell(firstTask.rockId) : null;
    const edge = firstCell ? this.world.findStageEdgeCell(firstCell) : null;
    const start = edge
      ? this.world.cellToWorld(edge.gridX, edge.gridY)
      : this.world.cellToWorld(0, 0);
    this.actor = new LobbyAmbientActor(this.scene, {
      id: 'ambient_inspector',
      team: 'badger',
      x: start.x,
      y: start.y,
      aimAngle: 0,
      hp: PLAYER_SIZE * 3,
      moveSpeed: INSPECTOR_MOVE_SPEED,
      weaponId: this.repairWeapon.id,
      glowColor: INSPECTOR_GLOW,
    }, this.lighting);
    this.actors.add(this.actor);
  }

  /**
   * Nimmt den nächsten ausführbaren Auftrag auf.
   *
   * Bewusst eine Schleife statt Rekursion über `completeTask`: Eine Warteschlange, in der
   * viele Aufträge nacheinander unausführbar sind, würde den Stapel sonst tief schachteln.
   */
  private advance(): void {
    this.taskElapsedMs = 0;
    this.nextPulseInMs = 0;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      const cell = this.world.getWorkCell(task.rockId);
      if (!cell || !this.actor) continue;

      // Arbeitsposition: freie Zelle in echter Werkzeugreichweite. Ohne eine solche Position
      // ist der Auftrag nicht ausführbar.
      const workCell = this.navigation.findNearestFreeCell(cell.gridX, cell.gridY, 5);
      if (!workCell) continue;

      this.current = task;
      const workWorld = this.world.cellToWorld(workCell.gridX, workCell.gridY);
      const path = this.navigation.findPath(this.actor.x, this.actor.y, workWorld.x, workWorld.y);
      if (path) this.actor.setPath(path, this.world.getTopologyVersion());
      else this.actor.clearPath();
      return;
    }

    this.current = null;
    this.abort();
  }

  private performRepair(rockId: number, deltaMs: number, target: { x: number; y: number }): void {
    this.nextPulseInMs -= deltaMs;
    if (this.nextPulseInMs > 0) return;
    this.nextPulseInMs = REPAIR_PULSE_INTERVAL_MS;

    // Echter Plasmabrenner über den gemeinsamen Fire-Pfad; die Strahldarstellung entsteht
    // dadurch genauso wie im Gameplay.
    this.fire.fire(this.repairWeapon, {
      x: this.actor!.x,
      y: this.actor!.y,
      angle: this.actor!.getAimAngle(),
      targetX: target.x,
      targetY: target.y,
      ownerId: this.actor!.id,
      ownerColor: INSPECTOR_GLOW,
      sourceSlot: 'weapon2',
    });

    const healed = this.combat.repairRock(rockId, REPAIR_PER_PULSE);
    const full = this.combat.rockHp.getHP(rockId) >= this.combat.rockHp.getMaxHP(rockId);
    if (healed <= 0 || full) this.completeTask();
  }

  private performRebuild(rockId: number, target: { x: number; y: number }): void {
    // Zerstörte Felsen dürfen keinen Actor einschliessen – lieber später noch einmal.
    const cell = this.world.getWorkCell(rockId);
    const others = this.actors.all()
      .filter((actor) => actor.id !== this.actor?.id)
      .map((actor) => ({ x: actor.x, y: actor.y }));
    if (cell && !this.navigation.isRebuildSafe(cell.gridX, cell.gridY, others)) {
      if (this.taskElapsedMs > TASK_TIMEOUT_MS) this.completeTask();
      return;
    }

    // Neutraler Landschaftsfels: kein Besitzer-Tint, kein 200-HP-Konstrukt, keine Laufzeit.
    this.combat.restoreRock(rockId);
    void ROCK_HP_MAX;
    this.audio.playSound('sfx_place_rock', target.x, target.y, undefined, AMBIENT_AUDIO_VOLUME_SCALE);
    this.effects.playShockwaveEffect(target.x, target.y);

    this.completeTask();
    // Zwischen sichtbaren Neubauten eine kurze Pause, sonst wirkt das Aufräumen hektisch.
    this.waitMs = REBUILD_PAUSE_MIN_MS + this.rng() * (REBUILD_PAUSE_MAX_MS - REBUILD_PAUSE_MIN_MS);
  }

  private completeTask(): void {
    this.current = null;
    this.advance();
  }
}
