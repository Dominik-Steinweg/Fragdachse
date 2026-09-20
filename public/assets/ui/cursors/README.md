# Badger cursors

Created with the built-in Imagegen tool. Exact prompts and export settings are in
[prompts.json](prompts.json). The source PNGs retain the generated transparency;
the game uses only the two 48 x 48 PNGs. Both use hotspot `(8, 6)` at the nose.
Default is the selected Wild Bruiser (variant 5 from `art/cursor-variants`): a
broad, rugged badger head with black-white stripes, bristled fur and fierce amber
eyes. Button hover retains the same head with orange eyes, warm fur highlights
and a strong orange-gold contour for a clear change at cursor size.

Re-export from the repository root:

```sh
node --input-type=module -e 'import sharp from "sharp"; for (const v of ["default", "hover"]) { const p = "public/assets/ui/cursors/badger-" + v; await sharp(p + "-source.png").resize(48,48).png().toFile(p + ".png"); }'
```

The native cursor stays hidden wherever the existing aim presentation hides it.
Button consumers share `src/ui/gameCursor.ts`; disabled controls retain their
existing interaction policy.
