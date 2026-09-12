import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
const UPGRADE_REGISTRY_PATH = path.join(REPOSITORY_ROOT, 'src', 'config', 'coopDefenseUpgrades.json');
const ICON_REGISTRY_PATH = path.join(REPOSITORY_ROOT, 'src', 'config', 'coopDefenseUpgradeIcons.json');
const LOADOUT_CATALOG_PATH = path.join(REPOSITORY_ROOT, 'src', 'loadout', 'content', 'data', 'catalog.json');
const LOADOUT_ASSET_DIR = path.join(REPOSITORY_ROOT, 'public', 'assets', 'sprites', 'Loadout');

function canonicalTextureKey(upgradeId) {
  return `UPGRADE_${upgradeId.toUpperCase()}`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function duplicates(values) {
  const seen = new Set();
  const result = new Set();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return [...result].sort();
}

function groupBy(values, keyOf) {
  const groups = new Map();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

export async function auditUpgradeIcons() {
  const [upgradeRegistry, iconRegistry, loadoutCatalog] = await Promise.all([
    readJson(UPGRADE_REGISTRY_PATH),
    readJson(ICON_REGISTRY_PATH),
    readJson(LOADOUT_CATALOG_PATH),
  ]);

  const activeUpgradeIds = upgradeRegistry.categories
    .flatMap((category) => category.upgrades)
    .map((upgrade) => upgrade.id);
  const withIcon = [...iconRegistry.withIcon];
  const withoutIcon = [...iconRegistry.withoutIcon];
  const activeSet = new Set(activeUpgradeIds);
  const withIconSet = new Set(withIcon);
  const withoutIconSet = new Set(withoutIcon);
  const classifiedSet = new Set([...withIcon, ...withoutIcon]);
  const errors = [];

  for (const id of duplicates(activeUpgradeIds)) errors.push(`Duplicate active upgrade ID: ${id}`);
  for (const id of duplicates(withIcon)) errors.push(`Duplicate withIcon registry ID: ${id}`);
  for (const id of duplicates(withoutIcon)) errors.push(`Duplicate withoutIcon registry ID: ${id}`);
  for (const id of withIcon.filter((value) => withoutIconSet.has(value))) {
    errors.push(`Upgrade is classified both with and without artwork: ${id}`);
  }

  const unclassified = activeUpgradeIds.filter((id) => !classifiedSet.has(id)).sort();
  const staleRegistryIds = [...classifiedSet].filter((id) => !activeSet.has(id)).sort();
  for (const id of unclassified) errors.push(`Active upgrade lacks an explicit icon decision: ${id}`);
  for (const id of staleRegistryIds) errors.push(`Icon registry references inactive upgrade: ${id}`);

  const dedicated = withIcon
    .filter((id) => activeSet.has(id))
    .map((id) => ({
      id,
      textureKey: canonicalTextureKey(id),
      fileName: `${canonicalTextureKey(id)}.png`,
    }));
  const noDedicatedIcon = withoutIcon.filter((id) => activeSet.has(id)).sort();

  const sharedTextureKeys = [...groupBy(dedicated, (entry) => entry.textureKey).entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([textureKey, entries]) => ({ textureKey, upgradeIds: entries.map((entry) => entry.id).sort() }));
  for (const duplicate of sharedTextureKeys) {
    errors.push(`Active upgrades share texture key ${duplicate.textureKey}: ${duplicate.upgradeIds.join(', ')}`);
  }

  const missingFiles = [];
  const hashes = [];
  for (const entry of dedicated) {
    const filePath = path.join(LOADOUT_ASSET_DIR, entry.fileName);
    if (!await fileExists(filePath)) {
      missingFiles.push(entry);
      errors.push(`Registered upgrade artwork does not exist: ${entry.id} -> ${entry.fileName}`);
      continue;
    }
    const bytes = await readFile(filePath);
    hashes.push({ ...entry, hash: createHash('sha256').update(bytes).digest('hex') });
  }

  const byteIdenticalGroups = [...groupBy(hashes, (entry) => entry.hash).values()]
    .filter((entries) => entries.length > 1)
    .map((entries) => entries.map(({ id, textureKey, fileName }) => ({ id, textureKey, fileName })));
  for (const entries of byteIdenticalGroups) {
    errors.push(`Active upgrade PNGs are byte-identical: ${entries.map((entry) => entry.id).join(', ')}`);
  }

  const runtimeRequiredFiles = new Set(dedicated.map((entry) => entry.fileName));
  for (const entry of loadoutCatalog.catalog) {
    if (entry.iconKey) runtimeRequiredFiles.add(`${entry.iconKey}.png`);
  }

  const missingRuntimeFiles = [];
  for (const fileName of [...runtimeRequiredFiles].sort()) {
    if (await fileExists(path.join(LOADOUT_ASSET_DIR, fileName))) continue;
    missingRuntimeFiles.push(fileName);
    errors.push(`Runtime loader references a missing Loadout PNG: ${fileName}`);
  }

  const topLevelPngs = (await readdir(LOADOUT_ASSET_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => entry.name)
    .sort();
  const unusedPngs = topLevelPngs.filter((fileName) => !runtimeRequiredFiles.has(fileName));

  return {
    activeUpgradeIds: [...activeUpgradeIds].sort(),
    dedicated: dedicated.sort((a, b) => a.id.localeCompare(b.id)),
    noDedicatedIcon,
    missingFiles,
    missingRuntimeFiles,
    sharedTextureKeys,
    byteIdenticalGroups,
    unusedPngs,
    errors,
  };
}

function printList(label, values) {
  console.log(`${label} (${values.length}): ${values.length > 0 ? values.join(', ') : 'none'}`);
}

async function main() {
  const result = await auditUpgradeIcons();
  console.log(`Active upgrades: ${result.activeUpgradeIds.length}`);
  printList('Dedicated artwork', result.dedicated.map((entry) => `${entry.id} -> ${entry.fileName}`));
  printList('No dedicated upgrade artwork', result.noDedicatedIcon);
  printList('Missing registered PNGs', result.missingFiles.map((entry) => entry.fileName));
  printList('Missing runtime Loadout PNGs', result.missingRuntimeFiles);
  printList('Shared active texture keys', result.sharedTextureKeys.map((entry) => entry.textureKey));
  printList('Byte-identical active artwork groups', result.byteIdenticalGroups.map((entries) => entries.map((entry) => entry.id).join(' = ')));
  printList('Unused top-level Loadout PNGs', result.unusedPngs);

  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
