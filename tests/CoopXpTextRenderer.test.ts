import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { CoopXpTextRenderer } from '../src/effects/CoopXpTextRenderer';
import { DEPTH } from '../src/config';

class Label {
  scene: object | undefined = {};
  font = '';
  text = ''; x = 0; y = 0; alpha = 1; active = false; visible = false;
  width = 30; height = 16; depth = 0; destroyed = false; listed = true;
  setFont(font: string) { this.font = font; return this; }
  setOrigin() { return this; }
  setDisplayOrigin() { return this; }
  setDepth(depth: number) { this.depth = depth; return this; }
  setText(text: string) { this.text = text; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setAlpha(alpha: number) { this.alpha = alpha; return this; }
  setVisible(value: boolean) { this.visible = value; return this; }
  setActive(value: boolean) { this.active = value; return this; }
  removeFromDisplayList() { this.listed = false; return this; }
  addToDisplayList() { this.listed = true; return this; }
  destroy() { this.destroyed = true; this.listed = false; this.scene = undefined; }
}

function setup() {
  const labels: Label[] = [];
  const fonts = new Map();
  const textures = new Map();
  const events = new EventEmitter();
  const stats = { textObjects: 0, rasterizations: 0, uploads: 0, glyphDraws: 0 };
  const scene = {
    events, tweens: { timeScale: 1 },
    cache: { bitmapFont: { add: (key: string, data: unknown) => fonts.set(key, data),
      remove: (key: string) => fonts.delete(key) } },
    textures: {
      createCanvas: (key: string, width: number, height: number) => {
        const texture = { width, height, context: {
          strokeText: () => stats.glyphDraws++, fillText: () => stats.glyphDraws++,
        },
          refresh: () => stats.uploads++ };
        textures.set(key, texture);
        return texture;
      },
      remove: (key: string) => textures.delete(key),
    },
    make: { text: () => {
      stats.textObjects++;
      return { width: 14, height: 18, canvas: {}, style: { getTextMetrics: () => ({ ascent: 10 }) },
        context: { font: '10px sans-serif', measureText: (text: string) => ({ width: text.length * 6 }) },
        setStroke() { return this; },
        setText() { stats.rasterizations++; return this; }, destroy() {} };
    } },
    add: { bitmapText: () => { const label = new Label(); labels.push(label); return label; } },
  };
  const renderer = new CoopXpTextRenderer(scene as never);
  const prepare = () => { while (!renderer.prepare()) { /* loading ticks */ } };
  return { renderer, prepare, scene, events, stats, labels, fonts, textures };
}

describe('Coop XP text presentation', () => {
  it('prepares shared glyphs without popups and reuses objects across changing numbers', () => {
    const h = setup();
    h.prepare();
    expect(h.labels.every(label => !label.listed && !label.active)).toBe(true);
    expect(h.events.listenerCount('update')).toBe(0);
    const prepared = { ...h.stats };
    const count = h.labels.length;
    for (const xp of [1, 12, 345, 6789]) {
      h.renderer.play(100, 200, xp);
      const label = h.labels.find(label => label.active)!;
      expect(label.text).toBe(`+${xp} XP`);
      expect([label.x, label.y, label.depth]).toEqual([100, 182, DEPTH.OVERLAY - 5]);
      h.events.emit('update', 0, 475);
      expect(label.y).toBeCloseTo(147.5);
      expect(label.alpha).toBeCloseTo(0.25);
      h.events.emit('update', 475, 475);
      expect(label.active).toBe(false);
    }
    expect(h.stats).toEqual(prepared);
    expect(h.labels).toHaveLength(count);
    expect(h.events.listenerCount('update')).toBe(0);
  });

  it('keeps every simultaneous popup and releases excess capacity after a burst', () => {
    const h = setup();
    h.prepare();
    for (let i = 0; i < 300; i++) h.renderer.play(i, 100, i + 1);
    expect(h.labels.filter(label => label.active && label.font.endsWith('_fill'))).toHaveLength(300);
    h.events.emit('update', 0, 1000);
    expect(h.labels.every(label => !label.active)).toBe(true);
    expect(h.labels.filter(label => !label.destroyed).length).toBeLessThan(300);
    h.renderer.play(1, 2, 3);
    h.renderer.clear();
    expect(h.labels.every(label => !label.active && !label.listed)).toBe(true);
    expect(h.events.listenerCount('update')).toBe(0);
    h.renderer.play(2, 3, 4);
    h.renderer.destroy();
    expect(h.events.listenerCount('update')).toBe(0);
    expect(h.labels.every(label => label.destroyed)).toBe(true);
    expect(h.fonts.size).toBe(0);
    expect(h.textures.size).toBe(0);
  });

  it('cleans partially prepared resources and can prepare a fresh resource set', () => {
    const h = setup();
    expect(h.renderer.prepare()).toBe(false);
    h.renderer.destroy();
    expect(h.fonts.size).toBe(0);
    expect(h.textures.size).toBe(0);
    h.prepare();
    h.renderer.play(0, 0, 99);
    expect(h.labels.filter(label => label.active && label.font.endsWith('_fill'))).toHaveLength(1);
    h.renderer.destroy();
  });
});
