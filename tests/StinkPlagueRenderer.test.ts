import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
import { StinkPlagueRenderer } from '../src/effects/StinkPlagueRenderer';
import { VulnerableBodyEffect } from '../src/effects/SmokeBodyEffect';
import { healthBarTestScene, HealthTestObject } from './healthBarTestScene';
import { GraphicsQualityController } from '../src/graphics/GraphicsQuality';

describe('plague snapshot presentation',()=>{
  it('tracks the animated body, coexists with vulnerability, pools expired marks and rejects reused ids',()=>{
    const {scene,cosmetic}=healthBarTestScene();
    scene.cameras.main={width:800,height:600,zoom:1,originX:0,originY:0,scrollX:0,scrollY:0};
    const sprite=new HealthTestObject(scene,200,200).setTexture('enemy','walk-1');
    const target={sprite:sprite as any,bodySize:40,visible:true,entityGeneration:5};
    const renderer=new StinkPlagueRenderer(scene);
    const snapshot={targets:[{enemyId:'e1',entityGeneration:5,expiresAt:4000,infectiousUntil:2000}],transfers:[],transferSequence:0};
    renderer.sync(snapshot,1000,()=>target);
    const mark=cosmetic[0];const allocated=cosmetic.length;
    sprite.setPosition(210,220).setTexture('enemy','walk-2').setFlip(true,false);renderer.update(16);
    expect([mark.x,mark.y,mark.frame.name,mark.flipX]).toEqual([210,220,'walk-2',true]);
    expect(sprite.alpha).toBe(1);
    renderer.sync({...snapshot,targets:[]},1100,()=>target);expect(cosmetic.every(o=>!o.visible)).toBe(true);
    renderer.sync(snapshot,1200,()=>target);expect(cosmetic).toHaveLength(allocated);
    renderer.sync(snapshot,1200,()=>({...target,entityGeneration:6}));expect(cosmetic.every(o=>!o.visible)).toBe(true);
    renderer.sync(snapshot,1200,()=>target);renderer.update(3000);expect(cosmetic.every(o=>!o.visible)).toBe(true);
    renderer.sync(snapshot,1200,()=>target);
    const vulnerable=new VulnerableBodyEffect(scene);vulnerable.setActive(true);vulnerable.sync(target);
    expect(mark.visible && mark.alpha>0).toBe(true);
    expect(cosmetic.at(-1)!.visible && cosmetic.at(-1)!.alpha>0).toBe(true);
    vulnerable.destroy();renderer.clear();expect(cosmetic.every(o=>!o.active)).toBe(true);
  });
  it('does not replay bootstrap impulses, deduplicates recovery snapshots and bounds cosmetic allocation',()=>{
    const {scene,cosmetic}=healthBarTestScene();
    scene.cameras.main={width:800,height:600,zoom:1,originX:0,originY:0,scrollX:0,scrollY:0};
    const quality=new GraphicsQualityController('low');quality.attach(scene);
    const renderer=new StinkPlagueRenderer(scene);
    const event={sequence:1,createdAt:0,fromX:20,fromY:20,toX:60,toY:60};
    renderer.sync({targets:[],transfers:[event],transferSequence:1},0,()=>null);expect(cosmetic).toHaveLength(0);
    const snapshot={targets:[],transfers:Array.from({length:600},(_,i)=>({...event,sequence:i+2})),transferSequence:601};
    renderer.sync(snapshot,10,()=>null);const count=cosmetic.length;expect(count).toBeGreaterThan(0);expect(count).toBeLessThan(600);
    renderer.sync(snapshot,20,()=>null);expect(cosmetic).toHaveLength(count);
    renderer.update(300);expect(cosmetic.every(o=>!o.visible)).toBe(true);
    renderer.clear();expect(cosmetic.every(o=>!o.active)).toBe(true);quality.destroy();
  });
});
