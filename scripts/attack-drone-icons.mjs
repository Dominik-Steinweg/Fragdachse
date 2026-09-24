// Individually authored vector symbols for the station's eight upgrade entries.
// Raster export matches the existing 64px loadout icon contract.
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
const steel='#b2cccd', teal='#4f8c91', orange='#f4b36b', dark='#203740';
const drone=`<path d="M21 21L43 43M43 21L21 43" stroke="${steel}" stroke-width="5"/><rect x="25" y="19" width="14" height="27" rx="5" fill="${teal}"/><path d="M29 22H35" stroke="${orange}" stroke-width="4"/>${[[17,17],[47,17],[17,47],[47,47]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="9" stroke="${steel}" stroke-width="2.5" fill="${dark}"/><path d="M${x-6} ${y}H${x+6}M${x} ${y-6}V${y+6}" stroke="${steel}" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="2.5" fill="${orange}"/>`).join('')}`;
const bullet=(x,y)=>`<path d="M${x} ${y+17}V${y+5}Q${x+3} ${y-3} ${x+6} ${y+5}V${y+17}Z" fill="${orange}"/><path d="M${x} ${y+13}h6" stroke="${dark}" stroke-width="2"/>`;
const bomb=(x,y)=>`<path d="M${x-4} ${y-12}h8l-2 6h-4Z" fill="${steel}"/><ellipse cx="${x}" cy="${y}" rx="6" ry="10" fill="${orange}"/><path d="M${x-2} ${y-3}v7" stroke="#ffe4bb" stroke-width="2"/>`;
const icons={
  unlock_attack_drone_station:`<rect x="8" y="45" width="48" height="14" rx="4" fill="${teal}"/><path d="M14 50h9m18 0h9" stroke="${orange}" stroke-width="3"/><g transform="translate(5 -5) scale(.84)">${drone}</g>`,
  attack_drone_self_loader:`${bullet(23,20)}${bullet(34,20)}<path d="M13 26a21 21 0 0 1 37-7M51 36a21 21 0 0 1-37 10" fill="none" stroke="${teal}" stroke-width="5"/><path d="M41 18l10 3-1-11M24 47l-10-3 1 11" fill="none" stroke="${orange}" stroke-width="4"/>`,
  attack_drone_service:`<rect x="8" y="14" width="48" height="39" rx="7" fill="${teal}"/><path d="M15 22v23m34-23v23" stroke="${steel}" stroke-width="4"/><path d="M33 17l-9 18h8l-2 16 13-22h-9l5-12Z" fill="${orange}"/>`,
  attack_drone_flight:`<g transform="translate(8 -3) scale(.77)">${drone}</g><path d="M8 48h16M4 55h29M16 61h24" stroke="${orange}" stroke-width="3" stroke-linecap="round"/>`,
  attack_drone_penetration:`<path d="M20 10v44m13-44v44m13-44v44" stroke="${teal}" stroke-width="6"/><path d="M5 32h49m-9-9 10 9-10 9" stroke="${orange}" stroke-width="5" fill="none"/><path d="M20 27v10m13-10v10m13-10v10" stroke="${dark}" stroke-width="7"/><path d="M5 32h49" stroke="${orange}" stroke-width="3"/>`,
  attack_drone_bomb_bay:`<path d="M10 13h44v15H10Z" fill="${teal}"/><path d="M16 14v12m32-12v12" stroke="${steel}" stroke-width="4"/>${bomb(32,43)}<path d="M14 36v8m36-8v8" stroke="${orange}" stroke-width="2"/>`,
  attack_drone_bomb_count:`${bomb(15,32)}${bomb(32,37)}${bomb(49,32)}<path d="M27 9h10m-5-5v10" stroke="${steel}" stroke-width="3"/>`,
  attack_drone_fire_chunks:`<path d="M32 8C39 24 27 22 38 34c5-2 8-8 7-13 14 16 12 34-8 38C13 62 7 39 20 26c-1 12 6 14 8 6 3-8-2-15 4-24Z" fill="${orange}"/><path d="M30 36c2 8-3 10 1 18 10-1 11-9 6-15 0 6-4 7-7-3" fill="#fff0cf"/><path d="M8 18l4-6 4 6-4 6zm41-5 4-6 4 6-4 6z" fill="${teal}"/>`,
};
const source='scripts/generated-upgrade-icons/svg';await mkdir(source,{recursive:true});
for(const [id,art] of Object.entries(icons)) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${art}</svg>`;
  await writeFile(`${source}/${id}.svg`,svg);
  await sharp(Buffer.from(svg)).png().toFile(`public/assets/sprites/Loadout/UPGRADE_${id.toUpperCase()}.png`);
}
console.log(`Exported ${Object.keys(icons).length} authored attack drone icons`);
