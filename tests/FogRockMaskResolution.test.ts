import { describe, expect, it } from 'vitest';
import { fogSurfaceSize } from '../src/effects/groundFog/FogSurfaceMask';

describe('fog geometry resolution',()=>{
  it('retains a two-world-pixel mask footprint regardless of material quality',()=>{
    for(const zoom of [.25,1,1.4,2,8]) {
      const width=1664/zoom,height=936/zoom;
      const [w,h]=fogSurfaceSize(width,height);
      expect(width/w).toBeLessThanOrEqual(2);expect(height/h).toBeLessThanOrEqual(2);
    }
  });
});
