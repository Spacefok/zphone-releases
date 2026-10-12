export const PUBLIC_SCRIPTS = [
  'setup-go.ps1', 'setup-android.ps1', 'build-core.ps1', 'build-android.ps1',
  'build-preview-android.ps1', 'build-icons.mjs', 'package-native-source.ps1',
  'fetch-runtime.mjs', 'fetch-naive.mjs', 'sync-android.mjs', 'package-installer.mjs',
  'release-key.mjs', 'sign-release.mjs', 'preview-release-draft.mjs',
  'qa-issue-report.cjs', 'qa-diagnostic-state.cjs', 'public-source-files.mjs',
];

export const REQUIRED_REPORT_FILES = [
  'desktop/diagnostics-report.mjs', 'desktop/diagnostics.mjs',
  'desktop/account.mjs', 'desktop/main.cjs', 'desktop/preload.cjs',
  'shared/account-policy.mjs', 'shared/profiles.mjs', 'shared/release.mjs',
  'src/issue-report.js', 'src/diagnostic-state.js', 'src/app.js', 'src/bridge.js',
  'android/app/src/main/java/org/zphone/pilot/IssueReport.java',
  'android/app/src/main/java/org/zphone/pilot/Diagnostics.java',
  'android/app/src/main/java/org/zphone/pilot/Account.java',
  'android/app/src/main/java/org/zphone/pilot/MainActivity.java',
  'test/issue-report.test.mjs', 'test/android-issue-report.test.mjs',
  'test/java/IssueReportTest.java', 'test/preload.test.mjs',
  'test/public-source.test.mjs', 'test/diagnostic-state.test.mjs',
];

export function assertPublicSourceFiles(files) {
  const present = new Set(files);
  for (const name of [...REQUIRED_REPORT_FILES, ...PUBLIC_SCRIPTS.map(name => 'scripts/' + name)]) {
    if (!present.has(name)) throw Error('Missing public source: ' + name);
  }
}
