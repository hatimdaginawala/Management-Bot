# create-repository-files.ps1
#
# Creates 22 empty repository files under src/db/repositories/.
# Run from the project root.
#
# Usage:
#   cd C:\Users\Admin\Downloads\24th-guard-rifles-bot
#   .\create-repository-files.ps1

$ErrorActionPreference = 'Stop'

# Ensure we're in the project root
$projectRoot = $PSScriptRoot
if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
    Write-Host "ERROR: package.json not found in $projectRoot" -ForegroundColor Red
    Write-Host "Run this script from the project root." -ForegroundColor Red
    exit 1
}

$repoDir = Join-Path $projectRoot 'src\db\repositories'

# Create folder if missing
if (-not (Test-Path $repoDir)) {
    Write-Host "Creating folder: $repoDir" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $repoDir | Out-Null
}

# All 22 repository filenames
$files = @(
    'user.repository.js',
    'verification.repository.js',
    'role.repository.js',
    'permission.repository.js',
    'roleAssignment.repository.js',
    'event.repository.js',
    'eventType.repository.js',
    'eventAttendee.repository.js',
    'attendance.repository.js',
    'quotaPolicy.repository.js',
    'quotaPeriod.repository.js',
    'quotaPeriodPolicy.repository.js',
    'quotaResult.repository.js',
    'strike.repository.js',
    'leave.repository.js',
    'notice.repository.js',
    'removalRequest.repository.js',
    'settings.repository.js',
    'auditLog.repository.js',
    'rankHistory.repository.js',
    'syncLog.repository.js',
    'report.repository.js'
)

$created = 0
$skipped = 0

foreach ($file in $files) {
    $fullPath = Join-Path $repoDir $file
    if (Test-Path $fullPath) {
        Write-Host "  SKIP  $file (already exists)" -ForegroundColor Yellow
        $skipped++
    } else {
        New-Item -ItemType File -Path $fullPath -Force | Out-Null
        Write-Host "  CREATE $file" -ForegroundColor Green
        $created++
    }
}

# Also create an index file for convenience (will be filled in later)
$indexPath = Join-Path $repoDir 'index.js'
if (-not (Test-Path $indexPath)) {
    New-Item -ItemType File -Path $indexPath -Force | Out-Null
    Write-Host "  CREATE index.js" -ForegroundColor Green
    $created++
} else {
    Write-Host "  SKIP  index.js (already exists)" -ForegroundColor Yellow
    $skipped++
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
Write-Host "  Created: $created" -ForegroundColor Green
Write-Host "  Skipped: $skipped" -ForegroundColor Yellow
Write-Host ""
Write-Host "Files are in: $repoDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next: open each file and paste the code." -ForegroundColor White
Write-Host ""