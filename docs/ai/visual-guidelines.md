# Visuelle Leitlinien

Diese Seite definiert Art Direction und Lesbarkeit. Für Kamera-, Lightmap- und Post-FX-Verträge rendering.md lesen.

## Perspektive und Maßstab

Gameplay-Grafiken sind orthografisch aus 90° Top-down: keine Isometrie, Dreiviertelansicht, sichtbaren Objektseiten, Horizonte oder perspektivische Verjüngung. Spieler- und Gegnerbilder zeigen nach Norden; die Laufzeitrotation übernimmt die Ausrichtung. Bestehende Assets unter public/assets/ sind Maßstab- und Qualitätsreferenz.

Die Welt arbeitet im 32-px-Raster und mit klaren Tiefenbändern. Neue Assets müssen auf Gras, Dirt, Effekten und Teamfarben lesbar bleiben, transparente Kanten sauber halten und ihre native Pixelauflösung respektieren. Getragene Items bleiben im Raster der 32-px-Figur; Authoring steht in held-item-sprites.md.

## Lesbarkeit vor Dekoration

- Telegraphen müssen Fläche, Zeitpunkt und Gefahr sofort erkennen lassen und auch auf niedriger Grafikqualität sichtbar bleiben.
- Treffer, Projektilrichtung, Schaden, Heilung und Zustandsänderungen brauchen unterschiedliche Silhouetten/Farbsprache; Effekte dürfen Ziele nicht dauerhaft verdecken.
- Pro Bildschirm nur einen primären gesättigten UI-Handlungsakzent verwenden. Gold steht für Progression, Rot für Gefahr/Destruktion, Blau im Gameplay für Nebenmissionen. Zustandsanzeige und Aktion eines Buttons nicht über dieselbe Farbe vermischen.
- Neue UI-Texturen müssen alle darstellungsrelevanten Varianten im Cache-Schlüssel tragen. Icons werden gezeichnet oder als vorhandene Textur geladen, nicht als plattformabhängige Farb-Emojis gesetzt.
- Self-hosted Schriften liegen unter public/assets/fonts/; Text darf nicht vom zufälligen System-Fallback abhängen.

## Effekte

Eine Effektfamilie wird als zeitliche Sequenz entworfen: Antizipation/Flash, primäre Form, Impact, optionale Sekundärlayer und Residual/Cleanup. Layer nur hinzufügen, wenn sie Gameplay-Lesbarkeit oder Waffencharakter verbessern. Häufige Effekte benötigen begrenzte Emission, Wiederverwendung und vollständiges Cleanup von Emittern, Tweens, Timern, Filtern und Game Objects.

Flächeneffekte (Bodenfeuer, Zonen) werden über eine Emissionsdichte *pro Rasterzelle* begrenzt, nicht über einen festen Node-Deckel je Fläche: ein Deckel lässt die Deckung mit wachsender Fläche gegen null gehen, und die Fläche zerfällt sichtbar in einzelne Partikelnester. Die Zellzahl geht dabei gedämpft und gedeckelt ein, damit die Lane-Kapazität endlich bleibt.

Kamera-Feedback und Trefferreaktionen bleiben zentral gesteuert. Kein globaler Hit-Stop und kein direktes cameras.main.shake(); die technische Regel und die vorhandene Feedback-Regie stehen in rendering.md.

## Asset-Authoring

Vor einer neuen Grafik mindestens ein vergleichbares Asset und dessen Call-Site prüfen: Orientierung, native Auflösung, Tiefenband, Alpha, Besitz-/Fraktionsfarbe und Cleanup. Weltassets, UI-Icons und prozedurale Runtime-Texturen sind nicht austauschbar, nur weil sie ähnlich aussehen. Neue Gameplay-PNGs nur auf ausdrücklichen Auftrag erzeugen und gegen die 90°-Top-down-Regeln prüfen.
