const fs = require('fs');

const originalContent = fs.readFileSync('scripts/generate-fallback.mjs', 'utf8');

// Find the line where UPGRADE_HP starts to cut off the specific upgrades
const upgradeHpIndex = originalContent.indexOf('UPGRADE_HP: (img) => {');
if (upgradeHpIndex === -1) {
  console.error("Could not find UPGRADE_HP in the file.");
  process.exit(1);
}

// Keep everything up to the UPGRADE_HP definition
let newContent = originalContent.substring(0, upgradeHpIndex);

// Add the generic drawing functions to DRAWERS and close it
const genericFunctions = `
  // Generic Drawers for Upgrades
  GENERIC_SPEED: (img) => {
    // SPEED / DELAY icon
    fillRect(img, 14, 14, 8, 4, C.GREY_MID);
    fillRect(img, 22, 15, 3, 2, C.GOLD_LIGHT);
    setPixel(img, 25, 16, C.WHITE);
    drawLine(img, 16, 14, 16, 17, C.GREY_DARKEST);
    drawLine(img, 2, 12, 12, 12, C.CYAN_LIGHT);
    drawLine(img, 6, 15, 12, 15, C.CYAN_LIGHT);
    drawLine(img, 1, 18, 12, 18, C.CYAN_LIGHT);
    drawLine(img, 4, 21, 14, 21, C.CYAN);
  },
  GENERIC_RANGE: (img) => {
    // RANGE / KNOCKBACK icon
    drawLine(img, 4, 16, 26, 16, C.CYAN_LIGHT);
    drawLine(img, 24, 13, 28, 16, C.WHITE);
    drawLine(img, 24, 19, 28, 16, C.WHITE);
    drawLine(img, 4, 12, 4, 20, C.CYAN);
    drawLine(img, 10, 14, 10, 18, C.CYAN);
    drawLine(img, 16, 14, 16, 18, C.CYAN);
  },
  GENERIC_DAMAGE: (img) => {
    // DAMAGE icon
    drawCircle(img, 16, 16, 8, C.RED);
    drawLine(img, 16, 4, 16, 28, C.RED_LIGHT);
    drawLine(img, 4, 16, 28, 16, C.RED_LIGHT);
    drawLine(img, 8, 8, 24, 24, C.ORANGE);
    drawLine(img, 8, 24, 24, 8, C.ORANGE);
    fillCircle(img, 16, 16, 3, C.RED_DARK);
    setPixel(img, 16, 16, C.WHITE);
  },
  GENERIC_TIME: (img) => {
    // COOLDOWN / DURATION icon
    drawCircle(img, 16, 16, 10, C.BLUE_LIGHT);
    fillCircle(img, 16, 16, 9, C.BLUE_DARK);
    drawLine(img, 16, 16, 16, 8, C.CYAN);
    drawLine(img, 16, 16, 22, 16, C.CYAN_LIGHT);
    setPixel(img, 16, 16, C.WHITE);
    fillRect(img, 14, 4, 4, 2, C.GREY_LIGHT);
  },
  GENERIC_AREA: (img) => {
    // RADIUS / ARC / SPREAD icon
    fillCircle(img, 16, 16, 2, C.ORANGE_DARK);
    for (let r = 6; r <= 14; r += 4) {
      drawCircle(img, 16, 16, r, r === 10 ? C.ORANGE : C.YELLOW);
    }
    drawLine(img, 16, 10, 16, 6, C.WHITE);
    drawLine(img, 16, 22, 16, 26, C.WHITE);
    drawLine(img, 10, 16, 6, 16, C.WHITE);
    drawLine(img, 22, 16, 26, 16, C.WHITE);
  },
  GENERIC_MULTIPLE: (img) => {
    // COUNT / SPLIT / BOUNCE icon
    fillCircle(img, 10, 16, 3, C.GREEN);
    fillCircle(img, 18, 10, 3, C.GREEN_LIGHT);
    fillCircle(img, 22, 22, 3, C.GREEN_LIGHT);
    drawLine(img, 12, 15, 16, 12, C.WHITE);
    drawLine(img, 12, 17, 19, 21, C.WHITE);
    setPixel(img, 10, 16, C.WHITE);
    setPixel(img, 18, 10, C.WHITE);
    setPixel(img, 22, 22, C.WHITE);
  },
  GENERIC_ACCURACY: (img) => {
    // ACCURACY icon
    drawCircle(img, 16, 16, 12, C.GREEN_DARK);
    drawCircle(img, 16, 16, 6, C.GREEN);
    drawLine(img, 16, 2, 16, 30, C.GREEN_LIGHT);
    drawLine(img, 2, 16, 30, 16, C.GREEN_LIGHT);
    setPixel(img, 16, 16, C.WHITE);
  },
  GENERIC_HP: (img) => {
    // HP / CAPACITY icon
    fillRect(img, 10, 12, 12, 10, C.RED_DARK);
    fillRect(img, 12, 10, 8, 14, C.RED_DARK);
    drawLine(img, 16, 12, 16, 22, C.WHITE);
    drawLine(img, 12, 17, 20, 17, C.WHITE);
    setPixel(img, 12, 12, C.RED_LIGHT);
    setPixel(img, 20, 12, C.RED_LIGHT);
  },
  GENERIC_HOMING: (img) => {
    // HOMING icon
    fillCircle(img, 24, 10, 3, C.BLUE_LIGHT);
    setPixel(img, 24, 10, C.WHITE);
    drawLine(img, 8, 24, 8, 16, C.CYAN);
    drawLine(img, 8, 16, 14, 10, C.CYAN_LIGHT);
    drawLine(img, 14, 10, 20, 10, C.WHITE);
    drawLine(img, 18, 8, 21, 10, C.WHITE);
    drawLine(img, 18, 12, 21, 10, C.WHITE);
  },
  GENERIC_ENERGY: (img) => {
    // ENERGY / ADRENALINE / RAGE
    drawCircle(img, 16, 16, 11, C.GOLD);
    fillCircle(img, 16, 16, 10, C.GREY_DARKEST);
    drawLine(img, 17, 6, 12, 15, C.YELLOW);
    drawLine(img, 12, 15, 16, 15, C.YELLOW);
    drawLine(img, 16, 15, 13, 26, C.GOLD_LIGHT);
    drawLine(img, 13, 26, 20, 13, C.WHITE);
    drawLine(img, 20, 13, 16, 13, C.WHITE);
    drawLine(img, 16, 13, 18, 6, C.YELLOW);
  },
  GENERIC_SLOW: (img) => {
    // SLOW down arrows
    drawCircle(img, 16, 16, 10, C.BLUE_DARK);
    drawLine(img, 16, 8, 16, 24, C.BLUE_LIGHT);
    drawLine(img, 16, 24, 12, 20, C.CYAN);
    drawLine(img, 16, 24, 20, 20, C.CYAN);
  },
  GENERIC_DEFAULT: (img) => {
    // DEFAULT fallback
    drawCircle(img, 16, 16, 10, C.PURPLE);
    setPixel(img, 16, 16, C.WHITE);
  }
};

function getUpgradeCategory(statOrId) {
  if (!statOrId) return 'GENERIC_DEFAULT';
  const s = statOrId.toLowerCase();
  if (s.includes('speed') || s.includes('delay') || s.includes('charge')) return 'GENERIC_SPEED';
  if (s.includes('range') || s.includes('knockback')) return 'GENERIC_RANGE';
  if (s.includes('damage')) return 'GENERIC_DAMAGE';
  if (s.includes('cooldown') || s.includes('duration') || s.includes('lifetime') || s.includes('warmup') || s.includes('rate')) return 'GENERIC_TIME';
  if (s.includes('radius') || s.includes('arc') || s.includes('spread') || s.includes('size')) return 'GENERIC_AREA';
  if (s.includes('count') || s.includes('bounce') || s.includes('pierce')) return 'GENERIC_MULTIPLE';
  if (s.includes('accuracy')) return 'GENERIC_ACCURACY';
  if (s.includes('hp') || s.includes('capacity') || s.includes('buffmax') || s.includes('max')) return 'GENERIC_HP';
  if (s.includes('turn') || s.includes('homing')) return 'GENERIC_HOMING';
  if (s.includes('adrenaline') || s.includes('rage')) return 'GENERIC_ENERGY';
  if (s.includes('slow')) return 'GENERIC_SLOW';
  return 'GENERIC_DEFAULT';
}

async function generateAll() {
  console.log("Starting procedural sprite generation...");
  
  const targetDir = "c:\\\\Fragdachse\\\\public\\\\assets\\\\sprites\\\\Loadout";
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Draw base items from DRAWERS (excluding GENERIC_*)
  for (const [id, drawFunc] of Object.entries(DRAWERS)) {
    if (id.startsWith('GENERIC_')) continue;
    console.log(\`Generating base sprite for: \${id}...\`);
    try {
      const img = new Jimp({ width: 32, height: 32, color: 0x00000000 });
      drawFunc(img);
      applyOutline(img, C.OUTLINE);
      await img.write(path.join(targetDir, \`\${id}.png\`));
    } catch (e) {
      console.error(\`Error generating \${id}:\`, e);
    }
  }

  // Load coopDefenseUpgrades.json and generate identical symbols for upgrades
  console.log("Reading coopDefenseUpgrades.json to generate upgrade sprites...");
  const configPath = 'c:\\\\Fragdachse\\\\src\\\\config\\\\coopDefenseUpgrades.json';
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const upgrades = config.categories.flatMap(c => c.upgrades).filter(u => u.kind === 'upgrade');
    
    for (const u of upgrades) {
      const upgradeKey = 'UPGRADE_' + u.id.toUpperCase();
      // Determine stat string (use id if effects is missing or empty)
      let statString = u.id;
      if (u.effects && u.effects.length > 0) {
        statString += '_' + u.effects.map(e => e.stat).join('_');
      }
      
      const category = getUpgradeCategory(statString);
      console.log(\`Generating upgrade sprite for: \${upgradeKey} using \${category}...\`);
      
      try {
        const img = new Jimp({ width: 32, height: 32, color: 0x00000000 });
        DRAWERS[category](img);
        applyOutline(img, C.OUTLINE);
        await img.write(path.join(targetDir, \`\${upgradeKey}.png\`));
      } catch (e) {
        console.error(\`Error generating \${upgradeKey}:\`, e);
      }
    }
  } else {
    console.error("coopDefenseUpgrades.json not found!");
  }

  console.log("All procedural sprites generated successfully.");
}

generateAll();
`;

newContent += genericFunctions;

fs.writeFileSync('scripts/generate-fallback.mjs', newContent);
console.log("generate-fallback.mjs has been refactored!");
