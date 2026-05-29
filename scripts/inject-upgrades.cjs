const fs = require('fs');

const missing = [
  "UPGRADE_PLASMA_PROJECTILE_SPEED", "UPGRADE_ASMD_PRIMARY_RANGE", "UPGRADE_ASMD_PRIMARY_COOLDOWN", "UPGRADE_BITE_RANGE", "UPGRADE_BITE_HIT_ARC", "UPGRADE_HYDRA_SPLIT_COUNT", "UPGRADE_HYDRA_PROJECTILE_SPEED", "UPGRADE_XBOW_PELLET_COUNT", "UPGRADE_XBOW_PROJECTILE_SPEED", "UPGRADE_LAUBBLAESER_KNOCKBACK", "UPGRADE_LAUBBLAESER_HITBOX_SIZE", "UPGRADE_AK47_RANGE", "UPGRADE_AK47_ACCURACY", "UPGRADE_SHOTGUN_PELLET_COUNT", "UPGRADE_SHOTGUN_PELLET_SPREAD", "UPGRADE_ASMD_SECONDARY_EXPLOSION_RADIUS", "UPGRADE_ASMD_SECONDARY_PROJECTILE_SPEED", "UPGRADE_MINI_ROCKET_LAUNCHER_EXPLOSION_RADIUS", "UPGRADE_MINI_ROCKET_LAUNCHER_HOMING_TURN", "UPGRADE_AWP_COOLDOWN", "UPGRADE_AWP_ACCURACY", "UPGRADE_FLAMETHROWER_BURN_DURATION", "UPGRADE_FLAMETHROWER_BURN_DAMAGE", "UPGRADE_NEGEV_RANGE", "UPGRADE_NEGEV_PROJECTILE_SPEED", "UPGRADE_TESLA_DOME_RADIUS", "UPGRADE_TESLA_DOME_DAMAGE", "UPGRADE_ENERGY_SHIELD_ARC", "UPGRADE_ENERGY_SHIELD_CAPACITY", "UPGRADE_HE_GRENADE_DAMAGE", "UPGRADE_TIME_BUBBLE_DURATION", "UPGRADE_SMOKE_GRENADE_RADIUS", "UPGRADE_SMOKE_GRENADE_DURATION", "UPGRADE_MOLOTOV_GRENADE_RADIUS", "UPGRADE_MOLOTOV_GRENADE_DURATION", "UPGRADE_STINKDRUESEN_RADIUS", "UPGRADE_STINKDRUESEN_DAMAGE", "UPGRADE_TRANSLOCATOR_PROJECTILE_SPEED", "UPGRADE_TRANSLOCATOR_BOUNCES", "UPGRADE_FELSBAU_HP", "UPGRADE_FELSBAU_DURATION", "UPGRADE_FLIEGENPILZ_HP", "UPGRADE_FLIEGENPILZ_RANGE", "UPGRADE_ZEUS_TASER_RANGE", "UPGRADE_ZEUS_TASER_ARC", "UPGRADE_DECOY_DURATION", "UPGRADE_DECOY_STEALTH_DURATION", "UPGRADE_GAUSS_RIFLE_DAMAGE", "UPGRADE_GAUSS_RIFLE_CHARGE_DURATION", "UPGRADE_AIRSTRIKE_RADIUS", "UPGRADE_AIRSTRIKE_DELAY", "UPGRADE_HONEY_BADGER_RAGE_RADIUS", "UPGRADE_HONEY_BADGER_RAGE_DAMAGE"
];

let generatedCode = "";

