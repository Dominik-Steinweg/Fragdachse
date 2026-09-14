# Stable Audio 3 local setup

**Current Studio routing:** this page documents the retained native Python
runtime used by **Small-SFX (Python)**. Small-SFX also has an independent native
[ComfyUI option](comfyui.md), alongside Medium's ComfyUI route.
The native Medium/Flash-Attention instructions below are historical setup
details and are not required for the active Medium route. The native audio
checkpoint can be shared by a verified byte copy; the ComfyUI text encoder uses
its own compatible packaging and must not be replaced by a renamed HF encoder.

The audio studio uses the official `stable-audio-3` Python package and supports
only the official `medium` and `small-sfx` checkpoints. Generation is local and
offline after setup. `StableAudioBackend` sets `HF_HUB_OFFLINE=1` and
`TRANSFORMERS_OFFLINE=1` before importing torch, Hugging Face, or
`stable_audio_3`; a missing checkpoint is an actionable error, never a download
or a cloud fallback.

## Verify the host first

Run these checks from `tools/audio-studio` with the bundled or project Python:

```powershell
.\.venv\Scripts\python.exe --version
nvidia-smi
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.version.cuda)"
.\.venv\Scripts\python.exe -c "import flash_attn; from flash_attn import flash_attn_func; print(flash_attn.__version__)"
```

`small-sfx` is the feasibility path and can run without CUDA. The official
Medium implementation requires CUDA and Flash Attention 2. A 3080 model name
or advertised VRAM figure is not accepted as proof of local feasibility; the
actual `nvidia-smi`, torch CUDA check, and a real generation are the evidence.
On Windows, use a working native or WSL2/Linux setup documented by the host;
the repository does not install WSL or a driver.

## Install the model runtime

The core studio environment intentionally does not install the large GPU model
stack. Install it into the existing `.venv` only after selecting the torch wheel
for the host CUDA version:

```powershell
.\scripts\setup-models.ps1 -Install -InstallOnly
```

The wrapper uses `uv pip --python` because a project `.venv` created by uv may
not contain pip. It installs torch and torchaudio from the explicit CUDA index
(`cu126` by default), then the remaining model dependencies and the official
Stable Audio package at the immutable source commit in the lock. Use
`-TorchIndex` for another torch CUDA channel when it is compatible with the
host.

`-InstallOnly` separates the runtime installation from gated downloads. It does
not install Flash Attention 2; Medium still needs that separately. For a native
Windows setup, validate Small-SFX first. The Flash Attention project primarily
supports Linux and describes Windows builds as insufficiently tested, so
WSL2/Linux is the recommended next path for Medium, not a verified prerequisite
already present on this machine. A Linux environment needs its own Linux Python
venv; do not reuse `.venv/Scripts` from Windows.

## Authenticate and select storage

