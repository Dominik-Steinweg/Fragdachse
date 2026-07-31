/**
 * Small, dependency-free SVG symbol library for the generated upgrade icons.
 *
 * The generator supplies the project's numeric COLORS values at runtime. That
 * keeps the icon palette tied to src/config.ts without requiring a TypeScript
 * loader in the local Node.js script.
 */

export const ICON_VIEWBOX = '0 0 64 64';

const RECIPE_COLOR_SOURCES = Object.freeze({
  blue: { fill: 'BLUE_3', highlight: 'BLUE_1', shadow: 'BLUE_6' },
  cyan: { fill: 'BLUE_2', highlight: 'GREY_1', shadow: 'BLUE_6' },
  green: { fill: 'GREEN_3', highlight: 'GREEN_1', shadow: 'GREEN_6' },
  orange: { fill: 'RED_1', highlight: 'GOLD_1', shadow: 'RED_6' },
  purple: { fill: 'PURPLE_2', highlight: 'PURPLE_1', shadow: 'PURPLE_6' },
  red: { fill: 'RED_3', highlight: 'RED_1', shadow: 'RED_6' },
  yellow: { fill: 'GOLD_1', highlight: 'BROWN_1', shadow: 'GOLD_6' },
});

export const SUPPORTED_RECIPE_COLORS = Object.freeze(Object.keys(RECIPE_COLOR_SOURCES));

function toCssColor(value, key) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 0xffffff) {
    throw new Error(`Project color ${key} is not a valid 24-bit color.`);
  }
  return `#${numericValue.toString(16).padStart(6, '0')}`;
}

export function createIconPalette(projectColors) {
  const outline = toCssColor(projectColors.GREY_9, 'GREY_9');
  const white = toCssColor(projectColors.GREY_1, 'GREY_1');

  return Object.freeze(Object.fromEntries(
    Object.entries(RECIPE_COLOR_SOURCES).map(([recipeColor, source]) => [recipeColor, Object.freeze({
      fill: toCssColor(projectColors[source.fill], source.fill),
      highlight: toCssColor(projectColors[source.highlight], source.highlight),
      shadow: toCssColor(projectColors[source.shadow], source.shadow),
      outline,
      white,
      accent: toCssColor(projectColors.GOLD_2, 'GOLD_2'),
    })]),
  ));
}

function paint(colors, fill = colors.fill, width = 4) {
  return `fill="${fill}" stroke="${colors.outline}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
}

function line(colors, stroke = colors.highlight, width = 3) {
  return `fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
}

function modifierSlot(index, total) {
  if (total <= 1) return { cx: 50, cy: 14 };
  return index === 0 ? { cx: 50, cy: 14 } : { cx: 51, cy: 50 };
}

function modifierBadge(colors, context, glyph, { fill = colors.shadow, glyphColor = colors.highlight } = {}) {
  const { cx, cy } = modifierSlot(context.index, context.total);
  return `<g><circle cx="${cx}" cy="${cy}" r="8.5" ${paint(colors, fill, 3.2)}/><g stroke="${colors.outline}" fill="${glyphColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${glyph(cx, cy)}</g></g>`;
}

function chevron(x, y, direction, size = 5) {
  const dx = direction === 'left' ? -size : size;
  return `<polyline points="${x + dx},${y - size} ${x},${y} ${x + dx},${y + size}" fill="none"/>`;
}

function renderAdrenaline(colors) {
  return `<g><path d="M32 8 C22 13 17 21 18 31 C19 42 26 49 32 55 C38 49 45 42 46 31 C47 21 42 13 32 8 Z" ${paint(colors)}/><path d="M35 14 L26 33 H33 L29 48 L40 28 H33 Z" ${paint(colors, colors.highlight, 2.5)}/></g>`;
}

function renderBadger(colors) {
  return `<g><path d="M17 24 L13 12 L25 18 C30 16 34 16 39 18 L51 12 L47 26 C49 36 43 46 32 51 C21 46 15 36 17 24 Z" ${paint(colors)}/><path d="M20 31 C25 26 39 26 44 31 C41 39 36 43 32 44 C28 43 23 39 20 31 Z" fill="${colors.shadow}" stroke="${colors.outline}" stroke-width="2.5"/><circle cx="27" cy="31" r="2.5" fill="${colors.highlight}"/><circle cx="37" cy="31" r="2.5" fill="${colors.highlight}"/><path d="M29 38 Q32 40 35 38" ${line(colors, colors.highlight, 2)}/></g>`;
}

function renderBulletStream(colors) {
  return `<g>${[20, 32, 44].map((y) => `<path d="M18 ${y} H40 L47 ${y + 4} L40 ${y + 8} H18 Z" ${paint(colors)}/>`).join('')}</g>`;
}

function renderCloud(colors) {
  return `<path d="M15 43 C10 37 14 29 21 28 C20 20 27 15 34 18 C39 12 49 17 48 25 C55 25 57 34 52 39 C50 44 44 46 38 45 H22 C19 45 17 44 15 43 Z" ${paint(colors)}/>`;
}

function renderConstruction(colors) {
  return `<g><path d="M13 28 L32 12 L51 28 V50 H13 Z" ${paint(colors)}/><path d="M25 50 V35 H39 V50" ${line(colors, colors.outline, 3)}/><path d="M17 30 H47" ${line(colors, colors.highlight, 2.5)}/><circle cx="32" cy="23" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/></g>`;
}