missing.forEach(id => {
  let body = "";
  if (id.includes("SPEED") || id.includes("DELAY") || id.includes("CHARGE_DURATION")) {
    body = `
    // SPEED / DELAY icon
    fillRect(img, 14, 14, 8, 4, C.GREY_MID);
    fillRect(img, 22, 15, 3, 2, C.GOLD_LIGHT);
    setPixel(img, 25, 16, C.WHITE);
    drawLine(img, 16, 14, 16, 17, C.GREY_DARKEST);
    drawLine(img, 2, 12, 12, 12, C.CYAN_LIGHT);
    drawLine(img, 6, 15, 12, 15, C.CYAN_LIGHT);
    drawLine(img, 1, 18, 12, 18, C.CYAN_LIGHT);
    drawLine(img, 4, 21, 14, 21, C.CYAN);`;
  } else if (id.includes("RANGE") || id.includes("KNOCKBACK")) {
    body = `
    // RANGE / KNOCKBACK icon
    drawLine(img, 4, 16, 26, 16, C.CYAN_LIGHT);
    drawLine(img, 24, 13, 28, 16, C.WHITE);
    drawLine(img, 24, 19, 28, 16, C.WHITE);
    drawLine(img, 4, 12, 4, 20, C.CYAN);
    drawLine(img, 10, 14, 10, 18, C.CYAN);
    drawLine(img, 16, 14, 16, 18, C.CYAN);`;
  } else if (id.includes("DAMAGE")) {
    body = `
    // DAMAGE icon
    drawCircle(img, 16, 16, 8, C.RED);
    drawLine(img, 16, 4, 16, 28, C.RED_LIGHT);
    drawLine(img, 4, 16, 28, 16, C.RED_LIGHT);
    drawLine(img, 8, 8, 24, 24, C.ORANGE);
    drawLine(img, 8, 24, 24, 8, C.ORANGE);
    fillCircle(img, 16, 16, 3, C.RED_DARK);
    setPixel(img, 16, 16, C.WHITE);`;
  } else if (id.includes("COOLDOWN") || id.includes("DURATION")) {
    body = `
    // COOLDOWN / DURATION icon
    drawCircle(img, 16, 16, 10, C.BLUE_LIGHT);
    fillCircle(img, 16, 16, 9, C.BLUE_DARK);
    drawLine(img, 16, 16, 16, 8, C.CYAN);
    drawLine(img, 16, 16, 22, 16, C.CYAN_LIGHT);
    setPixel(img, 16, 16, C.WHITE);
    fillRect(img, 14, 4, 4, 2, C.GREY_LIGHT);`;
  } else if (id.includes("RADIUS") || id.includes("ARC") || id.includes("SPREAD") || id.includes("SIZE")) {
    body = `
    // RADIUS / ARC / SPREAD icon
    fillCircle(img, 16, 16, 2, C.ORANGE_DARK);
    for (let r = 6; r <= 14; r += 4) {
      drawCircle(img, 16, 16, r, r === 10 ? C.ORANGE : C.YELLOW);
    }
    drawLine(img, 16, 10, 16, 6, C.WHITE);
    drawLine(img, 16, 22, 16, 26, C.WHITE);
    drawLine(img, 10, 16, 6, 16, C.WHITE);
    drawLine(img, 22, 16, 26, 16, C.WHITE);`;
  } else if (id.includes("COUNT") || id.includes("BOUNCES")) {
    body = `
    // COUNT / SPLIT / BOUNCE icon
    fillCircle(img, 10, 16, 3, C.GREEN);
    fillCircle(img, 18, 10, 3, C.GREEN_LIGHT);
    fillCircle(img, 22, 22, 3, C.GREEN_LIGHT);
    drawLine(img, 12, 15, 16, 12, C.WHITE);
    drawLine(img, 12, 17, 19, 21, C.WHITE);
    setPixel(img, 10, 16, C.WHITE);
    setPixel(img, 18, 10, C.WHITE);
    setPixel(img, 22, 22, C.WHITE);`;
  } else if (id.includes("ACCURACY")) {
    body = `
    // ACCURACY icon
    drawCircle(img, 16, 16, 12, C.GREEN_DARK);
    drawCircle(img, 16, 16, 6, C.GREEN);
    drawLine(img, 16, 2, 16, 30, C.GREEN_LIGHT);
    drawLine(img, 2, 16, 30, 16, C.GREEN_LIGHT);
    setPixel(img, 16, 16, C.WHITE);`;
  } else if (id.includes("HP") || id.includes("CAPACITY")) {
    body = `
    // HP / CAPACITY icon
    fillRect(img, 10, 12, 12, 10, C.RED_DARK);
    fillRect(img, 12, 10, 8, 14, C.RED_DARK);
    drawLine(img, 16, 12, 16, 22, C.WHITE);
    drawLine(img, 12, 17, 20, 17, C.WHITE);
    setPixel(img, 12, 12, C.RED_LIGHT);
    setPixel(img, 20, 12, C.RED_LIGHT);`;
  } else if (id.includes("HOMING")) {
    body = `
    // HOMING icon
    fillCircle(img, 24, 10, 3, C.BLUE_LIGHT);
    setPixel(img, 24, 10, C.WHITE);
    drawLine(img, 8, 24, 8, 16, C.CYAN);
    drawLine(img, 8, 16, 14, 10, C.CYAN_LIGHT);
    drawLine(img, 14, 10, 20, 10, C.WHITE);
    drawLine(img, 18, 8, 21, 10, C.WHITE);
    drawLine(img, 18, 12, 21, 10, C.WHITE);`;
  } else {
    body = `
    // DEFAULT fallback
    drawCircle(img, 16, 16, 10, C.PURPLE);
    setPixel(img, 16, 16, C.WHITE);`;
  }

  generatedCode += `,\n\n  ${id}: (img) => {${body}\n  }`;
});

let content = fs.readFileSync('scripts/generate-fallback.mjs', 'utf8');
content = content.replace(/\n};\n\nasync function generateAll\(\)/, generatedCode + '\n};\n\nasync function generateAll()');
fs.writeFileSync('scripts/generate-fallback.mjs', content);
console.log('Injected ' + missing.length + ' missing upgrades!');
