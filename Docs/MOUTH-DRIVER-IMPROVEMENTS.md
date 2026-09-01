<!-- GSD: assessment against assets/aria-mouth-viewer.html as of 2026-08-27 -->

# Mouth-Shape Driver — Improvement Plan

## Purpose

This document records recommended improvements to the code-driven mouth-shape system in `assets/aria-mouth-viewer.html`, together with tasks and example code for each. It follows an assessment against the Meta Horizon blendshape reference:

> <https://developers.meta.com/horizon/documentation/unreal/move-ref-blendshapes/>

That page is a **visual reference** for the OpenXR `XrFaceExpression2FB` set (70 expressions, `JAW_DROP` / `LIP_FUNNELER_LB` style names), 15 visemes (AA, CH, DD, E, FF, IH, KK, NN, OH, OU, PP, RR, SIL, SS, TH) and 7 tongue shapes cross-referenced to visemes. It contains no weight ranges or tuning guidance — its value to this project is architectural:

| Concept from the Meta reference | Relevance to this codebase |
| --- | --- |
| 15-viseme vocabulary | Rhubarb's 9-cue alphabet (A–H, X) merges sounds Meta treats as distinct. `B` alone covers SS/TH/DD/NN/KK/CH. |
| Tongue shapes | Consonant identity lives on the tongue (NN, KK, TH). The ARKit-52 export has no tongue targets, capping consonant quality. |
| Per-quadrant lip control (`LIP_FUNNELER_LB/LT/RB/RT`) | Our driver is strictly symmetric L/R. Subtle asymmetry removes the uncanny perfectly-symmetric look. |
| OpenXR naming convention | An ARKit ↔ OpenXR alias table keeps pose data portable and lets us consume OpenXR-format capture later. |

## Status

T1, T2, T4, T5 and T11 have landed in **`assets/aria-mouth-viewer-v2.html`** + `assets/lipsync-driver.js`
(2026-08-27). `assets/aria-mouth-viewer.html` is deliberately left untouched as the A/B control — see
"Comparing v1 and v2" at the end of this document.

## Task summary

Tasks are ordered by impact. Line numbers refer to `assets/aria-mouth-viewer.html` as of 2026-08-27 and will drift as edits land.

- [x] **T1** — Drive `jawOpen` from the vocal amplitude envelope (highest realism gain)
- [x] **T2** — Extract a reusable `LipSyncDriver` (required for the MindAR port)
- [ ] **T3** — Expand the viseme vocabulary with a phoneme source (~15 visemes)
- [x] **T4** — Make rest a real pose; consolidate smile conflict rules
- [x] **T5** — Fix the artist-pose race; make pose sets data-driven
- [ ] **T6** — Per-target smoothing (slow jaw, fast lips)
- [ ] **T7** — Subtle L/R asymmetry
- [ ] **T8** — Per-cue `strength` values
- [ ] **T9** — Variable transition times per pose class
- [ ] **T10** — ARKit ↔ OpenXR alias table
- [x] **T11** — Fix the gap→rest snap; document combine semantics
- [ ] **T12** — Model-side: export tongue morph targets (artist task, optional)

---

## T1 — Amplitude-driven jaw movement

**Problem.** A sustained vowel holds one static pose. The `SUSTAIN_HOLD` / `SUSTAIN_RAMP` / `SUSTAIN_FLOOR` timer (lines 137–149, applied in `sustainScale`, line 186) decays the jaw on a fixed curve, so every held note collapses identically regardless of how loudly it is sung.

**Fix.** Decode `HappyBirthday.vocals.wav` once, precompute an RMS loudness envelope, and use it to scale the jaw-carrying targets instead of the timer ramp. This is already item 2 in "Recommended next improvements" of `CODE-DRIVEN-LIP-SYNC.md`.

**Example code.**

