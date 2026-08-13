import { CELL_SIZE } from '../config';
import type { CoopDefenseEnemyKind } from '../config/coopDefenseEnemies';
import {
  getAmbientTemplate,
  resolveRockDestructionBudget,
  type AmbientTemplate,
  type AmbientTemplateId,
} from './AmbientSequenceCatalog';
import type { AmbientSequenceHistory } from './AmbientSequenceHistory';
import {
  buildAmbientWeaponPool,
  pickAmbientWeapon,
  type AmbientWeaponEntry,
} from './AmbientWeaponPool';
import { AMBIENT_ZONES, type AmbientZone } from './AmbientZones';
import { isLobbyUiReservedCell } from '../arena/MenuArenaPreviewConfig';
import type { LobbyNavigation, NavCell } from './LobbyNavigation';
import type { LobbyObstacleWorld } from './LobbyObstacleWorld';
import type { LobbyZoneRect } from './LobbyRockBodyPool';

/** Gegner, die V5 aktiv kämpfend zeigt. */
export const AMBIENT_ENEMY_KINDS: readonly CoopDefenseEnemyKind[] = [
  'zombie-badger',
  'demon-badger',
  'rabid-badger',
];

export interface CompiledActorPlan {
  id:        string;
  team:      'badger' | 'enemy';
  spawn:     NavCell;
  /** Wohin sich der Actor bewegt, während die Sequenz läuft. */
  moveTo:    NavCell;
  /** Wo er die Bühne verlässt. */
  exit:      NavCell;
  /** Deckung, hinter die er zwischen den Schüssen zurückgeht. */
  cover:     NavCell | null;
  weapon:    AmbientWeaponEntry | null;
  /** Zweite Waffe – ausschliesslich die ASMD-Kombination. */
  secondaryWeaponId: string | null;
  enemyKind: CoopDefenseEnemyKind | null;
}

export interface CompiledSequence {
  template:   AmbientTemplate;
  zone:       AmbientZone;
  /** Weltausschnitt für die Kollisionskörper der Zone. */
  zoneRect:   LobbyZoneRect;
  actors:     CompiledActorPlan[];
  durationMs: number;
  /** Geplantes Zerstörungsbudget – Planungsregel, keine Garantie. */
  rockBudget: readonly [number, number];
}

export interface AmbientCompileContext {
  world:      LobbyObstacleWorld;
  navigation: LobbyNavigation;
  history:    AmbientSequenceHistory;
  /** Aktuell gewählte weapon1/weapon2 des lokalen Spielers. */
  selectedWeaponIds: readonly (string | null | undefined)[];
  nowMs:      number;
  rng:        () => number;
}

/** Mindestabstand zwischen den Startpositionen der beiden Seiten. */
const MIN_ENGAGEMENT_DISTANCE_CELLS = 5;
/** Verbündete starten weit auseinander, weil Figuren untereinander nicht kollidieren. */
const MIN_ALLY_SEPARATION_CELLS = 12;
/** Gegner dürfen näher stehen; sie sollen sich ja treffen. */
const MIN_OPPONENT_SEPARATION_CELLS = 3;

interface TakenSpawn {
  cell: NavCell;
  team: 'badger' | 'enemy';
}
/** So viele Versuche pro Zone, bevor der Compiler den Plan verwirft. */
const PLACEMENT_ATTEMPTS = 24;
/**
 * Ab so vielen freien Zellen taugt eine Zone als Bühne. Darunter stünde jeder Actor sofort
 * in der Wand.
 */
const MIN_ZONE_FREE_CELLS = 18;

/**
 * Löst ein semantisches Template in einen konkreten, spielbaren Plan auf.
 *
 * Alles Wesentliche wird **vor** dem Start entschieden: Zone, Actors, Gegner, Waffen,
 * Startpositionen, Deckung, Bewegungsziele, Schusskorridore, Exitpunkte und das erwartete
 * Zerstörungsbudget. Zur Laufzeit bleibt damit wenig Zufall.
 *
 * Ein Plan, der sich gegen die tatsächliche Felslandschaft nicht auflösen lässt, wird
 * verworfen statt zurechtgebogen – der Director wählt dann ein anderes Template.
 */
export class AmbientSequenceCompiler {
  private nextActorSerial = 0;

  compile(templateId: AmbientTemplateId, context: AmbientCompileContext): CompiledSequence | null {
    const template = getAmbientTemplate(templateId);
    const zone = this.pickZone(template, context);
    if (!zone) return null;

    const freeCells = this.collectFreeCells(zone, context.world);
    if (freeCells.length < MIN_ZONE_FREE_CELLS) return null;

    const pool = buildAmbientWeaponPool(context.selectedWeaponIds);
    const badgerCount = randomIntInRange(context.rng, template.badgers);
    const enemyCount = randomIntInRange(context.rng, template.enemies);
    if (badgerCount + enemyCount === 0) return null;

    const actors: CompiledActorPlan[] = [];
    const taken: TakenSpawn[] = [];

    for (let index = 0; index < badgerCount; index += 1) {
      const plan = this.planActor('badger', template, zone, freeCells, taken, pool, context);
      if (!plan) return null;
      actors.push(plan);
      taken.push({ cell: plan.spawn, team: 'badger' });
    }

    for (let index = 0; index < enemyCount; index += 1) {
      const plan = this.planActor('enemy', template, zone, freeCells, taken, pool, context);
      if (!plan) return null;
      actors.push(plan);
      taken.push({ cell: plan.spawn, team: 'enemy' });
    }

    if (template.requiresLineOfSight && !this.hasEngagementLine(actors, context)) return null;
    if (template.rockHazard === 'high' && !this.hasRoomForBlast(actors, context)) return null;

    return {
      template,
      zone,
      zoneRect: this.toWorldRect(zone, context.world),
      actors,
      durationMs: randomIntInRange(context.rng, template.durationMs),
      rockBudget: resolveRockDestructionBudget(template.rockHazard),
    };
  }

