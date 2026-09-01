<!-- GSD: verified against the live project on 2026-08-26 -->

# Code-Driven Lip Sync

## Purpose

This document records the browser-based lip-sync work completed for the Aria Blake model. The browser now controls the model's exported facial morph targets directly from timestamped JSON cues. The baked Blender lip-sync animation remains inside the GLB, but the viewer does not play it.

The current implementation is a development preview. It is not yet connected to the main MindAR raccoon-and-bear scene.

## Current artifacts

| File | Role |
| --- | --- |
| `assets/aria-mouth-viewer.html` | Three.js viewer, audio controls, JSON cue reader and live morph-target driver |
| `assets/aria-mouth-test.glb` | Aria model with 52 ARKit-compatible facial morph targets |
| `assets/HappyBirthday.wav` | Full song used during playback |
| `assets/HappyBirthday.vocals.wav` | Vocal-only reference used to analyse and align the lyrics |
| `assets/HappyBirthday.vocals.rhubarb.json` | Active, manually corrected mouth-cue timeline |
| `assets/HappyBirthday.vocals.rhubarb.raw.json` | Original Rhubarb output retained as a recoverable source |
| `assets/HappyBirthday.expressions.json` | Independent smile, cheek, brow, blink, nod and head-tilt performance |
| `assets/lyrics.txt` | Authoritative lyric text |

## Runtime flow

1. The viewer loads Three.js and `aria-mouth-test.glb`.
2. It finds every mesh node that exposes supported ARKit morph targets.
3. It fetches `HappyBirthday.vocals.rhubarb.json` and `HappyBirthday.expressions.json`.
4. Audio time is treated as the authoritative playback clock.
5. On every rendered frame, the viewer finds the active JSON cue.
6. The cue is converted to an ARKit morph-target pose.
7. Expression tracks are sampled at the same audio time and layered over the mouth pose.
8. The combined pose is applied to every compatible mesh node.
9. During the last 65 milliseconds of a mouth cue, the viewer smoothly blends into the next pose.

Seeking with the timeline applies the corresponding pose immediately. Pausing freezes the current pose, while Stop returns the audio, timeline and mouth to time zero.

## Model compatibility

The exported GLB has one facial mesh with 52 ARKit-compatible morph targets. Important names include:

- `jawOpen`
- `mouthClose`
- `mouthFunnel`
- `mouthPucker`
- `mouthSmileLeft` and `mouthSmileRight`
- `mouthPressLeft` and `mouthPressRight`
- `mouthStretchLeft` and `mouthStretchRight`
- `mouthLowerDownLeft` and `mouthLowerDownRight`
- `mouthRollLower`

The code currently controls 13 of the 52 targets. It searches by morph-target name, so compatible meshes can be added without hard-coding mesh names or indices.

## Mouth-pose system

The active timeline uses eight mouth poses plus rest. Each pose combines one or more ARKit targets:

| Cue | Intended sound | Main morph-target treatment |
| --- | --- | --- |
| `A` | MBP | Mouth closed with left/right lip press |
| `B` | S and brief tongue/teeth consonants | Small jaw opening with horizontal mouth stretch |
| `C` | Eh and transitional vowels | Moderate jaw opening, stretch and lower-lip movement |
| `D` | Ah | Strong jaw opening with lower-lip movement |
| `E` | Oo | Funnel and pucker with a small jaw opening |
| `F` | Ooh | Softer funnel/pucker with a larger jaw opening |
| `G` | Fv | Rolled lower lip, light lip press and minimal jaw opening |
| `H` | Ai/Ee | Jaw opening with smile and horizontal stretch |
| `X` | Rest | No speech pose |

The code can mix several morph targets for one sound, so these are reusable poses rather than separate model animations.

## JSON timing format

The active JSON contains a continuous array of cues:

```json
{
  "start": 15.5,
  "end": 16.18,
  "value": "E"
}
```

- `start` and `end` are seconds on the song timeline.
- `value` selects one of `A` through `H`, or `X` for rest.
- Cues must be ordered, must not overlap and should not leave unintended gaps.

The current file contains 128 continuous cues. The original Rhubarb result contained 101 cues and frequently flattened sung passages into one long generic mouth shape.

## Singing-specific corrections

Speech-oriented recognition was not sufficient for the chorus because singing sustains vowels far longer than ordinary speech. The corrected timeline follows these rules:

- Keep consonants such as B, P, M and T brief.
- Hold the vowel for most of the sung note.
- Use a short transitional pose when moving between substantially different vowels.
- Insert rest only where the singer genuinely pauses.
- Blend between adjacent cues instead of snapping instantly.

### “To yah”

All four occurrences use the same lyric-aware pattern:

1. `B` — brief T/S-like tongue and teeth position.
2. `E` — held Oo for “to.”
3. `C` — short Y/Eh transition.
4. `D` — held Ah for “yah.”

