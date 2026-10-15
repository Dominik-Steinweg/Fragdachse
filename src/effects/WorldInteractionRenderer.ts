import type * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { WorldInteractionFootprint, WorldInteractionView } from '../systems/WorldInteractionCandidate';
import { registerGraphicsObject } from './EffectUtils';
import { WorldPlaque } from '../ui/WorldPlaque';
import { WORLD_INTERACTION_LAYOUT, bracketArm, bracketCorners, bracketRect, layoutInteractionPlaque,
  type WorldRect } from '../ui/worldInteraction/WorldInteractionLayout';

const MOTION = { enterMs: 150, enterScale: 0.14, breathMs: 1800, breathDepth: 0.16, plaqueRisePx: 4 } as const;
const STROKE = {
  shadow: 0x14110d, ready: 0xe2c992, blocked: 0xa08a6a,
  shadowWidth: 5, width: 2.5, alternativeWidth: 2, alternativeAlpha: 0.4,
} as const;

/**
 * The one shared Shift focus for turrets, watchtowers, lobby buildings and the shooting range:
 * brass corner brackets around the object's real footprint, a keycap plaque pointing at it, and
 * faint ticks on other reachable targets. Input consumes exactly the focus shown here.
 */
export class WorldInteractionRenderer {
  private focusGraphics: Phaser.GameObjects.Graphics | null = null;
  private alternativeGraphics: Phaser.GameObjects.Graphics | null = null;
  private plaque: WorldPlaque | null = null;
  private focusKey: string | null = null;
  private focusSince = 0;
  private focusSignature = '';
  private alternativeSignature = '';

  constructor(private readonly scene: Phaser.Scene) {}

  sync(view: WorldInteractionView, player?: { x: number; y: number } | null): void {
    const focus = view.focus;
    if (!focus) { this.hide(); return; }
    const now = this.scene.time?.now ?? 0;
    this.ensureObjects();
    if (focus.key !== this.focusKey) { this.focusKey = focus.key; this.focusSince = now; }
    const age = Math.max(0, now - this.focusSince);
    const enter = 1 - (1 - Math.min(1, age / MOTION.enterMs)) ** 3;
    const breath = 1 - MOTION.breathDepth * (0.5 - 0.5 * Math.cos(2 * Math.PI * age / MOTION.breathMs));

    const rect = bracketRect(focus.footprint);
    const signature = `${rect.left},${rect.top},${rect.right},${rect.bottom},${focus.blocked ? 1 : 0}`;
    if (signature !== this.focusSignature) {
      this.focusSignature = signature;
      drawBrackets(this.focusGraphics!.clear(), rect, bracketArm(rect), STROKE.width, focus.blocked ? STROKE.blocked : STROKE.ready);
    }
    this.focusGraphics!.setPosition((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)
      .setScale(1 + MOTION.enterScale * (1 - enter)).setAlpha(enter * breath).setVisible(true);

    const plaque = this.plaque!.setContent(focus.blocked
      ? { primary: focus.subject ?? focus.label, secondary: focus.blocked, blocked: true }
      : { primary: focus.label, secondary: focus.subject });
    const layout = layoutInteractionPlaque(focus.footprint, player ?? null, plaque, this.viewRect());
    const rise = (1 - enter) * MOTION.plaqueRisePx * (layout.side === 'above' ? 1 : -1);
    plaque.setPointer(layout.side, layout.pointerX - layout.x).setPosition(layout.x, layout.y + rise).setAlpha(enter);

    this.syncAlternatives(view.alternatives, enter);
  }

  clear(): void {
    this.focusGraphics?.destroy(); this.alternativeGraphics?.destroy(); this.plaque?.destroy();
    this.focusGraphics = null; this.alternativeGraphics = null; this.plaque = null;
    this.focusKey = null; this.focusSignature = ''; this.alternativeSignature = '';
  }

  private hide(): void {
    this.focusKey = null;
    this.focusGraphics?.setVisible(false);
    this.alternativeGraphics?.setVisible(false);
    this.plaque?.setAlpha(0);
  }

  private ensureObjects(): void {
    if (this.focusGraphics) return;
    this.alternativeGraphics = this.scene.add.graphics().setDepth(DEPTH.LOCAL_UI);
    this.focusGraphics = this.scene.add.graphics().setDepth(DEPTH.LOCAL_UI);
    registerGraphicsObject(this.scene, 'weaponTelegraphs', this.alternativeGraphics);
    registerGraphicsObject(this.scene, 'weaponTelegraphs', this.focusGraphics);
    this.plaque = new WorldPlaque(this.scene, true);
  }

  private syncAlternatives(alternatives: readonly WorldInteractionFootprint[], enter: number): void {
    const shown = alternatives.slice(0, WORLD_INTERACTION_LAYOUT.maxAlternatives);
    const signature = shown.map(f => `${f.left},${f.top},${f.right},${f.bottom}`).join('|');
    if (signature !== this.alternativeSignature) {
      this.alternativeSignature = signature;
      const graphics = this.alternativeGraphics!.clear().setPosition(0, 0);
      for (const footprint of shown) {
        const rect = bracketRect(footprint);
        const corners = bracketCorners(rect, WORLD_INTERACTION_LAYOUT.secondaryArmPx);
        const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
        for (const corner of corners) {
          const points = corner.map(p => ({ x: p.x + cx, y: p.y + cy }));
          graphics.lineStyle(STROKE.width + 1.5, STROKE.shadow, 0.5).strokePoints(points as unknown as Phaser.Math.Vector2[], false, false)
            .lineStyle(STROKE.alternativeWidth, STROKE.ready, 1).strokePoints(points as unknown as Phaser.Math.Vector2[], false, false);
        }
      }
    }
    this.alternativeGraphics!.setAlpha(STROKE.alternativeAlpha * enter).setVisible(shown.length > 0);
  }

  private viewRect(): WorldRect {
    const view = this.scene.cameras?.main?.worldView;
    if (!view) return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    return { left: view.x, top: view.y, right: view.x + view.width, bottom: view.y + view.height };
  }
}

function drawBrackets(graphics: Phaser.GameObjects.Graphics, rect: WorldRect, arm: number, width: number, color: number): void {
  for (const corner of bracketCorners(rect, arm)) {
    graphics.lineStyle(STROKE.shadowWidth, STROKE.shadow, 0.72).strokePoints(corner as unknown as Phaser.Math.Vector2[], false, false)
      .lineStyle(width, color, 1).strokePoints(corner as unknown as Phaser.Math.Vector2[], false, false);
  }
}
