# Dawn S-3 — Druck-Kunst

Vier ausgewählte PNG-Originale, erzeugt mit **built-in image_gen** im Holz-/Linolschnitt-Register. Vollständige Prompts, Referenzen, Bewertungen aller zwölf Kandidaten, Randbeschnitt und SHA-256 stehen in [prompts.json](prompts.json).

| Original | Wahl | Begründung |
| --- | --- | --- |
| [dealer-portrait.png](dealer-portrait.png) | 01 | Asymmetrischer Seitenblick; Dachsmaske, große Brillenringe und rotes Halstuch bleiben bei 128 px erkennbar. |
| [dawn-keyart.png](dawn-keyart.png) | 03 | Große rechte Basis und einzelne Torlampe; das linke Drittel bietet die ruhigste Textfläche. |
| [dawn-victory.png](dawn-victory.png) | 02 | Zusammengesunkener Dachs, beschädigtes Dach und stehendes Tor erzählen erschöpftes Überleben im kalten Morgen. |
| [dawn-defeat.png](dawn-defeat.png) | 03 | Eingestürztes Dach und gebrochener Turm bilden eine klare zerstörte Silhouette, mit kleinen Feuern und zurückhaltenden Augen. |

## Bildsprache und Verwendung

Verbindliche Grundlage: [Art Direction V1](../../../../../docs/GDDs/Fragdachse_From_Dachs_Till_Dawn_Art_Direction_V1.md). Die S-1-Referenzen `C-portrait.png`, `C-keyart.png`, `style-C-board.png` und die beiden C-Druck-Icons bestimmen Flächen, Schnittkanten und Palette. Das sind UI-Illustrationen mit absichtlich schräger Aufsicht und Horizont, keine 90°-World-Sprites.

Holzkohle, Knochen, Umbra; Rot nur am Händlerhalstuch. **Auftragsspezifische Ausnahme:** S-3 verlangt für Nacht und Niederlage Orange für Lampe/Feuer und zusätzlich winzige violette Augen. Beide Akzente sind vorhanden; diese Ausnahme zur Ein-Akzent-Regel wurde bewusst beibehalten. Kein digitales Bloom. Der Morgen arbeitet überwiegend mit kaltem Schiefer und Knochen neben den Holzfarben.

Die Bilder enthalten keine Beschriftung. Bei der Modus-Kachel das linke Drittel für Text verwenden und die gesamte 16:9-Komposition erhalten. Extremes Hochformat-Cropping würde die Basis abschneiden. Quellen sind deckende Druckplatten, keine freigestellten Sprites.

## Größen und Export

```sh
node scripts/export-dawn-art.mjs
```

Das Skript benötigt die vorhandene Projektabhängigkeit `sharp` und schreibt ausschließlich nach `public/assets/ui/dawn/art/runtime/`. Es funktioniert unabhängig vom Arbeitsverzeichnis. Kein npm-Script und keine Runtime-Integration wurden ergänzt.

- Porträt: 1254 × 1254 px Quelle; WebP mit 128, 256 und 512 px Kantenlänge.
- Landschaften: Imagegen lieferte 1672 × 941 px. Minimaler mittiger Beschnitt auf exakt 16:9: 1664 × 936 px, links/rechts je 4 px, oben 2 px und unten 3 px entfernt. Keine motivische Nachbearbeitung oder Farbkorrektur. Die gewählten Originale sind bytegleich mit den entsprechenden normierten Kandidaten.
- Landschaft-WebP: 960 × 540 und 1920 × 1080 px. **1920 ist eine Hochskalierung um ca. 15,4 %, keine native zusätzliche Bildinformation.** Im Manifest steht dafür `upscaled: true`.
- Lanczos3-Skalierung in sRGB; anschließend **verlustfreie WebP-Kompression**, Effort 6, keine zusätzliche Schärfung oder Metadatenübernahme.
- [runtime/manifest.json](runtime/manifest.json) enthält Quell-/Exportmaße, Dateigrößen, SHA-256, Auswahl und Encoder-Versionen. Dateipfade sind relativ zu diesem Ordner; `urlBase` ist `/assets/ui/dawn/art/`.
- Reproduzierbar aus den eingecheckten Quellen mit derselben durch Lockfile festgelegten Sharp/libvips/WebP-Version. Keine Zeitstempel oder Zufallswerte; identische Dateien werden nicht neu geschrieben. Die KI-Generierung selbst ist nicht deterministisch.

## Prüfung

[art-board.png](../../../../../art/poc/dawn/art/art-board.png) zeigt alle zwölf Kandidaten klein und die vier gewählten Bilder groß, dazu das Porträt bei echten 128 px in Umbra-/Ruß-/Moos-Rahmentönen sowie C-Druck-Icons zum Vergleich. Den Bogen bei 100 % betrachten; das Farbumfeld ist eine Tonprobe, kein neu gestalteter HUD-Rahmen.

Den Bogen bei Bedarf nach dem Export erneut erzeugen:

```sh
node art/poc/dawn/art/build-art-board.mjs
```

PNG-/WebP-Dateien und Bogen wurden direkt visuell geprüft, einschließlich Dachsmaske, Brille und Halstuch bei 128 px. Kein Browser, Dev-Server oder Spieltest. Der Export wurde zweimal verglichen: gleiche SHA-256 und unveränderte Änderungszeiten aller neun WebPs und des Manifests. Zusätzlich wurden Format, Zielmaße, Quellgleichheit und die verlustfreie Pixelgleichheit nach Skalierung geprüft; siehe [verification.json](../../../../../art/poc/dawn/art/verification.json). `git diff --check` ist Teil der Abschlussprüfung.
