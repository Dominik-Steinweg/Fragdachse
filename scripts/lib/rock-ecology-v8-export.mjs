import sharp from 'sharp';

export const ROCK_ECOLOGY_RECIPE = [
  ...['moss-strip-01','moss-strip-02','lichen-06','lichen-07']
    .map(name=>({name,width:256,height:256,brightness:1,preserveAlpha:true})),
  ...[
    ['edge-overhang-02',2140,973,80,120],['edge-overhang-04',2234,931,80,120],
    ['edge-overhang-05',2042,1021,80,120],['edge-overhang-06',2414,863,80,120],
    ['corner-tuft-01',1444,1444,48,96],['corner-tuft-03',1444,1444,48,96],
    ['corner-tuft-05',1768,1178,48,96],['corner-tuft-06',1444,1444,48,96],
    ['foot-cluster-01',1768,1178,56,100],['foot-cluster-02',1768,1178,56,100],
    ['foot-cluster-04',1624,1282,56,100],['foot-cluster-06',1768,1178,80,100],
    ['crevice-herb-01',2140,974,40,60],['crevice-herb-02',1510,1379,24,60],
    ['crevice-herb-06',1768,1178,40,60],
    ['moss-nest-01',1768,1178,28,64],['moss-nest-02',1563,1332,28,64],
    ['moss-nest-04',1768,1178,28,64],['moss-nest-05',1636,1272,28,64],
  ].map(([name,w,h,minWorld,maxWorld])=>({name,width:256,height:Math.round(256*h/w),
    brightness:1,preserveAlpha:true,preserveCanvas:true,minWorld,maxWorld})),
];
const colonyName = name => /^(edge-overhang|corner-tuft|foot-cluster|crevice-herb|moss-nest|moss-strip|lichen)-/.test(name);
for (const recipe of ROCK_ECOLOGY_RECIPE) if (colonyName(recipe.name))
  recipe.surfaceFinish = { blur: 1.2, brightness: .94, saturation: .86, rgb: [.97, 1, 1.03] };

async function surfaceFinish(bytes, recipe) {
  if (!recipe.surfaceFinish) return bytes;
  const f=recipe.surfaceFinish;
  // Explicit premultiplied convolution: process colour separately so alpha is
  // never gamma/modulate/linear-corrected and transparent RGB cannot form a rim.
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const colour=await sharp(bytes).removeAlpha().modulate({brightness:f.brightness,saturation:f.saturation})
    .linear(f.rgb,[0,0,0]).raw().toBuffer();
  const alpha=Buffer.alloc(info.width*info.height);
  for(let i=0;i<alpha.length;i++){
    alpha[i]=data[i*4+3];
    for(let c=0;c<3;c++)colour[i*3+c]=Math.round(colour[i*3+c]*alpha[i]/255);
  }
  const blurred=await sharp(colour,{raw:{width:info.width,height:info.height,channels:3}}).blur(f.blur).raw().toBuffer();
  const blurredAlpha=await sharp(alpha,{raw:{width:info.width,height:info.height,channels:1}}).blur(f.blur).greyscale().raw().toBuffer();
  for(let i=0;i<alpha.length;i++){
    const a=blurredAlpha[i];data[i*4+3]=a;
    for(let c=0;c<3;c++)data[i*4+c]=a?Math.min(255,Math.round(blurred[i*3+c]*255/a)):0;
  }
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const i=(y*info.width+x)*4;
    if(x<4||y<4||x>=info.width-4||y>=info.height-4||data[i+3]===0)data.fill(0,i,i+4);
  }
  return sharp(data,{raw:info}).png().toBuffer();
}

/** Offline contact silhouette. All stamps share their colour's transform/anchor. */
export async function exportRockContact(bytes) {
  const metadata=await sharp(bytes).metadata(),w=96,h=Math.round(96*metadata.height/metadata.width),pad=16;
  const source=await sharp(bytes).resize(w,h).extractChannel(3).raw().toBuffer();
  const width=w+2*pad,height=h+2*pad,dilated=Buffer.alloc(width*height),pixels=Buffer.alloc(width*height*4);
  for(let y=-3;y<h+3;y++)for(let x=-3;x<w+3;x++){
    let peak=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      const sx=x+dx,sy=y+dy;if(sx>=0&&sy>=0&&sx<w&&sy<h)peak=Math.max(peak,source[sy*w+sx]);
    }
    dilated[(y+pad)*width+x+pad]=peak;
  }
  const alpha=await sharp(dilated,{raw:{width,height,channels:1}}).blur(3).greyscale().raw().toBuffer();
  for(let i=0;i<alpha.length;i++){
    const x=i%width,y=Math.floor(i/width);
    pixels[i*4]=12;pixels[i*4+1]=18;pixels[i*4+2]=14;
    pixels[i*4+3]=x<2||y<2||x>=width-2||y>=height-2?0:alpha[i];
  }
  return {bytes:await sharp(pixels,{raw:{width,height,channels:4}}).png().toBuffer(),width,height,
    scaleX:width/w,scaleY:height/h};
}
/** Remove the generator's low-alpha haze, preserving a soft antialiased fringe.
 * This is an offline alpha cleanup, never a runtime luminance/chroma key. */
export async function exportRockEcology(input, recipe) {
  // New edge recommendations refer to the padded source canvas. Keep that
  // coverage and aspect ratio: trimming would silently enlarge the plants.
  if(recipe.preserveCanvas)return surfaceFinish(await sharp(input).ensureAlpha().resize(recipe.width,recipe.height,{kernel:'lanczos3'}).png().toBuffer(),recipe);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    let alpha = recipe.preserveAlpha ? data[i+3]/255 : Math.max(0, Math.min(1, (data[i+3]-64)/144));
    if (!recipe.preserveAlpha) alpha = alpha*alpha*(3-2*alpha);
    data[i+3] = Math.round(alpha*255);
    for (let c = 0; c < 3; c++) data[i+c] = alpha ? Math.round(data[i+c]*recipe.brightness) : 0;
  }
  return surfaceFinish(await sharp(data, { raw: info }).trim({ threshold: 4 }).resize(recipe.width-8, recipe.height-8, {
    fit: 'contain', background: '#00000000', kernel: 'lanczos3',
  }).extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' }).png().toBuffer(),recipe);
}
