# Fonts

## Anton — `anton-latin.woff2`

Display face for the atmosphere mock: heavy, condensed, built for single words set large.
Designed by Vernon Adams, released under the **SIL Open Font License 1.1**, which permits
bundling and self-hosting: <https://openfontlicense.org>.

Source: the `latin` subset served by Google Fonts, downloaded once and committed. **18.6 KB.**

**Self-hosted, not linked.** `shell.css`'s own header records why there is no CDN font on this
site: the event is watched on one evening, possibly on a flaky connection, and a webfont that
fails to arrive should not be able to change what the room sees. A file in the bundle cannot
fail separately from the bundle. It is also the only way the site keeps working offline on
GitHub Pages, which was true before this font existed and stays true with it.

Only the `latin` subset ships. The full family carries Vietnamese and Latin-Extended ranges
that nothing on this site sets, and they would roughly triple the weight for glyphs no member
name uses.

`font-display: swap` deliberately: the title is legible in the fallback face from the first
frame and simply gets better, rather than being invisible while a download decides.
