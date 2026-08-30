# Lumen Field demo art

The account, campaign, performance figures, captions, destinations, automation
flows, and all visual covers in this directory are fictional portfolio fixtures.
Nothing represents a real customer, social account, brand partnership, or person.

## Cover provenance

`campaign/*.svg` is an original, programmatic editorial illustration set authored
for this Social Cockpit demo. The source generator is
[`../make_campaign_assets.mjs`](../make_campaign_assets.mjs). It uses only SVG
geometry, gradients, and procedural texture; it contains no downloaded imagery,
recognisable logo, real face, stock asset, or remote dependency.

| Assets | Treatment |
| --- | --- |
| `portrait-*.svg`, `people-rain.svg` | Fictional abstract figure studies |
| `studio-*.svg`, `process-*.svg`, `material-table.svg` | Fictional studio/process studies |
| `city-*.svg` | Fictional location and everyday-life studies |
| `product-*.svg` | Fictional object/packaging studies |
| `editorial-*.svg` | Original campaign punctuation cards |

The app serves these files only from the local portfolio mock during screenshot
capture. They may be regenerated with:

```sh
node docs/portfolio/demo/make_campaign_assets.mjs
```
