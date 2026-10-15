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
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.HashMap;

final class ProfileStore {
    private static final String ALIAS="zphone_test_access_v1";
    private final Context context;
    static final class Saved {
        final JSONObject bundle;
        final String version,scope,source;
        final long checkedAt;
        Saved(JSONObject bundle,String version,String scope,long checkedAt){this(bundle,version,scope,checkedAt,"account");}
        Saved(JSONObject bundle,String version,String scope,long checkedAt,String source){this.bundle=bundle;this.version=version;this.scope=scope;this.checkedAt=checkedAt;this.source=source;}
    }
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
        return readSaved().bundle;
    }
    Saved readSaved() throws Exception {
        File file=new File(context.getFilesDir(),"access.enc");if(!file.exists())return new Saved(null,null,null,0);
        byte[] data=Files.readAllBytes(file.toPath());if(data.length<29||data.length>150000)throw new Exception("Недопустимый файл доступа.");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,data,0,12));
        JSONObject value=new JSONObject(new String(cipher.doFinal(data,12,data.length-12),StandardCharsets.UTF_8));
        if(!"zphone-vault-v2".equals(value.optString("format")))return new Saved(validate(value),null,null,0);
        JSONObject clean=validate(value.getJSONObject("bundle")),saved=value.optJSONObject("profileSync");
        if(saved!=null&&saved.optString("version").matches("[0-9]+\\.[0-9]+\\.[0-9]+")
                &&saved.optString("scope").matches("[a-f0-9]{64}")&&saved.optLong("checkedAt",0)>0
                &&saved.optString("source","account").matches("account|import"))
            return new Saved(clean,saved.getString("version"),saved.getString("scope"),saved.getLong("checkedAt"),saved.optString("source","account"));
        return new Saved(clean,null,null,0);
    }
    void write(JSONObject value) throws Exception {
        write(value,null,null,0,null);
    }
    void write(JSONObject value,String version,String scope,long checkedAt,String source) throws Exception {
        JSONObject clean=validate(value),vault=new JSONObject().put("format","zphone-vault-v2").put("bundle",clean);
        if(version!=null){
            if(!version.matches("[0-9]+\\.[0-9]+\\.[0-9]+")||scope==null||!scope.matches("[a-f0-9]{64}")||checkedAt<=0||source==null||!source.matches("account|import"))throw new Exception("Invalid refresh marker");
            vault.put("profileSync",new JSONObject().put("version",version).put("scope",scope).put("checkedAt",checkedAt).put("source",source));
        }
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] encrypted=cipher.doFinal(vault.toString().getBytes(StandardCharsets.UTF_8)),iv=cipher.getIV();
        byte[] data=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,data,0,iv.length);System.arraycopy(encrypted,0,data,iv.length,encrypted.length);
        if(data.length>150000)throw new Exception("Недопустимый файл доступа.");
        atomicReplace(new File(context.getFilesDir(),"access.enc"),data);
    }
    static void atomicReplace(File destination,byte[] data) throws Exception {
        File staged=File.createTempFile(".profile-",".tmp",destination.getParentFile());
        try{
            try(FileOutputStream stream=new FileOutputStream(staged)){stream.write(data);stream.getFD().sync();}
            // No non-atomic fallback: a failed write/move leaves the old vault intact.
            Files.move(staged.toPath(),destination.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }finally{try{Files.deleteIfExists(staged.toPath());}catch(Exception ignored){}}
    }
    static JSONObject validate(JSONObject value) throws Exception {
        JSONArray input=value.optJSONArray("profiles");
        if(!"zphone-test-v1".equals(value.optString("format"))||!"test".equals(value.optString("scope"))||input==null||input.length()<1||input.length()>32)throw new Exception("Нужен файл подключений Zphone.");
        JSONArray output=new JSONArray();HashSet<String> ids=new HashSet<>();HashMap<String,String> countries=new HashMap<>();
        for(int i=0;i<input.length();i++){
            JSONObject p=input.getJSONObject(i);String id=p.optString("id"),location=p.optString("location"),protocol=p.optString("protocol"),server=p.optString("server"),username=p.optString("username"),password=p.optString("password");
            int port=p.optInt("port",0);
            if(!id.matches("[a-zA-Z0-9_-]{1,60}")||!ids.add(id))throw new Exception("Некорректное подключение.");
            JSONObject clean=Protocols.validate(p);
            Countries.consistent(countries,location,clean.getString("country"));
            output.put(clean);
        }
        return new JSONObject().put("format","zphone-test-v1").put("scope","test").put("profiles",output);
    }
    private static boolean validHost(String value){return value.length()<=253&&value.matches("[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?");}
    static JSONArray publicProfiles(JSONObject bundle) throws Exception {
        JSONArray result=new JSONArray();if(bundle==null)return result;JSONArray ps=bundle.getJSONArray("profiles");
        for(int i=0;i<ps.length();i++){JSONObject p=ps.getJSONObject(i);result.put(Protocols.publicRoute(p).put("id",p.getString("id")));}return result;
    }
}
