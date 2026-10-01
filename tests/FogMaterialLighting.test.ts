import {expect,it} from 'vitest';
import {canPrelightFog} from '../src/effects/groundFog/FogMaterialLighting';
import {createSunTuning,resolveSunAtmosphere} from '../src/effects/sunlight/SunAtmosphere';
import {FOG_K_MATERIAL_FRAGMENT,FOG_MATERIAL_FRAGMENT,FOG_DISPLAY_FRAGMENT} from '../src/effects/groundFog/fogShaders';
it('uses reduced material lighting for woodland fog and retains safe unlit/debug/HDR fallbacks',()=>{
 const t=createSunTuning();
 for(let minute=0;minute<1440;minute+=15){resolveSunAtmosphere(minute,t);expect(canPrelightFog(t,16,true)).toBe(true);}
 expect(canPrelightFog(undefined,16,true)).toBe(false);expect(canPrelightFog(t,8,true)).toBe(false);
 expect(canPrelightFog(t,16,false)).toBe(false);t.shade=[.2,.8,.8];expect(canPrelightFog(t,16,true)).toBe(false);
});
it('keeps the ordinary material sampler contract and applies lighting before the cheap wake display',()=>{
 expect(FOG_MATERIAL_FRAGMENT).not.toContain('vec4 lightFog(');
 expect(FOG_K_MATERIAL_FRAGMENT).toContain('gl_FragColor=lightFog(gl_FragColor,world+');
 expect(FOG_DISPLAY_FRAGMENT).toContain('if(uFogPrelit>.5||fog.a<=0.0)');
 // No extra offscreen pass or change to the final alpha/patch field is needed.
 expect(FOG_K_MATERIAL_FRAGMENT).toContain('fogPatchEdgeAlpha(alpha,patchDistance,patchActivity)');
});
