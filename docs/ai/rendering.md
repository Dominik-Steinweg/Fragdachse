# Rendering

Diese Seite dokumentiert technische Renderverträge. Art Direction steht in visual-guidelines.md; Phaser-API-Details zuerst im passenden offiziellen Skill prüfen.

## Renderer-Voraussetzung

Fragdachse startet ausschließlich mit `Phaser.WEBGL`. `src/main.ts` prüft vor Content-Validierung,
Netzwerkaufbau und Phaser-Initialisierung, ob der Browser einen WebGL-Kontext bereitstellt, und
zeigt bei fehlender Unterstützung eine reine DOM-Fehlermeldung. Der Phaser-Canvas bleibt dabei die
Ausgabefläche; `CanvasTexture`, `createCanvas()` und Offscreen-Canvas für Textur-, Font- oder
Pixel-Erzeugung sind weiterhin legitime Bestandteile des WebGL-Pfads.

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

Beam-Pfade verwenden `src/effects/BeamPathShared.ts` für Punkte, Spline-Resampling, Sampling, Blending und Endpunkt-Reanchoring. BFG-Laser-Batches führen die autoritative `projectileId` auf Batch-Ebene; der Renderer folgt mit dem Beam-Start pro Renderframe der aktuellen Projektilposition, während jeder Endpunkt die vom Schadensimpuls gelieferte Trefferposition bleibt.

Eine additiv gestreckte Verlaufsfläche endet über dunklem Boden als sichtbare gerade Kante: ihr flacher Ausläufer unterschreitet eine 8-Bit-Stufe je mehreren Pixeln, und die äußerste Texelspalte wird von der linearen Filterung geklemmt statt weiter gegen null zu laufen. Volumen einer Lichtwand trägt deshalb eine Wolke überlappender Partikel, deren Dichte über Flugbahn und Lebensdauer nach innen ausläuft; die harte Lesbarkeit trägt allein die Kantenlinie auf der Front selbst.

Ein Kantenelement, das je Front rotiert wird, misst seine Größe in lokalen Achsen: die lokale Breite ist die Tiefe nach innen, die lokale Höhe die Spanne entlang der Kante. Für Nord und Süd ist die Spanne die Arenabreite, nicht die Arenahöhe. Vertauschte Achsen fallen an der West-/Ostfront nicht auf und erscheinen an der Nord-/Südfront als gerade Linie quer durch die Arena. Zonen von Partikelemittern sind emitterlokal und werden aus demselben Layout pro Frame gesetzt, damit sie nach einem Arenawechsel nicht auf alten Metriken stehen bleiben.

Fortlaufende Animationsphasen werden pro Frame integriert (`phase += dt * speed`) und nicht aus absoluter Rundenzeit mal Geschwindigkeit berechnet. Sonst springt jede Marke bei einem Geschwindigkeits- oder Periodenwechsel um einen von der Laufzeit abhängigen Betrag. Der Zeitschritt stammt aus derselben replizierten Rundenzeit und wird gegen Rücksprünge und Frame-Hänger begrenzt.

## Gestreamte Weltschichten

Keine sichtbare Weltschicht besitzt ein Renderziel in Arenagröße. Bodenbänder, felsgebundene Overlays und die gebackenen statischen Schatten liegen in quadratischen **Render-Chunks** (`ARENA_RENDER_CHUNK_SIZE`, ein ganzzahliges Vielfaches der 128-px-Dirty-Granularität); resident ist nur, was der lokale Kameraausschnitt samt Sicherheitsrand berührt. Die laufenden Renderkosten folgen damit dem sichtbaren Inhalt, nicht der Weltfläche. Der logische Arena-, Fels- und Physikzustand bleibt global — gestreamt wird ausschließlich die Darstellung.

Ein `ChunkedRenderSurface` liefert dafür genau zwei Dinge: wann ein Quadrat gebacken werden muss (Residenzwechsel oder Dirty-Region) und wohin das Ergebnis geht. Jede Bake-Funktion erzeugt ihr Bild in einem chunklokalen Scratch-Ziel der Kantenlänge der Region und blittet es über den Texturschlüssel; Weltkoordinaten dürfen weder in das Scratch-Ziel noch in die Kamera des Ziels gelangen. Die Weltposition trägt allein die Position des Chunk-GameObjects. Ein Scratch-Ziel, dessen Kantenlänge mit der Arena skalierte, wäre derselbe Fehler in klein.

Die Acquisition eines neuen Render-Chunks führt keinen synchronen Vollbake mehr aus. Gepoolte Renderziele werden direkt übernommen; tatsächlich neue RenderTextures und Layer werden selbst als Jobs in den gemeinsamen `ChunkBakeScheduler` eingereiht und erst danach mit ihren 128-px-Regionen gebacken. Ground, RockOverlay und statische Schatten teilen sich pro Frame ein kleines Zeitbudget: reiner Prefetch liegt normalerweise bei etwa 1,5 ms, sichtbare unfertige Chunks oder dringende sichtbare Dirty-Arbeit dürfen bis etwa 4 ms nutzen. Der Scheduler hält zusammengehörige Acquisition-/Bake-Jobs möglichst bis zur Chunk-Fertigstellung zusammen, priorisiert Dirty-Rebuilds vor reinem Prefetch und berücksichtigt weiterhin Sichtbarkeit, Kameranähe und Bewegungsrichtung. Der Render-Prefetch liegt bewusst über dem alten 128-px-Erwerbsrand. Ein Chunk wird erst nach Abschluss aller Regionen sichtbar; bei einem Full-Refresh bleibt er bis zum vollständigen Neuaufbau verborgen, damit kein Patchwork aus alten und neuen Regionen erscheint. Wird eine Region während eines ausstehenden Aufbaus dirty, wird genau diese Arbeitseinheit erneut eingereiht; verlässt der Chunk den Freigaberand, werden seine Jobs abgebrochen und die Ziele wie bisher über den Pool recycelt.

Beim ersten `updateResidency()` während des verdeckten Arena-Starts berechnet jede `ChunkedRenderSurface` eine konservative obere Schranke aus Viewport, Prefetch-/Release-Rand und Chunkraster und legt dafür `maximaler Release-Bedarf × Layerzahl + kleinen Puffer` an. Das Pool-Limit ist nicht an die Map-Fläche gekoppelt. Die bekannten Dirty-Scratch-Rollen werden im selben Startup vorgewärmt. Freigaben werden vor neuen Acquisitions verarbeitet, und ein nichtresidenter Gutter-Bake leiht sich seine Ziele aus demselben Pool; dadurch bleiben normale Kamerafahrten und Dirty-Wellen nach dem Startup ohne neue RenderTexture-/Framebuffer-Erzeugung. Die Diagnosewerte `allocatedTextures`, `allocatedPixels` und `runtimeTextureCreations` machen diese Zusicherung prüfbar.