```js
// amplitude.js — build once at load, sample per frame. No per-frame allocation.
async function buildEnvelope(url, samplesPerSecond = 60) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();

  // Mix every channel down to mono power.
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] * data[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= audioBuffer.numberOfChannels;

  // RMS per bucket, normalised so the loudest bucket of the song = 1.
  const window = Math.max(1, Math.round(audioBuffer.sampleRate / samplesPerSecond));
  const buckets = Math.ceil(length / window);
  const envelope = new Float32Array(buckets);
  let peak = 0;
  for (let b = 0; b < buckets; b++) {
    let sum = 0;
    const end = Math.min((b + 1) * window, length);
    for (let i = b * window; i < end; i++) sum += mono[i];
    const rms = Math.sqrt(sum / Math.max(1, end - b * window));
    envelope[b] = rms;
    peak = Math.max(peak, rms);
  }
  if (peak > 0) for (let b = 0; b < buckets; b++) envelope[b] /= peak;

  return {
    sample(time) {
      const t = THREE.MathUtils.clamp(time * samplesPerSecond, 0, buckets - 1);
      const i = t | 0;
      const frac = t - i;
      const a = envelope[i];
      const b = envelope[Math.min(i + 1, buckets - 1)];
      return a + (b - a) * frac; // linear interp is enough; the value is smoothed again below
    }
  };
}

// State that replaces SUSTAIN_FLOOR's role:
let envelopePromise = buildEnvelope('HappyBirthday.vocals.wav');
let envelope = null;
envelopePromise.then(e => { envelope = e; });

// In poseAt(): replace sustainScale()'s timer ramp with the envelope.
// - The vocal-only WAV means no instrument leaks into the measurement.
// - floor/ceiling keep quiet syllables readable and stop peaks from over-opening.
// - The 0.35s smoother emulates jaw inertia and removes RMS ripple.
let smoothedEnvelope = 0;
const lastEnvelopeTime = { value: -1 };

function envelopeScale(cue, time) {
  if (!envelope) return 1;
  if (lastEnvelopeTime.value >= 0) {
    const dt = Math.max(0, time - lastEnvelopeTime.value);
    // Exponential move toward the target with a ~0.35 s time constant.
    const k = 1 - Math.exp(-dt / 0.35);
    smoothedEnvelope += (envelope.sample(time) - smoothedEnvelope) * k;
  } else {
    smoothedEnvelope = envelope.sample(time);
  }
  lastEnvelopeTime.value = time;
  const shaped = 0.55 + 0.45 * smoothedEnvelope; // 0.55 floor … 1.0 at song peak
  return THREE.MathUtils.clamp(shaped, 0.5, 1.05);
}
```

Then in `poseAt` (line 224) the jaw-carrying targets take the envelope scale:

```js
const from = (current[name] || 0)
  * (SUSTAIN_TARGETS.includes(name) ? envelopeScale(cue, time) : 1);
```

`SUSTAIN_HOLD`, `SUSTAIN_RAMP` and `SUSTAIN_FLOOR` can be retired once this is tuned. Keep the "only the jaw settles, lips hold their posture" behaviour encoded in `SUSTAIN_TARGETS` (lines 142–146) — that reasoning still stands; only the driver of the scale changes.

**Verify.** Play 15–19 s (a held chorus note). The jaw should visibly track loudness within the note instead of sagging on a timer. Check the console: the envelope build should log once, before `Ready`.

---

## T2 — Extract a reusable `LipSyncDriver`

**Problem.** `poseAt`, `expressionPoseAt`, and `applyPerformance` (lines 192–308) are entangled with the viewer's audio element, timeline, and `THREE` renderer. The stated goal (`CODE-DRIVEN-LIP-SYNC.md`, next-improvement 6) is to drive the face from the MindAR card scene — that requires the engine to be movable and allocation-free. Two concrete per-frame costs today:

- `mesh.morphTargetDictionary[name]` lookups run every frame for every mesh (line 284) — they should be precomputed index maps.
- `new THREE.Quaternion().setFromEuler(new THREE.Euler(...))` (line 302) and per-frame `pose` objects (line 222) create GC churn, which matters on a phone already running AR tracking.

**Fix.** Move the engine to `assets/lipsync-driver.js` with a pure `poseAt(time)` API. The viewer (and later the MindAR scene) owns audio and rendering; the driver owns cues, poses, expressions, and combining.

**Example code.**

