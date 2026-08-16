# Rendering

Diese Seite dokumentiert technische Renderverträge. Art Direction steht in visual-guidelines.md; Phaser-API-Details zuerst im passenden offiziellen Skill prüfen.

## Designraum, Canvas und Kamera

Gameplay, HUD und Layout rechnen im Designraum GAME_WIDTH × GAME_HEIGHT aus src/config.ts. Die Canvas-/Backing-Store-Größe ist davon getrennt und wird durch graphics/RenderResolution.ts begrenzt und bei Resize, Vollbild und Zoom synchronisiert.

ArenaScene.bindCameraToDesignSpace() bindet die Hauptkamera an den Designraum und setzt ihren Origin auf (0, 0). Diese Abweichung vom Phaser-Default ist Absicht: Weltobjekte und scrollFactor-0-HUD sollen bei Zoom dieselbe Designraum-Transformation erhalten. Kamera-Bounds müssen zur Origin-/Zoom-Kombination passen; nicht selbst erneut eine zweite Skalierung einführen.

Rohes pointer.x/y ist in Renderpixeln. Für UI-Positionen zuerst toDesignSpace() aus RenderResolution.ts verwenden. camera.getWorldPoint() und Phaser-Input-Hit-Tests invertieren ihre Kameramatrix bereits; dort nicht zusätzlich umrechnen.

Text wird in Designpixeln gerastert. Textobjekte über scene.add.text erzeugen, damit TextResolution.ts die Auflösung an die Renderauflösung und verspätet geladene UI-Schriften anpassen kann. Die Canvas verwendet bewusst kein image-rendering: pixelated; die bestehende smoothPixelArt-Strategie braucht gefilterte Skalierung.

Bei Origin (0, 0) ist camera.worldView für die sichtbare Weltfläche nicht die verlässliche Quelle. Sichtbarkeitslogik verwendet die abgeleitete getVisibleWorldView()-Hilfe aus src/ui/HostileBaseIndicator.ts beziehungsweise den dort etablierten Vertrag. Ein HUD-Container mit absolut positionierten Kindern wird nicht skaliert; für Popups den Container auf die Elementmitte setzen und Kinder lokal platzieren.

## Zwei Kameras und Clarity Camera

cameras.main zeichnet die Welt und die Welt-Post-FX. Eine transparente Klarheitskamera zeichnet ausgewählte HUD-/Feedback-Objekte ohne Welt-Post-FX. cameraFilter ist eine Ausschlussmaske: Standardzuordnung und Promotion müssen über ClarityCameraRegistry erfolgen, nicht durch zufälliges scrollFactor- oder Sichtbarkeitsraten.

promoteToClarityCamera() gehört in den Aufbaupfad des tatsächlichen Game Objects oder Root-Containers. Wird ein Container zerstört und neu aufgebaut, muss die neue Wurzel erneut promotet werden. Container- und Kindmasken nicht mit camera.ignore() ersetzen; das rekursive Verhalten ist bei später hinzugefügten Kindern nicht stabil.

HUD-Overlays hängen an getOverlayRoot() aus src/ui/fullscreen.ts, nicht direkt an document.body. #game-container ist Parent und Fullscreen-Target, damit Browser-Vollbild den Canvas und DOM-Overlays gemeinsam erfasst.

Die Fullscreen-Statusanzeige hört auf die Projektfunktion onFullscreenChange(), nicht nur auf Phaser-Scale-Events; diese decken Browser-F11 nicht zuverlässig ab. Overlay-Root, Canvas und Fullscreen-Target müssen gemeinsam bleiben.

## Kamera-Feedback

Direktes cameras.main.shake() ist verboten. VisualFeedbackDirector stellt die CameraFeedbackController-Regie bereit. Quellen werden nach Priorität/Gewichtung zusammengeführt, in Designpixeln ausgedrückt, gedämpft und weich begrenzt. Wiederkehrende Quellen verwenden stabile IDs und aktualisieren ihre Werte; sie starten keinen konkurrierenden Phaser-Shake-Tween.

