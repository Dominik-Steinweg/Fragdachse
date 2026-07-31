import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createIconPalette,
  getSupportedModifiers,
  getSupportedSymbols,
  renderUpgradeIcon,
  SUPPORTED_RECIPE_COLORS,
} from './upgrade-icon-symbols.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPOSITORY_ROOT, 'src', 'config.ts');
const PENDING_UPGRADES_PATH = path.join(REPOSITORY_ROOT, 'src', 'utils', 'coopDefenseUpgrades.ts');
const SVG_OUTPUT_DIR = path.join(SCRIPT_DIR, 'generated-upgrade-icons', 'svg');
const PNG_OUTPUT_DIR = path.join(REPOSITORY_ROOT, 'public', 'assets', 'sprites', 'Loadout');

function parseArguments(args) {
  let force = false;
  let id = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (argument === '--id') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--id requires an upgrade ID.');
      }
      id = next;
      index += 1;
      continue;
    }
    if (argument.startsWith('--id=')) {
      id = argument.slice('--id='.length);
      if (!id) throw new Error('--id requires an upgrade ID.');
      continue;
    }
    throw new Error(`Unknown argument "${argument}". Use --id <upgrade-id> and/or --force.`);
  }

  return { force, id };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findRecipeFile(repositoryRoot) {
  const directories = [repositoryRoot];
  const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);

  while (directories.length > 0) {
    const currentDirectory = directories.shift();
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isFile() && entry.name === 'recept.json') return entryPath;
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) directories.push(entryPath);
    }
  }

  throw new Error(`recept.json was not found below ${repositoryRoot}.`);
}

