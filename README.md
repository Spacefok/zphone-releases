# Zphone Preview

Test VPN client for Windows x64 and Android arm64. Access requires an approved
private profile; downloading this application does not grant VPN access.

Preview is installed separately from existing clients, with its own local
storage, Android package and Windows startup entry. Current private connections
are not migrated or deleted automatically. See [test instructions](TESTING.md).

## Features

- Automatic or manual protocol selection: TrustTunnel, Mieru, NaiveProxy,
  AmneziaWG and Hysteria 2.
- Application-based split tunneling, connection recovery and local diagnostics.
- Windows tray and startup settings; Android foreground traffic notification.
- Signed update metadata, explicit installation and Telegram device approval.

The test channel is separate from stable releases. Installation never starts
while this application's VPN is active. Windows VPN mode requires an elevated
launch. The client does not provide a persistent OS-enforced kill switch.

## Build

Use Node.js, JDK 17+, Gradle 8.7, the Android SDK and the pinned native toolchains
described in the build scripts. Do not store credentials in this repository.

```powershell
npm ci
npm run runtime
node scripts/fetch-naive.mjs
.\scripts\setup-go.ps1
.\scripts\setup-android.ps1
.\scripts\build-core.ps1
npm test
npm run build
npm run package:installer
npm run sync:android
.\scripts\build-preview-android.ps1
```

The Android command above builds a release APK using a dedicated Preview key
kept outside the source tree. An existing APK
with a different signing certificate cannot be replaced without a planned
migration. Never uninstall an existing client without backing up its access.

The installer build does not publish. `updates.json` contains public configuration
only. The release signing key and authorization bridge key must remain private.
No GitHub access token is embedded in the client or needed to download releases.

## Privacy

Profiles are encrypted using Windows DPAPI or Android Keystore. Diagnostics stay
local until explicitly exported. The login service receives a device platform and
Telegram identity through the bot, but not installed applications or traffic logs.
Each new device requires administrator approval. Logging out revokes its delivery
session; revoking already issued VPN credentials is a separate server operation.

## License And Dependencies

Client code is GPL-3.0-only. Keep the included notices and corresponding source
with binary distributions. Native runtime sources must accompany public releases:

- mihomo v1.19.32, commit `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`, GPL-3.0;
  local changes and build instructions are in `patches/` and `scripts/build-core.ps1`.
- NaiveProxy v154.0.8037.49-4, BSD-3-Clause.
- hev-socks5-tunnel 2.18.0, MIT.
- Electron, electron-updater, adm-zip: MIT; Lucide: ISC.
- Country images: Twitter Twemoji 14.0.2, CC-BY 4.0.

Dependencies retain their own copyright notices. See `licenses/`, the lockfile,
and pinned download/build scripts for source locations and revisions.
