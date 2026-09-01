// Code-driven lip-sync engine, extracted from aria-mouth-viewer.html (improvements doc T2).
// The caller owns audio, rendering and the head bone; this owns cues, poses, expressions,
// the pose mixer and the mouth/expression combine.
//
// Allocation contract: poseAt()/expressionPoseAt() write into preallocated scratch objects
// and return them. Callers must consume the result before the next call, and must never
// hand a scratch object out as if it were a pose definition — writing through it would
// corrupt POSES/REST permanently.
import * as THREE from 'three';

export function smoothstep(value){
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

// Combine semantics, stated once, here, where the values are produced:
//  - mouth + expression is ADDITIVE for every target not listed below. Sums may exceed 1
//    and are clamped to the model's [-1,1] range. Two overlapping full-strength layers is
//    an authoring error, not something the runtime should quietly hide.
//  - smile targets take max() of the two layers, and the expression side is gated down by
//    rounded mouth shapes. Only rounded shapes actually fight a smile — a press, a stretch
//    or an open jaw are all things people do while smiling.
//  - negative influences are preserved (the artist's poses use an inverted shrug and an
//    un-stretch); clamping those to zero silently deletes half of some shapes.
const COMBINE_MAX = ['mouthSmileLeft', 'mouthSmileRight'];
const COMBINE_GATED_BY = ['mouthFunnel', 'mouthPucker'];

export class LipSyncDriver {
  constructor({ poses, rest, expressionTargets, restingSmile = 0,
                transitionSeconds = 0.065, sustainTargets = [] }){
    this.rest = rest;
    this.expressionTargets = expressionTargets;
    this.restingSmile = restingSmile;
    this.transitionSeconds = transitionSeconds;
    this.sustainTargets = sustainTargets;
    // Live-tunable knobs (a UI can set these directly, no rebuild needed): mouthStrength
    // scales every mouth-cue morph, jawStrength scales jawOpen on top of that.
    this.mouthStrength = 1;
    this.jawStrength = 1;
    this.mouthCues = [];
    this.expressionTracks = {};
    this.envelope = null;
    this._smoothedEnvelope = 0;
    this._lastEnvelopeTime = -1;
    this._mouth = {};
    this._expression = {};
    this.setPoses(poses);
  }

  setPoses(poses){
    this.poses = poses;
    // Keep the gap-blend target and the X cue the same pose. The artist set ships its own
    // restBaseline; without this they would diverge on ?poses=artist.
    if (poses.X) this.rest = poses.X;
    this.controlledMorphs = [...new Set(Object.values(poses).flatMap(Object.keys))];
    for (const name of this.allMorphs()) this._mouth[name] = 0;
    for (const name of this.allMorphs()) this._expression[name] = 0;
  }

  setCues(mouthCues){ this.mouthCues = mouthCues; }
  setExpressionTracks(tracks){ this.expressionTracks = tracks; }
  setEnvelope(envelope){ this.envelope = envelope; }

  allMorphs(){
    const expressionMorphs = Object.values(this.expressionTargets).flat();
    return [...new Set([...this.controlledMorphs, ...expressionMorphs])];
  }

  // Attach once per mesh: name -> morph index. Replaces a dictionary lookup per morph
  // per mesh per frame. Returns null when the mesh carries none of our shapes.
  bindMesh(mesh){
    const map = {};
    let any = false;
    for (const name of this.allMorphs()){
      const index = mesh.morphTargetDictionary[name];
      if (index !== undefined){ map[name] = index; any = true; }
    }
    return any ? map : null;
  }

  findCueIndex(time){
    let low = 0;
    let high = this.mouthCues.length - 1;
    while (low <= high){
      const mid = (low + high) >> 1;
      const cue = this.mouthCues[mid];
      if (time < cue.start) high = mid - 1;
      else if (time >= cue.end) low = mid + 1;
      else return mid;
    }
    return -1;
  }

  // Last cue that has already finished at `time`, or null. Binary search rather than the
  // obvious reverse().find() — a gap can span many frames and that copies the whole array
  // on each one.
  lastFinishedCue(time){
    let low = 0;
    let high = this.mouthCues.length - 1;
    let found = null;
    while (low <= high){
      const mid = (low + high) >> 1;
      if (this.mouthCues[mid].end <= time){ found = this.mouthCues[mid]; low = mid + 1; }
      else high = mid - 1;
    }
    return found;
  }

  // T1: a singer's jaw tracks how loudly the note is actually being sung. Replaces the
  // fixed SUSTAIN_HOLD/RAMP/FLOOR decay curve, which collapsed every held note identically.
  envelopeScale(time){
    if (!this.envelope) return 1;
    const dt = time - this._lastEnvelopeTime;
    // Seeking backward, or jumping, must re-derive rather than filter from the old
    // position — otherwise a scrub leaves the jaw holding pre-scrub loudness.
    if (this._lastEnvelopeTime < 0 || dt < 0 || dt > 0.25){
      this._smoothedEnvelope = this.envelope.sample(time);
    } else {
      this._smoothedEnvelope += (this.envelope.sample(time) - this._smoothedEnvelope)
                              * (1 - Math.exp(-dt / 0.35));   // ~0.35s jaw inertia
    }
    this._lastEnvelopeTime = time;
    return THREE.MathUtils.clamp(0.55 + 0.45 * this._smoothedEnvelope, 0.5, 1.05);
  }

  poseAt(time){
    const pose = this._mouth;
    for (const name in pose) pose[name] = 0;

    const index = this.findCueIndex(time);
    if (index < 0){
      // T11: no cue covers this time. Ease toward rest over the normal transition window
      // instead of snapping — the hand-corrected timeline is continuous, but the phonetic
      // one has X gaps and would visibly pop.
      const previous = this.lastFinishedCue(time);
      if (!previous) return this.blendInto(pose, this.rest, this.rest, 0);
      const gap = (time - previous.end) / this.transitionSeconds;
      const from = this.poses[previous.value] || this.rest;
      return this.blendInto(pose, from, this.rest, gap >= 1 ? 1 : smoothstep(gap));
    }

    const cue = this.mouthCues[index];
    const prev = this.mouthCues[index - 1];
    const next = this.mouthCues[index + 1];
    // Advance the smoother every frame, including through rest — skipping it would leave
    // lastEnvelopeTime stale and force a re-derive on the next sung cue. Rest itself is a
    // fixed posture, not a sung note, so it ignores the result.
    const scaled = this.envelopeScale(time);
    const settle = cue.value === 'X' ? 1 : scaled;

    // Transitions are centred on the cue boundary rather than crammed into the tail of the
    // outgoing cue. Tail-only blending means each shape holds dead still and then snaps,
    // which reads as jank; and once the blend is capped so short cues stay readable, that
    // snap gets shorter and worse. Centred, every cue holds its pose through its middle and
    // the movement straddles the join, which is what a real mouth does.
    const half = boundary => Math.min(this.transitionSeconds * 0.5,
                                      (cue.end - cue.start) * 0.4,
                                      boundary ? (boundary.end - boundary.start) * 0.4 : Infinity);

    let other = null, mix = 0;
    const outHalf = half(next);
    const inHalf = half(prev);
    if (next && time > cue.end - outHalf){
      other = this.poses[next.value] || this.rest;
      mix = 0.5 * smoothstep((time - (cue.end - outHalf)) / (2 * outHalf));
    } else if (prev && time < cue.start + inHalf){
      other = this.poses[prev.value] || this.rest;
      mix = 0.5 * (1 - smoothstep(0.5 + (time - cue.start) / (2 * inHalf)));
    }

    const current = this.poses[cue.value] || this.rest;
    for (const name of this.controlledMorphs){
      // Only the jaw settles on a held note. Lip rounding and lip press are held postures —
      // a singer sustaining an "ooo" keeps the pucker for the whole note.
      const from = (current[name] || 0) * (this.sustainTargets.includes(name) ? settle : 1);
      const blended = other ? THREE.MathUtils.lerp(from, other[name] || 0, mix) : from;
      pose[name] = this.scaleFor(name) * blended;
    }
    return pose;
  }

  blendInto(pose, from, to, mix){
    for (const name of this.controlledMorphs){
      pose[name] = this.scaleFor(name) * THREE.MathUtils.lerp(from[name] || 0, to[name] || 0, mix);
    }
    return pose;
  }

  scaleFor(name){
    return name === 'jawOpen' ? this.mouthStrength * this.jawStrength : this.mouthStrength;
  }

  trackAt(name, time){
    const keys = this.expressionTracks[name] || [];
    if (!keys.length) return 0;
    if (time <= keys[0].time) return keys[0].value;
    if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;

    let low = 0;
    let high = keys.length - 1;
    while (low + 1 < high){
      const mid = (low + high) >> 1;
      if (keys[mid].time <= time) low = mid;
      else high = mid;
    }

    const from = keys[low];
    const to = keys[high];
    const mix = smoothstep((time - from.time) / Math.max(to.time - from.time, 0.001));
    return THREE.MathUtils.lerp(from.value, to.value, mix);
  }

  expressionPoseAt(time){
    const pose = this._expression;
    for (const name in pose) pose[name] = 0;
    for (const trackName in this.expressionTargets){
      // She is singing Happy Birthday. A dead-neutral mouth between phrases reads as bored,
      // so the smile never fully returns to zero. This floor stays on the expression layer
      // even though REST now carries a smile of its own: REST only wins when no cue is
      // active, and mid-phrase the smile track can legitimately sit at zero.
      const value = trackName === 'smile'
        ? Math.max(this.trackAt(trackName, time), this.restingSmile)
        : this.trackAt(trackName, time);
      for (const targetName of this.expressionTargets[trackName]) pose[targetName] = value;
    }

    // A smile that only moves the mouth reads as pasted on — the giveaway is the eyes.
    // Cheek raise and eye squint are what make it look felt rather than performed, so
    // derive them from smile strength instead of hand-keying a parallel track.
    const smile = pose.mouthSmileLeft || 0;
    pose.cheekSquintLeft = Math.max(pose.cheekSquintLeft || 0, smile * 0.6);
    pose.cheekSquintRight = Math.max(pose.cheekSquintRight || 0, smile * 0.6);
    pose.eyeSquintLeft = Math.max(pose.eyeSquintLeft || 0, smile * 0.5);
    pose.eyeSquintRight = Math.max(pose.eyeSquintRight || 0, smile * 0.5);
    return pose;
  }

  // Write the combined performance into every bound mesh. Zero allocation per frame.
  apply(time, boundMeshes){
    const mouthPose = this.poseAt(time);
    const expressionPose = this.expressionPoseAt(time);
    const rounded = Math.max(0, mouthPose[COMBINE_GATED_BY[0]] || 0,
                                mouthPose[COMBINE_GATED_BY[1]] || 0);
    const gate = 1 - smoothstep((rounded - 0.05) / 0.25);

    for (const bound of boundMeshes){
      const influences = bound.mesh.morphTargetInfluences;
      const map = bound.map;
      for (const name in map){
        const isMax = COMBINE_MAX.includes(name);
        const expressionValue = (expressionPose[name] || 0) * (isMax ? gate : 1);
        const combined = isMax
          ? Math.max(mouthPose[name] || 0, expressionValue)
          : (mouthPose[name] || 0) + expressionValue;
        influences[map[name]] = THREE.MathUtils.clamp(combined, -1, 1);
      }
    }
  }
}

// T1: RMS loudness envelope, built once at load. Sampled per frame, no allocation.
export async function buildEnvelope(url, samplesPerSecond = 60){
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();

  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++){
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] * data[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= audioBuffer.numberOfChannels;

  const windowSize = Math.max(1, Math.round(audioBuffer.sampleRate / samplesPerSecond));
  const buckets = Math.ceil(length / windowSize);
  const envelope = new Float32Array(buckets);
  let peak = 0;
  for (let b = 0; b < buckets; b++){
    let sum = 0;
    const end = Math.min((b + 1) * windowSize, length);
    for (let i = b * windowSize; i < end; i++) sum += mono[i];
    const rms = Math.sqrt(sum / Math.max(1, end - b * windowSize));
    envelope[b] = rms;
    peak = Math.max(peak, rms);
  }
  if (peak > 0) for (let b = 0; b < buckets; b++) envelope[b] /= peak;

  return {
    buckets,
    sample(time){
      const t = THREE.MathUtils.clamp(time * samplesPerSecond, 0, buckets - 1);
      const i = t | 0;
      const frac = t - i;
      const a = envelope[i];
      const b = envelope[Math.min(i + 1, buckets - 1)];
      return a + (b - a) * frac;
    }
  };
}
