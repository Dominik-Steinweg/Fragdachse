import * as Phaser from 'phaser';
import { createWebGLStartupContext } from '../../../src/utils/webglContext';

const $ = id => document.getElementById(id);
const title = source => source.label || (source.variant === 'rich' ? 'Detailreich' : 'Ruhig');
const run = new URLSearchParams(location.search).get('run') || 'v1-e';
const state = { asset: 0, angle: 0, elapsed: 0, columns: 3, sources: [], sprites: [], circles: [], backgrounds: [] };
let scene, game, catalog, startup;
const backgrounds = {
  grass: ['/assets/sprites/gras_bg_tile.png', 0x465a30],
  earth: ['/assets/sprites/dirt47blob.png', 0x735845],
  steel: ['/assets/sprites/train/train_material_dark_top.png', 0x253033],
  light: [null, 0xb6bdb5],
};

function asset() { return catalog.assets[state.asset]; }
function dimensions() {
  const cssWidth = $('canvas').clientWidth, cssHeight = $('canvas').clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { cssWidth, cssHeight, dpr };
}
function selected(which) { return state.sources[Number($(which).value)]; }
const measure = m => m ? ` · ${m.width}×${m.height} px / ${m.area} Pixel ab 50% Alpha` : '';
function labels() {
  if (!scene || !state.sprites.length) return;
  const current = asset();
  const size = (Number($('profile').value) || current.targetSize) * Number($('factor').value);
  for (const [index, id] of ['source-a', 'source-b'].entries()) {
    const source = selected(id);
    state.sprites[index].setTexture(source.key).setDisplaySize(size, size).setOrigin(...current.pivot);
    $(`label-${index ? 'b' : 'a'}`).textContent = `${source.size} px Quelle → ${+size.toFixed(2)} Einheiten`;
    $(`master-${index ? 'b' : 'a'}`).src = source.master;
  }
  const originalIndex = current.previousReference ? 3 : 2;
  if (current.previousReference) {
    state.sprites[2].setTexture(`${current.id}-previous`).setDisplaySize(size, size).setOrigin(...current.pivot);
    $('label-previous').textContent = `${current.previousReference.sourceSize} px Quelle → ${+size.toFixed(2)} Einheiten`;
  }
  state.sprites[originalIndex].setTexture(`${current.id}-original`).setDisplaySize(size, size).setOrigin(...current.pivot);
  state.sprites.forEach((s, i) => s.setVisible(i < state.columns));
  const diameter = (current.collisionDiameter || 0) * Number($('factor').value);
  state.circles.forEach((c, i) => {
    c.setRadius(diameter / 2).setVisible(i < state.columns && !!diameter && $('collision').checked);
  });
  $('collision').disabled = !current.collisionDiameter;
  $('collision-info').textContent = diameter ? `Ø ${+diameter.toFixed(2)} Einheiten · nur Vorschau` : 'Für dieses Asset kein Kollisionskreis hinterlegt';
  const original = scene.textures.get(`${current.id}-original`).getSourceImage();
  $('label-original').textContent = `${original.width} px Original → ${+size.toFixed(2)} Einheiten`;
  const orientation = `${current.forward === 'north' ? 'Norden' : 'Osten'} bei 0° · Drehpunkt ${current.pivot.join(' / ')}.`;
  $('metrics').textContent = current.referenceMetrics
    ? `${orientation} Messung der nativen ${current.targetSize}-px-Datei:\nA${measure(selected('source-a').nativeMetrics)}\nB${measure(selected('source-b').nativeMetrics)}${current.previousReference ? '\n' + current.previousReference.label + measure(current.previousReference.nativeMetrics) : ''}\nOriginal${measure(current.referenceMetrics)}`
    : `${orientation} Canvas bleibt vollständig erhalten. Für diesen älteren Run liegen keine nativen Flächenmessungen vor.`;
}
function chooseAsset() {
  state.asset = Number($('asset').value);
  state.columns = asset().previousReference ? 4 : 3;
  document.documentElement.style.setProperty('--columns', state.columns);
  $('previous-heading').hidden = $('label-previous').hidden = !asset().previousReference;
  $('previous-title').textContent = asset().previousReference?.label || '';
  state.sources = asset().variants.flatMap(v => v.sources.map(s => ({ ...s, variant: v.variant, label: v.label, nativeMetrics: v.nativeMetrics, master: v.master, key: `${asset().id}-${v.variant}-${s.size}` })));
  for (const id of ['source-a', 'source-b']) {
    $(id).replaceChildren(...state.sources.map((s, i) => new Option(`${title(s)} · ${s.size} px${s.size === asset().targetSize ? ' (Prüfung)' : ''}`, i)));
  }
  const preferred = asset().preferred;
  const variant = preferred?.variant || 'calm';
  const size = preferred?.size || (asset().previousReference ? Math.max(...state.sources.map(s => s.size)) : state.sources.find(s => s.size > asset().targetSize).size);
  $('source-a').value = String(state.sources.findIndex(s => s.variant === variant && s.size === size));
  $('source-b').value = String(state.sources.findIndex(s => s.variant !== variant && s.size === size));
  labels(); layout(); setBackground();
}
function layout() {
  if (!scene) return;
  const { cssWidth: w, cssHeight: h, dpr } = dimensions();
  game.scale.resize(Math.round(w * dpr), Math.round(h * dpr));
  game.canvas.style.width = `${w}px`;
  game.canvas.style.height = `${h}px`;
  scene.cameras.main.setZoom(dpr).setScroll(0, 0).setOrigin(0, 0);
  for (let i = 0; i < state.columns; i++) {
    const [fill, tile] = state.backgrounds[i];
    const x = w * (i + .5) / state.columns;
    fill.setPosition(x, h / 2).setSize(w / state.columns, h);
    tile.setPosition(x, h / 2).setSize(w / state.columns, h);
  }
}
function setBackground() {
  const key = $('background').value;
  for (const [i, [fill, tile]] of state.backgrounds.entries()) {
    fill.setFillStyle(backgrounds[key][1]).setVisible(i < state.columns);
    tile.setVisible(i < state.columns && key !== 'light');
    if (key !== 'light') tile.setTexture(`bg-${key}`, key === 'earth' ? 12 : '__BASE');
  }
}