Ein Chunk-Renderziel ist je Seite um `CHUNK_SAMPLING_GUTTER_PX` größer als sein logischer Chunk und trägt dort echte angrenzende Weltinformation; sichtbar bleibt trotzdem nur der logische Bereich, ausgeschnitten über ein eigenes Texturframe. Ohne diesen Gutter zeigt **jede** gestreamte Schicht regelmäßige Linien an den Chunkgrenzen: Bei Kamerazoom fällt die Chunkkante zwischen zwei Bildschirmpixel, die bilineare Filterung greift ein halbes Texel über den Texturrand hinaus, findet nichts und klemmt auf das Randtexel — beide Nachbarn wiederholen ihr eigenes Randtexel, statt ineinander zu blenden. Ein kleineres Renderziel oder ein sichtbar überlappender Chunk sind keine Alternativen: Das erste löst nichts, das zweite doppelt bei MULTIPLY-Ebenen die Abdunklung. Die Erweiterung steckt vollständig in `ChunkedRenderSurface.runBake()` — sie hebt sich gegen den Gutter des Renderziels auf, sodass das Blit-Ziel der Versatz der logischen Region bleibt und die 128-px-Dirty-Granularität unverändert gilt. Eine Dirty-Region an einer Chunkgrenze wird fachlich nur einmal gebacken; `ChunkedRenderSurface` kopiert danach die bereits komponierten Rand-/Eckpixel ausschließlich in die physischen Gutter-Zonen aller betroffenen residenten Nachbarn. Damit bleibt deren sichtbare Dirty-Auswahl unverändert, während die Sampling-Daten synchron sind; ein Nachbar erhält keinen zweiten vollständigen Dirty-Bake.

Daraus folgt eine harte Anforderung an jede Quelle: Ein verworfener und später wieder aufgebauter Chunk muss sichtbar identisch sein. Gezeichnet werden darf nur aus Seed, Rasterkoordinaten und aktuellem Weltzustand — nie aus einem Zufallsgenerator. Ein Decal ohne geführte `rotation` leitet sie deshalb auf **beiden** Untergründen aus seiner Zelle ab; die frühere Ausnahme für Bodendecals galt nur, solange ein Bodenband genau einmal je Runde gebacken wurde.

Weil es nur noch einen Bake-Pfad gibt — erster Aufbau und Dirty-Neubau laufen durch dieselbe Funktion, nur mit anderer Regionsgröße — ist die frühere Parität zwischen Vollbake und lokalem Neubau keine Zusicherung mehr, sondern Konstruktion.

## Bodenbänder

Der Boden ist eine feste Reihenfolge gebackener Bänder: Gras (`DEPTH.GRASS`) < Dirt samt eingebackenem `BlobSurfaceMottle` (`DEPTH.DIRT`) < Ground Cover (`DEPTH.GROUND_COVER`) < Gleise (`DEPTH.TRACKS`) < Basiszonen (`DEPTH.BASES`) < Decals (`DEPTH.DECALS`).

Ein Render-Chunk sammelt seine Quellzellen mit Rand ein, nicht nur die eigenen: Dirt-Autotiling und Ecktints müssen den **gesamten** Dirt-Bestand sehen, sonst liest jede Chunkgrenze wie eine Außenkante des Bodens; die Randfahne reicht um ihren Überhang über die eigene Zelle hinaus, die Materialstörung um ein Vielfaches davon.

Der LeafBlower erhält nach dem synchronen Arena-Aufbau genau einen opaken `TerrainColorSnapshot`. Er wird mit festem `scale = 4` aus mehreren 512×512-Scratch-Regionen aufgebaut; jede Region wird einmal gelesen und in das zusammenhängende RGB-Array kopiert, danach wird dasselbe Scratch-Ziel wiederverwendet. Die Darstellung folgt Grass, Background-Detail/MULTIPLY, Dirt samt Fringe/Corner-Tints/Mottle, Ground Cover, Tracks, statischen Base-Zonen und Ground-Decals. Die Tile- und Sampling-Phase verwendet den globalen Welt-/Tileoffset, damit Regionsgrenzen nicht bei Texture-Offset 0 neu beginnen. Während des Spiels gibt es weder GPU→CPU-Readbacks noch einen periodischen Terrain-RGB-Sampler: Blätter klassifizieren ihre Layoutposition nur etwa alle 32 Weltpixel als Grass, Dirt oder neutral und wählen daraus eine gehaltene Naturpalette; Staub liest die sichtbare Snapshot-Farbe ausschließlich beim jeweiligen Spawn und behält diesen Tint.

Der Felsbestand hat dieselbe Staffelung: Fels (`DEPTH.ROCKS`) < Materialstörung (`DEPTH.ROCKS + 0.05` aufwärts) < großflächiges Moos (`DEPTH.ROCK_MOSS`) < kleine Fels-Decals (`DEPTH.ROCK_DECALS`) < Kantenvegetation (`DEPTH.ROCK_VEGETATION`). Alles, was sich auf die Felssilhouette bezieht, wird nur in den betroffenen 128-px-Chunks neu gebacken und darf seine Platzierung dabei nicht neu auswürfeln — sie hängt ausschließlich an Gitterkoordinaten und dem Seed, nie am Bestand der lebenden Felsen. Was von einer solchen Schicht sichtbar ist, entscheidet die Stanzform aus der aktuellen Silhouette, nicht die Platzierung.

Die Bewuchs-Generatoren besitzen keinen globalen, an kleinen Karten dimensionierten Placement-Deckel. Ground Cover und Fels-Moos leiten ihr Budget aus Blockraster und Slots je Block ab; die Kantenvegetation aus dem vollständigen Felsbestand und dem Kantenbudget je Felszelle. Damit bleibt die lokale Bewuchsdichte auch auf sehr großen Coop-Karten wie Test-Map 0 (400 × 80 Zellen) erhalten, während weiterhin nur sichtbare Chunks gebacken werden.

Ein weicher Rand an der Felssilhouette entsteht über ein zweites 47-Blob-Sheet als Verlaufsmaske, nicht durch Erodieren der Silhouette zur Laufzeit: Erosion ist nicht distributiv über die Vereinigung, jede Kachel einzeln zu schrumpfen ergäbe an jeder inneren Kachelgrenze einen Verlauf. Die Autotile-Frames tragen die Information über offene Kanten bereits, und weil die Maske am selben Frame-Index hängt wie der Fels, folgt sie jedem Retiling von selbst.

