# Chassis sprites — drop PNGs here

Empty on purpose. This folder is the input to the SPR 1 trial; see
[`docs/sprite-prompts.md`](../../../docs/sprite-prompts.md) for the generation prompts and the
rules the art has to follow.

## Naming

The loader keys on the filename, which must be the chassis's **part id** exactly:

```
chassis-wedge.png
chassis-diamond.png
chassis-circle.png
chassis-tower.png
chassis-square.png
```

A file named anything else loads fine, matches nothing, and draws nothing — so it looks like
the sprite failed when the filename failed. `chassis-sprites.test.ts` fails the build on a name
that matches no chassis, and on `chassis-box.png`, which no member in the official event rolls
and therefore nothing on the site can display.

## What happens with files here

Whatever is present is picked up by `import.meta.glob` and drawn on the **build reveal only**,
over the vector chassis body and under the armour rim and the weapon. Chassis with no file keep
the vector body they have today, so you can drop in one sprite and look at it before generating
the rest.

## What happens with the folder empty

Nothing. `spritesAbsent()` short-circuits the load, no request is made, and the portrait is
byte-for-byte what it was before the trial existed. That is the state this ships in, and it is
what makes abandoning the trial free.
