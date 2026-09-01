# Next Sprint

## Summary — what we did

Built a browser-driven lip-sync demo: Aria Blake singing "Happy Birthday", mouth shapes
generated from the song's vocal timing rather than a baked animation.

1. **Cleaned the source audio.** Separated the original mp3 into stems (Demucs) and kept
   the vocals-only stem so mouth-cue analysis wasn't picking up instrumental noise.
2. **Wrote out the lyrics** as ground truth for alignment.
3. **Ran the Rhubarb Lip Sync Blender add-on** against the vocal stem to generate the
   mouth-cue timing (the `A`–`H`, `X` timeline).
4. **Mapped cues to mouth shapes.** Rhubarb's add-on is built for spoken dialogue, not
   singing — sustained sung vowels and short consonants inside a held note don't match
   its assumptions, so the raw cue-to-shape mapping needed hand iteration to read
   correctly on a singing performance rather than speech.
5. **Built the browser player.** A Three.js viewer applies the cue timeline directly to
   the model's ARKit morph targets at runtime (no baked animation), with:
   - An amplitude-driven jaw (loudness envelope from the vocal stem)
   - Duration-aware, centered pose transitions (short consonant cues reach full strength
     instead of blending through it)
   - Live sliders for mouth strength, jaw strength, transition speed and resting smile
6. **Shipped it.** Compressed the 143MB source model to 9.4MB (Draco/meshopt, texture
   resize) so it would fit Netlify's deploy limits, pushed the code and model to a public
   GitHub repo, and deployed the demo to Netlify for client review.

Live demo: https://say-it-with-songs-demo.netlify.app/aria-mouth-viewer-v2.html
Repo: https://github.com/Kieransaunders/SayItWithSongsDemo

## Next sprint

- [ ] **Integrate into the MindAR platform.** Currently a standalone Three.js viewer;
      port the lip-sync driver (`lipsync-driver.js`) and cue-driven playback into the
      MindAR project (`/Volumes/External/DevExteralHD/1. Current /MindAR with example`)
      so the singing character can appear as an AR target rather than a standalone page.
- [ ] **Offline pose-timing tool** (if we're doing this for more than one song). A script
      that takes the Rhubarb cue JSON + lyrics + vocal envelope and generates per-cue
      hold/transition/strength values automatically, instead of hand-tuning pose values
      per song by ear. Not worth building for a single demo — worth it once re-tuning by
      hand for each new song stops scaling.
- [ ] **Determine the facial rig spec for the 3D studio.** They can supply reusable mouth
      visemes as blendshapes/shape keys, standard offering is the full 52 ARKit set — need
      to decide full 52 vs. a smaller standardised viseme list before locking a spec every
      future character will be built against. See draft findings below; final answer
      should wait until the MindAR end-to-end integration (above) has been proven, in case
      that surfaces requirements this standalone demo didn't (e.g. AR-triggered gaze).

## Facial rig spec — draft findings (pending end-to-end validation)

What the current driver actually uses, counted directly from `lipsync-driver.js` /
`aria-mouth-viewer-v2.html`, not estimated:

- **21 standard ARKit shapes are driven today:** `jawOpen`, `mouthPressLeft/Right`,
  `mouthRollLower`, `mouthStretchLeft/Right`, `mouthLowerDownLeft/Right`, `mouthFunnel`,
  `mouthPucker`, `mouthSmileLeft/Right`, `cheekSquintLeft/Right`, `eyeSquintLeft/Right`,
  `browInnerUp`, `browOuterUpLeft/Right`, `eyeBlinkLeft/Right`.
- **2 non-ARKit extras were required, not optional.** `V_Explosive` (a firm closed-lip
  P/B/M seal) and `V_Tight_O` (a true tight pucker). Plain ARKit `mouthClose` smeared the
  lips at any `jawOpen` value on this rig, and `mouthFunnel`+`mouthPucker` alone only
  produced a wide "O" with teeth showing — no combination of standard ARKit shapes
  reproduced either. These are CC4/iClone-authored visemes, not part of the 52.
- **The other ~31 ARKit shapes are unused today** (eye look direction, jaw
  left/right/forward, mouth left/right, tongue, nose sneer, cheek puff, etc.) but several
  are named in this project's own "next improvements" list (tongue shapes for consonant
  identity, eye gaze) — headroom we'd plausibly grow into, not dead weight.
- **Oculus's 15-viseme set was tested and found unnecessary.** One test model
  (`brunette-viseme-test.glb`) ships both ARKit and the 15 Oculus visemes; the ARKit
  subset alone was sufficient to drive it with zero code changes. No reason to request
  the alternate standard.
- **A head/neck bone is missing from the current export**, not just the morph set. The
  test model is morph-only, so nods/tilts rotate the whole character around a bounding-box
  pivot as a fallback — a real head bone should be in the spec for production characters.

Leaning recommendation: ask for the **full 52 ARKit set as baseline** (their standard —
costs them nothing extra to include, and re-exporting later if we discover we need more
is the expensive path, not authoring more now) **plus explicit confirmation they can
supply the two non-standard viseme extras** (firm P/B/M seal, tight-O pucker) by name,
**plus a head/neck bone** on every character. Keep ARKit-standard naming throughout — the
driver looks up morphs by name, so any model using standard names works with zero code
changes, which is the actual reason to standardise on ARKit rather than a hand-picked
subset.
