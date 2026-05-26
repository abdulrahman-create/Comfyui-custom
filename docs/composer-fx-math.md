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
- Original:     {}
- Punch:        {contrast:18, saturation:20, clarity:12}
- Warm:         {temperature:25, saturation:8, contrast:6}
- Cool:         {temperature:-22, tint:-6, saturation:6}
- Vintage:      {contrast:-10, saturation:-18, temperature:18, fade:30}
- Faded:        {contrast:-12, fade:45, saturation:-8, blacks:15}
- Matte:        {contrast:-16, fade:35, saturation:-6}
- Vivid:        {saturation:32, contrast:12, vibrance:20}
- Cross-process:{hue:-12, saturation:26, contrast:14, temperature:-10}
- Mono:         {saturation:-100, contrast:12}
- Noir:         {saturation:-100, contrast:40, blacks:20}
- Sepia:        {saturation:-100, temperature:35, contrast:6, fade:10}

## Parity & carve-out
JS and Python MUST produce identical output (within rounding, tolerance 1/255) for every
adjustment and preset EXCEPT grain (different RNGs). When changing any formula: update THIS
doc first, then both engines, then re-run `python scripts/fx_parity_check.py`.
