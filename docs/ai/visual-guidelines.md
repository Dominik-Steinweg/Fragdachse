# Visuelle Leitlinien

## Art Direction

Fragdachse verwendet eine orthografische 90°-Top-down-Perspektive mit klarer Pixel-Art-Silhouette. World-Geometrie, Spieler, Gegner, Basen und Interactables müssen aus normaler Spielentfernung unterscheidbar bleiben; Mikrodetails sind nachgeordnet.

- Konturen und Wertkontraste definieren zuerst die Form.
- Farbflächen tragen Fraktion, Zustand und Bedrohung, ohne die Lesbarkeit der World-Tiles zu überdecken.
- Die Blickrichtung von Figuren und getragenen Items bleibt konsistent nach Norden ausgerichtet; Rotation kommt aus der gemeinsamen Pose.
- World, Activity, Overlay und HUD erhalten eine eindeutige visuelle Hierarchie.
- Text, Icons und wichtige Statussignale bleiben auch während Bewegung, FX und Camera-Feedback lesbar.

## Sichtbare Zustände

Ein Gameplay-Effekt folgt einer lesbaren Ursache-Wirkungs-Kette: Ursprung, Bewegung oder Ausbreitung, Kontakt, Nachwirkung und Aufräumen. Schaden, Treffer, Heilung, Platzierung, Abbau, Explosion und Tod unterscheiden sich in Silhouette, Wert, Farbtemperatur oder Bewegungsrhythmus.

Telegraphen machen bevorstehende Gefahr, Interaktionsmöglichkeit und Wirkungsbereich vor dem Ergebnis lesbar.

Häufige Effekte dürfen nicht dauerhaft die Szene verstopfen. Partikel, Blitze, Dekals und temporäre Overlays besitzen eine begrenzte Lebensdauer, werden bei wiederholten Ereignissen gebündelt und lösen ihre Ressourcen beim Ende der World oder Scene.

## Kameraführung und Presentation

World-Kamera, Clarity-Kamera und Presentation-Mode sind technische Mittel für Lesbarkeit, keine Gameplay-Rechte. Preview zeigt nur die dafür freigegebenen World-Flächen; interaktive Flächen erscheinen erst mit gültiger WorldParticipation.

Camera-Feedback unterstützt Treffergewicht und Gefahr, darf aber Pointer-, Kollisions- oder Zielgeometrie nicht verschieben. Renderer und Effects beobachten replizierten beziehungsweise lokalen Runtime-Zustand; sie entscheiden keine Regeln.

## Authoring-Checkliste

Vor einem neuen visuellen Asset prüfen:

1. Ist die Silhouette aus der tatsächlichen Spieldistanz lesbar?
2. Bleibt die Perspektive orthografisch und der Anker im gemeinsamen Raster?
3. Sind Fraktion, Zustand und Priorität ohne Text erkennbar?
4. Passt das Asset in die bestehende Depth-, Clarity- und Cleanup-Logik?
5. Gibt es einen klaren Runtime-Owner und einen klaren Renderer-Owner?
6. Werden neue Werte in authored Daten oder einer vorhandenen Registry geführt statt im Renderer dupliziert?

Für Kamera-, Auflösungs-, Chunk- oder FX-Verträge siehe [rendering.md](rendering.md) und [performance.md](performance.md).
