# Fog/Rock R1: Kontakt und Sonnenschatten im Nebel

Nur optische Abdunklung: der bestehende Fog-Surface-Pass packt Coverage (R),
Residency (G), Radiance-Retention (B) und Basen (A). Fog-Display multipliziert
ausschliesslich RGB nach der Beleuchtung. Alpha, Waffenspuren, Depths,
alte Bodenschatten und ADD-/Scene-Alpha-Verhalten bleiben unveraendert.

FormationCoverageBinding leiht zusaetzlich Occlusion, Sonnenhorizont-Historie
und Lichtparameter unter derselben Reparaturbarriere wie die Silhouette.
Worker-only-Reparaturen geben bis zur Publikation keine alten Daten frei;
GPU-Reparaturen verwenden die synchron reparierten Felder.
Kontakt verwendet aktuelle Occlusion unabhaengig von Sonnenstaerke und
Horizon-Quality. Low erhaelt Kontakt, aber keine Sonnenabschattung.
Fehlende Bindung/Residency liefert den neutralen Retentionsfaktor 1.

Kein neuer Pass, keine weitere Rendertextur. Der Surface-Pass nutzt fuenf
Sampler; Material und Display behalten ihr bisheriges Samplerbudget.
Die Headless-Pruefung testet Bindings fuer acht und sechzehn Texture-Units;
GLSL-Ausfuehrung und Bildwirkung sind ohne Browser nicht verifiziert.

## Live-A/B am Lobby-Schriftzug

Frischen isolierten Dev-Tab ohne Szenario-Hash oeffnen:
http://127.0.0.1:8090/dev-scenario.html
Nach dem Lobby-Reveal noch kein Szenario starten. Die normale Lobby-Ansicht
zeigt den authored Schriftzug; bei Bedarf das Panel einklappen.
renderDebug erlaubt hier World-Diagnose ohne eine Activity zu erzeugen.
whenReady() wartet dagegen auf ein gestartetes Szenario und ist hier unpassend.

~~~js
const dev = window.devScenario;
dev.run({action:'panel',collapsed:true});
dev.run({action:'renderDebug',disable:[],lobbyTimeOfDay:480}); // 08:00
dev.run({action:'renderDebug',disable:['fogRockContact','fogRockSunShadow']}); // A: vorher
dev.run({action:'renderDebug',disable:['fogRockSunShadow']}); // Kontakt allein
dev.run({action:'renderDebug',disable:['fogRockContact']}); // Sonne allein
dev.run({action:'renderDebug',disable:[]}); // B: beide, Standardstaerken
dev.run({action:'renderDebug',disable:[],lobbyTimeOfDay:720}); // 12:00
dev.run({action:'renderDebug',disable:[],lobbyTimeOfDay:0}); // Nacht
dev.run({action:'renderDebug',disable:[],fogRockContactStrength:.18,fogRockSunShadowStrength:.08});
~~~

Alle Antworten auf ok pruefen. Staerken: 0 bis 0.5, Standards .22/.10
in src/effects/groundFog/FogRockLighting.ts. Jeder renderDebug-Aufruf ohne
Staerken setzt diese auf Standard zurueck; die disable-Liste gilt jeweils
vollstaendig. lastAction.fogRockLighting meldet die konfigurierten Staerken;
Low und Nacht unterdruecken zusaetzlich den Sonnenanteil.
Ein neuer Szenariostart oder Teardown setzt optische Overrides zurueck.

Der Lobby-Befehl fixiert die Tagesminute, nicht Nebelphase oder Kamerazeit:
dies ist kein Frame-Replay und kein neues Zwei-Felsen-Fixture.
Fuer den Vergleich Viewport/DPR/Kamera und Quality beibehalten, nach
Zeitwechsel Nebeldichte und Worker konvergieren lassen. Einen Bankkern und
einen klaren Felsen im selben Bild vergleichen. Danach High/Low, Nacht,
Waffenspuren und Zerstorung an Chunkgrenzen im regulaeren Dev-Szenario pruefen.
Erwartung: weicher Fuss ohne schwarzen Graben, unveraenderte Blockadensilhouette,
keine alten Schatten nach Zerstoerung. Kein Browser wurde hier gestartet.

## Pruefung und Testpatch

build/fogrock-r1-tests.patch enthaelt nur die Testaenderungen dieser Runde.
Vor dem regulaeren Testlauf anwenden; die kanonischen Tests wurden nicht editiert.
87 Tests mit den Erweiterungen in einer temporaeren build-Kopie bestanden,
zusaetzlich 84 vorhandene Fog-/Formation-/Sun-Tests. npm run build bestanden
(mit Font-Aufloesungs- und Chunkgroessen-Warnungen); Patch- und Diff-Pruefung bestanden.