Kamera-Feedback darf keine Gameplay-Position oder Trefferprüfung verschieben. EntityJoltRegistry wendet rein visuelle Jolt-Werte nur im Renderfenster an und stellt sie danach wieder her; Host-Physik, Snapshots, HP-Balken und Geschwisterpositionen sehen die Jolt nicht. Globaler Hit-Stop oder eine Szene-Zeitskalierung ist im Mehrspielerpfad nicht zulässig.

## Zustandsgetriebene Welt-Telegraphen

Replizierte Präsentationszustände wechseln ihre Phase hart. Ein Welt-Telegraph hält deshalb einen eigenen Ist-Look (Farbe, Breiten, Dichten, Emissionsrate, Intensität) und gleicht ihn framerateunabhängig exponentiell an das Zielprofil an; Aufbau kurz, Ausklang lang. Reine Präsentationszeit wie ein nachhallender Ankunftslook liegt im Renderer und verschiebt weder Host-Phase noch Spawnzeit. Ausblenden erfolgt über denselben Ausklang bis unter eine Sichtbarkeitsschwelle, nicht durch sofortiges Verstecken beim Phasenende.

Eine additiv gestreckte Verlaufsfläche endet über dunklem Boden als sichtbare gerade Kante: ihr flacher Ausläufer unterschreitet eine 8-Bit-Stufe je mehreren Pixeln, und die äußerste Texelspalte wird von der linearen Filterung geklemmt statt weiter gegen null zu laufen. Volumen einer Lichtwand trägt deshalb eine Wolke überlappender Partikel, deren Dichte über Flugbahn und Lebensdauer nach innen ausläuft; die harte Lesbarkeit trägt allein die Kantenlinie auf der Front selbst.

Ein Kantenelement, das je Front rotiert wird, misst seine Größe in lokalen Achsen: die lokale Breite ist die Tiefe nach innen, die lokale Höhe die Spanne entlang der Kante. Für Nord und Süd ist die Spanne die Arenabreite, nicht die Arenahöhe. Vertauschte Achsen fallen an der West-/Ostfront nicht auf und erscheinen an der Nord-/Südfront als gerade Linie quer durch die Arena. Zonen von Partikelemittern sind emitterlokal und werden aus demselben Layout pro Frame gesetzt, damit sie nach einem Arenawechsel nicht auf alten Metriken stehen bleiben.

Fortlaufende Animationsphasen werden pro Frame integriert (`phase += dt * speed`) und nicht aus absoluter Rundenzeit mal Geschwindigkeit berechnet. Sonst springt jede Marke bei einem Geschwindigkeits- oder Periodenwechsel um einen von der Laufzeit abhängigen Betrag. Der Zeitschritt stammt aus derselben replizierten Rundenzeit und wird gegen Rücksprünge und Frame-Hänger begrenzt.

## Bodenbänder

Der Boden ist eine feste Reihenfolge gebackener Bänder: Gras (`DEPTH.GRASS`) < Dirt samt eingebackenem `BlobSurfaceMottle` (`DEPTH.DIRT`) < Ground Cover (`DEPTH.GROUND_COVER`) < Gleise (`DEPTH.TRACKS`) < Basiszonen (`DEPTH.BASES`) < Decals (`DEPTH.DECALS`). Jedes neue Bodenband muss der `ArenaTerrainColorSampler` in genau derselben Reihenfolge auf seine CPU-Canvas nachziehen, sonst weichen gelesene und sichtbare Bodenfarbe voneinander ab. Der Sampler zeichnet nicht aus Live-Objekten, sondern aus erhaltener Stempel-Geometrie; jede Transformation eines Bandes – auch Spiegelung – braucht dort ihr Gegenstück, weil `drawImage` sie nicht mitführt.

