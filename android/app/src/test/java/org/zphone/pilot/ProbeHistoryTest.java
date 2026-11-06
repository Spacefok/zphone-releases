package org.zphone.pilot;

import org.json.*;
import org.junit.Test;
import java.nio.file.*;
import java.time.Instant;
import static org.junit.Assert.*;

public class ProbeHistoryTest {
    static final String ID="abcdefab-1234-4567-8901-abcdefabcdef";
    static void write(Path path,String value) throws Exception {Files.write(path,value.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    JSONObject row(long time) throws Exception {
        return new JSONObject().put("time",IssueReport.timestamp(Instant.ofEpochMilli(time))).put("session",ID).put("event","health.check")
            .put("data",new JSONObject().put("stage","probe").put("attempt",6).put("location","AMS").put("protocol","AmneziaWG").put("ok",false).put("errorCode","TLS_ERROR").put("host","private.example"));
    }
    @Test public void cachedResultsSurviveDisconnectAndLogRotationWithoutDuplicates() throws Exception {
        Path dir=Files.createTempDirectory("zphone-probe-test");long now=System.currentTimeMillis();JSONObject row=row(now-1000);
        try{
            write(dir.resolve("service-probes.json"),new JSONArray().put(row).toString());
            write(dir.resolve("diagnostics.jsonl"),row+"\n");
            JSONObject report=IssueReport.collect(dir.toFile(),5,new JSONObject().put("connectionStatus","off"),now,ID);
            assertEquals(1,report.getJSONArray("records").length());assertFalse(report.toString().contains("private.example"));
            Files.delete(dir.resolve("diagnostics.jsonl"));
            report=IssueReport.collect(dir.toFile(),5,new JSONObject().put("connectionStatus","off"),now,ID);
            assertEquals(1,report.getJSONArray("records").length());
            assertEquals("AMS",report.getJSONArray("records").getJSONObject(0).getJSONObject("data").getString("location"));
            assertEquals(row.getString("time"),report.getJSONArray("records").getJSONObject(0).getString("time"));
        }finally{Files.deleteIfExists(dir.resolve("diagnostics.jsonl"));Files.deleteIfExists(dir.resolve("service-probes.json"));Files.delete(dir);}
    }
    @Test public void futureExpiredAndCorruptSamplesAreNotAttached() throws Exception {
        Path dir=Files.createTempDirectory("zphone-probe-test");long now=System.currentTimeMillis();
        try{
            write(dir.resolve("service-probes.json"),new JSONArray().put(row(now-180001)).put(row(now+1)).put(row(now)).toString());
            assertEquals(1,IssueReport.cached(dir.toFile(),now).size());
            assertTrue(IssueReport.cached(dir.toFile(),now+180002).isEmpty());
            write(dir.resolve("service-probes.json"),"broken");assertTrue(IssueReport.cached(dir.toFile(),now).isEmpty());
        }finally{Files.deleteIfExists(dir.resolve("service-probes.json"));Files.delete(dir);}
    }
}