```js
// assets/lipsync-driver.js
import * as THREE from 'three';

export class LipSyncDriver {
  constructor({ poses, expressionTargets, combineRules, transitionSeconds = 0.065 }) {
    this.poses = poses;
    this.expressionTargets = expressionTargets;
    this.combineRules = combineRules;       // see T4
    this.transitionSeconds = transitionSeconds;
    this.controlledMorphs = [...new Set(Object.values(poses).flatMap(Object.keys))];
    // Preallocated scratch pose — poseAt() writes into this and returns it.
    // Callers must consume it before the next call.
    this._scratch = {};
    this._euler = new THREE.Euler();
    this._quat = new THREE.Quaternion();
  }

  setCues(mouthCues) { this.mouthCues = mouthCues; }
  setExpressionTracks(tracks) { this.expressionTracks = tracks; }

  // Attach once per mesh. Returns the precomputed index map used by apply().
  bindMesh(mesh) {
    const map = {};
    let any = false;
    for (const name of this.allMorphs()) {
      const index = mesh.morphTargetDictionary[name];
      if (index !== undefined) { map[name] = index; any = true; }
    }
    return any ? map : null;
  }

  allMorphs() {
    const expressionMorphs = Object.values(this.expressionTargets).flat();
    return [...new Set([...this.controlledMorphs, ...expressionMorphs])];
  }

  poseAt(time) { /* move poseAt() + expressionPoseAt() here, writing into this._scratch */ return this._scratch; }

  // Apply a pose with zero allocations. bindMesh() maps must be passed in.
  apply(time, boundMeshes, headBone, headBaseQuaternion) {
    const pose = this.poseAt(time);
    for (const { mesh, map } of boundMeshes) {
      const influences = mesh.morphTargetInfluences;
      for (const name in map) {
        influences[map[name]] = this.combine(name, pose);
      }
    }
    if (headBone) {
      const pitch = THREE.MathUtils.degToRad(this.trackAt('headPitch', time));
      const roll  = THREE.MathUtils.degToRad(this.trackAt('headRoll', time));
      this._euler.set(pitch, 0, roll);
      this._quat.setFromEuler(this._euler);
      headBone.quaternion.copy(headBaseQuaternion).multiply(this._quat);
    }
  }
}
```

The viewer then shrinks to load → `bindMesh` → `apply(audio.currentTime)` in its render loop, and the MindAR integration (target found → play, target lost → pause/reset) touches only audio and `apply`, never pose internals.

**Verify.** Identical behaviour before and after the refactor at the same timestamps (drag the timeline to 5.9 s, 11.82 s, 20.12 s). Then load `?model=brunette-viseme-test.glb` to prove the driver is model-agnostic.

---

## T3 — Expand the viseme vocabulary (~15 visemes)

**Problem.** Rhubarb's output alphabet is 9 cues. `B` covers S, TH, T, D, N, L, K, G, SH, CH — all one shape. Meta's reference splits these because lip position alone cannot distinguish them. Note: `HappyBirthday.rhubarb.phonetic.json` is **not** phoneme-level data (verified: same A–X alphabet, 164 cues, 56 of them `B`) — Rhubarb never exposes phonemes.

**Fix.** Produce a phoneme timeline by forced-aligning `assets/lyrics.txt` against `assets/HappyBirthday.vocals.wav` (WhisperX, Montreal Forced Aligner, or aeneas), then map phonemes onto a ~15-viseme table modelled on Meta's set. Keep the existing `POSES` structure — visemes are just more entries.

**Example code.**

```js
// visemes.js — vocabulary modelled on Meta's 15-viseme reference.
// Keys are Meta viseme names so the intent is unambiguous; values use ARKit
// morph names exactly like today's POSES entries.
const VISEMES = {
  SIL: {},                                                          // silence
  PP: { V_Explosive: 1.0, mouthPressLeft: 0.3, mouthPressRight: 0.3 }, // P/B/M (today's A)
  FF: { jawOpen: 0.06, mouthRollLower: 0.58 },                      // F/V (today's G)
  TH: { jawOpen: 0.10, tongueTipInterdental: 1.0 },                 // needs T12 tongue morphs
  DD: { jawOpen: 0.14, mouthStretchLeft: 0.35, mouthStretchRight: 0.35 }, // T/D — was inside B
  KK: { jawOpen: 0.16, tongueBackDorsalVelar: 1.0 },                // K/G — was inside B
  CH: { jawOpen: 0.10, mouthFunnel: 0.35, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 }, // CH/SH — was inside B
  SS: { jawOpen: 0.08, mouthStretchLeft: 0.42, mouthStretchRight: 0.42 }, // S/Z (today's B)
  NN: { jawOpen: 0.10, tongueTipAlveolar: 1.0 },                    // N/L — was inside B
  RR: { jawOpen: 0.34, mouthFunnel: 0.5 },                          // R (part of today's E)
  IH: { jawOpen: 0.22, mouthStretchLeft: 0.3, mouthStretchRight: 0.3 },  // ih/iy (part of today's H)
  E:  { jawOpen: 0.30, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },  // eh/ae (today's C)
  AA: { jawOpen: 0.78, mouthLowerDownLeft: 0.34, mouthLowerDownRight: 0.34 }, // ah (today's D)
  OH: { jawOpen: 0.4, mouthFunnel: 0.72, mouthPucker: 0.32 },       // ao/er (today's E)
  OU: { V_Tight_O: 0.9, jawOpen: 0.08, mouthFunnel: 0.45, mouthPucker: 0.55 } // uw/ow/w (today's F)
};

// ARPABET (WhisperX/MFA output) → viseme. Extend per lyrics vocabulary.
const PHONEME_TO_VISEME = {
  SIL: 'SIL', P: 'PP', B: 'PP', M: 'PP', F: 'FF', V: 'FF',
  TH: 'TH', DH: 'TH', T: 'DD', D: 'DD', K: 'KK', G: 'KK',
  CH: 'CH', JH: 'CH', SH: 'CH', ZH: 'CH', S: 'SS', Z: 'SS',
  N: 'NN', L: 'NN', R: 'RR', IY: 'IH', IH: 'IH', IY: 'IH',
  EH: 'E', AE: 'E', AA: 'AA', AO: 'OH', ER: 'OH',
  UW: 'OU', OW: 'OU', W: 'OU', AY: 'AA', AW: 'OH', OY: 'OU'
};

// Alignment output → the same continuous cue format the driver already reads.
function phonemesToCues(alignmentWords) {
  const cues = [];
  for (const word of alignmentWords) {
    for (const phoneme of word.phonemes) {
      const value = PHONEME_TO_VISEME[phoneme.label] || 'SS';
      cues.push({ start: phoneme.start, end: phoneme.end, value });
    }
  }
  return normaliseCues(cues); // sort, merge duplicates, close gaps — reuse the manual-correction rules
}
```

