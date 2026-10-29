# Service Worker und Asset-URL-Tabelle, 29.10.2026

Prüfbericht zum Service Worker für Wiederholungsbesuche (User-Entscheidung 29.10.2026) und zur
Begrenzung der eingebetteten Asset-URL-Tabelle auf ausgelieferte Dateien. Branch
`claude/elated-mcnulty-c921e0`, Basis `main` 29a33e12.

## Umsetzung

- [`src/serviceWorker/serviceWorker.ts`](../../src/serviceWorker/serviceWorker.ts): Cache-first nur für
  `assets/…?v=<sha256>` und die gehashten Vite-Ausgaben des eigenen Builds; Navigationen über
  Navigation Preload ans Netz, alles andere beantwortet der Worker nicht. Kein Offline-Modus.
  `skipWaiting` + `clients.claim`; beim Aktivieren entfernt er Einträge, die das Manifest des neuen
  Builds nicht mehr listet (außerhalb von `activate.waitUntil`, damit Seitenanfragen nicht warten).
- Scope und Cache je Deployment-Ordner (Root, `current/`, `next/`): `service-worker.js` liegt neben
  `index.html`, Cache-Name `fragdachse-immutable-v1:<scope>`. Der Root-Worker lässt URLs eines
  Unterordners unberührt ([`serviceWorkerPolicy.ts`](../../src/serviceWorker/serviceWorkerPolicy.ts)).
- [`registerServiceWorker.ts`](../../src/serviceWorker/registerServiceWorker.ts) wird aus `index.html`
  geladen. Nur Produktionsbuilds registrieren; Dev-Server und Perf-Lab melden einen vorhandenen Worker
  ihres Scopes ab. Übernimmt ein Worker eine laufende Seite (Erstbesuch, neuer Build), meldet die
  Seite ihm die schon geladenen URLs; er kopiert die gehashten mit `only-if-cached` aus dem HTTP-Cache.
- [`scripts/service-worker-build.ts`](../../scripts/service-worker-build.ts) schreibt im
  Produktionsbuild `service-worker.js` (3,2 KB) und `service-worker-manifest.json` (2611 URLs,
  371 KB roh, 117 KB gzip; wird nur geladen, wenn ein neuer Worker einen gefüllten Cache vorfindet).
- `runtimeAssetCache({ deployedOnly })` bettet in Produktions- und Perf-Builds nur Einträge ein, deren
  Zieldatei `publicDeploymentFiles()` ausliefert.

## URL-Tabelle `virtual:runtime-asset-urls`

| | Einträge | roh | gzip | brotli |
|---|---|---|---|---|
| vorher (alle Dateien unter `public/assets`) | 3372 | 707 006 B | 151 652 B | 127 510 B |
| nachher (ausgelieferte Zieldateien) | 2724 | 590 725 B | 119 911 B | 101 146 B |

Haupt-Chunk `index-*.js`: 10 223,8 kB → 10 108,3 kB (gzip 2 702,2 → 2 670,2 kB). Die verbleibenden
Einträge sind fast alle ausgelieferte Dateien; weitere Einsparung ginge nur über ein kompakteres Format
(Hash statt doppeltem Pfad, ≈ −190 KB roh, gzip nur ≈ −10–15 KB).

## Browsernachweis

Eigener statischer Server wie GitHub Pages (`Cache-Control: max-age=600`, ETag, Last-Modified,
`Vary: Accept-Encoding`, kein `immutable`), Mounts `/Fragdachse/` und `/Fragdachse/current/`.
System-Chrome offscreen mit frischem Profil, 1280×720. Vor jedem Besuch leert CDP
(`Network.clearBrowserCache`) den HTTP-Cache – strenger als ein abgelaufenes `max-age`. Gezählt sind
Server-Anfragen bis zur Lobby plus 12 s. Build B ist ein zweiter Build derselben Quelle (neuer
Build-Zeitstempel → neuer Index-Chunk und drei geänderte Lazy-Chunks).

| Besuch | Server-Anfragen | davon gehasht | Seite: gehashte Loads (über Worker) |
|---|---|---|---|
| Root, Build A, Erstbesuch | 661 | 657 | 661 (654) |
| Root, Build A, Zweitbesuch | 3 | **0** | 660 (660) |
| Root, Build B deployt, erster Besuch | 8 | 2: neuer `index-*.js`, Manifest | 661 (661) |
| Root, Build B, nächster Besuch | 5 | **0** | 660 (660) |
| `current/`, Erstbesuch | 662 | 657 | 661 (661) |
| `current/`, Zweitbesuch | 5 | **0** | 660 (660) |
| Raum-Host (Root) | 5 | 0 | 661 (661) |
| Raum-Client `#r=5DQCCV` (Root) | 2 | 0 | 659 (659) |

Die verbleibenden Anfragen sind die Navigation (`Service-Worker-Navigation-Preload`), Update-Prüfungen
von `service-worker.js`, `voice-deletions.json` und der unversionierte Cursor
`assets/ui/cursors/badger-default.png` ([gameCursor.ts](../../src/ui/gameCursor.ts)).

- Update: Nach dem Deploy von B fehlen der alte `index-BdJv_YtC.js` und ein absichtlich eingesetzter
  Eintrag `__stale-check.png?v=000…` im Cache; `index-Dq4qKbMe.js` wurde übernommen (Zweitbesuch ohne
  Download). Cache-Größe vorher und nachher 657 Einträge.
- Scopes: zwei Registrierungen (`/Fragdachse/`, `/Fragdachse/current/`) und zwei Caches; der Root-Cache
  enthält keine `current/`-URL und umgekehrt.
- Raumbeitritt: Host meldet `Raum 5DQCCV – Rolle Host`, der Client mit `#r=5DQCCV` meldet
  `Rolle Client`; beide Seiten stehen unter dem Worker, der Hash bleibt erhalten.
- Ausfall des Cache Storage: Im ersten Lauf lag das Chrome-Profil in einem Pfad über 260 Zeichen,
  `caches.open` warf „Unexpected internal error“. Das Spiel lud trotzdem normal über das Netz.
- Perf-Lab-Build: kein `service-worker.js`, im Bundle nur die Abmeldung. Map-Editor-Build: eigenes
  `index.html` ohne Registrierungsmodul, keine Worker-Dateien, `deployedOnly` bleibt dort aus.

Lobby-Zeiten wurden mitprotokolliert, sind auf localhost aber kein Maß für den Gewinn über eine reale
Leitung und daher hier nicht ausgewertet.

## Betrieb

- Ein später ausgelieferter Build ohne Registrierungsmodul ließe den alten Worker aktiv. Er bleibt
  funktional harmlos (nur unveränderliche URLs aus dem Cache, Navigation übers Netz); entfernen lässt
  er sich mit einem Build, der wie Dev/Perf-Lab abmeldet.
- Perf-Lab-Ladezeiten enthalten den Worker nicht.
