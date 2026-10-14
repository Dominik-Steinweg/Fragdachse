import type { CoopDefenseEnemyFleeConfig } from '../../config/coopDefenseEnemies';
import type { EnemyEntity } from '../../entities/EnemyEntity';
import type { EnemyAiTargetCatalog } from '../EnemyAiTargetCatalog';
import { EnemyFlowFieldService } from '../EnemyFlowFieldService';
import type { FlowFieldCoordinator } from '../flowfield/FlowFieldCoordinator';
import type { EnemyIntent, NavigationResult } from './NavigationContracts';
import type { NavigationGeometry, NavigationPoint } from './NavigationGeometry';
import { navigationPoint } from './NavigationGraph';

interface ExitField {
  id: string;
  field: EnemyFlowFieldService;
  topology: number;
  points: NavigationPoint[];
}

/** Non-combat navigation: shared edge fields, optional authored exit, local player avoidance. */
export class EnemyFleeNavigation {
  private readonly edges = new Map<string, ExitField>();
  constructor(private readonly coordinator: FlowFieldCoordinator, private readonly catalog: EnemyAiTargetCatalog) {}

  resolve(enemy: EnemyEntity, config: CoopDefenseEnemyFleeConfig, geometry: NavigationGeometry,
    now: number, routeTo: (point: NavigationPoint) => { field: EnemyFlowFieldService; navigation: NavigationResult }) {
    const { x, y } = enemy.sprite, radius = enemy.getSize() / 2;
    const b = geometry.snapshot, m = this.coordinator.metrics;
    const arrival = Math.max(config.arrivalRadiusPx, m.cellSize);
    const exit = enemy.escapeTarget;
    const escapeReached = exit ? Math.hypot(x - exit.x, y - exit.y) <= config.arrivalRadiusPx
      && geometry.canMove(x, y, exit.x, exit.y, radius)
      : Math.min(x - b.left, b.right - x, y - b.top, b.bottom - y) <= radius + arrival;
    const threats = this.catalog.getCandidates('player-threats').filter(p =>
      p.kind === 'player' && Math.hypot(x - p.x, y - p.y) < config.playerAvoidanceRadiusPx);
    let awayX = 0, awayY = 0;
    for (const p of threats) {
      const distance = Math.max(1, Math.hypot(x - p.x, y - p.y));
      const weight = 1 - distance / config.playerAvoidanceRadiusPx;
      awayX += (x - p.x) / distance * weight;
      awayY += (y - p.y) / distance * weight;
    }
    const choices = exit ? [{ point: exit, ...routeTo(exit) }] : [0, 1, 2, 3].flatMap(side => {
      const entry = this.edge(side, radius, geometry);
      let point: NavigationPoint | undefined, distance = Infinity;
      for (const p of entry.points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < distance) { point = p; distance = d; }
      }
      if (!point) return [];
      let navigation = entry.field.queryNavigation(x, y);
      if (navigation.status === 'pending' && geometry.canMove(x, y, point.x, point.y, radius)) {
        navigation = { ...navigation, continuation: point, directGoalConnection: true };
      }
      return [{ point, field: entry.field, navigation }];
    });
    const score = (choice: typeof choices[number]) => {
      const route = choice.navigation;
      const waypoint = route.status === 'ready' ? route.waypoint
        : route.status === 'pending' ? route.continuation : undefined;
      const dx = (waypoint ?? choice.point).x - x, dy = (waypoint ?? choice.point).y - y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const cost = route.status === 'ready' ? route.cost : Math.hypot(choice.point.x - x, choice.point.y - y);
      const rank = waypoint ? 0 : route.status === 'pending' ? 1e6 : 1e9;
      return rank + cost - (dx * awayX + dy * awayY) / length * Math.hypot(b.right - b.left, b.bottom - b.top) * 2;
    };
    choices.sort((a, b) => score(a) - score(b));
    const best = choices[0];
    if (!best) return null;
    let navigation = best.navigation;
    const waypoint = navigation.status === 'ready' ? navigation.waypoint
      : navigation.status === 'pending' ? navigation.continuation : undefined;
    // Only use a local evasion step when its complete swept body is clear. The edge route
    // remains the long-range owner, so obstacles never become attack/breach targets.
    if (waypoint && Math.hypot(awayX, awayY) > 0.01) {
      const dx = waypoint.x - x, dy = waypoint.y - y, length = Math.max(1, Math.hypot(dx, dy));
      const vx = dx / length + awayX * 3, vy = dy / length + awayY * 3;
      const speed = Math.max(1, Math.hypot(vx, vy));
      const point = { x: x + vx / speed * m.cellSize, y: y + vy / speed * m.cellSize };
      if (geometry.canMove(x, y, point.x, point.y, radius)) {
        navigation = navigation.status === 'ready' ? { ...navigation, waypoint: point }
          : { ...navigation, status: 'pending', continuation: point };
      }
    }
    const intent: EnemyIntent = { target: null, point: best.point, reason: 'flee', attackContext: 'none',
      selectedAt: now, navigation, escapeReached };
    return { field: best.field, intent };
  }

  private edge(side: number, radius: number, geometry: NavigationGeometry): ExitField {
    const id = `flee:edge:${side}:r${radius}`;
    let entry = this.edges.get(id);
    if (!entry) {
      entry = { id, field: EnemyFlowFieldService.fromView(this.coordinator.registerField(id,
        { goalMode: 'dynamic', bodyRadius: radius })), topology: -1, points: [] };
      this.edges.set(id, entry);
    }
    const topology = this.coordinator.getTopologyVersion();
    if (entry.topology === topology) return entry;
    entry.topology = topology;
    entry.points = [];
    const m = this.coordinator.metrics, b = geometry.snapshot, goals: number[] = [];
    const offset = m.pointOffset ?? .5;
    const vertical = side < 2;
    const edge = [b.left + radius, b.right - radius, b.top + radius, b.bottom - radius][side];
    const coordinate = (edge - (vertical ? m.arenaOffsetX : m.arenaOffsetY)) / m.cellSize - offset;
    const min = Math.max(0, Math.floor(coordinate - 1));
    const max = Math.min((vertical ? m.cols : m.rows) - 1, Math.ceil(coordinate + 1));
    for (let row = vertical ? 0 : min; row <= (vertical ? m.rows - 1 : max); row++) {
      for (let col = vertical ? min : 0; col <= (vertical ? max : m.cols - 1); col++) {
        const index = row * m.cols + col, point = navigationPoint(m, index);
        const edgeDistance = [point.x - b.left, b.right - point.x, point.y - b.top, b.bottom - point.y][side];
        if (edgeDistance < radius || edgeDistance > radius + m.cellSize || !geometry.isFree(point.x, point.y, radius)) continue;
        goals.push(index); entry.points.push(point);
      }
    }
    this.coordinator.setGoalCells(id, goals);
    return entry;
  }

  clear(): void {
    for (const entry of this.edges.values()) { entry.field.destroy(); this.coordinator.unregisterField(entry.id); }
    this.edges.clear();
  }
}
