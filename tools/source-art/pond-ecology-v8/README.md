# lilies: active authored sources

Built-in ImageGen, September 2026. Only the selected sources below are runtime inputs. Authored alpha and orthographic overhead appearance are retained. Recipes, sizes and source hashes are recorded in `public/assets/environment/woodland/ecology/lilies.json`.

- [lily-group-01.png](lily-group-01.png)
- [lily-group-02.png](lily-group-02.png)
- [lily-pad-01.png](lily-pad-01.png)
- [lily-pad-02.png](lily-pad-02.png)
- [lily-pad-03.png](lily-pad-03.png)

## Export

`node scripts/export-woodland-ecology-v8.mjs` writes the atlas and manifest. No per-frame images or review sheets are delivered. Native source canvases remain available for editing.

## Generation prompts

### lily-group-01

```text
Use case: stylized-concept. Generate ONE production source sprite, 1024x1024 or larger, true transparent RGBA background. Orthographic exact 90-degree overhead view of a natural loose group of five floating water-lily leaves, asymmetrical arrangement, one tiny closed dusty-pink bud. Painterly realistic forest arena game art, dark rich muted greens and teal greens, no bright yellow highlights. Designed to integrate on dark turquoise water #18524f and #062b31 and muted forest floor. Flat diffuse ambient illumination, ONLY local self-occlusion, NO directional lighting, NO cast shadow outside the plant, NO water or ground painted behind it. Broad recognizable notched leaf silhouettes, subtle organic imperfections, soft natural edges without halos. Entire object within central 80 percent of canvas, minimum 8 percent fully transparent margin on all four sides. Readable at 40 to 160 px. No text, no watermark, no repeating pattern. Candidate lily-group-01.
```

### lily-group-02

```text
Use case: stylized-concept. ONE isolated production source sprite for Fragdachse forest game. True transparent RGBA canvas at least 1024 pixels longest side. EXACT ORTHOGRAPHIC 90 DEGREE OVERHEAD, looking vertically down, no side view, no perspective. Painterly realistic natural organic plant texture, DARK rich muted forest greens, teal green, dark olive; low contrast. Diffuse neutral ambient illumination ONLY, no baked directional light, no bright rims, no specular glints. Only LOCAL self-occlusion, absolutely NO exterior cast shadow, no ground or water background. Soft finely irregular organic edges, no halos or color fringes. Minimum 10% completely transparent margin on ALL four edges, nothing clipped. Strong natural readable silhouette at 40, 80,160 pixel display size, no text, no watermark, no repetition.
Subject: Three rounded notched water-lily pads in an open triangular loose group, no flowers, deep bottle greens, little overlap.
```

### lily-pad-01

```text
Use case: stylized-concept. ONE isolated production source sprite for Fragdachse forest game. True transparent RGBA canvas at least 1024 pixels longest side. EXACT ORTHOGRAPHIC 90 DEGREE OVERHEAD, looking vertically down, no side view, no perspective. Painterly realistic natural organic plant texture, DARK rich muted forest greens, teal green, dark olive; low contrast. Diffuse neutral ambient illumination ONLY, no baked directional light, no bright rims, no specular glints. Only LOCAL self-occlusion, absolutely NO exterior cast shadow, no ground or water background. Soft finely irregular organic edges, no halos or color fringes. Minimum 10% completely transparent margin on ALL four edges, nothing clipped. Strong natural readable silhouette at 40, 80,160 pixel display size, no text, no watermark, no repetition.
Subject: One single round dark teal-green water-lily pad with a characteristic deep V notch and subtle radial veins.
```

### lily-pad-02

```text
Use case: stylized-concept. ONE isolated production source sprite for Fragdachse forest game. True transparent RGBA canvas at least 1024 pixels longest side. EXACT ORTHOGRAPHIC 90 DEGREE OVERHEAD, looking vertically down, no side view, no perspective. Painterly realistic natural organic plant texture, DARK rich muted forest greens, teal green, dark olive; low contrast. Diffuse neutral ambient illumination ONLY, no baked directional light, no bright rims, no specular glints. Only LOCAL self-occlusion, absolutely NO exterior cast shadow, no ground or water background. Soft finely irregular organic edges, no halos or color fringes. Minimum 10% completely transparent margin on ALL four edges, nothing clipped. Strong natural readable silhouette at 40, 80,160 pixel display size, no text, no watermark, no repetition.
Subject: One small youthful oval water-lily pad, deep forest green, narrow notch, natural asymmetry.
```

### lily-pad-03

```text
Use case: stylized-concept. ONE isolated production source sprite for Fragdachse forest game. True transparent RGBA canvas at least 1024 pixels longest side. EXACT ORTHOGRAPHIC 90 DEGREE OVERHEAD, looking vertically down, no side view, no perspective. Painterly realistic natural organic plant texture, DARK rich muted forest greens, teal green, dark olive; low contrast. Diffuse neutral ambient illumination ONLY, no baked directional light, no bright rims, no specular glints. Only LOCAL self-occlusion, absolutely NO exterior cast shadow, no ground or water background. Soft finely irregular organic edges, no halos or color fringes. Minimum 10% completely transparent margin on ALL four edges, nothing clipped. Strong natural readable silhouette at 40, 80,160 pixel display size, no text, no watermark, no repetition.
Subject: Two small floating lily pads, one half the size of the other, bottle green, airy separation.
```
