import * as Phaser from 'phaser';
import { createWebGLStartupContext } from '../../../src/utils/webglContext';

const $ = id => document.getElementById(id);
const title = source => source.label || (source.variant === 'rich' ? 'Detailreich' : 'Ruhig');
const parameters = new URLSearchParams(location.search);
const version = Number(parameters.get('version') || 1);
const run = parameters.get('run') || (version === 2 ? 'v2-a' : 'v1-f');
const state = { asset: 0, angle: 0, elapsed: 0, columns: 3, sources: [], sprites: [], circles: [], backgrounds: [], rocks: [],
  clip: 'idle', clipTime: 0, clipFrame: 0, playing: false, idle: true };
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
function currentClip(source = selected('source-a')) { return source?.clips?.find(clip => clip.name === state.clip); }
function displaySize() { return (Number($('profile').value) || asset().targetSize) * Number($('factor').value); }
function sourceFrame(source) {
  const clip = currentClip(source);
  return state.idle || !clip ? (source.idleFrame ?? 0) : clip.frames[Math.min(state.clipFrame, clip.frames.length - 1)];
}
function updateAnimationControls() {
  if (version !== 2) return;
  const clip = currentClip();
  const lastFrame = Math.max(0, (clip?.frames.length || 1) - 1);
  $('frame').max = lastFrame;
  $('frame').value = state.clipFrame;
  $('frame').disabled = !clip;
  $('frame-back').disabled = $('frame-next').disabled = !clip;
  $('play').disabled = !clip;
  $('play').textContent = state.playing ? 'Pause' : 'Abspielen';
  $('play').setAttribute('aria-pressed', String(state.playing));
  $('frame-value').textContent = `${sourceFrame(selected('source-a'))}${state.idle ? ' · Ruhe' : ` · ${state.clipFrame + 1}/${lastFrame + 1}`}`;
  $('fire').hidden = $('sustain-control').hidden = state.clip !== 'fire';
  $('animation-info').textContent = clip
    ? `${clip.name === 'move' ? 'Bewegung' : 'Schießen'} · ${clip.frameRate} fps · ${clip.frames.length} Frames · A und B synchron. Verschieben und Drehen sind unabhängig.`
    : 'Statische Ruhepose. Verschieben und Drehen ändern die Animation nicht.';
}
function applyAnimationFrame() {
  if (version !== 2 || !state.sprites.length) return;
  for (const [index, id] of ['source-a', 'source-b'].entries()) {
    const source = selected(id);
    // One shared review clock drives both sources. Phaser's independent sprite clocks would
    // drift after source changes and would make frame stepping an unreliable A/B comparison.
    if (state.sprites[index].texture.key === source.key) state.sprites[index].setFrame(sourceFrame(source));
  }
  updateAnimationControls();
}
function rest() {
  state.playing = false; state.idle = true; state.clipFrame = 0; state.clipTime = 0;
  $('sustain').checked = false;
  applyAnimationFrame();
}
function startClip() {
  if (!currentClip()) return;
  state.playing = true; state.idle = false; state.clipFrame = 0; state.clipTime = 0;
  applyAnimationFrame();
}
function selectClip() {
  state.clip = $('clip').value;
  rest();
  // Movement previews start immediately. A turret rests until the reviewer fires it.
  if (state.clip === 'move') startClip();
}
function configureClips() {
  if (version !== 2) return;
  const clips = selected('source-a').clips || [];
  $('clip').replaceChildren(new Option('Ruhepose', 'idle'), ...clips.map(clip =>
    new Option(clip.name === 'move' ? 'Normales Bewegen' : clip.name === 'fire' ? 'Schießen' : clip.name, clip.name)));
  $('clip').value = clips.some(clip => clip.name === state.clip) ? state.clip : clips[0]?.name || 'idle';
  selectClip();
}
function seekFrame(frame) {
  const clip = currentClip();
  if (!clip) return;
  state.playing = false; state.idle = false;
  state.clipFrame = Math.max(0, Math.min(clip.frames.length - 1, frame));
  state.clipTime = state.clipFrame * 1000 / clip.frameRate;
  applyAnimationFrame();
}
function advanceAnimation(delta) {
  if (version !== 2 || !state.playing) return;
  const clip = currentClip();
  if (!clip) return;
  state.clipTime += delta * Number($('time-scale').value);
  const duration = clip.frames.length * 1000 / clip.frameRate;
  const loop = state.clip === 'fire' ? $('sustain').checked : clip.loop;
  if (state.clipTime >= duration) {
    if (!loop) { rest(); return; }
    state.clipTime %= duration;
  }
  const nextFrame = Math.floor(state.clipTime * clip.frameRate / 1000);
  if (state.clipFrame !== nextFrame) { state.clipFrame = nextFrame; applyAnimationFrame(); }
}
const measure = m => m ? ` · ${m.width}×${m.height} px / ${m.area} Pixel ab 50% Alpha` : '';
function labels() {
  if (!scene || !state.sprites.length) return;
  const current = asset();
  const size = displaySize();
  for (const [index, id] of ['source-a', 'source-b'].entries()) {
    const source = selected(id);
    state.sprites[index].setTexture(source.key, version === 2 ? sourceFrame(source) : undefined).setDisplaySize(size, size).setOrigin(...current.pivot);
    $(`label-${index ? 'b' : 'a'}`).textContent = `${source.size} px Quelle → ${+size.toFixed(2)} Einheiten`;
    $(`master-${index ? 'b' : 'a'}`).src = source.master || source.idleUrl || source.url;
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
  const mounted = version === 2 && current.category === 'turret';
  $('mount-control').hidden = !mounted;
  state.rocks.forEach((rock, i) => rock.setDisplaySize(32 * Number($('factor').value), 32 * Number($('factor').value))
    .setVisible(mounted && i < state.columns && $('mount').checked));
  $('mount-info').textContent = mounted ? `Fels 32×32 · Unterbau ${current.mount ? `maximal Ø ${current.mount.maxBaseDiameter}` : 'ältere Referenz ohne Maßprüfung'} · Läufe dürfen überragen` : '';
  const original = scene.textures.get(`${current.id}-original`).getSourceImage();
  $('label-original').textContent = `${original.width} px Original → ${+size.toFixed(2)} Einheiten`;
  const orientation = `${current.forward === 'north' ? 'Norden' : 'Osten'} bei 0° · Drehpunkt ${current.pivot.join(' / ')}.`;
  $('metrics').textContent = current.referenceMetrics
    ? `${orientation} Messung der nativen ${current.targetSize}-px-Datei:\nA${measure(selected('source-a').nativeMetrics)}\nB${measure(selected('source-b').nativeMetrics)}${current.previousReference ? '\n' + current.previousReference.label + measure(current.previousReference.nativeMetrics) : ''}\nOriginal${measure(current.referenceMetrics)}`
    : `${orientation} Canvas bleibt vollständig erhalten. Für diesen älteren Run liegen keine nativen Flächenmessungen vor.`;
  if (version === 2) {
    $('metrics').textContent += `\nZellen ohne Rand: A ${selected('source-a').frameWidth}×${selected('source-a').frameHeight}, B ${selected('source-b').frameWidth}×${selected('source-b').frameHeight} px. Original bleibt statisch.`;
    updateAnimationControls();
  }
  if (current.preferred?.reason) $('metrics').textContent += `\nAuswahl: ${current.preferred.reason}`;
}
function chooseAsset() {
  state.asset = Number($('asset').value);
  if (version === 2) {
    const reviewUrl = `/art/poc/pipeline-v2/runs/${encodeURIComponent(run)}/${encodeURIComponent(asset().id)}/review.png`;
    $('frame-overview-image').src = $('frame-overview-link').href = reviewUrl;
    $('frame-overview-image').alt = `Sämtliche Animationsframes von ${asset().label} in beiden Materialvarianten`;
    $('frame-overview-caption').textContent = `${asset().variants[0].frameCount} Frames pro Materialvariante, einschließlich Ruheframe 0. Beide Varianten stehen untereinander; die Frames folgen von links nach rechts, dann in der nächsten Zeile. Jede Figur bleibt in ihrer Nominalgröße von ${asset().targetSize} CSS-Pixeln. Auf schmalen Fenstern horizontal scrollen.`;
  }
  state.columns = asset().previousReference ? 4 : 3;
  document.documentElement.style.setProperty('--columns', state.columns);
  $('previous-heading').hidden = $('label-previous').hidden = !asset().previousReference;
  $('previous-title').textContent = asset().previousReference?.label || '';
  state.sources = asset().variants.flatMap(v => v.sources.map(s => ({ ...s, variant: v.variant, label: v.label, clips: v.clips,
    idleFrame: v.idleFrame, frameCount: s.frameCount ?? v.frameCount, nativeMetrics: v.nativeMetrics, master: v.master, key: `${asset().id}-${v.variant}-${s.size}` })));
  for (const id of ['source-a', 'source-b']) {
    $(id).replaceChildren(...state.sources.map((s, i) => new Option(`${title(s)} · ${s.size} px${s.size === asset().targetSize ? ' (Prüfung)' : ''}`, i)));
  }
  const preferred = asset().preferred;
  const variant = preferred?.variant || 'calm';
  const size = preferred?.size || (asset().previousReference ? Math.max(...state.sources.map(s => s.size)) : state.sources.find(s => s.size > asset().targetSize)?.size || state.sources[0].size);
  const firstIndex = state.sources.findIndex(s => s.variant === variant && s.size === size);
  $('source-a').value = String(firstIndex < 0 ? 0 : firstIndex);
  const secondIndex = state.sources.findIndex(s => s.variant !== selected('source-a').variant && s.size === selected('source-a').size);
  $('source-b').value = String(secondIndex < 0 ? Math.min(Number($('source-a').value) + 1, state.sources.length - 1) : secondIndex);
  state.clip = 'idle';
  configureClips();
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
    if (version === 2) this.load.spritesheet('mount-rock', '/assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    for (const [key, [url]] of Object.entries(backgrounds)) {
      if (key === 'earth') this.load.spritesheet('bg-earth', url, { frameWidth: 32, frameHeight: 32 });
      else if (url) this.load.image(`bg-${key}`, url);
    }
    for (const a of catalog.assets) {
      this.load.image(`${a.id}-original`, a.reference);
      if (a.previousReference) this.load.image(`${a.id}-previous`, a.previousReference.url);
      for (const v of a.variants) for (const s of v.sources) {
        const key = `${a.id}-${v.variant}-${s.size}`;
        if (version === 2) this.load.spritesheet(key, s.url, {
          frameWidth: s.frameWidth, frameHeight: s.frameHeight, margin: s.margin, spacing: s.spacing,
          endFrame: (s.frameCount ?? v.frameCount) - 1,
        });
        else this.load.image(key, s.url);
      }
    }
    this.load.on('loaderror', file => showError(`Datei fehlt: ${file.src}. Export des Runs erneut prüfen.`));
  }
  create() {
    scene = this;
    for (let i = 0; i < 4; i++) {
      state.backgrounds.push([this.add.rectangle(0, 0, 1, 1, 0x465a30), this.add.tileSprite(0, 0, 1, 1, 'bg-grass')]);
    }
    if (version === 2) state.rocks = Array.from({ length: 4 }, () => this.add.image(0, 0, 'mount-rock', 36).setDisplaySize(32, 32));
    state.circles = Array.from({ length: 4 }, () => this.add.circle(0, 0, 16).setStrokeStyle(1, 0xe7c887, .8));
    state.sprites = Array.from({ length: 4 }, () => this.add.sprite(0, 0, `${catalog.assets[0].id}-original`));
    chooseAsset(); layout(); setBackground();
    $('renderer').textContent = `Phaser ${Phaser.VERSION} · ${startup.rendererType.toUpperCase()} · DPR ${dimensions().dpr}`;
    // Read-only measurements for browser QA; never exposes game runtime or mutable objects.
    window.assetReviewSnapshot = () => ({ version, run, asset: asset().id, renderer: startup.rendererType, angle: state.angle, moving: $('move').checked, rotating: $('rotate').checked,
      background: $('background').value, dpr: dimensions().dpr, targetSize: asset().targetSize, displaySize: displaySize(),
      animation: { clip: state.clip, frame: state.clipFrame, idle: state.idle, playing: state.playing,
        frameRate: currentClip()?.frameRate ?? 0, frameCount: currentClip()?.frames.length ?? 1,
        timeScale: Number($('time-scale').value), sustained: $('sustain').checked, authoredLoop: currentClip()?.loop ?? false },
      sprites: state.sprites.filter(s => s.visible).map((s, i) => ({ source: s.texture.key, frame: s.frame.name,
        width: s.displayWidth, height: s.displayHeight, frameWidth: s.frame.cutWidth, frameHeight: s.frame.cutHeight,
        textureWidth: s.texture.getSourceImage().width, textureHeight: s.texture.getSourceImage().height,
        x: s.x, y: s.y, rotation: s.angle, origin: [s.originX, s.originY],
        ...(i < 2 && version === 2 ? { margin: selected(i ? 'source-b' : 'source-a').margin, spacing: selected(i ? 'source-b' : 'source-a').spacing,
          columns: selected(i ? 'source-b' : 'source-a').columns, rows: selected(i ? 'source-b' : 'source-a').rows } : {}) })),
      circles: state.circles.filter(c => c.visible).map(c => ({ diameter: c.radius * 2, x: c.x, y: c.y })) });
    new ResizeObserver(layout).observe($('canvas'));
  }
  update(_time, delta) {
    if (!scene) return;
    const dt = Math.min(delta, 100) / 1000;
    advanceAnimation(Math.min(delta, 100));
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
      const referenceIndex = asset().previousReference ? 3 : 2;
      const transform = i === referenceIndex ? asset().referenceTransform : undefined;
      const rotation = state.angle + (transform?.rotationOffset || 0) * 180 / Math.PI;
      const radians = rotation * Math.PI / 180;
      const referenceScale = displaySize() / asset().targetSize;
      const correctionX = (transform?.centerCorrectionX || 0) * referenceScale;
      const correctionY = (transform?.centerCorrectionY || 0) * referenceScale;
      s.setPosition(x + Math.cos(radians) * correctionX - Math.sin(radians) * correctionY,
        y + Math.sin(radians) * correctionX + Math.cos(radians) * correctionY).setAngle(rotation);
      state.circles[i].setPosition(x, y);
      state.rocks[i]?.setPosition(x, y);
    });
  }
}
function showError(message) { $('error').hidden = false; $('error').textContent = message; }
try {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(run)) throw new Error('Ungültige Run-ID.');
  if (version !== 1 && version !== 2) throw new Error('Unbekannte Pipeline-Version. Unterstützt werden 1 und 2.');
  const response = await fetch(`/art/poc/pipeline-v${version}/runs/${run}/catalog.json`);
  if (!response.ok) throw new Error(`Run ${run} fehlt. Zuerst Blender-Render und Export ausführen.`);
  catalog = await response.json();
  if (catalog.version !== version || !catalog.assets?.length) throw new Error('Ungültiger oder leerer Asset-Katalog.');
  $('pipeline-version').textContent = `FRAGDACHSE / ASSET PIPELINE V${version} · ${run}`;
  $('animation-controls').hidden = version !== 2;
  $('frame-overview').hidden = version !== 2;
  $('asset').replaceChildren(...catalog.assets.map((a, i) => new Option(a.label, i)));
  startup = createWebGLStartupContext();
  if (!startup) throw new Error('WebGL konnte nicht gestartet werden.');
  game = new Phaser.Game({ type: Phaser.WEBGL, parent: 'canvas', canvas: startup.canvas, context: startup.context,
    width: 1000, height: 260, backgroundColor: '#28372e', scene: ReviewScene, banner: false,
    render: { antialias: true, pixelArt: false, roundPixels: false, smoothPixelArt: startup.rendererType === 'webgl1' },
    scale: { mode: Phaser.Scale.NONE }, audio: { noAudio: true } });
  $('asset').addEventListener('change', chooseAsset);
  $('mount').addEventListener('change', labels);
  for (const id of ['source-a', 'source-b', 'profile', 'factor', 'collision']) $(id).addEventListener('change', labels);
  $('clip').addEventListener('change', selectClip);
  $('play').addEventListener('click', () => {
    if (state.playing) { state.playing = false; updateAnimationControls(); }
    else if (state.idle) startClip();
    else { state.playing = true; updateAnimationControls(); }
  });
  $('idle').addEventListener('click', rest);
  $('fire').addEventListener('click', startClip);
  $('sustain').addEventListener('change', () => { if ($('sustain').checked) startClip(); else rest(); });
  $('frame').addEventListener('input', event => seekFrame(Number(event.target.value)));
  $('frame-back').addEventListener('click', () => seekFrame(state.clipFrame - 1));
  $('frame-next').addEventListener('click', () => seekFrame(state.clipFrame + 1));
  $('background').addEventListener('change', setBackground);
  function angle(value) { state.angle = Number(value); $('angle').value = value; $('angle-value').textContent = `${value}°`; $('rotate').checked = false; }
  $('angle').addEventListener('input', event => angle(event.target.value));
  document.querySelectorAll('[data-angle]').forEach(button => button.addEventListener('click', () => angle(button.dataset.angle)));
} catch (error) { showError(error.message); }
