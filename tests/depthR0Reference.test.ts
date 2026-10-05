import { describe, it, expect } from 'vitest';
import { DEPTH_REFERENCE_SCENES, DEPTH_REFERENCE_MINUTES, depthReferenceRecipe, runDepthReferenceScene } from '../src/dev/scenario/depthReferenceScene';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { runScenarioCommand } from '../src/dev/scenario/api';

describe('depth reference recipes', () => {
  it('validates every scene/time combination against the real loadout and utility registries', () => {
    for(const scene of DEPTH_REFERENCE_SCENES)for(const time of DEPTH_REFERENCE_MINUTES) {
      const recipe=depthReferenceRecipe(scene,time);
      expect(recipe.scenario.seed).toBe(12345);expect(recipe.scenario.mapId).toBe('1');
      expect(recipe).toEqual(depthReferenceRecipe(scene,time));
      expect(recipe.captures.every(f=>Number.isInteger(f)&&f>=0&&f<=600)).toBe(true);
      expect(recipe.cues.map(c=>c.frame)).toEqual(recipe.cues.map(c=>c.frame).sort((a,b)=>a-b));
      for(const cue of recipe.cues)if(cue.command.action==='temporaryUtility')expect(UTILITY_CONFIGS[String(cue.command.utility)]).toBeDefined();
    }
  });
  function controller() {
    const c:any={clock:{now:0,paused:false},state:'ready',lastAction:null, config:{}, aim:{},zoom:1,cameraAtTarget:false,
      start(config:unknown){this.config=structuredClone(config);this.clock.paused=false;}, snapshot(){return {ready:this.state==='ready'};},
      isCurrentScenario(config:unknown){return config===this.config;},
      pause(){this.clock.paused=true;},step(){this.clock.now+=1000/60;},syncCamera(){},syncPanel(){}};
    return c;
  }
  it('rejects malformed commands before replacing an existing scene', async () => {
    const c=controller(),original=c.config;
    for(const command of [{scene:'typo'}, {scene:'flight',timeOfDay:NaN}, {scene:'flight',timeOfDay:1},
      {scene:'flight',extra:true}, {scene:'flight',phase:'wrong'}])
      await expect(runScenarioCommand(c,{action:'depthReferenceScene',...command})).rejects.toThrow();
    expect(c.config).toBe(original);
  });
  it('steps to exact frame offsets without repeating cues and restores global RNG', async () => {
    const c=controller(),calls:unknown[]=[], native=Math.random;
    const exec=(command:unknown)=>{calls.push(command);c.lastAction={ok:true};};
    await runDepthReferenceScene(c,{scene:'flight'},exec);
    await runDepthReferenceScene(c,{phase:'sample',frame:12},exec);
    expect(c.lastAction.depthReference.timeMs).toBe(200);
    expect(c.clock.now-c.lastAction.depthReference.originSimulationMs).toBeCloseTo(200,6);
    expect(calls.filter((x:any)=>x.action==='fire')).toHaveLength(1);
    await runDepthReferenceScene(c,{phase:'sample',frame:12},exec);
    expect(calls.filter((x:any)=>x.action==='fire')).toHaveLength(1);
    await runDepthReferenceScene(c,{phase:'sample',frame:33},exec);
    expect(calls.filter((x:any)=>x.action==='fire')).toHaveLength(2);
    expect(Math.random).toBe(native); expect(c.clock.paused).toBe(true);
    await expect(runDepthReferenceScene(c,{phase:'sample',frame:0},exec)).rejects.toThrow('Backward');
  });
  it('fails closed on rejected actions, external clock movement, and restarts', async () => {
    const c=controller(), native=Math.random;
    await runDepthReferenceScene(c,{scene:'flight'},()=>{});
    await expect(runDepthReferenceScene(c,{phase:'sample',frame:1},()=>{throw new Error('rejected');})).rejects.toThrow('rejected');
    expect(Math.random).toBe(native);expect(c.clock.paused).toBe(true);
    await expect(runDepthReferenceScene(c,{phase:'sample',frame:2},()=>{})).rejects.toThrow('Prepare');
    await runDepthReferenceScene(c,{scene:'flight'},()=>{});
    await runDepthReferenceScene(c,{phase:'sample',frame:1},()=>{c.lastAction={ok:true};});
    c.clock.now+=1;
    await expect(runDepthReferenceScene(c,{phase:'sample',frame:2},()=>{})).rejects.toThrow('Clock changed');
  });
  it('does not publish old cues or pause a new scenario after an awaited command', async () => {
    const c = controller(), nativeRandom = Math.random;
    await runDepthReferenceScene(c, { scene: 'flight' }, () => {});
    let enterCue!: () => void, finishCue!: () => void;
    const entered = new Promise<void>(resolve => { enterCue = resolve; });
    const command = new Promise<void>(resolve => { finishCue = resolve; });
    const sample = runDepthReferenceScene(c, { phase: 'sample', frame: 0 }, () => {
      enterCue(); return command;
    });
    await entered;
    c.start({ seed: 777 }); c.lastAction = { scenario: 'new' };
    finishCue();
    await expect(sample).rejects.toThrow('Reference scenario was replaced or destroyed');
    expect(c.clock.paused).toBe(false);
    expect(c.lastAction).toEqual({ scenario: 'new' });
    expect(Math.random).toBe(nativeRandom);
  });
});
