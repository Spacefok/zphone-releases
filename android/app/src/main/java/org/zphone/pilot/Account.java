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
    private JSONObject pending;
    private String token,state="unconfigured",message="",preferred;
    Account(Context context) throws Exception {this.context=context.getApplicationContext();if(config().optString("baseUrl","").startsWith("https://")){token=load();state=token==null?"signed_out":"authorized";}}
    private JSONObject config() throws Exception {return UpdateCheck.config(context).getJSONObject("auth");}
    synchronized JSONObject snapshot() throws Exception {JSONObject out=new JSONObject().put("state",state).put("message",message);if(pending!=null)out.put("number",pending.getString("number")).put("expires",pending.getLong("expires"));return out;}
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
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());byte[] encrypted=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),iv=cipher.getIV(),out=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,out,0,iv.length);System.arraycopy(encrypted,0,out,iv.length,encrypted.length);Files.write(file.toPath(),out);
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
    synchronized String begin() throws Exception {
        String bot=config().optString("botUsername","");if(!bot.matches("[A-Za-z0-9_]{5,32}"))throw new Exception("Вход через бота ещё не настроен.");
        if(pending!=null&&pending.getLong("expires")*1000>System.currentTimeMillis())return botLink();
        JSONObject result=call("/v1/device/start",new JSONObject().put("platform","android"),null);
        if(!result.getString("code").matches("[A-Za-z0-9_-]{32}")||!result.getString("secret").matches("[A-Za-z0-9_-]{43}")||!result.getString("number").matches("[0-9]{6}"))throw new Exception("Invalid login response");
        pending=result;state="pending";message="";return botLink();
    }
    synchronized String botLink() throws Exception {
        if(pending==null||pending.getLong("expires")*1000<=System.currentTimeMillis())throw new Exception("Заявка истекла. Начните вход заново.");
        return "https://t.me/"+config().getString("botUsername")+"?start=login_"+pending.getString("code");
    }
    synchronized void poll() throws Exception {
        if(pending==null)return;String status=call("/v1/device/poll",pending,null).getString("state");
        if(status.equals("approved")){String value=call("/v1/device/redeem",pending,null).getString("token");if(!value.matches("[A-Za-z0-9_-]{43}"))throw new Exception("Invalid session");save(value);token=value;pending=null;state="authorized";}
        else if(status.equals("expired")||status.equals("rejected")||status.equals("consumed")){pending=null;state=status.equals("consumed")?"expired":status;}
    }
    synchronized JSONObject profiles() throws Exception {if(token==null)throw new Exception("Сначала войдите через бота.");JSONObject result=call("/v1/session/profiles",new JSONObject(),token);if(!result.optString("state").equals("ready"))throw new Exception("Доступ одобрен, подключения ещё готовятся.");return result.getJSONObject("bundle");}
    synchronized void logout() throws Exception {
        boolean revoked=true;
        try{if(token!=null)call("/v1/session/logout",new JSONObject(),token);}catch(Exception e){revoked=false;}
        save(null);token=null;pending=null;state="signed_out";
        message=revoked?"":"Вы вышли на этом устройстве. Отзыв сессии на сервере не подтверждён.";
    }
}
