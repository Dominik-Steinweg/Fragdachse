import * as Phaser from 'phaser';
import { createWebGLStartupContext } from '../../../src/utils/webglContext';
import { getHeldItemAnchor } from '../../../src/config';
import runtime from '../../../src/config/pipelineAssets.json';
import { categoryLabels, models, constructionsFor, resolveSource, sampleFrame, supportsHeldView } from './library.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = { a: {}, b: {}, resolved: {}, clip: 'rest', elapsed: 0, playing: false, idle: true, angle: 0, travelTime: 0, ready: false };
const backgrounds = { grass: ['/assets/sprites/gras_bg_tile.png', 0x465a30], earth: ['/assets/sprites/dirt_material.png', 0x735845], steel: ['/assets/sprites/train/train_material_dark_top.png', 0x253033], light: [null, 0xb6bdb5] };
let library, scene, game, startup, observer, generation = 0;
const panels = [], pending = new Map(), loaded = new Set();
const playerAsset = runtime.assets.find(a => a.id === 'badger');
const label = r => `${r.asset.label} · ${r.construction.run}\n${r.variant.label || r.variant.variant} · ${r.source.size} px → ${r.asset.targetSize} Einheiten`;
const clip = () => state.resolved.a?.variant.clips?.find(c => c.name === state.clip);
const options = (id, entries, value) => { $(id).replaceChildren(...entries.map(([text, key]) => new Option(text, key))); $(id).value = String(value); };
const visibleSlots = () => ['a', ...($('compare').checked ? ['b'] : []), ...($('original').checked ? ['original'] : [])];
function showError(error) { $('error').hidden = false; $('error').textContent = error.message || String(error); }
function configure(which) {
  const r = resolveSource(library, state[which]);
  if (!r) throw new Error('Für dieses Modell ist kein vollständiger Export verfügbar.');
  state[which] = { id: r.asset.id, construction: r.construction.key, variant: r.variant.variant, size: r.source.size };
  state.resolved[which] = r;
  options(`run-${which}`, constructionsFor(library, r.asset.id).map(c => [`${c.run} · V${c.version}`, c.key]), r.construction.key);
  options(`variant-${which}`, r.asset.variants.map(v => [v.label || v.variant, v.variant]), r.variant.variant);
  options(`size-${which}`, [...r.variant.sources].sort((a, b) => a.size - b.size).map(s => [`${s.size} px${s.size === r.asset.targetSize ? ' · nativ' : ''}`, s.size]), r.source.size);
  $(`selection-${which}`).textContent = r.asset.preferred ? `Produktionsauswahl: ${r.asset.preferred.variant} · ${r.asset.preferred.size} px. ${r.asset.preferred.reason || ''}` : 'Noch keine Produktionsauswahl für diese Konstruktion.';
  const master = $(`master-${which}`), masterUrl = r.variant.master || r.source.idleUrl || r.source.url;
  if (master.getAttribute('src') !== masterUrl) {
    master.style.visibility = 'hidden';
    master.onload = () => { master.style.visibility = ''; };
    master.onerror = () => showError(new Error(`Detailbild konnte nicht geladen werden: ${masterUrl}`));
    master.src = masterUrl;
  }
  $(`master-caption-${which}`).textContent = label(r);
  $(`label-${which}`).textContent = `${which.toUpperCase()} · ${label(r)}`;
}
function drawLibrary() {
  const items = models(library, $('category').value, $('search').value);
  $('model-count').textContent = `${items.length}`; $('empty').hidden = !!items.length;
  $('model-list').replaceChildren(...items.map(asset => {
    const r = resolveSource(library, { id: asset.id });
    const button = document.createElement('button'); button.type = 'button'; button.className = 'model-card';
    button.setAttribute('aria-pressed', String(asset.id === state.a.id));
    const img = document.createElement('img'); img.src = r.source.idleUrl || r.source.url; img.alt = ''; img.loading = 'lazy';
    const title = document.createElement('span'); title.textContent = asset.label;
    const count = constructionsFor(library, asset.id).length;
    const subtitle = document.createElement('small'); subtitle.textContent = `${categoryLabels[asset.category] || asset.category} · ${count} ${count === 1 ? 'Konstruktion' : 'Konstruktionen'}`;
    title.append(subtitle); button.append(img, title); button.addEventListener('click', () => chooseModel(asset.id));
    return button;
  }));
}
function matchComparison() {
  const current = state.resolved.a;
  const otherVariant = current.asset.variants.find(v => v.variant !== current.variant.variant);
  const older = constructionsFor(library, current.asset.id).find(c => c.key !== current.construction.key);
  state.b = { id: current.asset.id, construction: otherVariant ? current.construction.key : older?.key || current.construction.key,
    variant: otherVariant?.variant, size: current.source.size };
  configure('b'); $('model-b').value = state.b.id;
}
function chooseModel(id) {
  const linked = !state.b.id || state.b.id === state.a.id;
  state.a = { id }; configure('a');
  if (linked) matchComparison();
  drawLibrary(); configureClips(); void refresh();
}
function configureClips() {
  const clips = state.resolved.a.variant.clips || [];
  options('clip', [['Ruhepose', 'rest'], ...clips.map(c => [c.name === 'move' ? 'Laufen' : c.name === 'idle' ? 'Atmen' : c.name === 'fire' ? 'Schießen' : c.name, c.name])], clips.some(c => c.name === state.clip) ? state.clip : clips[0]?.name || 'rest');
  state.clip = $('clip').value; rest();
  if (state.clip === 'move' || state.clip === 'idle') { state.idle = false; state.playing = true; }
  updateControls();
}
function updateControls() {
  const current = clip(), count = current?.frames.length || 1;
  const frame = current ? Math.min(count - 1, Math.floor(state.elapsed * current.frameRate + 1e-7)) : 0;
  $('frame').max = count - 1; $('frame').value = frame;
  $('frame').disabled = $('play').disabled = $('frame-back').disabled = $('frame-next').disabled = !current;
  $('play').textContent = state.playing ? 'Pause' : 'Abspielen'; $('play').setAttribute('aria-pressed', String(state.playing));
  $('frame-value').textContent = state.idle ? 'Ruhe' : `${frame + 1} / ${count}`;
  $('fire').hidden = $('sustain-control').hidden = state.clip !== 'fire';
  const bClip = state.resolved.b?.variant.clips?.find(c => c.name === state.clip);
  $('animation-info').textContent = current ? `${current.frameRate} fps · ${count} Frames. ${bClip ? 'A/B vergleichen dieselbe Bewegungsphase.' : 'B bleibt ohne passenden Clip in Ruhe.'}` : 'Statische Ruhepose. Rotation und Verschieben sind separat steuerbar.';
}
function rest() { state.elapsed = 0; state.playing = false; state.idle = true; $('sustain').checked = false; updateControls(); }
function start() { if (clip()) { state.elapsed = 0; state.playing = true; state.idle = false; updateControls(); } }
function seek(value) { const current = clip(); if (!current) return; state.playing = false; state.idle = false; state.elapsed = Math.max(0, Math.min(current.frames.length - 1, value)) / current.frameRate; updateControls(); }
function loadTexture(key, url, source, version) {
  if (scene.textures.exists(key)) return Promise.resolve();
  if (pending.has(key)) return pending.get(key);
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => { scene.load.off('filecomplete', done); scene.load.off('loaderror', fail); pending.delete(key); };
    const done = completed => { if (completed === key) { cleanup(); loaded.add(key); resolve(); } };
    const fail = file => { if (file.key === key) { cleanup(); reject(new Error(`Datei konnte nicht geladen werden: ${url}`)); } };
    scene.load.on('filecomplete', done); scene.load.on('loaderror', fail);
    if (version === 2 && source) scene.load.spritesheet(key, url, { frameWidth: source.frameWidth, frameHeight: source.frameHeight,
      margin: source.margin, spacing: source.spacing, endFrame: source.frameCount - 1 });
    else scene.load.image(key, url);
  });
  pending.set(key, promise);
  if (!scene.load.isLoading()) scene.load.start();
  return promise;
}
async function refresh() {
  if (!scene) return;
  const token = ++generation; state.ready = false; $('error').hidden = true;
  const a = state.resolved.a;
  $('asset-title').textContent = a.asset.label; $('asset-category').textContent = categoryLabels[a.asset.category] || a.asset.category;
  $('choice-b').hidden = $('master-b-figure').hidden = $('label-b').hidden = !$('compare').checked;
  document.querySelector('.review').classList.toggle('single', !$('compare').checked);
  $('label-original').hidden = !$('original').checked;
  const active = $('compare').checked ? [a, state.resolved.b] : [a];
  $('held-control').hidden = !active.some(r => Boolean(r.asset.heldItem));
  $('mount-control').hidden = !active.some(r => r.asset.category === 'turret');
  const reviewUrl = `/art/poc/pipeline-v${a.construction.version}/runs/${a.construction.run}/${a.asset.id}/review.png`;
  $('frame-overview').hidden = a.construction.version !== 2 || !a.variant.clips?.length;
  $('frame-overview-image').src = $('frame-overview-link').href = reviewUrl;
  $('metrics').textContent = active.map((r,i) => `${i ? 'B' : 'A'}: ${r.asset.forward === 'north' ? 'Norden' : 'Osten'} · ${r.asset.targetSize} Einheiten · ${r.variant.variant}${r.variant.nativeMetrics ? ` · belegte Fläche ${r.variant.nativeMetrics.width}×${r.variant.nativeMetrics.height} Pixel` : ''}`).join('\n');
  const keep = new Set(active.map(r => r.key));
  const originalKey = `${a.construction.key}/${a.asset.id}/original`;
  if ($('original').checked && a.asset.reference) keep.add(originalKey);
  try {
    await Promise.all([...active.map(r => loadTexture(r.key, r.source.url, { ...r.source, frameCount: r.source.frameCount ?? r.variant.frameCount }, r.construction.version)),
      ...($('original').checked && a.asset.reference ? [loadTexture(originalKey, a.asset.reference)] : [])]);
    if (token !== generation) return;
    for (const [i,which] of ['a','b','original'].entries()) {
      const r = which === 'original' ? a : state.resolved[which];
      const key = which === 'original' ? originalKey : r.key;
      panels[i].sprite.setTexture(scene.textures.exists(key) ? key : '__MISSING');
    }
    // Retain only the displayed source sheets, preventing unbounded GPU growth
    // while browsing many historical constructions.
    for (const key of loaded) if (!keep.has(key) && !pending.has(key)) { scene.textures.remove(key); loaded.delete(key); }
    state.ready = true; layout(); updateControls();
    const query = new URLSearchParams({ asset: state.a.id, version: String(a.construction.version), run: a.construction.run,
      variant: state.a.variant, size: String(state.a.size), b: state.b.id, br: state.b.construction, bv: state.b.variant, bs: String(state.b.size), compare: String($('compare').checked) });
    history.replaceState(null, '', `?${query}`);
  } catch (error) { if (token === generation) showError(error); }
}
function layout() {
  if (!scene) return;
  const active = [$('compare').checked ? state.resolved.b : null, state.resolved.a].filter(Boolean);
  const footprint = Math.max(...active.map(r => Boolean(r.asset.heldItem) && $('held').checked ? 76 : r.asset.targetSize));
  // Detail enlargement must also enlarge the review area: long held weapons and
  // boss sprites otherwise disappear behind its edge or the bottom labels.
  $('canvas').style.height = `${Math.max(245, footprint * Number($('factor').value) + 100)}px`;
  const w = $('canvas').clientWidth, h = $('canvas').clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  game.scale.resize(Math.round(w*dpr), Math.round(h*dpr)); game.canvas.style.width = `${w}px`; game.canvas.style.height = `${h}px`;
  scene.cameras.main.setZoom(dpr).setScroll(0,0).setOrigin(0,0);
  document.documentElement.style.setProperty('--columns', visibleSlots().length);
}
class ReviewScene extends Phaser.Scene {
  preload() {
    this.load.image('review-player', playerAsset.idlePath.replace(/^\./, ''));
    this.load.spritesheet('mount-rock', '/assets/sprites/rocks47blob.png', { frameWidth: 32, frameHeight: 32 });
    for (const [key,[url]] of Object.entries(backgrounds)) {
      if (url) this.load.image(`bg-${key}`,url);
    }
    this.load.on('loaderror', file => showError(new Error(`Datei fehlt: ${file.src}`)));
  }
  create() {
    scene=this;
    for (let i=0;i<3;i++) panels.push({fill:this.add.rectangle(0,0,1,1),tile:this.add.tileSprite(0,0,1,1,'bg-grass'),
      rock:this.add.image(0,0,'mount-rock',36),player:this.add.image(0,0,'review-player'),
      circle:this.add.circle(0,0,16).setStrokeStyle(1,0xe7c887,.7),sprite:this.add.sprite(0,0,'__MISSING')});
    observer=new ResizeObserver(layout); observer.observe($('canvas'));
    this.events.once('shutdown',()=>{observer.disconnect(); scene=null;});
    $('renderer').textContent=`Phaser ${Phaser.VERSION} · ${startup.rendererType.toUpperCase()}`;
    void refresh();
    window.assetReviewSnapshot=()=>({asset:state.a.id,a:state.a,b:state.b,ready:state.ready,angle:state.angle,
      animation:{clip:state.clip,elapsed:state.elapsed,playing:state.playing,idle:state.idle},
      sprites:panels.filter(p=>p.sprite.visible).map(p=>({source:p.sprite.texture.key,frame:p.sprite.frame.name,width:p.sprite.displayWidth,height:p.sprite.displayHeight,origin:[p.sprite.originX,p.sprite.originY]}))});
  }
  update(_time,delta) {
    if (!state.ready) { panels.forEach(p=>[p.sprite,p.player,p.rock,p.circle].forEach(o=>o.setVisible(false))); return; }
    const dt=Math.min(delta,100)/1000, current=clip(); state.travelTime+=dt;
    if (state.playing && current) {
      state.elapsed+=dt*Number($('time-scale').value);
      const duration=current.frames.length/current.frameRate;
      if (state.elapsed>=duration) {
        if (state.clip==='fire' ? $('sustain').checked : current.loop) state.elapsed%=duration;
        else rest();
      }
      updateControls();
    }
    if ($('rotate').checked) {state.angle=(state.angle+18*dt)%360; $('angle').value=state.angle; $('angle-value').textContent=`${Math.round(state.angle)}°`;}
    const visible=visibleSlots(),w=$('canvas').clientWidth,h=$('canvas').clientHeight,factor=Number($('factor').value),bg=$('background').value;
    for (const [i,which] of ['a','b','original'].entries()) {
      const p=panels[i],column=visible.indexOf(which),shown=column>=0;
      [p.fill,p.tile,p.sprite,p.circle,p.rock,p.player].forEach(o=>o.setVisible(shown)); if(!shown)continue;
      const r=which==='original'?state.resolved.a:state.resolved[which],a=r.asset;
      const x=w*(column+.5)/visible.length+($('move').checked?Math.sin(state.travelTime*.7)*Math.min(45,w/visible.length*.15):0), y=(h-55)*.5;
      p.fill.setFillStyle(backgrounds[bg][1]).setPosition(w*(column+.5)/visible.length,h/2).setSize(w/visible.length,h);
      p.tile.setVisible(bg!=='light').setPosition(w*(column+.5)/visible.length,h/2).setSize(w/visible.length,h); if(bg!=='light')p.tile.setTexture(`bg-${bg}`,'__BASE');
      const rotation=state.angle*Math.PI/180, size=a.targetSize*factor;
      p.rock.setVisible(a.category==='turret'&&$('mount').checked).setPosition(x,y).setDisplaySize(32*factor,32*factor);
      p.circle.setVisible(!!a.collisionDiameter&&$('collision').checked).setPosition(x,y).setRadius((a.collisionDiameter||0)*factor/2);
      const heldView=supportsHeldView(a,which==='original');
      p.player.setVisible(heldView&&$('held').checked).setPosition(x,y).setDisplaySize(32*factor,32*factor).setRotation(rotation);
      if (which!=='original'&&r.construction.version===2)p.sprite.setFrame(sampleFrame(r,state.clip,state.elapsed,state.idle,current));
      p.sprite.setOrigin(...a.pivot).setDisplaySize(size,size).setPosition(x,y).setRotation(rotation);
      if(heldView){
        const original=which==='original',grip=original?a.heldItem.referenceGrip:a.heldItem.grip;
        const fw=original?p.sprite.frame.cutWidth:a.targetSize,fh=original?p.sprite.frame.cutHeight:a.targetSize;
        p.sprite.setDisplaySize(fw*factor,fh*factor);
        if($('held').checked){const anchor=getHeldItemAnchor(x,y,rotation,factor);p.sprite.setOrigin(grip[0]/fw,grip[1]/fh).setPosition(anchor.x,anchor.y);}
        else if(original){const dx=(a.heldItem.grip[0]-grip[0]+fw/2-a.targetSize/2)*factor,dy=(a.heldItem.grip[1]-grip[1]+fh/2-a.targetSize/2)*factor;p.sprite.setPosition(x+Math.cos(rotation)*dx-Math.sin(rotation)*dy,y+Math.sin(rotation)*dx+Math.cos(rotation)*dy);}
      }else if(which==='original'&&a.referenceTransform){const t=a.referenceTransform,angle=rotation+(t.rotationOffset||0),dx=(t.centerCorrectionX||0)*factor,dy=(t.centerCorrectionY||0)*factor;p.sprite.setPosition(x+Math.cos(angle)*dx-Math.sin(angle)*dy,y+Math.sin(angle)*dx+Math.cos(angle)*dy).setRotation(angle);}
    }
  }
}
try {
  const response=await fetch('/art/poc/asset-library.json',{cache:'no-store'});
  if(response.ok)library=await response.json();
  else {const version=Number(params.get('version')||2),run=params.get('run')||'v2-g';if(!/^[a-z0-9][a-z0-9-]*$/.test(run)||![1,2].includes(version))throw new Error('Ungültige Konstruktion.');const res=await fetch(`/art/poc/pipeline-v${version}/runs/${run}/catalog.json`);if(!res.ok)throw new Error('Noch keine Modellbibliothek. Zuerst npm run assets:library ausführen.');const c=await res.json();library={constructions:[{key:`${version}/${run}`,version,run,assets:c.assets}]};}
  const all=models(library);if(!all.length)throw new Error('Die Modellbibliothek enthält noch keine Exporte.');
  state.a={id:params.get('asset')||all.find(a=>a.id==='badger')?.id||all[0].id,construction:params.has('run')?`${params.get('version')||2}/${params.get('run')}`:undefined,variant:params.get('variant'),size:Number(params.get('size'))};
  if(!all.some(a=>a.id===state.a.id))state.a={id:all[0].id};configure('a');
  options('model-b',all.map(a=>[`${a.label} · ${categoryLabels[a.category]||a.category}`,a.id]),state.a.id);
  if(params.get('b')&&all.some(a=>a.id===params.get('b'))){state.b={id:params.get('b'),construction:params.get('br'),variant:params.get('bv'),size:Number(params.get('bs'))};configure('b');$('model-b').value=state.b.id;}else matchComparison();
  $('compare').checked=params.get('compare')!=='false';drawLibrary();configureClips();
  for(const which of ['a','b'])for(const [id,field]of[['run','construction'],['variant','variant'],['size','size']])$(`${id}-${which}`).addEventListener('change',event=>{state[which][field]=field==='size'?Number(event.target.value):event.target.value;if(field==='construction')delete state[which].variant;configure(which);if(which==='a')configureClips();void refresh();});
  $('model-b').addEventListener('change',()=>{state.b={id:$('model-b').value};configure('b');void refresh();});
  $('match').addEventListener('click',()=>{matchComparison();void refresh();});
  for(const id of ['category','search'])$(id).addEventListener(id==='search'?'input':'change',drawLibrary);
  for(const id of ['compare','original'])$(id).addEventListener('change',()=>void refresh());
  $('factor').addEventListener('change',layout);
  $('held').addEventListener('change',layout);
  $('clip').addEventListener('change',()=>{state.clip=$('clip').value;rest();if(state.clip==='move'||state.clip==='idle')start();});
  $('play').addEventListener('click',()=>{if(state.playing){state.playing=false;updateControls();}else if(state.idle)start();else{state.playing=true;updateControls();}});
  $('idle').addEventListener('click',rest);$('fire').addEventListener('click',start);$('sustain').addEventListener('change',()=>{$('sustain').checked?start():rest();});
  $('frame').addEventListener('input',e=>seek(Number(e.target.value)));$('frame-back').addEventListener('click',()=>seek(Number($('frame').value)-1));$('frame-next').addEventListener('click',()=>seek(Number($('frame').value)+1));
  function angle(value){state.angle=Number(value);$('angle').value=value;$('angle-value').textContent=`${value}°`;$('rotate').checked=false;}
  $('angle').addEventListener('input',e=>angle(e.target.value));document.querySelectorAll('[data-angle]').forEach(b=>b.addEventListener('click',()=>angle(b.dataset.angle)));
  $('reset').addEventListener('click',()=>{angle(0);$('factor').value='1';$('background').value='grass';$('move').checked=$('collision').checked=$('original').checked=false;$('held').checked=$('mount').checked=true;state.travelTime=0;rest();void refresh();});
  startup=createWebGLStartupContext();if(!startup)throw new Error('WebGL konnte nicht gestartet werden.');
  game=new Phaser.Game({type:Phaser.WEBGL,parent:'canvas',canvas:startup.canvas,context:startup.context,width:1000,height:245,backgroundColor:'#243238',scene:ReviewScene,banner:false,
    render:{antialias:true,pixelArt:false,roundPixels:false,smoothPixelArt:startup.rendererType==='webgl1'},scale:{mode:Phaser.Scale.NONE},audio:{noAudio:true}});
  window.addEventListener('pagehide',()=>{observer?.disconnect();game.destroy(true);},{once:true});
}catch(error){showError(error);}