Der Felsbestand hat dieselbe Staffelung: Fels (`DEPTH.ROCKS`) < Materialstörung (`DEPTH.ROCKS + 0.05` aufwärts) < großflächiges Moos (`DEPTH.ROCK_MOSS`) < kleine Fels-Decals (`DEPTH.ROCK_DECALS`) < Kantenvegetation (`DEPTH.ROCK_VEGETATION`). Alles, was sich auf die Felssilhouette bezieht, wird nur in den betroffenen 128-px-Chunks neu gebacken und darf seine Platzierung dabei nicht neu auswürfeln — sie hängt ausschließlich an Gitterkoordinaten und dem Seed, nie am Bestand der lebenden Felsen. Was von einer solchen Schicht sichtbar ist, entscheidet die Stanzform aus der aktuellen Silhouette, nicht die Platzierung.

Ein weicher Rand an der Felssilhouette entsteht über ein zweites 47-Blob-Sheet als Verlaufsmaske, nicht durch Erodieren der Silhouette zur Laufzeit: Erosion ist nicht distributiv über die Vereinigung, jede Kachel einzeln zu schrumpfen ergäbe an jeder inneren Kachelgrenze einen Verlauf. Die Autotile-Frames tragen die Information über offene Kanten bereits, und weil die Maske am selben Frame-Index hängt wie der Fels, folgt sie jedem Retiling von selbst.

Soll eine felsgebundene Schicht über die Silhouette **hinaus**ragen, trägt dasselbe Muster mit größeren Frames: Ein Maskensheet mit doppelt großen, über der Zelle zentrierten Frames (`rocks47blob_vegmask.png`) ist über dem Fels voll deckend und läuft erst außerhalb aus; die halbe Framedifferenz ist die harte Obergrenze der Reichweite. Zwei Folgen sind Pflicht: Der Überhang der Schicht muss unter dieser Reichweite bleiben, sonst schneidet die Stanzform ihn wieder weg, und der Chunk-Neubau muss die Masken mit genau diesem Rand einsammeln – ein Fels im Nachbarchunk deckt noch in den eigenen hinein, sonst fehlt an jeder Chunkgrenze ein Streifen.

Ein wiederverwendetes Scratch-Renderziel muss vor jedem Blit `render()` sehen, auch wenn es leer bleibt: `clear()` ist wie `draw()`, `fill()` und `stamp()` ein **gepufferter** Befehl einer DynamicTexture und wird erst von `render()` ausgeführt. Ein `clear()` in einem übersprungenen Zweig ist damit wirkungslos, und der nächste Chunk blittet den Inhalt des vorigen – im Bild ein Bewuchsfleck auf leerem Boden, um den Chunkabstand versetzt.

Die Dirty-Chunks einer Felsänderung folgen derselben Reichweitenrechnung, nicht der Zelle: Zellgröße für das Retiling der acht Nachbarn plus den größten Maskenrand der gebundenen Schichten. Eine *neu hinzukommende* Quellzelle – ein gebauter Fels – trägt stattdessen die Stempelreichweite der Materialstörung, weil ihre Flecken in den bereits gebackenen Nachbarchunks noch gar nicht existieren. Die Materialquelle selbst schrumpft nie: Sie ist der vollständige Felsbestand der Runde, dedupliziert nach Zelle (`RockOverlayRegions`). Fällt eine Zelle aus ihr heraus, verschwinden Flecken bis zu einer Stempelreichweite weit auf unveränderten Nachbarfelsen.

Fels-Decals sind die eine Ausnahme vom Silhouettenschnitt, weil sie die Felskante absichtlich überragen. Ihre Stanzform ist allein die **Vereinigung der Zellquadrate weggefallener Felsen** (`RockDecalLayer`) – keine Silhouette, keine Maske. Der Unterschied ist nicht kosmetisch: Eine Stanzform aus „alle je belegten Zellen minus lebende Silhouetten" ließe die abgerundeten 47-Blob-Ecken *überlebender* Felsen als deckende Zwickel stehen, und der erste lokale Neubau eines Chunks räumte damit Decal-Pixel im ganzen Chunk weg, obwohl dort nichts zerstört wurde. Ein lebendes Fels-Image liegt exakt auf seiner eigenen Zelle und überschneidet nie das Quadrat eines gefallenen Nachbarn, deshalb ist der Rechteckschnitt exakt.

