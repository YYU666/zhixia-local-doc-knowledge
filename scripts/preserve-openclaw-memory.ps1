param(
  [Parameter(Mandatory = $true)]
  [string[]]$AllowedStateRoots,

  [Parameter(Mandatory = $true)]
  [string]$AllowedVaultRoot,

  [Parameter(Mandatory = $true)]
  [string]$VaultBatchPath,

  [switch]$DryRun
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

function Get-SafeFilesUnderDirectory {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $files = New-Object System.Collections.Generic.List[string]
  $pending = New-Object System.Collections.Generic.Stack[string]
  $pending.Push((Resolve-ExistingSafePath -Path $Directory -PathType Container))

  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    foreach ($item in Get-ChildItem -LiteralPath $current -Force) {
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Reparse points are not allowed in OpenClaw memory directories: $($item.FullName)"
      }
      if ($item.PSIsContainer) {
        $pending.Push((Resolve-NormalizedPath $item.FullName))
      } else {
        $files.Add((Resolve-NormalizedPath $item.FullName))
      }
    }
  }

  return $files
}

if ($AllowedStateRoots.Count -eq 0) {
  throw "At least one explicit AllowedStateRoots value is required."
}

$allowedVault = Assert-NoReparsePathComponents $AllowedVaultRoot
$vaultBatch = Assert-NoReparsePathComponents $VaultBatchPath
if (-not (Test-PathContained -Root $allowedVault -Candidate $vaultBatch)) {
  throw "VaultBatchPath must be a child of AllowedVaultRoot: $vaultBatch"
}
if (Test-Path -LiteralPath $vaultBatch) {
  throw "VaultBatchPath must not already exist: $vaultBatch"
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
  $rootByInstance[$instance] = $resolvedRoot
}

$sources = New-Object System.Collections.Generic.List[object]
$seenSources = @{}
foreach ($instance in @($rootByInstance.Keys | Sort-Object)) {
  $stateRoot = $rootByInstance[$instance]
  $exactPaths = @("workspace\MEMORY.md")
  $memoryDirectories = @("workspace\memory", "memory")
  if ($instance -eq "openclaw-ceoflow") {
    $exactPaths += "workspace\ceoflow-worker\MEMORY.md"
    $memoryDirectories += "workspace\ceoflow-worker\memory"
  }

  foreach ($relativePath in $exactPaths) {
    $candidate = Resolve-NormalizedPath (Join-Path $stateRoot $relativePath)
    if (-not (Test-Path -LiteralPath $candidate)) {
      continue
    }
    $source = Resolve-ExistingSafePath -Path $candidate -PathType Leaf
    if (-not (Test-PathContained -Root $stateRoot -Candidate $source)) {
      throw "OpenClaw memory source escaped its state root: $source"
    }
    $sources.Add([pscustomobject]@{ Instance = $instance; Root = $stateRoot; Source = $source })
  }

  foreach ($relativeDirectory in $memoryDirectories) {
    $candidateDirectory = Resolve-NormalizedPath (Join-Path $stateRoot $relativeDirectory)
    if (-not (Test-Path -LiteralPath $candidateDirectory)) {
      continue
    }
    $safeDirectory = Resolve-ExistingSafePath -Path $candidateDirectory -PathType Container
    if (-not (Test-PathContained -Root $stateRoot -Candidate $safeDirectory)) {
      throw "OpenClaw memory directory escaped its state root: $safeDirectory"
    }
    foreach ($source in Get-SafeFilesUnderDirectory $safeDirectory) {
      if (-not (Test-PathContained -Root $stateRoot -Candidate $source)) {
        throw "OpenClaw memory source escaped its state root: $source"
      }
      $sources.Add([pscustomobject]@{ Instance = $instance; Root = $stateRoot; Source = $source })
    }
  }
}

$planned = New-Object System.Collections.Generic.List[object]
foreach ($item in @($sources | Sort-Object Instance, Source)) {
  $relativePath = [IO.Path]::GetRelativePath($item.Root, $item.Source)
  if (-not (Test-AllowedMemoryRelativePath -Instance $item.Instance -RelativePath $relativePath)) {
    throw "Discovered file is not an allowed OpenClaw memory file: $($item.Source)"
  }
  $sourceKey = $item.Source.ToLowerInvariant()
  if ($seenSources.ContainsKey($sourceKey)) {
    throw "Duplicate OpenClaw memory source: $($item.Source)"
  }
  $seenSources[$sourceKey] = $true
  $backupPath = Resolve-NormalizedPath (Join-Path (Join-Path $vaultBatch $item.Instance) $relativePath)
  if (-not (Test-PathContained -Root $vaultBatch -Candidate $backupPath)) {
    throw "Backup path escaped the requested vault batch: $backupPath"
  }
  $planned.Add([pscustomobject]@{
    instance = $item.Instance
    relativePath = $relativePath
    sourcePath = $item.Source
    backupPath = $backupPath
    bytes = (Get-Item -LiteralPath $item.Source -Force).Length
  })
}

