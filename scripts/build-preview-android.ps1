$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$keys=Join-Path $env:LOCALAPPDATA 'ZphoneRelease'
$store=Join-Path $keys 'preview-android.p12'
$protected=Join-Path $keys 'preview-android-password.dpapi'
$previous=@{}
foreach($name in @('JAVA_HOME','ZPHONE_ANDROID_KEYSTORE','ZPHONE_ANDROID_KEY_PASSWORD')){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try {
    $env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
    Add-Type -AssemblyName System.Security
    New-Item -ItemType Directory -Force -Path $keys | Out-Null
    if(!(Test-Path -LiteralPath $store)){
        if(Test-Path -LiteralPath $protected){throw 'Incomplete key setup requires inspection.'}
        $bytes=New-Object byte[] 36
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $password=[Convert]::ToBase64String($bytes)
        $encrypted=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($password),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        [IO.File]::WriteAllBytes($protected,$encrypted)
        $env:ZPHONE_ANDROID_KEY_PASSWORD=$password
        & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $store -storetype PKCS12 -alias zphone-preview -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Zphone Preview' -storepass:env ZPHONE_ANDROID_KEY_PASSWORD -keypass:env ZPHONE_ANDROID_KEY_PASSWORD
        if($LASTEXITCODE){throw 'Android signing key creation failed.'}
    }
    $env:ZPHONE_ANDROID_KEYSTORE=$store
    $env:ZPHONE_ANDROID_KEY_PASSWORD=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($protected),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
    $gradle=Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.gradle\wrapper\dists\gradle-8.7-all') -Recurse -Filter gradle.bat | Select-Object -First 1 -ExpandProperty FullName
    if(!$gradle){throw 'Gradle 8.7 is required.'}
    Push-Location (Join-Path $root 'android')
    try { & $gradle --no-daemon assembleRelease; if($LASTEXITCODE){throw 'Release build failed.'} } finally { Pop-Location }
    $version=(Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    Copy-Item -LiteralPath (Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk') -Destination (Join-Path $root "release\android\Zphone-$version-arm64.apk")
} finally {
    foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
}