async function readRecipes(recipePath) {
  let source;
  try {
    source = await readFile(recipePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read recept.json at ${recipePath}: ${error.message}`);
  }

  let rawRecipes;
  try {
    rawRecipes = JSON.parse(source);
  } catch (error) {
    throw new Error(`recept.json is not valid JSON: ${error.message}`);
  }

  if (!rawRecipes || Array.isArray(rawRecipes) || typeof rawRecipes !== 'object') {
    throw new Error('recept.json must contain an object keyed by upgrade ID.');
  }

  const recipes = [];
  for (const [id, recipe] of Object.entries(rawRecipes)) {
    if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/i.test(id)) {
      throw new Error(`Upgrade ID "${id}" cannot be used safely as an output filename.`);
    }
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
      throw new Error(`Recipe "${id}" must be an object.`);
    }
    if (typeof recipe.symbol !== 'string' || recipe.symbol.trim() === '') {
      throw new Error(`Recipe "${id}" has no valid symbol.`);
    }
    if (!Array.isArray(recipe.modifiers)) {
      throw new Error(`Recipe "${id}" must provide modifiers as an array.`);
    }
    if (recipe.modifiers.some((modifier) => typeof modifier !== 'string' || modifier.trim() === '')) {
      throw new Error(`Recipe "${id}" contains an invalid modifier.`);
    }
    if (typeof recipe.color !== 'string' || recipe.color.trim() === '') {
      throw new Error(`Recipe "${id}" has no valid color.`);
    }
    recipes.push({
      id,
      symbol: recipe.symbol,
      modifiers: [...recipe.modifiers],
      color: recipe.color,
    });
  }

  return recipes;
}

async function readProjectColors(configPath) {
  let source;
  try {
    source = await readFile(configPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read the project color palette at ${configPath}: ${error.message}`);
  }

  const colorsMatch = source.match(/export\s+const\s+COLORS\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
  if (!colorsMatch) throw new Error(`Could not find export const COLORS in ${configPath}.`);

  const colors = {};
  for (const entry of colorsMatch[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*(0x[0-9a-f]+|[0-9]+)\s*,?/gim)) {
    colors[entry[1]] = Number.parseInt(entry[2], entry[2].toLowerCase().startsWith('0x') ? 16 : 10);
  }
  return colors;
}

async function readPendingUpgradeIds(filePath) {
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read COOP_DEFENSE_PENDING_UPGRADE_ICONS at ${filePath}: ${error.message}`);
  }

  const pendingMatch = source.match(/COOP_DEFENSE_PENDING_UPGRADE_ICONS[\s\S]*?new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!pendingMatch) throw new Error(`Could not find COOP_DEFENSE_PENDING_UPGRADE_ICONS in ${filePath}.`);

  return [...pendingMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function listDifferences(recipes, pendingIds) {
  const recipeIds = recipes.map((recipe) => recipe.id);
  return {
    missingRecipes: pendingIds.filter((id) => !recipeIds.includes(id)),
    recipesOutsidePending: recipeIds.filter((id) => !pendingIds.includes(id)),
  };
}

function formatIds(ids) {
  return ids.length === 0 ? 'none' : ids.join(', ');
}

function validateRecipeReferences(recipes, palette) {
  const supportedSymbols = new Set(getSupportedSymbols());
  const supportedModifiers = new Set(getSupportedModifiers());
  const supportedColors = new Set(SUPPORTED_RECIPE_COLORS);

  const unknownSymbols = [...new Set(recipes.map((recipe) => recipe.symbol).filter((symbol) => !supportedSymbols.has(symbol)))];
  if (unknownSymbols.length > 0) {
    throw new Error(`Main symbol(s) not implemented: ${unknownSymbols.join(', ')}.`);
  }

  const unknownModifiers = [...new Set(recipes.flatMap((recipe) => recipe.modifiers).filter((modifier) => !supportedModifiers.has(modifier)))];
  if (unknownModifiers.length > 0) {
    throw new Error(`Modifier(s) not implemented: ${unknownModifiers.join(', ')}.`);
  }

  const unknownColors = [...new Set(recipes.map((recipe) => recipe.color).filter((color) => !supportedColors.has(color) || !palette[color]))];
  if (unknownColors.length > 0) {
    throw new Error(`Unknown recipe color(s): ${unknownColors.join(', ')}.`);
  }
}

async function loadSharp() {
  try {
    const sharpModule = await import('sharp');
    return sharpModule.default ?? sharpModule;
  } catch (error) {
    throw new Error(`The sharp package is required to render SVG icons. Run npm install first. (${error.message})`);
  }
}

async function verifyPng(sharp, pngPath) {
  const metadata = await sharp(pngPath).metadata();
  if (metadata.width !== 32 || metadata.height !== 32) {
    throw new Error(`Generated ${pngPath} is ${metadata.width}x${metadata.height}, expected 32x32.`);
  }
  if (metadata.channels !== 4) {
    throw new Error(`Generated ${pngPath} does not have RGBA channels.`);
  }

  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minimumAlpha = 255;
  for (let index = 3; index < data.length; index += info.channels) minimumAlpha = Math.min(minimumAlpha, data[index]);
  if (minimumAlpha === 255) throw new Error(`Generated ${pngPath} has no transparent pixels.`);
}

async function generateIcon(sharp, recipe, palette, force) {
  const fileStem = `UPGRADE_${recipe.id.toUpperCase()}`;
  const svgPath = path.join(SVG_OUTPUT_DIR, `${fileStem}.svg`);
  const pngPath = path.join(PNG_OUTPUT_DIR, `${fileStem}.png`);
  const svg = renderUpgradeIcon({
    symbol: recipe.symbol,
    modifiers: recipe.modifiers,
    color: recipe.color,
    palette,
  });

  await writeFile(svgPath, `${svg}\n`, 'utf8');
  if (!force && await pathExists(pngPath)) return { generated: false, skipped: true };

  await sharp(Buffer.from(svg))
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toFile(pngPath);
  await verifyPng(sharp, pngPath);
  return { generated: true, skipped: false };
}

function printSummary({ recipePath, recipes, selectedRecipes, generated, skipped, pendingIds, differences }) {
  const symbols = [...new Set(recipes.map((recipe) => recipe.symbol))].sort();
  const modifiers = [...new Set(recipes.flatMap((recipe) => recipe.modifiers))].sort();
  const colors = [...new Set(recipes.map((recipe) => recipe.color))].sort();

  console.log(`Recipe file: ${path.relative(REPOSITORY_ROOT, recipePath)}`);
  console.log(`Recipes read: ${recipes.length}`);
  console.log(`Recipes processed: ${selectedRecipes.length}`);
  console.log(`Icons generated: ${generated}`);
  console.log(`Existing PNGs skipped: ${skipped}`);
  console.log(`Pending IDs: ${pendingIds.length}`);
  console.log(`Recipe IDs missing from pending list: ${formatIds(differences.recipesOutsidePending)}`);
  console.log(`Pending IDs missing a recipe: ${formatIds(differences.missingRecipes)}`);
  console.log(`Main symbols: ${symbols.join(', ')}`);
  console.log(`Modifiers: ${modifiers.join(', ')}`);
  console.log(`Colors: ${colors.join(', ')}`);
}

async function main() {
  const { force, id } = parseArguments(process.argv.slice(2));
  const recipePath = await findRecipeFile(REPOSITORY_ROOT);
  const recipes = await readRecipes(recipePath);
  const pendingIds = await readPendingUpgradeIds(PENDING_UPGRADES_PATH);
  const differences = listDifferences(recipes, pendingIds);

  if (id && !recipes.some((recipe) => recipe.id === id)) {
    throw new Error(`Unknown upgrade ID "${id}". It is not present in recept.json.`);
  }
  if (differences.missingRecipes.length > 0 || differences.recipesOutsidePending.length > 0) {
    throw new Error('Recipe IDs and COOP_DEFENSE_PENDING_UPGRADE_ICONS differ. Resolve the mismatch without changing the pending list automatically.');
  }

  const projectColors = await readProjectColors(CONFIG_PATH);
  const palette = createIconPalette(projectColors);
  validateRecipeReferences(recipes, palette);

  const selectedRecipes = id ? recipes.filter((recipe) => recipe.id === id) : recipes;
  const sharp = await loadSharp();
  await mkdir(SVG_OUTPUT_DIR, { recursive: true });
  await mkdir(PNG_OUTPUT_DIR, { recursive: true });

  let generated = 0;
  let skipped = 0;
  for (const recipe of selectedRecipes) {
    const result = await generateIcon(sharp, recipe, palette, force);
    if (result.generated) generated += 1;
    if (result.skipped) skipped += 1;
  }

  printSummary({ recipePath, recipes, selectedRecipes, generated, skipped, pendingIds, differences });
}

try {
  await main();
} catch (error) {
  console.error(`Upgrade icon generation failed: ${error.message}`);
  process.exitCode = 1;
}
