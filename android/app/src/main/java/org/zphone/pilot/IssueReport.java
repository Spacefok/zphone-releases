package org.zphone.pilot;

import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;

final class IssueReport {
    static final int MAX_BYTES=196608,MAX_RECORDS=1000;
    static final long WINDOW_MS=180000;
    private static final DateTimeFormatter TIMESTAMP=new DateTimeFormatterBuilder().appendInstant(3).toFormatter(Locale.ROOT);
    static String timestamp(Instant value){return TIMESTAMP.format(value);}
    static boolean canAppend(int count,int size,int length){return count<MAX_RECORDS&&(long)size+length<=MAX_BYTES;}
    private static final String UUID_PATTERN="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";
    private static Set<String> words(String value){return new HashSet<>(Arrays.asList(value.split(" ")));}
    private static final Set<String> EVENTS=words("app.start app.error app.quit app.quit_requested system.resume user.mark user.connect user.disconnect user.diagnose notification.disconnect settings.changed connection.request connection.state connection.preflight connection.attempt_failed connection.failed connection.error connection.cleanup core.spawn core.spawn_error core.exit core.stop_requested core.api_error core.line_dropped core.stream_error naive.spawn naive.spawn_error naive.exit health.check health.failed health.proxy_ok recovery.request recovery.wait recovery.success recovery.failed recovery.preflight_failed recovery.attempt_failed recovery.cleanup_failed cleanup.failed diagnose.error network.error network.snapshot_failed traffic.totals traffic.error traffic.unavailable account.request report.accepted report.failed");
    private static final Map<String,Set<String>> ENUMS=new HashMap<>();
    static {
        ENUMS.put("platform",words("windows android"));
        ENUMS.put("status",words("off connecting checking recovering connected disconnecting error"));ENUMS.put("connectionStatus",ENUMS.get("status"));
        ENUMS.put("location",words("auto FIN AMS DEU"));ENUMS.put("protocol",words("auto TrustTunnel Mieru NaiveProxy AmneziaWG Hysteria2"));
        ENUMS.put("mode",words("isolated vpn"));ENUMS.put("splitMode",words("all exclude include"));
        ENUMS.put("operation",words("start poll redeem profiles logout report"));ENUMS.put("transport",words("system secure-dns"));ENUMS.put("phase",words("resolve request"));
        ENUMS.put("stage",words("startup core helper tunnel health start proxy check connect launch api reachability android-tunnel vpn-reachability"));
        ENUMS.put("reason",words("health system.resume core.exit naive.exit oversized"));ENUMS.put("signal",words("SIGTERM SIGKILL SIGINT"));ENUMS.put("stream",words("stdout stderr"));
        ENUMS.put("errorType",words("Error TypeError TimeoutError AbortError Exception IOException SocketException SocketTimeoutException UnknownHostException SSLException SSLHandshakeException ConnectException NetworkFailure"));
    }
    private static final Set<String> CODES=words("ETIMEDOUT ECONNRESET ENETUNREACH EHOSTUNREACH EPIPE ENOTFOUND EAI_AGAIN ECONNREFUSED UND_ERR_CONNECT_TIMEOUT UND_ERR_SOCKET ERR_NAME_NOT_RESOLVED ERR_CONNECTION_REFUSED ERR_CONNECTION_RESET ERR_CONNECTION_CLOSED ERR_CONNECTION_TIMED_OUT ERR_INTERNET_DISCONNECTED ERR_NETWORK_CHANGED NETWORK_ERROR DNS_ERROR DNS_NO_PUBLIC_ADDRESS IO_ERROR CONNECT_FAILED TLS_ERROR HTTP_ERROR AUTH_REJECTED ADMIN_REQUIRED VPN_CONFLICT ENOENT EACCES");
    private static final Set<String> NUMBERS=words("durationMs delayMs latency attempt retryAttempt failures uploadBytes downloadBytes connections splitAppCount profileCount httpStatus exitCode count");
    private static final Set<String> BOOLEANS=words("ok admin configRemoved coreStopped");
    private static final String[] SUMMARY={"version","build","platform","connectionStatus","location","protocol","mode","splitMode","splitAppCount","profileCount"};
    private static Map.Entry<String,Object> pair(String key,Object value){return new AbstractMap.SimpleImmutableEntry<>(key,value);}
    static Map.Entry<String,Object> field(String key,Object value){
            if(value instanceof String){
                String text=(String)value;
                if(ENUMS.containsKey(key)&&ENUMS.get(key).contains(text))return pair(key,text);
                if((key.equals("code")||key.equals("errorCode"))&&(CODES.contains(text)||text.matches("(?:CORE_)?HTTP_[1-5][0-9]{2}")))return pair("errorCode",text);
                if(key.equals("version")&&text.matches("[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}"))return pair(key,text);
                if(key.equals("build")&&text.matches("(?:windows|android)-[0-9]{8}\\.[0-9]{1,6}"))return pair(key,text);
            }else if(value instanceof Number){
                double number=((Number)value).doubleValue();
                if(NUMBERS.contains(key)&&Double.isFinite(number)&&number>=0&&number<=9007199254740991L)return pair(key,Math.round(number));
                if(key.equals("status")&&number>=100&&number<=599&&number==Math.rint(number))return pair("httpStatus",(int)number);
                if(key.equals("code")&&number>=0&&number<=65535&&number==Math.rint(number))return pair("exitCode",(int)number);
            }else if(value instanceof Boolean&&BOOLEANS.contains(key))return pair(key,value);
        return null;
    }
    static boolean allowed(Instant instant,String session,String event,long now){
        Instant end=Instant.ofEpochMilli(now);
        return !instant.isBefore(end.minusMillis(WINDOW_MS))&&!instant.isAfter(end)&&session.matches(UUID_PATTERN)&&EVENTS.contains(event);
    }
    static JSONObject fields(JSONObject input) throws Exception {
        JSONObject out=new JSONObject();if(input==null)return out;
        for(Iterator<String> it=input.keys();it.hasNext();){
            String key=it.next();Map.Entry<String,Object> entry=field(key,input.opt(key));
            if(entry!=null)out.put(entry.getKey(),entry.getValue());
        }
        JSONObject error=input.optJSONObject("error"),profile=input.optJSONObject("route"),split=input.optJSONObject("split");
        if(error!=null)copy(out,fields(new JSONObject().put("errorType",error.opt("name")).put("errorCode",error.opt("code"))));
        if(profile!=null)copy(out,fields(new JSONObject().put("location",profile.opt("location")).put("protocol",profile.opt("protocol"))));
        if(split!=null)copy(out,fields(new JSONObject().put("splitMode",split.opt("mode")).put("splitAppCount",split.opt("count"))));
        return out;
    }
    private static void copy(JSONObject target,JSONObject source) throws Exception {for(Iterator<String> it=source.keys();it.hasNext();){String key=it.next();target.put(key,source.get(key));}}
    static JSONObject collect(File directory,int count,JSONObject metadata,long now,String reportId) throws Exception {
        if(reportId==null||!reportId.matches(UUID_PATTERN))throw new Exception("Invalid report identity");
        Instant end=Instant.ofEpochMilli(now);
        JSONObject clean=fields(metadata),summary=new JSONObject();for(String key:SUMMARY)if(clean.has(key))summary.put(key,clean.get(key));
        JSONArray output=new JSONArray();JSONObject report=new JSONObject().put("reportId",reportId).put("created",timestamp(end)).put("summary",summary).put("records",output);
        List<JSONObject> records=new ArrayList<>();
        for(int i=0;i<Math.min(count,5);i++){
            File file=new File(directory,i==0?"diagnostics.jsonl":"diagnostics."+i+".jsonl");
            if(!file.isFile()||Files.isSymbolicLink(file.toPath())||file.length()>2*1024*1024)continue;
            try(var reader=Files.newBufferedReader(file.toPath(),StandardCharsets.UTF_8)){
                String line;while((line=reader.readLine())!=null){if(line.length()>65536)continue;try{
                    JSONObject row=new JSONObject(line);String time=row.getString("time"),session=row.getString("session"),event=row.getString("event");
                    Instant instant=Instant.parse(time);
                    if(!allowed(instant,session,event,now))continue;
                    records.add(new JSONObject().put("time",instant.toString()).put("session",session).put("event",event).put("data",fields(row.optJSONObject("data"))));
                }catch(Exception ignored){}}
            }
        }
        records.sort((a,b)->Instant.parse(b.optString("time")).compareTo(Instant.parse(a.optString("time"))));
        int size=bytes(report);List<JSONObject> newest=new ArrayList<>();
        for(JSONObject row:records){
            row.put("time",timestamp(Instant.parse(row.getString("time"))));
            int length=bytes(row)+(newest.isEmpty()?0:1);if(!canAppend(newest.size(),size,length))break;newest.add(row);size+=length;
        }
        Collections.reverse(newest);for(JSONObject row:newest)output.put(row);
        return report;
    }
    static int bytes(JSONObject value){return value.toString().getBytes(StandardCharsets.UTF_8).length;}
    static boolean accepted(JSONObject response,JSONObject report){return Boolean.TRUE.equals(response.opt("ok"))&&report.optString("reportId").equals(response.optString("reportId"))&&words("queued sent").contains(response.optString("state"));}
    static String failure(int status,String code){
        if(status==401||status==403)return "Сессия недействительна. Откройте «Аккаунт», выйдите и войдите через бота заново, затем повторите отправку.";
        if(status==429)return "Слишком много отчётов. Подождите минуту и повторите отправку.";
        if(code!=null&&code.matches(".*(CERT|TLS|SSL).*"))return "Не удалось проверить защищённое соединение. Проверьте дату и время устройства и повторите отправку. Проверку сертификатов отключать не нужно.";
        return "Приём отчёта не подтверждён. Повторите отправку в течение 3 минут, когда сеть станет доступна. Журнал продолжает записываться.";
    }
}
