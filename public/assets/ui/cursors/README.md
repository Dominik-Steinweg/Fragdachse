# Badger cursors

Created with the built-in Imagegen tool. Exact prompts and export settings are in
[prompts.json](prompts.json). The source PNGs retain the generated transparency;
the game uses only the two 48 x 48 PNGs. Both use hotspot `(10, 8)` at the leading
claw tip. Both have five short toes, dark horn claws and compact short fur.
Button hover gently spreads the toes and brightens the silver fur highlights.

Re-export from the repository root:

```sh
node --input-type=module -e 'import sharp from "sharp"; for (const v of ["default", "hover"]) { const p = "public/assets/ui/cursors/badger-" + v; await sharp(p + "-source.png").resize(48,48).png().toFile(p + ".png"); }'
```

The native cursor stays hidden wherever the existing aim presentation hides it.
Button consumers share `src/ui/gameCursor.ts`; disabled controls retain their
existing interaction policy.
