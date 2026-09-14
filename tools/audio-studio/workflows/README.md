# Stable Audio 3 native ComfyUI API workflows

`stable-audio-3-small-sfx.api.json` adds **Small-SFX (ComfyUI)** alongside the
unchanged direct Python route. It uses the same nine native nodes and input
bindings as Medium; only the checkpoint filename and default output prefix
differ. The registry limits Small-SFX to 120 whole seconds; Studio SFX recipes
retain their 47-second limit. No new ComfyUI client or custom node is needed.

The existing official Small-SFX checkpoint is compatible without tensor
conversion. Its SHA-256 is
`ed9cf1b6172f1a8c2921a9560c21109ff3239524563ced9dce6dcdef41e2f515`;
source revision `ae12755283df9d62ca39a9b050a39a0b607b8c20`. A verified copy is
available as `stable_audio_3_small_sfx.safetensors` in the local ComfyUI checkpoint
directory. `scripts/prepare_comfy_small.py` reproduces this step from the locked
existing source without downloads or overwriting unrelated destination files.

Local ComfyUI 0.35.1 source/header verification on 2026-09-14:

- `comfy/model_detection.py` recognizes `model.model.*` and derives Small's
  embedding width 1024, depth 20 and 256 audio channels from tensor shapes.
- `comfy/supported_models.py:StableAudio3` selects native Stable Audio 3 and
  T5Gemma conditioning. Small's seconds conditioner uses the same maximum 384
  as this implementation; the authoring duration limit is separate.
- `comfy/sd.py` recognizes the six-layer Small VAE; Medium uses twelve layers.
- `nodes.common_ksampler` / `fix_empty_latent_channels` adapt the generic empty
  audio latent to Stable Audio 3's 256 channels and downsample ratio 4096.
- The native Small GPU smoke succeeded through sampling, VAE, FLAC and RAW-WAV.
  Measurements and remaining listening checks: [acceptance.md](../docs/acceptance.md).

