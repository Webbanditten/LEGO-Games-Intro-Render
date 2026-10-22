# LEGO Media intro, recreated in three.js

A frame-accurate, real-time recreation of the classic **LEGO Media** intro
(`intro.mp4`): thousands of 1x1 bricks rain out of the dark, swarm past the
camera and lock into a 60x60 brick mosaic of the LEGO logo, which dissolves
into the flat logo before the "LEGO Media" mark slams in.

As suspected, the original is a **reversed explosion**. This recreation builds
it the same way: every brick is one of the 3600 logo bricks, and its path is a
blast in "explosion time" `s = 11.0 − t` played backwards.

## Run it

```sh
npm install      # only needed for the dev tools (three.js is vendored in vendor/)
npm start        # → http://localhost:8080/
```

Any static file server works (`python3 -m http.server` too). The page loads the
SVG, the end-card SVG and the soundtrack with `fetch`, so it must be served over
HTTP rather than opened as `file://`.

Click **Play**: browsers only start audio after a click.

| Key / control | |
|---|---|
| Space | play / pause |
| R | restart |
| M / "Sound" button | original soundtrack → synthesised soundtrack → off |

URL options:

- `?audio=synth`: use the WebAudio re-synthesis of the soundtrack instead of the audio track of `intro.mp4`.
- `?audio=off`: play silently.
- `?t=10.5`: start at a given time.
- `?debug`: show a time scrubber and the frame counter.
- `?brick=stl`: use the supplied `LEGO 1X1 BRICK (correct dimentions).stl` model for every brick, instead of the procedural brick.
- `?capture`: no UI, deterministic rendering through `window.__renderAt(t)`. Used by the tools.

## How faithful is it?

Everything was measured from `intro.mp4` first, then matched:

- **Timing.** The first brick appears at 0.33 s, the swarm thickens until about 5 s and the camera dollies back from 6.5 s. The mosaic snaps complete at exactly 11.0 s, with a few bricks at the blast centre settling until 11.27 s. The stud mosaic dissolves into the flat logo over 11.2 to 12.1 s. The logo moves left over 13.03 to 13.47 s, linearly. The Media mark grows from 13.56 s with a 1.8 % overshoot.
- **Brick counts.** Visible bricks per frame track the original's counts through the opening. `node tools/stats.mjs` prints the comparison.
- **The mosaic.** It is 60 x 60 bricks with a black 1-brick border ring, sampled from `LEGO_logo.svg`. The (R) is left out of the mosaic but kept in the flat logo, just like the original. The sampled grid agrees with the bricks in the video on 97.7 % of cells.
- **Look.** A key light from above and in front, low ambient and Phong plastic. The bricks use "pillow" normals and domed studs to mimic the late-90s smooth-shaded render. Lighting and material values were fitted numerically against the assembled mosaic with `node tools/calibrate.mjs`.
- **Bricks.** Real 1x1 proportions (7.8 x 7.8 x 9.6 mm with a Ø4.8 mm stud), a hollow underside, and the slanted LEGO wordmark embossed on every stud. The wordmark is cut from the logo SVG itself.
- **End card.** The flat logo and the yellow brick / "media." mark are placed with sub-pixel coordinates measured from the last frame.
- **Sound.** The original track is decoded straight from `intro.mp4`. A full re-synthesis is also included, calibrated band by band against the original: an F1 sawtooth drone, glassy "brick" pings, two rising chirp sweeps and the impact at 13.78 s.

The original was rendered at 25 fps and published at 15 fps. The recreation
animates continuously, so it runs smoothly at any refresh rate.

## Project layout

| Path | What |
|---|---|
| `index.html` | the page (4:3 stage, letterboxed) |
| `src/choreography.js` | all motion as pure math: camera dolly and roll, per-brick reversed-explosion paths, near-camera "hero" fly-bys, late scatter, final snap |
| `src/bricks.js` | brick geometry (procedural or STL), materials, the 3600-instance mesh |
| `src/logo.js` | SVG to mosaic grid, flat-logo texture, stud-text normal map |
| `src/overlay.js` | the 2D layer: mosaic-to-logo dissolve, logo move, Media mark zoom (with motion blur) |
| `src/audio.js`, `src/soundtrack.js` | soundtrack playback and synthesis |
| `src/curves.js` | monotone keyframe curves, seeded RNG |
| `assets/` | end-card SVG, reference 60x60 mosaic |
| `vendor/three/` | three.js r186 (MIT) |
| `tools/` | headless renderer, side-by-side comparisons, statistics and calibration |

## Tools

```sh
node tools/render.mjs --out renders/run --compare   # all 237 frames + renders/run/compare.mp4 (original | ours)
node tools/render.mjs --fps 60 --out renders/60     # smooth 60 fps render.mp4
node tools/stats.mjs                                # brick counts, sizes, colours vs. the original
node tools/calibrate.mjs                            # re-fit lighting against the original's mosaic frame
node tools/check-grid.mjs                           # browser-sampled mosaic vs. assets/mosaic-60.txt
```

`render.mjs` drives the system Google Chrome through `puppeteer-core` (set
`CHROME=/path/to/chrome` if it lives elsewhere). It needs `ffmpeg` for the videos.
