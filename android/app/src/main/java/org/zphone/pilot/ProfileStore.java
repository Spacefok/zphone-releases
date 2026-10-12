package org.zphone.pilot;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashSet;

final class ProfileStore {
    private static final String ALIAS="zphone_test_access_v1";
    private final Context context;
    ProfileStore(Context context){this.context=context.getApplicationContext();}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(ALIAS)){
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
        }
        return (SecretKey)store.getKey(ALIAS,null);
    }
    JSONObject read() throws Exception {
        File file=new File(context.getFilesDir(),"access.enc");if(!file.exists())return null;
        byte[] data=Files.readAllBytes(file.toPath());if(data.length<29||data.length>150000)throw new Exception("Недопустимый файл доступа.");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,data,0,12));
        return validate(new JSONObject(new String(cipher.doFinal(data,12,data.length-12),StandardCharsets.UTF_8)));
    }
    void write(JSONObject value) throws Exception {
        JSONObject clean=validate(value);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] encrypted=cipher.doFinal(clean.toString().getBytes(StandardCharsets.UTF_8)),iv=cipher.getIV();
        byte[] data=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,data,0,iv.length);System.arraycopy(encrypted,0,data,iv.length,encrypted.length);
        File file=new File(context.getFilesDir(),"access.enc");Files.write(file.toPath(),data);
    }
    static JSONObject validate(JSONObject value) throws Exception {
        JSONArray input=value.optJSONArray("profiles");
        if(!"zphone-test-v1".equals(value.optString("format"))||!"test".equals(value.optString("scope"))||input==null||input.length()<1||input.length()>32)throw new Exception("Нужен файл тестовых доступов Zphone.");
        JSONArray output=new JSONArray();HashSet<String> ids=new HashSet<>();
        for(int i=0;i<input.length();i++){
            JSONObject p=input.getJSONObject(i);String id=p.optString("id"),location=p.optString("location"),protocol=p.optString("protocol"),server=p.optString("server"),username=p.optString("username"),password=p.optString("password");
            int port=p.optInt("port",0);
            if(!id.matches("[a-zA-Z0-9_-]{1,60}")||!ids.add(id)||!(location.equals("FIN")||location.equals("AMS")))throw new Exception("Некорректный тестовый доступ.");
            JSONObject clean=Protocols.validate(p);
            output.put(clean);
        }
        return new JSONObject().put("format","zphone-test-v1").put("scope","test").put("profiles",output);
    }
    private static boolean validHost(String value){return value.length()<=253&&value.matches("[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?");}
    static JSONArray publicProfiles(JSONObject bundle) throws Exception {
        JSONArray result=new JSONArray();if(bundle==null)return result;JSONArray ps=bundle.getJSONArray("profiles");
        for(int i=0;i<ps.length();i++){JSONObject p=ps.getJSONObject(i);result.put(new JSONObject().put("id",p.getString("id")).put("location",p.getString("location")).put("protocol",p.getString("protocol")));}return result;
    }
}
