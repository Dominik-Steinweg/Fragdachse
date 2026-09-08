import { createFakeArenaScene } from './fakeArenaRenderScene';

/** Observable geometry, lifecycle and writes; unrelated cosmetic methods are inert. */
export class HealthTestObject {
  active = true;
  visible = true;
  alpha = 1;
  depth = 0;
  originX = 0.5;
  originY = 0.5;
  cameraFilter = 0;
  fillColor = 0;
  fillAlpha = 1;
  strokeWidth = 0;
  rotation = 0;
  flipX = false;
  flipY = false;
  scaleX = 1;
  scaleY = 1;
  displayWidth = 32;
  displayHeight = 32;
  writes = 0;
  texture = { key: 'test', source: [{ width: 32, height: 32 }] };
  frame = { name: '__BASE', width: 32, height: 32 };
  anims = { isPlaying: false, currentAnim: null, stop() {} };
  body: any = null;
  private destroyListeners: (() => void)[] = [];
  constructor(public scene: any, public x = 0, public y = 0, public width = 1, public height = 1) {}
  setPosition(x: number, y: number) { this.x = x; this.y = y; this.writes++; return this; }
  setSize(w: number, h: number) { this.width = w; this.height = h; this.writes++; return this; }
  setVisible(v: boolean) { this.visible = v; this.writes++; return this; }
  setActive(v: boolean) { this.active = v; return this; }
  setOrigin(x: number, y = x) { this.originX = x; this.originY = y; return this; }
  setDepth(v: number) { this.depth = v; return this; }
  setAlpha(v: number) { this.alpha = v; this.writes++; return this; }
  setFillStyle(color: number, alpha = 1) { this.fillColor = color; this.fillAlpha = alpha; this.writes++; return this; }
  setStrokeStyle(width = 0) { this.strokeWidth = width; return this; }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setRotation(v: number) { this.rotation = v; return this; }
  setFlip(x: boolean, y: boolean) { this.flipX = x; this.flipY = y; return this; }
  setDisplaySize(w: number, h = w) { this.displayWidth = w; this.displayHeight = h; return this; }
  setScrollFactor() { return this; }
  setTint() { return this; }
  clearTint() { return this; }
  setTexture(key: string, frame = '__BASE') { this.texture.key = key; this.frame.name = frame; return this; }
  setData() { return this; }
  setBlendMode() { return this; }
  setFrame() { return this; }
  setPadding() { return this; }
  play() { return this; }
  stop() { return this; }
  start() { return this; }
  setFrequency() { return this; }
  setCrop() { return this; }
  killAll() { return this; }
  forEachDead() { return this; }
  startFollow() { return this; }
  clear() { return this; }
  lineStyle() { return this; }
  strokeCircle() { return this; }
  lineBetween() { return this; }
  setText() { return this; }
  setAngle() { return this; }
  setEmitterAlpha() { return this; }
  once(event: string, callback: () => void) { if (event === 'destroy') this.destroyListeners.push(callback); return this; }
  destroy() { this.active = this.visible = false; for (const callback of this.destroyListeners) callback(); }
}

export function healthBarTestScene() {
  const scene: any = createFakeArenaScene();
  const rectangles: HealthTestObject[] = [];
  const cosmetic: HealthTestObject[] = [];
  scene.cameras = { main: { id: 1, zoom: 1, zoomX: 1 } };
  scene.scale = { displayScale: { x: 1 } };
  scene.time = { now: 0 };
  scene.events = { on() {}, once() {}, off() {} };
  scene.tweens = { add: () => ({ stop() {} }), killTweensOf() {} };
  scene.add.rectangle = (x: number, y: number, w: number, h: number, color: number, alpha = 1) => {
    const object = new HealthTestObject(scene, x, y, w, h).setFillStyle(color, alpha);
    rectangles.push(object);
    return object;
  };
  for (const kind of ['sprite', 'image', 'ellipse', 'text', 'graphics', 'circle', 'zone', 'particles']) {
    scene.add[kind] = (x = 0, y = 0) => {
      const object = new HealthTestObject(scene, x, y);
      cosmetic.push(object);
      return object;
    };
  }
  scene.physics = { add: {
    existing(object: HealthTestObject) {
      const body: any = { velocity: { x: 0, y: 0 }, setCircle() {}, setCollideWorldBounds() {},
        setBounce() {}, setSize() {}, updateFromGameObject() {},
        reset(x: number, y: number) { object.setPosition(x, y); },
        setVelocity(x: number, y: number) { body.velocity.x = x; body.velocity.y = y; },
      };
      object.body = body;
    },
    staticGroup: () => ({ add() {}, clear() {}, destroy() {} }),
  } };
  return { scene, rectangles, cosmetic };
}