After personally accepting the terms on the
[Medium](https://huggingface.co/stabilityai/stable-audio-3-medium),
[Small-SFX](https://huggingface.co/stabilityai/stable-audio-3-small-sfx), and
[T5Gemma](https://huggingface.co/google/t5gemma-b-b-ul2) repository pages, authenticate
locally with the same cache used by the wrapper. Never put credentials in the
catalog, command history, or chat:

```powershell
$env:HF_HOME = "$PWD\.cache\hf"
uvx hf auth login
uvx hf auth whoami
```

The setup verifies access to actual gated files before large downloads. It checks
the destination's free space with a 2 GiB reserve (conservatively budgeting a
fresh download even on a resumed run). Checkpoints contain redundant text-encoder
copies upstream; setup selects only each audio model's own files and stores one
shared encoder. The observed download sizes on 2026-09-14 were approximately
3.49 GB for Small-SFX plus encoder, and 12.71 GB for both models plus encoder,
excluding Python/CUDA packages and their caches.

On this host the user selected `E:\Fragdachse-Audio\models` because C: had only
about 12 GB free before runtime installation. External Windows drives are
supported; their absolute local paths are recorded in the lock. When moving to
another host or WSL, rerun setup with that environment's model path to refresh
these local paths. No weights, caches, or environments are versioned.

On Linux or WSL2, run the same cross-platform preparation directly when a
PowerShell wrapper is inconvenient:

```bash
uv pip install --python .venv/bin/python torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu126
uv pip install --python .venv/bin/python -r requirements-models.txt
uv pip install --python .venv/bin/python 'stable-audio-3 @ git+https://github.com/Stability-AI/stable-audio-3.git@779434a908193105335fd8d833418603625b2859'
# Install a Flash Attention 2 wheel matching Python/Torch/CUDA for Medium.
# See the official installation guide linked below; this hardware step is unverified here.
.venv/bin/python scripts/setup_models.py --lock catalog/model-lock.json --model-root models/weights
```

The official Stable Audio 3 dependencies are torch `2.7.1`, torchaudio
`2.7.1`, transformers `>=5.8.0`, NumPy `>=2.2.6`, safetensors, Hugging Face
Hub, einops, einops-exts, and tqdm. `requirements-models.txt` keeps these
separate from the catalog/UI dependencies. Use the CUDA index and Flash
Attention wheel that match the installed Python, torch, and CUDA versions.

The current native Windows runtime passed real Small-SFX generation with
torch/torchaudio `2.7.1+cu126`, transformers `5.17.0`, huggingface-hub `1.31.0`,
safetensors `0.8.0`, and NumPy `2.5.3`. The top-level model package versions in
`requirements-models.txt` now pin this tested set. The Medium/Flash Attention
combination remains unverified.

## Fetch and lock checkpoints explicitly

The only network-enabled step is the setup script. It downloads the two named
Hugging Face checkpoints and the `google/t5gemma-b-b-ul2` text encoder snapshot,
records their resolved revisions and the checkpoint SHA-256 hashes in
`tools/audio-studio/catalog/model-lock.json`, and uses the already recorded
official Stable Audio 3 source commit by default. A deliberate source refresh
uses `-RefreshSource` and resolves the new commit with:

```text
git ls-remote https://github.com/Stability-AI/stable-audio-3.git refs/heads/main
```

Run it from `tools/audio-studio` in an environment where network access and the
Hugging Face license/permissions are available:

```powershell
.\scripts\setup-models.ps1 -Model small-sfx -ModelRoot 'E:\Fragdachse-Audio\models' -AcknowledgeLicense
# Later, after preparing the Medium runtime:
.\scripts\setup-models.ps1 -Model medium -ModelRoot 'E:\Fragdachse-Audio\models'
```

Omit `-Model` (or use `-Model all`) to prepare both models. `-Install` can be
combined with a download command when installing for the first time. The script
uses a local model directory and does not place weights in the game
build. Review the lock after it completes. The adapter will verify the local
config/checkpoint hashes before loading them and supplies the local text encoder
snapshot to the upstream conditioner through an ephemeral config copy. If the
Hugging Face repositories are gated for the account, setup stops with the
provider's access error; that is an access prerequisite, not a reason to add a
cloud fallback.

For connections where very large streaming responses stall, add `-HttpChunks`
(`--http-chunks` in Python). This uses at most four parallel 16 MiB byte ranges,
validates each range and the official SHA-256, and keeps a contiguous `.http-part`
plus hash marker for resumption. Signed download URLs are not included in errors.
Do not run two setup processes against the same destination simultaneously.

### Manually downloaded weights

Small-SFX and the shared encoder were downloaded and verified on this host.
Medium's configuration and expected checksum are prepared; its 9,222,116,660-byte
weight file remains a manual download:

- [Medium weight file at the pinned revision](https://huggingface.co/stabilityai/stable-audio-3-medium/resolve/27b5a21b791b1b033d193a9e1e3ce78493f102f9/model.safetensors?download=true)
- Save exactly as `E:\Fragdachse-Audio\models\medium\model.safetensors`.
- Expected SHA-256: `48d9c65e290e7bcd5194e0633bfc2424a59ee9683f5c2d58762d997b7d8ce0b5`.

Then verify and register it from the tool directory:

```powershell
.\scripts\setup-models.ps1 -Model medium -ModelRoot 'E:\Fragdachse-Audio\models' -LocalWeights
```

`-LocalWeights` verifies every required safetensors file against the official
repository checksum. Missing or mismatched weights produce an error and are
never downloaded or replaced in this mode. Small supporting files may download;
this is still the explicit online setup boundary. Medium additionally needs the
CUDA/Flash Attention runtime described above; downloading its weights alone does
not make it runnable in the current native Windows environment.

For a fresh machine, the corresponding pinned downloads are
[Small-SFX](https://huggingface.co/stabilityai/stable-audio-3-small-sfx/resolve/ae12755283df9d62ca39a9b050a39a0b607b8c20/model.safetensors?download=true)
and the [shared encoder](https://huggingface.co/google/t5gemma-b-b-ul2/resolve/97ea9b7e92738bb57437867277ae38e65345b8d7/model.safetensors?download=true),
saved in `small-sfx/model.safetensors` and `text-encoder/model.safetensors` under
the chosen model root. Use `-Model small-sfx -LocalWeights` to verify those.

Stable Audio 3 model code currently resolves model files through
`stable_audio_3.model_configs.ModelConfig.resolve()` and calls
`huggingface_hub.hf_hub_download()` without a revision argument. The adapter
therefore pins and supplies the already-resolved local files before calling the
official `StableAudioModel.from_pretrained(model_name, device=None,
model_half=True)` interface; it does not invent a revision parameter for that
API. The official `loading_utils.load_diffusion_cond` path remains responsible
for constructing the model from the locked JSON and safetensors files.

## License acknowledgement

The lock identifies the checkpoint scope and Stability AI Community License.
Before production use, review the license for the actual checkpoint and record
the local acknowledgement in the lock (the setup script can do this after that
review):

```powershell
.\scripts\setup-models.ps1 -AcknowledgeLicense
```

The acknowledgement is local metadata; it does not grant rights or replace the
license terms. The backend's strict `require_license_acknowledgement` gate is
enabled by default, so generation fails until that field is true.

## Feasibility check and real generation

Run the backend doctor before the UI is expanded:

```powershell
.\.venv\Scripts\python.exe -c "from audio_studio.models import StableAudioBackend; import json; print(json.dumps(StableAudioBackend().doctor(), indent=2))"
```

Then invoke one real short SFX with each supported model, using the application
or the focused CLI smoke command:

```powershell
.\.venv\Scripts\python.exe -m audio_studio.cli smoke --model small-sfx --duration 2 --seed 1701
.\.venv\Scripts\python.exe -m audio_studio.cli smoke --model medium --duration 2 --seed 1701
```

Verify that the WAV is decodable, has the model's
reported `model.model.sample_rate`, and is free of the Medium static/glitch
failure described by the upstream README. A successful import or doctor result
is not a successful generation test.

At the time this adapter was implemented, this workspace had the lightweight
audio-studio environment but no installed torch, stable_audio_3 package, or
checkpoints. The official source ref was resolved with `git ls-remote` to
`779434a908193105335fd8d833418603625b2859`; model weights were deliberately
not downloaded during this bounded feasibility pass. Real Medium and Small-SFX
generation is therefore recorded as **not executed successfully** until the
explicit setup step is run on the target host. Do not mark the P0 feasibility
gate green from the injected unit tests alone. This was the initial implementation
state, not evidence about the user's account permissions. After the user completed
license/access approval and local authentication, authenticated reads of actual
configuration files from all three repositories succeeded on 2026-09-14.

## Verified upstream references

The adapter contract was checked against the official `main` sources on
2026-09-14:

- [`stable_audio_3/model.py`](https://raw.githubusercontent.com/Stability-AI/stable-audio-3/main/stable_audio_3/model.py)
- [`stable_audio_3/model_configs.py`](https://raw.githubusercontent.com/Stability-AI/stable-audio-3/main/stable_audio_3/model_configs.py)
- [`stable_audio_3/loading_utils.py`](https://raw.githubusercontent.com/Stability-AI/stable-audio-3/main/stable_audio_3/loading_utils.py)
- [official model overview](https://github.com/Stability-AI/stable-audio-3/blob/main/docs/guides/model-overview.md)
- [official installation / Flash Attention instructions](https://github.com/Stability-AI/stable-audio-3#installation)
- [Stability license overview](https://stability.ai/license) and [Community License](https://stability.ai/community-license-agreement)
