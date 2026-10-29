# Asset-Größen vom 29.10.2026

Branch `claude/inspiring-roentgen-6a79d1`, Grundlage `29a33e12`. Ziel: kleinere ausgelieferte Dateien ohne sichtbaren Qualitätsverlust. Spieltexturen bleiben bit-exakt (Farbe: Alpha und RGB bei Alpha > 0; Daten: alle Kanäle). Nur die von der User-Entscheidung vom 29.10.2026 benannten UI-Illustrationen und die Musik sind verlustbehaftet neu kodiert.

## Ergebnis

| Messgröße | Vorher | Nachher | Differenz |
| --- | ---: | ---: | ---: |
| Cold Boot bis Lobby: Requests | 637 | 612 | −25 |
| Cold Boot bis Lobby: Bytes | 102.788.452 | 89.840.185 | −12.948.267 (−12,6 %) |
| davon PNG | 19.986.230 (236) | 4.285.273 (136) | −15.700.957 |
| davon WebP | 62.435.649 (227) | 66.014.983 (327) | +3.579.334 |
| davon OGG | 2.563.527 (86) | 1.567.020 (61) | −996.507 |
| davon JS (Manifest-Import, s. u.) | 16.658.134 | 16.827.997 | +169.863 |
| Nach der Lobby, 20 s (Musik, Item-Icons) | 6.910.293 | 6.024.540 | −885.753 |
| `dist` gesamt | 423.803.522 (2.632 Dateien) | 287.705.383 (2.451 Dateien) | −136.098.139 |
| `dist` ohne Source-Maps | 383.815.306 | 247.715.884 | −136.099.422 |

Messung: je ein frisches Chrome-Profil (Chrome 156, offscreen, 1664 × 936, DPR 1, RTX 3080 mit `MAX_TEXTURE_SIZE` ≥ 4352, also 2x-Felsfarbe), eigener statischer Server über den jeweiligen Produktions-`dist`, Mitschnitt aller CDP-Netzwerkereignisse bis `__FD_BOOT__.phase === 'ready'`. Bytes = übertragene, unkomprimierte Antwortgrößen. Beide Läufe: 0 fehlgeschlagene Requests, 0 Konsolenfehler. Ladezeiten wurden bewusst nicht verglichen (je ein Lauf).

## Maßnahmen

| Maßnahme | Dateien | Vorher | Nachher |
| --- | ---: | ---: | ---: |
| Daten-PNGs exakt verlustfrei als WebP (`category: data`) | 69 | 20.688.592 | 14.776.582 |
| Farb-PNGs 16–128 KB zusätzlich verlustfrei (`colour`) | 149 | 7.912.677 | 5.155.406 |
| UI-Illustrationen verlustbehaftet (`ui-art`) | 6 | 7.177.786 | 2.309.124 |
| Byte-identische SFX auf eine URL (`alias`) | 23 | 963.775 | 0 |
| Musik aus den verlustfreien Mastern, Vorbis q5 | 2 | 4.382.036 | 3.496.283 |
| Belohnungs-Icons auf 128 px | 2 | 1.585.038 | 37.696 |
| Nie angeforderte Quellen aus dem Deploy | 156 | 119.545.397 | 0 |

**Daten.** sharp 0.33 kennt libwebp `exact` nicht; ohne `exact` überschreibt libwebp RGB unter Alpha 0. sharp 0.35 als Projektabhängigkeit hätte die Offline-Exporter verändert: `RockEcologyV8` reproduziert seine Ausgaben dann nicht mehr (Blur/Resize von libvips 8.18, Abweichung bis 255 in schwach deckenden Pixeln). Deshalb bleibt sharp 0.33.5; sharp 0.35.5 ist als `sharp-exact` (npm-Alias) installiert und kodiert in einem Kindprozess (`scripts/lib/webp-exact.mjs`), weil beide libvips-Versionen nicht in einem Prozess laden. Jede Datenveröffentlichung wird mit sharp 0.33 dekodiert und muss in allen RGBA-Kanälen gleich sein. Ausgenommen: von `bossAtlasImages` gebundene Kraken-Atlanten (Byte-Prüfung im Residency-Loader), Gegner-Mesh-`.bin`-Dateien (nur PNG wird veröffentlicht) und die Powerup-Layer, deren Manifest die PNG-Bytes pinnt. Größte Einzelposten: Canopy `horizon-0/1` und `normal-ao-thickness` 8,24 → 5,40 MB, `rock/coverage` 354 → 59 KB.

**Farbe.** Schwelle 128 KB → 16 KB (`MIN_PUBLISHED_BYTES`). Jede Veröffentlichung landet als Manifest-Eintrag im Client-Bundle (`WoodlandAssetManifest.ts` importiert `runtime-colours.json`). Unter 16 KB hätten 187 weitere Dateien zusammen nur 0,41 MB gespart. Atlas-Eingaben werden nicht neu veröffentlicht (sonst Neupacken identischer Pixel).

**UI-Illustrationen.** Je Bild die kleinste Stufe aus lossy q90–100 (Sharp-YUV) und near-lossless 40/60 mit PSNR ≥ 41 dB (Vertragsgrenze 40 dB, 1 dB Abstand); Alpha verlustfrei. PSNR über premultipliziertes RGBA gegen die bisherige verlustfreie Runtime-Datei. Bei Keyart und Porträt erreicht lossy WebP wegen 4:2:0-Chroma selbst mit q100 nur 39,5/39,6 dB; dort greift near-lossless.

