import { FlowFieldMinHeap, NEIGHBOR_DIRECTIONS, type FlowFieldMetrics } from '../flowfield/FlowFieldKernel';
import { NavigationGeometry, segmentObstacleDistanceSq, type NavigationPoint } from './NavigationGeometry';
import { navigationPoint } from './NavigationGraph';
import { navigationAttackPoint } from './NavigationAttackPoint';
import type { BreachPlan, NavigationVersion } from './NavigationContracts';

interface SearchNode { readonly index: number; readonly opened: ReadonlySet<string>; readonly cost: number;
  readonly firstBlocker: string | null; readonly approach: NavigationPoint | null }
export interface BreachRequest {
  readonly version: NavigationVersion; readonly startIndex: number; readonly startRegion: number;
  readonly goals: readonly number[]; readonly radius: number; readonly speed: number;
  /** Null means indestructible, immune or forbidden by the attacker's faction/weapon. */
  readonly destructionSeconds: (objectId: string) => number | null;
  readonly attackRange?: number;
  readonly attackRangeFor?: (objectId: string) => number;
  readonly acceptsGoal?: (index: number, opened: ReadonlySet<string>) => boolean;
}

/** Budgeted object-aware search. An exhausted frame budget never becomes a negative proof. */
export class BreachSearch {
  private readonly heap = new FlowFieldMinHeap();
  private readonly nodes: SearchNode[] = [];
  private readonly best = new Map<string, number>();
  private readonly goals: Set<number>;
  private allowBases = false;
  private result: BreachPlan | null = null;
  private readonly destructionCosts = new Map<string, number | null>();
  private readonly reachableHeap = new FlowFieldMinHeap();
  private readonly reachableSeen: Uint8Array;
  private readonly nonBaseOpenings = new Set<string>();
  private readonly allOpenings = new Set<string>();
  private checkingConnectivity = true;
  private connectivityAllowsBases = false;
  private searchExpansions = 0;
  private connectivityExpansions = 0;
  visited = 0;

  constructor(private readonly request: BreachRequest, private readonly metrics: FlowFieldMetrics,
    private readonly geometry: NavigationGeometry) {
    this.goals = new Set(request.goals);
    this.reachableSeen = new Uint8Array(metrics.cols * metrics.rows);
    for (const id of geometry.getObjectIds()) {
      const seconds = request.destructionSeconds(id);
      const permitted = seconds !== null && Number.isFinite(seconds) && seconds >= 0;
      this.destructionCosts.set(id, permitted ? seconds : null);
      if (!permitted) continue;
      this.allOpenings.add(id);
      if (!geometry.getObject(id).some(shape => shape.kind === 'base')) this.nonBaseOpenings.add(id);
    }
    this.startConnectivity();
    this.start();
  }

