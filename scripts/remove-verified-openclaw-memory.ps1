param(
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,

  [Parameter(Mandatory = $true)]
  [string[]]$AllowedStateRoots,

  [Parameter(Mandatory = $true)]
  [string]$AllowedVaultRoot,

  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

function Resolve-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [IO.Path]::GetFullPath($Path)
  $pathRoot = [IO.Path]::GetPathRoot($fullPath)
  if ($fullPath.Equals($pathRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $fullPath
  }
  return $fullPath.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Assert-NoReparsePathComponents {
  param([Parameter(Mandatory = $true)][string]$Path)

  $resolvedPath = Resolve-NormalizedPath $Path
  $pathRoot = [IO.Path]::GetPathRoot($resolvedPath)
  $current = $pathRoot
  $remainder = $resolvedPath.Substring($pathRoot.Length)
  $segments = @($remainder.Split(
    @([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar),
    [StringSplitOptions]::RemoveEmptyEntries
  ))

  foreach ($segment in $segments) {
    $current = Join-Path $current $segment
    if (-not (Test-Path -LiteralPath $current)) {
      continue
    }
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Reparse-point path components are not allowed: $current"
    }
  }

  return $resolvedPath
}

function Resolve-ExistingSafePath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][ValidateSet("Leaf", "Container")][string]$PathType
  )

  $resolvedPath = Assert-NoReparsePathComponents $Path
  if (-not (Test-Path -LiteralPath $resolvedPath -PathType $PathType)) {
    throw "$PathType path does not exist: $resolvedPath"
  }
  return Resolve-NormalizedPath (Get-Item -LiteralPath $resolvedPath -Force).FullName
}

function Test-PathContained {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [switch]$AllowEqual
  )

  $relative = [IO.Path]::GetRelativePath($Root, $Candidate)
  if ($relative -eq ".") {
    return $AllowEqual.IsPresent
  }
  return $relative -ne ".." -and
    -not $relative.StartsWith("..$([IO.Path]::DirectorySeparatorChar)") -and
    -not $relative.StartsWith("..$([IO.Path]::AltDirectorySeparatorChar)") -and
    -not [IO.Path]::IsPathRooted($relative)
}

