package org.zphone.pilot;

import java.time.Instant;
import java.util.Map;

public final class IssueReportTest {
    private static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        long now=Instant.parse("2026-10-12T12:00:00Z").toEpochMilli();String id="abcdefab-1234-4567-8901-abcdefabcdef";
        check(IssueReport.allowed(Instant.ofEpochMilli(now-180000),id,"health.check",now));
        check(IssueReport.allowed(Instant.ofEpochMilli(now),id,"user.mark",now));
        check(!IssueReport.allowed(Instant.ofEpochMilli(now-180001),id,"health.check",now));
        check(!IssueReport.allowed(Instant.ofEpochMilli(now).plusNanos(1),id,"health.check",now));
        check(!IssueReport.allowed(Instant.ofEpochMilli(now),"bad","health.check",now));
        for(String event:new String[]{"core.log","network.snapshot","visited.example","new.unknown.event"})check(!IssueReport.allowed(Instant.ofEpochMilli(now),id,event,now));
        for(String field:new String[]{"password","token","url","host","server","sni","message","path","apps","username","error","profile"})check(IssueReport.field(field,"private-secret") == null);
        for(String value:new String[]{"https://visited.example/path?token=secret","visited.example","C:\\Users\\Alice","/home/alice","secret-token"}){
            for(String field:new String[]{"location","protocol","stage","reason","errorCode","version","build"})check(IssueReport.field(field,value)==null);
        }
        check(IssueReport.field("latency",Double.NaN)==null);check(IssueReport.field("durationMs",Double.POSITIVE_INFINITY)==null);
        check(IssueReport.field("profileCount",-1)==null);check(IssueReport.field("profileCount",1e30)==null);check(IssueReport.field("ok","true")==null);
        check(IssueReport.field("errorCode","ETIMEDOUT").equals(Map.entry("errorCode","ETIMEDOUT")));
        check(IssueReport.field("code","CORE_HTTP_503").equals(Map.entry("errorCode","CORE_HTTP_503")));
        check(IssueReport.field("status",503).equals(Map.entry("httpStatus",503)));
        check(IssueReport.field("latency",123.4).equals(Map.entry("latency",123L)));
        check(IssueReport.field("version","0.6.7").equals(Map.entry("version","0.6.7")));
        check(IssueReport.field("build","android-20261012.17").equals(Map.entry("build","android-20261012.17")));
        check(IssueReport.field("stage","vpn-reachability")!=null);check(IssueReport.field("ok",false)!=null);
        check(IssueReport.MAX_BYTES==196608);check(IssueReport.WINDOW_MS==180000);check(IssueReport.MAX_RECORDS==1000);
        check(IssueReport.timestamp(Instant.parse("2026-10-12T12:00:00Z")).equals("2026-10-12T12:00:00.000Z"));
        check(IssueReport.timestamp(Instant.parse("2026-10-12T12:00:00.123456789Z")).equals("2026-10-12T12:00:00.123Z"));
        int count=0,size=250;
        for(int i=0;i<1200;i++){if(!IssueReport.canAppend(count,size,140))break;count++;size+=140;}
        check(count==1000);check(size<IssueReport.MAX_BYTES);
        check(IssueReport.canAppend(999,IssueReport.MAX_BYTES-140,140));
        check(!IssueReport.canAppend(1000,100,140));check(!IssueReport.canAppend(0,IssueReport.MAX_BYTES,1));
        check(IssueReport.failure(401,"").contains("Аккаунт"));check(IssueReport.failure(429,"").contains("Подождите"));check(IssueReport.failure(0,"TLS_ERROR").contains("сертификатов"));
        System.out.println("Android issue report window/privacy policy passed");
    }
}