Soll eine felsgebundene Schicht über die Silhouette **hinaus**ragen, trägt dasselbe Muster mit größeren Frames: Ein Maskensheet mit doppelt großen, über der Zelle zentrierten Frames (`rocks47blob_vegmask.png`) ist über dem Fels voll deckend und läuft erst außerhalb aus; die halbe Framedifferenz ist die harte Obergrenze der Reichweite. Zwei Folgen sind Pflicht: Der Überhang der Schicht muss unter dieser Reichweite bleiben, sonst schneidet die Stanzform ihn wieder weg, und der Chunk-Neubau muss die Masken mit genau diesem Rand einsammeln – ein Fels im Nachbarchunk deckt noch in den eigenen hinein, sonst fehlt an jeder Chunkgrenze ein Streifen.

Ein wiederverwendetes Scratch-Renderziel muss vor jedem Blit `render()` sehen, auch wenn es leer bleibt: `clear()` ist wie `draw()`, `fill()` und `stamp()` ein **gepufferter** Befehl einer DynamicTexture und wird erst von `render()` ausgeführt. Ein `clear()` in einem übersprungenen Zweig ist damit wirkungslos, und der nächste Chunk blittet den Inhalt des vorigen – im Bild ein Bewuchsfleck auf leerem Boden, um den Chunkabstand versetzt.

Die Dirty-Chunks einer Felsänderung folgen derselben Reichweitenrechnung, nicht der Zelle: Zellgröße für das Retiling der acht Nachbarn plus den größten Maskenrand der gebundenen Schichten. Eine *neu hinzukommende* Quellzelle – ein gebauter Fels – trägt stattdessen die Stempelreichweite der Materialstörung, weil ihre Flecken in den bereits gebackenen Nachbarchunks noch gar nicht existieren. Die Materialquelle selbst schrumpft nie: Sie ist der vollständige Felsbestand der Runde, dedupliziert nach Zelle (`RockOverlayRegions`). Fällt eine Zelle aus ihr heraus, verschwinden Flecken bis zu einer Stempelreichweite weit auf unveränderten Nachbarfelsen.

Fels-Decals sind die eine Ausnahme vom Silhouettenschnitt, weil sie die Felskante absichtlich überragen. Ihre Stanzform ist allein die **Vereinigung der Zellquadrate weggefallener Felsen** (`RockDecalLayer`) – keine Silhouette, keine Maske. Der Unterschied ist nicht kosmetisch: Eine Stanzform aus „alle je belegten Zellen minus lebende Silhouetten" ließe die abgerundeten 47-Blob-Ecken *überlebender* Felsen als deckende Zwickel stehen, und der erste lokale Neubau eines Chunks räumte damit Decal-Pixel im ganzen Chunk weg, obwohl dort nichts zerstört wurde. Ein lebendes Fels-Image liegt exakt auf seiner eigenen Zelle und überschneidet nie das Quadrat eines gefallenen Nachbarn, deshalb ist der Rechteckschnitt exakt.

Ob ein Decal überhaupt noch gezeichnet wird, entscheidet seine Platzierungsklasse, und zwar in Vollbake und Chunk-Neubau über dieselbe Funktion – zwei Auswahlregeln nebeneinander wären genau der Riss, an dem ein erster lokaler Neubau eine Fläche umspringen ließe. Eine `core`-Matte (48/64 px) liegt per Konstruktion vollständig auf Fels und bleibt deshalb auch dann stehen, wenn ihre Ankerzelle fällt; sie verliert nur deren Quadrat. Jedes andere Fels-Decal darf über nie belegten Boden hängen, den keine Stanzform trifft, und muss mit seiner Ankerzelle ganz verschwinden. Aus demselben Grund braucht jedes Decal ohne geführte `rotation` einen zellbasierten statt eines zufälligen Rückfallwerts – seit dem Chunk-Streaming auch das Bodendecal, denn kein Band wird mehr genau einmal je Runde gebacken.

Beim Rock-Overlay-Regional-Rebuild gilt eine feste Koordinatengrenze: Der komplette 128-px-Scratch-Compose ist chunklokal und alle beteiligten Scratch-Kameras bleiben bei `(0, 0)`. Fels- und Masken-Images entstehen dafuer als kurzlebige Kopien an `cellCenter - chunk.local`, Decals mit einem Factory-Offset von `-chunk.local`; Weltkoordinaten duerfen nicht in diese Ziele gelangen. Cutout-Compose und Blit arbeiten anschliessend ausschliesslich mit Texturen via `erase(textureKey, 64, 64)` beziehungsweise `stamp(textureKey, chunk.localX, chunk.localY, origin=0)`. Die interne Kamera eines residenten Chunk-Ziels steht dauerhaft auf `(0, 0)`: Sein Inhalt ist chunklokal, den Weltversatz traegt allein seine GameObject-Position. Cutouts werden als Texturen statt als weltpositionierte Hilfs-Images eingelesen. Nur ein Scratch-Ziel, das weltpositionierte GameObjects einliest, scrollt ueberhaupt – und zwar auf die Weltecke seiner Region. So kann ein Arena-Offset weder beim Einlesen noch beim Compose oder Blit ein zweites Koordinatensystem einfuehren.

Dieselbe Grenze gilt fuer die statischen Schatten: `ShadowSystem` liest die weltpositionierten Footprint-Graphics ueber die Scratch-Kamera ein und schreibt das Ergebnis ausschliesslich per Texture-Stamp in das Chunk-Ziel. Der Zeichenpuffer wird dabei je Ebene und Region geleert und nur mit den Castern gefuellt, deren Schattenhuelle die Region tatsaechlich beruehrt – die Kosten haengen damit am sichtbaren Inhalt, nicht an der Gesamtzahl der Felsen. Ein Chunk startet deckend weiss, weil Weiss das neutrale Element von MULTIPLY ist; normales Alpha-Blending waere nicht gleichwertig, weil die Schattenfarbe nicht exakt schwarz ist.

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

Die Lightmap wird mit deckendem Ambient gefüllt und additiven Lichtquellen aufgebaut; das Composite verwendet MULTIPLY. Die Lichtberechnung ist über TimeOfDay parametrisiert, nicht über separate Tages-/Nachtpfade. Baumkronen liegen über dem Lightmap-Overlay und erhalten ihre eigene Tönung. Emissive Gameplay-FX und wichtige Telegraphen dürfen nicht versehentlich durch das Weltlicht unlesbar werden. Explosionslicht leitet seine Lebensdauer aus dem authored Explosionsradius ab (geklemmt auf einen allgemeinen Mindest-/Höchstwert); `visualStyle` bestimmt Farbe und Stil, keine Nuke-Sonderdauer.

