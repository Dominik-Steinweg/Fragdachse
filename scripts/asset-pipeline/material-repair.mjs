/** Localized source rerender validation; no pixel painting or runtime import. */
import { inspectPasses } from './pass-quality.mjs';

export function validateAlbedoRepair(before, after) {
  if(before.width!==after.width||before.height!==after.height)throw Error('Repair canvas changed');
  const old=inspectPasses({albedo:before}),fresh=inspectPasses({albedo:after});
  if(!old.opaqueBlack||fresh.opaqueBlack)throw Error('Repair must remove confirmed opaque black corruption');
  const bounds=[before.width,before.height,-1,-1];
  for(let p=0;p<before.width*before.height;p++){
    const i=p*4,x=p%before.width,y=Math.floor(p/before.width);
    if(before.data[i+3]>=250&&Math.max(before.data[i],before.data[i+1],before.data[i+2])===0){
      bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);
    }
  }
  let changed=0,outsideFilterPixels=0,maxOutsideDelta=0;
  for(let p=0;p<before.width*before.height;p++){
    const i=p*4,x=p%before.width,y=Math.floor(p/before.width);
    if(before.data[i+3]!==after.data[i+3])throw Error('Repair changed coverage');
    if(before.data[i]===after.data[i]&&before.data[i+1]===after.data[i+1]&&before.data[i+2]===after.data[i+2])continue;
    changed++;
    if(x<bounds[0]-4||x>bounds[2]+4||y<bounds[1]-4||y>bounds[3]+4){
      outsideFilterPixels++;
      const delta=Math.max(...[0,1,2].map(c=>Math.abs(before.data[i+c]-after.data[i+c])));
      maxOutsideDelta=Math.max(maxOutsideDelta,delta);
      // Cycles may round one channel by one RGB8 unit on an independent GPU run.
      // Keep that evidence; larger or widespread unrelated edits still fail.
      if(delta>1||outsideFilterPixels>1)throw Error('Repair changed colour outside corruption/filter region');
    }
  }
  return {beforeBlack:old.opaqueBlack,afterBlack:fresh.opaqueBlack,changedPixels:changed,alphaChanged:0,
    corruptBounds:bounds,padding:4,outsideFilterPixels,maxOutsideDelta};
}

export function replaceTile(sheet, frame, rect) {
  const [x,y,width,height]=rect;
  if(width!==frame.width||height!==frame.height||x<0||y<0||x+width>sheet.width||y+height>sheet.height)throw Error('Repair tile mismatch');
  for(let row=0;row<height;row++)frame.data.copy(sheet.data,((y+row)*sheet.width+x)*4,row*width*4,(row+1)*width*4);
}