  private plan(status: BreachPlan['status'], node?: SearchNode): BreachPlan {
    return { status, version: this.request.version, startRegion: this.request.startRegion,
      openedObjects: node ? [...node.opened] : [], nextBlocker: node?.firstBlocker ?? null,
      approach: node?.approach ?? null, costSeconds: node?.cost ?? Infinity, goalIndex: node?.index };
  }
  private goalDistance(index: number): number {
    const point = navigationPoint(this.metrics, index);
    let distance = Infinity;
    for (const index of this.goals) {
      const goal = navigationPoint(this.metrics, index);
      distance = Math.min(distance, Math.hypot(goal.x - point.x, goal.y - point.y));
    }
    return distance;
  }
  private startConnectivity(): void {
    this.reachableHeap.clear(); this.reachableSeen.fill(0);
    this.reachableSeen[this.request.startIndex] = 1;
    this.reachableHeap.push(this.request.startIndex, this.goalDistance(this.request.startIndex), 0);
  }
  /** Opening every permitted non-base object gives a necessary feasibility condition.
   * Exhausting this finite graph proves when bases are required, without enumerating rock subsets. */
  private stepConnectivity(): void {
    if (!this.reachableHeap.size) {
      if (this.connectivityAllowsBases || this.allOpenings.size === this.nonBaseOpenings.size) {
        this.result = this.plan('no-solution'); return;
      }
      this.connectivityAllowsBases = true; this.startConnectivity();
    }
    this.reachableHeap.pop(); const index = this.reachableHeap.poppedIndex;
    this.visited++; this.connectivityExpansions++;
    const opened = this.connectivityAllowsBases ? this.allOpenings : this.nonBaseOpenings;
    if (this.goals.has(index) && (!this.request.acceptsGoal || this.request.acceptsGoal(index, opened))) {
      this.allowBases = this.connectivityAllowsBases; this.checkingConnectivity = false; return;
    }
    const point = navigationPoint(this.metrics, index);
    for (const [dx, dy] of NEIGHBOR_DIRECTIONS) {
      const col = index % this.metrics.cols + dx, row = Math.floor(index / this.metrics.cols) + dy;
      if (col < 0 || row < 0 || col >= this.metrics.cols || row >= this.metrics.rows) continue;
      const nextIndex = row * this.metrics.cols + col;
      if (this.reachableSeen[nextIndex]) continue;
      const next = navigationPoint(this.metrics, nextIndex);
      if (!this.geometry.canMove(point.x, point.y, next.x, next.y, this.request.radius, opened)) continue;
      this.reachableSeen[nextIndex] = 1;
      this.reachableHeap.push(nextIndex, this.goalDistance(nextIndex), nextIndex);
    }
  }
  private start(): void {
    this.heap.clear(); this.nodes.length = 0; this.best.clear();
    const point = navigationPoint(this.metrics, this.request.startIndex);
    if (!this.goals.size || !this.geometry.isFree(point.x, point.y, this.request.radius)) {
      this.result = this.plan('invalid'); return;
    }
    this.push({ index: this.request.startIndex, opened: new Set(), cost: 0, firstBlocker: null, approach: null });
  }
  private key(node: SearchNode): string { return `${node.index}|${[...node.opened].sort().join(',')}`; }
  private push(node: SearchNode): void {
    const key = this.key(node);
    if ((this.best.get(key) ?? Infinity) <= node.cost) return;
    this.best.set(key, node.cost);
    const id = this.nodes.length; this.nodes.push(node);
    this.heap.push(id, node.cost + this.goalDistance(node.index) / Math.max(1, this.request.speed), id);
  }
  step(expansionBudget: number): BreachPlan {
    if (this.result) return this.result;
    for (let work = 0; work < Math.max(0, expansionBudget); work++) {
      if (this.checkingConnectivity) { this.stepConnectivity(); if (this.result) return this.result; continue; }
      if (!this.heap.size) {
        // Lexicographic preference: prove that no solution without base damage exists first.
        if (!this.allowBases) { this.allowBases = true; this.start(); if (this.result) return this.result; }
        else { this.result = this.plan('no-solution'); return this.result; }
      }
      if (!this.heap.size) return this.plan('pending');
      this.heap.pop(); const node = this.nodes[this.heap.poppedIndex];
      if (this.best.get(this.key(node)) !== node.cost) continue;
      this.visited++; this.searchExpansions++;
      if (this.goals.has(node.index) && (!this.request.acceptsGoal || this.request.acceptsGoal(node.index, node.opened))) {
        // No opening means free connectivity; never issue an obstacle attack in that case.
        this.result = this.plan(node.firstBlocker ? 'ready' : 'invalid', node); return this.result;
      }
      const point = navigationPoint(this.metrics, node.index);
      for (const [dx, dy] of NEIGHBOR_DIRECTIONS) {
        const col = node.index % this.metrics.cols + dx, row = Math.floor(node.index / this.metrics.cols) + dy;
        if (col < 0 || row < 0 || col >= this.metrics.cols || row >= this.metrics.rows) continue;
        const index = row * this.metrics.cols + col, next = navigationPoint(this.metrics, index);
        if (!this.geometry.contains(next.x, next.y, this.request.radius)) continue;
        const added = new Set<string>(); let forbidden = false, extraCost = 0;
        this.geometry.visit(point.x, point.y, next.x, next.y, this.request.radius, obstacle => {
          if (node.opened.has(obstacle.id) || added.has(obstacle.id)
            || segmentObstacleDistanceSq(point.x, point.y, next.x, next.y, obstacle) >= (this.request.radius - 1e-6) ** 2) return false;
          const seconds = this.destructionCosts.get(obstacle.id) ?? null;
          if ((!this.allowBases && obstacle.kind === 'base') || seconds === null || !Number.isFinite(seconds) || seconds < 0) {
            forbidden = true; return true;
          }
          added.add(obstacle.id); extraCost += seconds; return false;
        });
        if (forbidden) continue;
        const opened = added.size ? new Set([...node.opened, ...added]) : node.opened;
        if (!this.geometry.canMove(point.x, point.y, next.x, next.y, this.request.radius, opened)) continue;
        let firstBlocker = node.firstBlocker;
        if (!firstBlocker && added.size) {
          let nearest = Infinity;
          for (const id of added) for (const obstacle of this.geometry.getObject(id)) {
            const target = navigationAttackPoint(obstacle, point.x, point.y);
            const distance = Math.hypot(target.x - point.x, target.y - point.y);
            if (distance >= nearest || distance > (this.request.attackRangeFor?.(obstacle.id) ?? this.request.attackRange ?? Infinity)) continue;
            if (!this.geometry.canMove(point.x, point.y, target.x, target.y, 0, new Set([obstacle.id]))) continue;
            nearest = distance; firstBlocker = obstacle.id;
          }
          if (!firstBlocker) continue;
        }
        this.push({ index, opened, cost: node.cost + extraCost + Math.hypot(next.x - point.x, next.y - point.y) / Math.max(1, this.request.speed),
          firstBlocker,
          approach: node.approach ?? (added.size ? point : null) });
      }
    }
    return this.plan('pending');
  }
  getDiagnostics() { return { connectivityExpansions: this.connectivityExpansions, searchExpansions: this.searchExpansions,
    storedStates: this.nodes.length, frontierStates: this.heap.size }; }
}

