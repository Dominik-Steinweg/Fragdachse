import type * as Phaser from 'phaser';
import type { ArenaRuntime } from '../../scenes/arena/ArenaRuntime';
import type { PortalPresentation } from '../../effects/portal/PortalPresentation';
import { PORTAL_STYLES, type PortalStyleId } from '../../effects/portal/PortalStyle';
import type { PortalEndView } from '../../effects/portal/PortalViews';
import type { DevScenarioController } from './controller';

const OWNER = 'dev-portal-review';
const fixtures = new WeakMap<DevScenarioController, { runtime: ArenaRuntime; review: PortalReview | null }>();

interface Pair { a: { x: number; y: number }; b: { x: number; y: number }; radius: number; styles: [PortalStyleId, PortalStyleId] }

/**
 * Presentation-only showcase of the shared portal look: a translocator pair, a fire-control portal
 * with two muzzle entries and a generator portal side by side around one point, with scripted
 * transfers and collapses. Gameplay never sees these portals.
 */
class PortalReview {
  private readonly startedAt: number;
  private auto = true;
  private nextTransfer = 0;
  private charge: number | null = null;
  private collapsedAt: number | null = null;
  private readonly translocator: Pair;
  private readonly voidPair: Pair;
  private readonly fcExit: { x: number; y: number };
  private readonly fcEntries: { x: number; y: number; angle: number }[];
  private fcFlashAt = -Infinity;
  private transferIndex = 0;

  constructor(private readonly scene: Phaser.Scene, private readonly portals: PortalPresentation,
    centre: { x: number; y: number }, spread: number) {
    const at = (dx: number, dy: number) => ({ x: centre.x + dx * spread, y: centre.y + dy * spread });
    this.translocator = { a: at(-170, -95), b: at(185, -120), radius: 16, styles: ['translocator-a', 'translocator-b'] };
    this.voidPair = { a: at(-60, -250), b: at(320, 70), radius: 28, styles: ['void', 'void'] };
    this.fcExit = at(70, 150);
    this.fcEntries = [{ ...at(-215, 105), angle: 0.25 }, { ...at(-175, 185), angle: -0.2 }];
    this.startedAt = scene.time.now;
    scene.events.on('postupdate', this.update, this);
  }

  setAuto(auto: boolean): void { this.auto = auto; }
  setCharge(charge: number | null): void { this.charge = charge; this.collapsedAt = null; }

  transfer(): void {
    const now = this.scene.time.now;
    const pairs = [this.translocator, this.voidPair];
    const pair = pairs[this.transferIndex++ % pairs.length];
    const forward = this.transferIndex % 4 < 2;
    const [from, to] = forward ? [pair.a, pair.b] : [pair.b, pair.a];
    const fromStyle = PORTAL_STYLES[forward ? pair.styles[0] : pair.styles[1]];
    this.portals.playFlashAt(from.x, from.y, fromStyle.rim, 'start');
    this.portals.playFlashAt(to.x, to.y, fromStyle.rim, 'end');
    const entry = this.fcEntries[this.transferIndex % this.fcEntries.length];
    this.portals.playTransfer({ x: this.fcExit.x, y: this.fcExit.y, radius: 23, style: 'fire-control', side: 'exit',
      dirX: Math.cos(entry.angle), dirY: Math.sin(entry.angle), strength: 0.45 });
    this.fcFlashAt = now;
  }

  collapse(): void {
    this.collapsedAt = this.scene.time.now;
    this.portals.playCollapse([this.translocator.a], 16, 'translocator-a');
    this.portals.playCollapse([this.translocator.b], 16, 'translocator-b');
    this.portals.playCollapse([this.voidPair.a, this.voidPair.b], 28, 'void', 128);
  }

  status() {
    const at = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
    return { auto: this.auto, charge: this.charge, collapsed: this.collapsedAt !== null, ...this.portals.debugCounts,
      layout: { tlA: at(this.translocator.a), tlB: at(this.translocator.b), voidA: at(this.voidPair.a), voidB: at(this.voidPair.b),
        fcExit: at(this.fcExit), fcEntry: at(this.fcEntries[0]) } };
  }

  destroy(): void {
    this.scene.events.off('postupdate', this.update, this);
    this.portals.clear(OWNER);
  }

