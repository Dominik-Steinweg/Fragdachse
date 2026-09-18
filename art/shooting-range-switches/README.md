# Schießstand-Schalter

Vier mit dem eingebauten Imagegen-Tool erzeugte, orthografische Holz-Piktogramme
mit Wurzelrahmen, Moos und Efeu. Der Adrenalin-Blitz besteht aus cyanblauem Harz.
Die finalen Prompts stehen in [prompts.json](prompts.json).

Runtime-Dateien: `public/assets/shooting-range/{supply,minus,plus,power}.png`.
Jede Datei ist auf 64 × 64 Pixel mit erhaltener Transparenz verkleinert und wird
mit 32 × 32 Weltpixeln rasterfüllend ohne sichtbaren Mauer-Sockel dargestellt.
Die transparente Randfläche wurde vor der Verkleinerung abgeschnitten.
Die Originale verbleiben in Codex' generated_images-Verzeichnis.
