# 3D Model Specification — Lip-Sync AR ("Say it with songs")

**Prepared for:** the 3D artist creating the character model
**Target platform:** MindAR image-tracking, running in a mobile web browser (A-Frame 1.5.0 / three.js / WebGL). No native app — it runs on the phone's browser over the web.
**Lip-sync pipeline:** Blender + **Rhubarb Lipsync NG** generates the mouth animation from an MP3; the baked model is exported to glTF and played in the browser.

Please read the "How it fits together" note at the end first — it explains *why* the constraints below matter, which makes the numbers easier to work to.

---
Example model at:https://www.turbosquid.com/3d-models/3d-aria-blake-game-ready-2413529


## Core specification (quick reference)

| Item | Recommended | Hard limit |
|---|---|---|
| **File format** | glTF Binary **`.glb`** — single file, textures embedded | — |
| **File size** | ≤ 5 MB | 10 MB |
| **Triangles** | 30,000–50,000 | 100,000 |
| **Texture resolution** | 1024 × 1024 | 2048 × 2048 |
| **Texture format** | JPG for colour maps, PNG only where alpha is needed | — |
| **Texture maps** | baseColor + normal + packed **ORM** (occlusion/roughness/metallic) | keep to 3 maps |
| **Materials** | 1–3, Principled BSDF only | 4 |
| **Bones (if used)** | ≤ 40 | 75 |
| **Lip-sync method** | **Morph targets / blendshapes** (see below) | — |
| **Bake frame rate** | 30 fps | 60 fps |
| **Up axis** | +Y up (glTF standard) | — |
| **Facing** | +Z, toward the viewer | — |
| **Scale** | ~1 unit tall, all transforms applied | — |
| **Pivot / origin** | Base-centre (e.g. between the feet), at world origin | — |

---

## Detailed requirements

### 1. Format — GLB or GLTF
Deliver **`.glb`** (binary glTF), with textures and animation **embedded in the single file**. It's one HTTP request, nothing to lose, and loads cleanly in three.js. `.gltf` + separate `.bin` + loose textures is fine to *work in*, but the final delivery should be a self-contained `.glb`. glTF 2.0 only.

