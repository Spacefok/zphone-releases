$ErrorActionPreference = 'Stop'
$sdk = Join-Path $env:LOCALAPPDATA 'ZphoneBuild\android-sdk'
$tools = Join-Path $sdk 'cmdline-tools\latest\bin\android.exe'
if (-not (Test-Path -LiteralPath $tools)) {
    $download = Join-Path $env:LOCALAPPDATA 'ZphoneBuild\commandline.zip'
    New-Item -ItemType Directory -Force -Path (Split-Path $download) | Out-Null
    if (-not (Test-Path -LiteralPath $download)) {
        Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip' -OutFile $download
    }
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA1).Hash -ne '57D04F2D75EB8E8FFFC5000A987E5DE4B5A63E9D') { throw 'SDK checksum mismatch' }
    $extract = Join-Path $env:LOCALAPPDATA 'ZphoneBuild\commandline-extracted'
    Expand-Archive -LiteralPath $download -DestinationPath $extract -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $sdk 'cmdline-tools\latest') | Out-Null
    Copy-Item -Path (Join-Path $extract 'cmdline-tools\*') -Destination (Join-Path $sdk 'cmdline-tools\latest') -Recurse -Force
}
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$android = Join-Path (Split-Path $tools) 'android.exe'
foreach ($package in @('platforms/android-34', 'build-tools/34.0.0', 'ndk/27.2.12479018')) {
    & $android --no-metrics "--sdk=$sdk" sdk install $package
    if ($LASTEXITCODE -ne 0) { throw "Android SDK installation failed: $package" }
}
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'platforms\android-34\android.jar'))) { throw 'Android platform missing' }
Write-Output "Isolated Android SDK: $sdk"
