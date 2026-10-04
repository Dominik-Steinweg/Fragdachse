# Asset-Optimierung vom 04.10.2026

**MERGE-READY.** Grundlage `c47b37ef`, Umsetzung `d43ce4a1` auf `codex/assets`. 16 eindeutig unreferenzierte Altbilder entfernt; 13 Farbtexturen über die vorhandene verlustfreie Runtime-WebP-Pipeline veröffentlicht. Authored PNGs, logische Asset-Pfade, Texture-Keys, Atlas-Geometrie und Loader bleiben erhalten.

Das ausgelieferte dist-Paket sinkt von 160,574 auf 156,525 MB (−4,049 MB). Ohne Source-Maps: 130,858 → 126,809 MB. Dies ist die Summe der Dateien, kein einzelner Boot-Download. Die 16 Altbilder wurden schon vorher nicht geladen; ihre Entfernung spart Paketgröße. Die 13 geladenen Bilder sparen 1,407 MB Transfer.

| Boot → Lobby, lokale Suite | Vorher (Median) | Nachher (Median) | Differenz vorher − nachher |
| --- | ---: | ---: | ---: |
| high | 15,125 s | 15,085 s | 0,040 s |
| low | 14,199 s | 14,475 s | -0,276 s |

Kein belastbarer Ladezeitgewinn: High bleibt praktisch gleich, Low wurde in allen drei Paaren langsamer (Median +0,276 s). Die Ursache dieses kleinen Nachteils wurde nicht isoliert; die gemessene Dateiersparnis ist davon unabhängig.

Je drei frische Chrome-Profile pro Build und Qualitätsstufe, wechselnde A/B-Reihenfolge, eigener statischer Server auf freiem Port, 1920×1080/DPR 1 und sichtbares Chrome. Gemessen wird ab App-Boot-Marker bis Lobby-Reveal, ohne die davor liegende Browser-Verbindungswartezeit. OS-/Treiber-Caches sind warm. Kleine Unterschiede dieser lokalen Messung sind kein belastbarer Gewinn im Internetbetrieb. Einzelwerte und Navigationstiming stehen im JSON.

Texturspeicher: Die betroffenen Texturquellen bleiben bei 45,512 MB RGBA8; Gewinn 0 MB. Gemessene gesamte registrierte Quellen in der Lobby: High 1008,394 MB, Low 930,621 MB. Das ist eine Dimensionsschätzung und keine vollständige VRAM-Messung.

Jede Konvertierung erhält Alpha und RGB an allen Pixeln mit Alpha > 0 exakt: maximale Abweichung 0, PSNR ∞. Zusätzlich wurde jedes PNG und WebP in Chrome als HTMLImageElement geladen und mit dem bestehenden premultiplizierten WebGL-Upload-Vertrag ausgelesen: alle GPU-Kanäle exakt gleich. Die Roh-RGB-Werte unter Alpha 0 dürfen sich ändern; deshalb sind auch unbereinigte Rohwerte unten ausgewiesen.

| Datei unter public/ (Ziel jeweils .webp) | PNG Bytes | WebP Bytes | Roh-Max | Roh-PSNR dB | sichtbar / GPU Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| assets/player/death-a01-r03/death-sheet.png | 1383278 | 869972 | 255 | 14,19 | 0 / 0 |
| assets/sprites/canopies/canopy01.png | 252536 | 171030 | 255 | 26,49 | 0 / 0 |
| assets/sprites/canopies/canopy02.png | 280199 | 188496 | 158 | 27,84 | 0 / 0 |
| assets/sprites/canopies/canopy03.png | 283097 | 194272 | 79 | 25,72 | 0 / 0 |
| assets/sprites/canopies/canopy04.png | 243494 | 165446 | 255 | 25,86 | 0 / 0 |
| assets/sprites/canopies/canopy05.png | 293312 | 205594 | 255 | 26,83 | 0 / 0 |
| assets/sprites/rockmoss/rock_moss_01.png | 284595 | 173308 | 255 | 20,18 | 0 / 0 |
| assets/sprites/rockmoss/rock_moss_03.png | 175174 | 112542 | 255 | 18,19 | 0 / 0 |
| assets/sprites/rockmoss/rock_moss_04.png | 142002 | 88656 | 255 | 8,68 | 0 / 0 |
| assets/sprites/rockmoss/rock_moss_05.png | 177858 | 124390 | 255 | 16,50 | 0 / 0 |
| assets/sprites/rockmoss/rock_moss_06.png | 249783 | 155148 | 255 | 17,90 | 0 / 0 |
| assets/sprites/rockmoss/rock_moss_07.png | 144922 | 98188 | 255 | 15,07 | 0 / 0 |
| assets/sprites/rockmoss/rock_moss_08.png | 135011 | 90966 | 255 | 15,96 | 0 / 0 |

In-Game-Parität: Lobby, Map 1 um 12:00 und 00:00, laufende Coop-Map 7; jeweils High und Low. Der echte Spielzustand wurde angehalten und mit Original-PNG beziehungsweise WebP auf denselben Phaser-Texturquellen erneut gerendert. Nur die lokale Prüfkopie des Bundles gibt dafür die Game-Referenz frei; Produktcode enthält keinen Prüfhook. Statische UI-/Zug-Canvas-Bakes wurden bewusst aus der Konvertierung ausgeschlossen.

