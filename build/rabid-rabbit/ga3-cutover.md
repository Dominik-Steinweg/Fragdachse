# Rabid Rabbit – GA3 Produktion + Schatten-Mesh (fertig, nicht importiert)

Asset-Branch `rabid-rabbit-asset` (Worktree `C:/Fragdachse/.claude/worktrees/kind-williams-9b398f`), Commits:
f7f35780 A1 · 5df5c4a2/71a4a90e GA1-Runden · e7206ee1 GA1 entschieden · e2b06110 GA2 · GA3-Stand siehe `git log`.

## Ergebnis
- Produktion `rr-v1-r2` (ersetzt `rr-v1-r1`, das zuerst ausgewählt wurde: dessen Fellmaterial trug eine eigene Oberflächenmarke,
  die Materialpässe konnten es nicht entleuchten, und der Glow-Ausschlag lag auf der Emissionsstärke, die der Emissionspass
  auf Ruhe einfriert; r2 skaliert stattdessen die Emissionsfarbe): `art/poc/pipeline-v2/runs/rr-v1-r2/rabid-rabbit` (standard, 128 px ausgewählt,
  source-bundle.zip archiviert); Kopie samt Review-JSON unter `D:/Fragdachse-render/rabid-rabbit/runs/rr-v1-r2/rabid-rabbit`
  (Bundle-Hash identisch geprüft).
- 71 Posen: rest 0 · move 1–10 (24 fps, loop) · claw 11–22 (24 fps, strike 5, impact 7) · windup 23–34 (18 fps, loop) ·
  leap 35–54 (24 fps, launch 5, land 13) · idle 55–70 (12 fps, loop). targetSize 22, displayScale 2,4, sourceSize 128,
  orthoScale 6,2 (Canvas 52,8 Welt-px, 8,52 px/BU).
- eyeAnchors Version 1 auf allen 71 Frames (Hauptpaar). Socket `mouth`. Emission: violette Ohrspitzen (in Ruhe nur die Spitzen,
  in Bewegung bis fast zur Ohrwurzel – im Beauty eingebacken, im Emission-Pass des Meshes getrennt).
- Blend-Verifier `tests/assets/verify_asset_pipeline_v2.py`: 9/9 bestanden inkl. CPU-Reopen-Render Frame 45.
- Emissionspass animiert: eine im Szenenkontext zugewiesene Materialkopie wertet Gain und Reichweite pro Frame aus
  (Windup-Frame: Gain 1,69, Reichweite 0,94), der Ingame-Glow trägt also das Aufflammen und das Kriechen zur Ohrwurzel.
- Schatten-Mesh `enemy-mesh-rr-v1-r2`: `art/poc/pipeline-v2/enemy-mesh/enemy-mesh-rr-v1-r2/rabid-rabbit`,
  Status reviewed-not-imported, 2000 Vertices / 3914 Dreiecke, 71 Posen, Silhouetten-IoU min 0,984 (fein 0,985) über 5751 Samples,
  Archiv r4-source-bundle.zip (1153 Member) verifiziert; Kopie ohne Zwischenstände unter
  `D:/Fragdachse-render/rabid-rabbit/enemy-mesh/enemy-mesh-rr-v1-r2/rabid-rabbit`.
  Pässe Beauty/Albedo/Normal/Emission geprüft: Albedo unbeleuchtet, Emission animiert (Ruhe nur Spitzen, in Bewegung fast das ganze Ohr). Fell-Locken an der Kontur sind `meshShadowDetail` (nur Beauty),
  Ohren je eigene `meshUnionGroup` (zweigliedrig: ear_<s> + ear_<s>_tip), Beine je Segment, Schwanz, Kiefer, Nagezähne.
  Kontakte front_left/front_right/rear_left/rear_right über die `<leg> broad paw`-Meshes.

## Cutover im Code-Worktree C:/Fragdachse-worktrees/rabid-rabbit (Reihenfolge)
1. Asset-Branch übernehmen: `git merge rabid-rabbit-asset`
   Konfliktkandidaten: Motion-Dispatch in `motions_v2.py`, `motionModule` in `draft-v2.mjs`, Reload-Liste in
   `blender_pipeline_v2.py`, Motion-Whitelist in `tests/assets/AssetPipelineCatalog.test.ts`, Dispatch-Zeile im
   `scripts/asset-pipeline/README.md`, falls dort parallel geändert. Der importierte draft-c-Registryeintrag
   `src/config/pipelineAssets/assets/rabid-rabbit.json` wird in Schritt 3 überschrieben.
2. gameIds umbinden: `scripts/asset-pipeline/catalog-v2/assets/rabid-rabbit.json` → `"gameIds": ["rabid-rabbit"]`;
   im alten Katalogeintrag `rabid-badger.json` die Game-ID entfernen (oder das alte Asset samt Runtime-Dateien löschen),
   damit AssetPipelineCatalog jede Gegner-ID genau einem Asset zuordnet.
3. Runtime-Import (liest die Auswahl direkt aus dem Asset-Worktree; `--run-root` = Revisionsordner):
   `node scripts/asset-pipeline/import-runtime.mjs rr-v1-r2 rabid-rabbit --run-root C:/Fragdachse/.claude/worktrees/kind-williams-9b398f/art/poc/pipeline-v2/runs/rr-v1-r2`
   (gleichwertig mit der D:-Kopie: `--run-root D:/Fragdachse-render/rabid-rabbit/runs/rr-v1-r2`)
4. Schatten-Mesh: der Import liest nur das eigene `art/poc` → den versiegelten Ordner ohne Zwischenstände kopieren:
   `robocopy C:\Fragdachse\.claude\worktrees\kind-williams-9b398f\art\poc\pipeline-v2\enemy-mesh\enemy-mesh-rr-v1-r2\rabid-rabbit C:\Fragdachse-worktrees\rabid-rabbit\art\poc\pipeline-v2\enemy-mesh\enemy-mesh-rr-v1-r2\rabid-rabbit /E /XD intermediate pass-cache /XF *.log`
   `node scripts/asset-pipeline/enemy-mesh-selected-mesh.mjs import rabid-rabbit enemy-mesh-rr-v1-r2`
   (prüft Registry-Revision rr-v1-r2 + 71 Frames aus Schritt 3, Archivquittung und alle Member-Hashes)
5. `npm run assets:runtime`
6. Alte rabid-badger-Runtime-Dateien entfernen (falls ersetzt), danach `npm run test:assets`.

## Hinweise
- Leap ohne eingebackene Skalierung: Höhe nur über carriage Z; die Runtime streckt die Segmente (Kauern 0–5, Flug 5–13,
  Landung 13–19) über `leapClipFrame`.
- Ohren und Kopf bewegen sich in jedem Clip; das Void-Leuchten ist pro Pose animiert (Stärke, Reichweite, Flimmern).
  Im Emission-Pass liegt es getrennt vom Fell, nachts bleibt der Wertkontrast Körper ↔ Ohr-Glow hoch.
- Tests im `.claude`-Worktree: `npm test`/`npm run test:assets` schließen `.claude/**` aus; dort direkt
  `node node_modules/vitest/vitest.mjs run --pool=threads --exclude "build/**" --exclude "art/**" --exclude "node_modules/**" tests/assets`.