Both ComfyUI workflows use **LCM/simple**; the direct official Python route uses
its RF pingpong implementation and duration/padding handling. Compare the
pipelines' outputs rather than expecting identical samples for a given seed.
Upstream Python contract:
[`sampling.py`](https://github.com/Stability-AI/stable-audio-3/blob/779434a908193105335fd8d833418603625b2859/stable_audio_3/inference/sampling.py).
Both Comfy workflows share the existing repackaged T5Gemma text encoder. That
encoder is not a byte copy of the separate Python/HF encoder snapshot.

## Shared graph and Medium provenance

`stable-audio-3-medium.api.json` is the fixed, native ComfyUI API graph for the
Medium checkpoint. It is deliberately a small graph: the caller supplies the
prompt directly to node `3` (`CLIPTextEncode`), node `4` is an empty negative
prompt, and there is no Qwen rewrite or prompt post-processing branch.

The graph was checked against the live local Comfy Desktop instance on
2026-09-14:

- `http://127.0.0.1:8188`
- ComfyUI `0.35.1`, PyTorch `2.12.1+cu130`, RTX 3080
- `CheckpointLoaderSimple.ckpt_name`: `stable_audio_3_medium.safetensors`
- `CLIPLoader.clip_name`: `t5gemma_b_b_ul2.safetensors`
- `CLIPLoader.type`: `stable_audio`
- `CLIPLoader.device`: `default`
- `SaveAudioAdvanced.format`: native `COMFY_DYNAMICCOMBO_V3`, API value fixed to the string `"flac"`

The runtime bindings are:

| Studio value | Graph location | Value/contract |
| --- | --- | --- |
| direct prompt | `3.text` | forwarded unchanged |
| duration in whole seconds | `5.seconds_total`, `6.seconds` | the same value in both places |
| seed | `7.seed` | integer |
| steps | `7.steps` | positive integer; default `8` |
| CFG | `7.cfg` | non-negative number; default `1.0` |
| output filename prefix | `9.filename_prefix` | adapter-owned prefix may replace this default |

`EmptyLatentAudio` accepts `1.0` through `1000.0` seconds. Stable Audio 3's
`seconds_total` conditioning range is `0` through `384` seconds in the
checkpoint configuration; the Studio Medium contract caps requests at `380`
whole seconds. The API adapter therefore remains the final duration gate.

`ConditioningStableAudio` is required and receives the same duration as
`EmptyLatentAudio`. This avoids the Stable Audio 3 duration-conditioning mismatch
reported by ComfyUI issue #14825, where a latent created with
`EmptyLatentAudio` can otherwise be conditioned as roughly twice its requested
length.

## Output and PCM provenance

Node `8` decodes the KSampler latent with the checkpoint VAE using native
`VAEDecodeAudioTiled` (`tile_size=512`, `overlap=64`). ComfyUI's native audio
decode returns a float waveform and the VAE output sample rate; Stable Audio 3's
checkpoint configuration is 44,100 Hz, stereo. `VAEDecodeAudioTiled` applies
ComfyUI's built-in decoder scaling before the waveform reaches the save node.

Node `9` writes that decoded waveform through native `SaveAudioAdvanced` and
PyAV's FLAC encoder. The API graph must send `"format": "flac"`: ComfyUI's V3
dynamic-input normalization converts that selected option into the execution
argument `format={"format":"flac"}`. Sending the nested object directly causes
the V3 input parser to omit the input and produces a missing-argument failure.
FLAC is lossless; the FLAC path does not resample or apply a
gain/peak normalization. Native ComfyUI exposes no `Flac24bit` input or bit-depth
selector: the saver passes the float32 waveform to the FLAC codec, so the exact
encoded PCM sample format is owned by the installed PyAV/FFmpeg FLAC codec. The
workflow must not claim an explicit 24-bit setting.

The importer must decode this FLAC to PCM at its stored sample rate and preserve
the decoded samples as-is. It must not normalize, resample, apply gain, or
reinterpret the channel layout before writing the Studio's RAW-WAV handoff. The
source chain is therefore: Stable Audio VAE latent -> native tiled VAE float
waveform -> native FLAC file -> lossless FLAC decode -> RAW-WAV PCM. Any WAV
container metadata or FLAC metadata is outside the sample stream and does not
change that provenance.

`SaveAudio` was also checked: it is still registered and always writes FLAC, but
ComfyUI marks it deprecated. `SaveAudioAdvanced` is selected because it is the
current native saver while its format is fixed to the same lossless FLAC path.

## Official provenance

- ComfyUI Stable Audio Medium template, pinned workflow_templates commit
  [`ca6dd2050e27423cc53f9676c4d015d07bf88e19`](https://github.com/Comfy-Org/workflow_templates/commit/ca6dd2050e27423cc53f9676c4d015d07bf88e19),
  [`audio_stable_audio_3_medium.json`](https://github.com/Comfy-Org/workflow_templates/blob/ca6dd2050e27423cc53f9676c4d015d07bf88e19/templates/audio_stable_audio_3_medium.json).
  The authored API graph removes that template's Qwen rewrite branch by design.
- Native audio node schemas and implementations:
  [`comfy_extras/nodes_audio.py`](https://github.com/Comfy-Org/ComfyUI/blob/e803f24ea090de7108772d65957fd6388d3f2085/comfy_extras/nodes_audio.py)
  at commit `e803f24ea090de7108772d65957fd6388d3f2085`.
- The local Comfy Desktop source was also read directly at
  `D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\comfy_extras\nodes_audio.py:287`
  (`execute(..., format: dict)`) and
  `comfy_api\latest\_io.py:1220,1935` plus `execution.py:288` (V3
  `DynamicCombo` normalization). This local source is why the API graph uses
  the scalar selection `"format": "flac"`.
- ComfyUI's native audio output implementation:
  [`comfy_api/latest/_ui.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api/latest/_ui.py),
  which registers only `flac`, `mp3`, and `opus` and passes FLAC through the
  installed PyAV codec.
- Stable Audio 3 Medium upstream source commit from the local model lock:
  `779434a908193105335fd8d833418603625b2859` in
  [`Stability-AI/stable-audio-3`](https://github.com/Stability-AI/stable-audio-3).
- Local upstream Medium checkpoint revision from
  `catalog/model-lock.json`: `27b5a21b791b1b033d193a9e1e3ce78493f102f9`.

Following schema/source validation, this graph generated two real outputs on
the local ComfyUI instance. The Studio imported its lossless FLAC output as WAV
and processed the mini-rocket candidate to WAV/OGG. Measurements, the corrected
V3 format serialization, and remaining listening/hardware checks are recorded
in [acceptance.md](../docs/acceptance.md).
