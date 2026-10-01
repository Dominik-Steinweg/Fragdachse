import {expect,it} from 'vitest';
import {createVisibleWorldView,getVisibleWorldView} from '../src/graphics/CameraWorldView';
it('contains all inverse-projected viewport corners for zoom, origin, rotation and DPR',()=>{
 const out=createVisibleWorldView();
 for(const zoom of [.5,1,1.4,2])for(const dpr of [1,2])for(const origin of [0,.5,1])for(const rotation of [0,.3,Math.PI/2]){
  const camera={width:1664*dpr,height:936*dpr,zoom:zoom*dpr,originX:origin,originY:origin,rotation,scrollX:-235,scrollY:731};
  const view=getVisibleWorldView(camera,out,12);expect(view).toBe(out);
  const c=Math.cos(rotation),s=Math.sin(rotation),ox=camera.width*origin,oy=camera.height*origin;
  for(const x of [0,camera.width])for(const y of [0,camera.height]){
   const wx=camera.scrollX+ox+(c*(x-ox)+s*(y-oy))/camera.zoom;
   const wy=camera.scrollY+oy+(-s*(x-ox)+c*(y-oy))/camera.zoom;
   expect(wx).toBeGreaterThanOrEqual(view.x+11.999);expect(wx).toBeLessThanOrEqual(view.right-11.999);
   expect(wy).toBeGreaterThanOrEqual(view.y+11.999);expect(wy).toBeLessThanOrEqual(view.bottom-11.999);
  }
 }
});
