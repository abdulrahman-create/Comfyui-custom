# Composer FX - adjustment math (single source of truth)

All math runs on sRGB values in float **0..1**, per channel `c = (r,g,b)`, unless noted
"spatial" (reads neighbours) or "coord" (uses pixel x,y). Luma weights are Rec.709:
`L = 0.2126*r + 0.7152*g + 0.0722*b`. NO intermediate clamping - the processed result is
clamped to 0..1 once, just before the Amount blend. Pipeline order is fixed regardless of UI
order.

Implemented identically by `js/composer/fx_engine.mjs` (preview) and
`nodes/_fx_adjust_engine.py` (final render). Verify with `python scripts/fx_parity_check.py`.

## Pipeline order
Tone -> Color -> Detail (clarity, sharpness, grain) -> Effects (vignette, fade) -> Amount blend.

### Per-pixel pass A (no neighbours), in this order
1. exposure E:    `c *= 2 ** (E/100)`
2. brightness B:  `c += B/200`
3. contrast K:    `c = (c-0.5)*(1+K/100) + 0.5`
4. blacks  Bl:    `w = clamp(1-2c,0,1);      c += (Bl/100)*0.5*w`
5. shadows Sh:    `w = (1-c)*(1-c);          c += (Sh/100)*0.5*w`
6. highlights Hi: `w = c*c;                  c += (Hi/100)*0.5*w`
7. whites  Wh:    `w = clamp(2c-1,0,1);      c += (Wh/100)*0.5*w`
8. temperature T: `r += T/100*0.10;  b -= T/100*0.10`
9. tint Ti:       `g += Ti/100*0.10`
10. saturation S: `c = L + (c-L)*(1+S/100)`
11. vibrance V:   `mx=max(r,g,b); mn=min(r,g,b); sat = mx<=0 ? 0 : (mx-mn)/mx;
                   amt = (V/100)*(1-sat);  c = L + (c-L)*(1+amt)`
12. hue Hd (deg): rotate (r,g,b) by matrix M(Hd) below.
13. clarity Cl (midtone-contrast approximation, NON-spatial in v1 - documented simplification):
    `m = 1 - abs(2L-1);  c = (c-0.5)*(1 + (Cl/100)*0.5*m) + 0.5`

Hue matrix M(a), a in radians = Hd*pi/180 (luminance-preserving YIQ-style):
```
cosA=cos(a); sinA=sin(a)
M = [[0.213+cosA*0.787-sinA*0.213, 0.715-cosA*0.715-sinA*0.715, 0.072-cosA*0.072+sinA*0.928],
     [0.213-cosA*0.213+sinA*0.143, 0.715+cosA*0.285+sinA*0.140, 0.072-cosA*0.072-sinA*0.283],
     [0.213-cosA*0.213-sinA*0.787, 0.715-cosA*0.715+sinA*0.715, 0.072+cosA*0.928+sinA*0.072]]
r' = M[0][0]*r+M[0][1]*g+M[0][2]*b   (etc.)
```

### Spatial pass B - sharpness Sp (reads pass-A result)
`blur = 3x3 box blur (each neighbour weight 1/9), edges replicate (clamp coords)`
`out = c + (Sp/100) * (c - blur)`   (unsharp mask, per channel)

### Per-pixel pass C (coord), on pass-B result, in this order
- grain G (coord, seeded - APPROXIMATE PREVIEW, see carve-out):
  `n = hash01(x,y,seed) - 0.5;  c += n * (G/100)*0.2`
  `hash01 = fract(sin(x*12.9898 + y*78.233 + seed*37.719) * 43758.5453)`
  Pixel pattern may differ between JS/Python; amount & character match. Exempt from
  pixel-exact parity.
- vignette Vg (coord):
  `dx=(x+0.5)/W-0.5; dy=(y+0.5)/H-0.5; rr = sqrt(dx*dx+dy*dy)/0.70710678;
   v = clamp((rr-0.5)/0.5, 0, 1);  c *= 1 - (Vg/100)*v*v`
- fade Fd:  `c = c*(1 - (Fd/100)*0.15) + (Fd/100)*0.10`

### Amount blend (clamp processed FIRST, then blend)
Keep the ORIGINAL below-pixels `orig` (already 0..1). Clamp the processed result to 0..1,
then `out = orig*(1-amount01) + processed_clamped*amount01`, then clamp 0..1 (safety),
*255, round half-up. `amount01 = layer.opacity` (0..1).

## Presets (name -> non-zero fields; all others 0)
15 cinematic looks (Original + 14), listed in grid order (5 across x 3 down).
- Original:  {}
- Cinema:    {contrast:22, saturation:8, vibrance:14, temperature:-10, tint:4, clarity:8, blacks:8}
- Vivid:     {saturation:30, vibrance:22, contrast:14, clarity:8}
- Teal:      {temperature:-30, tint:6, saturation:14, vibrance:12, contrast:8}
- Amber:     {temperature:30, contrast:14, saturation:6, highlights:-8, grain:22, fade:8}
- Sienna:    {temperature:26, saturation:-6, contrast:6, fade:24, blacks:10, highlights:-10}
- Safari:    {temperature:18, contrast:16, saturation:8, vibrance:8, clarity:12}
- Tropic:    {temperature:-8, saturation:24, vibrance:18, contrast:12, clarity:6, exposure:3}
- Bloom:     {temperature:8, saturation:18, vibrance:16, contrast:10, clarity:6}
- Forest:    {contrast:24, blacks:18, shadows:-10, saturation:-16, tint:8, temperature:-6, vignette:22, clarity:8}
- Emerald:   {contrast:14, saturation:-10, tint:14, temperature:-6, blacks:10, fade:8}
- Nordic:    {contrast:10, saturation:-8, temperature:-12, tint:10, fade:16, blacks:8, highlights:-6}
- Airy:      {exposure:6, brightness:8, contrast:-8, fade:18, blacks:12, highlights:-8, saturation:-4}
- Crisp:     {contrast:16, clarity:16, sharpness:12, saturation:10, vibrance:8}
- Street:    {contrast:26, blacks:20, saturation:-14, clarity:12, sharpness:8, vignette:14}

## Parity & carve-out
JS and Python MUST produce identical output (within rounding, tolerance 1/255) for every
adjustment and preset EXCEPT grain (different RNGs). When changing any formula: update THIS
doc first, then both engines, then re-run `python scripts/fx_parity_check.py`.
