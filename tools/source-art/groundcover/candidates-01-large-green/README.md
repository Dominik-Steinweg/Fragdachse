# Große Bodenflächen – Waldgrün 01

16 separat auswählbare flache Bodendetails: vier Moosflächen, vier Kleeflächen, vier kriechende Bodendecker und vier Erd-/Streuflächen. Farbgrundlage sind der aktuelle Spiel-Screenshot und `grass-08-dark-fern` aus der vierten Grasmaterialserie. Die Motive ergänzen die bestehenden Einzelpflanzen und verändern keine Produktionsdateien.

## Auswahl und Maßstab

- [Auswahlgalerie](index.html) mit Materialhintergrund, Schachbrett und Anzeige bei vorgesehener Spielgröße.
- [Prompts](prompts.json) mit genauen Radien und beabsichtigten Durchmessern.
- [Herkunft und PNG-Daten](manifest.json).

**Radius ist hier wirklich Radius:** Bei 32 Weltpixeln pro Meter entsprechen 2–7 Meter Radius einem Durchmesser von 4–14 Metern bzw. 128–448 Weltpixeln. Die Größenangaben beziehen sich näherungsweise auf die längste sichtbare Ausdehnung der unregelmäßigen Fläche, nicht auf den transparenten Bildrand. Jedes Motiv hat einen eigenen vorgesehenen Radius; eine beliebige starke Vergrößerung kleiner Motive würde auch ihre Blätter und Bodenkörnung vergrößern.

## Für die spätere Einbindung

- Als flache Farbebene auf dem Boden vorgesehen, unter Einzelpflanzen und Hindernissen; ohne eingebackene Schatten, Seitenflächen oder erhöhten Rand.
- Echte PNG-Transparenz lässt den vorhandenen Boden an offenen Stellen und am ausgedünnten Rand sichtbar bleiben. Normales Alpha-Blending ist die vorgesehene Ausgangsbasis.
- Zum Skalieren den transparenten Rand berücksichtigen. Die Galerie nutzt dafür die im Manifest erfasste Alpha-Begrenzung. Die dortige Spielgrößenprobe ist eine unveränderte Darstellung der Quelldatei im Browser, keine Simulation des Produktionsrenderers, seiner Beleuchtung oder seines Nebels.
- Die großen zusammenhängenden Motive bereits bei ihrer vorgesehenen Größe beurteilen. Sparsame Verteilung und offene Rasenbereiche unterstützen den ruhigen Gesamteindruck.

## Erzeugung

Erzeugt mit dem eingebauten Imagegen-Werkzeug, je Motiv ein eigener Aufruf. Die ausgewählten PNGs werden unverändert aus dem Imagegen-Ausgabeordner kopiert; Prompts und Zuordnung zu den Originaldateien bleiben erhalten. Prüfung beschränkt auf unmittelbare Sichtung der erzeugten Bilder und PNG-/Alpha-Grunddaten. Keine Integration, Builds oder zusätzlichen Spieltests.

Knowledge writeback: No durable project knowledge discovered.
