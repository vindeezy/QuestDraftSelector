# Sprite prompts — SPR 1 trial

Copy-paste prompts for the timeboxed sprite trial. Same arrangement as
[`texture-prompts.md`](texture-prompts.md): the owner generates, the repo consumes.

**This is a trial, not a commitment.** Three sprites, drawn on the build reveal only, behind
the vector weapon and armour that are already there. If they read as real machines we plan the
rest; if they read as AI robot soup we stop, and the hour is the whole loss. The arena is not
touched either way.

---

## Which three, and why not the others

Generate **Wedge**, **Diamond** and **Circle**. Not the other three, and the reason is not
taste:

| chassis | appearances in seed 43000236 | in the trial? |
|---|---|---|
| Diamond | 3 — Tommy, Spencer, Rob | **done** — most common, biggest payoff |
| Wedge | 2 — Pat, Erik | **done** — most distinctive silhouette |
| Circle | 2 — Colby, Nick L | **done** — the stress test, and it passed |
| Tower | 2 — Paden, Nick C | **round two** |
| Square | 1 — Vin | **round two** |
| **Box** | **0** | **no — never rolled** |

Round two finishes the set: all ten members get a machine instead of four of them keeping a
flat vector shape next to six that do not.

**Box cannot be judged at all**, because no member in the recorded event has one. A Box sprite
would be work that nothing on the site can display. Skip it.

Circle is in deliberately as the hard case. A wedge looks like a machine almost by accident; a
plain disc has to earn it through panelling and detail alone. If Circle works, the technique
works.

---

## The rules every sprite must follow

These are not style preferences. Each one breaks something specific if ignored.

1. **Top-down, dead overhead.** Not three-quarter, not "slightly angled". The arena is a
   flat overhead view and a bot drawn at an angle will look like it is falling over as it
   rotates.
2. **Facing RIGHT.** Bots point along +x at zero rotation, and the renderer rotates from
   there. A sprite drawn facing up is wrong by 90 degrees on every frame.
3. **Greyscale, and LIGHT.** No colour at all. `tint` multiplies, so it can only ever darken —
   a mid-blue sprite tinted with Rob's gold gives mud. This is the same reason the armour
   textures ship light, and the reason carbon fibre is mid-grey rather than the near-black it
   really is.
4. **No weapon, no turret, no blade.** The weapon is drawn as vector art on top, per member.
   A sprite with its own weapon gives every bot two.
5. **Transparent background, PNG.** Not a white background, not a checkerboard drawn as
   pixels. Everything outside the hull must be genuinely transparent — this is the one place
   PNG is right and JPEG is not.
6. **No cast shadow and no ground.** The renderer owns the floor. A baked shadow is a shadow
   pointing the wrong way the moment the bot turns.
7. **Square canvas, subject centred, filling the frame** edge to edge with only a hair of
   margin. Uneven margins become an off-centre bot that wobbles as it rotates.

---

## Wedge

> Top-down orthographic view looking straight down from directly overhead at a battle robot
> chassis. WEDGE shape: a sharp pointed armoured prow at the RIGHT side, flaring out to its
> widest just behind the point, then tapering back to a flat blunt rear at the LEFT side —
> a five-sided ramming wedge seen from above. Bare chassis only: NO weapon, NO spinning
> blade, NO turret, NO exposed wheels. Brushed steel and light grey armour plating, visible
> panel seams, hex bolts, weld lines, scuffs and worn edges. Pure greyscale — no colour tint
> of any kind, so it can be recoloured later. Flat even lighting, NO cast shadow, NO ground,
> NO background. Fully transparent background. Crisp silhouette, centred, filling the frame.
> Game sprite asset, high detail, 1:1 square.

## Diamond

