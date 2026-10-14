# Dawn-Decals: ausgewaehlte Runtime-Assets

Die zehn PNG-Originale sind bytegleich aus `art/poc/dawn/decals/` uebernommen: 1024 x 1024 px, RGBA, quadratische Canvas mit zentriertem Motiv und transparentem Rand.

Auswahl der Leit-Session: geerdet, fuegt sich in den Waldboden ein und bleibt bei Spielgroesse lesbar. Prompt-Kerne, Generierungsdatum, Auswahlgrund und SHA-256 der Originale stehen in [prompts.json](prompts.json).

| Name | Vorgesehene Verwendung |
| --- | --- |
| [scorch-01](scorch-01.png) | Wrack: Brand-/Russfleck |
| [scorch-03](scorch-03.png) | Wrack: alternative Brandspur mit Kohlestruktur |
| [oil-stain-02](oil-stain-02.png) | Wrack: matte Oel-/Treibstofflache |
| [debris-scatter-03](debris-scatter-03.png) | Wrack: Truemmerfaecher nach links |
| [debris-scatter-02](debris-scatter-02.png) | Wrack: diagonaler Truemmerfaecher |
| [skid-gouge-02](skid-gouge-02.png) | Wrack: Absturz-Schleifspur, 2:1-Motiv |
| [drill-disturbance-03](drill-disturbance-03.png) | Extraktor: Bohrlochrand und aufgewuehlte Erde |
| [organic-stain-01](organic-stain-01.png) | Brutnest: dunkelvioletter Bewuchs mit Adern |
| [rust-flakes-01](rust-flakes-01.png) | Schrotthaufen: Roststaub und Blechflocken |
| [drag-marks-01](drag-marks-01.png) | Versorgung: Schleifspuren schwerer Kisten |

## Export

```sh
npm run assets:dawn-decals
```

[Exportskript](../../../../scripts/export-dawn-decals.mjs). Benoetigt die vorhandene `sharp`-Abhaengigkeit; die Originale in diesem Verzeichnis reichen aus. Das lokale PoC-Verzeichnis wird beim Export nicht gelesen.

Der gesamte 1024er-Canvas wird mit Lanczos3 auf 256 x 256 und 512 x 512 px skaliert. Kein erneutes Alpha-Bounding, kein Beschnitt und keine Verschiebung: Motivanteil, Zentrierung und weicher Alpha-Verlauf bleiben proportional erhalten, abgesehen von der notwendigen Pixelabtastung. Insbesondere bleibt die laengliche Absturzspur innerhalb einer quadratischen Datei.

WebP wird **verlustfrei nach der Verkleinerung** codiert. Keine Abdunklung, Farbkorrektur, Schaerfung oder Deckkraftaenderung. Blend und Deckkraft bleiben Aufgabe des spaeteren Renderers.

Ausgaben: `runtime/<name>-256.webp`, `runtime/<name>-512.webp` und [runtime/manifest.json](runtime/manifest.json). Gleiche Eingaben und dieselbe installierte Sharp/libvips-Version erzeugen identische Bytes. Unveraenderte Dateien werden nicht erneut geschrieben; das Manifest enthaelt keine Laufzeitstempel.

## Manifest-Format

```json
{
  "schemaVersion": 1,
  "assets": [
    {
      "name": "scorch-01",
      "sizes": [
        { "width": 256, "height": 256, "file": "scorch-01-256.webp" },
        { "width": 512, "height": 512, "file": "scorch-01-512.webp" }
      ]
    }
  ]
}
```

`file` ist relativ zum Manifest, also innerhalb von `runtime/`. Das Manifest enthaelt alle zehn Namen in der Reihenfolge der Auswahl. Keine Registrierung oder Integration unter `src/`.
