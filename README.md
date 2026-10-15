# Zphone 0.6.9

Early-access VPN client for Windows x64 and Android arm64. Downloading the app
does not grant VPN access. Sign in through the main bot
[@Zteganon_bot](https://t.me/Zteganon_bot). Every new device, including an ordinary
user's device, requires administrator approval. Available connections depend
on approved access. Importing a profile is not account sign-in.

Existing Preview installations retain their identity and settings when updated
with the same signing certificate. See [installation and verification](TESTING.md).

## Features

- Automatic or manual TrustTunnel, Mieru, NaiveProxy, AmneziaWG and Hysteria 2.
- Application-based split tunneling, recovery and local diagnostics.
- Windows tray and startup settings; Android foreground traffic notification.
- Signed update metadata, priority notices and explicit installation.
- Account sign-in and per-device approval through Telegram.
- Automatic refresh of account profiles after an app upgrade, with manual refresh available.
- Country names and local flags for all assigned ISO countries; only issued locations appear.

After the first launch of a new version, signed-in devices fetch their latest
approved profiles. No new device approval is needed for an ordinary upgrade.
An active connection defers profile replacement until disconnected. Network,
validation or storage errors retain the previous profiles and use bounded retries;
expired sessions require sign-in again. File-only installations do not request
account profiles. A deliberate manual import takes precedence for that version.

The test channel is separate from stable. Update installation is blocked while
this app's VPN is active. Windows requests administrator rights, including
opt-in startup; it does not bypass UAC. There is no persistent OS-enforced
kill switch.

## Issue Reports And Privacy

Help > "Отметить сбой" first asks for confirmation. Only after confirmation does
the authenticated client send allowlisted diagnostic events from the last three
minutes to the backend for forwarding to the administrator bot. The report is
linked to the account. Passwords, tokens, visited sites, hostnames, user-home
paths, raw core output, profile contents and application names are excluded.
Summary fields cover version/build, platform, connection state, selected route,
routing mode and counts of profiles and split-tunnel applications.

Reports contain at most 1,000 newest records and 196,608 UTF-8 bytes. There is no
background report upload. Cancel before sending transmits nothing. Success means
backend acceptance, not Telegram delivery. On a network error, retry manually
within three minutes; a recent redacted report stays only in memory with the
same identifier. Reporting does not change the VPN; upload failure does not stop
logging. Unsigned-in users must sign in. The diagnostics export action is no
longer present in the interface.

Profiles and account credentials are protected by Windows DPAPI or Android
Keystore. Logout revokes the account session, not issued server credentials.
Windows account requests can use configured HTTPS fallback endpoints and secure
DNS resolution with TLS verification. No account tokens go to the DNS provider.

## Build

Use Node.js, JDK 17+, Gradle 8.7, Android SDK 34 and the pinned native toolchains.
Keep credentials and signing keys outside the source tree.

```powershell
npm ci
npm run runtime
node scripts/fetch-naive.mjs
.\scripts\setup-go.ps1
.\scripts\setup-android.ps1
.\scripts\build-core.ps1
npm test
npm run build:icons
npm run build
npm run sync:android
.\scripts\build-preview-android.ps1
npm run package:installer
```

For an upgrade release, first verify the existing external Android keystore
and password file are present. Do not use the script's first-time key-generation
path for an upgrade. Package `org.zphone.preview` uses versionCode 18 for 0.6.9
(build android-20261015.2; Windows build windows-20261015.2).
A different certificate cannot replace an existing installation. Do not uninstall
a working client to bypass this check.

Mock report UI checks: `node scripts/qa-issue-report.cjs`, with separately
installed Playwright. Optional `ZPHONE_PLAYWRIGHT_PATH` and
`ZPHONE_CHROMIUM_PATH` select local tooling. The script uses an isolated mock
bridge, not an installed app or VPN.

Run `node scripts/qa-diagnostic-state.cjs` after the UI build to check that
connection-context changes clear old diagnostics and discard late replies.

Build and draft preparation do not publish. `updates.json` is public
configuration. Signed release metadata is not Windows Authenticode; the current
Windows installer has no Authenticode signature.

## License And Dependencies

Client code is GPL-3.0-only. Distribute corresponding source and notices with
binaries. See [native source instructions](NATIVE-SOURCE.md).

- mihomo v1.19.32, commit `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`,
  GPL-3.0; local changes in `patches/` and `scripts/build-core.ps1`.
- NaiveProxy v154.0.8037.49-4, BSD-3-Clause.
- hev-socks5-tunnel 2.18.0, MIT.
- Electron, electron-updater, adm-zip: MIT; Lucide: ISC.
- Build-time image processing: sharp, Apache-2.0.
- Country images: Twitter Twemoji 14.0.2, CC-BY 4.0.

Dependencies retain their copyright notices. See `licenses/`, the lockfile
and pinned build/download scripts for source locations and revisions.
