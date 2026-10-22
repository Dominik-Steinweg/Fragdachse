# Spawnbauwerk der Gegner (Brutkadaver) – GDD V1

Stand: 2026-10-22, umgesetzt auf dem Branch `spawn-structure`. Maßgeblich ist der Code.

## Idee

Jeder feindliche Spawnort, den Spieler zerstören können, ist in allen Modi dasselbe Bauwerk: der **Brutkadaver**.
Es ist das verwitterte Skelett eines eingerollten Drachen. In seiner Mitte liegt ein Brutnest, aus dem die Gegner
aufsteigen. Bisher sah ein solcher Spawnort in der Kampagne wie Panzerplatten mit einem Fadenkreuz aus und in Dawn
wie ein runder Eiersack. Keine der beiden Darstellungen zeigte, wo die Hitbox liegt und wo die Gegner herauskommen.

Das Bauwerk soll:
- klar lesbar sein: Knochen sind Hindernis und Ziel, das Nest ist der Spawnpunkt;
- einen Spawn sichtbar ankündigen;
- nicht mit einem Portal zu verwechseln sein.

## Spielregeln

- **Grundriss:**
  - 6 × 6 Zellen in einer von vier Ausrichtungen ([`src/config/spawnStructure.ts`](../../src/config/spawnStructure.ts)).
  - Nur die 20 Knochenzellen haben eine Hitbox. Das Asset ist auf sie gebaut: Schwanz und Klauen bleiben auf
    ihren Zellen, die langen Querfortsätze der Schwanzwirbel überspannen sie. Nur Rippenspitzen ragen leicht darüber hinaus.
  - Das Brutnest (2 × 3 Zellen) ist begehbar und hat keine Hitbox. Spieler können darauf nicht bauen.
  - Es öffnet sich über zwei Zellen zwischen Schwanz und Schädel. Die Öffnung zeigt zur verteidigten Basis.
- **Spawn:**
  - Gegner steigen in der Nestmitte auf. Es gibt keinen Teleport mehr nach außen.
  - Mehrere Gegner desselben Takts kommen 300 ms nacheinander und liegen quer zur Öffnung leicht versetzt.
  - Ein Bauwerk gibt nur Gegner bis 56 px Durchmesser frei, damit sie durch die Öffnung passen.
- **Ankündigung:**
  - Vor jedem Spawn lädt das Bauwerk 2 s sichtbar auf (`SPAWN_ZONE_ALERT_LEAD_MS`), auch vor dem ersten nach der
    Aktivierung.
  - Die Ankündigung läuft über den Zonenalarm `csz` mit `structure: true`. Das Peer-Protokoll steigt dafür auf 48.
- **Zerstörung:**
  - Das Skelett zerplatzt als Knochenexplosion. Danach verblasst der Fleck weich, und der Boden ist frei.
  - Feuerbrocken und Bodenfeuer der übrigen Basen entfallen; es bleibt der Knall.

## Darstellung

- **Grundsatz:** Nichts erinnert an ein Portal: kein leuchtender Ring, keine Drehung, kein Partikelstrom, kein
  durchsichtiger Zielboden.
- **Assets:**
  - Das Skelett ist ein Blender-Modell. Es wird senkrecht von oben gerendert, mit fester Sonne und einem Bild je
    Ausrichtung.
  - Die Pipeline steht in [`scripts/asset-pipeline/spawn-carcass/`](../../scripts/asset-pipeline/spawn-carcass/README.md).
- **Boden:**
  - Der Boden ist ein organischer, ausgefranster Fleck. Er läuft entlang der Knochen aus und wird nach außen
    transparent, sodass er in den Kartenboden übergeht.
  - Im Fleck wachsen weder Bodenpflanzen noch Grasflecken. Der Radius beträgt 4,6 Zellen um die Nestmitte.
- **Nest:**
  - Brutschleim mit Eiern und Wucherungen, mattes violettes Durchscheinen.
  - Ein GPU-Pass (`BroodPitGpuLayer`) zeigt das Atmen, die Wölbung über einem aufsteigenden Körper und das Aufreißen,
    wenn der Körper durchbricht.
- **Augen:**
  - Im Asset glimmt nur eine dunkle Glut.
  - Im Spiel leuchten die Augen als tiefviolette Schlitze. Sie atmen, flackern und blinzeln. Beim Aufladen glühen sie
    auf.
- **Herzschlag:** Nestglühen und Nestlicht pulsieren in einem langsamen Doppelschlag. Beim Aufladen rast er.
- **Licht:** Das Nestlicht deckt ein großes Feld ab und wächst beim Aufladen; nachts ist es ein bedrohlicher
  violetter Lichtkegel.
- **Brutsporen:** Leuchtende violette Sporen steigen stetig aus dem Nest auf, beim Aufladen eine dichte Wolke.
  Sie pulsieren mit dem Herzschlag, und die hellsten werfen nachts Licht auf Knochen und Boden. Sie verteilen sich
  ohne Richtung und bilden keinen Strom wie beim Portal.
- **Owner:**
  - `SpawnStructureRenderer` gehört zur World und wird über den `BaseManager` erzeugt. Damit zeigen auch eine World
    ohne Activity und die World nach der Runde das Bauwerk.
  - Die Activity schiebt nur Ankündigungen und das Auftauchen der Gegner hinein.

## Kampagne und Dawn

- **Map 13 „Brutbomben“:** vier Brutkadaver.
- **Map 17 „Bierrettung“:** zwei Brutkadaver.
- **Dawn:** Der Archetyp `brood-nest` stellt einen Brutkadaver auf. `resolveDawnSiteStructurePlacement` dreht ihn
  zur persistenten Basis. Den früheren organischen Fleck unter dem Dawn-Nest liefert jetzt das Bauwerk selbst.

## Abweichungen vom ersten Plan

Geplant war zuerst ein U aus Stein und Eisen mit 4 × 3 Zellen. Nach mehreren Konzeptrunden fiel die Wahl auf den
Brutkadaver. Das Nest ist dadurch 2 × 3 statt 2 × 2 Zellen groß. Statt Schadens- und Trümmerbildern gibt es die
Knochenexplosion zur Laufzeit.

## Offen

- Spieltest in Kampagne und Dawn, auch mit einem Client.
- Ein Sound für die Knochenexplosion. Bisher spielt der vorhandene Basis-Explosionsknall.