Bei dynamischer Tageszeit folgt das laufende Shadow-Profil sofort den dynamischen Castern. Statische Tree-/Rock-Bakes halten dagegen ein eigenes tatsächlich gebackenes Profil und werden nur bei relevanter Abweichung gedrosselt vollständig ersetzt; ein gescriptetes Transitionsziel erzwingt den finalen Bake. Es werden nie zwei sichtbare MULTIPLY-Bakes alpha-gemischt. Regionale Rock-Dirty-Rebuilds bleiben ungedrosselt und rechnen während eines ausstehenden Profilwechsels mit dem gebackenen Profil, damit kein Chunk vorauseilt und kein alter Felsrand als Geisterschatten stehen bleibt.

DynamicTexture- und RenderTexture-Zeichenbefehle sind aufgeschoben. Wiederverwendete Graphics-/Image-Quellen dürfen nicht über mehrere Slots aliasen; Scratch-Ressourcen müssen vor dem Lightmap-Composite in der Display-Liste geleert sein. Eine Lightmap-/Occluder-Änderung über denselben Dirty-Trichter wie Combat-Hindernisse synchronisieren.

Kamerabewegung läuft über Scroll-Offsets der Hauptkamera. Der Feedback-Versatz muss vor der World-Light-/Shadow-Synchronisierung im Frame gesetzt werden, damit Welt, Lightmap und Occluder deckungsgleich bleiben. Statische Occluder über die gemeinsame Arena-/Light-Occluder-Quelle anmelden und beim Round-Teardown entfernen. Bewegliche Occluder bleiben außerhalb dieses Indexes: `LightingSystem` fragt sie über `DynamicLightOccluderSource` nur für budgetierte verdeckende Lichter ab; die Quelle filtert dabei exakt gegen den jeweiligen Lichtradius. `low` hat keine Occlusion-Slots und führt deshalb auch keine dynamischen Occluder-Abfragen aus.

## Post-FX und Displacement

CameraPostFxController/PostFxComposer bauen die Filterkette einmalig auf. Qualitätsprofile und Ereignisaktivität sind getrennt: ein erlaubter, aber gerade inaktiver Filter darf keinen neutralen Vollbildpass ausführen. Objektfilter und Kamera-Post-FX getrennt registrieren, damit Qualitätsdiagnose und Budgets korrekt bleiben. Additive Pulse-Felder werden mit ihrem Envelope-Gain skaliert; priorisierte absolute Overrides werden ebenfalls vom Basiswert zum Zielwert interpoliert, einschließlich kanalweisem Tint. Für längere atmosphärische Pulse/Afterglows ist der allgemeine `atmospheric`-Attack/Release-Envelope zu verwenden.

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
## Persistente Sprite-GPU-Weltobjekte

Arena-Felsen trennen vier Lebenszyklen: `RockGridIndex`/HP als Gameplay, nicht rendernde
`RockPhysicsProxy`-Zones mit Arcade-`StaticBody`, `RockVisualState` als rendererunabhaengige
Darstellungswahrheit und den jeweiligen Visual-Handle. Kein Gameplay-, Physics-, Overlay-,
Licht- oder VFX-Pfad darf ein Arena-Rock-`Image` voraussetzen. `RockDestructionRenderer` erhaelt
einen kleinen Snapshot aus dem Visual State; die Lobby darf denselben Vertrag aus ihrem
klassischen Body bilden.

`RockVisualSystem` konsumiert deduplizierte State-Aenderungen einmal in `PRE_RENDER` und schaltet
zwischen `classic` und `spriteGpu`. Der normale Arena-Default ist `spriteGpu`; `classic` bleibt als
Debug-/Fallback-Modus manuell zuschaltbar. Classic kapselt `RockLayerGrid`, Images und
`RockViewportCuller`. `PersistentGpuWorldSystem` besitzt ausschliesslich `SpriteGPULayer`-Pages
und GPU-Handles. Ein Wechsel im Performance-Menue baut nur diese Praesentation neu; Gameplay,
Grid und Physics-Proxies bleiben bestehen.

GPU-Pages benutzen `ArenaChunkGrid`, standardmaessig 512 px; 1024, 2048 und eine globale Page
sind Diagnosevarianten. Alle Pages und ihre Kapazitaeten entstehen beim Rendereraufbau und
werden danach weder wegen der Kamera erzeugt noch vergroessert. Die Kamera schaltet nur
Page-Sichtbarkeit im Prefetch-Rechteck. Eine 512-px-Page enthaelt 16 x 16 feste Zellslots;
`localY * 16 + localX` bleibt fuer Zerstoerung und Neubau stabil. Inaktive Slots haben Alpha und
Scale 0. Frame, vier Ecktints, Damage-/Owner-Mischung, Alpha und Scale kommen ausschliesslich aus
`RockVisualState`; Blob-Maske und 47-Frame-Auswahl bleiben CPU-seitig.

Aenderungen werden page-lokal als Member-Edits angewandt. Phaser teilt den Member-Buffer in 24
Segmente; ab zwoelf betroffenen Segmenten markiert der Prototyp die ganze Page fuer den Upload,
darunter bleiben die Segmentpatches sparse. Das Performance-Menue zeigt kumulierte Dirty Rocks,
Pages, Segmente, Sparse-/Full-Uploads und geschaetzte Bytes sowie Page-Sichtbarkeit und
Bufferbelegung. `GpuVfxSystem` bleibt davon getrennt: transient/emissionsgetrieben dort,
persistent/eventgetrieben hier (`tests/PersistentGpuWorldSystem.test.ts`).

## SpriteGPULayer-Partikel

`Phaser.GameObjects.SpriteGPULayer` traegt Partikel als Member mit GPU-Animationen; nach dem Spawn braucht ein Member kein CPU-Update. Das gesamte Backend liegt in `src/effects/gpu/`; ein Effektcontroller legt weder Layer noch Pool an und sieht keine Phaser-GPU-Interna mehr.

### Logischer Effekt und physische Render-Lane sind zwei verschiedene Dinge