function renderCrosshair(colors) {
  return `<g><circle cx="32" cy="32" r="17" ${line(colors, colors.fill, 5)}/><circle cx="32" cy="32" r="7" ${paint(colors, colors.highlight, 3)}/><path d="M32 8 V19 M32 45 V56 M8 32 H19 M45 32 H56" ${line(colors, colors.outline, 4)}/></g>`;
}

function renderDash(colors) {
  return `<g><path d="M22 15 L43 32 L22 49 L28 32 Z" ${paint(colors)}/><path d="M12 22 L25 32 L12 42 M7 27 L14 32 L7 37" ${line(colors, colors.highlight, 4)}/></g>`;
}

function renderDrone(colors) {
  return `<g><ellipse cx="32" cy="33" rx="15" ry="11" ${paint(colors)}/><circle cx="27" cy="33" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/><circle cx="37" cy="33" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/><path d="M19 25 L12 18 M45 25 L52 18 M19 41 L12 48 M45 41 L52 48" ${line(colors, colors.outline, 3)}/><path d="M9 18 H16 M48 18 H55 M9 48 H16 M48 48 H55" ${line(colors, colors.highlight, 2)}/></g>`;
}

function renderEnergyCore(colors) {
  return `<g><polygon points="32,8 48,18 48,43 32,55 16,43 16,18" ${paint(colors)}/><polygon points="32,18 41,25 38,40 32,46 26,40 23,25" ${paint(colors, colors.highlight, 2.5)}/><circle cx="32" cy="32" r="5" fill="${colors.white}" stroke="${colors.outline}" stroke-width="2"/></g>`;
}

function renderEnergyOrb(colors) {
  return `<g><circle cx="32" cy="32" r="21" ${paint(colors)}/><circle cx="32" cy="32" r="11" ${paint(colors, colors.highlight, 3)}/><path d="M20 22 Q32 14 44 22 M20 42 Q32 50 44 42" ${line(colors, colors.white, 2)}/></g>`;
}

function renderEnergyShield(colors) {
  return `<g><path d="M10 38 C10 22 20 12 32 12 C44 12 54 22 54 38" fill="${colors.shadow}" stroke="${colors.outline}" stroke-width="4"/><path d="M16 38 C16 25 23 18 32 18 C41 18 48 25 48 38" fill="${colors.fill}" stroke="${colors.highlight}" stroke-width="3"/><path d="M12 43 H52" ${line(colors, colors.white, 3)}/></g>`;
}

function renderFireball(colors) {
  return `<g><circle cx="33" cy="29" r="17" ${paint(colors)}/><path d="M27 51 C21 46 23 40 29 36 C29 43 34 43 35 47 C38 43 41 39 39 34 C47 42 44 50 36 54 C33 55 29 54 27 51 Z" ${paint(colors, colors.highlight, 2.5)}/></g>`;
}

function renderFlame(colors) {
  return `<path d="M32 8 C42 20 45 25 43 34 C41 45 35 52 32 55 C25 51 18 44 19 34 C20 26 26 22 28 14 C30 18 31 21 30 25 C36 20 37 14 32 8 Z" ${paint(colors)}/>`;
}

function renderFlameRing(colors) {
  return `<g><circle cx="32" cy="32" r="19" fill="none" stroke="${colors.outline}" stroke-width="8"/><circle cx="32" cy="32" r="19" fill="none" stroke="${colors.fill}" stroke-width="4"/><path d="M19 21 C15 27 17 31 21 33 C19 27 25 25 24 19 Z M40 19 C39 25 45 27 43 33 C48 30 49 25 45 21 Z M28 48 C25 43 28 39 32 36 C36 40 38 44 35 49 Z" ${paint(colors, colors.highlight, 2.5)}/></g>`;
}

function renderHydra(colors) {
  return `<g><path d="M32 48 C26 43 24 35 26 27 C20 29 15 27 14 21 C14 16 19 13 24 16 C27 17 29 20 30 23 C30 17 34 12 39 13 C45 14 46 20 43 24 C42 26 40 27 38 27 C40 35 38 43 32 48 Z" ${paint(colors)}/><circle cx="21" cy="20" r="2" fill="${colors.highlight}"/><circle cx="38" cy="19" r="2" fill="${colors.highlight}"/><circle cx="32" cy="29" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/></g>`;
}

function renderLightning(colors) {
  return `<path d="M37 7 L17 34 H29 L25 57 L47 27 H35 Z" ${paint(colors, colors.highlight, 3.5)}/>`;
}

function renderMeteor(colors) {
  return `<g><path d="M40 11 C51 15 54 28 47 39 C41 49 27 54 17 47 C10 42 14 28 24 20 C29 16 35 13 40 11 Z" ${paint(colors)}/><path d="M18 41 C11 42 8 48 7 55 M23 48 C18 52 17 56 17 59 M29 51 C27 55 28 58 29 60" ${line(colors, colors.highlight, 4)}/><path d="M29 25 L38 33 M39 23 L43 27" ${line(colors, colors.highlight, 2.5)}/></g>`;
}

