# Light Mode Improvement for Dark-Only Sites

## Problem

Dark Reader's Light mode (`theme.mode === 0`) produces muddy, low-contrast results on dark-only websites. The root cause is the `modifyLightModeHSL` function in `src/inject/dynamic-theme/modify-colors.ts`, which uses a linear lightness remap that compresses dark-site colors into a narrow light band.

## Goal

Improve Light mode output on dark-only sites to produce a paper/cream-toned result with good contrast, by modifying the existing `modifyLightModeHSL` function.

## Approach: Non-linear lightness curve with warm tinting

### 1. Lightness Remapping

Replace the linear `scale(l, 0, 1, poleFg.l, poleBg.l)` with a gamma-corrected version:

```
adjustedL = l ^ LIGHT_MODE_GAMMA
lx = scale(adjustedL, 0, 1, poleFg.l, poleBg.l)
```

`LIGHT_MODE_GAMMA ≈ 0.55` (gamma < 1 expands the dark end of the spectrum).

Example mappings:
- `l = 0.05` → `adjustedL = 0.16` (dark background)
- `l = 0.15` → `adjustedL = 0.32` (dark border)
- `l = 0.30` → `adjustedL = 0.49` (mid element)

This spreads dark-site colors across the light range instead of bunching them together, preserving contrast.

### 2. Warm Tinting for Paper/Cream Tone

For neutral colors being lightened, inject a subtle warm hue:

- `LIGHT_MODE_WARM_HUE ≈ 40` (amber/cream range)
- Saturation floor of `0.08` to prevent pure gray output
- Only applies to neutral colors — saturated colors (buttons, links, accents) keep their original hue and saturation

Dark neutral backgrounds (`#1a1a1a`, `#222`, `#2d2d2d`) become warm cream/paper tones. Colored elements stay colored.

## Scope

### Files changed

- `src/inject/dynamic-theme/modify-colors.ts` — modify `modifyLightModeHSL`, add two constants

### What changes

1. Replace `scale(l, 0, 1, ...)` with `scale(l ** LIGHT_MODE_GAMMA, 0, 1, ...)`
2. Add warm hue injection for neutral colors: shift hue toward `LIGHT_MODE_WARM_HUE` with saturation floor of `0.08`
3. Two new constants: `LIGHT_MODE_GAMMA` (0.55) and `LIGHT_MODE_WARM_HUE` (40)

### What doesn't change

- No new files
- No changes to the caching pipeline, theme type, pole system, or any other function
- Dark mode (`theme.mode === 1`) is completely untouched
- Existing neutral detection thresholds stay as-is

## Testing

- Existing inject tests must still pass (they cover Light mode color transformations)
- Manual testing on dark-only sites to verify paper/cream output with good contrast
