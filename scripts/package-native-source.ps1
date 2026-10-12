$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$cache=Join-Path $env:LOCALAPPDATA 'ZphoneBuild'
$version=(Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
if($version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid source release version.'}
$target=Join-Path $cache ('source-release-'+$version)
$output=Join-Path $root ('release/Zphone-native-source-'+$version+'.zip')
$commit='88dcbf7f1614a67c3b36b848ee3592dfa92ada36'
$patch=Join-Path $root 'patches/mihomo-client-random-prefix.patch'
$patchHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $patch).Hash.ToLower()
$inputs=@()
foreach($binary in @('runtime/windows/mihomo.exe','android/app/src/main/jniLibs/arm64-v8a/libmihomo.so')){
  $file=Join-Path $root $binary
  $metadata=Get-Content -Raw -LiteralPath ($file+'.build.json') | ConvertFrom-Json
  $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower()
  if($metadata.commit -ne $commit -or $metadata.patchSha256 -ne $patchHash -or $metadata.sha256 -ne $hash){throw 'Native build inputs do not match the source release.'}
  $inputs+=@{file=$binary;sha256=$hash;commit=$commit;patchSha256=$patchHash}
}
$source=Join-Path $target 'mihomo'
if(Test-Path -LiteralPath $target){throw 'Source staging already exists; inspect it before reuse.'}
if(Test-Path -LiteralPath $output){throw 'Source archive already exists; inspect it before reuse.'}
New-Item -ItemType Directory -Path $source -Force | Out-Null
$archive=Join-Path $target 'upstream.tar'
git -C (Join-Path $cache 'mihomo') archive --format=tar --output=$archive $commit
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
@{version=$version;inputs=$inputs} | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $target 'BUILD-INPUTS.json')
tar -a -cf $output -C $target mihomo build-core.ps1 mihomo-client-random-prefix.patch README.md BUILD-INPUTS.json
if($LASTEXITCODE){throw 'Source packaging failed.'}
Get-FileHash -Algorithm SHA256 -LiteralPath $output