function Test-AllowedMemoryRelativePath {
  param(
    [Parameter(Mandatory = $true)][string]$Instance,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  if ([IO.Path]::IsPathRooted($RelativePath)) {
    return $false
  }
  $candidate = $RelativePath.Replace("/", "\")
  if ($candidate.StartsWith("\")) {
    return $false
  }
  $segments = @($candidate.Split("\", [StringSplitOptions]::RemoveEmptyEntries))
  if ($segments.Count -eq 0 -or $segments.Where({ $_ -in @(".", "..") }).Count -gt 0) {
    return $false
  }
  $normalized = $segments -join "\"

  $allowedExact = @("workspace\MEMORY.md")
  $allowedPrefixes = @("workspace\memory\", "memory\")
  if ($Instance -eq "openclaw-ceoflow") {
    $allowedExact += "workspace\ceoflow-worker\MEMORY.md"
    $allowedPrefixes += "workspace\ceoflow-worker\memory\"
  }

  if ($allowedExact.Where({ $_.Equals($normalized, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) {
    return $true
  }
  return $allowedPrefixes.Where({ $normalized.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
}

function Get-MemoryCleanupRoot {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][string]$Instance,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  $normalized = $RelativePath.Replace("/", "\")
  $prefixes = @("workspace\memory", "memory")
  if ($Instance -eq "openclaw-ceoflow") {
    $prefixes += "workspace\ceoflow-worker\memory"
  }
  foreach ($prefix in $prefixes) {
    if ($normalized.Equals($prefix, [StringComparison]::OrdinalIgnoreCase) -or
        $normalized.StartsWith("$prefix\", [StringComparison]::OrdinalIgnoreCase)) {
      return Resolve-NormalizedPath (Join-Path $StateRoot $prefix)
    }
  }
  return $null
}

if ($AllowedStateRoots.Count -eq 0) {
  throw "At least one explicit AllowedStateRoots value is required."
}

$allowedVault = Resolve-ExistingSafePath -Path $AllowedVaultRoot -PathType Container
$resolvedManifest = Resolve-ExistingSafePath -Path $ManifestPath -PathType Leaf
if (-not (Test-PathContained -Root $allowedVault -Candidate $resolvedManifest)) {
  throw "Manifest escaped the app-owned OpenClaw memory vault: $resolvedManifest"
}

$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne "zhixia.openclaw_memory_vault.v1") {
  throw "Unsupported manifest schema: $($manifest.schemaVersion)"
}
if (-not $manifest.allVerified) {
  throw "Manifest is not fully verified."
}
if (@($manifest.entries).Count -eq 0) {
  throw "Manifest contains no verified memory entries."
}

$manifestVault = Resolve-ExistingSafePath -Path ([string]$manifest.vaultPath) -PathType Container
if (-not (Test-PathContained -Root $allowedVault -Candidate $manifestVault)) {
  throw "Manifest vault escaped the app-owned OpenClaw memory vault: $manifestVault"
}
$expectedManifest = Resolve-NormalizedPath (Join-Path $manifestVault "MANIFEST.json")
if (-not $resolvedManifest.Equals($expectedManifest, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Manifest must be MANIFEST.json directly inside its declared vault batch: $resolvedManifest"
}

$rootByInstance = @{}
foreach ($rootValue in $AllowedStateRoots) {
  $resolvedRoot = Resolve-ExistingSafePath -Path $rootValue -PathType Container
  $instance = [IO.Path]::GetFileName($resolvedRoot).TrimStart(".")
  if ($instance -notin @("openclaw", "openclaw-ceoflow")) {
    throw "Unsupported OpenClaw state root: $resolvedRoot"
  }
  if ($rootByInstance.ContainsKey($instance)) {
    throw "Duplicate OpenClaw state root instance: $instance"
  }
  if ((Test-PathContained -Root $resolvedRoot -Candidate $allowedVault -AllowEqual) -or
      (Test-PathContained -Root $allowedVault -Candidate $resolvedRoot -AllowEqual)) {
    throw "OpenClaw state roots and the app-owned vault must not overlap: $resolvedRoot"
  }
  $rootByInstance[$instance] = $resolvedRoot
}

$verified = New-Object System.Collections.Generic.List[object]
$seenSources = @{}
$seenBackups = @{}
foreach ($entry in $manifest.entries) {
  $instance = [string]$entry.instance
  $relativePath = [string]$entry.relativePath
  if (-not $rootByInstance.ContainsKey($instance)) {
    throw "Manifest entry uses an unknown OpenClaw instance: $instance"
  }
  if (-not (Test-AllowedMemoryRelativePath -Instance $instance -RelativePath $relativePath)) {
    throw "Manifest entry is not an allowed OpenClaw memory file: $relativePath"
  }
  if (-not ([string]$entry.sourceSha256 -match '^[a-fA-F0-9]{64}$') -or
      -not ([string]$entry.backupSha256 -match '^[a-fA-F0-9]{64}$')) {
    throw "Manifest entry contains an invalid SHA-256 value: $relativePath"
  }

  $source = Resolve-ExistingSafePath -Path ([string]$entry.sourcePath) -PathType Leaf
  $backup = Resolve-ExistingSafePath -Path ([string]$entry.backupPath) -PathType Leaf
  $expectedSource = Resolve-NormalizedPath (Join-Path $rootByInstance[$instance] $relativePath)
  $expectedBackup = Resolve-NormalizedPath (Join-Path (Join-Path $manifestVault $instance) $relativePath)
  if (-not $source.Equals($expectedSource, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Manifest source does not match its instance-relative memory path: $source"
  }
  if (-not $backup.Equals($expectedBackup, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Manifest backup does not match the app-owned vault path: $backup"
  }
  if (-not (Test-PathContained -Root $rootByInstance[$instance] -Candidate $source)) {
    throw "Manifest source escaped its allowed state root: $source"
  }
  if (-not (Test-PathContained -Root $manifestVault -Candidate $backup)) {
    throw "Manifest backup escaped its declared vault batch: $backup"
  }
  if ($source.Equals($backup, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Source and backup paths must differ: $source"
  }

  $sourceKey = $source.ToLowerInvariant()
  $backupKey = $backup.ToLowerInvariant()
  if ($seenSources.ContainsKey($sourceKey) -or $seenBackups.ContainsKey($backupKey)) {
    throw "Manifest contains duplicate source or backup entries: $relativePath"
  }
  $seenSources[$sourceKey] = $true
  $seenBackups[$backupKey] = $true

  $sourceBytes = (Get-Item -LiteralPath $source -Force).Length
  $backupBytes = (Get-Item -LiteralPath $backup -Force).Length
  if ($sourceBytes -ne [int64]$entry.bytes -or $backupBytes -ne [int64]$entry.bytes) {
    throw "Pre-removal byte-count verification failed: $source"
  }
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  $backupHash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne ([string]$entry.sourceSha256).ToLowerInvariant() -or
      $backupHash -ne ([string]$entry.backupSha256).ToLowerInvariant() -or
      $sourceHash -ne $backupHash) {
    throw "Pre-removal hash verification failed: $source"
  }

  $verified.Add([pscustomobject]@{
    Source = $source
    Backup = $backup
    Bytes = [int64]$entry.bytes
    SourceSha256 = $sourceHash
    BackupSha256 = $backupHash
    StateRoot = $rootByInstance[$instance]
    CleanupRoot = Get-MemoryCleanupRoot -StateRoot $rootByInstance[$instance] -Instance $instance -RelativePath $relativePath
  })
}

if ($ValidateOnly) {
  [pscustomobject]@{
    schemaVersion = "zhixia.openclaw_memory_removal_validation.v1"
    manifestPath = $resolvedManifest
    verifiedFileCount = $verified.Count
    wouldDelete = $false
    sourceFilesRemoved = $false
  } | ConvertTo-Json -Depth 4
  exit 0
}

$deletedBytes = [int64]0
$cleanupCandidates = @{}
foreach ($item in $verified) {
  $source = Resolve-ExistingSafePath -Path $item.Source -PathType Leaf
  $backup = Resolve-ExistingSafePath -Path $item.Backup -PathType Leaf
  if (-not (Test-PathContained -Root $item.StateRoot -Candidate $source)) {
    throw "Source escaped its validated state root before removal: $source"
  }
  if (-not (Test-PathContained -Root $manifestVault -Candidate $backup)) {
    throw "Backup escaped its validated vault before removal: $backup"
  }
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  $backupHash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $item.SourceSha256 -or $backupHash -ne $item.BackupSha256 -or $sourceHash -ne $backupHash) {
    throw "Immediate pre-removal hash verification failed: $source"
  }

  if ($item.CleanupRoot) {
    $cleanupRoot = Resolve-ExistingSafePath -Path $item.CleanupRoot -PathType Container
    if (-not (Test-PathContained -Root $item.StateRoot -Candidate $cleanupRoot)) {
      throw "Cleanup root escaped its validated state root: $cleanupRoot"
    }
    $current = Resolve-NormalizedPath (Split-Path -Parent $source)
    while (Test-PathContained -Root $cleanupRoot -Candidate $current -AllowEqual) {
      $cleanupCandidates[$current.ToLowerInvariant()] = [pscustomobject]@{
        Path = $current
        CleanupRoot = $cleanupRoot
        StateRoot = $item.StateRoot
      }
      if ($current.Equals($cleanupRoot, [StringComparison]::OrdinalIgnoreCase)) {
        break
      }
      $current = Resolve-NormalizedPath (Split-Path -Parent $current)
    }
  }

  [IO.File]::Delete($source)
  if (Test-Path -LiteralPath $source) {
    throw "Removal did not persist: $source"
  }
  $deletedBytes += $item.Bytes
}

foreach ($candidate in @($cleanupCandidates.Values | Sort-Object { $_.Path.Length } -Descending)) {
  if (-not (Test-Path -LiteralPath $candidate.Path -PathType Container)) {
    continue
  }
  $safeDirectory = Resolve-ExistingSafePath -Path $candidate.Path -PathType Container
  if (-not (Test-PathContained -Root $candidate.StateRoot -Candidate $safeDirectory) -or
      -not (Test-PathContained -Root $candidate.CleanupRoot -Candidate $safeDirectory -AllowEqual)) {
    throw "Empty-directory cleanup escaped validated AllowedStateRoots: $safeDirectory"
  }
  if (@(Get-ChildItem -LiteralPath $safeDirectory -Force).Count -eq 0) {
    [IO.Directory]::Delete($safeDirectory)
  }
}

[pscustomobject]@{
  schemaVersion = "zhixia.openclaw_memory_removal_receipt.v1"
  manifestPath = $resolvedManifest
  deletedFileCount = $verified.Count
  deletedBytes = $deletedBytes
  backupPreserved = $true
  rawSessionsTouched = $false
  taskLedgerTouched = $false
  agentDatabaseDeleted = $false
} | ConvertTo-Json -Depth 4
