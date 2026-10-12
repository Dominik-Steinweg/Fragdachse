import { build } from 'vite';
import path from 'node:path';
import { repoRoot } from './export.mjs';
import assert from 'node:assert/strict';
import { resolveSource, resolveSpine, assetFromExport, samplePose, spineTransform, spineGrowth,
  advanceViewerPlayback, reviewDefaults } from './viewer/library.mjs';

// Small fixture protects socket geometry and clip-local release timing without a Blender build.
const volley = { name: 'spine-volley', frames: [10,11,12,13], frameRate: 2, markers: { raise: 0, 'release-1': 1, 'release-2': 3 } };
const body = { id: 'abyssal-kraken', variants: [{ variant: 'standard', clips: [volley], sources: [{size:64}] }] };
const spine = { id: 'abyssal-kraken-spine', variants: [{ variant: 'standard', sources: [{size:32}] }] };
const library = { constructions: [{key:'2/new',assets:[body]}, {key:'2/old',assets:[body,spine]}] };
const resolved = resolveSource(library,{id:body.id,construction:'2/new'});
assert.equal(resolveSpine(library,resolved),null);
assert.equal(resolveSpine(library,resolveSource(library,{id:body.id,construction:'2/old'})).construction.key,'2/old');
const sockets = {spine1:{x:.6,y:.5,z:2},spine1Tip:{x:.8,y:.5,z:2}};
const report = {manifest:{...body,variant:'standard',idleFrame:0,frames:[{file:'idle.png'}],sockets:{base:[.5,.8],tip:[.5,.2]},socketFrames:[sockets]},sheets:{}};
assert.deepEqual(assetFromExport(report,'/fixture/export.json').variants[0].socketFrames,[sockets]);
const transform = spineTransform({x:10,y:20,originX:.5,originY:.5,displayWidth:100,displayHeight:100,rotation:Math.PI/2},sockets,[.5,.8],[.5,.2],1,1);
assert.ok(Math.abs(transform.x-10)<1e-8 && Math.abs(transform.y-30)<1e-8);
// The transformed asset tip must land exactly on the body's tip socket.
assert.ok(Math.abs(transform.x + .6*transform.size*Math.sin(transform.rotation)-10)<1e-8);
assert.ok(Math.abs(transform.y - .6*transform.size*Math.cos(transform.rotation)-50)<1e-8);
assert.equal(spineTransform({},undefined,[0,0],[0,1],1,1),null);
const playback = {clip:volley.name,elapsed:0,playing:true,idle:false};
assert.equal(spineGrowth(resolved,1,{...playback,elapsed:.499},volley,reviewDefaults),1);
assert.equal(spineGrowth(resolved,1,{...playback,elapsed:.5},volley,reviewDefaults),0);
assert.equal(spineGrowth(resolved,2,{...playback,elapsed:.5},volley,reviewDefaults),1);
assert.equal(samplePose(resolved,volley.name,.5,false,volley).logicalFrame,11);
const settings = {...reviewDefaults,regrow:true,regrowSeconds:2};
const tail = advanceViewerPlayback([volley],playback,3,false,settings);
assert.equal(tail.playing,true);
assert.equal(spineGrowth(resolved,1,tail,volley,settings),.5);
assert.equal(advanceViewerPlayback([volley],tail,1,false,settings).playing,false);
const end = advanceViewerPlayback([volley],playback,3,false,reviewDefaults);
assert.equal(end.idle,false);
assert.equal(spineGrowth(resolved,1,end,volley,reviewDefaults),0);
assert.equal(spineGrowth(resolved,1,{...end,idle:true},volley,reviewDefaults),1);
console.log('Viewer socket/volley fixture checks passed.');

// Compile the separate entry without adding it to the game build or deployment.
await build({
  configFile: false,
  root: path.join(repoRoot, 'scripts/asset-pipeline/viewer'),
  base: './', publicDir: false,
  build: { target: 'esnext', outDir: path.join(repoRoot, 'art/poc/pipeline-v1/viewer-build'), emptyOutDir: false },
});
