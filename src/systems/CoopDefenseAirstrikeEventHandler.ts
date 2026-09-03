import {
  CELL_SIZE,
} from '../config';
import { getCoopDefenseTutorialRockRegion } from '../config/coopDefenseTutorial';
import { ULTIMATE_CONFIGS, type AirstrikeUltimateConfig } from '../loadout/LoadoutConfig';
import type {
  CoopDefenseMapAirstrikeArea,
  CoopDefenseMapAirstrikeEventConfig,
  ResolvedCoopDefenseMapEventConfig,
} from '../config/coopDefenseMaps';
import type {
  AirstrikeStrikeMetadata,
  AirstrikeStrikeResolution,
} from './AirstrikeSystem';
import type {
  CoopDefenseMapEventCycleFinished,
  CoopDefenseMapEventHandler,
} from './CoopDefenseMapEventDirector';
import { resolveCoopDefenseWorldMetrics, type WorldMetrics } from '../world/WorldMetrics';

export const COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID = 'coop-zombie-bomber';

const PLAYER_AIRSTRIKE = ULTIMATE_CONFIGS.AIRSTRIKE as AirstrikeUltimateConfig;

const TUTORIAL_SWEEP_STRIKE_CONFIG: AirstrikeUltimateConfig = {
  ...PLAYER_AIRSTRIKE,
  radius: 200,
  maxDamage: 400,
  minDamage: 150,
  rockDamageMult: 3,
  trainDamageMult: 0,
  friendlyBaseDamageMult: 1,
  skipEnemyDamage: true,
};

const MAP_AIRSTRIKE_STRIKE_CONFIG: AirstrikeUltimateConfig = {
  ...PLAYER_AIRSTRIKE,
  friendlyBaseDamageMult: 1,
  skipEnemyDamage: true,
};

const DEFAULT_TUTORIAL_STRIKE_COUNT_MIN = 7;
const DEFAULT_TUTORIAL_STRIKE_COUNT_MAX = 9;
const TUTORIAL_FIRST_STRIKE_OFFSET_MS = 0;
const TUTORIAL_MIN_GAP_MS = 280;
const TUTORIAL_MAX_GAP_MS = 540;
/** Map 11 soll beim Eröffnungs-Sweep auch den oberen Felsrand erreichen. */
const TUTORIAL_SWEEP_TOP_EXTENSION_CELLS = 3;
const ZONE_ORDERED_STRIKE_GAP_MS = 300;
const PLAYER_HUNT_MIN_OFFSET_PX = 60;
const PLAYER_HUNT_MAX_OFFSET_PX = 220;
const PLAYER_HUNT_BASE_AVOID_ATTEMPTS = 12;
const BASE_AVOID_MARGIN_PX = CELL_SIZE;
const ARENA_EDGE_MARGIN_PX = 40;

export interface PlannedAirstrikePoint {
  readonly x: number;
  readonly y: number;
  /** Relative launch offset inside the fixed pattern. */
  readonly launchOffsetMs: number;
}

export type AirstrikeRandom = () => number;

export interface CoopDefenseAirstrikeEventHandlerDeps {
  scheduleStrike(
    x: number,
    y: number,
    config: AirstrikeUltimateConfig,
    metadata: AirstrikeStrikeMetadata,
    armedAt: number,
  ): boolean | void;
  getAlivePlayerPositions(): readonly { x: number; y: number }[];
  isProtectedBasePoint(x: number, y: number): boolean;
  playStrikeAudio(x: number, y: number): void;
  readonly arenaWidthCells: number;
  readonly arenaHeightCells: number;
  /** World-Grenzen fuer die Positionierung authored Ereignisse. */
  readonly worldMetrics?: WorldMetrics;
  readonly tutorialShowControls?: boolean;
  readonly random?: AirstrikeRandom;
  readonly getNowMs: () => number;
}

interface ScheduledAirstrikeOccurrence {
  readonly event: CoopDefenseMapAirstrikeEventConfig;
  readonly occurrence: number;
  /** Rundenzeit des ersten Abwurfs; alle Plan-Offsets liegen relativ dazu. */
  readonly launchAtMs: number;
  plan: readonly PlannedAirstrikePoint[] | null;
  nextPlanIndex: number;
  acceptedStrikeCount: number;
  resolvedStrikeCount: number;
  audioPlayed: boolean;
}