Ein **logischer Effekt** (`GpuVfxEffects.ts`) traegt Semantik: Motiv, Qualitaetsklasse, Source-Lifecycle, eigene Zeile im Profiler. Eine **Render-Lane** (`GpuVfxRenderLanes.ts`) ist genau ein `SpriteGPULayer`. Mehrere Effekte duerfen sich eine Lane teilen, und derselbe Effekt darf je Variante die Lane wechseln. Ohne diese Trennung waechst die Layerzahl mit der Effektzahl – genau das verhindert die Architektur. Heute: 23 logische Effekte auf 14 Lanes.

Eine gemeinsame Lane setzt Gleichheit in allem *layerglobalen* voraus – Depth, Blend-Mode, Textur, Scroll-/Kamera-Verhalten, Lighting. Alles, was pro Member existiert (Position, Frame, Rotation, Scale, Alpha, Tint, Lebenszeit, Creation Time), ist kein Trennkriterium.

**Auch die Beschleunigung nicht.** `layer.gravity` ist zwar layerglobal, der Shader rechnet aber `uGravity * gravityFactor`, und `gravityFactor` liegt pro Member (`SpriteGPULayer.vert`; Phaser kodiert ihn in den Nachkommaanteil der Amplitude, `amplitude = floor(velocity) + (factor + 1) / 2`). Eine Lane deklariert deshalb die **staerkste** Beschleunigung ihrer Bewohner, alle uebrigen skalieren sie ueber `GpuVfxSpawnSpec.gravityFactor` herunter. Gebunden ist nur das Vorzeichen und der Bereich [-1, 1]; ausserdem muss `velocity` ganzzahlig bleiben, sonst frisst Phasers `Math.floor` den Nachkommaanteil, in dem der Faktor steckt. Das Bodenfeuer nutzt das mit -10, -18 und -36 px/s² auf einer Lane.

**Streckung und Farbverlauf liegen ebenfalls pro Member.** `scaleX` und `scaleY` sind zwei getrennte Animationsslots; `GpuVfxSpawnSpec.stretchStart`/`stretchEnd` legen deshalb einen Faktor auf die X-Achse des gemeinsamen Groessenverlaufs und ergeben zusammen mit `rotation` einen an der Stroemung ausgerichteten Streifen. Bei `1/1` teilen sich beide Achsen wie bisher *ein* Kurvenobjekt. Die vier Eckfarben eines Members sind dagegen statisch – der einzige Weg zu einem Farbverlauf ueber die Lebenszeit ist `tintBlend` (0 = unveraenderte, also weisse Textur, 1 = voller Tint); `tintBlendStart`/`tintBlendEnd` bilden das ab und laufen bewusst immer linear, weil jede andere Ease auf jeder moeglichen Lane vorgewaermt werden muesste.

Hinreichend ist Gleichheit im Layerglobalen aber nicht:

- **Zeichenreihenfolge.** Innerhalb einer Lane ist die Reihenfolge die Slot-Index-Reihenfolge, und Slots werden recycelt. Teilen duerfen sich eine Lane nur Effekte, deren gegenseitige Reihenfolge egal ist – oder die sich nie ueberlappen. Phasers ADD ist `[ONE, DST_ALPHA, ONE, DST_ALPHA]` und nur dort kommutativ, wo `dstAlpha` bereits gesaettigt ist, also ueber opaker Geometrie. Deshalb heisst die Policy im Manifest `add-over-opaque` und nicht `orderIndependent`: sie ist eine Ortsbedingung.
- **Co-Activity.** Eine Lane wird gezeichnet, sobald *irgendein* Effekt darauf lebt – mit `instanceCount = memberCount`. Ein selten aktiver Effekt zahlt dann die Kapazitaet aller Mitbewohner. `visibleFrames` und die paarweise Matrix `coVisibleFrames` im Profiler-Report messen das; `visibleFrames` allein reicht nicht, weil zwei Lanes gleich oft aktiv sein koennen, ohne je zusammenzufallen.
- **Lebenszeitspreizung.** Die laengste Lebenszeit bestimmt, wie lange ein Slot blockiert. `maxLifetimeMs` macht die Kapazitaet nachvollziehbar: `capacity >~ peakSpawnRate * maxLifetimeMs`.
- **Textur-weite Schalter.** `smoothPixelArt` haengt durch den geteilten Atlas an *einer* Textur fuer *alle* Lanes; ein Effekt kann es nicht mehr einzeln abwaehlen.

Jede Lane traegt im Manifest ihre `rationale` (warum sie nicht mit einer anderen zusammenfaellt) und ihre `capacityRationale`. `tests/GpuVfxRenderLanes.test.ts` laesst keine zwei Lanes mit identischen layerglobalen Eigenschaften zu.

### Die 13 Lanes

| Lane | Depth | Blend | Kapazitaet | Logische Effekte | Warum getrennt |
|---|---|---|---|---|---|
| `airstrike-spark` | `PLAYERS-1+ε` (9.001) | ADD | 1024 | `airstrike.spark` | eigenes Tiefenband unter den Spielern; die CPU-Spieler liegen zwischen dieser und der Bomb-Lane |
| `airstrike-bomb` | `PLAYERS+ε` (10.001) | ADD | 1024 | `airstrike.bomb` | eigenes Tiefenband ueber den Spielern; `layer.gravity = 30` ist layerglobal |
| `rocket-exhaust` | `PROJECTILES+ε` (15.001) | ADD | 2048 | `rocket.exhaust` | eigenes Tiefenband ueber den Projektilkoerpern, unter dem Accent |
| `rocket-smoke` | `FIRE` (16) | NORMAL | 640 | `rocket.smoke` | NORMAL bei Alpha 0.95: die Reihenfolge ist sichtbar, teilen darf sich die Lane niemand. Kapazitaet bildet den alten `maxAliveParticles: 640` nach |
| `stink-normal` | `STINK+0.02` (17.02) | NORMAL | 1280 | `stink.inner`, `stink.plume` (nicht-additive Varianten) | NORMAL-Blend, muss ueber dem Haze/Blob-Container auf 17.0 liegen |
| `stink-add` | `STINK+0.04` (17.04) | ADD | 3328 | `stink.inner`, `stink.plume` (additive Varianten), `stink.accent`, `stink.edge` | ADD ueber opakem Boden und damit reihenfolgeunabhaengig; getrennt von `stink-normal`, weil der Blend-Mode layerglobal ist |
| `flame-outer` | `FIRE` (16) | ADD | 3072 | `flame.outer` | eigenes additives Flammenband auf DEPTH.FIRE, unter Core und Spark |
| `flame-core` | `FIRE+0.05` (16.05) | ADD | 2304 | `flame.core` | eigenes additives Flammenband ueber Outer |
| `flame-spark` | `FIRE+0.1` (16.1) | ADD | 512 | `flame.spark` | eigenes additives Spark-Band ueber Core; `gravity = -30` |
| `ground-fire` | `ROCKS+0.2` (9.2) | ADD | 1536 | `groundfire.outer`, `groundfire.core`, `groundfire.spark` (je normal und void) | eigenes Tiefenband zwischen Felsen und Spielern; `gravity = -36`, die drei Motive skalieren sie ueber `gravityFactor` |
| `ground-fire-smoke` | `ROCKS+0.12` (9.12) | NORMAL | 128 | `groundfire.smoke` | einziger nicht-additiver Teil des Bodenfeuers, muss unter den Flammen liegen |
| `entity-burn` | `PLAYERS+0.23` (10.23) | ADD | 2048 | `entityburn.core`, `entityburn.outer`, `entityburn.spark` | eigenes Tiefenband ueber den Spielern; `gravity = -34` nur fuer die Funken |
| `projectile-burn` | `PROJECTILES+0.34` (15.34) | ADD | 2048 | `projburn.outer`, `projburn.core`, `projburn.spark` (je normal und void) | eigenes Tiefenband ueber den Projektilkoerpern; `gravity = -30`, Outer skaliert auf 0.8 |
| `world-debris` | `FIRE+0.075` (16.075) | NORMAL | 2048 | `leaf.debris`, `leafblower.dust` | gemeinsame geordnete Lane fuer Blaetter und Terrain-Staub; explizit zwischen FlameCore und FlameSpark |

