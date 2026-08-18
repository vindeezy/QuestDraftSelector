# Weapon sprite prompts

Round three of the sprite work, after the five chassis. Same arrangement as
[`sprite-prompts.md`](sprite-prompts.md) and [`texture-prompts.md`](texture-prompts.md): the
owner generates, the repo consumes.

**Where these show up:** the build reveal only, exactly like the chassis. Weapons are drawn in
the arena too, at roughly a tenth of the size, where the detail cannot survive and the tint
loss costs legibility — the same measured reason the chassis sprites stay off the battle
screen. The loader will gate them the same way.

---

## What is different about weapons

The chassis sprites only had to sit still. These **move**, and the motion is procedural — the
renderer already spins, swings and foreshortens the vector art off the simulation clock. So a
weapon sprite has one hard requirement the chassis never had:

**Draw the weapon in its REST pose, oriented exactly as described below.** Do not draw motion
blur, a swing arc, spin trails, or the weapon mid-strike. The renderer supplies all of that. A
sprite with movement baked in fights the movement applied on top and reads as a smear.

Everything else follows the chassis rules, and for the same reasons:

1. **Top-down, dead overhead.** The whole arena is an overhead view.
2. **Greyscale, and LIGHT.** Weapons are tinted `#C9D3DE`, a pale steel. `tint` multiplies, so
   any colour of its own turns to mud.
3. **Transparent background, PNG.** No ground, no shadow, no backing plate.
4. **Fill the frame, centred.** The renderer fits each sprite to the vector geometry's own
   bounding box, so the art's edges must be the weapon's edges.
5. **The aspect ratios below are not suggestions.** Each weapon is fitted to the box its vector
   version occupies, so art at the wrong proportion gets stretched into it. Match them.

| file | shape | aspect (w:h) | how it moves |
|---|---|---|---|
| `weapon-saw-blade` | disc, FACE-ON | 1 : 1 | spins in the plane |
| `weapon-vertical-spinner` | disc, EDGE-ON | 0.385 : 1 | rocks edge-to-face |
| `weapon-spinning-bar` | bar across the front | 0.133 : 1 | spins in the plane |
| `weapon-ram-plate` | plate across the front | 0.308 : 1 | does not move |
| `weapon-hammer-head` | block head | 0.55 : 1 | swings and slides |
| `weapon-flamethrower` | nozzle, pointing right | 1.75 : 1 | static; flame is particles |

---

## Saw Blade

> Top-down orthographic view looking straight down at a battle robot's circular saw blade,
> seen FACE-ON so the full disc is visible as a circle. Ten sharp cutting teeth evenly spaced
> around the rim, a solid hub at the centre with bolt detail, brushed and scratched steel
> across the blade face, worn and chipped tooth tips. Perfectly circular and centred, filling
> the frame. Shown at REST — no motion blur, no spin trails, no sparks. Pure greyscale, light
> steel, no colour tint of any kind. Flat even lighting, NO cast shadow, NO ground, NO
> background. Fully transparent background. Game sprite asset, high detail, 1:1 square.

## Vertical Spinner

> Top-down orthographic view looking straight down at a battle robot's vertical spinning disc,
> seen EDGE-ON — the disc stands upright, so from above you see only its narrow rim as a tall
> slim vertical shape, wider in the middle and tapering at the top and bottom. A hard machined
> cutting edge running its full length, a visible mounting collar at the centre, brushed steel
> with impact scarring along the edge. Tall and narrow, roughly two and a half times taller
> than it is wide, centred and filling the frame vertically. Shown at REST — no motion blur, no
> spin trails. Pure greyscale, light steel, no colour tint of any kind. Flat even lighting, NO
> cast shadow, NO ground, NO background. Fully transparent background. Game sprite asset, high
> detail.

## Spinning Bar

> Top-down orthographic view looking straight down at a battle robot's spinning weapon bar: a
> long straight weighted steel bar lying horizontally across the view, seen from above, with a
> heavy hardened striking block at EACH end and a bolted rotation hub at its exact centre.
> Extremely long and thin — roughly seven and a half times longer than it is wide. Brushed
> steel, weld seams, deep impact scarring on both striking ends. Shown at REST — no motion
> blur, no spin trails. Pure greyscale, light steel, no colour tint of any kind. Flat even
> lighting, NO cast shadow, NO ground, NO background. Fully transparent background. Game sprite
> asset, high detail.
>
> *(Generate it lying horizontally so it fills a wide frame; it is mounted upright in game.)*

## Ram Plate

> Top-down orthographic view looking straight down at a battle robot's ram plate: a thick blunt
> armoured steel slab seen from above as a long narrow rectangle with slightly rounded corners,
> reinforced with vertical ribs and heavy bolts, a thicker leading edge along one long side.
> Roughly three times longer than it is wide. Brushed steel, scraped and dented from repeated
> impacts. Shown at REST. Pure greyscale, light steel, no colour tint of any kind. Flat even
> lighting, NO cast shadow, NO ground, NO background. Fully transparent background. Game sprite
> asset, high detail.
>
> *(Generate it lying horizontally so it fills a wide frame; it is mounted upright in game.)*

## Hammer head

> Top-down orthographic view looking straight down at a battle robot's hammer head ONLY — no
> handle, no arm, no haft, just the striking head. A heavy squat block of forged steel, slightly
> wider at the striking face than at the back, with chamfered corners, bolt detail and a socket
> where a handle would enter. Roughly twice as tall as it is wide. Battered and deformed on the
> striking face. Shown at REST — no motion blur, no swing arc. Pure greyscale, light steel, no
> colour tint of any kind. Flat even lighting, NO cast shadow, NO ground, NO background. Fully
> transparent background. Game sprite asset, high detail.
>
> **Head only.** The arm is drawn separately and foreshortens as the hammer lifts, which is what
> makes the crush read from overhead. A head with a handle attached would swing as one rigid
> piece and lose that.

## Flamethrower

> Top-down orthographic view looking straight down at a battle robot's flamethrower nozzle: a
> tapered metal barrel pointing to the RIGHT, wider where it mounts and narrowing to a round
> muzzle opening at the right end, with a heat shield collar, cooling fins and bolt detail.
> Roughly one and three quarter times wider than it is tall. Scorched and heat-discoloured metal
> nearest the muzzle. NO flame, NO fire, NO glow — the flame is drawn separately as particles
> and a sprite with fire in it would burn permanently. Shown at REST. Pure greyscale, light
> steel, no colour tint of any kind. Flat even lighting, NO cast shadow, NO ground, NO
> background. Fully transparent background. Game sprite asset, high detail.

---

## Naming and conversion

Save as PNG into `src/render/sprites/weapons/`, then run:

```bash
python tools/convert-sprites.py
```

Names must match exactly — the loader keys on them, and the part ids are what it matches:

```
weapon-saw-blade.webp
weapon-vertical-spinner.webp
weapon-spinning-bar.webp
weapon-ram-plate.webp
weapon-hammer-head.webp
weapon-flamethrower.webp
```

Drop in one and look at it before generating the rest — anything absent keeps the vector
weapon it has today, exactly like the chassis.

## What to check when judging

- **Does it read at reveal size?** The weapon occupies roughly 40-90px on the reveal. Finer
  than that is detail nobody sees.
- **Does it still read when it moves?** The saw and the bar spin fast. A sprite with a strong
  asymmetric highlight can strobe once it is rotating — the chassis never had to survive this.
- **Does it sit right against the chassis?** The weapon mounts at the machine's front edge, and
  a sprite whose art is offset inside its own frame will float or overlap.
