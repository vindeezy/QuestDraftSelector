# Chassis sprites

Input to the SPR 1 trial; see
[`docs/sprite-prompts.md`](../../../docs/sprite-prompts.md) for the generation prompts and the
rules the art has to follow.

## Naming

The loader keys on the filename, which must be the chassis's **part id** exactly:

```
chassis-wedge.webp
chassis-diamond.webp
chassis-circle.webp
chassis-tower.webp
chassis-square.webp
```

Either `.png` or `.webp` is picked up, so a freshly generated PNG can be dropped straight in
and looked at. **Convert before committing**, though — see below.

## Converting

Generated art arrives huge: the first three were 1254x1254 PNGs totalling 6.5 MB, against
321 KB for every armour and floor texture the site ships combined. Crop to the opaque bounds,
resize the long edge to 768, and save as WebP quality 90:

```bash
python -c "from PIL import Image; im=Image.open('x.png').convert('RGBA'); im=im.crop(im.getchannel('A').point(lambda v:255 if v>10 else 0).getbbox()); w,h=im.size; s=768/max(w,h); im.resize((round(w*s),round(h*s)),Image.LANCZOS).save('x.webp','WEBP',quality=90,method=6)"
```

That took the same three files to 435 KB — 93.5% smaller — for 40.6 dB PSNR measured on
visible pixels only. **Cropping is not optional**: the art ships with a transparent margin
(the wedge had 94px top and bottom), and the renderer fits the texture to the chassis's
bounding box, so an uncropped sprite draws inset from its own outline.

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