> Top-down orthographic view looking straight down from directly overhead at a battle robot
> chassis. DIAMOND shape: a four-sided rhombus with a sharp point at the RIGHT, a sharp point
> at the LEFT, and its widest span across the middle — armoured hard at the front and rear
> points and thin at the flanks. Bare chassis only: NO weapon, NO spinning blade, NO turret,
> NO exposed wheels. Brushed steel and light grey armour plating, visible panel seams, hex
> bolts, weld lines, scuffs and worn edges. Pure greyscale — no colour tint of any kind, so it
> can be recoloured later. Flat even lighting, NO cast shadow, NO ground, NO background. Fully
> transparent background. Crisp silhouette, centred, filling the frame. Game sprite asset,
> high detail, 1:1 square.

## Circle

> Top-down orthographic view looking straight down from directly overhead at a battle robot
> chassis. CIRCULAR shape: a perfectly round armoured disc hull, uniform all the way around
> with no weak side, but with a clearly readable FRONT at the RIGHT — a heavier armoured
> forward plate, a slight bevel or intake at the right edge, so the direction it faces is
> obvious at a glance. Bare chassis only: NO weapon, NO spinning blade, NO turret, NO exposed
> wheels. Brushed steel and light grey armour plating, concentric panel seams, hex bolts, weld
> lines, scuffs and worn edges. Pure greyscale — no colour tint of any kind, so it can be
> recoloured later. Flat even lighting, NO cast shadow, NO ground, NO background. Fully
> transparent background. Crisp silhouette, centred, filling the frame. Game sprite asset,
> high detail, 1:1 square.

---

# Round two — Tower and Square

Two things are different this time, both learned from round one.

**These two have a FLAT FRONT, not a point.** Wedge, Diamond and Circle all had something at
the front for the eye to catch. Tower is an octagon whose nearest vertex to the front is 22.5°
off, so an armoured face looks forward; Square is axis-aligned, so a flat side looks forward.
Left unsaid, a generator will invent a prow and the art will disagree with the machine that
collides. Both prompts state it and then give the front something else to be readable by.

**They must match the first three.** Three sprites generated separately can each be good and
still look like three different games — and now there are five. The existing three measure a
mean luminance of 110-116 out of 255 and share a vocabulary: brushed steel, hard-edged armour
plates, panel seams, hex bolts, weld lines, scuffs and worn corners. Both prompts below repeat
that language deliberately. **Do not make these two brighter or darker than the first three**,
even though brighter would help Tommy — that is a decision for the whole set, not for two of
it, and mixing brightness across chassis is more obvious than any of it being dark.

## Tower

> Top-down orthographic view looking straight down from directly overhead at a battle robot
> chassis. OCTAGONAL shape: a regular eight-sided hull with a FLAT armoured face pointing to
> the RIGHT — no prow, no point, no spike at the front. It is the smallest and most compact
> chassis in the game, so it should read as dense and heavily armoured for its size, with
> thick plating crowded into a small footprint. Make the RIGHT-hand flat face obviously the
> front: a heavier forward plate, a reinforced lip, a vent or sensor slot centred on it, so
> the direction it faces is clear at a glance. Bare chassis only: NO weapon, NO spinning
> blade, NO turret, NO exposed wheels. Brushed steel and light grey armour plating, hard-edged
> plates, panel seams, hex bolts, weld lines, scuffs and worn corners. Pure greyscale — no
> colour tint of any kind, so it can be recoloured later; mid-grey overall, neither bright
> white nor dark. Flat even lighting, NO cast shadow, NO ground, NO background. Fully
> transparent background. Crisp silhouette, centred, filling the frame. Game sprite asset,
> high detail, 1:1 square.

## Square

> Top-down orthographic view looking straight down from directly overhead at a battle robot
> chassis. SQUARE shape: a plain four-sided box hull, flat on all four sides, with a FLAT
> armoured face pointing to the RIGHT — no prow, no point, no spike at the front. This is the
> plain honest baseline chassis, so it should look workmanlike and solidly built rather than
> exotic. Make the RIGHT-hand face obviously the front: a heavier forward plate, a reinforced
> bumper lip, a vent or sensor slot centred on it, so the direction it faces is clear at a
> glance. Bare chassis only: NO weapon, NO spinning blade, NO turret, NO exposed wheels.
> Brushed steel and light grey armour plating, hard-edged plates, panel seams, hex bolts, weld
> lines, scuffs and worn corners. Pure greyscale — no colour tint of any kind, so it can be
> recoloured later; mid-grey overall, neither bright white nor dark. Flat even lighting, NO
> cast shadow, NO ground, NO background. Fully transparent background. Crisp silhouette,
> centred, filling the frame. Game sprite asset, high detail, 1:1 square.

