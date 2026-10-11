import * as Phaser from 'phaser';
import { disposeShaderWarmupNode } from '../../../src/graphics/disposeShaderWarmupNode';

// Quiet, bounded layered noise, following the arena water's turquoise palette.
const fragment = `
#pragma phaserTemplate(shaderName)
precision highp float;
varying vec2 outTexCoord;
uniform float uTime;
uniform vec2 uSize;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
void main(){
 vec2 p=outTexCoord*uSize*.018;
 vec2 drift=vec2(sin(uTime*.12),cos(uTime*.09))*.4;
 float n=noise(p+drift)*.65+noise(p*2.03-drift)*.35;
 vec3 rgb=mix(vec3(.025,.105,.115),vec3(.045,.22,.22),n);
 float ripple=pow(.5+.5*sin(p.x*3.0+p.y*2.0+n*7.0+uTime*.4),16.0);
 gl_FragColor=vec4(rgb+vec3(.045,.085,.075)*ripple*.3,1);
}`;
export function createPond(scene) {
  const pond = new Phaser.GameObjects.Shader(scene, { name: 'AssetReviewPond', fragmentSource: fragment,
    setupUniforms: set => { set('uTime', pond.reviewTime || 0); set('uSize', [pond.width, pond.height]); },
  }, 0, 0, 1, 1);
  scene.add.existing(pond);
  const node = pond.renderNode;
  if (node) pond.once('destroy', () => disposeShaderWarmupNode(node));
  return pond;
}