/** Shared by target, connected start/goal regions, profile, weapon rights and topology. */
export class BreachPlanner {
  private readonly jobs = new Map<string, { search: BreachSearch; result: BreachPlan; used: number; goals: readonly number[] }>();
  private frame = 0;
  private cursor = 0;
  private expansions = 0;
  beginFrame(): void { this.frame++; }
  request(key: string, request: BreachRequest, metrics: FlowFieldMetrics, geometry: NavigationGeometry): BreachPlan {
    let job = this.jobs.get(key);
    if (job && ((job.result.status === 'ready' && (job.result.openedObjects.some(id => request.destructionSeconds(id) === null)
      || (request.acceptsGoal && (job.result.goalIndex === undefined || !request.acceptsGoal(job.result.goalIndex, new Set(job.result.openedObjects))))))
      || (job.result.status === 'no-solution' && request.acceptsGoal && job.goals !== request.goals))) {
      this.jobs.delete(key); job = undefined;
    }
    if (!job) {
      const search = new BreachSearch(request, metrics, geometry);
      job = { search, result: search.step(0), used: this.frame, goals: request.goals }; this.jobs.set(key, job);
    }
    // The caller's key proves that old endpoints still reach current goals without another opening.
    if (job.result.version.goal !== request.version.goal) job.result = { ...job.result, version: request.version };
    job.used = this.frame; return job.result;
  }
  advance(totalBudget = 256): void {
    for (const [key, job] of this.jobs) if (job.used < this.frame - 2) this.jobs.delete(key);
    const pending = [...this.jobs.values()].filter(job => job.result.status === 'pending');
    for (let i = 0; i < pending.length && totalBudget > 0; i++) {
      const job = pending[this.cursor++ % pending.length];
      const budget = Math.min(64, totalBudget);
      const before = job.search.visited;
      job.result = job.search.step(budget); totalBudget -= budget;
      this.expansions += job.search.visited - before;
    }
  }
  getWorkCounters() { return { breachJobs: this.jobs.size, breachSearchExpansions: this.expansions }; }
  clear(): void { this.jobs.clear(); this.cursor = 0; this.expansions = 0; }
}