  // ── Zone ───────────────────────────────────────────────────────────────────

  private pickZone(template: AmbientTemplate, context: AmbientCompileContext): AmbientZone | null {
    const weighted = AMBIENT_ZONES
      .map((zone) => ({ zone, weight: context.history.zonePenalty(zone.id) }))
      .filter(({ zone }) => this.collectFreeCells(zone, context.world).length >= MIN_ZONE_FREE_CELLS);
    if (weighted.length === 0) return null;
    void template;

    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = context.rng() * total;
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) return entry.zone;
    }
    return weighted[weighted.length - 1].zone;
  }

  /**
   * Freie Zellen einer Zone.
   *
   * Die Sperrflächen der Oberfläche werden hier ein zweites Mal geprüft, obwohl die Zonen sie
   * bereits aussparen: Ein Gefecht hinter einem Menü ist der auffälligste Fehler, den diese
   * Inszenierung machen kann, und ein verschobener Zonenrand darf ihn nicht zurückbringen.
   */
  private collectFreeCells(zone: AmbientZone, world: LobbyObstacleWorld): NavCell[] {
    const cells: NavCell[] = [];
    for (let gridY = zone.minGridY; gridY <= zone.maxGridY; gridY += 1) {
      for (let gridX = zone.minGridX; gridX <= zone.maxGridX; gridX += 1) {
        if (world.isCellBlocked(gridX, gridY)) continue;
        if (isLobbyUiReservedCell(gridX, gridY)) continue;
        cells.push({ gridX, gridY });
      }
    }
    return cells;
  }

  private toWorldRect(zone: AmbientZone, world: LobbyObstacleWorld): LobbyZoneRect {
    const topLeft = world.cellToWorld(zone.minGridX, zone.minGridY);
    const bottomRight = world.cellToWorld(zone.maxGridX, zone.maxGridY);
    return {
      left:   topLeft.x - CELL_SIZE / 2,
      top:    topLeft.y - CELL_SIZE / 2,
      right:  bottomRight.x + CELL_SIZE / 2,
      bottom: bottomRight.y + CELL_SIZE / 2,
    };
  }

  // ── Actor ──────────────────────────────────────────────────────────────────

  private planActor(
    team: 'badger' | 'enemy',
    template: AmbientTemplate,
    zone: AmbientZone,
    freeCells: readonly NavCell[],
    taken: readonly TakenSpawn[],
    pool: readonly AmbientWeaponEntry[],
    context: AmbientCompileContext,
  ): CompiledActorPlan | null {
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
      const spawn = freeCells[Math.floor(context.rng() * freeCells.length)];
      if (!spawn) continue;
      // Figuren kollidieren untereinander nicht. Zwei Verbündete dicht nebeneinander liefen
      // deshalb sichtbar ineinander – sie starten weit auseinander oder gar nicht.
      const tooClose = taken.some(({ cell, team: otherTeam }) => cellDistance(cell, spawn)
        < (otherTeam === team ? MIN_ALLY_SEPARATION_CELLS : MIN_OPPONENT_SEPARATION_CELLS));
      if (tooClose) continue;

      const moveTo = this.pickReachable(spawn, freeCells, context, 3);
      if (!moveTo) continue;
      const exit = this.pickEdgeCell(zone, freeCells, context, spawn);
      if (!exit) continue;
      if (!context.navigation.findPath(
        ...this.worldPair(spawn, moveTo, context.world),
      )) continue;

      return {
        id: `ambient_${team}_${this.nextActorSerial++}`,
        team,
        spawn,
        moveTo,
        exit,
        cover: this.findCoverNear(moveTo, context),
        weapon: team === 'badger' ? this.pickWeapon(template, pool, context) : null,
        secondaryWeaponId: team === 'badger' && template.id === 'asmd_combo' ? 'ASMD_PRIM' : null,
        enemyKind: team === 'enemy' ? this.pickEnemyKind(context) : null,
      };
    }
    return null;
  }

  /**
   * Waffenwahl. Fordert das Template eine Familie, gilt nur sie; sonst entscheidet der
   * gewichtete Pool, in dem Anti-Repetition vor der Loadout-Gewichtung steht.
   */
  private pickWeapon(
    template: AmbientTemplate,
    pool: readonly AmbientWeaponEntry[],
    context: AmbientCompileContext,
  ): AmbientWeaponEntry | null {
    if (template.id === 'asmd_combo') {
      return pool.find((entry) => entry.id === 'ASMD_SEC') ?? null;
    }
    const candidates = template.weaponFamily
      ? pool.filter((entry) => entry.family === template.weaponFamily)
      : pool;
    return pickAmbientWeapon(candidates, context.rng, (entry) => context.history.weaponPenalty(entry));
  }

  private pickEnemyKind(context: AmbientCompileContext): CoopDefenseEnemyKind {
    const weighted = AMBIENT_ENEMY_KINDS.map((kind) => ({ kind, weight: context.history.enemyPenalty(kind) }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = context.rng() * total;
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) return entry.kind;
    }
    return AMBIENT_ENEMY_KINDS[AMBIENT_ENEMY_KINDS.length - 1];
  }

  private pickReachable(
    from: NavCell,
    freeCells: readonly NavCell[],
    context: AmbientCompileContext,
    minDistance: number,
  ): NavCell | null {
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
      const candidate = freeCells[Math.floor(context.rng() * freeCells.length)];
      if (!candidate || cellDistance(from, candidate) < minDistance) continue;
      return candidate;
    }
    return null;
  }

  /** Exitpunkt: möglichst weit aussen, damit der Actor die Bühne sichtbar verlässt. */
  private pickEdgeCell(
    zone: AmbientZone,
    freeCells: readonly NavCell[],
    context: AmbientCompileContext,
    away: NavCell,
  ): NavCell | null {
    let best: NavCell | null = null;
    let bestScore = -1;
    for (const cell of freeCells) {
      const edgeDistance = Math.min(
        cell.gridX - zone.minGridX,
        zone.maxGridX - cell.gridX,
        cell.gridY - zone.minGridY,
        zone.maxGridY - cell.gridY,
      );
      const score = cellDistance(away, cell) - edgeDistance * 2 + context.rng();
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    return best;
  }

  /** Nächste freie Zelle, die an einen Fels grenzt – dort lässt sich Deckung nehmen. */
  private findCoverNear(cell: NavCell, context: AmbientCompileContext): NavCell | null {
    for (let radius = 1; radius <= 4; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const candidate = { gridX: cell.gridX + dx, gridY: cell.gridY + dy };
          if (!context.navigation.isCellFree(candidate.gridX, candidate.gridY)) continue;
          if (!this.touchesRock(candidate, context)) continue;
          return candidate;
        }
      }
    }
    return null;
  }

  private touchesRock(cell: NavCell, context: AmbientCompileContext): boolean {
    return context.world.isRockCellWithBorder(cell.gridX + 1, cell.gridY)
      || context.world.isRockCellWithBorder(cell.gridX - 1, cell.gridY)
      || context.world.isRockCellWithBorder(cell.gridX, cell.gridY + 1)
      || context.world.isRockCellWithBorder(cell.gridX, cell.gridY - 1);
  }

  // ── Plausibilität ──────────────────────────────────────────────────────────

  /** Mindestens ein Paar gegnerischer Actors braucht eine freie Schusslinie. */
  private hasEngagementLine(actors: readonly CompiledActorPlan[], context: AmbientCompileContext): boolean {
    for (const attacker of actors) {
      for (const target of actors) {
        if (attacker.team === target.team) continue;
        if (cellDistance(attacker.spawn, target.spawn) < MIN_ENGAGEMENT_DISTANCE_CELLS) continue;
        const from = context.world.cellToWorld(attacker.spawn.gridX, attacker.spawn.gridY);
        const to = context.world.cellToWorld(target.spawn.gridX, target.spawn.gridY);
        if (context.world.geometry.hasLineOfSight(from.x, from.y, to.x, to.y)) return true;
      }
    }
    return false;
  }

  /**
   * Verwirft offensichtlich unpassende Pläne, etwa eine grosse Explosion mitten in einer
   * massiven Felsfläche: Dort wäre die Wirkung nicht zu sehen, und das Zerstörungsbudget
   * wäre sofort gesprengt.
   */
  private hasRoomForBlast(actors: readonly CompiledActorPlan[], context: AmbientCompileContext): boolean {
    for (const actor of actors) {
      let free = 0;
      let total = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          total += 1;
          if (!context.world.isCellBlocked(actor.moveTo.gridX + dx, actor.moveTo.gridY + dy)) free += 1;
        }
      }
      if (free / total >= 0.5) return true;
    }
    return false;
  }

  private worldPair(
    from: NavCell,
    to: NavCell,
    world: LobbyObstacleWorld,
  ): [number, number, number, number] {
    const start = world.cellToWorld(from.gridX, from.gridY);
    const end = world.cellToWorld(to.gridX, to.gridY);
    return [start.x, start.y, end.x, end.y];
  }
}

function cellDistance(a: NavCell, b: NavCell): number {
  return Math.max(Math.abs(a.gridX - b.gridX), Math.abs(a.gridY - b.gridY));
}

function randomIntInRange(rng: () => number, range: readonly [number, number]): number {
  const [min, max] = range;
  return min + Math.floor(rng() * (max - min + 1));
}
