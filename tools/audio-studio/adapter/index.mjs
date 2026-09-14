import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const AUDIO_CATALOG_RELATIVE = path.join('src', 'audio', 'AudioCatalog.ts');
const PUBLIC_SOUNDS_RELATIVE = path.join('public', 'assets', 'sounds');
const WORKSPACE_DEFAULT = '.audio-workspace';
const TRANSACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OGG_EXTENSION = '.ogg';
const MUSIC_NAMES = new Set(['MUSIC_ASSETS']);

export class AdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AudioStudioAdapterError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new AdapterError(code, message, details);
}

function canonicalPath(value) {
  return path.resolve(value);
}

function isInside(parent, candidate) {
  const relative = path.relative(canonicalPath(parent), canonicalPath(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function realpathNearestExisting(candidate) {
  let current = canonicalPath(candidate);
  const suffix = [];
  while (true) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

async function assertSafePath(root, candidate, label, { allowMissing = false } = {}) {
  const absoluteRoot = canonicalPath(root);
  const absoluteCandidate = canonicalPath(candidate);
  if (!isInside(absoluteRoot, absoluteCandidate)) {
    fail('unsafe_path', `${label} escapes the repository root`, { root: absoluteRoot, path: absoluteCandidate });
  }
  let realRoot;
  try {
    realRoot = await fs.realpath(absoluteRoot);
  } catch (error) {
    fail('invalid_root', `Cannot resolve repository root: ${absoluteRoot}`, { cause: error.message });
  }
  const realCandidate = await realpathNearestExisting(absoluteCandidate);
  if (!isInside(realRoot, realCandidate)) {
    fail('unsafe_symlink', `${label} escapes the repository through a symlink`, { root: realRoot, path: absoluteCandidate });
  }
  if (!allowMissing) {
    try {
      await fs.access(absoluteCandidate, fsConstants.F_OK);
    } catch (error) {
      if (error?.code === 'ENOENT') fail('missing_path', `${label} does not exist`, { path: absoluteCandidate });
      throw error;
    }
  }
  return absoluteCandidate;
}

async function sha256File(filePath) {
  try {
    const bytes = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function unwrapExpression(node) {
  let current = node;
  while (current && (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isParenthesizedExpression(current))) {
    current = current.expression;
  }
  return current;
}

function propertyName(node) {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) return node.name.text;
  return null;
}

function staticString(node, sourceFile) {
  const current = unwrapExpression(node);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) return current.text;
  if (ts.isIdentifier(current) && (current.text === 'undefined' || current.text === 'null')) return null;
  fail('unsupported_catalog_syntax', `Expected a static string in ${sourceFile.fileName}`, { position: current?.getStart(sourceFile) });
}

function staticNumber(node, sourceFile) {
  const current = unwrapExpression(node);
  if (ts.isNumericLiteral(current)) return Number(current.text);
  fail('unsupported_catalog_syntax', `Expected a static number in ${sourceFile.fileName}`, { position: current?.getStart(sourceFile) });
}

function findDeclarations(sourceFile) {
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (declarations.has(node.name.text)) fail('unsupported_catalog_syntax', `Duplicate variable declaration ${node.name.text}`);
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return declarations;
}

function evaluateObject(node, declarations, sourceFile, stack = []) {
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) {
    const declaration = declarations.get(current.text);
    if (!declaration || !declaration.initializer) fail('unsupported_catalog_syntax', `Unknown catalog object ${current.text}`);
    if (stack.includes(current.text)) fail('unsupported_catalog_syntax', `Circular catalog object ${current.text}`);
    return evaluateObject(declaration.initializer, declarations, sourceFile, [...stack, current.text]);
  }
  if (!ts.isObjectLiteralExpression(current)) fail('unsupported_catalog_syntax', 'Catalog object must be a static object literal');
  const result = new Map();
  for (const element of current.properties) {
    if (ts.isSpreadAssignment(element)) {
      const spread = evaluateObject(element.expression, declarations, sourceFile, stack);
      for (const [key, value] of spread) {
        if (result.has(key)) fail('unsupported_catalog_syntax', `Duplicate catalog key ${key}`);
        result.set(key, value);
      }
      continue;
    }
    if (!ts.isPropertyAssignment(element)) fail('unsupported_catalog_syntax', 'Getters and methods are not supported in the audio catalog');
    const key = propertyName(element);
    if (key === null) fail('unsupported_catalog_syntax', 'Computed catalog keys are not supported');
    if (result.has(key)) fail('unsupported_catalog_syntax', `Duplicate catalog key ${key}`);
    result.set(key, staticString(element.initializer, sourceFile));
  }
  return result;
}

function evaluateNumberObject(node, declarations, sourceFile, stack = []) {
  const current = unwrapExpression(node);
  if (ts.isIdentifier(current)) {
    const declaration = declarations.get(current.text);
    if (!declaration?.initializer) fail('unsupported_catalog_syntax', `Unknown numeric catalog object ${current.text}`);
    if (stack.includes(current.text)) fail('unsupported_catalog_syntax', `Circular numeric catalog object ${current.text}`);
    return evaluateNumberObject(declaration.initializer, declarations, sourceFile, [...stack, current.text]);
  }
  if (!ts.isObjectLiteralExpression(current)) fail('unsupported_catalog_syntax', 'Volume registry must be a static object literal');
  const result = new Map();
  for (const element of current.properties) {
    if (!ts.isPropertyAssignment(element)) fail('unsupported_catalog_syntax', 'Unsupported volume registry syntax');
    const key = propertyName(element);
    if (key === null) fail('unsupported_catalog_syntax', 'Computed volume keys are not supported');
    if (result.has(key)) fail('unsupported_catalog_syntax', `Duplicate volume key ${key}`);
    result.set(key, staticNumber(element.initializer, sourceFile));
  }
  return result;
}

function evaluateSet(node, declarations, sourceFile) {
  const current = unwrapExpression(node);
  if (!ts.isNewExpression(current) || !ts.isIdentifier(current.expression) || current.expression.text !== 'Set' || current.arguments?.length !== 1) {
    fail('unsupported_catalog_syntax', 'SHIPPED_AUDIO_FILES must be new Set([...])');
  }
  const argument = unwrapExpression(current.arguments[0]);
  if (!ts.isArrayLiteralExpression(argument)) fail('unsupported_catalog_syntax', 'SHIPPED_AUDIO_FILES must use a static array');
  const values = new Set();
  for (const element of argument.elements) {
    if (!ts.isStringLiteral(element) && !ts.isNoSubstitutionTemplateLiteral(element)) fail('unsupported_catalog_syntax', 'Whitelist entries must be static strings');
    if (values.has(element.text)) fail('unsupported_catalog_syntax', `Duplicate whitelist entry ${element.text}`);
    values.add(element.text);
  }
  return { values, array: argument, newExpression: current };
}

function parseCatalog(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = findDeclarations(sourceFile);
  const getInitializer = (name) => {
    const declaration = declarations.get(name);
    if (!declaration?.initializer) fail('unsupported_catalog_syntax', `Missing static ${name} declaration`);
    return declaration.initializer;
  };
  const assets = evaluateObject(getInitializer('AUDIO_ASSETS'), declarations, sourceFile);
  const music = evaluateObject(getInitializer('MUSIC_ASSETS'), declarations, sourceFile);
  const volumes = evaluateNumberObject(getInitializer('SOUND_VOLUMES'), declarations, sourceFile);
  const shippedDeclaration = declarations.get('SHIPPED_AUDIO_FILES');
  if (!shippedDeclaration?.initializer) fail('unsupported_catalog_syntax', 'Missing SHIPPED_AUDIO_FILES declaration');
  const shipped = evaluateSet(shippedDeclaration.initializer, declarations, sourceFile);
  return { sourceFile, declarations, assets, music, volumes, shipped, source };
}

function canonicalCatalogHash(parsed) {
  const assets = [...parsed.assets.entries()]
    .filter(([key]) => !parsed.music.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const volumes = [...parsed.volumes.entries()].sort(([a], [b]) => a.localeCompare(b));
  const music = [...parsed.music.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sha256Bytes(Buffer.from(JSON.stringify({ assets, music, volumes, shipped: [...parsed.shipped.values].sort() })));
}

function canonicalTarget(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('./assets/sounds/')) return null;
  const relative = rawPath.slice('./'.length).replaceAll('/', path.sep);
  if (relative.includes('..') || path.isAbsolute(relative)) return null;
  return path.join('public', relative).split(path.sep).join('/');
}

function lineAndExcerpt(source, position) {
  const line = source.slice(0, position).split(/\r?\n/).length;
  const lines = source.split(/\r?\n/);
  const excerpt = (lines[line - 1] ?? '').trim().slice(0, 240);
  return { line, excerpt };
}

function collectUsageFiles(root) {
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.audio-workspace', 'tools']);
  const files = [];
  async function visit(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(candidate);
    }
  }
  return visit(root).then(() => files);
}

function classifyUsage(node) {
  let parent = node.parent;
  while (parent && !ts.isCallExpression(parent) && !ts.isPropertyAssignment(parent)) parent = parent.parent;
  if (parent && ts.isCallExpression(parent)) {
    const expression = parent.expression;
    const name = ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
    if (name === 'startLoop') return 'loop';
    if (name === 'playSound' || name === 'playLocalSound') return 'oneshot';
  }
  if (parent && ts.isPropertyAssignment(parent)) {
    const name = propertyName(parent);
    if (name === 'successKey' || name === 'failureKey') return 'oneshot';
  }
  return 'unknown';
}

async function collectUsages(root, keys) {
  const usages = new Map([...keys].map((key) => [key, []]));
  // Only shipped source/configuration describes gameplay use. Tests, scripts and
  // local work areas may quote keys without ever playing them.
  const files = await collectUsageFiles(path.join(root, 'src'));
  for (const filePath of files) {
    const relative = path.relative(root, filePath).split(path.sep).join('/');
    if (relative === AUDIO_CATALOG_RELATIVE.split(path.sep).join('/')) continue;
    const source = await fs.readFile(filePath, 'utf8');
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.json') {
      for (const key of keys) {
        let offset = 0;
        while (true) {
          const found = source.indexOf(`"${key}"`, offset);
          if (found < 0) break;
          const location = lineAndExcerpt(source, found);
          const kind = /\"(?:successKey|failureKey)\"\s*:/.test(location.excerpt) ? 'oneshot' : 'unknown';
          usages.get(key).push({ path: relative, line: location.line, kind, excerpt: location.excerpt });
          offset = found + key.length + 2;
        }
      }
      continue;
    }
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, extension.includes('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const key = node.text;
        if (usages.has(key)) {
          const location = lineAndExcerpt(source, node.getStart(sourceFile));
          usages.get(key).push({ path: relative, line: location.line, kind: classifyUsage(node), excerpt: location.excerpt });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  for (const values of usages.values()) values.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.kind.localeCompare(b.kind));
  return usages;
}

async function readRoot(rootInput) {
  const root = canonicalPath(rootInput ?? process.cwd());
  await assertSafePath(root, root, 'repository root');
  const catalogPath = await assertSafePath(root, path.join(root, AUDIO_CATALOG_RELATIVE), 'audio catalog');
  if (canonicalPath(await fs.realpath(catalogPath)) !== catalogPath) fail('unsafe_symlink', 'Audio catalog must not be reached through a symlink');
  const source = await fs.readFile(catalogPath, 'utf8');
  return { root, catalogPath, source, parsed: parseCatalog(source, catalogPath) };
}

function toRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

export async function scanRepository({ root = process.cwd() } = {}) {
  const repository = await readRoot(root);
  const { parsed } = repository;
  const sfxEntries = [...parsed.assets.entries()].filter(([key]) => !parsed.music.has(key));
  const usages = await collectUsages(repository.root, new Set(sfxEntries.map(([key]) => key)));
  const targets = new Map();
  const soundsRoot = path.join(repository.root, 'public', 'assets', 'sounds');
  await assertSafePath(repository.root, soundsRoot, 'public sound root');
  const soundsRootReal = await fs.realpath(soundsRoot);
  if (canonicalPath(soundsRootReal) !== canonicalPath(soundsRoot)) fail('unsafe_symlink', 'public/assets/sounds must not be reached through a symlink');
  for (const [key, rawPath] of sfxEntries) {
    const targetPath = canonicalTarget(rawPath);
    if (!targetPath) fail('unsafe_catalog_target', `Audio catalog target for ${key} is not a local SFX path`, { key, target: rawPath });
    const absolute = await assertSafePath(repository.root, path.join(repository.root, targetPath), `target for ${key}`, { allowMissing: true });
    const targetReal = await realpathNearestExisting(absolute);
    if (!isInside(soundsRootReal, targetReal)) {
      fail('unsafe_symlink', `Target for ${key} escapes public/assets/sounds`, { key, target: targetPath });
    }
    const existing = targets.get(targetPath) ?? [];
    existing.push(key);
    targets.set(targetPath, existing);
  }
  const entries = {};
  for (const [key, rawPath] of sfxEntries.sort(([a], [b]) => a.localeCompare(b))) {
    const targetPath = canonicalTarget(rawPath);
    const absolute = path.join(repository.root, targetPath);
    const filename = path.basename(targetPath);
    const sharedKeys = (targets.get(targetPath) ?? []).slice().sort();
    const fileHash = await sha256File(absolute);
    const shipped = parsed.shipped.values.has(filename);
    const musicUsers = [...parsed.music.entries()].filter(([, value]) => canonicalTarget(value)?.toLowerCase() === targetPath.toLowerCase()).map(([musicKey]) => musicKey);
    const conflicts = [];
    if (musicUsers.length) conflicts.push(`Target is also used by music: ${musicUsers.join(', ')}`);
    entries[key] = {
      key,
      target_path: targetPath.split(path.sep).join('/'),
      asset_path: rawPath,
      filename,
      volume: parsed.volumes.get(key) ?? null,
      shipped,
      exists: fileHash !== null,
      file_hash: fileHash,
      file_error: shipped && fileHash === null ? 'Shipped audio file is missing' : null,
      shared_keys: sharedKeys,
      usages: usages.get(key) ?? [],
      playback: inferPlayback(usages.get(key) ?? []),
      conflicts,
    };
  }
  return { catalog_hash: canonicalCatalogHash(parsed), entries };
}

function inferPlayback(usages) {
  const kinds = new Set(usages.map((usage) => usage.kind));
  if (kinds.has('loop') && !kinds.has('oneshot') && !kinds.has('unknown')) return 'loop';
  if (kinds.has('oneshot') && !kinds.has('loop') && !kinds.has('unknown')) return 'oneshot';
  return 'unknown';
}

async function ensureWorkspace(root, workspaceInput) {
  const workspaceValue = workspaceInput ?? WORKSPACE_DEFAULT;
  const workspace = canonicalPath(path.isAbsolute(workspaceValue) ? workspaceValue : path.join(root, workspaceValue));
  const rootReal = await fs.realpath(root);
  const assertWorkspaceLocation = async (workspaceReal) => {
    if (workspaceReal === rootReal) fail('unsafe_workspace', 'Workspace cannot be the repository root');
    if (isInside(rootReal, workspaceReal)) {
      for (const reserved of ['src', 'public', 'dist', '.git', 'node_modules', path.join('tools', 'audio-studio', 'catalog')]) {
        const reservedPath = path.join(rootReal, reserved);
        try {
          const reservedReal = await fs.realpath(reservedPath);
          if (isInside(reservedReal, workspaceReal)) fail('unsafe_workspace', `Workspace is inside reserved repository path ${reserved}`);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
    }
  };
  await assertWorkspaceLocation(await realpathNearestExisting(workspace));
  await fs.mkdir(workspace, { recursive: true });
  await assertWorkspaceLocation(await fs.realpath(workspace));
  for (const child of ['exports', 'backups']) {
    const directory = path.join(workspace, child);
    await fs.mkdir(directory, { recursive: true });
    await assertSafePath(workspace, directory, `${child} directory`);
  }
  return workspace;
}

async function assertNoPendingTransactions(workspace) {
  let names;
  try { names = await fs.readdir(path.join(workspace, 'exports')); } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const name of names.filter((candidate) => candidate.endsWith('.json'))) {
    const transactionPath = path.join(workspace, 'exports', name);
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(transactionPath, 'utf8')); } catch (error) {
      fail('pending_transaction', `Cannot inspect transaction manifest ${name}`, { cause: error.message });
    }
    if (!manifest || !['committed', 'rolled_back'].includes(manifest.status)) {
      fail('pending_transaction', `Unresolved audio transaction ${manifest?.id ?? name} blocks a new publish`);
    }
  }
}

async function atomicWrite(filePath, bytes, { expectedHash = undefined } = {}) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    if (expectedHash !== undefined) {
      const currentHash = await sha256File(filePath);
      if (currentHash !== expectedHash) fail('stale_state', `File changed before atomic replacement: ${filePath}`, { expected: expectedHash, actual: currentHash });
    }
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function writeJsonAtomic(filePath, value) {
  await atomicWrite(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

async function readBytes(filePath) {
  try { return await fs.readFile(filePath); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function verifyExpectedHash(filePath, expected, label) {
  const actual = await sha256File(filePath);
  if ((expected ?? null) !== actual) fail('stale_state', `${label} changed since the approved scan`, { expected: expected ?? null, actual });
  return actual;
}

function extractWhitelistSet(source, catalogPath) {
  const parsed = parseCatalog(source, catalogPath);
  return parsed.shipped.values;
}

function addWhitelistEntry(source, catalogPath, filename) {
  const parsed = parseCatalog(source, catalogPath);
  if (parsed.shipped.values.has(filename)) return { source, changed: false, before: parsed.shipped.values, after: parsed.shipped.values };
  const array = parsed.shipped.array;
  const sourceFile = parsed.sourceFile;
  let close = array.getEnd() - 1;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const firstElement = array.elements[0];
  const indent = firstElement
    ? source.slice(source.lastIndexOf('\n', firstElement.getStart(sourceFile) - 1) + 1, firstElement.getStart(sourceFile)).match(/^\s*/)?.[0] ?? '  '
    : '  ';
  const inlineArray = !source.slice(array.getStart(sourceFile), close).includes('\n');
  let nextSource = source;
  // Place a missing comma after the final literal, before any trailing comment.
  // An empty Set needs no separator at all.
  const lastTokenEnd = array.elements.at(-1)?.getEnd();
  if (lastTokenEnd !== undefined && !array.elements.hasTrailingComma) {
    nextSource = `${source.slice(0, lastTokenEnd)},${source.slice(lastTokenEnd)}`;
    close += 1;
  }
  const insertion = `${inlineArray ? newline : ''}${inlineArray && !indent ? '  ' : indent}${JSON.stringify(filename)},${newline}`;
  nextSource = `${nextSource.slice(0, close)}${insertion}${nextSource.slice(close)}`;
  const after = extractWhitelistSet(nextSource, catalogPath);
  const added = [...after].filter((value) => !parsed.shipped.values.has(value));
  if (added.length !== 1 || added[0] !== filename) fail('whitelist_guard', 'Whitelist edit would change more than the approved filename');
  return { source: nextSource, changed: true, before: parsed.shipped.values, after };
}

function transactionPaths(workspace, id) {
  if (!TRANSACTION_ID.test(id)) fail('invalid_transaction', 'Invalid transaction identifier');
  return {
    manifest: path.join(workspace, 'exports', `${id}.json`),
    targetBackup: path.join(workspace, 'backups', `${id}.target`),
    catalogBackup: path.join(workspace, 'backups', `${id}.catalog.ts`),
  };
}

async function persistManifest(manifestPath, manifest) {
  await writeJsonAtomic(manifestPath, manifest);
}

async function rollbackManifest(root, workspace, manifest) {
  if (manifest.catalog_path !== AUDIO_CATALOG_RELATIVE.split(path.sep).join('/')) {
    fail('rollback_conflict', 'Transaction catalog path is outside the approved audio catalog');
  }
  const targetRelative = typeof manifest.target_path === 'string' ? manifest.target_path.replaceAll('\\', '/') : '';
  const targetPath = path.posix.normalize(targetRelative);
  if (!targetPath.startsWith('public/assets/sounds/') || targetPath === 'public/assets/sounds/' || path.posix.basename(targetPath).toLowerCase().endsWith('.ogg') === false || path.posix.basename(targetPath).includes('/')) {
    fail('rollback_conflict', 'Transaction target is not an approved SFX OGG path');
  }
  const target = path.join(root, targetPath.split('/').join(path.sep));
  const catalog = path.join(root, AUDIO_CATALOG_RELATIVE);
  await assertSafePath(root, target, 'transaction target', { allowMissing: true });
  await assertSafePath(root, catalog, 'transaction catalog');
  const currentScan = await scanRepository({ root });
  const currentEntry = currentScan.entries[manifest.key];
  if (!currentEntry || currentEntry.target_path !== targetPath || !currentEntry.target_path.endsWith('.ogg')) {
    fail('rollback_conflict', 'Transaction target no longer resolves to the same current SFX key');
  }
  const transaction = transactionPaths(workspace, manifest.id);
  await assertSafePath(workspace, transaction.manifest, 'transaction manifest');
  await assertSafePath(workspace, transaction.targetBackup, 'target backup');
  await assertSafePath(workspace, transaction.catalogBackup, 'catalog backup');
  const currentTarget = await sha256File(target);
  const currentCatalog = await sha256File(catalog);
  const targetState = currentTarget === manifest.before_target_hash ? 'before'
    : currentTarget === manifest.after_target_hash ? 'after' : 'foreign';
  const catalogState = currentCatalog === manifest.before_catalog_hash ? 'before'
    : currentCatalog === manifest.after_catalog_hash ? 'after' : 'foreign';
  if (targetState === 'foreign' || catalogState === 'foreign') {
    fail('rollback_conflict', 'A target or catalog file changed outside the known transaction states', {
      target: { expected_before: manifest.before_target_hash, expected_after: manifest.after_target_hash, actual: currentTarget },
      catalog: { expected_before: manifest.before_catalog_hash, expected_after: manifest.after_catalog_hash, actual: currentCatalog },
    });
  }
  const targetBackup = await fs.readFile(transaction.targetBackup);
  if (manifest.before_target_hash !== null && sha256Bytes(targetBackup) !== manifest.before_target_hash) fail('rollback_integrity', 'Target backup hash does not match transaction manifest');
  const catalogBackup = await fs.readFile(transaction.catalogBackup);
  if (sha256Bytes(catalogBackup) !== manifest.before_catalog_hash) fail('rollback_integrity', 'Catalog backup hash does not match transaction manifest');
  if (targetState === 'after' && manifest.before_target_hash === null) await fs.rm(target, { force: true });
  else if (targetState === 'after') await atomicWrite(target, targetBackup, { expectedHash: manifest.after_target_hash });
  if (catalogState === 'after') await atomicWrite(catalog, catalogBackup, { expectedHash: manifest.after_catalog_hash });
  manifest.status = 'rolled_back';
  manifest.rolled_back_at = new Date().toISOString();
  await persistManifest(transactionPaths(workspace, manifest.id).manifest, manifest);
  return manifest;
}

export async function publishAudio({ root = process.cwd(), key, source_path: sourcePathInput, expected_catalog_hash: expectedCatalogHash, expected_file_hash: expectedFileHash = null, expected_source_hash: expectedSourceHash, workspace: workspaceInput, approval_id: approvalId } = {}) {
  if (typeof key !== 'string' || !key) fail('invalid_request', 'publish requires a sound key');
  if (typeof approvalId !== 'string' || !approvalId.trim()) fail('approval_required', 'publish requires a human approval_id');
  const repository = await readRoot(root);
  const currentScan = await scanRepository({ root: repository.root });
  if (expectedCatalogHash !== currentScan.catalog_hash) fail('stale_catalog', 'Catalog changed since approval', { expected: expectedCatalogHash, actual: currentScan.catalog_hash });
  const entry = currentScan.entries[key];
  if (!entry) fail('unknown_key', `Unknown or music audio key: ${key}`);
  if (entry.conflicts.length) fail('catalog_conflict', entry.conflicts.join('; '));
  if (!entry.target_path.endsWith(OGG_EXTENSION)) fail('invalid_target', 'Only OGG SFX targets can be published', { key, target: entry.target_path });
  const target = await assertSafePath(repository.root, path.join(repository.root, entry.target_path), 'publish target', { allowMissing: true });
  const workspace = await ensureWorkspace(repository.root, workspaceInput);
  await assertNoPendingTransactions(workspace);
  if (typeof sourcePathInput !== 'string' || !sourcePathInput) fail('invalid_request', 'publish requires source_path');
  const sourcePath = canonicalPath(path.isAbsolute(sourcePathInput) ? sourcePathInput : path.join(workspace, sourcePathInput));
  await assertSafePath(workspace, sourcePath, 'publish source');
  if (path.extname(sourcePath).toLowerCase() !== OGG_EXTENSION) fail('invalid_source', 'Publish source must have an .ogg extension');
  const sourceBytes = await fs.readFile(sourcePath);
  if (sourceBytes.length < 4 || sourceBytes.subarray(0, 4).toString('ascii') !== 'OggS') fail('invalid_source', 'Publish source is not an OGG container');
  const sourceHash = sha256Bytes(sourceBytes);
  if (expectedSourceHash !== sourceHash) fail('stale_source', 'Publish source changed since approval', { expected: expectedSourceHash, actual: sourceHash });
  const currentFileHash = await verifyExpectedHash(target, expectedFileHash, 'Target file');
  const catalogBytes = await fs.readFile(repository.catalogPath);
  const catalogBeforeHash = sha256Bytes(catalogBytes);
  const catalogPreflight = parseCatalog(catalogBytes.toString('utf8'), repository.catalogPath);
  if (canonicalCatalogHash(catalogPreflight) !== expectedCatalogHash) {
    fail('stale_catalog', 'Catalog changed after the approved scan', { expected: expectedCatalogHash, actual: canonicalCatalogHash(catalogPreflight) });
  }
  const catalogTarget = canonicalTarget(catalogPreflight.assets.get(key));
  if (catalogTarget !== entry.target_path) {
    fail('stale_catalog', 'Approved sound target no longer matches the current catalog', { expected: entry.target_path, actual: catalogTarget });
  }
  const filename = path.basename(entry.target_path);
  const whitelistEdit = addWhitelistEntry(catalogBytes.toString('utf8'), repository.catalogPath, filename);
  const catalogAfterBytes = Buffer.from(whitelistEdit.source, 'utf8');
  const catalogAfterHash = sha256Bytes(catalogAfterBytes);
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
  const paths = transactionPaths(workspace, id);
  const beforeTarget = await readBytes(target);
  await fs.writeFile(paths.targetBackup, beforeTarget ?? Buffer.alloc(0), { flag: 'wx' });
  await fs.writeFile(paths.catalogBackup, catalogBytes, { flag: 'wx' });
  const manifest = {
    schema_version: 1,
    id,
    status: 'prepared',
    approval_id: approvalId,
    key,
    target_path: entry.target_path,
    catalog_path: toRelative(repository.root, repository.catalogPath),
    source_path: toRelative(repository.root, sourcePath),
    source_hash: sourceHash,
    before_target_hash: currentFileHash,
    after_target_hash: sourceHash,
    before_catalog_hash: catalogBeforeHash,
    after_catalog_hash: catalogAfterHash,
    whitelist_added: whitelistEdit.changed ? [filename] : [],
    created_at: new Date().toISOString(),
  };
  await persistManifest(paths.manifest, manifest);
  try {
    const sourceBeforeWrite = await fs.readFile(sourcePath);
    if (sha256Bytes(sourceBeforeWrite) !== sourceHash) fail('stale_source', 'Publish source changed before the target write');
    await verifyExpectedHash(repository.catalogPath, catalogBeforeHash, 'Audio catalog');
    await verifyExpectedHash(target, currentFileHash, 'Target file');
    await atomicWrite(target, sourceBeforeWrite, { expectedHash: currentFileHash });
    manifest.status = 'target_written';
    await persistManifest(paths.manifest, manifest);
    await verifyExpectedHash(repository.catalogPath, catalogBeforeHash, 'Audio catalog');
    if (whitelistEdit.changed) await atomicWrite(repository.catalogPath, catalogAfterBytes, { expectedHash: catalogBeforeHash });
    manifest.status = 'catalog_written';
    await persistManifest(paths.manifest, manifest);
    if ((await sha256File(target)) !== sourceHash || (await sha256File(repository.catalogPath)) !== catalogAfterHash) fail('postcondition_failed', 'Publish postcondition did not hold');
    manifest.status = 'committed';
    manifest.committed_at = new Date().toISOString();
    await persistManifest(paths.manifest, manifest);
    const catalogAfter = parseCatalog(catalogAfterBytes.toString('utf8'), repository.catalogPath);
    return {
      transaction: manifest,
      result: {
        published: true,
        key,
        target_path: entry.target_path,
        whitelist_added: manifest.whitelist_added,
        catalog_hash: canonicalCatalogHash(catalogAfter),
      },
    };
  } catch (error) {
    try {
      if (manifest.status !== 'prepared') await rollbackManifest(repository.root, workspace, manifest);
    } catch (rollbackError) {
      manifest.status = 'rollback_conflict';
      manifest.error = { code: rollbackError.code ?? 'rollback_failed', message: rollbackError.message };
      await persistManifest(paths.manifest, manifest).catch(() => {});
      fail('rollback_conflict', `Publish failed and safe rollback was refused: ${rollbackError.message}`, { publish: error.message });
    }
    fail(error.code ?? 'publish_failed', error.message, { transaction: manifest.id });
  }
}

export async function recoverAudio({ root = process.cwd(), workspace: workspaceInput, transaction_id: transactionId, transaction: transactionValue } = {}) {
  const repositoryRoot = canonicalPath(root);
  const workspace = await ensureWorkspace(repositoryRoot, workspaceInput);
  const id = typeof transactionId === 'string' ? transactionId : typeof transactionValue === 'string' ? transactionValue : transactionValue?.id;
  if (typeof id !== 'string' || !TRANSACTION_ID.test(id)) fail('invalid_transaction', 'recover requires a safe transaction identifier');
  const paths = transactionPaths(workspace, id);
  await assertSafePath(workspace, paths.manifest, 'transaction manifest');
  await assertSafePath(workspace, paths.targetBackup, 'target backup');
  await assertSafePath(workspace, paths.catalogBackup, 'catalog backup');
  const manifest = JSON.parse(await fs.readFile(paths.manifest, 'utf8'));
  if (manifest.id !== id) fail('invalid_transaction', 'Transaction manifest identifier mismatch');
  if (manifest.schema_version !== 1 || manifest.status === undefined || manifest.key === undefined) fail('invalid_transaction', 'Malformed transaction manifest');
  if (manifest.status === 'committed' || manifest.status === 'rolled_back') return { transaction: manifest, result: { recovered: false, status: manifest.status } };
  const result = await rollbackManifest(repositoryRoot, workspace, manifest);
  return { transaction: result, result: { recovered: true, status: result.status } };
}

export async function handleRequest(request) {
  if (!request || typeof request !== 'object') fail('invalid_request', 'Request must be a JSON object');
  if (request.command === 'scan') return { ok: true, ...(await scanRepository(request)) };
  if (request.command === 'publish') {
    const value = await publishAudio(request);
    return { ok: true, ...value, ...(value.result ?? {}) };
  }
  if (request.command === 'recover') return { ok: true, ...(await recoverAudio(request)) };
  fail('invalid_request', `Unsupported command: ${request.command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  try {
    const request = JSON.parse(input || '{}');
    process.stdout.write(`${JSON.stringify(await handleRequest(request))}\n`);
  } catch (error) {
    process.exitCode = 1;
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error.code ?? 'adapter_failed', message: error.message, details: error.details } })}\n`);
  }
}
