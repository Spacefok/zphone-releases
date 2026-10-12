param([ValidateSet('windows','android','all')][string]$Platform='all')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$cache=Join-Path $env:LOCALAPPDATA 'ZphoneBuild'
$source=Join-Path $cache 'mihomo'
$go=Join-Path $cache 'go\bin\go.exe'
$commit='88dcbf7f1614a67c3b36b848ee3592dfa92ada36'
$previous=@{}
foreach($name in @('GOTOOLCHAIN','CGO_ENABLED','GOOS','GOARCH','GOAMD64','CC')){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
if(!(Test-Path -LiteralPath $go)){throw 'Run scripts/setup-go.ps1 first.'}
if(!(Test-Path -LiteralPath $source)){
    git clone --depth 1 --branch v1.19.32 https://github.com/MetaCubeX/mihomo.git $source
    if($LASTEXITCODE){throw 'Core checkout failed.'}
}
Push-Location $source
try {
    if((git rev-parse HEAD).Trim() -ne $commit){throw 'Unexpected core source revision. Preserve and inspect the checkout.'}
    $patch=Join-Path $root 'patches\mihomo-client-random-prefix.patch'
    git apply --reverse --check $patch 2>$null
    if($LASTEXITCODE){
        git apply --check $patch
        if($LASTEXITCODE){throw 'Core patch conflicts; no files were reset.'}
        git apply $patch
        if($LASTEXITCODE){throw 'Core patch failed.'}
    }
    $env:GOTOOLCHAIN='local'
    $env:CGO_ENABLED='0'
    $env:GOOS='windows'
    $env:GOARCH='amd64'
    & $go test -p 4 ./transport/trusttunnel -run ClientRandom
    if($LASTEXITCODE){throw 'Core TLS tests failed.'}
    $targets=if($Platform -eq 'all'){@('windows','android')}else{@($Platform)}
    foreach($target in $targets){
        if($target -eq 'windows'){
            $env:GOOS='windows';$env:GOARCH='amd64';$env:CGO_ENABLED='0';$env:GOAMD64='v1'
            $output=Join-Path $root 'runtime\windows\mihomo.exe'
        }else{
            $env:GOOS='android';$env:GOARCH='arm64';$env:CGO_ENABLED='1'
            $env:CC=Join-Path $cache 'android-sdk\ndk\27.2.12479018\toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android29-clang.cmd'
            if(!(Test-Path -LiteralPath $env:CC)){throw 'Install NDK 27.2.12479018 in the isolated Android SDK.'}
            $output=Join-Path $root 'android\app\src\main\jniLibs\arm64-v8a\libmihomo.so'
        }
        New-Item -ItemType Directory -Force -Path (Split-Path $output -Parent) | Out-Null
        & $go build -p 4 -tags with_gvisor -trimpath -ldflags '-s -w -X github.com/metacubex/mihomo/constant.Version=v1.19.32-zphone.1' -o $output .
        if($LASTEXITCODE){throw "Core build failed: $target"}
        $metadata=@{version='v1.19.32-zphone.1';commit=$commit;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLower();patchSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $patch).Hash.ToLower()}
        $metadata | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath ($output+'.build.json')
    }
}finally{
    Pop-Location
    foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
}
