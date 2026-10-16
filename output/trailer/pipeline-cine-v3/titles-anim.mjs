// Renders animated title overlays (16:9) as transparent PNG sequences at 30 fps: titles-anim/<name>/f0000.png …
// Durations come from edl.mjs; every title is a CSS animation paused and scrubbed frame by frame.
import { chromium } from 'file:///C:/Fragdachse/node_modules/playwright-core/index.mjs';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { TITLES } from './edl.mjs';
const OUT = 'C:/Fragdachse/output/trailer/pipeline-cine-v3/titles-anim';
const FPS = 30;
const FONT_DIR = 'C:/Fragdachse/public/assets/fonts/';
const font = f => 'data:font/woff2;base64,' + readFileSync(FONT_DIR + f).toString('base64');
// Lower-left labels render into this clip; big cards use the full frame.
export const LABEL_CLIP = { x: 0, y: 700, width: 1400, height: 380 };

const css = d => `
@font-face { font-family: Chakra; font-weight: 500; src: url(${font('chakra-petch-500.woff2')}); }
@font-face { font-family: Chakra; font-weight: 700; src: url(${font('chakra-petch-700.woff2')}); }
html, body { margin: 0; background: transparent; width: 1920px; height: 1080px; overflow: hidden; }
body { font-family: Chakra; color: #f4e7c8; position: relative; --d: ${d}s; }
* { animation-fill-mode: both; animation-timing-function: cubic-bezier(.2,.8,.2,1); }
.gold { background: linear-gradient(180deg, #fff4d6 0%, #f0c978 36%, #e2a24a 64%, #b8702a 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.blood { background: linear-gradient(180deg, #ffe9d6 0%, #f5a274 32%, #e0533d 62%, #8f1717 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.shine { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 38%, rgba(255,255,255,.95) 50%, transparent 62%);
  background-size: 320% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: shine .9s ease-in-out calc(var(--d) * .3) 1 both; }
@keyframes shine { from { background-position: 120% 0 } to { background-position: -40% 0 } }
.drop { filter: drop-shadow(0 5px 14px rgba(0,0,0,.95)) drop-shadow(0 0 2px rgba(0,0,0,1)); }
.out { animation: out .32s ease-in calc(var(--d) - .32s) 1 both; }
@keyframes out { from { opacity: 1; transform: translateX(0); filter: blur(0) } to { opacity: 0; transform: translateX(-60px); filter: blur(6px) } }

/* Lower-left feature label */
.label { position: absolute; left: 0; bottom: 70px; height: 260px; width: 1300px; }
.plate { position: absolute; left: 0; bottom: 0; height: 230px; width: 1250px;
  background: linear-gradient(90deg, rgba(4,8,7,.82) 0%, rgba(4,8,7,.6) 45%, rgba(4,8,7,0) 100%);
  animation: plate .45s .0s 1 both; }
@keyframes plate { from { transform: translateX(-100%); opacity: 0 } to { transform: none; opacity: 1 } }
.bar { position: absolute; left: 96px; bottom: 58px; width: 8px; height: 116px; background: linear-gradient(#f6d58c, #c1772b);
  box-shadow: 0 0 18px rgba(240,190,100,.6); transform-origin: 50% 100%; animation: bar .35s .05s 1 both; }
@keyframes bar { from { transform: scaleY(0) } to { transform: none } }
.kicker { position: absolute; left: 128px; bottom: 150px; font-weight: 700; font-size: 30px; letter-spacing: .36em; color: #f8ecd2;
  text-transform: uppercase; animation: kick .5s .1s 1 both; }
@keyframes kick { from { opacity: 0; letter-spacing: .9em; transform: translateX(-24px) } to { opacity: 1; letter-spacing: .36em; transform: none } }
.name-wrap { position: absolute; left: 124px; bottom: 54px; }
.name { position: relative; font-weight: 700; font-size: 104px; line-height: 1; letter-spacing: .02em; white-space: nowrap;
  animation: reveal .55s .16s 1 both; }
@keyframes reveal { from { clip-path: inset(0 100% 0 0); transform: translateX(-36px); filter: blur(8px) } to { clip-path: inset(0 0 0 0); transform: none; filter: blur(0) } }

/* Centre cards */
.center { position: absolute; left: 0; right: 0; text-align: center; }
.letters span { display: inline-block; animation: letter .6s 1 both; }
@keyframes letter { from { opacity: 0; transform: translateY(18px) scale(1.15); filter: blur(10px) } to { opacity: 1; transform: none; filter: blur(0) } }
.slam { animation: slam .42s cubic-bezier(.1,.9,.2,1) 0s 1 both; }
@keyframes slam { 0% { opacity: 0; transform: scale(1.6); filter: blur(14px) } 60% { opacity: 1 } 100% { transform: scale(1); filter: blur(0) } }
.glow { position: absolute; left: 50%; top: 50%; width: 1500px; height: 520px; margin: -260px 0 0 -750px; border-radius: 50%;
  animation: glow 1.4s ease-out 0s 1 both; }
@keyframes glow { 0% { opacity: 0; transform: scale(.6) } 15% { opacity: 1 } 100% { opacity: .35; transform: scale(1.1) } }
.rule { height: 3px; margin: 0 auto; transform-origin: 50% 50%; animation: rule .6s .15s 1 both; }
@keyframes rule { from { transform: scaleX(0) } to { transform: none } }
.fade { animation: fade .6s 1 both; }
@keyframes fade { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
.flicker { animation: flicker 1.1s linear .25s 1 both; }
@keyframes flicker { 0%,100% { opacity: 1 } 8% { opacity: .35 } 12% { opacity: 1 } 40% { opacity: 1 } 44% { opacity: .55 } 48% { opacity: 1 } }
`;
const letters = (text, start = 0, step = .035) => [...text].map((c, i) => `<span style="animation-delay:${(start + i * step).toFixed(3)}s">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
const label = (kicker, name) => `<div class="label out"><div class="plate"></div><div class="bar"></div>
  <div class="kicker drop">${kicker}</div><div class="name-wrap drop"><div class="name"><span class="gold">${name}</span><span class="shine">${name}</span></div></div></div>`;

const TEMPLATES = {
  open: () => `<div class="center out" style="top:720px"><div class="drop">
    <div class="letters" style="font-weight:700;font-size:46px;letter-spacing:.5em;padding-left:.5em;color:#f4e7c8">${letters('ETWAS ERWACHT', .1, .05)}</div>
    <div class="letters" style="font-weight:500;font-size:30px;letter-spacing:.62em;padding-left:.62em;margin-top:16px;color:#d6c8a8">${letters('IN DER TIEFE', .65, .045)}</div></div></div>`,
  kraken: () => `<div class="glow" style="top:860px;background:radial-gradient(ellipse at center, rgba(120,40,190,.55), rgba(60,10,90,0) 65%)"></div>
    <div class="center out" style="top:735px">
    <div class="fade drop" style="font-weight:700;font-size:30px;letter-spacing:.42em;padding-left:.42em;color:#f8ecd2;animation-delay:.12s">DER NEUE ENDBOSS</div>
    <div class="rule" style="width:760px;margin:16px auto 8px;background:linear-gradient(90deg,transparent,#f0c978,transparent)"></div>
    <div class="drop"><div class="slam" style="position:relative;font-weight:700;font-size:150px;line-height:1.02;letter-spacing:.04em">
      <span class="gold">ABYSSAL KRAKEN</span><span class="shine" style="left:0;right:0">ABYSSAL KRAKEN</span></div></div></div>`,
  minis: () => label('Die Brut des Kraken', 'MINI-KRAKEN'),
  ashore: () => label('Abyssal Kraken · Phase 2', 'ER KOMMT AN LAND'),
  toad: () => label('Neuer Gegner', 'QUACKSALBER'),
  charger: () => label('Neuer Gegner', 'SCHILD-ANSTÜRMER'),
  fire: () => label('Neuer Gegner', 'BRANDSTIFTER'),
  mortar: () => label('Neuer Gegner', 'MÖRSER-DACHS'),
  alien: () => label('Alien-Dachs · Neuer Angriff', 'ENERGIEFÄCHER'),
  tower: () => label('Neue Belohnung', 'WACHTURM'),
  meteor: () => label('Boss-Intro · Karte 10', 'VOID-METEOR'),
  copies: () => label('Inspector Gadachs · Utility', 'TURMKOPIEN'),
  holo: () => label('Inspector Gadachs · Ultimate', 'HOLO-OFFENSIVE'),
  portal: () => label('Inspector Gadachs · Utility', 'TURMPORTALE'),
  bomber: () => label('Inspector Gadachs · Ultimate', 'BOMBERGESCHWADER'),
  dawnKicker: () => `<div class="center out" style="top:500px"><div class="drop">
    <div class="letters" style="font-weight:700;font-size:40px;letter-spacing:.55em;padding-left:.55em;color:#efdcc9">${letters('NACH KARTE 20 …', .05, .06)}</div></div></div>`,
  dawn: () => `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(20,0,4,.25) 0%, rgba(6,0,2,.78) 78%)" class="fade"></div>
    <div class="glow" style="background:radial-gradient(ellipse at center, rgba(220,40,30,.45), rgba(120,0,0,0) 65%)"></div>
    <div class="center out" style="top:300px">
    <div class="fade drop" style="font-weight:700;font-size:30px;letter-spacing:.45em;padding-left:.45em;color:#f2b08c;animation-delay:.2s">DER ENDLOS-MODUS</div>
    <div class="rule" style="width:1100px;margin:22px auto 20px;background:linear-gradient(90deg,transparent,#e0533d,transparent)"></div>
    <div class="drop"><div class="slam" style="position:relative;font-weight:700;font-size:168px;line-height:1.0;letter-spacing:.03em">
      <div class="flicker"><span class="blood">FROM DACHS<br>TILL DAWN</span></div></div></div>
    <div class="rule" style="width:1100px;margin:24px auto 24px;background:linear-gradient(90deg,transparent,#e0533d,transparent);animation-delay:.3s"></div>
    <div class="fade drop" style="font-weight:700;font-size:36px;letter-spacing:.34em;padding-left:.34em;color:#f3e2d6;animation-delay:.55s">ÜBERLEBE DIE NACHT</div></div>`,
  end: () => `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(4,10,9,.4) 0%, rgba(4,10,9,.86) 72%)" class="fade"></div>
    <div class="glow" style="background:radial-gradient(ellipse at center, rgba(240,190,100,.28), rgba(240,190,100,0) 62%)"></div>
    <div class="center" style="top:300px">
    <div class="fade drop" style="font-weight:700;font-size:32px;letter-spacing:.42em;padding-left:.42em;color:#f0c978;animation-delay:.15s">BALD IM KOOP-MODUS</div>
    <div class="rule" style="width:980px;margin:24px auto 14px;background:linear-gradient(90deg,transparent,#f0c978,transparent)"></div>
    <div class="drop"><div class="slam" style="position:relative;font-weight:700;font-size:216px;line-height:1;letter-spacing:.03em">
      <span class="gold">FRAGDACHSE</span><span class="shine" style="left:0;right:0">FRAGDACHSE</span></div></div>
    <div class="rule" style="width:980px;margin:22px auto 30px;background:linear-gradient(90deg,transparent,#f0c978,transparent);animation-delay:.25s"></div>
    <div class="fade drop" style="font-weight:700;font-size:38px;letter-spacing:.14em;color:#f4e7c8;line-height:1.5;animation-delay:.6s">
      Neuer Endboss · Neue Gegner · Inspector-Arsenal · Endlos-Modus</div></div>`,
};
export const isLabel = name => !['open', 'kraken', 'dawnKicker', 'dawn', 'end'].includes(name);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const only = process.argv.slice(2);
for (const t of TITLES) {
  if (only.length && !only.includes(t.name)) continue;
  const template = TEMPLATES[t.name]; if (!template) throw Error('no title template ' + t.name);
  const dir = `${OUT}/${t.name}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  await page.setContent(`<html><head><style>${css(t.d)}</style></head><body>${template()}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const frames = Math.round(t.d * FPS), clip = isLabel(t.name) ? LABEL_CLIP : undefined;
  for (let f = 0; f < frames; f++) {
    await page.evaluate(ms => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } }, f * 1000 / FPS);
    await page.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png`, omitBackground: true, ...(clip ? { clip } : {}) });
  }
  console.log('title', t.name, frames, 'frames');
}
await browser.close();