class ReviewScene extends Phaser.Scene {
  preload() {
    for (const [key, [url]] of Object.entries(backgrounds)) {
      if (key === 'earth') this.load.spritesheet('bg-earth', url, { frameWidth: 32, frameHeight: 32 });
      else if (url) this.load.image(`bg-${key}`, url);
    }
    for (const a of catalog.assets) {
      this.load.image(`${a.id}-original`, a.reference);
      if (a.previousReference) this.load.image(`${a.id}-previous`, a.previousReference.url);
      for (const v of a.variants) for (const s of v.sources) this.load.image(`${a.id}-${v.variant}-${s.size}`, s.url);
    }
    this.load.on('loaderror', file => showError(`Datei fehlt: ${file.src}. Export des Runs erneut prüfen.`));
  }
  create() {
    scene = this;
    for (let i = 0; i < 4; i++) {
      state.backgrounds.push([this.add.rectangle(0, 0, 1, 1, 0x465a30), this.add.tileSprite(0, 0, 1, 1, 'bg-grass')]);
    }
    state.circles = Array.from({ length: 4 }, () => this.add.circle(0, 0, 16).setStrokeStyle(1, 0xe7c887, .8));
    state.sprites = Array.from({ length: 4 }, () => this.add.image(0, 0, `${catalog.assets[0].id}-original`));
    chooseAsset(); layout(); setBackground();
    $('renderer').textContent = `Phaser ${Phaser.VERSION} · ${startup.rendererType.toUpperCase()} · DPR ${dimensions().dpr}`;
    // Read-only measurements for browser QA; never exposes game runtime or mutable objects.
    window.assetReviewSnapshot = () => ({ run, asset: asset().id, renderer: startup.rendererType, angle: state.angle, moving: $('move').checked, rotating: $('rotate').checked,
      background: $('background').value, dpr: dimensions().dpr, sprites: state.sprites.filter(s => s.visible).map(s => ({ source: s.texture.key, width: s.displayWidth, height: s.displayHeight, x: s.x, y: s.y, rotation: s.angle })), circles: state.circles.filter(c => c.visible).map(c => ({ diameter: c.radius * 2, x: c.x, y: c.y })) });
    new ResizeObserver(layout).observe($('canvas'));
  }
  update(_time, delta) {
    if (!scene) return;
    const dt = Math.min(delta, 100) / 1000;
    state.elapsed += dt;
    if ($('rotate').checked) {
      state.angle = (state.angle + 18 * dt) % 360;
      $('angle').value = state.angle;
      $('angle-value').textContent = `${Math.round(state.angle)}°`;
    }
    const { cssWidth: w, cssHeight: h } = dimensions();
    const travel = Math.max(0, Math.min(65, w / (2 * state.columns) - state.sprites[0].displayWidth / 2 - 12));
    const move = $('move').checked ? Math.sin(state.elapsed * .35) * travel : 0;
    state.sprites.forEach((s, i) => {
      const x = w * (i + .5) / state.columns + move, y = h * .46;
      s.setPosition(x, y).setAngle(state.angle);
      state.circles[i].setPosition(x, y);
    });
  }
}
function showError(message) { $('error').hidden = false; $('error').textContent = message; }
try {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(run)) throw new Error('Ungültige Run-ID.');
  const response = await fetch(`/art/poc/pipeline-v1/runs/${run}/catalog.json`);
  if (!response.ok) throw new Error(`Run ${run} fehlt. Zuerst Blender-Render und Export ausführen.`);
  catalog = await response.json();
  if (catalog.version !== 1 || !catalog.assets?.length) throw new Error('Ungültiger oder leerer Asset-Katalog.');
  $('asset').replaceChildren(...catalog.assets.map((a, i) => new Option(a.label, i)));
  startup = createWebGLStartupContext();
  if (!startup) throw new Error('WebGL konnte nicht gestartet werden.');
  game = new Phaser.Game({ type: Phaser.WEBGL, parent: 'canvas', canvas: startup.canvas, context: startup.context,
    width: 1000, height: 260, backgroundColor: '#28372e', scene: ReviewScene, banner: false,
    render: { antialias: true, pixelArt: false, roundPixels: false, smoothPixelArt: startup.rendererType === 'webgl1' },
    scale: { mode: Phaser.Scale.NONE }, audio: { noAudio: true } });
  $('asset').addEventListener('change', chooseAsset);
  for (const id of ['source-a', 'source-b', 'profile', 'factor', 'collision']) $(id).addEventListener('change', labels);
  $('background').addEventListener('change', setBackground);
  function angle(value) { state.angle = Number(value); $('angle').value = value; $('angle-value').textContent = `${value}°`; $('rotate').checked = false; }
  $('angle').addEventListener('input', event => angle(event.target.value));
  document.querySelectorAll('[data-angle]').forEach(button => button.addEventListener('click', () => angle(button.dataset.angle)));
} catch (error) { showError(error.message); }