Ob ein Decal überhaupt noch gezeichnet wird, entscheidet seine Platzierungsklasse, und zwar in Vollbake und Chunk-Neubau über dieselbe Funktion – zwei Auswahlregeln nebeneinander wären genau der Riss, an dem ein erster lokaler Neubau eine Fläche umspringen ließe. Eine `core`-Matte (48/64 px) liegt per Konstruktion vollständig auf Fels und bleibt deshalb auch dann stehen, wenn ihre Ankerzelle fällt; sie verliert nur deren Quadrat. Jedes andere Fels-Decal darf über nie belegten Boden hängen, den keine Stanzform trifft, und muss mit seiner Ankerzelle ganz verschwinden. Aus demselben Grund braucht ein Fels-Decal ohne geführte `rotation` einen zellbasierten statt eines zufälligen Rückfallwerts: Ein Bodenband wird einmal je Runde gebacken, ein Fels-Decal bei jeder Hindernisänderung neu.

Beim Rock-Overlay-Regional-Rebuild gilt eine feste Koordinatengrenze: Der komplette 128-px-Scratch-Compose ist chunklokal und alle beteiligten Scratch-Kameras bleiben bei `(0, 0)`. Fels- und Masken-Images entstehen dafuer als kurzlebige Kopien an `cellCenter - chunk.local`, Decals mit einem Factory-Offset von `-chunk.local`; Weltkoordinaten duerfen nicht in diese Ziele gelangen. Cutout-Compose und Blit arbeiten anschliessend ausschliesslich mit Texturen via `erase(textureKey, 64, 64)` beziehungsweise `stamp(textureKey, chunk.localX, chunk.localY, origin=0)`. Auch die Kamera des arenaweiten Ziel-Layers muss fuer den kompletten gepufferten `clear`/`stamp`/`render`-Zyklus auf `(0, 0)` stehen. Rein texturlokale sichtbare Layer wie Rock-Mottle, Rock-Moss und Rock-Vegetation behalten diese neutrale interne Kamera auch im Vollbake dauerhaft; ihre GameObject-Position traegt bereits den Arena-Offset, und ihre Vollbake-Cutouts werden als Texturen statt als weltpositionierte Hilfs-Images eingelesen. Nur Layer, die ausserhalb des Blits noch weltpositionierte GameObjects einlesen, erhalten danach ihren vorherigen Kamera-Scroll zurueck. So kann ein Arena-Offset weder beim Einlesen noch beim Compose oder Blit ein zweites Koordinatensystem einfuehren.

Dieselbe Grenze gilt fuer regionale statische Schatten: `ShadowSystem.bakeShadowChunk()` liest weltpositionierte Graphics ueber die Scratch-Kamera ein, ersetzt den arenaweiten Bake danach aber ausschliesslich per Texture-Stamp an `chunk - worldBounds.min`. Ein weltpositioniertes Scratch-RenderTexture darf auch dort nicht als GameObject in den bereits gescrollten Arena-Layer gezeichnet werden; die Zielkamera bleibt waehrend `clear`/`stamp`/`render` ebenfalls neutral und wird erst danach auf den Arena-Offset zurueckgesetzt.

## Lobby-Terrainparitaet

Die Lobby-Vorschau verwendet fuer Gras, Dirt, Ground Cover, Decals, Felsen, Fels-Moos und
Fels-Vegetation dieselben Texturpfade, `ArenaVisualFactory`, Blob-Surface-Profile und Bake-
Helper wie die Arena. Die absichtlichen Unterschiede bleiben auf das authored Lobby-Layout
beschraenkt: Felsschriftzug, Rahmen, UI-Reserveflaechen und die Ambient-Freiflaechen; Gleise und
Baumstaemme sind in diesem Layout nicht belegt. Ambient-Felszerstoerung aktualisiert weiterhin
den stabilen Felsbestand ueber `setRockAlive()` und backt die abhaengigen Baender gesammelt neu;
der Teardown stellt den kanonischen Bestand wieder her und leert ihn vor dem Arena-Uebergang.