### 2. File size
This downloads onto a phone, often over mobile data, *before* the AR can start — so size is UX. **Aim for ≤ 5 MB, keep it under 10 MB.** Most of the budget goes on textures, so favour 1K maps and JPG compression over 2K/PNG wherever quality allows. (Optional mesh/texture compression — Draco, meshopt, KTX2 — can shrink this further but needs matching decoders our side; **don't apply it unless we've agreed it first.** Deliver uncompressed by default and we'll compress if needed.)

### 3. Polygon / triangle count
Real-time on a phone, *while* MindAR is also running camera capture and image tracking on the same GPU. **Target 30k–50k triangles, hard ceiling ~100k.** Spend the polygons where they read on a small screen (silhouette, face, mouth); don't waste them on hidden or tiny detail — bake that into the normal map instead.

### 4. Textures
- **Max 2048², prefer 1024².** Keep the number of textures low — every texture is memory on the phone (a 2K RGBA map is ~16 MB in GPU memory uncompressed).
- Use the **glTF metallic-roughness** convention: **baseColor**, **normal**, and a single **packed ORM** map (Occlusion in R, Roughness in G, Metallic in B). Add **emissive** only if the design needs glow.
- **JPG** for baseColor/ORM (no alpha needed); **PNG** only for maps that genuinely need transparency.
- **Bake procedural/node textures down to image maps** — see materials below.

### 5. Materials / shaders
three.js only understands the **glTF PBR metallic-roughness** model, i.e. Blender's **Principled BSDF**. Anything else won't survive export.
- **One Principled BSDF per material.** No custom shader node trees, no procedural noise/musgrave/gradient nodes surviving to export — **bake them to textures** first.
- **Keep to 1–3 materials** (each material = a draw call = cost on mobile).
- Avoid: subsurface scattering, volumetrics, transmission/refraction, and heavy clearcoat — they're costly or unsupported in this stack. Emissive is fine.
- Minimise transparency (alpha blending causes sorting artefacts in AR); use it only where essential.
- Single-sided materials where possible (double-sided doubles the cost).

### 6. Rig / bone limits
- **One armature**, linear blend skinning only.
- **≤ 40 bones ideal, ≤ 75 max.** (three.js can handle more via bone textures, but keep it lean for phone performance.)
- **No IK, constraints, or drivers in the export** — three.js can't evaluate them. **Bake everything to plain keyframes** before exporting.
- Apply all transforms so there's **no non-uniform scale on skinned meshes** (it breaks skinning in three.js).

### 7. Lip-sync — bones or blendshapes? → **Use blendshapes (morph targets)**
For facial/lip-sync in this web stack, **morph targets/blendshapes are the better choice**, and they map perfectly onto how Rhubarb works:
- Rhubarb outputs a small set of discrete **mouth shapes** — so the designer sculpts **one blendshape per mouth shape** and Rhubarb Lipsync NG drives/blends between them. Clean 1:1 mapping, smooth blending, no facial rig to build.
- Morph targets are lighter on the GPU than a dense face-bone rig and are well supported in three.js (modern morph-via-texture path — no low morph-count limit).
- Keep **bones for gross body/limb motion only** (if the character moves at all); keep **the face on blendshapes**.

**Sculpt these mouth shapes as shape keys** (the standard Rhubarb "extended" set — 9 shapes). Base/neutral mesh = mouth closed.

| Shape key | Mouth shape | Rough phonemes |
|---|---|---|
| `viseme_A` | Closed / rest | M, B, P |
| `viseme_B` | Slightly open, teeth together | K, S, T, EE-ish |
| `viseme_C` | Open | EH, AE |
| `viseme_D` | Wide open | AA ("ah") |
| `viseme_E` | Slightly rounded | AO, ER |
| `viseme_F` | Puckered / small round | UW, OW, W |
| `viseme_G` | Upper teeth on lower lip | F, V |
| `viseme_H` | Tongue-up | L |
| `viseme_X` | Idle / rest | (silence) |

Name them exactly as above (or tell us your names and we'll map them). **Exaggerate the shapes slightly** — they need to read clearly when the character is small on a phone screen.

### 8. Animation requirements & naming
- The lip-sync gets **baked to a single animation clip per song**. Name clips explicitly, **lowercase, no spaces**, e.g. `lipsync_song01`.
- If the character has an idle/body loop, deliver it as a **separate clip** named `idle`.
- Animation must be **fully baked keyframes** (no live constraints/drivers).
- Clip start at frame 0; clip length should **match the MP3 length exactly**.

### 9. Frame rate
Bake at **30 fps** (plenty for lip-sync and lighter on mobile; 60 fps only if there's fast body motion). glTF stores keyframe times in seconds, so this is really about keyframe density — 30 samples/sec is smooth.

### 10. Multiple animation clips
**Yes — fully supported.** three.js's animation mixer can hold multiple named clips on one model and play/blend/crossfade them, so it's fine (preferred, even) to ship `idle` + one or more `lipsync_*` clips in the same GLB. Keep them as separate named clips rather than one merged timeline.

### 11. Scale & orientation
- **+Y up, right-handed, metres** (use the glTF exporter's default +Y-up; Blender is Z-up and the exporter converts).
- **Face +Z** (toward the viewer/camera).
- **Pivot at base-centre** (between the feet / bottom-centre of the model) sitting **at the world origin** — so it stands *on* the tracked image rather than floating or sinking.
- **Model ~1 unit tall**, and **apply all transforms** (scale = 1, rotation = 0) before export. We'll scale it to the physical target image in-scene, but a clean 1-unit, transforms-applied model makes that predictable.

### 12. Other three.js / WebAR restrictions
- **Exclude cameras and lights from the export** — the AR scene provides its own lighting; baked lights/cameras just conflict.
- **Apply modifiers** (or enable "Apply Modifiers" in the exporter).
- **Export tangents** if you use a normal map.
- Prefer **one skinned mesh** over many small objects (fewer draw calls).
- **No spaces or special characters** in filenames, object names, material names, or clip names.
- Vertex colours are fine if used; optional.
- Assume the test devices are a **mid-range Android phone and iPhone Safari** — if it's smooth there, it's fine.

---

## Delivery checklist
A single **`.glb`** containing:
- [ ] Mesh, ≤ ~50k tris, transforms applied, ~1 unit tall, pivot at base-centre, facing +Z, +Y up
- [ ] 1–3 Principled-BSDF materials, procedurals baked to textures
- [ ] Textures ≤ 2K (prefer 1K), packed as baseColor + normal + ORM
- [ ] 9 mouth-shape **blendshapes** named `viseme_A … viseme_X`, base mesh mouth-closed
- [ ] Baked animation clips, 30 fps, named (`idle`, `lipsync_song01`, …), no spaces
- [ ] No lights/cameras/IK/constraints/drivers in the file
- [ ] Total file ≤ 5 MB (≤ 10 MB max), uncompressed unless we've agreed otherwise

Nice-to-have alongside the GLB: the source `.blend` and a quick screen-recording of the mouth shapes/animation playing in Blender, so we can sanity-check before wiring it into AR.

---

## How it fits together (context for the designer)
The phone's camera tracks a printed image (the "card"). When MindAR locks onto that image, the character appears anchored to it, and we play the chosen MP3 while driving the character's mouth blendshapes from the lip-sync animation Rhubarb baked from that same MP3 — so the model appears to sing the song. Everything runs in the browser on the phone, on the same GPU that's doing the camera tracking, which is why the poly/texture/material budgets above are deliberately conservative. Build to these and it'll run smoothly; the mouth shapes are the one place to be generous and expressive, because that's what sells the effect.
