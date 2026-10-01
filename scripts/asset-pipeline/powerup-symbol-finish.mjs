import sharp from 'sharp';
export const SYMBOL_FINISH = 'tinted-edge-contact-v1';
/** Own-alpha contour/contact shadow. Whole result scales with the symbol, never the base. */
export async function finishPowerupSymbol(input) {
  const {data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==256||info.height!==256)throw Error('Symbol finishing requires the shared 256 canvas');
  const w=256, outline=Buffer.alloc(data.length), shadow=Buffer.alloc(data.length), alpha=Buffer.alloc(w*w);
  for(let i=0;i<w*w;i++)alpha[i]=data[i*4+3];
  const blurred=await sharp(alpha,{raw:{width:w,height:w,channels:1}}).blur(3).greyscale().raw().toBuffer();
  for(let y=0;y<w;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;let best=0,source=i;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      const weight=Math.max(0,Math.min(1,3-Math.hypot(dx,dy)));
      if(!weight||x+dx<0||x+dx>=w||y+dy<0||y+dy>=w)continue;
      const q=((y+dy)*w+x+dx)*4,coverage=data[q+3]*weight;
      if(coverage>best){best=coverage;source=q;}
    }
    for(let c=0;c<3;c++)outline[i+c]=Math.round(data[source+c]*.23);
    outline[i+3]=Math.round(best*.92);
    shadow[i]=16;shadow[i+1]=21;shadow[i+2]=28;
    shadow[i+3]=(x>=3&&y>=5)?Math.round(blurred[(y-5)*w+x-3]*.42):0;
  }
  const png=raw=>sharp(raw,{raw:{width:w,height:w,channels:4}}).png().toBuffer();
  return sharp(await png(shadow)).composite([{input:await png(outline)},{input}]).png().toBuffer();
}