The individual durations are aligned to each occurrence rather than copied as one fixed-length animation.

### “On the day you came to be”

The section from approximately 11.82 to 13.66 seconds was rebuilt manually from the vocal-only recording and aligned lyrics. It now contains 14 changes instead of holding a generic S-like shape through most of the line.

### “Happy birthday”

The chorus occurrences were rebuilt using word-level timings. Each phrase now includes:

- An open vowel for “ha.”
- A brief closed-lip P transition.
- A held ending vowel for “happy.”
- A closed-lip B at the beginning of “birthday.”
- A central vowel for “birth.”
- A brief tongue/teeth transition.
- A held Ai/Ee ending for “day.”

## Opening smile

The smile is a track in `HappyBirthday.expressions.json` rather than another speech cue. This prevents it from changing the lyric alignment.

- Smile strength: `0.46`
- Full smile held until: `0.65` seconds
- Smile completely faded by: `1.15` seconds
- Targets: `mouthSmileLeft` and `mouthSmileRight`

The smile is visible as soon as the model loads and fades smoothly into the first lyric. During singing, the expression smile yields to active phonemes so that pucker, funnel and closed-lip shapes are not pulled in conflicting directions. If the phoneme itself contains smile, the stronger value wins instead of adding both values together.

## Expression performance

`HappyBirthday.expressions.json` contains independently editable keyframe tracks. Values are smoothly interpolated between keyframes.

| Track | Targets or transform | Current use |
| --- | --- | --- |
| `smile` | `mouthSmileLeft`, `mouthSmileRight` | Warm opening, verse accents and stronger chorus/final smiles |
| `cheekSquint` | `cheekSquintLeft`, `cheekSquintRight` | Makes stronger smiles affect the upper face |
| `browInnerUp` | `browInnerUp` | “Love you,” the question phrase and gentle emotional emphasis |
| `browOuterUp` | `browOuterUpLeft`, `browOuterUpRight` | Opening expression and accents on each “Happy” |
| `blink` | `eyeBlinkLeft`, `eyeBlinkRight` | Natural blinks approximately every three to five seconds, mainly between phrases |
| `headPitch` | Character pivot X rotation | Gentle nods near “agree,” “party” and the final “to you” |
| `headRoll` | Character pivot Z rotation | Alternating two-to-four-degree head tilts across the song |

The exported test GLB contains no head or neck armature. The viewer therefore creates a pivot at head height and rotates the complete character mesh around it. This reads naturally in the current head-and-shoulders framing, but a production full-body model should export a dedicated head/neck bone.

## Running the preview

The viewer should be served rather than opened directly with a `file://` URL. Browser modules, JSON fetching and audio loading are more reliable over localhost or HTTPS.

From the project directory:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/assets/aria-mouth-viewer.html
```

Press Play for normal playback or drag the timeline to inspect a specific mouth pose.

## Editing and verification procedure

When a lyric looks wrong:

1. Note the approximate time shown beside the viewer timeline.
2. Listen to the same section in `HappyBirthday.vocals.wav`.
3. Confirm the words in `lyrics.txt`.
4. Inspect the active cues covering that time in `HappyBirthday.vocals.rhubarb.json`.
5. Keep consonants short and allocate most of the word duration to its sung vowel.
6. Preserve continuous cue boundaries.
7. Reload the served viewer and inspect the start, middle and end of the word.
8. Check the browser console for model, JSON or audio-loading errors.

The active JSON has been validated for legal cue names, positive durations and continuous boundaries. The opening smile, the “on the day” section, the chorus and the “to yah” sequences have also been visually checked in the browser.

## Current limitations

- Eight generic visemes cannot represent every tongue and lip detail of natural singing.
- Each cue currently has timing but no per-cue strength value.
- A sustained vowel holds one main pose; it does not yet respond subtly to vocal loudness or pitch.
- The viewer is a standalone Three.js test and is not yet the production AR-card player.
- Eye gaze and body performance are not currently animated.
- Nods and tilts rotate the complete morph-only character around a head-height pivot because the test GLB has no head/neck armature.

## Recommended next improvements

1. Add optional `strength` values to cues so repeated sounds can have different mouth intensity.
2. Derive a gentle amplitude envelope from the vocal-only WAV and use it to add movement within sustained vowels.
3. Build a waveform-and-lyrics cue editor for visual timing adjustments.
4. Record webcam facial capture as timestamped ARKit-compatible coefficients and replay it through the same morph-target driver.
5. Optionally support iPhone ARKit capture for higher-fidelity facial performances.
6. Connect the finished driver to MindAR so target detection starts the song and facial performance together, while target loss pauses or resets both.

For deployment, the JSON-replay approach remains easiest to revise. Once the performance is final, it can optionally be baked into a GLB animation for portability.
