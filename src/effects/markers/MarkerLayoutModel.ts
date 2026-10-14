import { CELL_SIZE } from '../../config';
import { getVisibleWorldView, type CameraWorldViewSource, type VisibleWorldView } from '../../graphics/CameraWorldView';
import type { HudOcclusionRect } from '../../ui/hudOcclusionFade';
import { getMarkerEdgeBounds, placeMarkerOnEdge, type MarkerPoint, type MarkerViewport } from './MarkerEdgeLayout';
import {
  MARKER_LIMITS, MARKER_PRIORITY, MARKER_STYLES,
  type MarkerBadgeInstance, type MarkerDescriptor, type MarkerFrame, type MarkerState,
} from './MarkerTypes';

/** Existing secondary-objective convention: one grid cell is one metre. */
export const MARKER_WORLD_PIXELS_PER_METRE = CELL_SIZE;
export const MARKER_VISIBILITY_HYSTERESIS_PX = 4;

export interface MarkerCameraTransform {
  readonly worldView: Pick<VisibleWorldView, 'centerX' | 'centerY'>;
  /** Design pixels per world pixel, i.e. camera.zoom / renderScale. */
  readonly zoom: number;
  readonly viewport: MarkerViewport;
  readonly rotation?: number;
}

/** Adapter for the live post-feedback camera; never reads its cached camera.worldView.
 * Uniform zoom is the arena's camera contract. Render scale includes the backing-store/DPR factor. */
export function createMarkerCameraTransform(
  camera: CameraWorldViewSource & { readonly x?: number; readonly y?: number }, renderScale: number,
): MarkerCameraTransform {
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  const rotation = Number.isFinite(camera.rotation) ? camera.rotation! : 0;
  return {
    // Camera properties may be prototype accessors; spreading a live camera loses them.
    worldView: getVisibleWorldView({ width: camera.width, height: camera.height,
      originX: camera.originX, originY: camera.originY, scrollX: camera.scrollX, scrollY: camera.scrollY,
      zoom, rotation }),
    zoom: zoom / scale, rotation,
    viewport: { x: (camera.x ?? 0) / scale, y: (camera.y ?? 0) / scale,
      width: camera.width / scale, height: camera.height / scale },
  };
}

export interface MarkerLayoutInput {
  readonly descriptors: readonly MarkerDescriptor[];
  readonly camera: MarkerCameraTransform;
  readonly localPlayer: MarkerPoint;
  /** Already in design pixels, including announcements/tutorial/visible HUD cards. */
  readonly reservedHudRects: readonly HudOcclusionRect[];
  readonly nowMs: number;
  readonly lowQuality: boolean;
}

export interface MarkerLayoutOptions {
  readonly locale?: string;
  /** Sources still decide existence. This only exempts persistent targets from the resolved fade.
   * Default: base glyphs of main-objective/return; other persistent targets can be supplied here. */
  readonly isPersistent?: (descriptor: MarkerDescriptor) => boolean;
}

interface History {
  state: MarkerState;
  stamp: number | undefined;
  popAt: number | undefined;
  resolvedAt: number | undefined;
  onscreen: boolean;
  now: number;
}
interface Candidate {
  descriptor: MarkerDescriptor;
  badge: MarkerBadgeInstance;
  target: MarkerPoint;
  angle: number;
  distance: number;
}
interface Group { key: string; representative: Candidate; members: Candidate[] }

const compareKey = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const resolved = (state: MarkerState) => state === 'completed' || state === 'failed';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const emptyFrame = (): MarkerFrame => ({ worldBadges: [], edgeBadges: [], groundRings: [] });