| Datei | Maße | Vorher | Nachher | Stufe | PSNR |
| --- | --- | ---: | ---: | --- | ---: |
| `ui/dawn/art/runtime/dawn-victory-1920.webp` | 1920 × 1080 | 2.931.122 | 835.076 | q92 | 41,01 dB |
| `ui/dawn/art/runtime/dawn-defeat-1920.webp` | 1920 × 1080 | 2.691.502 | 725.080 | q92 | 41,14 dB |
| `ui/dawn/art/runtime/dawn-keyart-960.webp` | 960 × 540 | 694.362 | 421.170 | near-lossless 40 | 43,95 dB |
| `ui/dawn/art/runtime/dealer-portrait-256.webp` | 256 × 256 | 89.266 | 53.814 | near-lossless 40 | 43,18 dB |
| `ui/match-results/runtime/result-banner.webp` | 1440 × 377 | 595.798 | 220.208 | q96 | 41,37 dB |
| `ui/match-results/runtime/section-title-v2.webp` | 1000 × 149 | 175.736 | 53.776 | q94 | 41,17 dB |

Seitenvergleich bei 2× (Nearest) an Detailstellen aller sechs Bilder: kein sichtbarer Unterschied. Bereits verlustbehaftet und unverändert: Ladewald (q84, 42,50 dB) und Match-Results-Hintergrund (q86, **38,48 dB**, schon vor diesem Stand unter 40 dB).

**Audio.** 17 Kopien des 36,8-KB-Platzhalters, 3 + 3 + 2 + 2 + 2 weitere Gruppen. Die Audio-Studio-Ziele bleiben eigene Dateien je Key (Migration `explosion-source-copies-20260915`); die Pipeline leitet nur identische Bytes auf die erste Datei der Gruppe um. Ersetzt das Studio eine Datei, fällt sie beim nächsten `npm run assets:runtime` aus der Gruppe. `preloadAllAudio` lädt jede URL einmal und registriert die übrigen Keys mit demselben AudioBuffer. `airstrike2s.wav` und `zeus.mp3` lädt kein Key mehr. Musik: `music_arena.ogg` 219 → 170 kbit/s, `badger02.ogg` 182 → 150 kbit/s, beide libvorbis q5 aus `processed.wav` der Audio-Studio-Läufe (Hashes der Exporte stimmen mit den bisherigen Dateien überein), Sampleanzahl identisch (4.133.118 bzw. 3.517.764). SFX unverändert.

**Belohnungs-Icons.** Einziger Zeichenpfad ist das Radialmenü: max. 42 px × 1,16 (Fokus) × 1,035 (Schließ-Tween) = 50,4 Design-px, ≈ 101 Canvas-px bei Renderskala 2. Export mit 128 px aus den nach `tools/source-art/rewards/` verschobenen Originalen (`scripts/export-reward-icons.mjs`).

**Nie angefordert** (`NEVER_REQUESTED` in `scripts/lib/public-deployment.mjs`): Prompt-/README-Dateien, `*-source.png`, Top-Level-PNGs der UI-Exporter (die Loader lesen `runtime/`), `dawn-merchant/sources`, `dawn-clock/sources`, Dawn-Art-Originale und ungenutzte Exportgrößen, alte Versionen (`section-title.webp`, Upgrade-v1-Controls), Dachs-Pässe `player-material-21e4` und `player-shadow-21c-production` (Schattenmasken per `CHARACTER_SHADOW_MASKS_ENABLED = false` aus) sowie die beiden Sounds. Ein Test lässt die echten Preload-Funktionen (Lobby-Wald inkl. Dawn-UI/Händler/Uhr in 1x/2x, HUD-Rahmen, Deferred-Assets, Cursor, Dachs-Material, Audio) laufen und verlangt, dass jede angeforderte Datei ausgeliefert wird.

## Nachweise

- `npm run assets:runtime`, `npm run test:assets` (43 Dateien, 250 Tests, 2 übersprungen wie vorher), `npm run check` (7.481 Core-, 63 Architekturtests, Spiel-, Map-Editor- und Balance-Editor-Build) grün.
- `node scripts/verify-runtime-assets.mjs`: 430 Paare offline geprüft; Browserseite in Chrome 156 (ANGLE D3D11, RTX 3080): `passed: true`, 0 von 1.094.957.172 Kanälen verändert. 292 Farbpaare mit PMA-Upload, 69 Datenpaare zusätzlich mit non-PMA-Upload (alle Kanäle, auch RGB unter Alpha 0).

## Offen

- Das Manifest wird vollständig ins Client-Bundle importiert (`index.js` +170 KB). `WoodlandAssetManifest.ts` braucht nur die Woodland-Einträge; ein schlanker Import wäre ein eigener Schritt im Loader-Code.
- Weitere Kandidaten außerhalb der Farbfamilien: `sprites/coop-defense` Item-Icons (24 PNGs, ~2,5 MB nach der Lobby), Zugmaterial und `forest-modals/frame-kit.png` (Canvas-Bakes, gesondert prüfen), Händler-`header-panorama@2x.webp` (790 KB, verlustfrei).
- Nach dem Merge braucht der Hauptcheckout `npm ci` (neuer Alias `sharp-exact`).

Knowledge writeback: Vertragstext für `docs/ai/rendering.md` an die Hauptsitzung übergeben.
