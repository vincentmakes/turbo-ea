# Run from any directory after installing the Ponytail plugin (see SETUP.md).
param([string]$PonytailSkills)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not $PonytailSkills) {
    $claudeConfig = $env:CLAUDE_CONFIG_DIR
    if (-not $claudeConfig) { $claudeConfig = Join-Path $env:USERPROFILE '.claude' }
    $registry = Get-Content -Raw -LiteralPath (Join-Path $claudeConfig 'plugins/installed_plugins.json') | ConvertFrom-Json
    $installations = @($registry.plugins.'ponytail@ponytail')
    $installation = $installations | Where-Object { $_.projectPath -eq $project } | Select-Object -First 1
    if (-not $installation) {
        $installation = $installations | Where-Object { $_.scope -eq 'user' } | Select-Object -First 1
    }
    if (-not $installation) { throw 'Install Ponytail as described in SETUP.md or pass -PonytailSkills <directory>.' }
    $PonytailSkills = Join-Path $installation.installPath 'skills'
}

$targets = @(Get-ChildItem -Directory -LiteralPath (Join-Path $project '.claude/skills'))
foreach ($name in @('ponytail','ponytail-audit','ponytail-debt','ponytail-gain','ponytail-help','ponytail-review')) {
    $targets += Get-Item -LiteralPath (Join-Path $PonytailSkills $name)
}
$destination = Join-Path $PSScriptRoot 'skills'
$existing = @{}
if (Test-Path -LiteralPath $destination) {
    foreach ($entry in Get-ChildItem -Force -LiteralPath $destination) { $existing[$entry.Name] = $entry }
}
foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath (Join-Path $target.FullName 'SKILL.md') -PathType Leaf)) {
        throw "Missing SKILL.md in $($target.FullName)"
    }
    $entry = $existing[$target.Name]
    if ($entry -and ($entry.LinkType -ne 'Junction' -or [string]$entry.Target -ne $target.FullName)) {
        throw "Existing path $($entry.FullName) differs from the expected junction to $($target.FullName)."
    }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($target in $targets) {
    if (-not $existing.ContainsKey($target.Name)) {
        New-Item -ItemType Junction -Path (Join-Path $destination $target.Name) -Target $target.FullName | Out-Null
    }
}
Write-Output "$($targets.Count) Codex skill links ready."