/**
 * Host-adapter fuer authored Airstrike-Events. Die Map-Event-Schicht sieht nur den Handler-
 * Vertrag; Warnkreise, Einschlaege, Schaden und Snapshot bleiben im AirstrikeSystem.
 */
export class CoopDefenseAirstrikeEventHandler implements CoopDefenseMapEventHandler {
  readonly type = 'airstrike' as const;

  private readonly occurrences = new Map<string, ScheduledAirstrikeOccurrence>();
  /**
   * Letzte vom Director gemeldete Rundenzeit. `handleStrikeResolved` laeuft im selben Host-Frame,
   * aber ausserhalb des Director-Aufrufs und braucht dieselbe Uhr fuer den Completion-Zeitpunkt.
   */
  private roundTimeMs = 0;
  private onCycleFinished: ((completion: CoopDefenseMapEventCycleFinished) => void) | null = null;

  constructor(private readonly deps: CoopDefenseAirstrikeEventHandlerDeps) {}

  schedule(event: ResolvedCoopDefenseMapEventConfig, occurrence: number, actionAtMs: number): void {
    if (event.type !== 'airstrike') return;
    const key = getOccurrenceKey(event.id, occurrence);
    if (this.occurrences.has(key)) return;
    this.occurrences.set(key, {
      event,
      occurrence,
      launchAtMs: Math.max(0, Math.floor(actionAtMs)),
      plan: null,
      nextPlanIndex: 0,
      acceptedStrikeCount: 0,
      resolvedStrikeCount: 0,
      audioPlayed: false,
    });
  }

  hostUpdate(_deltaMs: number, countdownActive: boolean, roundTimeMs: number): void {
    if (countdownActive) return;
    this.roundTimeMs = roundTimeMs;
    for (const occurrence of [...this.occurrences.values()]) {
      this.updateOccurrence(occurrence, roundTimeMs);
    }
  }

  /** Wird vom AirstrikeSystem nach der echten Explosion aufgerufen. */
  handleStrikeResolved(resolution: AirstrikeStrikeResolution): void {
    const metadata = resolution.metadata;
    if (!metadata) return;
    const occurrence = this.occurrences.get(getOccurrenceKey(metadata.eventId, metadata.occurrence));
    if (!occurrence || occurrence.plan === null) return;
    occurrence.resolvedStrikeCount += 1;
    this.completeIfResolved(occurrence);
  }

  reset(): void {
    this.occurrences.clear();
    this.roundTimeMs = 0;
  }

  setCycleFinishedCallback(
    callback: ((completion: CoopDefenseMapEventCycleFinished) => void) | null,
  ): void {
    this.onCycleFinished = callback;
  }

  private updateOccurrence(occurrence: ScheduledAirstrikeOccurrence, roundTimeMs: number): void {
    if (occurrence.plan === null) {
      if (roundTimeMs < occurrence.launchAtMs) return;
      occurrence.plan = this.buildPlan(occurrence.event);
    }

    while (occurrence.nextPlanIndex < occurrence.plan.length) {
      const point = occurrence.plan[occurrence.nextPlanIndex];
      if (roundTimeMs < occurrence.launchAtMs + point.launchOffsetMs) break;
      occurrence.nextPlanIndex += 1;
      const accepted = this.deps.scheduleStrike(
        point.x,
        point.y,
        this.getStrikeConfig(occurrence.event.pattern),
        { eventId: occurrence.event.id, occurrence: occurrence.occurrence },
        this.deps.getNowMs(),
      );
      if (accepted === false) continue;
      occurrence.acceptedStrikeCount += 1;
      if (!occurrence.audioPlayed) {
        occurrence.audioPlayed = true;
        this.deps.playStrikeAudio(point.x, point.y);
      }
    }

    this.completeIfResolved(occurrence);
  }

