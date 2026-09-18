# Schießstand-Schalter

Vier mit dem eingebauten Imagegen-Tool erzeugte, orthografische Metall-Piktogramme.
Die finalen Prompts stehen in [prompts.json](prompts.json).

Runtime-Dateien: `public/assets/shooting-range/{supply,minus,plus,power}.png`.
Jede Datei ist auf 64 × 64 Pixel mit erhaltener Transparenz verkleinert und wird
mit 26 × 26 Weltpixeln auf einem vorhandenen 32 × 32 Mauer-Sockel dargestellt.
Die transparente Randfläche wurde vor der Verkleinerung abgeschnitten.
Die Originale verbleiben in Codex' generated_images-Verzeichnis.