Summe 23 040 vorgehaltene Member; der Instance-Buffer belegt damit rund 3,8 MB (Stride zur Laufzeit ueber `layer.getDataByteSize()`, aktuell 42 Words). Der Atlas ist 128×128 RGBA (64 KB) und traegt alle Motive; die Feuerfamilien teilen sich die vorhandenen Flame-Frames in beiden Stilen, dazu kommen `ground-fire-smoke`, `leaf-blower-dust` sowie die beiden Jet-Motive `flame-billow` und `flame-tongue`. Die Kapazitaeten der zusammengelegten Lanes sind bewusst die Summen der fruehreren Einzelpools; reduziert wird erst gegen gemessenes `peakLive`/`capacityDrops` aus dem Performance-Export, nicht gegen die Schaetzung. `entity-burn` ist dabei die erste Obergrenze ueberhaupt fuer diesen Effekt – vorher hatte jede brennende Entity drei eigene, unbegrenzte Emitter.

Im Tiefenband 16.8…17.2 liegt ausser der Stinkwolke nichts: 16.88 groundGlow, 16.92 damageAura, 16.96 reactionPulse, 17.0 Container mit Haze und Blobs, 17.02 `stink-normal`, 17.03 Spawn-Flash (ADD), 17.04 `stink-add`, 17.05 Spawn-Burst-Emitter (ADD), 17.1 Fairness-Kreis (ADD). **Dokumentierte Abweichung der Zusammenlegung:** die additive `inner`-Variante wandert von 17.001 auf 17.04 und kreuzt dabei `stink-normal`. Der Fehler ist das Produkt aus der plume-Partikelalpha (≤ 0.029) und dem additiven Beitrag, also ≤ 3 %, und tritt nur dort auf, wo sich Wolken *unterschiedlicher* Variante ueberlappen. `inner` und `plume` untereinander auf der NORMAL-Lane liegen bei ≈ 0.0016.

### Geteilter Atlas

`SpriteGPULayer` nimmt genau eine Textur ("must be sourced from a single image"). Solange jeder Effekt seine eigene mitbringt, ist die Textur ein Trennkriterium und Lane-Sharing unmoeglich. `GpuVfxAtlas.ts` blittet deshalb die bestehenden prozeduralen Texturen (aus `GpuVfxSourceTextures.ts`) pixelgenau in ein gemeinsames CanvasTexture und registriert Frames darin. Vier Regeln folgen direkt aus Phasers Quellcode:

- **`__void` (1×1 transparent) ist der erste eingefuegte Frame.** `Texture.add()` befoerdert den ersten Frame zu `firstFrame`, und `_setMemberData` faellt ohne `member.frame` auf `layer.frame` zurueck. Ohne `__void` waere der Default der *gesamte Atlas* – ein bildschirmfuellendes Quad pro vergessenem Frame. `firstFrame` nicht auf `__BASE` zuruecksetzen.
- **`member.frame` bekommt ein aufgeloestes `Frame`-Objekt**, nie eine Zahl: Phaser liest `frameDataIndices[frame.name]`, eine Zahl ergibt `NaN` im Buffer. `GpuVfxFrameId` ist eine eigene, stabile Manifest-Id und nicht Phasers interner Frame-Index.
- **Der Atlas muss vollstaendig sein, bevor die erste Lane entsteht** – `frameDataTexture` wird im Layer-Konstruktor gebaut. Er entsteht deshalb eager im `GpuVfxSystem`-Konstruktor und ist danach eingefroren; die `ensure`-Callbacks je Frame machen die Reihenfolge gegenueber den Renderern egal.
- **Zwei Pixel Padding und ein bit-exakter Blit**: `smoothPixelArt` klemmt den Tap auf `seam ± 0.5` Texel; `imageSmoothingEnabled = false`, `globalCompositeOperation = 'source-over'`, ganzzahlige Zielkoordinaten. Die Atlasgroesse steht nicht im Code, ein Shelf-Packer waehlt die kleinste passende Zweierpotenz.

Die Einzeltexturen bleiben bestehen – `stink_puff` benutzt weiterhin der klassische Spawn-Burst-Emitter.

### Ein Strahl aus einzelnen Hitboxen

Der Flammenwerfer ist netzseitig eine Kette einzelner Projektile, und die liegen weder aufeinander noch auf einer Linie: Waffenstreuung (8-12°), Spielerbewegung und Zielrichtungswechsel faechern sie auf. Wer jede Hitbox fuer sich zeichnet – egal wie dicht – bekommt deshalb parallele Einzelbahnen mit Luecken dazwischen. Die Platzierung, nicht die Partikelmenge, entscheidet ueber den zusammenhaengenden Strahl:

