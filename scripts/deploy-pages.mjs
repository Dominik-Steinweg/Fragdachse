import main from 'gh-pages/bin/gh-pages.js';

try {
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

  // Keep the existing gh-pages CLI options and error handling available.
  await main(process.argv);
  console.log('Published');
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
