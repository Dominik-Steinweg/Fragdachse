import gameVersion from './game-version.json';
import { defineConfig, normalizePath } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';

export default defineConfig(({ mode }) => {
  const buildTimestamp = new Date().toISOString();
  const navigationBuild = mode === 'navigation-lab';
  const fogBuild = mode === 'fog-lab';
  const performanceBuild = mode === 'performance-lab';
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
  plugins: [{
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
        let body = '', tooLarge = false;
        request.on('data', chunk => {
          body += chunk;
          if (body.length > 20_000_000) { tooLarge = true; request.destroy(); }
        });
        request.on('end', () => {
          void (async () => {
            try {
              if (tooLarge) throw new Error('Report too large');
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
      // Offline-Art, Lab-Ergebnisse und lokale Caches gehören nicht zum HMR-Graphen.
      // Vite beachtet .gitignore hier nicht; sonst überwacht es auch diese Bäume.
      // Root-relative Auswahl: src/ und public/ bleiben vollständig überwacht.
      ignored: ['art', 'build', '.cache', 'tmp', '.tmp', 'fragdachse_drive', 'uv-cache-audio']
        .map(directory => `${normalizePath(resolve(directory))}/**`),
    },
  },
  // Der Flowfield-Worker wird als ES-Modul geladen (`new Worker(..., { type: 'module' })`).
  // Rollups Default für Worker ist IIFE und würde dessen Imports brechen.
  worker: {
    format: 'es' as const,
  },
  build: {
    ...(performanceBuild ? { outDir: process.env.FD_PERFORMANCE_BUILD_DIR || 'build/performance-lab', copyPublicDir: false } : {}),
    ...(navigationBuild ? { outDir: `build/${mode}`, copyPublicDir: false } : {}),
    ...(fogBuild ? { outDir: 'build/fog-lab', copyPublicDir: false } : {}),
    target: 'es2020',
    chunkSizeWarningLimit: 5000,
    // Ohne Source-Maps lösen Chrome-Profile und die Long-Animation-Frame-Attribution des
    // eigenen Profilers nur bis zum minifizierten Bundle auf ("vendor-*.js", leerer
    // Funktionsname) und sind damit für die Ursachensuche wertlos. Die .map-Dateien werden
    // nur bei Bedarf nachgeladen und kosten zur Laufzeit nichts.
    sourcemap: true,
    rollupOptions: {
      ...(navigationBuild ? { input: 'navigation-lab.html' } : {}),
      ...(fogBuild ? { input: 'fog-lab.html' } : {}),
      output: {
        manualChunks: {
          // Packt Phaser und PeerJS in eine eigene Datei namens "vendor"
          vendor: ['phaser', 'peerjs']
        }
      }
    }
  },
  define: {
    __PERFORMANCE_LAB__: JSON.stringify(performanceBuild),
    __NAVIGATION_BUILD_ID__: JSON.stringify(navigationBuildId),
    __GAME_VERSION__: JSON.stringify(gameVersion.version),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  };
});
