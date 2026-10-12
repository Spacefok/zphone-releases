# Zphone Native Runtime Source

This archive contains the corresponding modified mihomo source used by both
Windows x64 and Android arm64 releases 0.3.6 and 0.3.7. No access profiles or
private application settings are included.

Upstream: https://github.com/MetaCubeX/mihomo
Revision: 88dcbf7f1614a67c3b36b848ee3592dfa92ada36 (v1.19.32).
The included client-random-prefix patch is already applied. Dependencies and
their license notices are included under mihomo/vendor. See mihomo/LICENSE.

Use Go 1.26.9. From the mihomo directory, build Windows with:

```powershell
$env:GOOS='windows'; $env:GOARCH='amd64'; $env:GOAMD64='v1'
$env:CGO_ENABLED='0'; $env:GOTOOLCHAIN='local'
go build -mod=vendor -tags with_gvisor -trimpath -ldflags '-s -w -X github.com/metacubex/mihomo/constant.Version=v1.19.32-zphone.1' -o mihomo.exe .
```

For Android use GOOS=android, GOARCH=arm64 and CGO_ENABLED=1. Set CC to the
Android NDK 27.2.12479018 aarch64-linux-android29-clang compiler. Use the same
build flags and name the executable libmihomo.so. The accompanying build script
documents the toolchain setup; the public client repository contains SDK setup,
packaging and application sources.

Other native components are unmodified upstream binaries:
- NaiveProxy v154.0.8037.49-4 (BSD-3-Clause):
  https://github.com/klzgrad/naiveproxy/tree/v154.0.8037.49-4
- hev-socks5-tunnel 2.18.0 (MIT):
  https://github.com/heiher/hev-socks5-tunnel/tree/2.18.0

Their retained license notices ship with the client. Upstream source contains
third-party names and copyright notices; these must remain intact.