function renderMolotov(colors) {
  return `<g><path d="M27 19 H37 V25 H27 Z" ${paint(colors, colors.highlight, 3)}/><path d="M24 25 H40 L43 49 C40 54 24 54 21 49 Z" ${paint(colors)}/><path d="M30 10 C27 14 31 17 34 12 C37 9 35 6 35 5" ${line(colors, colors.highlight, 3)}/><path d="M26 35 H38" ${line(colors, colors.highlight, 2.5)}/></g>`;
}

function renderMushroom(colors) {
  return `<g><path d="M11 29 C12 17 21 10 32 10 C43 10 52 17 53 29 Z" ${paint(colors)}/><path d="M27 29 H39 V51 C36 55 28 55 25 51 V33 Z" ${paint(colors, colors.highlight, 2.5)}/><circle cx="22" cy="20" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/><circle cx="39" cy="16" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/><circle cx="45" cy="24" r="2.5" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/></g>`;
}

function renderProjectile(colors) {
  return `<path d="M15 32 L27 19 H44 L51 32 L44 45 H27 Z" ${paint(colors)}/><path d="M25 26 H42 M25 38 H42" ${line(colors, colors.highlight, 2.5)}/>`;
}

function renderRage(colors) {
  return `<g><path d="M32 8 L38 14 L48 12 L49 23 L56 31 L48 39 L47 50 L37 48 L32 56 L26 48 L16 50 L15 39 L8 31 L16 23 L17 12 L27 14 Z" ${paint(colors)}/><path d="M20 28 Q26 21 32 28 Q38 21 44 28 L40 39 Q32 45 24 39 Z" fill="${colors.shadow}" stroke="${colors.outline}" stroke-width="2.5"/><path d="M25 30 L29 34 M39 30 L35 34" ${line(colors, colors.highlight, 3)}/></g>`;
}

function renderRifle(colors) {
  return `<g><path d="M12 29 H43 L52 25 V31 L43 35 H33 L29 48 H22 L25 35 H17 L13 42 H9 Z" ${paint(colors)}/><path d="M43 29 H57" ${line(colors, colors.highlight, 4)}/><circle cx="20" cy="32" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/></g>`;
}

function renderRocket(colors) {
  return `<g><path d="M32 8 C22 14 18 24 20 35 C22 43 28 49 32 52 C36 49 42 43 44 35 C46 24 42 14 32 8 Z" ${paint(colors)}/><path d="M20 34 L12 42 L23 43 M44 34 L52 42 L41 43" ${paint(colors, colors.fill, 3)}/><circle cx="32" cy="28" r="6" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="3"/><path d="M26 48 C24 53 27 57 32 60 C37 57 40 53 38 48" ${paint(colors, colors.highlight, 2.5)}/></g>`;
}

function renderShield(colors) {
  return `<g><path d="M32 8 L51 16 V30 C51 42 43 51 32 56 C21 51 13 42 13 30 V16 Z" ${paint(colors)}/><path d="M32 16 L43 21 V31 C43 38 38 44 32 47 C26 44 21 38 21 31 V21 Z" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2.5"/></g>`;
}

function renderShotgun(colors) {
  return `<g><path d="M10 27 H38 L54 21 V30 L38 34 H27 L24 48 H17 L20 34 H13 Z" ${paint(colors)}/><path d="M38 25 H57 M38 31 H57" ${line(colors, colors.highlight, 3)}/><circle cx="27" cy="30" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/></g>`;
}

function renderSkull(colors) {
  return `<g><path d="M16 29 C16 17 23 10 32 10 C41 10 48 17 48 29 C48 36 44 40 40 43 V51 H24 V43 C20 40 16 36 16 29 Z" ${paint(colors)}/><circle cx="25" cy="28" r="4" fill="${colors.shadow}" stroke="${colors.outline}" stroke-width="2"/><circle cx="39" cy="28" r="4" fill="${colors.shadow}" stroke="${colors.outline}" stroke-width="2"/><path d="M28 37 L32 33 L36 37 M26 44 H38 M28 48 V52 M36 48 V52" ${line(colors, colors.outline, 2.5)}/></g>`;
}

function renderSlime(colors) {
  return `<path d="M13 43 C14 35 14 27 21 24 C27 21 28 15 34 16 C40 17 39 23 46 25 C53 27 53 36 52 43 C51 51 43 55 32 55 C21 55 12 52 13 43 Z" ${paint(colors)}/>`;
}

function renderSniper(colors) {
  return `<g><path d="M10 29 H45 L55 25 V32 L45 36 H32 L28 49 H21 L24 36 H15 L11 42 H7 Z" ${paint(colors)}/><rect x="28" y="18" width="17" height="8" rx="3" ${paint(colors, colors.highlight, 2.5)}/><circle cx="37" cy="22" r="2.5" fill="${colors.shadow}"/><path d="M46 29 H58" ${line(colors, colors.highlight, 4)}/></g>`;
}

function renderSpirit(colors) {
  return `<g><path d="M17 50 V29 C17 18 24 11 32 11 C40 11 47 18 47 29 V50 L40 45 L34 51 L28 45 L22 51 Z" ${paint(colors)}/><circle cx="27" cy="29" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/><circle cx="37" cy="29" r="3" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2"/><path d="M27 39 Q32 43 37 39" ${line(colors, colors.outline, 2.5)}/></g>`;
}

