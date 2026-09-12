import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Scenes: { Events: { UPDATE: 'update', POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
}));
vi.mock('../../src/utils/phaserFx', () => ({ addExternalGlow: () => null, removeExternalFx: () => {} }));

// Observe the UI -> effect boundary. The real field, sampling and quality lifecycle are
// exercised in the core tests; these tests execute the consumers' builders and transitions.
const effects: TestEffect[] = [];
class TestEffect {
  active: boolean;
  destroyed = false;
  filledWidth: number;
  marker = new UiObject('living');
  constructor(_scene: unknown, public parent: UiObject, public x: number, public y: number,
    public width: number, public height: number, _palette: unknown, public opts: any = {}) {
    this.active = opts.startActive ?? true;
    this.filledWidth = width;
    effects.push(this);
    parent.add(this.marker);
    parent.once('destroy', () => this.destroy());
  }
  start() { if (!this.destroyed) this.active = true; }
  stop() { this.active = false; }
  destroy() { this.stop(); this.destroyed = true; }
  setFilledWidth(width: number) { this.filledWidth = width; }
  setEnergyIntensity() {}
}
vi.mock('../../src/ui/LivingBarEffect', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/ui/LivingBarEffect')>(),
  LivingBarEffect: function (...args: ConstructorParameters<typeof TestEffect>) { return new TestEffect(...args); },
}));

import { UiButton } from '../../src/ui/UiButton';
import { LobbyOverlay } from '../../src/scenes/LobbyOverlay';
import { OptionsOverlay } from '../../src/ui/OptionsOverlay';
import { LeftSidePanel } from '../../src/ui/LeftSidePanel';
import { CenterHUD } from '../../src/ui/CenterHUD';
import { CoopDefenseUpgradesOverlay } from '../../src/ui/CoopDefenseUpgradesOverlay';

