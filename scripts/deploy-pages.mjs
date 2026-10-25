import { execFileSync } from 'node:child_process';
import path from 'node:path';
import ghpages from 'gh-pages';
import Git from 'gh-pages/lib/git.js';

// gh-pages passes every removed file to a single `git rm`, which exceeds the
// Windows command-line limit once a build has a few thousand assets.
const MAX_RM_ARGS_LENGTH = 16000;
const rmAll = Git.prototype.rm;
Git.prototype.rm = async function rmInChunks(files) {
  const list = Array.isArray(files) ? files : [files];
  let chunk = [];
  let length = 0;
  for (const file of list) {
    if (chunk.length > 0 && length + file.length + 1 > MAX_RM_ARGS_LENGTH) {
      await rmAll.call(this, chunk);
      chunk = [];
      length = 0;
    }
    chunk.push(file);
    length += file.length + 1;
  }
  return chunk.length > 0 ? rmAll.call(this, chunk) : this;
};

// One gh-pages branch hosts three independent builds:
//   root    -> https://<user>.github.io/Fragdachse/
//   current -> .../Fragdachse/current/
//   next    -> .../Fragdachse/next/
// Each target replaces only its own files; the other targets stay untouched.
const SUBDIR_TARGETS = ['current', 'next'];
const TARGETS = {
  root: {
    dest: '.',
    // Root files are everything except the subdirectory builds.
    remove: ['**', ...SUBDIR_TARGETS.map((dir) => `!${dir}/**`)],
    label: 'root build',
  },
  ...Object.fromEntries(
    SUBDIR_TARGETS.map((dir) => [dir, { dest: dir, remove: '**', label: `/${dir}/ build` }]),
  ),
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetName = args.find((arg) => !arg.startsWith('--'));
const target = TARGETS[targetName];

try {
  if (!target) {
    throw new Error(`Usage: node scripts/deploy-pages.mjs <${Object.keys(TARGETS).join('|')}> [--dry-run]`);
  }

  // gh-pages uses a separate cached clone, so source-repository config is not
  // enough. Apply these overrides to every Git child, including clone/checkout,
  // without changing the user's global or repository configuration.
  let count = Number(process.env.GIT_CONFIG_COUNT || 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('GIT_CONFIG_COUNT must be a non-negative integer');
  }
  for (const [key, value] of [
    ['core.longpaths', 'true'],
    ['core.autocrlf', 'false'],
  ]) {
    process.env[`GIT_CONFIG_KEY_${count}`] = key;
    process.env[`GIT_CONFIG_VALUE_${count}`] = value;
    count += 1;
  }
  process.env.GIT_CONFIG_COUNT = String(count);

  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

  await new Promise((resolve, reject) => {
    ghpages.publish(
      path.resolve('dist'),
      {
        dest: target.dest,
        remove: target.remove,
        message: `Update ${target.label} (${branch} ${head})`,
        push: !dryRun,
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });
  console.log(dryRun ? `Dry run: committed ${target.label} in the gh-pages cache, not pushed` : `Published ${target.label}`);
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
