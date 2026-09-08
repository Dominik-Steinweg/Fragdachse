param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$assetRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$targetPath = [System.IO.Path]::GetFullPath($Destination)
if (-not $sourcePath.StartsWith($assetRoot + '\', [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $targetPath.StartsWith($assetRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Asset publication must stay inside its declared workspace'
}
if (Test-Path -LiteralPath $targetPath) { throw 'Published revision already exists' }
# Native Move-Item handles Windows directory moves that Python/libuv reject here.
Move-Item -LiteralPath $sourcePath -Destination $targetPath