- **Verkettung.** Jede Hitbox kennt ihren Vorgaenger: die vorher abgefeuerte Hitbox derselben Quelle (`chainKey` = Turm- oder Spieler-Id, host- wie clientseitig aus dem Projektil). Emittiert wird gleichverteilt *in der Laenge* auf `[-Nachlauf, Bruecke zum Vorgaenger]`. Diese Strecke ist die tatsaechliche Verbindung zweier Kettenglieder und deckt Auffaechern, Strafen und Schwenks gleichermassen ab, weil sie aus echten Positionen entsteht statt aus einer Annahme ueber die Schussachse. Groesse, Alter und Flugrichtung interpolieren entlang der Bruecke, damit Breite und Farbe stetig ineinander laufen. Die Fenster benachbarter Hitboxen ueberlappen sich bewusst – so gibt es an den Kettengliedern keine Naht.
- **Kandidatenwahl.** Verkettet wird nur gegen die juengsten Hitboxen desselben Schluessels, mit Abstandsdeckel und nur, wenn der Kandidat nicht schon Vorgaenger einer anderen ist. Beides zusammen haelt zwei gleichzeitig feuernde Quellen desselben Besitzers (zwei Tuerme) auseinander und laesst keine Luecke doppelt oder gar nicht belegt.
- **Nachlauf.** Der Kopf der Kette und der erste Schuss einer Salve haben keinen Vorgaenger; sie zeichnen `speed * SMEAR_SECONDS` hinter sich, gedeckelt durch die tatsaechlich zurueckgelegte Strecke – sonst malte die erste Flamme in den Schuetzen. Als *Zeit* formuliert traegt sich das selbst: `velocityDecay` verlangsamt Abstand und Nachlauf im gleichen Mass.
- **Stroemung.** Partikel erben einen Anteil der Hitbox-Geschwindigkeit und streuen nur quer dazu (dreiecksverteilt, also dicht in der Mitte, mit dem Hitbox-Radius als Obergrenze). Ein reiner Auftrieb nach Norden – unabhaengig von der Zielrichtung – laesst denselben Effekt wie ein Lagerfeuer wirken.
- **Temperatur.** Der Tint kommt aus einem von drei Baendern, gewaehlt ueber das Alter der Flamme an der Stelle, an der das Partikel entsteht; `tintBlend` blendet ihn ueber die Lebenszeit aus Weissglut ein. Zufaellig aus *einer* Palette gezogene Tints ergeben Farbrauschen und damit die Lesart "Funkenflug".
- **Ausdehnung und Streckung.** Flammenballen wachsen ueber ihre Lebenszeit, verlieren dabei ihre Streckung und verblassen. An der Stroemung ausgerichtet und in ihre Richtung gestreckt ueberlappen sie entlang des Strahls, statt als runde Tupfen nebeneinanderzuliegen.
- **Licht.** Jede n-te Projektil-Id traegt ein Licht (`FLAME_LIGHT_ID_STRIDE`), zusaetzlich haengt an jedem `chainKey` ein Muendungslicht an der juengsten Hitbox: die Wurzel des Strahls ist sein hellster Punkt und darf nicht davon abhaengen, ob gerade eine passende Id faellt. Es wandert mit der Duese, statt beim Weiterruecken der Kette zu springen, und wird mit dem letzten Kettenglied freigegeben.

Die Jet-Frames `flame-billow` und `flame-tongue` sind bewusst **weiss**: erst dadurch ergibt der Multiply-Tint exakt die Temperaturfarbe, und dasselbe Frame traegt den normalen wie den Void-Stil. Die aelteren `TEX_FLAME_*`-Texturen behalten ihre eingebackene Farbe, weil Bodenfeuer, EntityBurn und Fireball auf ihnen stehen.

### Slot-Verwaltung: Ring-Cursor, kein Free-List

`GpuVfxPool.ts` vergibt Slots ab einem Ring-Cursor und ueberspringt belegte vorwaerts (Free-Bitset, Wortschritte per `Math.clz32`). Damit ist ein fragmentierter Pool `[live, free, free, live]` vollstaendig nutzbar, ohne dass Slot-Index ≈ Alter verloren geht. Beides haengt daran:

1. Der Submitter zeichnet `memberCount` Instanzen in Bufferreihenfolge – Slot-Index *ist* Zeichenreihenfolge. Eine LIFO-Free-List legte frische Member unter aeltere; bei `rocket-smoke` (NORMAL, Alpha 0.95) waere das sichtbares Flackern.
2. Der Instance-Buffer ist in 24 Segmente geteilt; hochgeladen wird je dirtyem Segment, und sobald alle belegten Segmente dirty sind, kippt der Submitter auf einen Vollupload. Aufeinanderfolgende Slots halten die Spawns eines Frames in ein bis zwei Segmenten.

Der Expiration-Sweep laeuft ueber eine dichte Liste der Lebenden (`liveSlots`/`slotPos`, Swap-Remove), nicht ueber ein Fenster oder die Kapazitaet. Je Quelle fuehrt der Pool eine intrusive doppelt verkettete Liste; `releaseSource()` ist damit O(Partikel dieser Quelle) statt O(Lane) – der Punkt, an dem die Architektur mit vielen Effekten auf einer geteilten Lane steht und faellt.

Der Source-Lifecycle steht im Effekt-Manifest: `kill-with-source` legt die Member beim Freigeben still, `linger` loest sie nur von der Quelle. Das Loesen ist kein Detail, sondern die Bedingung dafuer, dass Source-Indizes recycelt werden duerfen – ein spaeterer Besitzer desselben Index wuerde sonst fremde Member stilllegen. `clearSource()` raeumt eine langlebige geteilte Quelle ab, ohne ihren Handle aufzugeben (Rocket-Rauch beim Teardown).

**Die Emissions-Registry kennt kein Abmelden.** `registerEmission()` gilt fuer die Szene; ein Tick je Effektinstanz wuerde sich ueber die Sitzung ansammeln. Effekte, die pro Entity existieren, brauchen deshalb einen gemeinsamen scene-lifetime Controller, der einen Tick anmeldet und je Entity nur Zustand und eine Quelle haelt – so macht es `EntityBurnGpuController` fuer die brennenden Spieler und Gegner, deren `EntityBurnRenderer` nur noch Glow und Licht besitzt.

### Sichtbarkeit, Quality und Admission

Ein geprimter Layer zeichnet `memberCount` Instanzen, auch wenn kein Partikel lebt. `GpuVfxSystem` schaltet Lanes ohne lebende Member deshalb unsichtbar. Ablation und Idle teilen sich **einen** Resolver (`!suppressed && liveCount > 0`), geschrieben wird nur bei einem echten Wechsel; die Ablation gewinnt immer. Auch Spawns ausserhalb des Emissions-Ticks machen ihre Lane sofort sichtbar, sonst faellt das erste Partikel eines Bursts einen Frame lang aus. `layer.timeElapsed` haengt an `active`, nicht an `visible` – ein unsichtbarer Layer behaelt seine Uhr.