## Lighting und Schatten

ShadowSystem, LightingSystem und Post-FX sind getrennte Verantwortlichkeiten. LightingSystem komponiert dynamisches Licht und Verdeckung in eine Lightmap, die als ein Overlay in der Tiefenordnung liegt. Phasers eingebautes per-Object-Lighting ist dafür nicht der Projektvertrag.

Die Lightmap wird mit deckendem Ambient gefüllt und additiven Lichtquellen aufgebaut; das Composite verwendet MULTIPLY. Die Lichtberechnung ist über TimeOfDay parametrisiert, nicht über separate Tages-/Nachtpfade. Baumkronen liegen über dem Lightmap-Overlay und erhalten ihre eigene Tönung. Emissive Gameplay-FX und wichtige Telegraphen dürfen nicht versehentlich durch das Weltlicht unlesbar werden.

Bei dynamischer Tageszeit folgt das laufende Shadow-Profil sofort den dynamischen Castern. Statische Tree-/Rock-Bakes halten dagegen ein eigenes tatsächlich gebackenes Profil und werden nur bei relevanter Abweichung gedrosselt vollständig ersetzt; ein gescriptetes Transitionsziel erzwingt den finalen Bake. Es werden nie zwei sichtbare MULTIPLY-Bakes alpha-gemischt. Regionale Rock-Dirty-Rebuilds bleiben ungedrosselt und rechnen während eines ausstehenden Profilwechsels mit dem gebackenen Profil, damit kein Chunk vorauseilt und kein alter Felsrand als Geisterschatten stehen bleibt.

DynamicTexture- und RenderTexture-Zeichenbefehle sind aufgeschoben. Wiederverwendete Graphics-/Image-Quellen dürfen nicht über mehrere Slots aliasen; Scratch-Ressourcen müssen vor dem Lightmap-Composite in der Display-Liste geleert sein. Eine Lightmap-/Occluder-Änderung über denselben Dirty-Trichter wie Combat-Hindernisse synchronisieren.

Kamerabewegung läuft über Scroll-Offsets der Hauptkamera. Der Feedback-Versatz muss vor der World-Light-/Shadow-Synchronisierung im Frame gesetzt werden, damit Welt, Lightmap und Occluder deckungsgleich bleiben. Statische Occluder über die gemeinsame Arena-/Light-Occluder-Quelle anmelden und beim Round-Teardown entfernen. Bewegliche Occluder bleiben außerhalb dieses Indexes: `LightingSystem` fragt sie über `DynamicLightOccluderSource` nur für budgetierte verdeckende Lichter ab; die Quelle filtert dabei exakt gegen den jeweiligen Lichtradius. `low` hat keine Occlusion-Slots und führt deshalb auch keine dynamischen Occluder-Abfragen aus.

## Post-FX und Displacement

CameraPostFxController/PostFxComposer bauen die Filterkette einmalig auf. Qualitätsprofile und Ereignisaktivität sind getrennt: ein erlaubter, aber gerade inaktiver Filter darf keinen neutralen Vollbildpass ausführen. Objektfilter und Kamera-Post-FX getrennt registrieren, damit Qualitätsdiagnose und Budgets korrekt bleiben.

Lokale Zeitblasen-/Schwarzes-Loch-/Druckwellen-Verzerrung läuft über LocalDistortionComposer und eine gemeinsame Displacement-Karte mit genau einem Kamera-Pass. Quellen sind Frame-Anmeldungen; wer nicht mehr anmeldet, verschwindet. Die neutrale Kodierung der Karte ist 0x808080. Änderungen der Kartengröße erfordern eine neue DynamicTexture und eine neue Filterverbindung, nicht setSize() auf der bestehenden Karte. Nach dem Stempeln muss DynamicTexture.render() den Command-Buffer flushen.

