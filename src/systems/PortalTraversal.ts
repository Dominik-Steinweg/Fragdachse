/** Shared, renderer-free geometry. Portal queries never mutate an actor or projectile. */
export interface PortalPoint { readonly x: number; readonly y: number }
export interface PortalPair {
  readonly id: string;
  readonly ownerId: string;
  readonly a: PortalPoint;
  readonly b: PortalPoint;
  readonly radius: number;
  readonly reentryDistance: number;
  readonly damageBonus: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}
export interface PortalCrossing {
  readonly pair: PortalPair;
  readonly source: 'a' | 'b';
  readonly sourceKey: string;
  readonly exitKey: string;
  readonly entry: PortalPoint;
  readonly exit: PortalPoint;
  readonly fraction: number;
}
export interface PortalQueryPort {
  getPortalPairs(): readonly PortalPair[];
  isPortalFriendly(ownerId: string, attackerId: string): boolean;
}
export type PortalGates = Map<string, { readonly center: PortalPoint; readonly releaseDistance: number }>;
export const portalEndpointKey = (pair: PortalPair, end: 'a' | 'b'): string => `${pair.id}:${end}`;

export function releasePortalGates(gates: PortalGates, point: PortalPoint): void {
  for (const [key, gate] of gates) {
    if (Math.hypot(point.x - gate.center.x, point.y - gate.center.y) >= gate.releaseDistance) gates.delete(key);
  }
}
export function gatePortalExit(gates: PortalGates, crossing: PortalCrossing): void {
  gates.set(crossing.exitKey, { center: crossing.pair[crossing.source === 'a' ? 'b' : 'a'],
    releaseDistance: crossing.pair.reentryDistance });
}

/** Earliest center entry, including a point already inside the circle. Tangencies count. */
export function portalCircleEntry(from: PortalPoint, to: PortalPoint, center: PortalPoint, radius: number): number | null {
  const x = from.x - center.x, y = from.y - center.y;
  const c = x * x + y * y - radius * radius;
  if (c <= 1e-8) return 0;
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  if (a <= 1e-16) return null;
  const b = x * dx + y * dy, disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

export function findPortalCrossing(pairs: readonly PortalPair[], from: PortalPoint, to: PortalPoint,
  options: { readonly gates?: ReadonlyMap<string, unknown>; readonly excludedPairs?: ReadonlySet<string>;
    readonly excludedEndpoints?: ReadonlySet<string> } = {}): PortalCrossing | null {
  let best: PortalCrossing | null = null;
  for (const pair of pairs) {
    if (options.excludedPairs?.has(pair.id)) continue;
    for (const source of ['a', 'b'] as const) {
      const sourceKey = portalEndpointKey(pair, source);
      if (options.gates?.has(sourceKey) || options.excludedEndpoints?.has(sourceKey)) continue;
      const fraction = portalCircleEntry(from, to, pair[source], pair.radius);
      if (fraction === null || (best && (fraction > best.fraction + 1e-10
        || (Math.abs(fraction - best.fraction) <= 1e-10 && sourceKey >= best.sourceKey)))) continue;
      const destination = source === 'a' ? 'b' : 'a';
      const entry = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
      best = { pair, source, sourceKey, exitKey: portalEndpointKey(pair, destination), fraction, entry,
        exit: { x: pair[destination].x + entry.x - pair[source].x, y: pair[destination].y + entry.y - pair[source].y } };
    }
  }
  return best;
}

/** Values are acquired once and copied with attack descendants, never multiplied recursively. */
export interface PortalDamageContribution { readonly pairId: string; readonly bonus: number }
export type PortalDamageContext = readonly PortalDamageContribution[];
export function portalDamageMultiplier(context: PortalDamageContext | undefined): number {
  return 1 + (context?.reduce((sum, entry) => sum + entry.bonus, 0) ?? 0);
}
export function acquirePortalDamage(context: PortalDamageContext | undefined, pair: PortalPair,
  friendly: boolean): PortalDamageContext | undefined {
  if (!friendly || pair.damageBonus <= 0 || context?.some(entry => entry.pairId === pair.id)) return context;
  return [...(context ?? []), { pairId: pair.id, bonus: pair.damageBonus }];
}
