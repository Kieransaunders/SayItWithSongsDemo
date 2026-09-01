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
