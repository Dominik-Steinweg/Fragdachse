import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const names = ['Veteran', 'Raufbold', 'Narbenkämpfer', 'Taktiker', 'Wildkämpfer'];
const layers = [];
let markup = '<svg width="1200" height="390"><rect width="1200" height="390" fill="#20272b"/>';
for (let i = 0; i < 5; i++) {
  const x = i * 240;
  markup += `<text x="${x + 120}" y="30" text-anchor="middle" font-family="Arial" font-size="19" fill="#f1ebdc">${i + 1} · ${names[i]}</text>`;
  markup += `<rect x="${x + 126}" y="286" width="68" height="68" rx="5" fill="#ede7db"/>`;
  markup += `<text x="${x + 120}" y="378" text-anchor="middle" font-family="Arial" font-size="13" fill="#b8bdbd">48 × 48 px · dunkel / hell</text>`;
  const source = `${root}variant-${i + 1}-source.png`;
  const small = await sharp(source).resize(48, 48).png().toBuffer();
  await sharp(small).toFile(`${root}variant-${i + 1}-48.png`);
  layers.push({ input: await sharp(source).resize(216, 216).png().toBuffer(), left: x + 12, top: 48 });
  layers.push({ input: small, left: x + 56, top: 296 }, { input: small, left: x + 136, top: 296 });
}
markup += '</svg>';
await sharp(Buffer.from(markup)).composite(layers).png().toFile(`${root}comparison.png`);