  private update(): void {
    const now = this.scene.time.now;
    if (this.auto && now >= this.nextTransfer) { this.nextTransfer = now + 1600; this.transfer(); }
    if (this.collapsedAt !== null && now - this.collapsedAt > 2200) this.collapsedAt = null;
    const age = now - this.startedAt;
    const open = this.collapsedAt !== null ? 0 : Math.min(1, age / 200);
    const views: PortalEndView[] = [];
    // Translocator lifetime loops every 15 s so the meter is visible.
    const meter = 1 - ((age / 15000) % 1);
    const t = this.translocator;
    views.push({ key: 'tl:a', x: t.a.x, y: t.a.y, radius: t.radius, style: t.styles[0], open, partner: t.b, ground: 1, meter });
    views.push({ key: 'tl:b', x: t.b.x, y: t.b.y, radius: t.radius, style: t.styles[1], open, partner: t.a, ground: 1, meter });
    const v = this.voidPair;
    const charge = this.charge === null ? undefined : this.charge;
    views.push({ key: 'void:a', x: v.a.x, y: v.a.y, radius: v.radius, style: 'void', open, partner: v.b, ground: 1, charge });
    views.push({ key: 'void:b', x: v.b.x, y: v.b.y, radius: v.radius, style: 'void', open, partner: v.a, ground: 1, charge });
    const flash = Math.max(0, 1 - (now - this.fcFlashAt) / 220);
    const fcOpen = Math.min(1, age / 400);
    views.push({ key: 'fc:exit', x: this.fcExit.x, y: this.fcExit.y, radius: 23, style: 'fire-control', open: fcOpen,
      partner: this.fcEntries[0], ground: 1, meter: 1 - ((age / 20000) % 1), flash, flow: 'out', link: 'in' });
    this.fcEntries.forEach((entry, index) => views.push({ key: `fc:entry:${index}`, x: entry.x, y: entry.y, radius: 13,
      style: 'fire-control', open: fcOpen, partner: this.fcExit, ground: 0, particles: 0.5, flash: index === 0 ? flash : 0, link: 'out',
      ellipse: { angle: entry.angle, aspect: 1.6 }, intensity: index === 1 ? 0.45 : 1, pulse: index === 1 }));
    this.portals.submit(OWNER, views);
  }
}

export function bindPortalReview(controller: DevScenarioController, runtime: ArenaRuntime): void {
  fixtures.set(controller, { runtime, review: null });
}

export function releasePortalReview(controller: DevScenarioController): void {
  const fixture = fixtures.get(controller);
  fixture?.review?.destroy();
  fixtures.delete(controller);
}

/**
 * window.devScenario.run({action:'portalReview', step:'show'|'transfer'|'collapse'|'charge'|'auto'|'clear'|'status',
 *   spread?, charge?, auto?}).
 */
export function runPortalReview(controller: DevScenarioController, command: Record<string, unknown>): void {
  const fixture = fixtures.get(controller);
  if (!fixture) throw new Error('Portal review is not bound');
  const step = command.step ?? 'show';
  if (step === 'show') {
    controller.requireReadyForBots();
    fixture.review?.destroy();
    // A fixed grid centre keeps the layout stable across reloads; otherwise the player's position.
    const centre = typeof command.gridX === 'number' && typeof command.gridY === 'number'
      ? { x: command.gridX * 32 + 16, y: command.gridY * 32 + 16 }
      : fixture.runtime.navigationLabPort.getPlayerPosition();
    if (!centre) throw new Error('No player position');
    const spread = typeof command.spread === 'number' ? Math.max(0.4, Math.min(2.5, command.spread)) : 1;
    const targets = fixture.runtime.getScenarioPortalTargets();
    fixture.review = new PortalReview(targets.scene, targets.portals, centre, spread);
  }
  const review = fixture.review;
  if (!review) throw new Error('Run portalReview step "show" first');
  if (step === 'transfer') review.transfer();
  else if (step === 'collapse') review.collapse();
  else if (step === 'charge') review.setCharge(typeof command.charge === 'number' ? Math.max(0, Math.min(1, command.charge)) : null);
  else if (step === 'auto') review.setAuto(command.auto !== false);
  else if (step === 'clear') { review.destroy(); fixture.review = null; controller.lastAction = { portalReview: 'cleared' }; return; }
  controller.lastAction = { portalReview: review.status() };
}
