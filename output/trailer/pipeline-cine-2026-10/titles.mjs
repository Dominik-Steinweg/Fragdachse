// Renders transparent title overlays (16:9 and 9:16) with the game's Chakra Petch and forest gold palette.
import { chromium } from 'file:///C:/Fragdachse/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'node:fs';
const OUT = 'C:/Fragdachse/output/trailer/pipeline-cine-2026-10/titles';
mkdirSync(OUT, { recursive: true });
const FONT_DIR = 'C:/Fragdachse/public/assets/fonts/';
import { readFileSync } from 'node:fs';
const font = f => 'data:font/woff2;base64,' + readFileSync(FONT_DIR + f).toString('base64');
const css = `
@font-face { font-family: Chakra; font-weight: 500; src: url(${font("chakra-petch-500.woff2")}); }
@font-face { font-family: Chakra; font-weight: 700; src: url(${font("chakra-petch-700.woff2")}); }
html, body { margin: 0; background: transparent; width: 100%; height: 100%; overflow: hidden; }
body { font-family: Chakra; color: #f4e7c8; position: relative; }
.gold { background: linear-gradient(180deg, #fff1c9 0%, #e8c170 38%, #de9e41 66%, #be772b 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.shadow { filter: drop-shadow(0 6px 18px rgba(0,0,0,.85)) drop-shadow(0 0 2px rgba(0,0,0,.9)); }
.kicker { font-weight: 700; letter-spacing: .42em; color: #e8c170; text-transform: uppercase; }
.rule { height: 3px; background: linear-gradient(90deg, transparent, #e8c170, transparent); }
.center { position: absolute; left: 0; right: 0; text-align: center; }
`;
const W = { h: [1920, 1080], v: [1080, 1920] };
const titles = {
  open: o => `<div class="center shadow" style="top:${o === 'h' ? 742 : 1180}px">
      <div style="font-weight:500;font-size:${o === 'h' ? 40 : 46}px;letter-spacing:.5em;padding-left:.5em;color:#f4e7c8">ETWAS ERWACHT</div>
      <div style="font-weight:500;font-size:${o === 'h' ? 26 : 32}px;letter-spacing:.62em;padding-left:.62em;margin-top:14px;color:#cbbd9c">IN DER TIEFE</div></div>`,
  kraken: o => `<div class="center shadow" style="top:${o === 'h' ? 812 : 1390}px">
      <div class="kicker" style="font-size:${o === 'h' ? 26 : 30}px;padding-left:.42em">Der neue Endboss</div>
      <div class="rule" style="width:${o === 'h' ? 620 : 640}px;margin:16px auto 6px"></div>
      <div class="gold" style="font-weight:700;font-size:${o === 'h' ? 132 : 112}px;line-height:1.02;letter-spacing:.04em">ABYSSAL<br>KRAKEN</div></div>`.replace('ABYSSAL<br>KRAKEN', o === 'h' ? 'ABYSSAL KRAKEN' : 'ABYSSAL<br>KRAKEN'),
  meteor: o => label(o, 'Boss-Intro · Karte 10', 'VOID-METEOR'),
  mortar: o => label(o, 'Neuer Gegner', 'MÖRSER-DACHS'),
  fire: o => label(o, 'Neuer Gegner', 'BRANDSTIFTER-DACHS'),
  tower: o => label(o, 'Neue Belohnung', 'DER WACHTURM'),
  end: o => `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(4,10,9,.35) 0%, rgba(4,10,9,.82) 70%)"></div>
    <div class="center shadow" style="top:${o === 'h' ? 330 : 700}px">
      <div class="kicker" style="font-size:${o === 'h' ? 28 : 32}px;padding-left:.42em">Jetzt neu im Koop</div>
      <div class="rule" style="width:${o === 'h' ? 900 : 760}px;margin:22px auto 14px"></div>
      <div class="gold" style="font-weight:700;font-size:${o === 'h' ? 200 : 150}px;line-height:1;letter-spacing:.03em">FRAGDACHSE</div>
      <div class="rule" style="width:${o === 'h' ? 900 : 760}px;margin:20px auto 28px"></div>
      <div style="font-weight:500;font-size:${o === 'h' ? 40 : 44}px;letter-spacing:.12em;color:#f4e7c8;line-height:1.45">
        ${o === 'h' ? 'Neuer Endboss · Neue Gegner · Neuer Wachturm' : 'Neuer Endboss<br>Neue Gegner<br>Neuer Wachturm'}</div></div>`,
};
function label(o, kicker, name) {
  const h = o === 'h';
  return `<div class="shadow" style="position:absolute;left:${h ? 110 : 80}px;${h ? 'bottom:120px' : 'bottom:330px'}">
    <div class="kicker" style="font-size:${h ? 24 : 28}px">${kicker}</div>
    <div style="display:flex;align-items:center;margin-top:10px">
      <div style="width:6px;height:${h ? 74 : 78}px;background:linear-gradient(#e8c170,#be772b);margin-right:22px"></div>
      <div class="gold" style="font-weight:700;font-size:${h ? 82 : 76}px;letter-spacing:.03em;line-height:1">${name}</div></div></div>`;
}
const browser = await chromium.launch({ channel: 'chrome' });
for (const [o, [w, h]] of Object.entries(W)) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (const [name, html] of Object.entries(titles)) {
    await page.setContent(`<html><head><style>${css}</style></head><body>${html(o)}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}/${name}-${o === 'h' ? '16x9' : '9x16'}.png`, omitBackground: true });
  }
  await page.close();
}
await browser.close();
console.log('titles done');
