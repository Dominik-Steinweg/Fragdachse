/** Camera viewport inverse, independent of stale preRender worldView and DPR.
 * Padding is in world pixels. Callers on frame paths supply reusable storage. */
export interface CameraWorldViewSource {
 readonly width:number;readonly height:number;readonly originX:number;readonly originY:number;
 readonly zoom:number;readonly zoomX?:number;readonly zoomY?:number;readonly rotation?:number;
 readonly scrollX:number;readonly scrollY:number;
}
export interface VisibleWorldView {x:number;y:number;width:number;height:number;centerX:number;centerY:number;right:number;bottom:number}
export function createVisibleWorldView():VisibleWorldView {return {x:0,y:0,width:0,height:0,centerX:0,centerY:0,right:0,bottom:0};}
export function getVisibleWorldView(camera:CameraWorldViewSource,out=createVisibleWorldView(),padding=0):VisibleWorldView {
 const zx=Math.max(.001,camera.zoomX??camera.zoom),zy=Math.max(.001,camera.zoomY??camera.zoom);
 const angle=camera.rotation??0,c=Math.cos(angle),s=Math.sin(angle),ox=camera.width*camera.originX,oy=camera.height*camera.originY;
 const dx=camera.width*.5-ox,dy=camera.height*.5-oy;
 out.centerX=camera.scrollX+ox+(c*dx+s*dy)/zx;
 out.centerY=camera.scrollY+oy+(-s*dx+c*dy)/zy;
 out.width=(Math.abs(c)*camera.width+Math.abs(s)*camera.height)/zx+2*padding;
 out.height=(Math.abs(s)*camera.width+Math.abs(c)*camera.height)/zy+2*padding;
 out.x=out.centerX-out.width*.5;out.y=out.centerY-out.height*.5;
 out.right=out.x+out.width;out.bottom=out.y+out.height;return out;
}
