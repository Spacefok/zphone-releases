package org.zphone.pilot;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.util.ArrayList;
import java.util.List;

final class Account {
    private final Context context;
    private final Object guard;
    private volatile JSONObject pending;
    private volatile JSONObject pendingReport;
    private java.util.Timer reportExpiry;
    private long reportTime;
    private String reportOwner;
    private volatile String token,state="unconfigured",message="",preferred;
    private volatile Session session;
    private long generation;
    private volatile boolean closed;
    static final class Session {
        private final String token;
        final String scope;
        Session(String token) throws Exception {
            this.token=token;
            byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(("zphone-profile-scope-v1:"+token).getBytes(StandardCharsets.UTF_8));
            StringBuilder out=new StringBuilder();for(byte value:hash)out.append(String.format(java.util.Locale.ROOT,"%02x",value&255));scope=out.toString();
        }
    }
    Account(Context context,Object guard) throws Exception {this.context=context.getApplicationContext();this.guard=guard;if(config().optString("baseUrl","").startsWith("https://")){token=load();session=token==null?null:new Session(token);state=token==null?"signed_out":"authorized";}}
    Session session(){return session;}
    void cancelPending(){synchronized(guard){generation++;}}
    void close(){synchronized(guard){closed=true;generation++;}}
    private JSONObject config() throws Exception {return UpdateCheck.config(context).getJSONObject("auth");}
    JSONObject snapshot() throws Exception {JSONObject p=pending;JSONObject out=new JSONObject().put("state",state).put("message",message);if(p!=null)out.put("number",p.getString("number")).put("expires",p.getLong("expires"));return out;}
    private SecretKey key() throws Exception {
        String alias="zphone_account_v1";KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(alias)){KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");gen.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();}
        return (SecretKey)store.getKey(alias,null);
    }
    private String load() throws Exception {
        File file=new File(context.getFilesDir(),"account.enc");if(!file.isFile())return null;
        byte[] data=Files.readAllBytes(file.toPath());if(data.length<29||data.length>4096)throw new Exception("Invalid account file");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,data,0,12));return new String(cipher.doFinal(data,12,data.length-12),StandardCharsets.UTF_8);
    }
    private void save(String value) throws Exception {
        File file=new File(context.getFilesDir(),"account.enc");if(value==null){Files.deleteIfExists(file.toPath());return;}
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());byte[] encrypted=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),iv=cipher.getIV(),out=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,out,0,iv.length);System.arraycopy(encrypted,0,out,iv.length,encrypted.length);ProfileStore.atomicReplace(file,out);
    }
    private JSONObject call(String route,JSONObject data,String bearer) throws Exception {
        JSONObject settings=config();List<String> values=new ArrayList<>();
        if(settings.has("baseUrls")){var array=settings.getJSONArray("baseUrls");for(int i=0;i<array.length();i++)values.add(array.getString(i));}
        else values.add(settings.getString("baseUrl"));
        List<String> endpoints=AccessEndpoints.validate(values);
        if(preferred!=null&&endpoints.remove(preferred))endpoints.add(0,preferred);
        for(int index=0;index<endpoints.size();index++){
            try{JSONObject result=request(endpoints.get(index),route,data,bearer,index);preferred=endpoints.get(index);return result;}
            catch(AccessFailure error){if(index==endpoints.size()-1||!AccessEndpoints.retry(route,error.status,error.code,error.received))throw error;}
        }
        throw new Exception("Сервис входа недоступен.");
    }
    private static final class AccessFailure extends Exception {
        final int status;final String code;final boolean received;
        AccessFailure(String message,int status,String code,boolean received){super(message);this.status=status;this.code=code;this.received=received;}
    }
    static int status(Exception error){return error instanceof AccessFailure?((AccessFailure)error).status:0;}
    private JSONObject request(String base,String route,JSONObject data,String bearer,int attempt) throws Exception {
        URL url=new URL(new URL(base),route);
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(6000);connection.setReadTimeout(6000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");if(bearer!=null)connection.setRequestProperty("Authorization","Bearer "+bearer);
        long started=android.os.SystemClock.elapsedRealtime();int status=0;boolean received=false;String operation=route.substring(route.lastIndexOf('/')+1);
        try{
            try(var stream=connection.getOutputStream()){stream.write(data.toString().getBytes(StandardCharsets.UTF_8));}
            status=connection.getResponseCode();
            if(status!=200)throw new Exception(status==429?"Слишком много попыток входа. Подождите минуту.":"Сервис входа недоступен или заявка истекла.");
            received=true;
            try(var stream=connection.getInputStream()){
                JSONObject result=new JSONObject(new String(TunnelService.readBounded(stream,150000),StandardCharsets.UTF_8));
                Diagnostics.get(context).write("account.request",new JSONObject().put("operation",operation).put("attempt",attempt).put("ok",true).put("durationMs",android.os.SystemClock.elapsedRealtime()-started));return result;
            }
        }catch(Exception error){
            String code=NetworkFailure.code(error),text="Не удалось связаться с сервисом входа. Попробуйте другую сеть или отправьте диагностику в поддержку.";
            Diagnostics.get(context).write("account.request",new JSONObject().put("operation",operation).put("attempt",attempt).put("ok",false).put("status",status).put("errorCode",code).put("errorType",error.getClass().getSimpleName()).put("durationMs",android.os.SystemClock.elapsedRealtime()-started));
            if(status==429)text="Слишком много попыток входа. Подождите минуту.";
            else if(status==401||status==403)text="Сессия или заявка больше не действуют. Начните вход заново.";
            else if(error instanceof java.net.UnknownHostException)text="Не удалось найти сервис входа через DNS. Попробуйте другую сеть.";
            else if(error instanceof javax.net.ssl.SSLException)text="Не удалось проверить защищённое соединение. Проверьте дату и время устройства; не отключайте проверку сертификатов.";
            else if(error instanceof java.net.SocketTimeoutException)text="Сервис входа не ответил вовремя. Попробуйте другую сеть и повторите вход.";
            throw new AccessFailure(text,status,code,received);
        }finally{connection.disconnect();}
    }
    String begin() throws Exception {
        String bot=config().optString("botUsername","");if(!bot.matches("[A-Za-z0-9_]{5,32}"))throw new Exception("Вход через бота ещё не настроен.");
        final long request;
        synchronized(guard){if(closed)throw new Exception("Account closed");if(pending!=null&&pending.getLong("expires")*1000>System.currentTimeMillis())return botLink();request=++generation;}
        JSONObject result=call("/v1/device/start",new JSONObject().put("platform","android"),null);
        if(!result.getString("code").matches("[A-Za-z0-9_-]{32}")||!result.getString("secret").matches("[A-Za-z0-9_-]{43}")||!result.getString("number").matches("[0-9]{6}"))throw new Exception("Invalid login response");
        synchronized(guard){if(closed||request!=generation)throw new Exception("Account changed");pending=result;session=null;state="pending";message="";return botLink();}
    }
    String botLink() throws Exception {
        JSONObject p=pending;
        if(p==null||p.getLong("expires")*1000<=System.currentTimeMillis())throw new Exception("Заявка истекла. Начните вход заново.");
        return "https://t.me/"+config().getString("botUsername")+"?start=login_"+p.getString("code");
    }
    void poll() throws Exception {
        final JSONObject p;final long request;
        synchronized(guard){if(closed||pending==null)return;p=pending;request=generation;}
        String status=call("/v1/device/poll",p,null).getString("state");
        if(status.equals("approved")){
            synchronized(guard){if(closed||request!=generation||pending!=p)return;}
            String value=call("/v1/device/redeem",p,null).getString("token");if(!value.matches("[A-Za-z0-9_-]{43}"))throw new Exception("Invalid session");
            Session next=new Session(value);
            synchronized(guard){if(closed||request!=generation||pending!=p)return;save(value);token=value;session=next;generation++;pending=null;state="authorized";}
        }else if(status.equals("expired")||status.equals("rejected")||status.equals("consumed")){
            synchronized(guard){if(!closed&&request==generation&&pending==p){pending=null;state=status.equals("consumed")?"expired":status;}}
        }
    }
    JSONObject profiles() throws Exception {return profiles(session);}
    JSONObject profiles(Session captured) throws Exception {
        if(captured==null||session!=captured)throw new Exception("Сначала войдите через бота.");
        JSONObject result=call("/v1/session/profiles",new JSONObject(),captured.token);
        if(session!=captured||closed)throw new Exception("Account changed");
        if(!result.optString("state").equals("ready"))throw new Exception("Доступ одобрен, подключения ещё готовятся.");return result.getJSONObject("bundle");
    }
    private void clearReport(){if(reportExpiry!=null){reportExpiry.cancel();reportExpiry=null;}pendingReport=null;reportOwner=null;}
    JSONObject report(Diagnostics logger,JSONObject metadata,boolean confirmed) throws Exception {
        if(!confirmed)throw new Exception("Подтвердите отправку отчёта.");
        if(token==null)throw new Exception("Для отправки сбоя откройте «Аккаунт» и войдите через бота. Импорт файла не выполняет вход.");
        logger.write("user.mark",metadata);long now=System.currentTimeMillis();
        try{
            JSONObject body=pendingReport;
            if(body==null||!token.equals(reportOwner)||now-reportTime>IssueReport.WINDOW_MS||now<reportTime){
                clearReport();body=logger.report(metadata,now);pendingReport=body;reportTime=now;reportOwner=token;
                final JSONObject held=body;final java.util.Timer expiry=new java.util.Timer(true);reportExpiry=expiry;
                expiry.schedule(new java.util.TimerTask(){public void run(){if(pendingReport==held)pendingReport=null;expiry.cancel();}},IssueReport.WINDOW_MS);
            }
            if(IssueReport.bytes(body)>IssueReport.MAX_BYTES)throw new Exception("Report too large");
            JSONObject result=call("/v1/session/report",body,token);
            if(!IssueReport.accepted(result,body))throw new Exception("Invalid report acknowledgement");
            clearReport();logger.write("report.accepted",new JSONObject().put("ok",true));
            return new JSONObject().put("ok",true).put("reportId",result.getString("reportId")).put("state",result.getString("state"));
        }catch(Exception error){
            int status=error instanceof AccessFailure?((AccessFailure)error).status:0;
            String code=error instanceof AccessFailure?((AccessFailure)error).code:NetworkFailure.code(error);
            if(status==401||status==403)clearReport();
            logger.write("report.failed",new JSONObject().put("status",status).put("errorCode",code));
            throw new Exception(IssueReport.failure(status,code));
        }
    }
    void logout() throws Exception {
        final String previous;final long request;
        synchronized(guard){if(closed)return;request=++generation;previous=token;session=null;token=null;pending=null;state="signed_out";message="";clearReport();save(null);}
        boolean revoked=true;
        try{if(previous!=null)call("/v1/session/logout",new JSONObject(),previous);}catch(Exception e){revoked=false;}
        synchronized(guard){if(!closed&&request==generation)message=revoked?"":"Вы вышли на этом устройстве. Отзыв сессии на сервере не подтверждён.";}
    }
}
