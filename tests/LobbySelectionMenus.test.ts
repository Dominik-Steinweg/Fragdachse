import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) } }));
vi.mock('../src/ui/uiTextures', () => ({ ensureFlatPanelTexture: () => 'panel', lerpColor: (color: number) => color }));
vi.mock('../src/ui/LoadoutIconLayout', () => ({ fitLoadoutIcon: (image: unknown) => image, getLoadoutIconTextureKey: (_scene: unknown, key: string) => key }));
vi.mock('../src/scenes/arena/ClarityCameraRegistry', () => ({ promoteToClarityCamera: vi.fn() }));
vi.mock('../src/ui/UiButton', () => ({
  UiButton: class {
    root: any;
    background: any;
    constructor(scene: any, options: any) {
      this.background = scene.add.rectangle(options.x, options.y, options.w, options.h).setInteractive();
      this.background.on('pointerdown', () => options.onClick?.());
      this.root = scene.add.container(0, 0, [this.background]);
    }
    getRoot() { return this.root; }
    getBackground() { return this.background; }
    setLabel() { return this; }
    setIcon() { return this; }
    setEnabled() { this.background.setInteractive(); return this; }
    setVisible(value: boolean) { this.root.setVisible(value); return this; }
    destroy() { this.root.destroy(); }
  },
}));

import { LoadoutSlotPicker, type LoadoutPickerOptions } from '../src/ui/LoadoutSlotPicker';
import { LobbyRosterScroller } from '../src/ui/LobbyRosterScroller';
import { LobbySettingsControls } from '../src/ui/LobbySettingsControls';
import { LOBBY_CARD } from '../src/ui/LobbyLayout';
import { promoteToClarityCamera } from '../src/scenes/arena/ClarityCameraRegistry';

/** Minimal display objects for selection/scroll input contracts; no rendering emulation. */
class Display extends EventEmitter {
  children: Display[] = [];
  parentContainer: Display | null = null;
  visible = true;
  destroyed = false;
  displayHeight = this.height;
  input: { enabled: boolean } | null = null;
  constructor(public kind: string, public x = 0, public y = 0, public width = 0, public height = 0) { super(); }
  setOrigin() { return this; }
  setScrollFactor() { return this; }
  setAlpha() { return this; }
  setStrokeStyle() { return this; }
  setFillStyle() { return this; }
  setColor() { return this; }
  setText() { return this; }
  setX(x: number) { this.x = x; return this; }
  setDepth() { return this; }
  setVisible(visible: boolean) { this.visible = visible; return this; }
  setY(y: number) { this.y = y; return this; }
  setDisplaySize(_width: number, height: number) { this.displayHeight = height; return this; }
  setInteractive() { this.input = { enabled: true }; return this; }
  disableInteractive() { if (this.input) this.input.enabled = false; return this; }
  add(children: Display | Display[]) {
    for (const child of Array.isArray(children) ? children : [children]) {
      child.parentContainer = this;
      this.children.push(child);
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    this.emit('destroy');
    this.children.forEach(child => child.destroy());
    this.removeAllListeners();
  }
}

function fixture(standalone = false) {
  const created: Display[] = [];
  const add = (kind: string, x: number, y: number, width = 0, height = 0) => {
    const object = new Display(kind, x, y, width, height);
    created.push(object);
    return object;
  };
  const keyboard = new EventEmitter();
  const input = Object.assign(new EventEmitter(), { keyboard });
  const scene = {
    input, scale: { width: 1920 }, textures: { exists: () => false },
    add: {
      rectangle: (x: number, y: number, w: number, h: number) => add('rectangle', x, y, w, h),
      image: (x: number, y: number) => add('image', x, y),
      circle: (x: number, y: number) => add('circle', x, y),
      text: (x: number, y: number) => add('text', x, y),
      container: (x: number, y: number, children: Display[]) => add('container', x, y).add(children),
    },
  };
  const parent = new Display('parent');
  const picker = new LoadoutSlotPicker(scene as any, parent as any, 20, standalone);
  return { scene, input, keyboard, created, parent, picker };
}

function options(count = 20): LoadoutPickerOptions {
  return {
    title: 'Map', anchorX: 400, anchorY: 470,
    columns: 5, entryWidth: 52, entryHeight: 40, centeredLabels: true,
    groups: [{ label: null, entries: Array.from({ length: count }, (_, index) => ({
      key: String(index + 1), displayName: String(index + 1), textureKey: null, accentColor: 0xffffff,
      selected: index === 0, disabled: false, onPick: vi.fn(),
    })) }],
  };
}

const click = (object: Display) => object.emit('pointerdown', {}, 0, 0, { stopPropagation: vi.fn() });

describe('Lobby selection menus', () => {
  it('allows host selection while rejecting guests and closing choices on a readiness lock', () => {
    const { scene, parent, created, keyboard } = fixture();
    let host = false;
    let mode = 'deathmatch';
    const bridge = {
      isHost: () => host, getGameMode: () => mode, getCoopDefenseMapId: () => '1',
      getLobbyTimeOfDayMinutes: () => 720,
      setGameMode: vi.fn(next => { mode = next; }), setCoopDefenseMapId: vi.fn(),
    };
    const settings = new LobbySettingsControls(scene as any, bridge as any, parent as any);
    const modeButton = created.find(object => object.kind === 'rectangle')!;
    click(modeButton);
    expect(settings.isOpen()).toBe(false);
    host = true;
    settings.refresh();
    click(modeButton);
    expect(settings.isOpen()).toBe(true);
    const choice = created.filter(object => object.kind === 'rectangle' && object.width === 300)[1];
    click(choice);
    expect(bridge.setGameMode).toHaveBeenCalledWith('team_deathmatch');
    expect(settings.isOpen()).toBe(false);
    click(modeButton);
    settings.setLocked(true);
    expect(settings.isOpen()).toBe(false);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);
    click(modeButton);
    expect(settings.isOpen()).toBe(false);
    settings.destroy();
  });

  it('shows twenty map choices as a complete five-by-four grid without scrolling', () => {
    const { picker, created, input } = fixture();
    picker.open(options());
    const entries = created.filter(object => object.kind === 'rectangle' && object.width === 52);
    expect(entries).toHaveLength(20);
    expect(new Set(entries.map(entry => entry.x)).size).toBe(5);
    expect(new Set(entries.map(entry => entry.y)).size).toBe(4);
    expect(entries.every(entry => entry.visible && entry.input?.enabled)).toBe(true);
    expect(input.listenerCount('wheel')).toBe(0);
    picker.close();
  });

  it('commits one selection, ignores disabled choices and releases Escape on close', () => {
    const { picker, created, keyboard } = fixture();
    const menu = options(2);
    const entries = menu.groups[0].entries;
    picker.open({ ...menu, groups: [{ label: null, entries: [{ ...entries[0], disabled: true }, entries[1]] }] });
    const rows = created.filter(object => object.kind === 'rectangle' && object.width === 52);
    click(rows[0]);
    expect(entries[0].onPick).not.toHaveBeenCalled();
    expect(picker.isOpen()).toBe(true);
    click(rows[1]);
    expect(entries[1].onPick).toHaveBeenCalledOnce();
    expect(picker.isOpen()).toBe(false);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);
  });