**Names:** `chassis-tower.webp` and `chassis-square.webp` (or `.png` to look first).

Silhouette accuracy is worth aiming for but is no longer load-bearing — the renderer fits each
sprite to its chassis's real bounds and clips it to the outline, so nothing can overhang the
armour rim or leave the vector body showing through however the art comes back. The armour
material is layered over the top automatically, so these two need nothing extra to show what
they are made of.

---

## Where to put them

Generate as PNG, then convert (see
[`src/render/sprites/README.md`](../src/render/sprites/README.md) — raw PNGs are ~2 MB each and
must be cropped, resized to 768 and saved as WebP before committing). Both formats load, so you
can look first and convert after. Save into:

```
src/render/sprites/
```

with exactly these names — the loader matches on them, and anything else is ignored:

```
chassis-wedge.webp
chassis-diamond.webp
chassis-circle.webp
```

Nothing else needs doing. The loader picks up whichever files are present and falls back to
the existing vector chassis for the ones that are not, so you can drop in one and look at it
before generating the rest.

---

## What the first round actually found

All three were generated and judged. **The technique works** — Circle passed the stress test,
reading as a machine through concentric armour rings and panelling alone. Three things were
learned that the prompts above do not prevent, and that the renderer now handles:

- **The art's silhouette does not match the chassis polygon.** The Diamond came back a square
  four-point diamond (aspect 1.009) where the game's Diamond is a wide rhombus (1.250), and the
  Wedge came back with a broad square rear where the polygon narrows to 0.6r. The sprite is
  therefore fitted to the chassis's bounding box AND clipped to its outline, so no art can
  overhang the armour rim or leave the vector body showing through. Fidelity in the prompt is
  nice to have rather than load-bearing.
- **Generated files are ~2 MB each** and must be cropped and converted before committing.
- **A near-black member loses the art entirely.** See below — this is the one open question.

## The open question: Tommy

`tint` multiplies, so a member's colour sets a ceiling on how bright the sprite can be. Against
the sprites' mean luminance of 115, every member lands at 38.9 or above — except Tommy, whose
`#1C1F26` puts him at **13.9**, which is black mush with the panel detail invisible.

Lifting the tint's luminance to 85 fixes it exactly (13.9 -> 38.2) and affects nobody else,
because the next-darkest colour, Colby's red, is already at 86.2. But it moves Tommy's tint to
`#4D5569`, and his separation from Nick L's blue-grey **collapses from ΔE 39.7 to 14.3**,
against the 34.0 floor the palette pass was built to hold.

That is a trade between "Tommy's machine has visible detail" and "Tommy and Nick L stay
plainly different colours", and it is the owner's call, not a rendering decision. Left as-is
until then: Tommy is dark, which is what he was before sprites existed too.

---

## What to look for when judging

The question is not "is this a nice picture". It is:

- **Does it read as a machine at portrait size?** The build reveal draws the bot at roughly
  260-380px. Detail that only appears at full resolution is detail nobody sees.
- **Is the front obvious?** If you cannot tell which way it is pointing without the weapon,
  the sprite has failed the one job the silhouette was doing.
- **Does the member's colour survive the tint?** Check a light member (Nick C's yellow) and a
  dark one (Tommy's black). If everything comes out muddy grey, the sprite is too dark.
- **Do the three look like they belong to each other?** Three sprites from three separate
  generations can each be good and still look like three different games.

If the answer to any of those is no, we stop and keep the vector chassis — which already
works, already matches the arena, and costs nothing.