function renderSyringe(colors) {
  return `<g transform="rotate(-45 32 32)"><rect x="24" y="18" width="16" height="27" rx="3" ${paint(colors)}/><path d="M24 25 H40 M24 38 H40 M32 12 V18 M32 45 V54" ${line(colors, colors.highlight, 3)}/><path d="M29 54 H35" ${line(colors, colors.outline, 3)}/></g>`;
}

function renderTurret(colors) {
  return `<g><path d="M15 43 H49 L45 53 H19 Z" ${paint(colors)}/><path d="M22 43 V28 C22 21 27 17 32 17 C37 17 42 21 42 28 V43 Z" ${paint(colors, colors.fill, 3)}/><path d="M32 28 V10 H41" ${line(colors, colors.outline, 5)}/><circle cx="32" cy="29" r="5" fill="${colors.highlight}" stroke="${colors.outline}" stroke-width="2.5"/></g>`;
}

function renderModifierBadgeGlyph(colors, context, glyph, options) {
  return modifierBadge(colors, context, glyph, options);
}

function renderAdrenalineModifier(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx + 2} ${cy - 7} L${cx - 4} ${cy + 1} H${cx} L${cx - 2} ${cy + 7} L${cx + 5} ${cy - 2} H${cx + 1} Z"/>`);
}

function renderArmor(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 7} L${cx + 6} ${cy - 4} V${cy + 1} C${cx + 6} ${cy + 5} ${cx + 3} ${cy + 7} ${cx} ${cy + 8} C${cx - 3} ${cy + 7} ${cx - 6} ${cy + 5} ${cx - 6} ${cy + 1} V${cy - 4} Z"/>`);
}

function renderAutonomous(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="3"/><path d="M${cx - 7} ${cy} H${cx - 4} M${cx + 4} ${cy} H${cx + 7} M${cx} ${cy - 7} V${cy - 4} M${cx} ${cy + 4} V${cy + 7}" ${line(colors, colors.highlight, 1.8)}/>`);
}

function renderBuildRange(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy - 2} H${cx + 6} M${cx - 6} ${cy + 2} H${cx + 6}" ${line(colors, colors.highlight, 1.8)}/>${chevron(cx - 7, cy, 'left', 3)}${chevron(cx + 7, cy, 'right', 3)}`);
}

function renderChain(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<ellipse cx="${cx - 3}" cy="${cy - 2}" rx="4" ry="2.5" fill="none"/><ellipse cx="${cx + 3}" cy="${cy + 2}" rx="4" ry="2.5" fill="none"/>`);
}

function renderChance(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="5" fill="none"/><circle cx="${cx - 2}" cy="${cy - 2}" r="1.2" stroke="none"/><circle cx="${cx + 2}" cy="${cy + 2}" r="1.2" stroke="none"/>`);
}

function renderCharge(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<rect x="${cx - 5}" y="${cy - 5}" width="9" height="10" rx="2" fill="none"/><path d="M${cx + 4} ${cy - 2} H${cx + 7}" ${line(colors, colors.highlight, 2)}/><path d="M${cx} ${cy - 3} L${cx - 2} ${cy + 1} H${cx + 1} L${cx - 1} ${cy + 4}" ${line(colors, colors.highlight, 1.8)}/>`);
}

function renderCorridor(colors, context) {
  return `<g><path d="M14 18 L42 18 M14 46 L42 46" ${line(colors, colors.highlight, 3)}/><path d="M22 32 H48" ${line(colors, colors.outline, 3)}/>${chevron(49, 32, 'right', 4)}</g>`;
}

function renderCostDown(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<polygon points="${cx},${cy - 6} ${cx + 5},${cy} ${cx},${cy + 6} ${cx - 5},${cy}"/><path d="M${cx + 7} ${cy - 5} V${cy + 5} M${cx + 4} ${cy + 2} L${cx + 7} ${cy + 5} L${cx + 10} ${cy + 2}" ${line(colors, colors.highlight, 1.8)}/>`);
}

function renderCount(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx - 5}" cy="${cy}" r="2.5"/><circle cx="${cx}" cy="${cy}" r="2.5"/><circle cx="${cx + 5}" cy="${cy}" r="2.5"/>`);
}

function renderCrown(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 5} L${cx - 3} ${cy - 1} L${cx} ${cy - 6} L${cx + 3} ${cy - 1} L${cx + 7} ${cy - 5} L${cx + 5} ${cy + 5} H${cx - 5} Z"/>`);
}

function renderDamage(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 8} L${cx + 2} ${cy - 2} L${cx + 8} ${cy - 3} L${cx + 3} ${cy + 2} L${cx + 7} ${cy + 7} L${cx + 1} ${cy + 4} L${cx - 3} ${cy + 9} L${cx - 2} ${cy + 3} L${cx - 8} ${cy + 4} L${cx - 3} ${cy - 1} L${cx - 7} ${cy - 6} L${cx - 1} ${cy - 3} Z"/>`);
}

function renderDeath(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy + 2} V${cy - 2} C${cx - 6} ${cy - 8} ${cx + 6} ${cy - 8} ${cx + 6} ${cy - 2} V${cy + 5} H${cx - 6} Z"/><circle cx="${cx - 3}" cy="${cy}" r="1.3" fill="${colors.shadow}" stroke="none"/><circle cx="${cx + 3}" cy="${cy}" r="1.3" fill="${colors.shadow}" stroke="none"/>`);
}