`GpuVfxQuality.ts` ist die einzige Stelle, die `GraphicsQualityController` konsumiert; `GRAPHICS_QUALITY_PROFILES` bleibt die Quelle der Wahrheit. Effekte konsumieren die Politik (`scaleFrequency` mit der Semantik von `applyEmitterProfile`, `scaleBurst` mit Bruchteil-Uebertrag je Effekt), statt sie aufgezwungen zu bekommen – die Scheduler-Semantik unterscheidet sich zu stark, als dass das Backend selbst Frequenzen setzen koennte.

Admission-Control ist eine rein logische Reserve auf `liveCount`: die letzten `reserveCritical` Slots nimmt nur `critical` an. Kein physisch reservierter Indexbereich (fragmentiert den Ring) und keine Auslastungsschwellen (haengen an der frei gewaehlten Kapazitaet und wuerden auf einer geteilten Lane fremde Effekte mitdrosseln). `qualityDrops` und `capacityDrops` werden getrennt gezaehlt, auf Lane- *und* Effektebene.

### Diagnose

`GpuVfxProfiler.ts` zaehlt auf zwei Ebenen, im Hotpath nur ueber TypedArray-Indizes: je Lane `capacity`, `active`, `highWaterMark`, `rearms`, `retirements`, `capacityDrops`, `utilization`, `visibleFrames`, `segmentsTouched`, `fullUploadFrames`; je logischem Effekt `spawnAttempts`, `spawns`, `qualityDrops`, `capacityDrops`. Beides landet im Performance-JSON (`ArenaPerformanceReport.summaries.gpuVfx`, `schemaVersion: 6`) und nicht nur im Live-Overlay. `highWaterMark`/Peak bleibt Summary-Diagnostik; ein aktiver Auslastungsmarker basiert ausschließlich auf der aktuellen Belegung `liveCount / capacity`. Sobald mehrere Effekte einen Layer teilen, beantwortet die Lane-Zeile allein nicht mehr, *wer* ihn fuellt.

### Fallen, die bleiben

`ParticleEmitter.setFrequency()` setzt `flowCounter = frequency` zurueck. Pro Frame aufgerufen kann der Zaehler nie unter null laufen, solange `delta < frequency` – der Emitter emittiert dann **nichts** und meldet sich erst bei Frames, die laenger dauern als sein Intervall. Frequenzen gehoeren deshalb entweder hinter eine Aenderungserkennung (so machen es EntityBurnRenderer, SmokeSystem und PlasmaChargeRenderer) oder direkt auf `emitter.frequency` geschrieben. **Beim Portieren eines Emitters immer erst pruefen, ob er im Ist-Zustand ueberhaupt emittiert.** Die vier StinkCloud-Familien tun es auf 60 fps nicht; `StinkCloudGpuParticles` bildet das mit `ParticleFlowScheduler.resetCountdown()` bewusst nach. Diese Sonderemission bleibt im Effektcontroller – das Backend bekommt nur fertige Spawn-Auftraege.

Der Tick liegt in `ArenaScene.update()` nach dem Host-/Client-Schritt, ein Spawn sieht also die Position aus *diesem* Frame. Ein klassischer `ParticleEmitter` emittierte an derselben Stelle eine Frame-Position spaeter, weil die `UpdateList` auf `SceneEvents.UPDATE` vor `scene.update()` laeuft.

Eine Member-Animation ist `base` plus `amplitude` als Delta ueber die volle `duration` – es gibt kein `from`/`to`. `loop` und `yoyo` defaulten auf `true` und muessen fuer One-Shots explizit `false` sein. `editMember()` ueberschreibt den Member vollstaendig; `creationTime` defaultet auf `layer.timeElapsed`. Eine abgelaufene One-Shot-Animation haelt **nicht** auf ihrem Endwert: bei `loop:false` extrapoliert die lineare Kurve unbegrenzt weiter, und die Tint-Stufe clampt die Alpha nicht – unter ADD verdunkelt ein abgelaufener Member die Szene aktiv, bei wachsendem Quad. Der Pool legt sie deshalb per `patchMember()` mit vorbereiteter Nullmaske auf `scaleX`/`scaleY`/`alpha` still, ebenso beim Ruecksprung von `layer.timeElapsed` (`timeElapsedResetPeriod`, eine Stunde).

Nicht-lineare Eases brauchen `gpuVfxEasedBase()`: der Shader addiert bei `loop: false` ueber die gesamte Laufzeit `floor(amplitude) * amplitude` – ein Term fuer die Frame-Index-Animation, der jede andere Groesse verfaelscht und schon ab Amplitude ±1 greift. Eine Alphakurve 0.95 → 0 auf `Quad.easeOut` kaeme sonst als 1.9 → 0.95 heraus. `Linear` ist davon nicht betroffen. Das Backend wendet die Korrektur genau dann an, wenn die Ease nicht linear ist; Effektcontroller sehen sie nicht mehr.

Jeder erstmals verwendete Ease-Typ laesst Shader und FrameData neu bauen. Die Lane deklariert deshalb ihre Eases, das Backend waermt sie bei der Initialisierung ueber `setAnimationEnabled()` vor – mit den Namen aus Phasers Rueckwaertsabbildung `EASE_CODES`. Die Menge bleibt bewusst klein (`Linear`, `Quad.easeOut`, `Gravity`); ein weiterer Typ kommt erst dazu, wenn ein migrierter Effekt ihn wirklich braucht. Fuer Gravity gilt `gravityFactor: 1` plus `layer.gravity` als Beschleunigung in px/s²; `velocity` wird ganzzahlig kodiert.

GPU-Member liegen nicht als `ParticleEmitter` in der Display-Liste: `PerformanceAblation` und `ArenaRuntimeProfiler` erfassen sie nur ueber explizite Hooks, nicht ueber den generischen Scan.

### Was bewusst klassisch bleibt

Die Stinkwolke ist ein Hybrid und bleibt es: Haze, Blobs, Ground Glow, Damage Aura, Reaction Pulse, Fairness-Kreis, Electric Bolts, Lighting und der Spawn-Burst laufen unveraendert auf der CPU. Noch nicht migriert (kuenftig reine Consumer derselben Infrastruktur): Flame, EntityBurn, Hydra, Spore, BFG, PlasmaCharge, EnergyShield, Tesla, Slime, PowerUp. Dauerhaft klassisch bleiben Effekte mit echter laufender CPU-Simulation – `GravityWell` (BlackHole), eigene `ParticleProcessor` (Flammenring-Turbulenz), dynamische Kollisionen und Per-Frame-Tracking eines einzelnen Partikels.
