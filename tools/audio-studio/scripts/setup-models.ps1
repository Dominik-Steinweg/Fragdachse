param(
  [string]$Python = ".\.venv\Scripts\python.exe",
  [string]$ModelRoot = ".\models\weights",
  [switch]$Install,
  [switch]$InstallOnly,
  [switch]$HttpChunks,
  [switch]$LocalWeights,
  [ValidateSet("all", "medium", "small-sfx")]
  [string]$Model = "all",
  [switch]$RefreshSource,
  [switch]$AcknowledgeLicense,
  [string]$TorchIndex = "https://download.pytorch.org/whl/cu126"
)

$ErrorActionPreference = "Stop"
$studioRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$lockPath = Join-Path $studioRoot "catalog\model-lock.json"
$setupScript = Join-Path $PSScriptRoot "setup_models.py"
$modelRootPath = if ([System.IO.Path]::IsPathRooted($ModelRoot)) {
  [System.IO.Path]::GetFullPath($ModelRoot)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $studioRoot $ModelRoot))
}
if ($InstallOnly -and -not $Install) { throw "-InstallOnly requires -Install." }

if (-not (Test-Path -LiteralPath $Python)) {
  throw "Python interpreter not found at $Python. Create the audio-studio .venv first."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw "uv is required because the project .venv does not include pip. Install uv or pass a managed uv environment."
}

$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
$sourceCommit = $lock.upstream.resolved_commit
if ($RefreshSource -or [string]::IsNullOrWhiteSpace([string]$sourceCommit)) {
  $sourceOutput = & git ls-remote https://github.com/Stability-AI/stable-audio-3.git refs/heads/main
  if ($LASTEXITCODE -ne 0) {
    throw "Could not resolve the official stable-audio-3 source commit with git ls-remote."
  }
  $sourceCommit = ([string]$sourceOutput).Split()[0]
  if ([string]::IsNullOrWhiteSpace($sourceCommit)) {
    throw "git ls-remote returned no stable-audio-3 main commit."
  }
}

if ($Install) {
  Write-Host "Installing torch 2.7.1 and torchaudio 2.7.1 from the explicit CUDA index."
  & uv pip install --python $Python torch==2.7.1 torchaudio==2.7.1 --index-url $TorchIndex
  if ($LASTEXITCODE -ne 0) { throw "CUDA torch dependency installation failed." }
  & uv pip install --python $Python -r (Join-Path $studioRoot "requirements-models.txt")
  if ($LASTEXITCODE -ne 0) { throw "Model dependency installation failed." }
  & uv pip install --python $Python ("stable-audio-3 @ git+https://github.com/Stability-AI/stable-audio-3.git@" + $sourceCommit)
  if ($LASTEXITCODE -ne 0) { throw "Pinned stable-audio-3 installation failed." }
}

if ($InstallOnly) { return }

# This is the only network-enabled preparation command. The runtime adapter
# forces offline mode and never calls hf_hub_download or snapshot_download.
$env:HF_HOME = Join-Path $studioRoot ".cache\hf"
$env:HF_HUB_OFFLINE = "0"
$env:TRANSFORMERS_OFFLINE = "0"
$setupArgs = @(
  $setupScript,
  "--lock", $lockPath,
  "--model-root", $modelRootPath,
  "--model", $Model
)
if ($RefreshSource) { $setupArgs += "--refresh-source" }
if ($AcknowledgeLicense) { $setupArgs += "--acknowledge-license" }
if ($HttpChunks) { $setupArgs += "--http-chunks" }
if ($LocalWeights) { $setupArgs += "--local-weights" }
& $Python @setupArgs
if ($LASTEXITCODE -ne 0) { throw "Model download/lock generation failed." }

Write-Host "Model lock updated at $lockPath. Review the license acknowledgement before generation."