function renderDome(colors, context) {
  return `<path d="M16 38 C16 23 23 15 32 15 C41 15 48 23 48 38" fill="none" stroke="${colors.highlight}" stroke-width="3.5"/><path d="M12 43 H52" ${line(colors, colors.outline, 3)}/>`;
}

function renderDrop(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 7} C${cx - 5} ${cy - 1} ${cx - 5} ${cy + 4} ${cx} ${cy + 6} C${cx + 5} ${cy + 4} ${cx + 5} ${cy - 1} ${cx} ${cy - 7} Z"/>`);
}

function renderDuration(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="6" fill="none"/><path d="M${cx} ${cy - 4} V${cy} L${cx + 3} ${cy + 2}" ${line(colors, colors.highlight, 2)}/><path d="M${cx - 3} ${cy - 8} H${cx + 3} M${cx - 3} ${cy + 8} H${cx + 3}" ${line(colors, colors.highlight, 1.8)}/>`);
}

function renderEnable(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy} L${cx - 1} ${cy + 5} L${cx + 7} ${cy - 5}" ${line(colors, colors.highlight, 3)}/>`);
}

function renderExplosion(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 8} L${cx + 2} ${cy - 3} L${cx + 7} ${cy - 5} L${cx + 4} ${cy} L${cx + 8} ${cy + 4} L${cx + 2} ${cy + 3} L${cx} ${cy + 8} L${cx - 2} ${cy + 3} L${cx - 8} ${cy + 4} L${cx - 4} ${cy} L${cx - 7} ${cy - 5} L${cx - 2} ${cy - 3} Z"/>`);
}

function renderField(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<rect x="${cx - 7}" y="${cy - 6}" width="14" height="12" rx="2" fill="none"/><path d="M${cx - 2} ${cy - 6} V${cy + 6} M${cx + 3} ${cy - 6} V${cy + 6} M${cx - 7} ${cy - 1} H${cx + 7}" ${line(colors, colors.highlight, 1.5)}/>`);
}

function renderFire(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 8} C${cx + 6} ${cy - 1} ${cx + 5} ${cy + 5} ${cx} ${cy + 8} C${cx - 5} ${cy + 5} ${cx - 5} ${cy} ${cx - 1} ${cy - 3} C${cx + 1} ${cy - 1} ${cx + 2} ${cy - 4} ${cx} ${cy - 8} Z"/>`);
}

function renderFragments(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<polygon points="${cx - 6},${cy - 5} ${cx - 1},${cy - 7} ${cx - 2},${cy - 2}"/><polygon points="${cx + 2},${cy - 4} ${cx + 7},${cy - 2} ${cx + 4},${cy + 1}"/><polygon points="${cx - 2},${cy + 3} ${cx + 3},${cy + 2} ${cx + 1},${cy + 7}"/>`);
}

function renderFull(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="6"/>`, { glyphColor: colors.highlight });
}

function renderGain(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy + 7} V${cy - 6} M${cx - 5} ${cy - 1} L${cx} ${cy - 6} L${cx + 5} ${cy - 1}" ${line(colors, colors.highlight, 2.5)}/>`);
}

function renderGround(colors, context) {
  return `<g><path d="M12 47 H52" ${line(colors, colors.outline, 4)}/><path d="M16 42 L21 35 L26 42 M36 42 L41 34 L46 42" ${line(colors, colors.highlight, 3)}/></g>`;
}

function renderGrowth(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy + 7} V${cy - 1} M${cx} ${cy - 1} C${cx - 7} ${cy - 2} ${cx - 7} ${cy - 7} ${cx - 7} ${cy - 7} C${cx - 1} ${cy - 8} ${cx + 1} ${cy - 5} ${cx} ${cy - 1} M${cx} ${cy + 1} C${cx + 7} ${cy} ${cx + 7} ${cy - 5} ${cx + 7} ${cy - 5} C${cx + 2} ${cy - 6} ${cx - 1} ${cy - 3} ${cx} ${cy + 1}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderHealth(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy + 7} L${cx - 7} ${cy - 1} C${cx - 10} ${cy - 6} ${cx - 3} ${cy - 9} ${cx} ${cy - 4} C${cx + 3} ${cy - 9} ${cx + 10} ${cy - 6} ${cx + 7} ${cy - 1} Z"/>`);
}

function renderImpact(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 7} V${cy - 2} M${cx} ${cy + 2} V${cy + 7} M${cx - 7} ${cy} H${cx - 2} M${cx + 2} ${cy} H${cx + 7} M${cx - 5} ${cy - 5} L${cx - 2} ${cy - 2} M${cx + 5} ${cy + 5} L${cx + 2} ${cy + 2}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderKillstreak(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy + 5} L${cx - 3} ${cy - 4} L${cx} ${cy + 1} L${cx + 3} ${cy - 7} L${cx + 7} ${cy - 1}" ${line(colors, colors.highlight, 2.5)}/>`);
}

function renderLargeExplosion(colors, context) {
  return `<circle cx="32" cy="32" r="25" fill="none" stroke="${colors.highlight}" stroke-width="2.5" stroke-dasharray="3 4"/>${renderExplosion(colors, { ...context, index: 0, total: 1 })}`;
}

