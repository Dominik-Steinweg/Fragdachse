import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
vi.mock('phaser', () => ({ Math: { Vector2: class { constructor(public x: number, public y: number) {} } } }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
import { WorldInteractionRenderer } from '../src/effects/WorldInteractionRenderer';
import { WORLD_INTERACTION_LAYOUT, bracketArm, bracketCorners, bracketRect,
  layoutInteractionPlaque } from '../src/ui/worldInteraction/WorldInteractionLayout';

const view = { left: 0, top: 0, right: 1920, bottom: 1080 };
const plaque = { width: 180, height: 30 };
const watchtower = { left: 400, top: 400, right: 464, bottom: 464 };

describe('Shift focus layout', () => {
  it('scales bracket arms with the object and keeps them within half of the shorter side', () => {
    const cell = bracketRect({ left: 0, top: 0, right: 32, bottom: 32 });
    expect(bracketArm(cell)).toBe(11);
    expect(bracketArm(bracketRect({ left: 0, top: 0, right: 128, bottom: 96 }))).toBe(WORLD_INTERACTION_LAYOUT.armMaxPx);
    const tiny = bracketRect({ left: 0, top: 0, right: 4, bottom: 4 });
    expect(bracketArm(tiny)).toBeLessThanOrEqual((tiny.right - tiny.left) / 2 + WORLD_INTERACTION_LAYOUT.armMinPx);
    const corners = bracketCorners(cell, 8);
    expect(corners).toHaveLength(4);
    expect(corners[0][1]).toEqual({ x: -(cell.right - cell.left) / 2, y: -(cell.bottom - cell.top) / 2 });
  });

  it('places the plaque on the side away from the player and points it at the object', () => {
    const south = layoutInteractionPlaque(watchtower, { x: 432, y: 520 }, plaque, view);
    expect(south.side).toBe('above');
    expect(south.y + plaque.height).toBeLessThan(bracketRect(watchtower).top);
    const north = layoutInteractionPlaque(watchtower, { x: 432, y: 340 }, plaque, view);
    expect(north.side).toBe('below');
    expect(north.y).toBeGreaterThan(bracketRect(watchtower).bottom);
    for (const layout of [south, north]) {
      expect(layout.pointerX).toBeGreaterThanOrEqual(watchtower.left);
      expect(layout.pointerX).toBeLessThanOrEqual(watchtower.right);
    }
  });

  it('flips at the view edge and slides along it while the pointer stays on the object', () => {
    const top = { left: 900, top: 10, right: 932, bottom: 42 };
    expect(layoutInteractionPlaque(top, { x: 916, y: 120 }, plaque, view).side).toBe('below');
    const corner = { left: 1900, top: 500, right: 1932, bottom: 532 };
    const layout = layoutInteractionPlaque(corner, { x: 1880, y: 600 }, plaque, view);
    expect(layout.x + plaque.width / 2).toBeLessThanOrEqual(view.right - WORLD_INTERACTION_LAYOUT.viewMarginPx);
    expect(layout.pointerX).toBeGreaterThan(layout.x);
    expect(layout.pointerX).toBeLessThanOrEqual(layout.x + plaque.width / 2 - 10);
  });
});

function fakeScene(now = 0) {
  const objects: any[] = [];
  const element = (kind: string) => {
    const object: any = { kind, visible: true, alpha: 1, text: '', width: 60, destroy: vi.fn() };
    for (const method of ['setDepth', 'setOrigin', 'clear', 'lineStyle', 'strokePoints', 'fillStyle', 'fillRoundedRect',
      'strokeRoundedRect', 'fillCircle', 'fillTriangle', 'setColor', 'setScale']) object[method] = vi.fn(() => object);
    object.setPosition = vi.fn((x: number, y: number) => { object.x = x; object.y = y; return object; });
    object.setVisible = vi.fn((visible: boolean) => { object.visible = visible; return object; });
    object.setAlpha = vi.fn((alpha: number) => { object.alpha = alpha; return object; });
    object.setText = vi.fn((text: string) => { object.text = text; return object; });
    objects.push(object);
    return object;
  };
  const scene = { time: { now }, cameras: { main: { worldView: { x: 0, y: 0, width: 1920, height: 1080 } } },
    add: { graphics: () => element('graphics'), text: () => element('text') } };
  return { scene, objects };
}

describe('Shift focus renderer', () => {
  it('frames the real footprint, labels verb and object, and marks reachable alternatives faintly', () => {
    const f = fakeScene();
    const renderer = new WorldInteractionRenderer(f.scene as unknown as Phaser.Scene);
    renderer.sync({ focus: { key: 'watchtower:3', label: 'Besteigen', subject: 'Wachturm', footprint: watchtower },
      alternatives: [{ left: 500, top: 400, right: 532, bottom: 432 }] }, { x: 432, y: 520 });
    const [alternatives, brackets] = f.objects.filter(object => object.kind === 'graphics');
    const rect = bracketRect(watchtower);
    expect(brackets.x).toBe((rect.left + rect.right) / 2);
    expect(brackets.y).toBe((rect.top + rect.bottom) / 2);
    expect(brackets.strokePoints).toHaveBeenCalledTimes(8);
    expect(brackets.setScale).toHaveBeenLastCalledWith(1 + 0.14);
    expect(f.objects.some(object => object.text === 'Besteigen')).toBe(true);
    expect(f.objects.some(object => object.text === '· Wachturm')).toBe(true);
    expect(alternatives.visible).toBe(true);
    expect(alternatives.alpha).toBeLessThan(0.5);

    f.scene.time.now = 1000;
    renderer.sync({ focus: { key: 'watchtower:3', label: 'Besteigen', subject: 'Wachturm', footprint: watchtower },
      alternatives: [] }, { x: 432, y: 520 });
    expect(brackets.setScale).toHaveBeenLastCalledWith(1);
    expect(brackets.strokePoints).toHaveBeenCalledTimes(8);
    expect(alternatives.visible).toBe(false);

    renderer.sync({ focus: null, alternatives: [] });
    expect(brackets.visible).toBe(false);
    renderer.clear();
    for (const object of f.objects) expect(object.destroy).toHaveBeenCalledOnce();
  });

  it('shows a blocked object by name with its short reason', () => {
    const f = fakeScene();
    const renderer = new WorldInteractionRenderer(f.scene as unknown as Phaser.Scene);
    renderer.sync({ focus: { key: 'lobby-menu:base', label: 'Öffnen', subject: 'Bauhof', blocked: 'Nur für den Host',
      footprint: watchtower }, alternatives: [] }, null);
    expect(f.objects.some(object => object.text === 'Bauhof')).toBe(true);
    expect(f.objects.some(object => object.text === '· Nur für den Host')).toBe(true);
    expect(f.objects.some(object => object.text === 'Öffnen')).toBe(false);
  });
});