Sieben Screenshotpaare sind exakt gleich. Coop Low: 7 von 8.294.400 Farbkanälen unterscheiden sich um 1/255, PSNR 108,87 dB. Derselbe Unterschied (Maximum und Kanalanzahl) tritt beim unveränderten Kontrollrender auf. Akzeptanz: GPU-Eingänge exakt; Bildabweichung null oder höchstens unveränderter Kontrollrender bei PSNR ≥ 100 dB. Damit ist keine durch die Asset-Umstellung sichtbare Änderung belegt. Die ungefilterten Messwerte einschließlich Kontrollrender sind archiviert.

Referenzprüfung: Die automatisch erzeugte URL-Liste verzeichnet jede Datei und ist allein kein Verwendungsbeleg. Direkte Dateinamen/IDs wurden in Source, Manifests, JSON, Registries, Loadern, HTML/CSS, Tests, Map-Editor und Exportern geprüft. Dynamische Konstruktion wurde gesondert verfolgt, insbesondere Item-Slot/Level, Enemy-/Walking-Registries, Held-Items, Terrain-Familien, Train-Keys und Icon-Atlanten.

Entfernte Dateien:

- public/assets/sprites/192x192canopy01.png (11428 Bytes)
- public/assets/sprites/32x32dachs-walking_Sheet.png (4360 Bytes)
- public/assets/sprites/32x32grass01.png (1387 Bytes)
- public/assets/sprites/32x32zombie.png (650 Bytes)
- public/assets/sprites/64x32tracks.png (3134 Bytes)
- public/assets/sprites/BahnstreckeKies.png (2056 Bytes)
- public/assets/sprites/dirt47blob_mottle.png (36561 Bytes)
- public/assets/sprites/enemies/enemy_zombie_badger-Walking_Sheet.png (36937 Bytes)
- public/assets/sprites/fragdachselogo.png (17356 Bytes)
- public/assets/sprites/gras_bg_ctb.png (1305022 Bytes)
- public/assets/sprites/gras_bg_dm.png (1120293 Bytes)
- public/assets/sprites/old/base47blob - Kopie.png (29468 Bytes)
- public/assets/sprites/old/base47blob_hostile2.png (24296 Bytes)
- public/assets/sprites/old/enemy_rabid_badger2.png (30590 Bytes)
- public/assets/sprites/old/gras_bg_ctb.png (20425 Bytes)
- public/assets/sprites/old/gras_bg_dm.png (4428 Bytes)

Behaltene Zweifelsfälle und Quellen: 54 Icons unter `Loadout/_review_unused/` (102.172 Bytes, bewusstes Review-Archiv); 6 nicht direkt referenzierte Prompt-/Provenienzdateien (10.325 Bytes). Die vollständigen Dateilisten stehen unter `audit.retained` im JSON. 24 Item-Icons (2.522.938 Bytes) sind dynamisch referenziert und ausdrücklich nicht ungenutzt. Zwei Font-Lizenzen bleiben erhalten. Verbleibende Source-PNGs werden durch Exporter, Tests oder Manifests benötigt; Normal-/Höhen-/Masken-/Schatten-Daten bleiben PNG. Keine JPG-Dateien vorhanden.

Nicht konvertiert: Dialograhmen und Zugmaterial (zusätzliche Canvas-Bakes mit anderem Rundungsverhalten); bestehende Audio-Dateien (überwiegend bereits Ogg, WAV/MP3 weiterhin im Audio-Katalog; keine erneute verlustbehaftete Kodierung). Keine zusätzliche Texturspeicherersparnis und kein garantierter Sekunden-Gewinn.

Validierung: `npm run check` grün (4.905 Core-, 54 Architekturtests, Produktions- und Map-Editor-Build); `npm run test:assets` grün (171 Tests). Der erste Check traf ein bestehendes 5-s-Limit in depthR0Contract; zwei vollständige Wiederholungen bestanden unverändert. Zwei Asset-Tests benötigen ein ignoriertes lokales Beauty-Manifest, das unverändert aus dem Hauptrepo gelesen und nach D: kopiert wurde; Hash siehe JSON.

[Maschinenlesbare Einzelwerte und Quellen-Hashes](assets-optimization-2026-10-04.json). Große Nachweise und Messskripte liegen in `D:/Fragdachse-render/wt/assets/build/assets-proof/` (screenshots/, pixel-metrics.json, parity-acceptance.json, load-final/suite.json, check-verified.log, assets-tests-verified.log). Alle eigenen Browser/Server werden nach den Läufen geschlossen.

Arbeitsort: isolierte lokale Git-Kopie in `D:/Fragdachse-render/wt/assets`; ein verknüpfter Worktree war wegen der Sandbox-Schreibsperre auf `C:/Fragdachse/.git` nicht möglich. Das Hauptrepo wurde ausschließlich um den angeforderten Queue-Bericht ergänzt. Keine Änderungen an main und kein Push.

Knowledge writeback: No durable project knowledge discovered.
