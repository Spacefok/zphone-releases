package org.zphone.pilot;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import org.json.JSONObject;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;

final class UpdateCheck {
    private static JSONObject status=new JSONObject(),selected,envelope;
    private static boolean working;
    static JSONObject config(Context context) throws Exception {try(var in=context.getAssets().open("updates.json")){return new JSONObject(new String(TunnelService.readBounded(in,65536),StandardCharsets.UTF_8));}}
    static synchronized JSONObject snapshot() throws Exception {return new JSONObject(status.toString());}
    private static synchronized JSONObject state(String name,String message) throws Exception {status.put("state",name).put("message",message);MainActivity.notifyState();return snapshot();}
    private static HttpURLConnection open(URL initial) throws Exception {
        URL url=initial;
        for(int n=0;n<4;n++){
            if(!url.getProtocol().equals("https")||url.getUserInfo()!=null||(url.getPort()!=-1&&url.getPort()!=443))throw new Exception("Invalid HTTPS URL");
            if(!url.getHost().equals("github.com")&&!url.getHost().equals("release-assets.githubusercontent.com")&&!url.getHost().equals("objects.githubusercontent.com"))throw new Exception("Invalid download host");
            HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(30000);int code=c.getResponseCode();
            if(code==200)return c;String location=c.getHeaderField("Location");c.disconnect();
            if(code<300||code>399||location==null)throw new Exception("Download unavailable");url=new URL(url,location);
        }throw new Exception("Too many redirects");
    }
    static JSONObject verify(JSONObject signed,JSONObject config) throws Exception {
        String body=signed.getString("payload"),sig=signed.getString("signature");if(body.length()>44000||sig.length()>1024)throw new Exception("Invalid release size");
        String pem=config.getString("publicKey").replace("-----BEGIN PUBLIC KEY-----","").replace("-----END PUBLIC KEY-----","").replaceAll("\\s","");
        RSAPublicKey key=(RSAPublicKey)KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(pem)));if(key.getModulus().bitLength()<3072)throw new Exception("Invalid signing key");
        byte[] bytes=Base64.getDecoder().decode(body);Signature check=Signature.getInstance("SHA256withRSA");check.initVerify(key);check.update(bytes);if(!check.verify(Base64.getDecoder().decode(sig)))throw new Exception("Invalid release signature");
        JSONObject release=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        if(!release.getString("format").equals("zphone-release-v1")||!release.getString("channel").equals(config.getString("channel"))||Instant.parse(release.getString("expires")).toEpochMilli()<=System.currentTimeMillis()||Instant.parse(release.getString("published")).toEpochMilli()>System.currentTimeMillis()+300000||!release.getString("version").matches("[0-9]+\\.[0-9]+\\.[0-9]+")||release.getString("notes").length()>4000)throw new Exception("Invalid release");
        JSONObject asset=release.getJSONObject("assets").getJSONObject("android-arm64");URL url=new URL(asset.getString("url"));
        if(!url.getProtocol().equals("https")||!url.getHost().equals("github.com")||url.getUserInfo()!=null||url.getQuery()!=null||url.getRef()!=null||!url.getPath().startsWith("/"+config.getString("repository")+"/releases/download/")||url.getPath().contains("..")||asset.getLong("bytes")<1||asset.getLong("bytes")>1073741824L||!asset.getString("sha256").matches("[a-f0-9]{64}")||!asset.getString("sha512").matches("[A-Za-z0-9+/]{86}==")||!asset.getString("package").equals("org.zphone.preview")||asset.getLong("versionCode")<1)throw new Exception("Invalid release asset");
        return release;
    }
    static JSONObject check(Context context) throws Exception {
        synchronized(UpdateCheck.class){if(working||status.optString("state").equals("ready")||status.optString("state").equals("installing"))return snapshot();working=true;}
        try{
            JSONObject cfg=config(context);if(cfg.isNull("publicKey"))return state("unconfigured","Тестовый канал ещё не опубликован.");
            String repo=cfg.getString("repository"),channel=cfg.getString("channel");if(!repo.matches("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")||!channel.matches("test|stable"))throw new Exception("Invalid channel");
            state("checking","");HttpURLConnection c=open(new URL("https://github.com/"+repo+"/releases/download/"+channel+"/release.json"));
            JSONObject signed;try(var stream=c.getInputStream()){signed=new JSONObject(new String(TunnelService.readBounded(stream,65536),StandardCharsets.UTF_8));}finally{c.disconnect();}
            JSONObject release=verify(signed,cfg);long current=context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode();
            synchronized(UpdateCheck.class){selected=release;envelope=signed;status.put("version",release.getString("version")).put("notes",release.getString("notes"));}
            return state(release.getJSONObject("assets").getJSONObject("android-arm64").getLong("versionCode")>current?"available":"current","");
        }catch(Exception e){return state("error","Не удалось проверить подписанное обновление.");}finally{synchronized(UpdateCheck.class){working=false;}}
    }
    static JSONObject download(Context context) throws Exception {
        return download(context,()->false);
    }
    static JSONObject download(Context context,java.util.function.BooleanSupplier cancelled) throws Exception {
        if(context.getSharedPreferences("settings",Context.MODE_PRIVATE).getBoolean("updateWifiOnly",true)&&((android.net.ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE)).isActiveNetworkMetered())throw new Exception("Ожидаем Wi-Fi. Разрешить мобильную загрузку можно в настройках обновлений.");
        synchronized(UpdateCheck.class){if(working||!status.optString("state").equals("available"))return snapshot();working=true;}
        File part=new File(context.getCacheDir(),"update.part"),apk=new File(context.getCacheDir(),"update.apk");
        try{
            if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();
            JSONObject asset=selected.getJSONObject("assets").getJSONObject("android-arm64");state("downloading","");long expected=asset.getLong("bytes");if(part.getParentFile().getUsableSpace()<expected+16777216)throw new Exception("Insufficient space");
            HttpURLConnection c=open(new URL(asset.getString("url")));
            try(var in=c.getInputStream();var out=Files.newOutputStream(part.toPath())){byte[] buffer=new byte[65536];long total=0,last=0;int n;while((n=in.read(buffer))!=-1){if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();total+=n;if(total>expected)throw new Exception("File too large");out.write(buffer,0,n);if(System.currentTimeMillis()-last>500){synchronized(UpdateCheck.class){status.put("percent",(int)(total*100/expected));}MainActivity.notifyState();last=System.currentTimeMillis();}}}finally{c.disconnect();}
            if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();
            verifyFile(context,part);if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();Files.move(part.toPath(),apk.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);return state("ready","");
        }catch(java.util.concurrent.CancellationException e){Files.deleteIfExists(part.toPath());return state("available","");}catch(Exception e){Files.deleteIfExists(part.toPath());return state("error","Загрузка или проверка обновления не удалась.");}finally{synchronized(UpdateCheck.class){working=false;}}
    }
    private static void verifyFile(Context context,File file) throws Exception {
        JSONObject asset=verify(envelope,config(context)).getJSONObject("assets").getJSONObject("android-arm64");if(file.length()!=asset.getLong("bytes"))throw new Exception("Invalid file size");
        MessageDigest sha=MessageDigest.getInstance("SHA-256"),sha512=MessageDigest.getInstance("SHA-512");try(var in=Files.newInputStream(file.toPath())){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){sha.update(buffer,0,n);sha512.update(buffer,0,n);}}
        StringBuilder hex=new StringBuilder();for(byte b:sha.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",b));if(!hex.toString().equals(asset.getString("sha256"))||!Base64.getEncoder().encodeToString(sha512.digest()).equals(asset.getString("sha512")))throw new Exception("Invalid checksum");
        var pm=context.getPackageManager();var archive=pm.getPackageArchiveInfo(file.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES);var current=pm.getPackageInfo(context.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        if(archive==null||!archive.packageName.equals(context.getPackageName())||archive.getLongVersionCode()!=asset.getLong("versionCode")||archive.getLongVersionCode()<=current.getLongVersionCode()||archive.signingInfo==null||current.signingInfo==null)throw new Exception("Invalid APK identity");
        var old=current.signingInfo.getApkContentsSigners();var next=archive.signingInfo.getApkContentsSigners();if(old.length!=1||next.length!=1||!old[0].equals(next[0]))throw new Exception("APK signer migration required");
    }
    static void install(Activity activity) throws Exception {
        if(TunnelService.running())throw new Exception("Сначала отключите VPN. Обновление уже скачано.");
        if(!status.optString("state").equals("ready"))throw new Exception("Обновление ещё не готово.");
        if(!activity.getPackageManager().canRequestPackageInstalls()){activity.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));return;}
        File file=new File(activity.getCacheDir(),"update.apk");verifyFile(activity,file);if(TunnelService.running())throw new Exception("Сначала отключите VPN.");
        var installer=activity.getPackageManager().getPackageInstaller();var params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);params.setAppPackageName(activity.getPackageName());if(android.os.Build.VERSION.SDK_INT>=31)params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        int id=installer.createSession(params);state("installing","");try(var session=installer.openSession(id)){try(var in=Files.newInputStream(file.toPath());var out=session.openWrite("base.apk",0,file.length())){in.transferTo(out);session.fsync(out);}var intent=new Intent(activity,UpdateReceiver.class);var pending=PendingIntent.getBroadcast(activity,id,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE);session.commit(pending.getIntentSender());}catch(Exception e){installer.abandonSession(id);state("ready","Установка не завершена.");throw e;}
    }
    static void installFailed(){try{state("ready","Установка не завершена.");}catch(Exception ignored){}}
}