  private completeIfResolved(occurrence: ScheduledAirstrikeOccurrence): void {
    if (occurrence.plan === null || occurrence.nextPlanIndex < occurrence.plan.length) return;
    if (occurrence.resolvedStrikeCount < occurrence.acceptedStrikeCount) return;
    const key = getOccurrenceKey(occurrence.event.id, occurrence.occurrence);
    if (!this.occurrences.delete(key)) return;

    const completedAtMs = Math.max(0, Math.floor(this.roundTimeMs));
    // Der Jagdrhythmus misst Abwurf zu Abwurf, nicht Einschlag zu Abwurf: Sonst verlaengert die
    // Vorwarnzeit des Airstrikes das authored Intervall bei jedem Durchlauf. Der Director klemmt
    // einen bereits verstrichenen Zeitpunkt selbst auf den Abschluss hoch.
    const nextActionAtMs = occurrence.event.pattern === 'player-hunt'
      ? occurrence.launchAtMs + occurrence.event.intervalMs!
      : undefined;
    this.onCycleFinished?.({
      eventId: occurrence.event.id,
      occurrence: occurrence.occurrence,
      completedAtMs,
      ...(nextActionAtMs === undefined ? {} : { nextActionAtMs }),
    });
  }

  private buildPlan(event: CoopDefenseMapAirstrikeEventConfig): readonly PlannedAirstrikePoint[] {
    const random = this.deps.random ?? Math.random;
    switch (event.pattern) {
      case 'tutorial-sweep':
        return planTutorialSweep(
          this.deps.arenaWidthCells,
          this.deps.arenaHeightCells,
          this.deps.tutorialShowControls === true,
          event.strikeCount,
          random,
          this.getWorldMetrics(),
        );
      case 'player-hunt': {
        const target = planPlayerHunt(
          this.deps.getAlivePlayerPositions(),
          this.deps.isProtectedBasePoint,
          this.deps.arenaWidthCells,
          this.deps.arenaHeightCells,
          random,
          this.getWorldMetrics(),
        );
        return target ? [{ ...target, launchOffsetMs: 0 }] : [];
      }
      case 'zone-barrage':
        return planZoneBarrage(
          event.area!,
          event.strikeCount!,
          event.orderedSweep === true,
          random,
          this.getWorldMetrics(),
        );
    }
  }

  private getWorldMetrics(): WorldMetrics {
    return this.deps.worldMetrics
      ?? resolveCoopDefenseWorldMetrics(this.deps.arenaWidthCells, this.deps.arenaHeightCells);
  }

  private getStrikeConfig(pattern: CoopDefenseMapAirstrikeEventConfig['pattern']): AirstrikeUltimateConfig {
    return pattern === 'tutorial-sweep' ? TUTORIAL_SWEEP_STRIKE_CONFIG : MAP_AIRSTRIKE_STRIKE_CONFIG;
  }
}

export function planTutorialSweep(
  arenaWidthCells: number,
  arenaHeightCells: number,
  showControls: boolean,
  authoredStrikeCount: number | undefined,
  random: AirstrikeRandom = Math.random,
  worldMetrics: WorldMetrics = resolveCoopDefenseWorldMetrics(arenaWidthCells, arenaHeightCells),
): readonly PlannedAirstrikePoint[] {
  const region = getCoopDefenseTutorialRockRegion(showControls);
  const minGridX = Math.max(0, Math.min(arenaWidthCells - 1, region.minGridX - 1));
  const maxGridX = Math.max(minGridX, Math.min(arenaWidthCells - 1, region.maxGridX + 1));
  const minGridY = Math.max(
    0,
    Math.min(arenaHeightCells - 1, region.minGridY - TUTORIAL_SWEEP_TOP_EXTENSION_CELLS),
  );
  const maxGridY = Math.max(minGridY, Math.min(arenaHeightCells - 1, region.maxGridY + 1));
  const strikeCount = authoredStrikeCount ?? randomInteger(
    DEFAULT_TUTORIAL_STRIKE_COUNT_MIN,
    DEFAULT_TUTORIAL_STRIKE_COUNT_MAX,
    random,
  );
  const points: PlannedAirstrikePoint[] = [];
  let launchOffsetMs = TUTORIAL_FIRST_STRIKE_OFFSET_MS;
  for (let index = 0; index < strikeCount; index += 1) {
    const sweep = strikeCount > 1 ? index / (strikeCount - 1) : 0.5;
    const x = clamp(
      worldMetrics.offsetX + (minGridX + 0.5 + sweep * (maxGridX - minGridX)) * CELL_SIZE
        + (sample(random) - 0.5) * CELL_SIZE * 2.5,
      worldMetrics.offsetX,
      worldMetrics.maxX,
    );
    const y = worldMetrics.offsetY + (minGridY + 0.2 + sample(random) * 0.8 * (maxGridY - minGridY + 1)) * CELL_SIZE;
    points.push({ x, y, launchOffsetMs });
    launchOffsetMs += TUTORIAL_MIN_GAP_MS
      + sample(random) * (TUTORIAL_MAX_GAP_MS - TUTORIAL_MIN_GAP_MS);
  }
  return points;
}

