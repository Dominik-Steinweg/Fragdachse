import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const catalogPath = path.join(projectRoot, 'src', 'audio', 'AudioCatalog.ts');
const backupDir = path.join(projectRoot, 'fragdachse_drive', 'audio-backup');

const args = parseArgs(process.argv.slice(2));
const ffmpegCommand = resolveFfmpegCommand(args.ffmpeg);

if (!Number.isFinite(args.quality) || args.quality < -1 || args.quality > 10) {
  console.error('Invalid --quality value. Expected a number between -1 and 10.');
  process.exit(1);
}

if (!ffmpegCommand) {
  console.error('Unable to locate ffmpeg. Pass --ffmpeg=<path> or set FFMPEG_PATH.');
  process.exit(1);
}

const catalogContent = readFileSync(catalogPath, 'utf8');
const assetRegex = /'(\.\/assets\/sounds\/([^']+)\.(wav|flac|mp3))'/g;
const matches = [...catalogContent.matchAll(assetRegex)];

if (matches.length === 0) {
  console.log('No convertible audio entries were found in AudioCatalog.ts.');
  process.exit(0);
}

const summary = {
  converted: [],
  updatedOnly: [],
  skipped: [],
  missing: [],
  conflicts: [],
  failures: [],
};

const replacements = new Map();

for (const match of matches) {
  const originalRelativePath = match[1];
  const relativeWithoutExtension = match[2];
  const originalExtension = match[3];
  const sourcePath = path.join(projectRoot, 'public', originalRelativePath.replace(/^\.\//, ''));
  const targetRelativePath = `./assets/sounds/${relativeWithoutExtension}.ogg`;
  const targetPath = path.join(projectRoot, 'public', targetRelativePath.replace(/^\.\//, ''));
  const backupPath = path.join(backupDir, `${relativeWithoutExtension}.${originalExtension}`);
  const sourceExists = existsSync(sourcePath);
  const targetExists = existsSync(targetPath);

  if (!sourceExists && targetExists) {
    replacements.set(originalRelativePath, targetRelativePath);
    summary.updatedOnly.push(originalRelativePath);
    continue;
  }

  if (!sourceExists) {
    summary.missing.push(originalRelativePath);
    continue;
  }

  if (targetExists) {
    summary.conflicts.push(`${originalRelativePath} -> ${targetRelativePath}`);
    continue;
  }

  if (existsSync(backupPath)) {
    summary.conflicts.push(`${originalRelativePath} -> backup already exists`);
    continue;
  }

  if (args.dryRun) {
    summary.skipped.push(`${originalRelativePath} -> ${targetRelativePath} (dry-run)`);
    continue;
  }

  mkdirSync(path.dirname(targetPath), { recursive: true });

  const ffmpegResult = spawnSync(
    ffmpegCommand,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-c:a', 'libvorbis', '-q:a', String(args.quality), targetPath],
    { encoding: 'utf8' },
  );

  if (ffmpegResult.error) {
    summary.failures.push(`${originalRelativePath} -> ${ffmpegResult.error.message}`);
    safeRemoveFile(targetPath);
    continue;
  }

  if (ffmpegResult.status !== 0) {
    const errorOutput = [ffmpegResult.stderr, ffmpegResult.stdout].filter(Boolean).join('\n').trim();
    summary.failures.push(`${originalRelativePath} -> ${errorOutput || 'ffmpeg exited with an unknown error.'}`);
    safeRemoveFile(targetPath);
    continue;
  }

  if (!existsSync(targetPath) || statSync(targetPath).size === 0) {
    summary.failures.push(`${originalRelativePath} -> ffmpeg did not create a valid .ogg file.`);
    safeRemoveFile(targetPath);
    continue;
  }

  mkdirSync(path.dirname(backupPath), { recursive: true });
  moveFile(sourcePath, backupPath);
  replacements.set(originalRelativePath, targetRelativePath);
  summary.converted.push(`${originalRelativePath} -> ${targetRelativePath}`);
}

if (!args.dryRun && replacements.size > 0) {
  let updatedCatalogContent = catalogContent;

  for (const [oldRelativePath, newRelativePath] of replacements.entries()) {
    updatedCatalogContent = updatedCatalogContent.split(`'${oldRelativePath}'`).join(`'${newRelativePath}'`);
  }

  writeFileSync(catalogPath, updatedCatalogContent, 'utf8');
}

printSummary(summary, replacements.size, args);

if (summary.failures.length > 0) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  let dryRun = false;
  let quality = 4;
  let ffmpeg = process.env.FFMPEG_PATH?.trim() || '';

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('--quality=')) {
      quality = Number(arg.slice('--quality='.length));
      continue;
    }

    if (arg.startsWith('--ffmpeg=')) {
      ffmpeg = arg.slice('--ffmpeg='.length).trim() || 'ffmpeg';
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }

  return { dryRun, quality, ffmpeg };
}

function resolveFfmpegCommand(explicitCommand) {
  const candidates = [
    explicitCommand,
    'ffmpeg',
    'ffmpeg.exe',
    path.join(projectRoot, 'ffmpeg.exe'),
    path.join(projectRoot, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffmpeg.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.endsWith('Packages')) {
      const wingetMatch = findWingetFfmpeg(candidate);
      if (wingetMatch) {
        return wingetMatch;
      }

      continue;
    }

    if (isRunnableCommand(candidate)) {
      return candidate;
    }
  }

  return '';
}

function isRunnableCommand(command) {
  if (path.isAbsolute(command)) {
    return existsSync(command);
  }

  const result = spawnSync(command, ['-version'], {
    encoding: 'utf8',
    timeout: 5000,
  });

  return !result.error && result.status === 0;
}

function findWingetFfmpeg(packagesDir) {
  if (!existsSync(packagesDir)) {
    return '';
  }

  const packageRoots = [
    path.join(packagesDir, 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'),
    path.join(packagesDir, 'Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe'),
  ];

  for (const packageRoot of packageRoots) {
    if (!existsSync(packageRoot)) {
      continue;
    }

    const entries = safeReadDirectory(packageRoot);
    for (const entry of entries) {
      const candidate = path.join(packageRoot, entry, 'bin', 'ffmpeg.exe');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return '';
}

function safeReadDirectory(directoryPath) {
  try {
    return readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function moveFile(sourcePath, targetPath) {
  try {
    renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      copyFileSync(sourcePath, targetPath);
      rmSync(sourcePath);
      return;
    }

    throw error;
  }
}

function safeRemoveFile(filePath) {
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

function printSummary(summary, replacementCount, options) {
  console.log(`Audio conversion ${options.dryRun ? 'dry-run ' : ''}summary:`);
  console.log(`  Converted: ${summary.converted.length}`);
  console.log(`  Catalog updates queued: ${replacementCount}`);
  console.log(`  Missing source files: ${summary.missing.length}`);
  console.log(`  Conflicts: ${summary.conflicts.length}`);
  console.log(`  Failures: ${summary.failures.length}`);
  console.log(`  Skipped: ${summary.skipped.length}`);
  console.log(`  Existing .ogg reused: ${summary.updatedOnly.length}`);

  printList('Converted entries', summary.converted);
  printList('Catalog updates without reconversion', summary.updatedOnly);
  printList('Missing source files', summary.missing);
  printList('Conflicts', summary.conflicts);
  printList('Failures', summary.failures);
  printList('Skipped', summary.skipped);
}

function printList(label, values) {
  if (values.length === 0) {
    return;
  }

  console.log(`${label}:`);
  for (const value of values) {
    console.log(`  - ${value}`);
  }
}