function renderLightningModifier(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx + 2} ${cy - 8} L${cx - 5} ${cy + 1} H${cx - 1} L${cx - 3} ${cy + 8} L${cx + 5} ${cy - 2} H${cx + 1} Z"/>`);
}

function renderLink(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy} H${cx - 2} M${cx + 2} ${cy} H${cx + 7}" ${line(colors, colors.highlight, 2.5)}/><circle cx="${cx - 4}" cy="${cy}" r="3" fill="none"/><circle cx="${cx + 4}" cy="${cy}" r="3" fill="none"/>`);
}

function renderMachineGun(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 4} H${cx + 7} M${cx - 7} ${cy} H${cx + 7} M${cx - 7} ${cy + 4} H${cx + 7}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderMax(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy + 3} L${cx} ${cy - 4} L${cx + 6} ${cy + 3}" ${line(colors, colors.highlight, 3)}/><path d="M${cx - 7} ${cy + 7} H${cx + 7}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderMoving(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 4} H${cx + 2} M${cx - 7} ${cy + 4} H${cx + 2}" ${line(colors, colors.highlight, 2)}/>${chevron(cx + 6, cy - 4, 'right', 3)}${chevron(cx + 6, cy + 4, 'right', 3)}`);
}

function renderPack(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy - 4}" r="3"/><circle cx="${cx - 5}" cy="${cy + 4}" r="3"/><circle cx="${cx + 5}" cy="${cy + 4}" r="3"/>`);
}

function renderPickup(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy + 3}" r="4" fill="none"/><path d="M${cx} ${cy - 7} V${cy + 1} M${cx - 4} ${cy - 3} L${cx} ${cy + 1} L${cx + 4} ${cy - 3}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderPierce(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx - 4}" cy="${cy}" r="3" fill="none"/><circle cx="${cx + 4}" cy="${cy}" r="3" fill="none"/><path d="M${cx - 8} ${cy} H${cx + 8}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderPlasma(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="5"/><ellipse cx="${cx}" cy="${cy}" rx="8" ry="3" fill="none"/>`);
}

function renderPlus(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 6} V${cy + 6} M${cx - 6} ${cy} H${cx + 6}" ${line(colors, colors.highlight, 3)}/>`);
}

function renderPower(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 8} L${cx + 2} ${cy - 2} L${cx + 8} ${cy} L${cx + 2} ${cy + 2} L${cx} ${cy + 8} L${cx - 2} ${cy + 2} L${cx - 8} ${cy} L${cx - 2} ${cy - 2} Z"/>`);
}

function renderPrecision(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="5" fill="none"/><path d="M${cx} ${cy - 8} V${cy - 5} M${cx} ${cy + 5} V${cy + 8} M${cx - 8} ${cy} H${cx - 5} M${cx + 5} ${cy} H${cx + 8}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderProjectileModifier(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy} L${cx - 2} ${cy - 4} H${cx + 4} L${cx + 7} ${cy} L${cx + 4} ${cy + 4} H${cx - 2} Z"/>`);
}

function renderProjectiles(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 4} H${cx + 2} L${cx + 5} ${cy - 2} L${cx + 2} ${cy} H${cx - 7} Z M${cx - 7} ${cy + 3} H${cx + 2} L${cx + 5} ${cy + 5} L${cx + 2} ${cy + 7} H${cx - 7} Z"/>`);
}

function renderProximity(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="2"/><circle cx="${cx}" cy="${cy}" r="5" fill="none"/><circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke-dasharray="2 2"/>`);
}

function renderRadial(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="2"/><path d="M${cx} ${cy - 8} V${cy - 4} M${cx} ${cy + 4} V${cy + 8} M${cx - 8} ${cy} H${cx - 4} M${cx + 4} ${cy} H${cx + 8} M${cx - 6} ${cy - 6} L${cx - 3} ${cy - 3} M${cx + 3} ${cy + 3} L${cx + 6} ${cy + 6} M${cx + 6} ${cy - 6} L${cx + 3} ${cy - 3} M${cx - 3} ${cy + 3} L${cx - 6} ${cy + 6}" ${line(colors, colors.highlight, 1.8)}/>`);
}

function renderRadius(colors, context) {
  return `<circle cx="32" cy="32" r="25" fill="none" stroke="${colors.highlight}" stroke-width="2.5" stroke-dasharray="4 3"/>`;
}

function renderRageModifier(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 3} L${cx - 2} ${cy - 1} L${cx - 1} ${cy - 6} L${cx + 2} ${cy - 1} L${cx + 7} ${cy - 3} L${cx + 4} ${cy + 3} L${cx} ${cy + 7} L${cx - 4} ${cy + 3} Z"/>`);
}

function renderRange(colors, context) {
  return `<g>${chevron(14, 32, 'left', 6)}${chevron(50, 32, 'right', 6)}<path d="M20 32 H44" ${line(colors, colors.highlight, 3)}/></g>`;
}