export function planZoneBarrage(
  area: CoopDefenseMapAirstrikeArea,
  strikeCount: number,
  orderedSweep: boolean,
  random: AirstrikeRandom = Math.random,
  worldMetrics: WorldMetrics = resolveCoopDefenseWorldMetrics(undefined, undefined),
): readonly PlannedAirstrikePoint[] {
  return Array.from({ length: strikeCount }, (_, index) => {
    const sweep = strikeCount > 1 ? index / (strikeCount - 1) : 0.5;
    const normalizedX = orderedSweep ? 0.08 + sweep * 0.84 : 0.08 + sample(random) * 0.84;
    const normalizedY = 0.08 + sample(random) * 0.84;
    return {
      x: worldMetrics.offsetX + (area.gridX + normalizedX * area.widthCells) * CELL_SIZE,
      y: worldMetrics.offsetY + (area.gridY + normalizedY * area.heightCells) * CELL_SIZE,
      launchOffsetMs: orderedSweep ? index * ZONE_ORDERED_STRIKE_GAP_MS : 0,
    };
  });
}

export function planPlayerHunt(
  players: readonly { x: number; y: number }[],
  isProtectedBasePoint: (x: number, y: number) => boolean,
  arenaWidthCells: number,
  arenaHeightCells: number,
  random: AirstrikeRandom = Math.random,
  worldMetrics: WorldMetrics = resolveCoopDefenseWorldMetrics(arenaWidthCells, arenaHeightCells),
): { x: number; y: number } | null {
  if (players.length === 0) return null;
  const anchor = players[Math.min(players.length - 1, Math.floor(sample(random) * players.length))];
  let candidate = { x: anchor.x, y: anchor.y };
  for (let attempt = 0; attempt < PLAYER_HUNT_BASE_AVOID_ATTEMPTS; attempt += 1) {
    const angle = sample(random) * Math.PI * 2;
    const distance = PLAYER_HUNT_MIN_OFFSET_PX
      + sample(random) * (PLAYER_HUNT_MAX_OFFSET_PX - PLAYER_HUNT_MIN_OFFSET_PX);
    candidate = clampPointToArena(
      anchor.x + Math.cos(angle) * distance,
      anchor.y + Math.sin(angle) * distance,
      worldMetrics,
    );
    if (!isProtectedBasePoint(candidate.x, candidate.y)) return candidate;
  }
  return candidate;
}

export function isPointNearBaseRegion(
  x: number,
  y: number,
  baseBounds: readonly { x: number; y: number; width: number; height: number }[],
): boolean {
  for (const bounds of baseBounds) {
    if (
      x >= bounds.x - BASE_AVOID_MARGIN_PX
      && x <= bounds.x + bounds.width + BASE_AVOID_MARGIN_PX
      && y >= bounds.y - BASE_AVOID_MARGIN_PX
      && y <= bounds.y + bounds.height + BASE_AVOID_MARGIN_PX
    ) return true;
  }
  return false;
}

function clampPointToArena(x: number, y: number, worldMetrics: WorldMetrics): { x: number; y: number } {
  return {
    x: clamp(
      x,
      worldMetrics.offsetX + ARENA_EDGE_MARGIN_PX,
      worldMetrics.maxX - ARENA_EDGE_MARGIN_PX,
    ),
    y: clamp(
      y,
      worldMetrics.offsetY + ARENA_EDGE_MARGIN_PX,
      worldMetrics.maxY - ARENA_EDGE_MARGIN_PX,
    ),
  };
}

function getOccurrenceKey(eventId: string, occurrence: number): string {
  return `${eventId}#${occurrence}`;
}

function randomInteger(min: number, max: number, random: AirstrikeRandom): number {
  return min + Math.floor(sample(random) * (max - min + 1));
}

function sample(random: AirstrikeRandom): number {
  const value = random();
  return Number.isFinite(value) ? clamp(value, 0, 0.999999999) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