if ($DryRun) {
  [pscustomobject]@{
    schemaVersion = "zhixia.openclaw_memory_preservation_dry_run.v1"
    vaultPath = $vaultBatch
    plannedFileCount = $planned.Count
    plannedBytes = [int64](($planned | Measure-Object -Property bytes -Sum).Sum)
    entries = $planned
    writesPerformed = $false
    sourceFilesRemoved = $false
    rawSessionsTouched = $false
    configsTouched = $false
  } | ConvertTo-Json -Depth 8
  exit 0
}

if ($planned.Count -eq 0) {
  throw "No allowlisted OpenClaw memory files were found."
}

[IO.Directory]::CreateDirectory($allowedVault) | Out-Null
$allowedVault = Resolve-ExistingSafePath -Path $allowedVault -PathType Container
$vaultBatch = Assert-NoReparsePathComponents $vaultBatch
if (-not (Test-PathContained -Root $allowedVault -Candidate $vaultBatch)) {
  throw "VaultBatchPath escaped AllowedVaultRoot after root creation: $vaultBatch"
}
[IO.Directory]::CreateDirectory($vaultBatch) | Out-Null
$vaultBatch = Resolve-ExistingSafePath -Path $vaultBatch -PathType Container

$entries = New-Object System.Collections.Generic.List[object]
foreach ($item in $planned) {
  $source = Resolve-ExistingSafePath -Path $item.sourcePath -PathType Leaf
  $backup = Resolve-NormalizedPath $item.backupPath
  if (-not (Test-PathContained -Root $vaultBatch -Candidate $backup)) {
    throw "Backup path escaped the app-owned vault batch: $backup"
  }
  $backupParent = Split-Path -Parent $backup
  Assert-NoReparsePathComponents $backupParent | Out-Null
  [IO.Directory]::CreateDirectory($backupParent) | Out-Null
  Resolve-ExistingSafePath -Path $backupParent -PathType Container | Out-Null
  if (Test-Path -LiteralPath $backup) {
    throw "Backup destination already exists: $backup"
  }

  $sourceHashBefore = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  Copy-Item -LiteralPath $source -Destination $backup
  $backup = Resolve-ExistingSafePath -Path $backup -PathType Leaf
  $source = Resolve-ExistingSafePath -Path $source -PathType Leaf
  $sourceHashAfter = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
  $backupHash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHashBefore -ne $sourceHashAfter -or $sourceHashAfter -ne $backupHash) {
    throw "Post-copy SHA-256 verification failed: $source"
  }
  $sourceBytes = (Get-Item -LiteralPath $source -Force).Length
  $backupBytes = (Get-Item -LiteralPath $backup -Force).Length
  if ($sourceBytes -ne $backupBytes) {
    throw "Post-copy byte-count verification failed: $source"
  }

  $entries.Add([pscustomobject]@{
    instance = $item.instance
    relativePath = $item.relativePath
    sourcePath = $source
    backupPath = $backup
    bytes = [int64]$sourceBytes
    sourceSha256 = $sourceHashAfter
    backupSha256 = $backupHash
    verified = $true
  })
}

$manifestPath = Join-Path $vaultBatch "MANIFEST.json"
$manifest = [pscustomobject]@{
  schemaVersion = "zhixia.openclaw_memory_vault.v1"
  createdAt = [DateTimeOffset]::UtcNow.ToString("o")
  vaultPath = $vaultBatch
  allowedStateRoots = @($rootByInstance.Keys | Sort-Object | ForEach-Object {
    [pscustomobject]@{ instance = $_; path = $rootByInstance[$_] }
  })
  entryCount = $entries.Count
  totalBytes = [int64](($entries | Measure-Object -Property bytes -Sum).Sum)
  allVerified = $true
  sourceFilesRemoved = $false
  rawSessionsTouched = $false
  configsTouched = $false
  entries = $entries
}
$manifestJson = $manifest | ConvertTo-Json -Depth 8
$temporaryManifest = Join-Path $vaultBatch "MANIFEST.json.tmp"
[IO.File]::WriteAllText($temporaryManifest, $manifestJson, [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporaryManifest -Destination $manifestPath
Resolve-ExistingSafePath -Path $manifestPath -PathType Leaf | Out-Null

$manifestJson
