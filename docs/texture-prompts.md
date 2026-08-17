# Texture generation prompts

Copy-paste prompts for generating the material textures in ChatGPT, for **MAT 1** (bots and
weapons) and a second tier for the arena floor.

---

## How to use this

1. **One image per message.** Paste a prompt, get the image, save it, move on. Asking for
   several at once gets you a contact sheet with borders and captions, which is useless here.
2. **Ask for 1024×1024.** Every prompt says so. We downscale later — generating small loses
   detail that cannot be recovered.
3. **Save as PNG** with the exact filename listed under each prompt. The filenames match the
   part ids in the code, so correct names mean I can wire them up without asking you anything.
4. **Put them all in one folder** and send it over. I'll handle resizing and conversion.

### If an image comes back wrong

These three replies fix almost everything. Reply in the same chat rather than starting over.

> Make it significantly lighter and lower in contrast overall. Keep the exact same pattern and
> composition, just brighter — closer to a light grey than a dark one.

> The detail is too fine. Redo it with far fewer, much larger features — about a third as many,
> each three times the size. Same material, coarser.

> Remove all lighting effects: no shadows, no highlights, no glare, no darkening at the edges.
> I want completely flat, even illumination across the whole square.

### How to check one is usable

Shrink it to about 40 pixels on screen and look at it. **If it turns into flat grey, the
features are too fine** — the bots are only about 20 pixels across in the arena, and anything
that vanishes at 40 pixels will certainly vanish there. Ask for fewer, larger features.

---

## The rules behind every prompt

You don't need to do anything with these — they're already baked into the prompts below. They
are recorded so that if you deviate, you know what you're trading away.

- **Light and desaturated.** PixiJS `tint` *multiplies*, so it can only ever darken. The member
  colour is applied on top of these textures. A dark texture tinted with a colour goes black
  and you lose which bot belongs to whom, which is the one thing the arena cannot afford.
- **Coarse features.** A bot is ~20px in the arena. Photoreal fine grain becomes flat grey.
- **Flat lighting, no shadows.** Baked-in lighting fights the real lighting and looks pasted on.
- **Fills the square, no border.** Any frame or vignette becomes a visible box on the bot.
- **Not tileable, deliberately.** Nothing here repeats — bodies get one mapped texture, floor
  tiles get one each with seams hidden on the existing grid lines. Don't spend effort on it.

---

# Tier 1 — MAT 1 (do these)

Eight images. These are the ones we are definitely using.

---

### 1. Depleted Uranium — `armour-depleted-uranium.png`

```
Create a 1024x1024 square image of a flat metal surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a metal plate, not a photograph of an object.

Material: depleted uranium armour plating. Dense, heavy, industrial metal, deeply pitted with
shallow craters and gouges, with a faint olive-grey cast.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare.
- Light-to-medium grey overall and desaturated. Do NOT make it dark — it will be colour-tinted
  later, and a dark texture turns black.
- Coarse detail: roughly 12 to 20 clearly visible pits and gouges across the whole image, each
  one large. Not fine grain, not noise.
- No text, no numbers, no logos, no objects, no perspective, no 3D rendering of a plate sitting
  in space. Just the surface.
```

---

### 2. Hardened Steel — `armour-hardened-steel.png`

```
Create a 1024x1024 square image of a flat metal surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a metal plate, not a photograph of an object.

Material: thick rolled steel armour plate. A few long straight weld seams crossing the surface,
and a scattering of large round rivet heads. Solid, heavy, fabricated.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare.
- Light-to-medium grey overall and desaturated. Do NOT make it dark — it will be colour-tinted
  later, and a dark texture turns black.
- Coarse detail: two or three weld seams and no more than about twelve rivets, each rivet large
  and clearly visible. Fewer and bigger is better than many and small.
- No text, no numbers, no logos, no objects, no perspective, no 3D rendering of a plate sitting
  in space. Just the surface.
```

---

### 3. Titanium — `armour-titanium.png`

```
Create a 1024x1024 square image of a flat metal surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a metal plate, not a photograph of an object.

Material: brushed titanium. Long parallel brush strokes all running in the SAME direction
across the entire image, giving a strong directional grain. Slightly cool in tone.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare, no bright band across the middle.
- Light grey overall and desaturated. Do NOT make it dark — it will be colour-tinted later, and
  a dark texture turns black.
- The grain must be COARSE and clearly visible: broad brush strokes, roughly 20 to 30 across
  the whole image, not fine hairlines. The direction of the grain is the whole point and it has
  to survive being viewed very small.
- No text, no numbers, no logos, no objects, no perspective, no 3D rendering of a plate sitting
  in space. Just the surface.
```

---

### 4. Aluminium — `armour-aluminium.png`