function renderRecovery(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx + 6} ${cy - 1} A7 7 0 1 1 ${cx - 2} ${cy - 7}" fill="none"/><path d="M${cx - 2} ${cy - 7} L${cx - 3} ${cy - 2} L${cx - 7} ${cy - 4}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderReturn(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx + 6} ${cy - 3} C${cx + 1} ${cy - 8} ${cx - 6} ${cy - 5} ${cx - 6} ${cy + 1} C${cx - 6} ${cy + 5} ${cx - 2} ${cy + 7} ${cx + 3} ${cy + 6}" fill="none"/><path d="M${cx - 6} ${cy + 1} L${cx - 7} ${cy - 4} L${cx - 2} ${cy - 2}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderReflect(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy - 5} L${cx - 1} ${cy} L${cx - 6} ${cy + 5} M${cx + 6} ${cy - 5} L${cx + 1} ${cy} L${cx + 6} ${cy + 5}" ${line(colors, colors.highlight, 2.2)}/>`);
}

function renderRepair(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy - 5} L${cx - 2} ${cy - 1} L${cx + 5} ${cy - 8} L${cx + 8} ${cy - 5} L${cx + 1} ${cy + 2} L${cx + 5} ${cy + 6} L${cx + 2} ${cy + 8} L${cx - 2} ${cy + 4} L${cx - 6} ${cy + 7} L${cx - 8} ${cy + 5} L${cx - 4} ${cy + 1} L${cx - 7} ${cy - 2} Z"/>`);
}

function renderRevive(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx + 7} ${cy} A7 7 0 1 1 ${cx - 2} ${cy - 7}" fill="none"/><path d="M${cx - 2} ${cy - 7} L${cx - 3} ${cy - 2} L${cx - 7} ${cy - 4}" ${line(colors, colors.highlight, 2)}/><path d="M${cx} ${cy - 2} V${cy + 4} M${cx - 3} ${cy + 1} H${cx + 3}" ${line(colors, colors.highlight, 1.7)}/>`);
}

function renderRock(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<polygon points="${cx - 7},${cy + 4} ${cx - 5},${cy - 4} ${cx},${cy - 7} ${cx + 7},${cy - 3} ${cx + 6},${cy + 5} ${cx},${cy + 7}"/>`);
}

function renderRocketModifier(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx} ${cy - 8} C${cx - 5} ${cy - 4} ${cx - 5} ${cy + 2} ${cx} ${cy + 5} C${cx + 5} ${cy + 2} ${cx + 5} ${cy - 4} ${cx} ${cy - 8} Z"/><circle cx="${cx}" cy="${cy - 1}" r="2" fill="${colors.shadow}" stroke="none"/><path d="M${cx - 2} ${cy + 5} C${cx - 3} ${cy + 8} ${cx - 1} ${cy + 9} ${cx} ${cy + 9} C${cx + 1} ${cy + 9} ${cx + 3} ${cy + 8} ${cx + 2} ${cy + 5}" ${line(colors, colors.highlight, 1.5)}/>`);
}

function renderSize(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 3} H${cx - 2} M${cx - 7} ${cy - 3} V${cy + 2} M${cx + 7} ${cy + 3} H${cx + 2} M${cx + 7} ${cy + 3} V${cy - 2}" ${line(colors, colors.highlight, 2.5)}/>`);
}

function renderSlots(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<rect x="${cx - 7}" y="${cy - 6}" width="5" height="5"/><rect x="${cx + 2}" y="${cy - 6}" width="5" height="5"/><rect x="${cx - 7}" y="${cy + 2}" width="5" height="5"/>`);
}

function renderSlow(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="6" fill="none"/><path d="M${cx - 3} ${cy - 3} L${cx + 3} ${cy + 3} M${cx + 3} ${cy - 3} L${cx - 3} ${cy + 3}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderSpeed(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 5} H${cx + 1} M${cx - 7} ${cy} H${cx + 5} M${cx - 7} ${cy + 5} H${cx + 1}" ${line(colors, colors.highlight, 2)}/>${chevron(cx + 6, cy, 'right', 3)}`);
}

function renderSplit(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy} H${cx} M${cx} ${cy} L${cx + 6} ${cy - 5} M${cx} ${cy} L${cx + 6} ${cy + 5}" ${line(colors, colors.highlight, 2.2)}/><circle cx="${cx - 6}" cy="${cy}" r="2"/><circle cx="${cx + 6}" cy="${cy - 5}" r="2"/><circle cx="${cx + 6}" cy="${cy + 5}" r="2"/>`);
}

function renderStack(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 6} ${cy - 5} L${cx} ${cy - 8} L${cx + 6} ${cy - 5} L${cx} ${cy - 2} Z M${cx - 6} ${cy} L${cx} ${cy + 3} L${cx + 6} ${cy} M${cx - 6} ${cy + 5} L${cx} ${cy + 8} L${cx + 6} ${cy + 5}" fill="none"/>`);
}