  it('dismisses on outside click and Escape without selecting, including repeated opens', () => {
    const { picker, created, keyboard } = fixture();
    const menu = options(1);
    picker.open(menu);
    click(created.find(object => object.kind === 'rectangle' && object.width === 1920)!);
    expect(picker.isOpen()).toBe(false);
    picker.open(menu);
    picker.open(menu);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(1);
    keyboard.emit('keydown-ESC', { stopImmediatePropagation: vi.fn() });
    expect(picker.isOpen()).toBe(false);
    expect(menu.groups[0].entries[0].onPick).not.toHaveBeenCalled();
  });

  it('places lobby popups above both cards and closes them when their owner is destroyed', () => {
    const { picker, parent, keyboard } = fixture(true);
    picker.open(options());
    expect(parent.children).toHaveLength(0);
    expect(promoteToClarityCamera).toHaveBeenCalled();
    parent.destroy();
    expect(picker.isOpen()).toBe(false);
    expect(keyboard.listenerCount('keydown-ESC')).toBe(0);
  });
});

describe('Lobby roster scrolling', () => {
  it('scrolls only inside the roster, blocks modal input and clamps after players leave', () => {
    const { scene, input, parent } = fixture();
    const changed = vi.fn();
    const scroller = new LobbyRosterScroller(scene as any, parent as any, () => true, changed);
    scroller.setContentHeight(900);
    const pointer = { x: LOBBY_CARD.left + LOBBY_CARD.padding + 20, y: LOBBY_CARD.rosterTop + 20 };
    input.emit('wheel', { ...pointer, y: LOBBY_CARD.readyY }, [], 0, 120);
    expect(scroller.scrollOffset).toBe(0);
    input.emit('wheel', pointer, [], 0, 120);
    expect(scroller.scrollOffset).toBeGreaterThan(0);
    const offset = scroller.scrollOffset;
    input.emit('wheel', pointer, [new Display('modal')], 0, 120);
    expect(scroller.scrollOffset).toBe(offset);
    scroller.setContentHeight(100);
    expect(scroller.scrollOffset).toBe(0);
    expect(parent.children.every(child => !child.visible)).toBe(true);
    scroller.destroy();
    expect(input.listenerCount('wheel')).toBe(0);
    expect(input.listenerCount('pointermove')).toBe(0);
    expect(changed).toHaveBeenCalledOnce();
  });
});
