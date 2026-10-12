$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$cache=Join-Path $env:LOCALAPPDATA 'ZphoneBuild'
$target=Join-Path $cache 'source-release-0.3.6'
$source=Join-Path $target 'mihomo'
if(Test-Path -LiteralPath $target){throw 'Source staging already exists; inspect it before reuse.'}
New-Item -ItemType Directory -Path $source -Force | Out-Null
$archive=Join-Path $target 'upstream.tar'
git -C (Join-Path $cache 'mihomo') archive --format=tar --output=$archive 88dcbf7f1614a67c3b36b848ee3592dfa92ada36
if($LASTEXITCODE){throw 'Source export failed.'}
tar -xf $archive -C $source
if($LASTEXITCODE){throw 'Source extraction failed.'}
Push-Location $source
$previous=$env:GOTOOLCHAIN
try {
  git apply --unsafe-paths (Join-Path $root 'patches/mihomo-client-random-prefix.patch')
  if($LASTEXITCODE){throw 'Source patch failed.'}
  $env:GOTOOLCHAIN='local'
  & (Join-Path $cache 'go/bin/go.exe') mod vendor
  if($LASTEXITCODE){throw 'Dependency source export failed.'}
}finally{Pop-Location;$env:GOTOOLCHAIN=$previous}
Copy-Item -LiteralPath (Join-Path $root 'scripts/build-core.ps1') -Destination $target
Copy-Item -LiteralPath (Join-Path $root 'patches/mihomo-client-random-prefix.patch') -Destination $target
Copy-Item -LiteralPath (Join-Path $root 'NATIVE-SOURCE.md') -Destination (Join-Path $target 'README.md')
$output=Join-Path $root 'release/Zphone-native-source-0.3.6.zip'
tar -a -cf $output -C $target mihomo build-core.ps1 mihomo-client-random-prefix.patch README.md
if($LASTEXITCODE){throw 'Source packaging failed.'}
Get-FileHash -Algorithm SHA256 -LiteralPath $output