export function formatMarkerCountLabel(count: number, locale = 'de-DE'): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(count)}×`;
}

/** Optional pure sampler for renderers/tests. Frame.pulse plus sync(nowMs) is the fixed wire contract. */
export function sampleMarkerPulse(pulse: MarkerBadgeInstance['pulse'], nowMs: number): { scale: number; alpha: number } {
  if (pulse === 'none') return { scale: 1, alpha: 0 };
  const period = pulse === 'urgent' ? MARKER_LIMITS.urgentPulsePeriodMs : MARKER_LIMITS.pulsePeriodMs;
  const phase = ((nowMs % period) + period) % period / period;
  return { scale: 1 + 0.25 * phase, alpha: 0.5 * (1 - phase) };
}

/** Phaser-free presentation model. History is local, scoped by stable descriptor keys and
 * pruned when sources stop submitting them. No timers, wall clock, gameplay or network writes. */
export class MarkerLayoutModel {
  private readonly history = new Map<string, History>();
  private worldOrder = new Map<string, number>();
  private edgeOrder = new Map<string, number>();
  private edgePositions = new Map<string, MarkerPoint>();
  private readonly numbers: Intl.NumberFormat;
  private readonly isPersistent: (descriptor: MarkerDescriptor) => boolean;

  constructor(private readonly options: MarkerLayoutOptions = {}) {
    this.numbers = new Intl.NumberFormat(options.locale ?? 'de-DE', { maximumFractionDigits: 0 });
    this.isPersistent = options.isPersistent ?? ((d) => d.glyph === 'base'
      && (d.kind === 'main-objective' || d.kind === 'return'));
  }

  reset(): void {
    this.history.clear(); this.worldOrder.clear(); this.edgeOrder.clear(); this.edgePositions.clear();
  }

  /** Used at source teardown even if the same semantic ID is rebound before the next frame. */
  forget(keys: Iterable<string>): void {
    for (const key of keys) {
      this.history.delete(key); this.worldOrder.delete(key); this.edgeOrder.delete(key); this.edgePositions.delete(key);
    }
  }

  layout(input: MarkerLayoutInput): MarkerFrame {
    const keys = new Set<string>();
    for (const d of input.descriptors) {
      if (keys.has(d.key)) throw new Error(`Duplicate marker key: ${d.key}`);
      keys.add(d.key);
    }
    this.forget([...this.history.keys()].filter((key) => !keys.has(key)));
    const { viewport, worldView } = input.camera;
    if (![viewport.x, viewport.y, viewport.width, viewport.height, worldView.centerX, worldView.centerY,
      input.localPlayer.x, input.localPlayer.y, input.nowMs].every(Number.isFinite)
      || viewport.width <= 0 || viewport.height <= 0) return emptyFrame();
    const zoom = Number.isFinite(input.camera.zoom) && input.camera.zoom > 0 ? input.camera.zoom : 1;
    const rotation = Number.isFinite(input.camera.rotation) ? input.camera.rotation! : 0;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const center = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
    const project = (point: MarkerPoint): MarkerPoint => {
      const x = (point.x - worldView.centerX) * zoom, y = (point.y - worldView.centerY) * zoom;
      return { x: center.x + cos * x - sin * y, y: center.y + sin * x + cos * y };
    };
    const world: Candidate[] = [], edge: Candidate[] = [];
    const groundRings: MarkerFrame['groundRings'][number][] = [];
    for (const d of input.descriptors) {
      if (![d.x, d.y, d.targetHalfHeight].every(Number.isFinite)) continue;
      const history = this.observe(d, input.nowMs, input.lowQuality);
      const persistent = this.isPersistent(d);
      const age = history.resolvedAt === undefined ? 0 : history.now - history.resolvedAt;
      if (resolved(d.state) && !persistent && age >= MARKER_LIMITS.fadeAfterResolvedMs) continue;
      const fade = resolved(d.state) && !persistent
        ? clamp((MARKER_LIMITS.fadeAfterResolvedMs - age) / MARKER_LIMITS.popMs, 0, 1) : 1;
      const alpha = (d.state === 'dormant' ? 0.7 : 1) * fade;
      const style = MARKER_STYLES[d.kind];
      const tone = d.state === 'completed' ? 'green' : d.state === 'failed' ? 'red' : style.tone;
      const diameterPx = clamp(style.diameter * zoom, MARKER_LIMITS.screenDiameterMin, MARKER_LIMITS.screenDiameterMax);
      const anchor = { x: d.x, y: d.y - Math.max(0, d.targetHalfHeight)
        - (MARKER_LIMITS.anchorGapPx + diameterPx / 2) / zoom };
      const target = project(d), badgePoint = project(anchor);
      // Offscreen-only bosses use the target silhouette, since no world badge exists for them.
      const onlyOffscreen = d.visibility === 'edge-when-offscreen';
      const point = onlyOffscreen ? target : badgePoint;
      const radius = onlyOffscreen ? 0 : diameterPx / 2;
      // Require full entry (+ hysteresis); retain until the full badge reaches the viewport edge.
      const margin = radius + (history.onscreen ? 0 : MARKER_VISIBILITY_HYSTERESIS_PX);
      history.onscreen = point.x >= viewport.x + margin && point.x <= viewport.x + viewport.width - margin
        && point.y >= viewport.y + margin && point.y <= viewport.y + viewport.height - margin;
      const badge: MarkerBadgeInstance = {
        key: d.key, space: 'world', ...anchor, diameter: diameterPx / zoom,
        shape: style.shape, tone, glyph: d.glyph, state: d.state, alpha,
        scale: this.popScale(history, input.lowQuality),
        progress: d.progress === undefined || !Number.isFinite(d.progress) ? undefined : clamp(d.progress, 0, 1),
        tier: d.tier, vulnerable: d.vulnerable === true,
        pulse: !input.lowQuality && d.state === 'active' ? 'calm' : 'none', pointerAngle: Math.PI / 2,
      };
      const candidate: Candidate = { descriptor: d, badge, target,
        angle: Math.atan2(target.y - center.y, target.x - center.x),
        distance: Math.hypot(d.x - input.localPlayer.x, d.y - input.localPlayer.y) };
      if (history.onscreen && (d.visibility === 'world-only' || d.visibility === 'world-and-edge')) world.push(candidate);
      if (d.visibility === 'edge-only' || (!history.onscreen && d.visibility !== 'world-only')) edge.push(candidate);
      if (d.groundRing && Number.isFinite(d.groundRing.radiusPx) && d.groundRing.radiusPx > 0) {
        groundRings.push({ key: d.key, x: d.x, y: d.y, radiusPx: d.groundRing.radiusPx,
          tone: d.groundRing.tone ?? tone, alpha });
      }
    }
    world.sort((a, b) => this.compare(a, b, this.worldOrder));
    const worldBadges = world.slice(0, MARKER_LIMITS.worldBadges).map((c) => c.badge);
    const groups = this.bundle(edge);
    groups.sort((a, b) => this.compare(a.representative, b.representative, this.edgeOrder, a.key, b.key));
    const edgeBadges: MarkerBadgeInstance[] = [], occupied: HudOcclusionRect[] = [];
    for (const group of groups) {
      if (edgeBadges.length >= MARKER_LIMITS.edgeArrows) break;
      const c = group.representative;
      let distanceLabel: string | undefined = `${this.numbers.format(Math.max(1, Math.round(c.distance / MARKER_WORLD_PIXELS_PER_METRE)))} m`;
      const count = group.members.length > 1 ? group.members.length : undefined;
      const countLabel = count ? formatMarkerCountLabel(count, this.options.locale) : undefined;
      let point = placeMarkerOnEdge(c.target, viewport, input.reservedHudRects, occupied,
        distanceLabel, countLabel, this.edgePositions.get(group.key));
      if (!point) {
        distanceLabel = undefined;
        point = placeMarkerOnEdge(c.target, viewport, input.reservedHudRects, occupied,
          undefined, countLabel, this.edgePositions.get(group.key));
      }
      // Fully blocked viewports have no legal placement; never cover a HUD card to fill a budget.
      if (!point) continue;
      edgeBadges.push({ ...c.badge, key: group.key, space: 'screen', ...point,
        diameter: MARKER_LIMITS.edgeBadgeDiameter, count, distanceLabel,
        pointerAngle: Math.atan2(c.target.y - point.y, c.target.x - point.x),
        pulse: c.badge.pulse === 'none' ? 'none'
          : group.members.some((member) => member.descriptor.urgent)
            || c.descriptor.kind === 'hazard' || c.descriptor.kind === 'return' ? 'urgent' : 'calm' });
      occupied.push(getMarkerEdgeBounds(point, distanceLabel, countLabel));
    }
    this.worldOrder = new Map(worldBadges.map((b, index) => [b.key, index]));
    this.edgeOrder = new Map(edgeBadges.map((b, index) => [b.key, index]));
    this.edgePositions = new Map(edgeBadges.map((b) => [b.key, { x: b.x, y: b.y }]));
    groundRings.sort((a, b) => compareKey(a.key, b.key));
    return { worldBadges, edgeBadges, groundRings };
  }

  private observe(d: MarkerDescriptor, nowMs: number, lowQuality: boolean): History {
    const stamp = Number.isFinite(d.stateChangedAtMs) ? d.stateChangedAtMs : undefined;
    let h = this.history.get(d.key);
    if (!h) {
      // First observation is a baseline, even if a recent timestamp arrives in a late-join snapshot.
      h = { state: d.state, stamp, popAt: undefined, resolvedAt: resolved(d.state) ? stamp ?? nowMs : undefined,
        onscreen: false, now: nowMs };
      this.history.set(d.key, h);
    } else {
      h.now = Math.max(h.now, nowMs);
      if (h.state !== d.state) {
        h.popAt = !lowQuality && stamp !== undefined && stamp !== h.stamp && stamp <= h.now
          && h.now - stamp < MARKER_LIMITS.popMs && d.state !== 'dormant' ? stamp : undefined;
        h.resolvedAt = resolved(d.state) ? stamp ?? h.now : undefined;
        h.state = d.state; h.stamp = stamp;
      }
    }
    // Turning quality back up must not replay the remainder of a suppressed event.
    if (lowQuality) h.popAt = undefined;
    return h;
  }

  private popScale(h: History, lowQuality: boolean): number {
    if (lowQuality || h.popAt === undefined) return 1;
    const phase = (h.now - h.popAt) / MARKER_LIMITS.popMs;
    if (phase < 0 || phase >= 1) return 1;
    return phase < 0.5 ? 0.8 + 0.6 * phase : 1.2 - 0.2 * phase;
  }

  private compare(a: Candidate, b: Candidate, previous: ReadonlyMap<string, number>, aKey = a.descriptor.key, bKey = b.descriptor.key): number {
    return MARKER_PRIORITY[b.descriptor.kind] - MARKER_PRIORITY[a.descriptor.kind]
      || Number(b.descriptor.focused === true) - Number(a.descriptor.focused === true)
      || Number(b.descriptor.state === 'active') - Number(a.descriptor.state === 'active')
      || (previous.get(aKey) ?? Infinity) - (previous.get(bKey) ?? Infinity)
      || compareKey(aKey, bKey);
  }

  private bundle(candidates: Candidate[]): Group[] {
    const groups: Group[] = [];
    // Nearest player-relative target supplies pose/distance. Identity is independent of that choice.
    candidates.sort((a, b) => Math.abs(a.distance - b.distance) > 1e-6
      ? a.distance - b.distance : compareKey(a.descriptor.key, b.descriptor.key));
    for (const candidate of candidates) {
      const d = candidate.descriptor;
      const group = d.bundleKey === undefined ? undefined : groups.find((g) => {
        const other = g.representative.descriptor;
        return other.bundleKey === d.bundleKey && other.kind === d.kind && other.state === d.state
          && other.glyph === d.glyph && g.members.every((member) => {
            const delta = candidate.angle - member.angle;
            return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) <= MARKER_LIMITS.edgeBundleDegrees * Math.PI / 180 + 1e-9;
          });
      });
      if (group) {
        group.members.push(candidate);
        const previousRank = this.edgeOrder.get(group.key) ?? Infinity;
        const candidateRank = this.edgeOrder.get(d.key) ?? Infinity;
        if (candidateRank < previousRank || (candidateRank === previousRank && compareKey(d.key, group.key) < 0)) {
          group.key = d.key;
        }
      } else groups.push({ key: d.key, representative: candidate, members: [candidate] });
    }
    return groups;
  }
}
