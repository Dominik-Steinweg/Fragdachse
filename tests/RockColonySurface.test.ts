import {expect,it,vi} from 'vitest';
import {rockColonyContactAlpha,rockColonyTint,stampRockColonyContact,ROCK_COLONY_CONTACT_REACH} from '../src/arena/rocks/RockColonySurface';
import {ROCK_CONTACT_ASSETS} from '../src/arena/rocks/RockEcologyAssets';
import {generateRockEcology,ROCK_ECOLOGY_DEFAULTS} from '../src/arena/rocks/RockEcologyField';
it('keeps contact bounded and stronger in cavities without depending on direct sun',()=>{
 expect(rockColonyContactAlpha(.24,1)).toBeGreaterThan(rockColonyContactAlpha(.24,0));
 expect(rockColonyContactAlpha(0,1)).toBe(0);expect(rockColonyContactAlpha(1,2)).toBe(.5);
 expect(rockColonyTint(0)).toBe(0xffffff);
});
it('uses opaque colonies, deterministic transformed contact and a conservative dirty footprint',()=>{
 const rocks=Array.from({length:100},(_,i)=>({gridX:i%10,gridY:Math.floor(i/10),hp:1}));
 const options={rocks,frame:{offsetX:37,offsetY:12,width:320,height:320},seed:12345,tuning:ROCK_ECOLOGY_DEFAULTS,moss:[]};
 const colonies=generateRockEcology(options);expect(colonies.length).toBeGreaterThan(0);
 expect(colonies).toEqual(generateRockEcology(options));expect(colonies.every(p=>p.alpha===1)).toBe(true);
 const stamp=vi.fn(),scene={textures:{getFrame:()=>({})}},target={stamp};
 stampRockColonyContact(scene as never,target as never,colonies,-37,-12,.24);
 const first=stamp.mock.calls.map(c=>JSON.stringify(c));stamp.mockClear();
 stampRockColonyContact(scene as never,target as never,colonies,-37,-12,.24);
 expect(stamp.mock.calls.map(c=>JSON.stringify(c))).toEqual(first);
 for(const p of colonies){const a=ROCK_CONTACT_ASSETS.get(String(p.frame));expect(a).toBeDefined();
  const extra=(Math.hypot(p.lengthPx*a!.scaleX,p.bandPx*a!.scaleY)-Math.hypot(p.lengthPx,p.bandPx))/2;
  expect(extra).toBeLessThan(ROCK_COLONY_CONTACT_REACH);
 }
 stamp.mockClear();stampRockColonyContact(scene as never,target as never,[],0,0,.24);expect(stamp).not.toHaveBeenCalled();
});