Der dauerhafte Boss-Look ist ein reiner Praesentationszustand: `VisualFeedbackDirector` fuehrt den
visuellen Faktor von 0 auf 1 ueber 1800 ms mit Smoothstep, waehrend `worldGrade` den aktuellen
Nacht-/Normal-/Void-Ton, Kontrast, Temperatur und Tint-Staerke interpoliert. Der replizierte
Boss-Phasenwechsel bleibt hart fuer die Logik, loest aber nur einen kurzen, weich anlaufenden
`bossPhaseChange`-Akzent aus.

Map 15 liefert dafuer das Profil `void-hunter`: Der Leerenjaeger blendet in Phase 1 in denselben
1.8-Sekunden-Faktor ein, waehrend Phase 2 den Void-Tint, Kontrast und Bloom weiter verstaerkt.
Andere Boss-Maps bleiben beim generischen `BOSS_TINT`.

## Charaktersprite-Skalierung

Die Anzeigegröße einer Figur ist PLAYER_SIZE und ist von der Authoring-Auflösung ihrer Textur entkoppelt: Das Badger-Walking-Sheet liegt in 64-px-Zellen, die Figur bleibt 32 px. Daraus folgt eine Grundskalierung ungleich 1. Spawn-, Dash- und Burrow-Feedback sind deshalb Faktoren *relativ* zu dieser Grundskalierung und laufen über PlayerEntity.applySpriteScale() beziehungsweise die öffentliche setDashScale()-API; ein direktes sprite.setScale(1) von außen ist kein neutraler Wert mehr, sondern bläht die Figur auf Texturgröße auf. Overlays im 32-px-Raster (Spawn-Shine, Stealth-Shell/-Scan) übernehmen den Feedback-Faktor, nicht die rohe Texturskalierung.

## Laufanimationen

src/animations/BadgerAnimations.ts ist die einzige Registry für Walking-Sheets: eine Zeile 64×64-Zellen mit nordgerichteten Frames, wie die statischen Einzeltexturen. Eine neue animierte Figur ist genau ein Eintrag in WALKING_SHEETS; Preload, Animationsregistrierung und syncBadgerWalkingAnimation() leiten sich daraus ab. Gegner lösen ihre animierte Variante über staticTextureKey aus ihrem authored imageKey auf, deshalb bleibt coopDefenseEnemies.json unverändert; die statische Textur wird weiter geladen und von Trail-Geistern verwendet.

Der Laufzustand kommt aus genau einer Quelle je Kontext: Host aus der Körpergeschwindigkeit, Client aus dem offenen Interpolationsabstand zur replizierten Zielposition (EnemyEntity.syncWalkingFromInterpolation(), kein Wire-Feld), Lobby-Ambient explizit aus dem Bewegungswinkel. Die Entity sperrt die Wiedergabe zusätzlich bei eingebuddelt, unsichtbar oder tot. Kopien eines animierten Sprites müssen den aktuellen Frame mitgeben; ein Texturschlüssel ohne Frame liefert bei Spritesheets den kompletten Streifen.

## Koordinaten und Cleanup

Partikelkoordinaten sind emitterlokal. Entweder Emitter an der Weltposition plus explode(count) ohne Koordinaten, oder geteilter Emitter im Ursprung plus emitParticleAt()/explode() mit Weltkoordinaten. Nicht beide Ortsangaben kombinieren.

Die Mündungsposition wird zentral über getTopDownMuzzleOrigin() beziehungsweise getTopDownMuzzleOriginFromVector() aus src/config.ts berechnet. MuzzleFlashRenderer erhält bereits diese Position; keinen zweiten Vorwärtsoffset addieren. Trails und Anhänge leiten lokale Offsets aus der normalisierten Flug-/Aimrichtung ab.

Jeder Round-Teardown muss Emitter, Tweens, Timer, Filter, temporäre Texturen, RenderTextures und Game Objects der Round-Ressourcen freigeben. Häufige Effekte dürfen gepoolt werden, aber nur mit vollständigem Reset.
