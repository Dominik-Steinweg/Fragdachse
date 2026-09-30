# Endgültige Assets A03–A14

Freigegeben und integriert: Waffen A03–A06 aus r01 und Power-ups A07–A14 aus r05 (Rahmen C). [Ansicht](r05/vergleich.html) · [Manifest mit Zielpfaden und Prüfsummen](final-manifest.json).

Die 256-Pixel-PNGs unter den bestehenden Runtime-Pfaden sind byteidentisch mit den freigegebenen Exporten. Reguläre Power-ups bleiben 22 Spieleinheiten groß; die Einblendanimation erhält den Größen-Fit. Die Nuke-Countdown-Grafik bleibt bei 16 Spieleinheiten. ASMD-Icons verwenden lineare Filterung.

Verworfene Icon-Varianten und historische Vergleichsseiten wurden auf Nutzerwunsch entfernt. Erhalten sind die endgültigen Icons, die vier Waffen-Master und Blender-Referenzbilder, die acht ausgewählten Symbol-Layer sowie die gemeinsame deckende Kachel und deren generierte Quelle. Die Symbole werden von 192 auf 180 Pixel verkleinert und bei 38/38 auf die 256er Kachel gesetzt.

Reproduktion: node art/icon-refresh-a03-a14/export-final.mjs — prüft und reproduziert die Power-up-Exporte, ohne Runtime-Dateien zu ändern.

Prüfung auf main: 138 Asset-Tests und 13 gezielte Tests bestanden; alle zwölf Runtime-Dateien stimmen mit den Freigaben überein. Der Build scheitert an bereits vorhandenen, unveränderten Importfehlern in src/arena/rocks/RockSurfaceRendering.ts (Zeilen 2–4). Keine erneute Match-Sichtprüfung.

Die gespeicherten Prompts dokumentieren die ursprüngliche Generierung; darin genannte verworfene Referenzbilder sind keine Export-Abhängigkeiten.
