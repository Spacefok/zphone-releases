package org.zphone.pilot;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class SplitTunnelTest {
    private JSONObject split(String mode) throws Exception {
        JSONArray apps=new JSONArray();
        apps.put(new JSONObject().put("id","com.asana.app").put("name","Asana"));
        for(int i=0;i<39;i++)apps.put(new JSONObject().put("id","com.example.app"+i).put("name","App "+i));
        return new JSONObject().put("mode",mode).put("apps",apps);
    }
    @Test public void removesOnlyMissingAppInEveryModeWithoutMutatingInput() throws Exception {
        for(String mode:new String[]{"all","exclude","include"}){
            JSONObject before=split(mode),after=SplitTunnel.prune(before,id->!id.equals("com.asana.app"));
            assertEquals(40,before.getJSONArray("apps").length());assertEquals(mode,after.getString("mode"));
            assertEquals(39,after.getJSONArray("apps").length());
            for(int i=0;i<39;i++)assertEquals(before.getJSONArray("apps").getJSONObject(i+1).toString(),after.getJSONArray("apps").getJSONObject(i).toString());
            assertEquals(after.toString(),SplitTunnel.prune(after,id->true).toString());
        }
    }
    @Test public void includeCannotBecomeAnUnrestrictedTunnel() throws Exception {
        JSONObject after=SplitTunnel.prune(split("include"),id->false);
        assertEquals("include",after.getString("mode"));assertEquals(0,after.getJSONArray("apps").length());
        assertThrows(Exception.class,()->SplitTunnel.requireSelection("include",0));
        SplitTunnel.requireSelection("exclude",0);SplitTunnel.requireSelection("all",0);SplitTunnel.requireSelection("include",1);
    }
    @Test public void failedLookupDoesNotErasePreferences() throws Exception {
        JSONObject before=split("exclude");String copy=before.toString();
        assertThrows(Exception.class,()->SplitTunnel.prune(before,id->{throw new SecurityException("unavailable");}));
        assertEquals(copy,before.toString());
    }
    @Test public void cleanupAndBackupPreserveEveryOtherSetting() throws Exception {
        SettingsStoreTest.Memory memory=new SettingsStoreTest.Memory();
        memory.primary=new JSONObject().put("split",split("exclude").toString()).put("theme","dark").put("location","FIN").put("protocol","NaiveProxy").put("autoCheckUpdates",false).toString();
        JSONObject result=SettingsStore.pruneSplit(memory,id->!id.equals("com.asana.app"));
        assertEquals(39,new JSONObject(result.getString("split")).getJSONArray("apps").length());
        assertEquals("FIN",result.getString("location"));assertEquals("dark",result.getString("theme"));
        assertEquals("NaiveProxy",result.getString("protocol"));assertFalse(result.getBoolean("autoCheckUpdates"));
        memory.primary="broken";assertEquals(result.toString(),SettingsStore.load(memory).toString());
    }
    @Test public void failedCleanupWritePreservesOldBackup() throws Exception {
        SettingsStoreTest.Memory memory=new SettingsStoreTest.Memory();
        memory.primary=new JSONObject().put("split",split("exclude").toString()).toString();SettingsStore.load(memory);
        String before=memory.copy;memory.fail=true;
        assertThrows(Exception.class,()->SettingsStore.pruneSplit(memory,id->false));assertEquals(before,memory.copy);
    }
    @Test public void retainedPackagesAreNotRemoved() throws Exception {
        JSONObject before=split("exclude");assertEquals(before.toString(),SplitTunnel.prune(before,id->true).toString());
    }
}
