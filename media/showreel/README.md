# Cowork motion reel

A 15 second, 1920x1080, 60 fps motion piece for Cowork, rendered from code.

- `index.html` and `reel.js`: the animation, drawn on a canvas. Every frame is a pure function of time, with 6-sample motion blur, grain and a vignette.
- `capture.mjs`: renders frames in headless Chromium (Playwright) across parallel workers and encodes H.264 with ffmpeg.
- `sound.mjs`: synthesised sound design that hits the same cue points as the picture.
- `fonts/`: Hanken Grotesk and Newsreader (latin subsets from Google Fonts, SIL Open Font License).

## Structure

| Time | Section |
| --- | --- |
| 0.0 to 3.0 | Title: letters rise through a hairline, the C clock-wipes into the mark, camera dives into the dot |
| 3.0 to 5.4 | Kinetic type: eight cuts, one feature word each, a different treatment per cut |
| 5.4 to 7.75 | Shape morphs with echo trails, then a rippling grid of morphing cells |
| 7.75 to 9.95 | A cell opens into a window; parallax camera move across feature cards, ending in a whip pan |
| 9.95 to 11.0 | Type as a mask: zoom out from inside the C, then venetian blinds |
| 11.0 to 12.6 | Rhythm cuts at 0.2 s |
| 12.6 to 15.0 | Iris to the dot, the dot draws the mark, wordmark lockup |

## Render

From the repo root:

```bash
node media/showreel/capture.mjs --video media/showreel/out/cowork-reel-silent.mp4 --workers 6
node media/showreel/sound.mjs media/showreel/out/sound.wav
ffmpeg -y -i media/showreel/out/cowork-reel-silent.mp4 -i media/showreel/out/sound.wav -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart media/showreel/out/cowork-reel.mp4
```

Stills for review: `node media/showreel/capture.mjs --stills 1.5,4.2,10.3 --out some/folder`.