**Migration path.** Land it as `?cues=visemes` next to the existing source rather than replacing the hand-corrected timeline. The singing-specific corrections documented in `CODE-DRIVEN-LIP-SYNC.md` (hold the vowel through the sung note, keep consonants brief) then become a post-processing pass over the aligned phonemes instead of manual JSON surgery — which also makes the next song cheap.

**Verify.** "Happy birthday to you" should show distinct shapes for the H/PP in "happy", the B in "birthday", and the T in "to". Today all three consonants share at most two shapes.

---

## T4 — Rest as a real pose; consolidate smile conflict rules

**Problem.** `X: {}` (line 121) snaps every morph to absolute zero. Two patches exist to compensate: `RESTING_SMILE` (line 149, applied at lines 253–254) and the smile-vs-mouth arbitration spread across lines 276–291. Three separate special cases for one underlying problem.

**Fix.** Give the tuned set a real rest pose (the artist's `face-poses.json` `restBaseline` already models this correctly: `jawOpen: 0.127, smile: 0.159`), and declare per-target combine rules in one place.

**Example code.**

```js
const REST = { jawOpen: 0.10, mouthSmileLeft: 0.14, mouthSmileRight: 0.14 };
// POSES.X = REST;  // rest is now just another pose — blending toward it works for free

// One table replaces the three special cases in applyPerformance().
// additive: expression layer adds onto the mouth pose (brows, cheeks…)
// max:      stronger of mouth pose or expression wins (smile)
// gated:    expression is scaled down when the mouth pose needs the lips
const COMBINE_RULES = {
  additive: null, // default for every target not listed below
  max: ['mouthSmileLeft', 'mouthSmileRight'],
  gated: { targets: ['mouthSmileLeft', 'mouthSmileRight'], by: ['mouthFunnel', 'mouthPucker'] }
};

function combineValue(name, mouthValue, expressionValue) {
  if (COMBINE_RULES.max.includes(name)) return Math.max(mouthValue, expressionValue);
  return mouthValue + expressionValue;
}

// The gate replaces the inline smileCompatibility block (lines 276–281):
function gatedExpression(name, expressionPose, mouthPose) {
  const gate = COMBINE_RULES.gated;
  if (!gate || !gate.targets.includes(name)) return expressionPose[name] || 0;
  const mouthActivity = Math.max(0, mouthPose[gate.by[0]] || 0, mouthPose[gate.by[1]] || 0);
  return (expressionPose[name] || 0) * (1 - smoothstep((mouthActivity - 0.05) / 0.25));
}
```

`RESTING_SMILE` then disappears — the floor lives in `REST` where it can be blended, not `Math.max`-ed.

**Verify.** Stop playback: the face should settle to the rest pose with its slight smile, not zero. The "to yah" E→D sequence should keep today's behaviour (smile yields during the rounded E, returns on the open D).

---

## T5 — Fix the artist-pose race; data-driven pose sets

**Problem (corrected 2026-08-27).** The race described here does not exist. Line 341's `await` is a
*top-level module await*, so `loader.load` at line 353 cannot run until `face-poses.json` resolves —
`CONTROLLED_MORPHS` / `DRIVEN_MORPHS` are always final before mesh filtering at line 357, in every
ordering. The verification below passes on the unmodified v1. What remains is real but smaller: the
pose set is applied by *mutating* module-level lists, which is fragile to reorder later.

**What landed in v2.** The artist set is handed to `driver.setPoses()`, which recomputes the morph
list internally; nothing at module level is mutated. `POSES` stays inline rather than moving to
`mouth-poses-tuned.json` — the comments at lines 103–121 (`V_Explosive` vs `mouthClose`, the E/F
inversion, `V_Tight_O`) are the most expensive knowledge in the file and JSON would drop them.

**Fix.** Load every pose set as immutable JSON before mesh collection, then select. Fold the CC4-extras fallback (`V_Explosive`, `V_Tight_O`) into the same loader.

**Example code.**

```js
// All sets load before the model; selection is a lookup, not a mutation.
const POSE_LIBS = {
  tuned:  'mouth-poses-tuned.json',   // today's inline POSES, moved out verbatim
  artist: 'face-poses.json'
};

async function loadPoseSet(name) {
  if (name === 'artist') {
    const lib = await (await fetch(POSE_LIBS.artist, { cache: 'no-store' })).json();
    const poses = {};
    for (const [cue, poseName] of Object.entries(lib.cueMap)) poses[cue] = lib.mouth[poseName] || {};
    poses.X = lib.restBaseline || {};
    return poses;
  }
  return (await (await fetch(POSE_LIBS.tuned, { cache: 'no-store' })).json());
}

const poseSetPromise = loadPoseSet(POSE_SET);   // started immediately
const posesReady = poseSetPromise.then(poses => { driver.setPoses(poses); });

// Gate mesh collection AND playback on the same promise:
loader.load(MODEL, gltf => {
  …
  poseSetPromise.then(() => {
    for (candidate meshes) { const map = driver.bindMesh(mesh); if (map) boundMeshes.push({mesh, map}); }
    modelReady = true;
    setReadyState();
  });
});
```

**Verify.** Hard-reload `?poses=artist` ten times with DevTools network throttling (Fast 3G) so model and poses resolve in different orders; the console pose set and the driven mesh count must be stable.

---

## T6 — Per-target smoothing (slow jaw, fast lips)

**Problem.** Blending is purely time-based smoothstep between static poses. Every target moves at the same rate, so the jaw snaps as fast as the lips — real jaws have inertia. A smoother also softens very short cues in a way the fixed 65 ms window (line 135) cannot.

**Example code.**

```js
// Per-target exponential smoother applied AFTER the pose mixer, BEFORE apply().
// tau ≈ 0.02–0.03 s for lips, ≈ 0.08–0.10 s for the jaw and head rotation.
const SMOOTHING_TAU = {
  default: 0.03,
  jawOpen: 0.09, mouthLowerDownLeft: 0.07, mouthLowerDownRight: 0.07,
  headPitch: 0.10, headRoll: 0.10
};

const smoothState = {};   // name → last output; lives across frames
let lastSmoothTime = -1;

function smoothPose(pose, time) {
  const dt = lastSmoothTime < 0 ? 0 : Math.min(0.1, time - lastSmoothTime);
  lastSmoothTime = time;
  for (const name in pose) {
    const tau = SMOOTHING_TAU[name] || SMOOTHING_TAU.default;
    const k = 1 - Math.exp(-dt / tau);
    smoothState[name] = (smoothState[name] === undefined ? pose[name]
                         : smoothState[name] + (pose[name] - smoothState[name]) * k);
    pose[name] = smoothState[name]; // write back into the scratch pose — no allocation
  }
  return pose;
}
```

**Caution.** The smoother adds latency to onsets; consonants must still read. Tune `tau` per target while scrubbing the "on the day you came to be" section (11.82–13.66 s), which has the densest cue changes. Reset `smoothState` when seeking (`smoothState` = target pose on a timeline jump, not filtered from the old position).

**Verify.** The 65 ms transitions should look identical, but rapid D→B→D sequences should gain visible jaw weight instead of teleporting.

---

## T7 — Subtle L/R asymmetry

**Problem.** Every pose drives L/R pairs with identical values (see `POSES`, lines 107–121). Perfect symmetry is a classic uncanny-valley tell; Meta's per-quadrant shapes (`LIP_FUNNELER_LB/LT/RB/RT`) exist for exactly this control.

**Example code.**

```js
// Slow, bounded per-side noise — deterministic per performance, zero allocation.
// Keep it SMALL: this should read as "organic", never as "wobbly".
const ASYMMETRY = 0.03;  // ±3% of the target value

function asymmetry(name, time) {
  if (!name.endsWith('Left') && !name.endsWith('Right')) return 1;
  const side = name.endsWith('Left') ? 1 : -1;
  // Two incommensurate sines per side: cheap, smooth, never visibly periodic.
  const n = Math.sin(time * 1.7 + side * 2.3) * 0.6 + Math.sin(time * 3.1 + side * 4.7) * 0.4;
  return 1 + n * ASYMMETRY;
}

// In the apply loop:
influences[map[name]] = combinedValue * asymmetry(name, time);
```

**Verify.** Freeze playback at several held vowels; the mouth corners should differ slightly between frames. A/B `?asym=0` vs default — if a viewer can name "one looks wobbly", halve `ASYMMETRY`.

---

## T8 — Per-cue `strength` values

**Problem.** Documented limitation: "Each cue currently has timing but no per-cue strength value." Repeated `D` cues (every "yah", every "day") open identically regardless of emphasis.

**Example code.**

```json
// JSON: optional strength per cue, defaulting to 1.
{ "start": 11.82, "end": 12.9, "value": "D", "strength": 0.85 },
{ "start": 12.9, "end": 13.1, "value": "C", "strength": 1.1 }
```

```js
// poseAt(): scale jaw-carrying targets only. Scaling pucker/funnel by strength
// flattens quiet rounded vowels into neutral — the same reasoning that keeps
// them out of SUSTAIN_TARGETS.
const strength = cue.strength ?? 1;
const from = (current[name] || 0)
  * (SUSTAIN_TARGETS.includes(name) ? envelopeScale(cue, time) * strength : 1);
```

**Verify.** Set the final "to yah" `D` to 1.15 and the verse ones to 0.85; the final one should read as the louder sung note it is.

---

## T9 — Variable transition times per pose class

**Problem.** One global `TRANSITION_SECONDS` (line 135) means plosive closures (A/PP) glide at the same speed as vowel-to-vowel slides. Real plosive closure is near-instant; vowel glides are slow.

**Example code.**

```js
// Per-pose transition overrides, seconds. Unlisted poses use the global default.
const TRANSITION_OVERRIDES = {
  A: 0.03,   // MBP closure must land fast or it reads as a mushy "mmm"
  G: 0.04,   // F/V contact
  E: 0.09,   // rounded vowel glides
  F: 0.09
};

// In poseAt(), the `half` helper consults the override of whichever pose the
// blend is moving INTO (a closure into A is fast; leaving A toward a vowel
// uses the vowel's slower glide):
const half = (boundary, intoName) => Math.min(
  (TRANSITION_OVERRIDES[intoName] ?? TRANSITION_SECONDS) * 0.5,
  (cue.end - cue.start) * 0.4,
  boundary ? (boundary.end - boundary.start) * 0.4 : Infinity
);
// outgoing: half(next, next.value)   incoming: half(prev, cue.value)
```

**Verify.** "Happy" should gain a crisp P. Slow the page with DevTools CPU throttling ×4 and confirm closures still land before the vowel onset.

---

## T10 — ARKit ↔ OpenXR alias table

**Problem / opportunity.** Meta's runtime names shapes in OpenXR convention (`JAW_DROP`, `LIP_FUNNELER_LB`…). An alias layer makes pose JSONs portable to Meta runtimes and lets OpenXR-format face capture drive this model later (the webcam/ARKit capture idea in `CODE-DRIVEN-LIP-SYNC.md` gains a second source format for free).

**Example code.**

```js
// aliases.js — ARKit-52 camelCase ↔ OpenXR XrFaceExpression2FB.
// Merged pairs (e.g. four LipFunneler quadrants → one mouthFunnel) mean the
// mapping is lossy ARKit→OpenXR-per-quadrant; that is fine for driving,
// documented here so nobody assumes round-trip fidelity.
const ARKIT_TO_OPENXR = {
  jawOpen: 'JAW_DROP',               jawForward: 'JAW_THRUST',
  mouthFunnel: 'LIP_FUNNELER_L',     mouthPucker: 'LIP_PUCKER',
  mouthPressLeft: 'LIP_PRESSOR_L',   mouthPressRight: 'LIP_PRESSOR_R',
  mouthRollLower: 'LIP_SUCK_B',      mouthRollUpper: 'LIP_SUCK_T',
  mouthSmileLeft: 'LIP_CORNER_PULLER_L', mouthSmileRight: 'LIP_CORNER_PULLER_R',
  mouthFrownLeft: 'LIP_CORNER_DEPRESSOR_L', mouthFrownRight: 'LIP_CORNER_DEPRESSOR_R',
  mouthStretchLeft: 'LIP_STRETCHER_L', mouthStretchRight: 'LIP_STRETCHER_R',
  mouthDimpleLeft: 'DIMPLER_L',      mouthDimpleRight: 'DIMPLER_R',
  mouthLowerDownLeft: 'LOWER_LIP_DEPRESSOR_L', mouthLowerDownRight: 'LOWER_LIP_DEPRESSOR_R',
  mouthUpperUpLeft: 'UPPER_LIP_RAISER_L',     mouthUpperUpRight: 'UPPER_LIP_RAISER_R',
  mouthLeft: 'MOUTH_LEFT',           mouthRight: 'MOUTH_RIGHT',
  mouthShrugLower: 'CHIN_RAISER_B',  mouthShrugUpper: 'CHIN_RAISER_T',
  cheekSquintLeft: 'CHEEK_RAISER_L', cheekSquintRight: 'CHEEK_RAISER_R',
  cheekPuff: 'CHEEK_PUFF_L',         browInnerUp: 'INNER_BROW_RAISER_L',
  browDownLeft: 'BROW_LOWERER_L',    browDownRight: 'BROW_LOWERER_R',
  browOuterUpLeft: 'OUTER_BROW_RAISER_L', browOuterUpRight: 'OUTER_BROW_RAISER_R',
  eyeBlinkLeft: 'EYES_CLOSED_L',     eyeBlinkRight: 'EYES_CLOSED_R',
  eyeSquintLeft: 'LID_TIGHTENER_L',  eyeSquintRight: 'LID_TIGHTENER_R',
  eyeWideLeft: 'UPPER_LID_RAISER_L', eyeWideRight: 'UPPER_LID_RAISER_R',
  noseSneerLeft: 'NOSE_WRINKLER_L',  noseSneerRight: 'NOSE_WRINKLER_R'
};
const OPENXR_TO_ARKIT = Object.fromEntries(
  Object.entries(ARKIT_TO_OPENXR).map(([arkit, openxr]) => [openxr, arkit]));

// Lookups in bindMesh() accept either convention, and CC4 extras stay as
// direct names with a documented ARKit fallback (already the pattern at
// lines 104–118):
function resolveMorphName(name, dictionary) {
  return dictionary[name] !== undefined ? name : OPENXR_TO_ARKIT[name];
}
```

**Verify.** Load a pose JSON written in OpenXR names (`?poses=openxr-test`) — the face must match the ARKit-named equivalent exactly.

---

## T11 — Fix the gap→rest snap; document combine semantics

**Problem 1.** `findCueIndex` returns −1 on any gap and `poseAt` returns `POSES.X` instantly (lines 193–194) — a hard snap with no blend. The hand-corrected timeline is continuous, but the phonetic file contains X gaps, so swapping cue sources (T3) will visibly pop.

**Problem 2.** The clamp to `[-1, 1]` (line 294) correctly preserves the artist's negative influences, but the additive combine for non-smile targets can exceed 1 and clip silently.

**Example code.**

```js
// 1. No cue covers `time` → blend toward rest over the normal transition window
//    instead of snapping. Track when the last cue ended:
if (index < 0) {
  const previous = mouthCues[0] && time < mouthCues[0].start ? null
    : [...mouthCues].reverse().find(c => c.end <= time);
  if (!previous) return REST;
  const gap = (time - previous.end) / TRANSITION_SECONDS;
  return gap >= 1 ? REST : blend(POSES[previous.value] || REST, REST, smoothstep(gap));
}
```

```js
// 2. Combine semantics, stated once where the values are produced:
//    - mouth + expression is ADDITIVE for non-mouth-conflict targets;
//      sums may exceed ±1 and are clamped to the model's [-1, 1] range —
//      overlapping full-strength layers are an authoring error, not
//      something the runtime should hide.
//    - smile targets combine with max() and are gated by rounded shapes.
```

**Verify.** Load the phonetic JSON as the cue source with the fix: transitions into and out of its X gaps must ease, not pop.

---

## T12 — Model-side: export tongue morph targets (artist task)

Meta's expression set grew from ~52 to 70 largely by adding tongue shapes (`TongueTipInterdental`, `TongueTipAlveolar`, `TongueFrontDorsalPalate`, `TongueMidDorsalPalate`, `TongueBackDorsalVelar`, `TongueOut`, `TongueRetreat`), cross-referenced to visemes because **consonant identity lives on the tongue, and lips cannot carry it**. Even three shapes would visibly upgrade the `B`-family consonants this project currently merges:

| Suggested morph | Covers | Replaces |
| --- | --- | --- |
| `tongueTipInterdental` | TH | part of `B` |
| `tongueTipAlveolar` | N, L, T, D | part of `B` |
| `tongueBackDorsalVelar` | K, G | part of `B` |

No driver changes needed beyond listing the new names in the T3 `VISEMES` entries — the lookup-by-name design at lines 52 and 357 already picks up new morph targets without code changes.

**Verify.** With tongue morphs exported and T3 landed, "birthday" should show the tongue tip touch behind the teeth on the T.

---

## Suggested landing order

1. **T4 + T5 + T11** — small correctness/structure fixes that every later task builds on.
2. **T2** — extract the driver; everything else then lands as driver changes, not viewer surgery.
3. **T1** — envelope-driven jaw; the single most visible realism improvement.
4. **T6 + T7 + T8 + T9** — polish passes, each independently toggleable via query string for A/B comparison.
5. **T3 (+ T12 if the artist exports tongue morphs)** — vocabulary upgrade; needs the forced-alignment toolchain set up first.
6. **T10** — alias table, whenever OpenXR-format data or Meta-runtime portability is actually needed.

Each task is verifiable with the existing manual procedure from `CODE-DRIVEN-LIP-SYNC.md`: serve over localhost, scrub the timeline to the named timestamps, and watch the pose at start/middle/end of the word.


---

## Comparing v1 and v2

Serve the repo (`node .claude/static-server.mjs "$PWD"`, port 8777) and open both:

- v1 control: `/assets/aria-mouth-viewer.html`
- v2: `/assets/aria-mouth-viewer-v2.html`

Both expose the same `window.viewer`. Paste this in each console and diff the two dumps:

```js
JSON.stringify([0, 5.9, 11.82, 13.66, 15, 17, 20.12, 30].map(t => {
  viewer.seek(t);
  const m = viewer.morphMeshes[0];
  return [t, Object.fromEntries(Object.entries(m.morphTargetDictionary)
    .map(([n, i]) => [n, +m.morphTargetInfluences[i].toFixed(3)])
    .filter(([, v]) => v !== 0))];
}), null, 1)
```

Measured on 2026-08-27 (`aria-mouth-test.glb`, tuned pose set):

| t | v1 jaw | v2 jaw | v1 stretch | v2 stretch | why |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0.100 | 0 | 0 | T4 — rest is a real pose, not absolute zero |
| 5.9 | 0.079 | 0.044 | 0.416 | 0.420 | quiet passage: jaw follows it down, the consonant does not |
| 11.82 | 0.585 | 0.323 | 0 | 0 | note attack sung softly |
| 13.66 | 0.120 | 0.195 | 0.07 | 0.07 | T11 — eased gap blend carries part of the outgoing pose |
| 17 | 0.780 | 0.735 | 0 | 0 | loud held note — envelope near peak |
| 20.12 | 0.585 | 0.523 | 0 | 0 | v1 had sagged on the timer; v2 tracks the sung level |
| 30 | 0.435 | 0.344 | 0.254 | 0.280 | song tail |

`mouthSmileLeft` at 13.66 s goes 0.14 → 0.175, same T11 blend.

**Read the table as the seek path, not the playing one.** `envelopeScale` re-derives whenever the
frame delta is negative or over 0.25 s, so every `seek()` sample above is *instantaneous* RMS. Under
real playback (dt ≈ 0.016 s) the 0.35 s smoother is what runs: stepping `applyPerformance` by hand
at 60 fps across 15–19 s gives a smoothed envelope 6.5× flatter than the raw signal
(mean |Δ| 0.0084 vs 0.0547) while still spanning 0.08–0.52, so it lags loudness rather than
flatlining. At t = 17 s that is a jaw of ~0.52 while playing versus the 0.735 the seek path reports.

### Three corrections to the recipes above, found while landing them

1. **T1's `envelopeScale` breaks on a backward scrub.** As written it keeps its smoother state across
   calls and clamps `dt` to ≥ 0, so scrubbing backward — exactly what this comparison procedure does —
   leaves the jaw holding pre-scrub loudness. v2 re-derives when `dt < 0` or `dt > 0.25`.
2. **`SUSTAIN_TARGETS` must lose the `mouthStretch` pair under T1.** v1's list was authored for a
   decay that only started after a 0.22 s hold, so every cue still *began* at full strength. The
   envelope scales from the first frame instead, which would park every consonant in a quiet passage
   at ~0.55× for its whole life — a legibility regression, and contrary to T1's own "lips hold their
   posture". v2 scales `jawOpen` and the `mouthLowerDown` pair only.
3. **T4's recipe deletes `RESTING_SMILE`; v2 keeps it** on the expression layer. `REST` only wins when
   no cue is active, and mid-phrase the smile track can legitimately sit at zero — giving
   `max(0, 0) = 0` and a dead mouth exactly where the floor was meant to help.