```
Create a 1024x1024 square image of a flat metal surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a metal plate, not a photograph of an object.

Material: smooth polished aluminium sheet. Almost featureless — just very faint soft cloudy
mottling in the finish. Clean and bright.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare, no reflections of anything.
- Light, bright grey overall and desaturated. This should be the LIGHTEST and SMOOTHEST of the
  set — its lack of texture is deliberate and is how it is told apart from the others.
- Barely any detail: soft broad cloudy variation only. No scratches, no grain, no pits, no
  rivets, no panel lines.
- No text, no numbers, no logos, no objects, no perspective, no 3D rendering of a plate sitting
  in space. Just the surface.
```

---

### 5. Alloy — `armour-alloy.png`

```
Create a 1024x1024 square image of a flat metal surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a metal plate, not a photograph of an object.

Material: rough sand-cast metal alloy. An uneven, pebbled, orange-peel surface — the bumpy
irregular finish of metal poured into a sand mould and never machined smooth.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare.
- Medium-light grey overall and desaturated. Do NOT make it dark — it will be colour-tinted
  later, and a dark texture turns black.
- Coarse detail: large chunky bumps and hollows, roughly 20 to 30 across the whole image. It
  must read as ROUGH from far away, which is how it is told apart from the smooth metals.
- No text, no numbers, no logos, no objects, no perspective, no 3D rendering of a plate sitting
  in space. Just the surface.
```

---

### 6. Carbon Fibre — `armour-carbon-fibre.png`

```
Create a 1024x1024 square image of a flat woven surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a sheet of material, not a photograph of an object.

Material: carbon fibre cloth in a 2x2 twill weave — the classic diagonal basket-weave pattern
of interlocking rectangular tows.

Requirements:
- The weave fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare, no glossy resin sheen.
- Light-to-medium grey and desaturated. Do NOT make it black or near-black — real carbon fibre
  is very dark, but this one must be LIGHT, because it will be colour-tinted later and a dark
  texture turns black. Keep the weave pattern, lose the darkness.
- CHUNKY weave: only about 8 to 10 weave cells across the entire width. Much coarser than real
  carbon fibre. High contrast between the light and dark strands so the pattern survives being
  viewed very small.
- No text, no numbers, no logos, no objects, no perspective. Just the surface.
```

---

### 7. Spiked Composite — `armour-spiked-composite.png`

```
Create a 1024x1024 square image of a flat armour surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a panel, not a photograph of an object.

Material: battle-damaged layered composite armour. Scarred, chipped and gouged, with the
internal layers visible as banded edges inside the chips. It has clearly been hit repeatedly.
A very faint warm tone.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare.
- Medium-light grey overall and desaturated. Do NOT make it dark — it will be colour-tinted
  later, and a dark texture turns black.
- Coarse detail: roughly 10 to 15 large chips and gouges across the whole image, each big
  enough to see clearly. Damage should be dramatic and sparse, not a fine scratch pattern.
- Do NOT draw actual spikes, spines or protruding shapes — the spikes are drawn separately in
  code. This is only the flat surface between them.
- No text, no numbers, no logos, no objects, no perspective. Just the surface.
```

---

### 8. Weapon Steel — `weapon-steel.png`

```
Create a 1024x1024 square image of a flat metal surface, viewed perfectly straight-on from
directly above — like a flatbed scan of a metal plate, not a photograph of an object.

Material: clean brushed tool steel — the finish of a saw blade or a machined weapon part.
Directional grain, harder and cleaner than cast metal, with a few light scuffs.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting across the whole image. No drop shadows, no specular
  highlights, no visible light source, no glare.
- Light, bright grey and desaturated — this one should read as clean, hard and slightly
  brighter than the armour plates.
- Coarse detail: visible directional grain plus half a dozen larger scuffs and scratches. Not
  fine hairlines.
- No text, no numbers, no logos, no objects, no teeth, no blade shapes, no perspective. Just
  the flat surface material.
```

---

# Tier 2 — the arena floor (only if we get to it)

Six images. **These are not part of MAT 1** and may not make the deadline — the polish cutoff
is 26 August and the floor needs renderer work MAT 1 does not. Generate them if you have the
time; skip them without any loss if you don't.

One thing to know about these: the floor is the largest surface on screen and the bots are
tiny against it. These are deliberately specified as **quieter and lower-contrast** than the
bot textures. A dramatic floor costs you the ability to follow the fight.

---

### 9. Plain deck — `floor-plain.png`

