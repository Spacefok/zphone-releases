package org.zphone.pilot;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

final class SettingsStore {
    private static final String[] TEXT={"location","protocol","theme","split"};
    private static final String[] FLAGS={"autoCheckUpdates","autoDownloadUpdates","updateWifiOnly"};
    interface Storage {
        JSONObject read() throws Exception;
        void write(JSONObject value) throws Exception;
        JSONObject backup() throws Exception;
        void backup(JSONObject value) throws Exception;
    }
    static JSONObject validate(JSONObject value) throws Exception {
        JSONObject result=new JSONObject();
        for(String key:TEXT)if(value.has(key)){
            if(!(value.get(key) instanceof String))throw new Exception("Invalid setting type");
            String text=value.getString(key);
            if(key.equals("split"))text=SplitTunnel.validate(new JSONObject(text)).toString();
            else if(key.equals("location")?!Countries.isSelection(text):key.equals("protocol")?!(text.equals("auto")||Protocols.ALL.contains(text)):!text.matches("system|light|dark"))throw new Exception("Invalid setting");
            result.put(key,text);
        }
        for(String key:FLAGS)if(value.has(key)){
            if(!(value.get(key) instanceof Boolean))throw new Exception("Invalid setting type");
            result.put(key,value.getBoolean(key));
        }
        return result;
    }
    static JSONObject load(Storage storage) throws Exception {
        JSONObject current=null;Exception broken=null;
        try{current=validate(storage.read());}catch(Exception e){broken=e;}
        JSONObject backup=null;
        try{JSONObject saved=storage.backup();if(saved!=null)backup=validate(saved);}catch(Exception e){if(broken!=null)throw new Exception("Не удалось восстановить настройки. Данные сохранены.");}
        if(current==null){if(backup==null)throw new Exception("Не удалось прочитать настройки. Автоматический сброс отменён.");current=backup;storage.write(current);}
        else if(backup!=null){
            boolean restored=false;
            for(Iterator<String> keys=backup.keys();keys.hasNext();){String key=keys.next();if(!current.has(key)){current.put(key,backup.get(key));restored=true;}}
            if(restored)storage.write(current);
        }
        storage.backup(current);return current;
    }
    static JSONObject save(Storage storage,JSONObject patch) throws Exception {
        JSONObject previous=load(storage),next=new JSONObject(previous.toString()),checked=validate(patch);
        for(Iterator<String> keys=checked.keys();keys.hasNext();){String key=keys.next();next.put(key,checked.get(key));}
        try{storage.write(next);}catch(Exception e){try{storage.write(previous);}catch(Exception ignored){}throw e;}
        storage.backup(next);return next;
    }
    private static Storage storage(Context context){
        SharedPreferences prefs=context.getSharedPreferences("settings",Context.MODE_PRIVATE);
        AtomicFile file=new AtomicFile(new File(context.getNoBackupFilesDir(),"settings-backup.json"));
        return new Storage(){
            public JSONObject read() throws Exception {
                JSONObject value=new JSONObject();var all=prefs.getAll();
                for(String key:TEXT)if(all.containsKey(key))value.put(key,all.get(key));
                for(String key:FLAGS)if(all.containsKey(key))value.put(key,all.get(key));
                return value;
            }
            public void write(JSONObject value) throws Exception {
                var editor=prefs.edit();
                for(String key:TEXT)if(value.has(key))editor.putString(key,value.getString(key));else editor.remove(key);
                for(String key:FLAGS)if(value.has(key))editor.putBoolean(key,value.getBoolean(key));else editor.remove(key);
                if(!editor.commit())throw new Exception("Не удалось сохранить настройки. Повторите попытку.");
            }
            public JSONObject backup() throws Exception {
                try{return new JSONObject(new String(file.readFully(),StandardCharsets.UTF_8));}catch(java.io.FileNotFoundException absent){return null;}
            }
            public void backup(JSONObject value) throws Exception {
                FileOutputStream out=null;
                try{out=file.startWrite();out.write(value.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(out);}
                catch(Exception e){if(out!=null)file.failWrite(out);throw e;}
            }
        };
    }
    private static boolean initialized;
    static synchronized void initialize(Context context) throws Exception {
        if(initialized)return;
        JSONObject value=load(storage(context));initialized=true;
        log(context,value,"startup");
    }
    static synchronized void update(Context context,JSONObject input) throws Exception {
        initialize(context);JSONObject patch=new JSONObject(input.toString());
        if(patch.has("split"))patch.put("split",SplitTunnel.validate(patch.getJSONObject("split")).toString());
        JSONObject value=save(storage(context),patch);log(context,value,"cleanup");
    }
    static synchronized void checkpoint(Context context) throws Exception {initialize(context);load(storage(context));}
    private static void log(Context context,JSONObject value,String stage) throws Exception {
        JSONObject split=new JSONObject(value.optString("split","{\"mode\":\"all\",\"apps\":[]}"));
        Diagnostics.get(context).write("settings.changed",new JSONObject().put("stage",stage).put("ok",true).put("splitMode",split.getString("mode")).put("splitAppCount",split.getJSONArray("apps").length()));
    }
}
