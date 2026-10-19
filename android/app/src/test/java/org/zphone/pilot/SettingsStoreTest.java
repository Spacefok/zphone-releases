package org.zphone.pilot;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class SettingsStoreTest {
    static void same(JSONObject a,JSONObject b) throws Exception {assertEquals(a.length(),b.length());for(var keys=a.keys();keys.hasNext();){String key=keys.next();assertEquals(a.get(key),b.get(key));}}
    static final String SPLIT="{\"mode\":\"exclude\",\"apps\":[{\"id\":\"com.android.chrome\",\"name\":\"Chrome\"}]}";
    static class Memory implements SettingsStore.Storage {
        String primary="{}",copy;boolean fail;
        public JSONObject read() throws Exception{return new JSONObject(primary);}
        public void write(JSONObject data) throws Exception{if(fail)throw new Exception("disk full");primary=data.toString();}
        public JSONObject backup() throws Exception{return copy==null?null:new JSONObject(copy);}
        public void backup(JSONObject data){copy=data.toString();}
    }
    Memory upgraded() throws Exception {Memory m=new Memory();m.primary=new JSONObject().put("split",SPLIT).put("theme","dark").put("protocol","AmneziaWG").put("location","FIN").put("updateWifiOnly",false).toString();SettingsStore.load(m);return m;}
    @Test public void upgradeAndRestartPreserveAllSettings() throws Exception {
        Memory m=upgraded();JSONObject before=SettingsStore.load(m);JSONObject after=SettingsStore.load(m);
        same(before,after);assertEquals("exclude",new JSONObject(after.getString("split")).getString("mode"));assertFalse(after.getBoolean("updateWifiOnly"));
    }
    @Test public void partialWritesAndBackupKeepExclusions() throws Exception {
        Memory m=upgraded();SettingsStore.save(m,new JSONObject().put("theme","light"));JSONObject result=SettingsStore.load(m);
        assertEquals("light",result.getString("theme"));assertEquals("FIN",result.getString("location"));assertEquals("exclude",new JSONObject(result.getString("split")).getString("mode"));
        m.primary="{}";same(result,SettingsStore.load(m));
        m.primary="broken";same(result,SettingsStore.load(m));
    }
    @Test public void missingNewFieldDoesNotEraseSavedSettings() throws Exception {
        Memory m=upgraded();JSONObject old=SettingsStore.load(m);old.remove("theme");m.primary=old.toString();assertEquals("dark",SettingsStore.load(m).getString("theme"));
    }
    @Test public void invalidOrFailedSaveNeverOverwritesTheBackup() throws Exception {
        Memory m=upgraded();String previous=m.copy;
        try{SettingsStore.save(m,new JSONObject().put("split","broken"));fail();}catch(Exception expected){}
        assertEquals(previous,m.copy);m.fail=true;
        try{SettingsStore.save(m,new JSONObject().put("theme","light"));fail();}catch(Exception expected){}
        assertEquals(previous,m.copy);
    }
    @Test public void unrecoverableSettingsAreNotSilentlyReset() throws Exception {
        Memory m=new Memory();m.primary="broken";
        try{SettingsStore.load(m);fail();}catch(Exception expected){}
        assertEquals("broken",m.primary);assertNull(m.copy);
    }
}
