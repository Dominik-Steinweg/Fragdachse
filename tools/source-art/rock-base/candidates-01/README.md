# Felsbasis-Kandidaten 01

Neun mit dem eingebauten Imagegen-Werkzeug neu erzeugte, unveränderte PNG-Materialquellen. Nur Asset-Erstellung; keine Änderungen an Produktionstexturen, Felsrenderer, Moos, Vegetation, Nebel oder anderen parallelen Arbeiten.

Die sechs mittleren Varianten und drei dunkleren Ergänzungen sind für die spätere Aufbereitung der **Rock-47Blob-Basis** gedacht. Sie enthalten nackte Steinflächen statt der kompletten Felskomposition. Die bestehende Darstellung legt Materialmodulation, Moos und Vegetation separat darüber.

[Galerie](index.html) · [Vollständige Prompts](prompts.json)

| Nr. | Materialquelle | Ausrichtung |
| --- | --- | --- |
| 01 | [Gebrochener Schiefer](rock-base-01-fractured-slate.png) | Kühle, klar gebrochene Schieferflächen; kurze, verzweigte Risse. |
| 02 | [Verwitterter Basalt](rock-base-02-weathered-basalt.png) | Kompakte, kantige Masse mit leicht gerundeten Bruchkanten. |
| 03 | [Neutralgrauer Bruchfels](rock-base-03-neutral-crag.png) | Ausgewogene, etwas hellere Steinbasis mit großen und kleinen Flächen. |
| 04 | [Geschichteter Gneis](rock-base-04-layered-gneiss.png) | Dezente mineralische Schichtung und versetzte Platten. |
| 05 | [Ruhige breite Felsflächen](rock-base-05-broad-planes.png) | Weniger Risse und größere Flächen für eine ruhige Basis. |
| 06 | [Kleinteilig gebrochener Fels](rock-base-06-chipped-stone.png) | Dichtere, unterschiedlich gerichtete Bruchflächen ohne Geröllteppich. |
| 07 | [Dunkles Anthrazit](rock-base-07-dark-anthracite.png) | Dunkler neutraler Basalt mit kompakten, lesbaren Bruchflächen. |
| 08 | [Dunkler kühler Schiefer](rock-base-08-dark-cool-slate.png) | Kühles dunkles Schiefergrau mit kantigen Platten und feinen Rissen. |
| 09 | [Dunkler graubrauner Fels](rock-base-09-dark-warm-stone.png) | Etwas wärmerer dunkler Stein mit ruhigen Flächen und mineralischen Nuancen. |

## Verwendung nach der Auswahl

- Die PNGs sind **Materialquellen, keine fertigen 47-Blob-Spritesheets**. Für den Einbau müssen sie mit der bestehenden Frame-Reihenfolge und den benötigten Silhouetten/Alphamasken aufbereitet werden.
- Orthografische Draufsicht, vollständig gefüllte Steinflächen, keine eingebackene Vegetation.
- Vorgesehener Ausgangsmaßstab: die vollständige Materialfläche entspricht ungefähr **4 × 4 Metern**, somit **128 × 128 Weltpixeln** bei 32 Pixeln pro Meter. Die hohe Auflösung der Quellgrafik ist kein 1:1-Weltpixelmaßstab.
- 01–06: mittlere Grauwerte als Basis für die vorhandenen dunkler machenden Schichten. 07–09: zusätzlich gewünschte dunkle Varianten in Anthrazit, kühlem Schiefergrau und Graubraun.
- Nahtlose Kachelung wurde im Generierungsauftrag verlangt, ist aber noch nicht technisch geprüft oder nachbearbeitet. Auch die Wirkung der vorhandenen Materialüberlagerungen ist noch nicht im Spiel geprüft.
- Wie angefordert keine Integration, Builds, Tests oder Browser-Detailprüfungen. Die Galerie zeigt nur die Originaldateien.

Quelle der Stilreferenz: vom Nutzer gelieferter Referenz-Screenshot `codex-clipboard-280dcb99-8703-4306-bc03-e11536b22795.png`. Werkzeug und exakte Prompts stehen in `prompts.json`.