function renderSummon(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy - 2}" r="4" fill="none"/><path d="M${cx - 6} ${cy + 7} C${cx - 5} ${cy + 2} ${cx + 5} ${cy + 2} ${cx + 6} ${cy + 7} M${cx} ${cy - 8} V${cy - 5}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderThresholdDown(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<path d="M${cx - 7} ${cy - 3} H${cx + 7} M${cx} ${cy - 6} V${cy + 7} M${cx - 4} ${cy + 3} L${cx} ${cy + 7} L${cx + 4} ${cy + 3}" ${line(colors, colors.highlight, 2)}/>`);
}

function renderTrail(colors, context) {
  return `<g><path d="M12 23 H28 M9 32 H25 M12 41 H28" ${line(colors, colors.highlight, 3)}/></g>`;
}

function renderTrinity(colors, context) {
  return renderModifierBadgeGlyph(colors, context, (cx, cy) => `<circle cx="${cx}" cy="${cy - 5}" r="3"/><circle cx="${cx - 5}" cy="${cy + 4}" r="3"/><circle cx="${cx + 5}" cy="${cy + 4}" r="3"/><path d="M${cx} ${cy - 2} L${cx - 3} ${cy + 2} M${cx} ${cy - 2} L${cx + 3} ${cy + 2}" ${line(colors, colors.highlight, 1.5)}/>`);
}

function renderTripleExplosion(colors, context) {
  return `<g><circle cx="20" cy="43" r="7" fill="none" stroke="${colors.highlight}" stroke-width="2"/><circle cx="32" cy="47" r="7" fill="none" stroke="${colors.highlight}" stroke-width="2"/><circle cx="44" cy="43" r="7" fill="none" stroke="${colors.highlight}" stroke-width="2"/></g>`;
}

const SYMBOL_RENDERERS = Object.freeze({
  adrenaline: renderAdrenaline,
  badger: renderBadger,
  'bullet-stream': renderBulletStream,
  cloud: renderCloud,
  construction: renderConstruction,
  crosshair: renderCrosshair,
  dash: renderDash,
  drone: renderDrone,
  'energy-core': renderEnergyCore,
  'energy-orb': renderEnergyOrb,
  'energy-shield': renderEnergyShield,
  fireball: renderFireball,
  flame: renderFlame,
  'flame-ring': renderFlameRing,
  hydra: renderHydra,
  lightning: renderLightning,
  meteor: renderMeteor,
  molotov: renderMolotov,
  mushroom: renderMushroom,
  projectile: renderProjectile,
  rage: renderRage,
  rifle: renderRifle,
  rocket: renderRocket,
  shield: renderShield,
  shotgun: renderShotgun,
  skull: renderSkull,
  slime: renderSlime,
  sniper: renderSniper,
  spirit: renderSpirit,
  syringe: renderSyringe,
  turret: renderTurret,
});

const MODIFIER_RENDERERS = Object.freeze({
  adrenaline: renderAdrenalineModifier,
  armor: renderArmor,
  autonomous: renderAutonomous,
  'build-range': renderBuildRange,
  chain: renderChain,
  chance: renderChance,
  charge: renderCharge,
  corridor: renderCorridor,
  'cost-down': renderCostDown,
  count: renderCount,
  crown: renderCrown,
  damage: renderDamage,
  death: renderDeath,
  dome: renderDome,
  drop: renderDrop,
  duration: renderDuration,
  enable: renderEnable,
  explosion: renderExplosion,
  field: renderField,
  fire: renderFire,
  fragments: renderFragments,
  full: renderFull,
  gain: renderGain,
  ground: renderGround,
  growth: renderGrowth,
  health: renderHealth,
  impact: renderImpact,
  killstreak: renderKillstreak,
  'large-explosion': renderLargeExplosion,
  lightning: renderLightningModifier,
  link: renderLink,
  'machine-gun': renderMachineGun,
  max: renderMax,
  moving: renderMoving,
  pack: renderPack,
  pickup: renderPickup,
  pierce: renderPierce,
  plasma: renderPlasma,
  plus: renderPlus,
  power: renderPower,
  precision: renderPrecision,
  projectile: renderProjectileModifier,
  projectiles: renderProjectiles,
  proximity: renderProximity,
  radial: renderRadial,
  radius: renderRadius,
  rage: renderRageModifier,
  range: renderRange,
  recovery: renderRecovery,
  reflect: renderReflect,
  repair: renderRepair,
  return: renderReturn,
  revive: renderRevive,
  rock: renderRock,
  rocket: renderRocketModifier,
  size: renderSize,
  slots: renderSlots,
  slow: renderSlow,
  speed: renderSpeed,
  split: renderSplit,
  stack: renderStack,
  summon: renderSummon,
  'threshold-down': renderThresholdDown,
  trail: renderTrail,
  trinity: renderTrinity,
  'triple-explosion': renderTripleExplosion,
});

export function getSupportedSymbols() {
  return Object.freeze(Object.keys(SYMBOL_RENDERERS));
}

export function getSupportedModifiers() {
  return Object.freeze(Object.keys(MODIFIER_RENDERERS));
}

export function renderUpgradeIcon({ symbol, modifiers, color, palette }) {
  const colors = palette[color];
  if (!colors) throw new Error(`Unknown icon color "${color}".`);

  const symbolRenderer = SYMBOL_RENDERERS[symbol];
  if (!symbolRenderer) throw new Error(`Main symbol "${symbol}" is not implemented.`);

  const renderedModifiers = modifiers.map((modifier, index) => {
    const modifierRenderer = MODIFIER_RENDERERS[modifier];
    if (!modifierRenderer) throw new Error(`Modifier "${modifier}" is not implemented.`);
    return modifierRenderer(colors, { index, total: modifiers.length });
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${ICON_VIEWBOX}"><g>${symbolRenderer(colors)}${renderedModifiers}</g></svg>`;
}
