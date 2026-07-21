import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceRoots = [
  path.join(repoRoot, '.ai', 'skills'),
  path.join(repoRoot, '.ai', 'vendor', 'phaser-skills'),
];
const targetRoots = [
  path.join(repoRoot, '.agents', 'skills'),
  path.join(repoRoot, '.claude', 'skills'),
];
const manifestName = '.sync-ai-skills-manifest.json';
const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;

async function discoverSkills(sourceRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!skillNamePattern.test(entry.name)) {
      throw new Error(`Invalid skill directory name: ${path.relative(repoRoot, path.join(sourceRoot, entry.name))}`);
    }

    const skillDir = path.join(sourceRoot, entry.name);
    const files = await readdir(skillDir);
    if (!files.includes('SKILL.md')) continue;
    skills.push({ name: entry.name, source: skillDir });
  }

  return skills;
}

async function readPreviousManifest(targetRoot) {
  try {
    const raw = await readFile(path.join(targetRoot, manifestName), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.generatedBy !== 'scripts/sync-ai-skills.mjs' || !Array.isArray(parsed.skills)) {
      throw new Error('unrecognized manifest format');
    }
    return parsed.skills.filter((name) => typeof name === 'string' && skillNamePattern.test(name));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`Cannot read ${path.relative(repoRoot, targetRoot)} manifest: ${error.message}`);
  }
}

async function replaceSkill(targetRoot, skill) {
  const destination = path.join(targetRoot, skill.name);
  // Copy directly after a scoped removal. Directory renames can fail with EPERM on
  // Windows while Codex or Claude watches the skill root for live changes.
  await rm(destination, { recursive: true, force: true });
  await cp(skill.source, destination, { recursive: true, force: true, errorOnExist: false });
}

async function writeManifest(targetRoot, skillNames) {
  const manifestPath = path.join(targetRoot, manifestName);
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  const contents = `${JSON.stringify({
    generatedBy: 'scripts/sync-ai-skills.mjs',
    canonicalSources: ['.ai/skills', '.ai/vendor/phaser-skills'],
    skills: skillNames,
  }, null, 2)}\n`;
  await writeFile(temporary, contents, 'utf8');
  await rm(manifestPath, { force: true });
  await rename(temporary, manifestPath);
}

async function syncTarget(targetRoot, skills) {
  await mkdir(targetRoot, { recursive: true });
  const previousNames = await readPreviousManifest(targetRoot);
  const desiredNames = new Set(skills.map((skill) => skill.name));

  for (const staleName of previousNames) {
    if (!desiredNames.has(staleName)) {
      await rm(path.join(targetRoot, staleName), { recursive: true, force: true });
      console.log(`[remove] ${path.relative(repoRoot, path.join(targetRoot, staleName))}`);
    }
  }

  for (const skill of skills) {
    await replaceSkill(targetRoot, skill);
  }
  const skillNames = [...desiredNames].sort();
  await writeManifest(targetRoot, skillNames);
  console.log(`[sync] ${path.relative(repoRoot, targetRoot)}: ${skillNames.length} skills`);
}

async function main() {
  const discovered = (await Promise.all(sourceRoots.map(discoverSkills))).flat();
  const byName = new Map();
  for (const skill of discovered) {
    const previous = byName.get(skill.name);
    if (previous) {
      throw new Error(`Duplicate skill '${skill.name}' in ${path.relative(repoRoot, previous.source)} and ${path.relative(repoRoot, skill.source)}`);
    }
    byName.set(skill.name, skill);
  }

  const skills = [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
  if (skills.length === 0) throw new Error('No canonical skills found.');

  for (const targetRoot of targetRoots) {
    await syncTarget(targetRoot, skills);
  }
  console.log(`[done] Mirrored ${skills.length} canonical skills to Codex and Claude Code.`);
}

main().catch((error) => {
  console.error(`[sync-ai-skills] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
