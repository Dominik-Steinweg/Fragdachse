/// <reference types="vitest/config" />
import { runtimeAssetCache } from './scripts/asset-cache.ts';
import { serviceWorkerBuild } from './scripts/service-worker-build.ts';
import { publicDeployment } from './scripts/lib/public-deployment.mjs';
import gameVersion from './game-version.json' with { type: 'json' };
import { devScenarioArtifacts } from './scripts/dev-scenario-artifacts.ts';
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';

/** Projektverzeichnisse, deren Änderungen der Dev-Server beobachtet (siehe server.watch.ignored). */
const WATCHED_DIRECTORIES = new Set(['src', 'public', 'scripts']);
const watchRoot = resolve('.');

export default defineConfig(({ mode, command }) => {
  const buildTimestamp = new Date().toISOString();
  const navigationBuild = mode === 'navigation-lab';
  const fogBuild = mode === 'fog-lab';
  const groundBuild = mode === 'ground-lab';
  const deathBuild = mode === 'death-lab';
  const performanceBuild = mode === 'performance-lab';
  // Builds that run from the shipped file set (scripts/lib/public-deployment.mjs) embed only its URLs.
  const deployedAssetsOnly = command === 'build' && (mode === 'production' || performanceBuild);
  const sourceHash = createHash('sha256');
  if (navigationBuild) {
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else sourceHash.update(relative('.', path).replaceAll('\\\\', '/')).update(readFileSync(path));
      }
    };
    visit('src');
    for (const path of ['package.json', 'vite.config.ts', 'navigation-lab.html']) sourceHash.update(path).update(readFileSync(path));
  }
  const navigationBuildId = `${mode}:${execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim()}:${sourceHash.digest('hex').slice(0, 16)}:${buildTimestamp}`;

  return {
  base: navigationBuild ? `/build/${mode}/` : './',
  plugins: [runtimeAssetCache({ deployedOnly: deployedAssetsOnly }), publicDeployment(), serviceWorkerBuild(), devScenarioArtifacts(), {
    name: 'local-navigation-report',
    configureServer(server) {
      server.middlewares.use('/__navigation-environment', (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ cpu: cpus()[0]?.model, logicalCores: cpus().length,
          os: `${platform()} ${release()}`, memoryBytes: totalmem() }));
      });
      // A built profiling run must not reload when source files change.
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (path !== '/build/navigation-lab/navigation-lab.html' && path !== '/build/fog-lab/fog-lab.html') return next();
        void readFile(resolve(`.${path}`)).then(html => {
          response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); response.end(html);
        }).catch(next);
      });
      server.middlewares.use('/__navigation-report', (request, response, next) => {
        if (request.method !== 'POST') return next();
        const host = request.headers.host;
        const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host ?? '');
        if (!localHost || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
          || request.headers.origin !== `http://${host}`) {
          response.writeHead(403); response.end('Local same-origin request required.'); return;
        }
        const chunks: Buffer[] = []; let size = 0, tooLarge = false;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 20_000_000) { tooLarge = true; chunks.length = 0; }
          else if (!tooLarge) chunks.push(chunk);
        });
        request.on('end', () => {
          void (async () => {
            try {
              if (tooLarge) { response.writeHead(413); response.end('Report too large'); return; }
              const body = Buffer.concat(chunks).toString('utf8');
              const report = JSON.parse(body);
              const env = report.environment;
              if (!env || typeof env.scenario !== 'string' || !/^[a-z-]+$/.test(env.scenario)
                || !Number.isSafeInteger(env.seed) || !Number.isSafeInteger(env.count)) throw new Error('Invalid report');
              const directory = resolve('build/navigation-results');
              await mkdir(directory, { recursive: true });
              const name = `${env.scenario}-${env.seed}-${env.count}-${Date.now()}.json`;
              await writeFile(resolve(directory, name), body);
              response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ saved: name }));
            } catch (error) { response.writeHead(400); response.end(String(error)); }
          })();
        });
      });
    },
  }],
  // Begrenzt nur den initialen Dev-Dependency-Scan; Lab-/Tool-URLs und Build bleiben unverändert.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 8080,
    // Den Spieleinstieg vor der ersten Browser-Anfrage transformieren. Die wenigen
    // zentralen Module stoßen auch die Vorverarbeitung ihrer statischen Imports an.
    warmup: {
      clientFiles: ['./src/main.ts', './src/scenes/ArenaScene.ts'],
    },
    watch: {
      // Nur Spielquellen, Public-Assets und die von der Config importierten Skripte gehören zum
      // HMR-Graphen; Dateien direkt im Projektroot (HTML, Configs) bleiben ebenfalls überwacht.
      // Vite beachtet .gitignore nicht: Ohne diese Allowlist registriert es auch tools/, art/,
      // .claude/-Worktrees und Build-Ausgaben (zehntausende Dateien) und blockiert damit den
      // ersten Seitenaufruf auf Windows für viele Sekunden.
      ignored: (path: string, stats?: { isDirectory(): boolean }) => {
        const relativePath = relative(watchRoot, path).replaceAll('\\', '/');
        if (!relativePath || relativePath.startsWith('..')) return false;
        const [topLevel] = relativePath.split('/');
        if (WATCHED_DIRECTORIES.has(topLevel)) return false;
        return relativePath.includes('/') || stats?.isDirectory() === true;
      },
    },
  },
  // Der Flowfield-Worker wird als ES-Modul geladen (`new Worker(..., { type: 'module' })`).
  // Rollups Default für Worker ist IIFE und würde dessen Imports brechen.
  worker: {
    format: 'es' as const,
    plugins: () => [runtimeAssetCache({ deployedOnly: deployedAssetsOnly })],
  },
  build: {
    copyPublicDir: false,
    ...(performanceBuild ? { outDir: process.env.FD_PERFORMANCE_BUILD_DIR || 'build/performance-lab', copyPublicDir: false } : {}),
    ...(navigationBuild ? { outDir: `build/${mode}`, copyPublicDir: false } : {}),
    ...(fogBuild ? { outDir: 'build/fog-lab', copyPublicDir: false } : {}),
    ...(groundBuild ? { outDir: 'build/ground-lab', copyPublicDir: false } : {}),
    ...(deathBuild ? { outDir: 'build/death-lab', copyPublicDir: false } : {}),
    target: 'es2020',
    chunkSizeWarningLimit: 5000,
    // Ohne Source-Maps lösen Chrome-Profile und die Long-Animation-Frame-Attribution des
    // eigenen Profilers nur bis zum minifizierten Bundle auf ("vendor-*.js", leerer
    // Funktionsname) und sind damit für die Ursachensuche wertlos. Die .map-Dateien werden
    // nur bei Bedarf nachgeladen und kosten zur Laufzeit nichts.
    sourcemap: true,
    rolldownOptions: {
      ...(navigationBuild ? { input: 'navigation-lab.html' } : {}),
      ...(fogBuild ? { input: 'fog-lab.html' } : {}),
      ...(groundBuild ? { input: 'ground-lab.html' } : {}),
      ...(deathBuild ? { input: 'death-lab.html' } : {}),
      output: {
        codeSplitting: {
          // Packt die npm-Abhängigkeiten (Phaser, PeerJS, Valibot) in eine eigene Datei namens "vendor"
          groups: [{ name: 'vendor', test: /[\\/]node_modules[\\/]/ }],
        },
      },
    }
  },
  define: {
    __PERFORMANCE_LAB__: JSON.stringify(performanceBuild),
    __NAVIGATION_BUILD_ID__: JSON.stringify(navigationBuildId),
    __GAME_VERSION__: JSON.stringify(gameVersion.version),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  // Every vitest invocation (also a bare `npx vitest run <path>`) ignores session worktrees under
  // .claude/, tool copies under .cache/, build output and local art; suite selection stays in the npm scripts.
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', '.claude/**', '.cache/**', 'build/**', 'dist/**', 'art/**'],
    // Several worktrees often run full suites at once on this machine; the 5 s default turned
    // ordinary CPU contention into false failures. Real hangs still fail.
    testTimeout: 20000,
  },
  };
});
