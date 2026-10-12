$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$gradle = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.7-all') -Recurse -Filter gradle.bat | Select-Object -First 1 -ExpandProperty FullName
if (-not $gradle) { throw 'Gradle 8.7 is required.' }
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Push-Location (Join-Path $root 'android')
try {
    & $gradle --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
    $target = Join-Path $root 'release\android'
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $version=(Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    Copy-Item -LiteralPath (Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk') -Destination (Join-Path $target "Zphone-Test-$version-arm64.apk") -Force
} finally { Pop-Location }
