import { describe, expect, it } from 'vitest';
import { fogSurfaceSize } from '../src/effects/groundFog/FogSurfaceMask';
import { FOG_SURFACE_FRAGMENT } from '../src/effects/groundFog/FogSurfaceMask';
import { FOG_DISPLAY_FRAGMENT } from '../src/effects/groundFog/fogShaders';
import { resolveFogRockLighting, resolveRockAerialPerspective } from '../src/effects/groundFog/FogRockLighting';

describe('fog geometry resolution',()=>{
  it('enables bounded aerial perspective by default and validates every supplied value',()=>{
    expect(resolveRockAerialPerspective()).toBeGreaterThan(0);
    expect(resolveRockAerialPerspective()).toBeLessThanOrEqual(.5);
    expect(resolveRockAerialPerspective({rockAerialPerspective:true})).toBe(resolveRockAerialPerspective());
    expect(resolveRockAerialPerspective({rockAerialPerspective:false})).toBe(0);
    expect(resolveRockAerialPerspective({rockAerialPerspectiveStrength:.3})).toBe(.3);
    expect(resolveRockAerialPerspective({rockAerialPerspective:true})).toBeGreaterThan(0);
    expect(resolveRockAerialPerspective({rockAerialPerspective:true,rockAerialPerspectiveStrength:.3})).toBe(.3);
    expect(resolveRockAerialPerspective({rockAerialPerspective:false,rockAerialPerspectiveStrength:.3})).toBe(0);
    for(const value of [-1,NaN,Infinity,1])expect(()=>resolveRockAerialPerspective({rockAerialPerspectiveStrength:value})).toThrow();
    expect(()=>resolveRockAerialPerspective({rockAerialPerspective:'yes'} as never)).toThrow();
  });
  it('keeps both optical controls bounded and rejects invalid live values',()=>{
    expect(resolveFogRockLighting({fogRockContactStrength:0,fogRockSunShadowStrength:0})).toEqual([0,0]);
    for(const key of ['fogRockContactStrength','fogRockSunShadowStrength'])for(const value of [-1,NaN,Infinity,1])
      expect(()=>resolveFogRockLighting({[key]:value})).toThrow();
    const [contact,sun]=resolveFogRockLighting();
    expect(contact).toBeGreaterThan(sun);expect((1-contact)*(1-sun)).toBeGreaterThan(.5);
  });
  it('keeps optical retention neutral for absent residency and out of coverage/alpha channels',()=>{
    expect(FOG_SURFACE_FRAGMENT).toContain('retention=1.0');
    expect(FOG_SURFACE_FRAGMENT).toContain('if(slot>=0.0)');
    expect(FOG_SURFACE_FRAGMENT).toContain('vec4(coverage,valid,retention,base)');
    expect(FOG_SURFACE_FRAGMENT).not.toContain('uOptions');
    expect(FOG_SURFACE_FRAGMENT).toContain('blendHorizons(');
    expect(FOG_DISPLAY_FRAGMENT.match(/vec4\(fog\.rgb\*rockRetention,fog\.a\)/g)).toHaveLength(2);
    expect(FOG_DISPLAY_FRAGMENT).toContain('fog=lightFog(fog,world)');
    expect(FOG_DISPLAY_FRAGMENT).toContain('*(1.0-trace)');
    // The aerial contribution is additionally gated by local optical coverage.
    expect(FOG_DISPLAY_FRAGMENT).toContain('float visibleFog=smoothstep(');
    expect(FOG_DISPLAY_FRAGMENT).toContain('mineral*uRockAerialStrength*visibleFog');
  });
  it('retains a two-world-pixel mask footprint regardless of material quality',()=>{
    for(const zoom of [.25,1,1.4,2,8]) {
      const width=1664/zoom,height=936/zoom;
      const [w,h]=fogSurfaceSize(width,height);
      expect(width/w).toBeLessThanOrEqual(2);expect(height/h).toBeLessThanOrEqual(2);
    }
  });
});
