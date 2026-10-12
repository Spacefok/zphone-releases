package org.zphone.pilot;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.VpnService;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.ParcelFileDescriptor;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.system.Os;
import org.json.JSONArray;
import org.json.JSONObject;
import hev.htproxy.TProxyService;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicInteger;

public class TunnelService extends VpnService {
    private static final String ACTION_STOP="org.zphone.pilot.STOP";
    private static volatile TunnelService instance;
    private static volatile JSONObject connection=object("status","off");
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicInteger generation=new AtomicInteger();
    private volatile ChildProcess core,naive;
    private ArrayList<JSONObject> choices;
    private String lastProfile;
    private final int[] retryDelays={2000,5000,10000,20000,30000};
    private Diagnostics logger;
    private File naiveFile;
    private ParcelFileDescriptor tunnel;
    private boolean tunnelStarted;
    private final Handler notificationHandler=new Handler(Looper.getMainLooper());
    private final TunnelTraffic traffic=new TunnelTraffic();
    private boolean foregroundActive;
    private volatile String notificationRoute="";
    private long connectedAt;
    private boolean statsFailed;
    private final Runnable notificationTick=new Runnable(){@Override public void run(){
        if(!foregroundActive)return;
        synchronized(traffic){if(tunnelStarted)sampleTraffic();}
        refreshNotification();notificationHandler.postDelayed(this,2000);
    }};
    private int port,apiPort;
    private String secret;
    private File configFile,tunnelFile,coreLog;
    private String stage="startup";
    private static JSONObject object(String key,Object value){try{return new JSONObject().put(key,value);}catch(Exception e){throw new IllegalStateException(e);}}
    static JSONObject snapshot(){try{return new JSONObject(connection.toString());}catch(Exception e){return object("status","off");}}
    static boolean running(){String s=connection.optString("status");return s.equals("connecting")||s.equals("checking")||s.equals("recovering")||s.equals("connected")||s.equals("disconnecting");}
    private static synchronized void publish(JSONObject next){connection=next;MainActivity.notifyState();}
    private void update(String status,JSONObject profile,Integer latency,String error){
        try{JSONObject next=new JSONObject().put("status",status).put("mode","vpn");
            if(profile!=null)next.put("route",new JSONObject().put("location",profile.getString("location")).put("protocol",profile.getString("protocol")));
            if(latency!=null)next.put("latency",latency);if(error!=null)next.put("error",error);
            JSONObject info=new JSONObject().put("status",status);if(profile!=null){info.put("location",profile.optString("location")).put("protocol",profile.optString("protocol"));notificationRoute=profile.optString("location")+" · "+profile.optString("protocol");}if(latency!=null)info.put("latency",latency);logger.write("connection.state",info);publish(next);notificationHandler.post(this::refreshNotification);
        }catch(Exception ignored){}
    }
    @Override public void onCreate(){super.onCreate();instance=this;logger=Diagnostics.get(this);
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);manager.createNotificationChannel(new NotificationChannel("vpn","Тестовое подключение",NotificationManager.IMPORTANCE_LOW));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&ACTION_STOP.equals(intent.getAction())){logger.write("notification.disconnect",new JSONObject());disconnect();return START_NOT_STICKY;}
        if(foregroundActive)return START_NOT_STICKY;
        traffic.reset();notificationRoute="";connectedAt=0;statsFailed=false;
        int token=generation.incrementAndGet();update("connecting",null,null,null);
        startForeground(1,notification());foregroundActive=true;notificationHandler.postDelayed(notificationTick,2000);
        worker.execute(()->connect(token,false));return START_NOT_STICKY;
    }
    private void sampleTraffic(){try{traffic.sample(TProxyService.TProxyGetStats(),SystemClock.elapsedRealtime());}catch(Exception e){if(!statsFailed){statsFailed=true;logger.write("traffic.unavailable",object("errorType",e.getClass().getSimpleName()));}}}
    private Notification notification(){
        String status=connection.optString("status");boolean connected=status.equals("connected");
        if(connected&&connectedAt==0)connectedAt=System.currentTimeMillis();
        String label=status.equals("recovering")?"Восстанавливаем соединение":status.equals("checking")?"Проверяем интернет":status.equals("disconnecting")?"Отключаемся":status.equals("error")?"Ошибка подключения":status.equals("off")?"Отключено":connected?"Подключено":"Подключаемся";
        TunnelTraffic.Snapshot totals=traffic.snapshot();
        String rates="↑ "+TunnelTraffic.bytes(totals.uploadRate)+"/с   ↓ "+TunnelTraffic.bytes(totals.downloadRate)+"/с";
        String total="↑ "+TunnelTraffic.bytes(totals.uploaded)+"   ↓ "+TunnelTraffic.bytes(totals.downloaded);
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,TunnelService.class).setAction(ACTION_STOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder=new Notification.Builder(this,"vpn").setSmallIcon(android.R.drawable.ic_lock_lock).setContentTitle(notificationRoute.isEmpty()?"Zphone Preview":notificationRoute)
            .setContentText(connected?rates:label).setSubText(total).setStyle(new Notification.BigTextStyle().bigText(label+"\n"+(connected?rates+"\n":"")+"Всего: "+total))
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_SERVICE).setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,"Отключить",stop).build());
        if(android.os.Build.VERSION.SDK_INT>=31)builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        if(connectedAt>0)builder.setWhen(connectedAt).setUsesChronometer(true);else builder.setShowWhen(false);
        return builder.build();
    }
    private void refreshNotification(){if(foregroundActive)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(1,notification());}
    private void endNotification(){notificationHandler.post(()->{foregroundActive=false;notificationHandler.removeCallbacks(notificationTick);stopForeground(STOP_FOREGROUND_REMOVE);});}
    private void connect(int token,boolean restoring){
        try{
            cleanup();if(token!=generation.get())return;
            logNetwork();
            if(!restoring){JSONObject bundle=new ProfileStore(this).read();if(bundle==null)throw new Exception("Тестовые доступы отсутствуют.");
            var prefs=getSharedPreferences("settings",MODE_PRIVATE);String location=prefs.getString("location","auto"),protocol=prefs.getString("protocol","auto");
            JSONArray profiles=bundle.getJSONArray("profiles");choices=new ArrayList<>();
            for(int i=0;i<profiles.length();i++){JSONObject p=profiles.getJSONObject(i);if((location.equals("auto")||location.equals(p.getString("location")))&&(protocol.equals("auto")||protocol.equals(p.getString("protocol"))))choices.add(p);}
            choices.sort(Comparator.comparingInt(p->Protocols.ALL.indexOf(p.optString("protocol"))));
            }else choices.sort(Comparator.comparingInt(p->p.optString("id").equals(lastProfile)?0:1));
            if(choices.isEmpty())throw new Exception("Нет тестового доступа для выбранного протокола и локации.");
            for(int attempt=0;attempt<(restoring?retryDelays.length:1);attempt++){
            if(restoring){
                update("recovering",null,null,null);logger.write("recovery.wait",new JSONObject().put("attempt",attempt+1).put("delayMs",retryDelays[attempt]));
                for(int waited=0;waited<retryDelays[attempt];waited+=100){if(token!=generation.get())return;Thread.sleep(100);}
            }
            for(int i=0;i<choices.size();i++){
                if(token!=generation.get())return;
                if(restoring)recoveryPreflight();
                if(token!=generation.get())return;
                JSONObject p=choices.get(i);update(restoring||i>0?"recovering":"connecting",p,null,null);
                try{
                    stage="core";
                    startCore(p,token);if(token!=generation.get()){cleanup();return;}
                    stage="reachability";
                    update("checking",p,null,null);int latency=health();
                    if(token!=generation.get()){cleanup();return;}
                    if(restoring)recoveryPreflight();
                    if(token!=generation.get()){cleanup();return;}
                    stage="android-tunnel";startTunnel();Thread.sleep(250);
                    if(!TProxyService.TProxyIsRunning())throw new Exception("VPN tunnel failed");
                    stage="vpn-reachability";latency=health();
                    if(token!=generation.get()){cleanup();return;}
                    lastProfile=p.getString("id");if(restoring)logger.write("recovery.success",new JSONObject().put("attempt",attempt+1).put("location",p.getString("location")).put("protocol",p.getString("protocol")));
                    update("connected",p,latency,null);monitor(token,p);return;
                }catch(Exception error){reportFailure(p,error);cleanup();if(token!=generation.get())return;}
            }
            }
            if(restoring)throw new Exception("Не удалось восстановить соединение после пяти попыток. Повторите подключение.");
            String reason=stage.equals("core")?"Не удалось запустить сетевое ядро.":stage.equals("android-tunnel")?"Не удалось запустить VPN Android.":"Тестовый сервер не ответил в этой сети.";
            throw new Exception(reason+" Ручной выбор протокола сохранён.");
        }catch(Exception error){if(token!=generation.get())return;logger.write(restoring?"recovery.failed":"connection.failed",object("errorType",error.getClass().getSimpleName()));update("error",null,null,error.getMessage());try{cleanup();}catch(Exception e){logger.write("cleanup.failed",object("errorType",e.getClass().getSimpleName()));}endNotification();stopSelf();}
    }
    private void recoveryPreflight() throws Exception {
        if(VpnService.prepare(this)!=null)throw new Exception("Разрешение VPN отозвано. Подключите Zphone вручную.");
        ConnectivityManager manager=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        for(Network network:manager.getAllNetworks()){NetworkCapabilities caps=manager.getNetworkCapabilities(network);if(caps!=null&&caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN))throw new Exception("Работает другой VPN. Автоматическое восстановление остановлено.");}
    }
    private int freePort() throws Exception {try(ServerSocket s=new ServerSocket(0,1,java.net.InetAddress.getByName("127.0.0.1"))){return s.getLocalPort();}}
    private void startCore(JSONObject p,int token) throws Exception {
        port=freePort();apiPort=freePort();secret=UUID.randomUUID().toString();
        int naivePort=p.getString("protocol").equals("NaiveProxy")?startNaive(p,token):0;
        JSONObject proxy=Protocols.proxy(p,naivePort);
        JSONObject dns=new JSONObject().put("enable",true).put("ipv6",Protocols.supportsIpv6(p)).put("respect-rules",true).put("enhanced-mode","redir-host").put("nameserver",new JSONArray().put("https://1.1.1.1/dns-query").put("https://1.0.0.1/dns-query")).put("proxy-server-nameserver",new JSONArray().put("https://1.1.1.1/dns-query"));
        JSONArray rules=new JSONArray().put("DST-PORT,53,Zphone-DNS");
        if(!Protocols.supportsIpv6(p))rules.put("IP-CIDR6,::/0,REJECT,no-resolve");
        if(p.getString("protocol").equals("NaiveProxy"))rules.put("NETWORK,udp,REJECT");
        rules.put("MATCH,Zphone-Test");
        JSONObject config=new JSONObject().put("mixed-port",port).put("bind-address","127.0.0.1").put("allow-lan",false).put("external-controller","127.0.0.1:"+apiPort).put("secret",secret).put("mode","rule").put("log-level","silent").put("ipv6",true).put("find-process-mode","off").put("tun",object("enable",false)).put("dns",dns).put("proxies",new JSONArray().put(proxy).put(new JSONObject().put("name","Zphone-DNS").put("type","dns"))).put("rules",rules);
        // Android JSON escapes solidus; the core's YAML parser requires plain solidus.
        String json=config.toString().replace("\\/","/");
        File dir=new File(getFilesDir(),"session");if(!dir.exists()&&!dir.mkdirs())throw new Exception("Private directory unavailable");configFile=new File(dir,"session.json");Files.write(configFile.toPath(),json.getBytes(StandardCharsets.UTF_8));Os.chmod(configFile.getAbsolutePath(),0600);
        File binary=new File(getApplicationInfo().nativeLibraryDir,"libmihomo.so");
        coreLog=new File(dir,"core.log");
        core=ChildProcess.start(binary,coreLog,"-d",dir.getAbsolutePath(),"-f",configFile.getAbsolutePath());
        for(int i=0;i<60;i++){if(token!=generation.get())throw new Exception("Cancelled");if(!core.isAlive())throw new Exception("Core exited");try{api("/proxies/Zphone-Test",1200);return;}catch(Exception ignored){Thread.sleep(100);}}
        throw new Exception("Core timeout");
    }
    private int startNaive(JSONObject p,int token) throws Exception {
        int listen=freePort();File dir=new File(getFilesDir(),"session");if(!dir.exists()&&!dir.mkdirs())throw new Exception("Private directory unavailable");
        naiveFile=new File(dir,"naive.json");Files.write(naiveFile.toPath(),Protocols.naive(p,listen).toString().getBytes(StandardCharsets.UTF_8));Os.chmod(naiveFile.getAbsolutePath(),0600);
        File binary=new File(getApplicationInfo().nativeLibraryDir,"libnaive.so");
        naive=ChildProcess.start(binary,new File("/dev/null"),naiveFile.getAbsolutePath());
        for(int i=0;i<60;i++){
            if(token!=generation.get()||!naive.isAlive())throw new Exception("NaiveProxy stopped");
            try(java.net.Socket s=new java.net.Socket()){s.connect(new java.net.InetSocketAddress("127.0.0.1",listen),300);return listen;}catch(java.io.IOException ignored){Thread.sleep(100);}
        }
        throw new Exception("NaiveProxy timeout");
    }
    private void reportFailure(JSONObject profile,Exception error){
        try{JSONObject info=new JSONObject().put("stage",stage).put("location",profile.optString("location")).put("protocol",profile.optString("protocol")).put("errorType",error.getClass().getSimpleName()).put("errorCode",NetworkFailure.code(error));if(error instanceof NetworkFailure)info.put("httpStatus",((NetworkFailure)error).httpStatus);logger.write("connection.attempt_failed",info);}catch(Exception ignored){}
        if((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)==0)return;
        String detail=stage+": "+error.getClass().getSimpleName()+": "+error.getMessage();
        try{if(coreLog!=null&&coreLog.exists()&&coreLog.length()<8192)detail+=" "+new String(Files.readAllBytes(coreLog.toPath()),StandardCharsets.UTF_8);}catch(Exception ignored){}
        for(String key:new String[]{"password","username","server","sni","clientRandomPrefix","fingerprint","privateKey","publicKey","presharedKey","obfsPassword","ip"}){String value=profile.optString(key);if(!value.isEmpty())detail=detail.replace(value,"[private]");}
        JSONObject awg=profile.optJSONObject("awg");if(awg!=null)detail=detail.replace(awg.optString("header-protection-key"),"[private]");
        android.util.Log.w("ZphoneTest",detail.substring(0,Math.min(detail.length(),1200)));
    }
    private JSONObject api(String route,int timeout) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL("http://127.0.0.1:"+apiPort+route).openConnection();
        connection.setRequestProperty("Authorization","Bearer "+secret);connection.setConnectTimeout(timeout);connection.setReadTimeout(timeout);
        try{
            int code=connection.getResponseCode();
            if(code!=200){String body="";try(var error=connection.getErrorStream()){if(error!=null)body=new String(readBounded(error,2048),StandardCharsets.UTF_8);}throw NetworkFailure.fromCore(code,body);}
            try(var stream=connection.getInputStream()){byte[] data=readBounded(stream,32768);return new JSONObject(new String(data,StandardCharsets.UTF_8));}
        }finally{connection.disconnect();}
    }
    static byte[] readBounded(java.io.InputStream stream,int limit) throws Exception {
        java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int n;
        while((n=stream.read(buffer))!=-1){if(output.size()+n>limit)throw new Exception("Файл слишком большой.");output.write(buffer,0,n);}return output.toByteArray();
    }
    private int health() throws Exception {
        long started=SystemClock.elapsedRealtime();
        try{int latency=api("/proxies/Zphone-Test/delay?timeout=8000&url="+URLEncoder.encode("https://www.gstatic.com/generate_204","UTF-8"),10000).getInt("delay");logger.write("health.check",new JSONObject().put("ok",true).put("durationMs",SystemClock.elapsedRealtime()-started).put("latency",latency));return latency;}
        catch(Exception error){JSONObject info=new JSONObject().put("ok",false).put("stage",stage).put("errorType",error.getClass().getSimpleName()).put("errorCode",NetworkFailure.code(error)).put("durationMs",SystemClock.elapsedRealtime()-started);if(error instanceof NetworkFailure)info.put("httpStatus",((NetworkFailure)error).httpStatus);logger.write("health.check",info);throw error;}
    }
    private void logNetwork(){
        try{ConnectivityManager manager=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);NetworkCapabilities caps=manager.getNetworkCapabilities(manager.getActiveNetwork());
            String type=caps==null?"none":caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)?"vpn":caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)?"wifi":caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)?"mobile":caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)?"ethernet":"other";
            logger.write("network.snapshot",new JSONObject().put("networkType",type).put("validated",caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)).put("otherVpn",caps!=null&&caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)));
        }catch(Exception error){logger.write("network.snapshot_failed",object("errorType",error.getClass().getSimpleName()));}
    }
    private void startTunnel() throws Exception {
        Builder builder=new Builder().setSession("Zphone Preview").setMtu(1400).addAddress("198.18.0.1",30).addAddress("fd86:ea04:1111::1",126).addRoute("0.0.0.0",0).addRoute("::",0).addDnsServer("1.1.1.1");
        SplitTunnel.apply(this,builder);builder.setBlocking(false);tunnel=builder.establish();if(tunnel==null)throw new Exception("VPN permission revoked");
        String config="tunnel:\n  mtu: 1400\n  ipv4: 198.18.0.1\n  ipv6: 'fd86:ea04:1111::1'\nsocks5:\n  address: 127.0.0.1\n  port: "+port+"\n  udp: udp\nmisc:\n  log-level: error\n  log-file: /dev/null\n";
        tunnelFile=new File(getFilesDir(),"session/tunnel.yml");Files.write(tunnelFile.toPath(),config.getBytes(StandardCharsets.UTF_8));
        // JNI borrows this descriptor; close it only after the worker has stopped.
        if(!TProxyService.TProxyStartService(tunnelFile.getAbsolutePath(),tunnel.getFd()))throw new Exception("Tunnel not started");
        synchronized(traffic){traffic.beginTunnel(SystemClock.elapsedRealtime());tunnelStarted=true;}
    }
    private void monitor(int token,JSONObject p){new Thread(()->{
        int failures=0,ticks=0;
        while(token==generation.get()){
            try{Thread.sleep(5000);if(token!=generation.get())return;if(core==null||!core.isAlive()||(naive!=null&&!naive.isAlive())||!TProxyService.TProxyIsRunning())throw new Exception("Core stopped");if(++ticks%6!=0)continue;int latency=health();failures=0;if(token==generation.get())update("connected",p,latency,null);}
            catch(Exception e){
                if(token!=generation.get())return;
                logger.write("health.failed",object("errorType",e.getClass().getSimpleName()));
                if(++failures>=2&&generation.compareAndSet(token,token+1)){
                    update("recovering",p,null,null);logger.write("recovery.request",object("reason","health"));worker.execute(()->connect(token+1,true));return;
                }
            }
        }
    },"zphone-health").start();}
    static JSONObject diagnose(){try{TunnelService service=instance;if(service==null||!connection.optString("status").equals("connected"))throw new Exception();return new JSONObject().put("ok",true).put("latency",service.health());}catch(Exception e){try{return new JSONObject().put("ok",false).put("message","Ответ через тестовое соединение не получен.");}catch(Exception ignored){return object("ok",false);}}}
    private void cleanup(){
        boolean stopTunnel;
        synchronized(traffic){stopTunnel=tunnelStarted;if(tunnelStarted)sampleTraffic();tunnelStarted=false;traffic.pause();}
        if(stopTunnel){try{TProxyService.TProxyStopService();}catch(Throwable ignored){}}
        if(tunnel!=null){try{tunnel.close();}catch(Exception ignored){}tunnel=null;}
        Exception failure=null;
        if(core!=null){try{core.stop();core=null;}catch(Exception e){failure=e;}}
        if(naive!=null){try{naive.stop();naive=null;}catch(Exception e){failure=e;}}
        if(failure!=null)throw new IllegalStateException("Не удалось остановить тестовое ядро.",failure);
        if(naiveFile!=null){naiveFile.delete();naiveFile=null;}
        if(configFile!=null){configFile.delete();configFile=null;}if(tunnelFile!=null){tunnelFile.delete();tunnelFile=null;}
        if(coreLog!=null){coreLog.delete();coreLog=null;}
    }
    static void disconnect(){TunnelService s=instance;if(s==null){publish(object("status","off"));return;}s.generation.incrementAndGet();s.update("disconnecting",null,null,null);s.worker.execute(()->{try{s.cleanup();s.update("off",null,null,null);}catch(Exception e){s.logger.write("cleanup.failed",object("errorType",e.getClass().getSimpleName()));s.update("error",null,null,e.getMessage());}finally{s.endNotification();s.stopSelf();}});}
    @Override public void onRevoke(){disconnect();}
    @Override public void onDestroy(){foregroundActive=false;notificationHandler.removeCallbacksAndMessages(null);generation.incrementAndGet();worker.execute(()->{try{cleanup();}catch(Exception e){logger.write("cleanup.failed",object("errorType",e.getClass().getSimpleName()));}});worker.shutdown();if(instance==this)instance=null;super.onDestroy();}
}
