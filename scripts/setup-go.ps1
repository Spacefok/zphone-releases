$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'ZphoneBuild'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$archive=Join-Path $root 'go1.26.9.windows-amd64.zip'
if(-not(Test-Path -LiteralPath $archive)){Invoke-WebRequest 'https://go.dev/dl/go1.26.9.windows-amd64.zip' -OutFile $archive}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne 'D722201A9C0C086D1610E111C48203009AF690892ED708072BD5AE20160E7A59'){throw 'Go checksum mismatch'}
if(-not(Test-Path -LiteralPath (Join-Path $root 'go\bin\go.exe'))){Expand-Archive -LiteralPath $archive -DestinationPath $root}
& (Join-Path $root 'go\bin\go.exe') version