class UiObject extends EventEmitter {
  visible = true;
  active = true;
  alpha = 1;
  width = 40;
  height = 20;
  scaleX = 1;
  scaleY = 1;
  scrollFactorX = 1;
  scrollFactorY = 1;
  list: UiObject[] = [];
  parentContainer: UiObject | null = null;
  texture = { key: '' };
  crop: number[] = [];
  constructor(public kind: string, public x = 0, public y = 0) { super(); this.setMaxListeners(0); }
  add(objects: UiObject | UiObject[]) {
    for (const object of Array.isArray(objects) ? objects : [objects]) { this.list.push(object); object.parentContainer = this; }
    return this;
  }
  addAt(object: UiObject, index: number) { this.list.splice(index, 0, object); object.parentContainer = this; return this; }
  removeAll(destroy = false) { if (destroy) for (const child of [...this.list]) child.destroy(); this.list = []; return this; }
  setVisible(v: boolean) { this.visible = v; return this; }
  setAlpha(a: number) { this.alpha = a; return this; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setX(x: number) { this.x = x; return this; }
  setY(y: number) { this.y = y; return this; }
  setTexture(key: string) { this.texture.key = key; return this; }
  setScrollFactor(x: number, y = x) { this.scrollFactorX = x; this.scrollFactorY = y; return this; }
  setCrop(...crop: number[]) { this.crop = crop; return this; }
  setText() { return this; }
  setColor() { return this; }
  setOrigin() { return this; }
  setDisplaySize() { return this; }
  setDepth() { return this; }
  setInteractive() { return this; }
  disableInteractive() { return this; }
  setStrokeStyle() { return this; }
  setStroke() { return this; }
  setFillStyle() { return this; }
  setTint() { return this; }
  setBlendMode() { return this; }
  destroy() { if (!this.active) return; this.active = false; this.emit('destroy'); this.removeAll(true); }
}

function sceneStub() {
  const tweens: any[] = [];
  const scene: any = {
    input: new EventEmitter(), events: new EventEmitter(),
    tweens: { add: (config: any) => {
      const tween = { ...config, removed: false, remove() { this.removed = true; }, destroy() { this.removed = true; } };
      tweens.push(tween);
      return tween;
    } },
    time: { now: 0, delayedCall: () => ({ destroy() {} }) },
    textures: {
      exists: () => true, remove() {},
      createCanvas: () => ({ context: {
        createLinearGradient: () => ({ addColorStop() {} }), fillRect() {},
      }, refresh() {} }),
    },
    add: {
      container: (x = 0, y = 0, children: UiObject[] = []) => new UiObject('container', x, y).add(children),
      image: (x = 0, y = 0, key: string) => new UiObject('image', x, y).setTexture(key),
      text: (x = 0, y = 0) => new UiObject('text', x, y),
      rectangle: (x = 0, y = 0) => new UiObject('rectangle', x, y),
      circle: (x = 0, y = 0) => new UiObject('circle', x, y),
    },
  };
  return { scene, tweens };
}

beforeEach(() => { effects.length = 0; });

describe('living UI consumer ownership', () => {
  it('places button decoration between face and content, including badges and hover transforms', () => {
    const { scene, tweens } = sceneStub();
    const button = new UiButton(scene, { x: 400, y: 120, w: 190, h: 44, label: 'Items', icon: 'lock' });
    const layer = button.getEffectLayer() as unknown as UiObject;
    layer.add(new UiObject('living'));
    button.setBadge(2);
    const root = button.getRoot() as unknown as UiObject;
    expect(root.list.map(child => child.kind)).toEqual(['image', 'container', 'image', 'text', 'container']);
    expect(layer.parentContainer).toBe(root);
    expect([layer.x, layer.y, layer.scrollFactorX, layer.scrollFactorY]).toEqual([0, 0, 0, 0]);
    expect(button.getEffectBounds()).toEqual({ x: -93, y: -20, width: 186, height: 40, radius: 12 });
    button.getBackground().emit('pointerover');
    expect(tweens.at(-1).targets).toBe(root);
    button.destroy();
    expect(layer.active).toBe(false);
    expect(layer.list).toEqual([]);
  });

  it('binds both Lobby button effects to their layers and to actual Coop-band visibility', () => {
    const { scene } = sceneStub();
    const lobby: any = new (LobbyOverlay as any)(scene, {});
    // Isolate the Coop band from roster/network widgets, retaining its real construction.
    for (const method of ['attachItemsLockTooltip', 'layoutList', 'updateCoopDefenseMenuButtons',
      'updateWorldEntryButtons', 'updateReadyGlow', 'stopReadyGlow']) lobby[method] = () => {};
    lobby.container = new UiObject('container');
    lobby.buildCoopBand([]);
    expect(effects.every(effect => !effect.active)).toBe(true);
    for (const [effect, button] of [[lobby.upgradeBtnEffect, lobby.coopUpgradesBtn], [lobby.itemsBtnEffect, lobby.coopItemsBtn]]) {
      expect(effect.parent).toBe(button.getEffectLayer());
      expect(effect.opts.clipShape).toEqual({ kind: 'roundedRect', ...button.getEffectBounds() });
    }
    expect(lobby.upgradeBtnEffect.opts.variantKey).not.toBe(lobby.itemsBtnEffect.opts.variantKey);
    const progress = { level: 2, levelProgressFraction: 0.5, availableUpgradePoints: 1, availableBossPoints: 0, earnedBossPoints: 0 };
    lobby.setCoopDefenseItemsState(true, 2, false); // Items may arrive before Progress.
    lobby.setCoopDefenseProgress(progress);
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.show();
    expect(effects.every(effect => effect.active)).toBe(true);
    lobby.setCoopDefenseProgress(null);
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.setCoopDefenseItemsState(true, 2, false); // Cached state must stay paused.
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.setCoopDefenseProgress(progress);
    expect(effects.every(effect => effect.active)).toBe(true);
    lobby.hide();
    expect(effects.every(effect => !effect.active)).toBe(true);
    lobby.show(); // No new snapshot required to restore the last state.
    expect(effects.every(effect => effect.active)).toBe(true);
  });

  it('starts and stops Options slider effects, preserving hidden fill updates', () => {
    const { scene, tweens } = sceneStub();
    const options: any = new OptionsOverlay(scene, { setMasterVolume() {} } as never, {} as never);
    options.container = new UiObject('container').setVisible(false);
    options.buildSlider({ key: 'master', label: 'Master', trackY: 100, palette: { dark: 0, mid: 1, light: 2 } }, []);
    for (const method of ['syncFromAudioSystem', 'syncQualityButtons', 'syncAbortSection']) options[method] = () => {};
    expect(effects[0].active).toBe(false);
    options.show();
    expect(effects[0].active).toBe(true);
    options.hide();
    expect(effects[0].active).toBe(false);
    const fadeOut = tweens.at(-1);
    options.setSliderValue('master', 0.25, false, false);
    const storedWidth = effects[0].filledWidth;
    options.show();
    expect(fadeOut.removed).toBe(true);
    expect(effects[0].active).toBe(true);
    expect(effects[0].filledWidth).toBe(storedWidth);
    options.hide();
    options.destroy();
    expect(effects[0].destroyed).toBe(true);
  });

  it('keeps built and closed color swatches inactive, including late refreshes', () => {
    const { scene } = sceneStub();
    const bridge = { getAvailableColors: () => [], getPlayerColor: () => 0, getLocalPlayerId: () => 'local' };
    const panel: any = new LeftSidePanel(scene, bridge as never, {} as never, {} as never);
    panel.pickerContainer = panel.buildPickerContainer();
    panel.schedulePickerDismissListener = () => {};
    expect(effects.length).toBeGreaterThan(1);
    expect(effects.every(effect => !effect.active && effect.opts.sampling === 'compact')).toBe(true);
    bridge.getAvailableColors = () => panel.pickerSwatches.map((swatch: any) => swatch.color);
    panel.openColorPicker();
    expect(effects.every(effect => effect.active)).toBe(true);
    panel.closeColorPicker();
    expect(effects.every(effect => !effect.active)).toBe(true);
    panel.refreshPickerSwatches();
    expect(effects.every(effect => !effect.active)).toBe(true);
    panel.destroyPickerEffects();
    expect(effects.every(effect => effect.destroyed)).toBe(true);
  });

  it('keeps lower HUD bars inactive on build and immediately stops them when the root hides', () => {
    const { scene } = sceneStub();
    const hud: any = new CenterHUD(scene);
    hud.container = new UiObject('container').setVisible(false);
    hud.buildTimer();
    hud.buildBottomStack();
    expect(effects).toHaveLength(3);
    expect(effects.every(effect => !effect.active)).toBe(true);
    hud.transitionToGame();
    hud.showLowerSection(hud.armorSection, 'Armor', 0.5, 0, 0);
    expect(effects[0].active).toBe(true);
    hud.hideLowerSection(hud.armorSection); // Begin the normal visible fade.
    hud.resetCoopMissionPresentation = () => {};
    hud.hideTrainWidget = () => {};
    hud.transitionToLobby();
    expect(effects.every(effect => !effect.active)).toBe(true);
    hud.showLowerSection(hud.armorSection, 'Armor', 0.7, 0, 0);
    hud.setSectionEnergized(hud.armorSection, true);
    expect(effects[0].active).toBe(false);
    hud.transitionToGame();
    hud.showLowerSection(hud.armorSection, 'Armor', 0.7, 0, 0);
    expect(effects[0].active).toBe(true);
  });

  it('uses the full node contour and stable identity even for hidden partial fills', () => {
    const { scene } = sceneStub();
    const overlay: any = new (CoopDefenseUpgradesOverlay as any)(scene);
    overlay.upgradesContainer = new UiObject('container');
    overlay.getNodeTextureKey = () => null;
    const visuals = { nodeBase: 0, nodeStroke: 1, nodeActive: 2, connector: 3 };
    const node = { id: 'test-upgrade', label: 'Upgrade', kind: 'upgrade', unlocked: true,
      level: 1, maxLevel: 2, startingLevel: 0, refundable: true, bossPointCostPerLevel: 0 };
    overlay.renderNode({ node, x: 100, y: 100 }, visuals);
    const effect = effects[0];
    expect(effect.active).toBe(false);
    expect(effect.opts.sampling).toBe('compact');
    expect(effect.opts.variantKey).toBe(node.id);
    const clip = effect.opts.clipShape;
    expect(effect.y).toBe(clip.y + clip.height / 2);
    expect(effect.height).toBe(clip.height / 2);
    expect(clip.width).toBe(clip.height);
    const group = overlay.upgradesContainer.list[0];
    expect(group.list.indexOf(effect.marker)).toBeGreaterThan(0);
    expect(group.list.findIndex((child: UiObject) => child.kind === 'text')).toBeGreaterThan(group.list.indexOf(effect.marker));
    overlay.visible = true;
    overlay.container = new UiObject('container');
    overlay.hide();
    expect(effect.destroyed).toBe(true);
    overlay.renderNode({ node: { ...node, id: 'base', kind: 'unlock', startingLevel: 1, refundable: false }, x: 0, y: 0 }, visuals);
    expect(effects).toHaveLength(1); // Base unlocks stay static.
  });

  it('cancels a stale upgrade fade when reopened and starts its XP effect again', () => {
    const { scene, tweens } = sceneStub();
    const overlay: any = new (CoopDefenseUpgradesOverlay as any)(scene);
    overlay.container = new UiObject('container').setVisible(false);
    overlay.xpBarEffect = new TestEffect(scene, overlay.container, 0, 0, 100, 12, {}, { startActive: false });
    overlay.refresh = () => {}; // Node refresh ownership is independent of the container fade.
    overlay.show();
    overlay.hide();
    const fadeOut = tweens.at(-1);
    expect(overlay.xpBarEffect.active).toBe(false);
    overlay.show();
    expect(fadeOut.removed).toBe(true);
    expect(overlay.xpBarEffect.active).toBe(true);
    overlay.destroy();
    expect(tweens.at(-1).removed).toBe(true);
    expect(effects.every(effect => effect.destroyed)).toBe(true);
  });
});