```
Create a 1024x1024 square image of a flat industrial floor surface, viewed perfectly
straight-on from directly above — like a flatbed scan, not a photograph of an object.

Material: worn steel deck plating. Scuffed and used, with faint scratches and traffic marks.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting. No drop shadows, no highlights, no visible light source.
- Light-to-medium grey, desaturated, and deliberately LOW CONTRAST and quiet. This is a
  background surface — it must not compete for attention with what is on top of it.
- Subtle, broad detail only: a few large scuffed areas, no busy patterning, no tread plate
  diamonds, no panel grids.
- No text, no numbers, no logos, no objects, no perspective. Just the surface.
```

---

### 10. Tar — `floor-tar.png`

```
Create a 1024x1024 square image of a flat liquid surface, viewed perfectly straight-on from
directly above — like a flatbed scan, not a photograph of an object.

Material: thick pooled tar or bitumen. Viscous, slow, with broad soft ripples and a heavy
sluggish surface. Sticky rather than watery.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting. No drop shadows, no highlights, no visible light source, no
  glossy reflections.
- Light-to-medium grey and desaturated. This is important and counter-intuitive: real tar is
  black, but this must be LIGHT, because the dark colour is applied in code. Keep the viscous
  rippled pattern, lose the darkness.
- Coarse, broad detail: a handful of large slow ripples across the whole image. Not fine
  texture.
- No text, no numbers, no logos, no objects, no perspective. Just the surface.
```

---

### 11. Ice — `floor-ice.png`

```
Create a 1024x1024 square image of a flat frozen surface, viewed perfectly straight-on from
directly above — like a flatbed scan, not a photograph of an object.

Material: cracked sheet ice. A network of long branching cracks running through frozen
material, with frosted patches between them.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting. No drop shadows, no highlights, no visible light source, no
  sparkle, no glare.
- Very light, near-white grey and desaturated.
- Coarse detail: a small number of long, bold cracks — roughly 6 to 10 crossing the whole
  image — not a dense fine web of hairline fractures.
- No text, no numbers, no logos, no objects, no icicles, no perspective. Just the surface.
```

---

### 12. Gravel — `floor-gravel.png`

```
Create a 1024x1024 square image of a flat loose surface, viewed perfectly straight-on from
directly above — like a flatbed scan, not a photograph of an object.

Material: coarse gravel and crushed stone, packed flat.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting. No drop shadows under the stones, no highlights, no visible
  light source.
- Light-to-medium grey and desaturated.
- Coarse detail: large chunky stones, roughly 30 to 40 visible across the whole image. Big
  pieces, not sand or fine grit.
- No text, no numbers, no logos, no objects, no perspective. Just the surface.
```

---

### 13. Conveyor — `floor-conveyor.png`

```
Create a 1024x1024 square image of a flat conveyor belt surface, viewed perfectly straight-on
from directly above — like a flatbed scan, not a photograph of an object.

Material: a heavy industrial conveyor belt with raised cleats running across it. The cleats
must all be parallel and run STRAIGHT ACROSS the image horizontally, evenly spaced, so the belt
has an obvious direction of travel.

Requirements:
- The surface fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting. No drop shadows, no highlights, no visible light source.
- Light-to-medium grey and desaturated.
- Coarse detail: about 6 to 8 cleats across the whole image, each thick and clearly visible.
- The cleats must be perfectly horizontal and parallel — the image will be rotated in code to
  point the belt in four different directions, so any tilt will look like a mistake.
- No text, no numbers, no logos, no arrows, no objects, no perspective. Just the surface.
```

---

### 14. Oil slick — `floor-oil.png`

```
Create a 1024x1024 square image of a flat liquid spill, viewed perfectly straight-on from
directly above — like a flatbed scan, not a photograph of an object.

Material: a slick of spilled oil. Irregular pooled shapes with soft edges, and a faint
iridescent sheen where the film is thin.

Requirements:
- The spill fills the entire square edge to edge. No border, no frame, no background, no
  vignette, no darkening at the corners.
- Completely flat, even lighting. No drop shadows, no bright highlights, no visible light
  source.
- Medium grey overall, but unlike the other textures a FAINT iridescent colour shimmer is
  wanted here — subtle blues and purples in the thin film. Keep it restrained.
- Coarse detail: a few large pooled shapes with soft concentric edges, not fine spatter.
- No text, no numbers, no logos, no objects, no reflections of surroundings, no perspective.
  Just the surface.
```

---

## What I do with them

Nothing for you to action — recorded so the handoff is clear.

| Step | What happens |
|---|---|
| Resize | 1024 down to 256 or 512, chosen by what still reads at bot size |
| Convert | PNG, quantised — bundle size is checked before and after, since hosting is free-tier |
| Wire | Optional `texture` on `drawBotPortrait`, following the `weaponScale` precedent |
| Fall back | A missing or failed texture leaves the site exactly as it ships today, tested explicitly |

The fallback matters more than it sounds: it means a texture that turns out to look wrong can
be deleted rather than reverted, and shipping without any of them is always available.
