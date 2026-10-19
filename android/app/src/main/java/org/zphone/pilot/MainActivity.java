package org.zphone.pilot;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.VpnService;
import android.os.Bundle;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public class MainActivity extends Activity {
    static volatile WeakReference<MainActivity> current=new WeakReference<>(null);
    private static final Object PROFILE_LOCK=new Object();
    private WebView web;
    private volatile Account account;
    private volatile boolean destroyed,loaded;
    private boolean connectionRequested,importPending;
    private int accountChanges;
    private ProfileRefresh.Import importTicket;
    private ProfileRefresh<JSONObject> profileRefresh;
    private volatile ProfileStore.Saved savedProfiles=new ProfileStore.Saved(null,null,null,0);
    private volatile JSONArray publicProfiles=new JSONArray();
    private final android.os.Handler ui=new android.os.Handler(android.os.Looper.getMainLooper());
    private Runnable refreshRetry;
    private final ExecutorService profileWorker=Executors.newSingleThreadExecutor();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean reportBusy=new java.util.concurrent.atomic.AtomicBoolean();
    private long importId=-1,vpnId=-1,exportId=-1,notificationId=-1;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        try{SettingsStore.initialize(this);}catch(Exception error){new android.app.AlertDialog.Builder(this).setTitle("Настройки Zphone").setMessage(error.getMessage()).setPositiveButton("Закрыть",(dialog,which)->finish()).setOnCancelListener(dialog->finish()).show();return;}
        synchronized(PROFILE_LOCK){MainActivity previous=current.get();if(previous!=null&&previous!=this)previous.retire();current=new WeakReference<>(this);}
        createProfileRefresh();
        worker.execute(()->{
            Account next=null;ProfileStore.Saved profiles=new ProfileStore.Saved(null,null,null,0);JSONArray visible=new JSONArray();
            try{next=new Account(this,PROFILE_LOCK);}catch(Exception ignored){}
            try{profiles=new ProfileStore(this).readSaved();visible=ProfileStore.publicProfiles(profiles.bundle);}catch(Exception ignored){}
            synchronized(PROFILE_LOCK){if(destroyed||current.get()!=this){if(next!=null)next.close();return;}account=next;savedProfiles=profiles;publicProfiles=visible;loaded=true;}
            profileRefresh.wake();publishState();
        });
        UpdateJob.schedule(this);
        try{Diagnostics.get(this).write("app.start",new JSONObject().put("version",Diagnostics.VERSION).put("build",Diagnostics.BUILD));}catch(Exception ignored){}
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0);
        web=new WebView(this);setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(false);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
        web.getSettings().setAllowFileAccessFromFileURLs(false);web.getSettings().setAllowUniversalAccessFromFileURLs(false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();String p=uri.getPath();
                if(!"https".equals(uri.getScheme())||!"app.zphone.local".equals(uri.getHost())||p==null||p.contains(".."))return new android.webkit.WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
                try{String name=p.equals("/")?"index.html":p.substring(1);String mime=name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":name.endsWith(".png")?"image/png":"text/html";return new android.webkit.WebResourceResponse(mime,"UTF-8",getAssets().open("web/"+name));}catch(Exception e){return new android.webkit.WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));}
            }
        });
        web.addJavascriptInterface(new Bridge(),"Android");web.loadUrl("https://app.zphone.local/index.html");
    }
    private void createProfileRefresh(){
        profileRefresh=new ProfileRefresh<>(PROFILE_LOCK,Diagnostics.VERSION,new ProfileRefresh.Host<JSONObject>(){
            public String scope(){Account a=account;Account.Session session=a==null?null:a.session();return !loaded||session==null?null:session.scope;}
            public boolean current(){return !destroyed&&MainActivity.current.get()==MainActivity.this;}
            public boolean blocked(){return !loaded||connectionRequested||importPending||accountChanges>0||TunnelService.running();}
            public ProfileRefresh.Marker marker(){ProfileStore.Saved saved=savedProfiles;return saved.version==null?null:new ProfileRefresh.Marker(saved.version,saved.scope,saved.checkedAt,saved.source);}
            public JSONObject fetch(String scope) throws Exception {
                Account a=account;Account.Session session=a==null?null:a.session();
                if(session==null||!session.scope.equals(scope))throw new Exception("Account changed");
                return ProfileStore.validate(a.profiles(session));
            }
            public void save(JSONObject value,ProfileRefresh.Marker marker) throws Exception {
                JSONObject clean=ProfileStore.validate(value);JSONArray visible=ProfileStore.publicProfiles(clean);
                String version=marker==null?null:marker.version,scope=marker==null?null:marker.scope;long checkedAt=marker==null?0:marker.checkedAt;
                String source=marker==null?null:marker.source;
                new ProfileStore(MainActivity.this).write(clean,version,scope,checkedAt,source);
                savedProfiles=new ProfileStore.Saved(clean,version,scope,checkedAt,source);publicProfiles=visible;
            }
            public int status(Exception error){return Account.status(error);}
            public void changed(){
                publishState();
                try{profileWorker.execute(()->{if(destroyed)return;try{Diagnostics.get(MainActivity.this).write("profiles.sync",new JSONObject().put("status",profileRefresh.snapshot().state).put("version",Diagnostics.VERSION).put("profileCount",publicProfiles.length()));}catch(Exception ignored){}});}catch(java.util.concurrent.RejectedExecutionException ignored){}
            }
        },new ProfileRefresh.Driver(){
            public long now(){return System.currentTimeMillis();}
            public void execute(Runnable work){profileWorker.execute(work);}
            public void later(Runnable work,long delay){cancel();refreshRetry=work;ui.postDelayed(work,delay);}
            public void cancel(){if(refreshRetry!=null){ui.removeCallbacks(refreshRetry);refreshRetry=null;}}
        });
    }
    private void publishState(){ui.post(()->{if(destroyed||current.get()!=this||web==null)return;try{web.evaluateJavascript("window.zphoneState&&window.zphoneState("+snapshot()+")",null);}catch(Exception ignored){}});}
    static void notifyState(){MainActivity a=current.get();boolean running=TunnelService.running();if(a!=null)a.ui.post(()->{
        if(a.destroyed||current.get()!=a)return;
        synchronized(PROFILE_LOCK){if(running)a.connectionRequested=false;}
        if(a.profileRefresh!=null)a.profileRefresh.wake();a.publishState();
    });}
    private JSONObject profileSync() throws Exception {
        ProfileRefresh.State state=profileRefresh==null?new ProfileRefresh.State("idle",0):profileRefresh.snapshot();
        JSONObject value=new JSONObject().put("state",state.state);if(state.checkedAt>0)value.put("checkedAt",state.checkedAt);return value;
    }
    JSONObject settings() throws Exception {
        SettingsStore.initialize(this);
        var prefs=getSharedPreferences("settings",MODE_PRIVATE);
        return new JSONObject().put("location",prefs.getString("location","auto")).put("protocol",prefs.getString("protocol","auto")).put("theme",prefs.getString("theme","system")).put("mode","vpn").put("split",SplitTunnel.read(this)).put("autoCheckUpdates",prefs.getBoolean("autoCheckUpdates",true)).put("autoDownloadUpdates",prefs.getBoolean("autoDownloadUpdates",false)).put("updateWifiOnly",prefs.getBoolean("updateWifiOnly",true));
    }
    JSONObject snapshot() throws Exception {
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);var channel=manager.getNotificationChannel("vpn");
        return new JSONObject().put("version",Diagnostics.VERSION).put("build",Diagnostics.BUILD).put("platform","android").put("settings",settings()).put("updates",UpdateCheck.snapshot()).put("account",account==null?new JSONObject().put("state","unconfigured"):account.snapshot()).put("profiles",publicProfiles).put("profileSync",profileSync()).put("diagnostics",Diagnostics.get(this).snapshot()).put("notificationsEnabled",manager.areNotificationsEnabled()&&(channel==null||channel.getImportance()!=NotificationManager.IMPORTANCE_NONE)).put("connection",TunnelService.snapshot());
    }
    private void reply(long id,Object result,String error){runOnUiThread(()->{if(destroyed||current.get()!=this)return;try{JSONObject payload=new JSONObject();if(error!=null)payload.put("error",error);else payload.put("result",result);web.evaluateJavascript("window.zphoneReply&&window.zphoneReply("+id+","+payload+")",null);}catch(Exception ignored){}});}
    boolean anotherVpn(){
        ConnectivityManager manager=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        for(Network network:manager.getAllNetworks()){NetworkCapabilities c=manager.getNetworkCapabilities(network);if(c!=null&&c.hasTransport(NetworkCapabilities.TRANSPORT_VPN)&&!TunnelService.running())return true;}return false;
    }
    void connect(long id){runOnUiThread(()->{
        try{
            synchronized(PROFILE_LOCK){if(destroyed||current.get()!=this)return;connectionRequested=true;profileRefresh.invalidate();}
            if(UpdateCheck.snapshot().optString("state").equals("installing"))throw new Exception("Завершите или отмените установку обновления.");
            if(TunnelService.running()){synchronized(PROFILE_LOCK){connectionRequested=false;}reply(id,snapshot(),null);return;}
            if(anotherVpn())throw new Exception("Сейчас работает другой VPN. Он не будет отключён. Сначала отключите его самостоятельно.");
            if(!loaded||savedProfiles.bundle==null)throw new Exception("Сначала добавьте подключение.");
            JSONObject split=SplitTunnel.read(this);if(split.getString("mode").equals("include")&&split.getJSONArray("apps").length()==0)throw new Exception("Выберите хотя бы одно приложение для VPN.");
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED&&!getSharedPreferences("settings",MODE_PRIVATE).getBoolean("notificationPermissionAsked",false)){
                if(notificationId!=-1)throw new Exception("Подтвердите запрос уведомлений.");
                notificationId=id;getSharedPreferences("settings",MODE_PRIVATE).edit().putBoolean("notificationPermissionAsked",true).apply();
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},104);return;
            }
            Intent prepare=VpnService.prepare(this);if(prepare!=null){vpnId=id;startActivityForResult(prepare,101);}else{
                startForegroundService(new Intent(this,TunnelService.class));reply(id,snapshot(),null);
            }
        }catch(Exception e){synchronized(PROFILE_LOCK){connectionRequested=false;}profileRefresh.wake();reply(id,null,e.getMessage());}
    });}
    final class Bridge {
        @JavascriptInterface public void request(long id,String command,String data){
            if(destroyed||current.get()!=MainActivity.this)return;
            if(command.equals("snapshot")){try{reply(id,snapshot(),null);}catch(Exception e){reply(id,null,"Не удалось получить состояние.");}return;}
            final boolean accountChange=command.equals("accountBegin")||command.equals("accountLogout");
            synchronized(PROFILE_LOCK){
                if(accountChange){accountChanges++;if(account!=null)account.cancelPending();profileRefresh.invalidate();}
                if(command.equals("connect")){connectionRequested=true;profileRefresh.invalidate();}
                if(command.equals("import")){
                    if(importPending){reply(id,null,"Импорт уже открыт.");return;}
                    importPending=true;importTicket=profileRefresh.beginImport();
                }
            }
            if(command.equals("markIssue")&&!reportBusy.compareAndSet(false,true)){reply(id,null,"Отчёт уже отправляется. Дождитесь результата.");return;}
            worker.execute(()->{
                try{
                    if(destroyed||current.get()!=MainActivity.this)return;
                    JSONObject arg=new JSONObject(data);Object result;
                    switch(command){
                        case "snapshot":result=snapshot();break;
                        case "notificationSettings":
                            runOnUiThread(()->{try{startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()));reply(id,new JSONObject().put("ok",true),null);}catch(Exception e){reply(id,null,"Не удалось открыть настройки уведомлений.");}});return;
                        case "openSupport":
                            String bot=UpdateCheck.config(MainActivity.this).getJSONObject("auth").optString("botUsername","");if(!bot.matches("[A-Za-z0-9_]{5,32}"))throw new Exception("Адрес поддержки ещё не настроен.");
                            runOnUiThread(()->{try{
                                startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://t.me/"+bot)));
                                Diagnostics.get(MainActivity.this).write("user.open_support",new JSONObject().put("channel","telegram"));
                                reply(id,new JSONObject().put("ok",true),null);
                            }catch(Exception e){reply(id,null,"Не удалось открыть Telegram. Проверьте, установлен ли Telegram или браузер.");}});return;
                        case "accountBegin":
                        case "accountOpenBot":
                            String link=command.equals("accountBegin")?account.begin():account.botLink();notifyState();
                            runOnUiThread(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(link)));reply(id,snapshot(),null);}catch(Exception e){reply(id,null,"Заявка создана, но Telegram не открылся. Нажмите «Открыть бота» ещё раз или проверьте установленный браузер.");}});return;
                        case "accountPoll":account.poll();profileRefresh.wake();result=snapshot();break;
                        case "accountLogout":account.logout();result=snapshot();break;
                        case "accountProfiles":
                            profileRefresh.manual(error->{try{reply(id,error==null?snapshot():null,error==null?null:error.getMessage());}catch(Exception ignored){}});return;
                        case "listApps":result=new JSONObject().put("apps",SplitTunnel.apps(MainActivity.this));break;
                        case "connect":Diagnostics.get(MainActivity.this).write("user.connect",settings());connect(id);return;
                        case "disconnect":Diagnostics.get(MainActivity.this).write("user.disconnect",new JSONObject());TunnelService.disconnect();synchronized(PROFILE_LOCK){connectionRequested=false;}profileRefresh.wake();result=snapshot();break;
                        case "markIssue":
                            if(account==null)throw new Exception("Откройте «Аккаунт» и войдите через бота. Импорт файла не выполняет вход.");
                            JSONObject selection=settings(),connection=TunnelService.snapshot(),splitSettings=selection.getJSONObject("split");
                            JSONObject currentProfile=connection.optJSONObject("route");
                            JSONObject reportSummary=new JSONObject().put("version",Diagnostics.VERSION).put("build",Diagnostics.BUILD).put("platform","android").put("connectionStatus",connection.optString("status"))
                                .put("location",currentProfile==null?selection.optString("location"):currentProfile.optString("location")).put("protocol",currentProfile==null?selection.optString("protocol"):currentProfile.optString("protocol"))
                                .put("mode","vpn").put("splitMode",splitSettings.optString("mode")).put("splitAppCount",splitSettings.getJSONArray("apps").length()).put("profileCount",ProfileStore.publicProfiles(new ProfileStore(MainActivity.this).read()).length());
                            result=account.report(Diagnostics.get(MainActivity.this),reportSummary,Boolean.TRUE.equals(arg.opt("confirmed")));break;
                        case "exportDiagnostics":
                            runOnUiThread(()->{if(exportId!=-1){reply(id,null,"Экспорт уже открыт.");return;}exportId=id;try{Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,Diagnostics.filename());startActivityForResult(save,103);}catch(Exception e){exportId=-1;reply(id,null,"Не удалось открыть сохранение файла.");}});return;
                        case "import":
                            if(TunnelService.running())throw new Exception("Сначала отключите соединение.");
                            runOnUiThread(()->{if(destroyed)return;try{importId=id;Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(pick,102);}catch(Exception e){synchronized(PROFILE_LOCK){importPending=false;}profileRefresh.wake();reply(id,null,"Не удалось открыть импорт.");}});return;
                        case "settings":
                            if(TunnelService.running()&&(arg.has("location")||arg.has("protocol")||arg.has("split")))throw new Exception("Сначала отключите соединение.");
                            SettingsStore.update(MainActivity.this,arg);UpdateJob.schedule(MainActivity.this);result=snapshot();break;
                        case "diagnose":result=TunnelService.diagnose();break;
                        case "checkUpdates":result=UpdateCheck.check(MainActivity.this);break;
                        case "downloadUpdate":result=UpdateCheck.download(MainActivity.this);break;
                        case "installUpdate":UpdateCheck.install(MainActivity.this);result=new JSONObject().put("ok",true);break;
                        default:throw new Exception("Неизвестная команда.");
                    }
                    reply(id,result,null);
                }catch(Exception e){
                    if(command.equals("import")){synchronized(PROFILE_LOCK){importPending=false;}profileRefresh.wake();}
                    if(command.equals("connect")){synchronized(PROFILE_LOCK){connectionRequested=false;}profileRefresh.wake();}
                    reply(id,null,e.getMessage()==null?"Не удалось выполнить действие.":e.getMessage());
                }
                finally{if(command.equals("markIssue"))reportBusy.set(false);if(accountChange){synchronized(PROFILE_LOCK){accountChanges--;}profileRefresh.wake();}}
            });
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==101){long id=vpnId;vpnId=-1;if(result==RESULT_OK)connect(id);else{synchronized(PROFILE_LOCK){connectionRequested=false;}profileRefresh.wake();reply(id,null,"Разрешение на VPN не выдано.");}}
        if(request==103){long id=exportId;exportId=-1;
            if(result!=RESULT_OK||data==null||data.getData()==null){try{reply(id,new JSONObject().put("canceled",true),null);}catch(Exception ignored){}return;}
            worker.execute(()->{try(java.io.OutputStream stream=getContentResolver().openOutputStream(data.getData(),"wt")){
                Diagnostics logger=Diagnostics.get(this);logger.write("user.export_diagnostics",new JSONObject());
                JSONObject metadata=settings().put("version",Diagnostics.VERSION).put("build",Diagnostics.BUILD).put("status",TunnelService.snapshot().optString("status")).put("profileCount",ProfileStore.publicProfiles(new ProfileStore(this).read()).length());
                JSONObject split=SplitTunnel.read(this);metadata.put("splitMode",split.optString("mode")).put("splitAppCount",split.getJSONArray("apps").length());
                logger.export(stream,metadata);reply(id,new JSONObject().put("ok",true),null);
            }catch(Exception e){reply(id,null,"Не удалось сохранить архив диагностики.");}});return;
        }
        if(request==102){long id=importId;importId=-1;final ProfileRefresh.Import ticket=importTicket;
            if(result!=RESULT_OK||data==null){synchronized(PROFILE_LOCK){importPending=false;}profileRefresh.wake();try{reply(id,snapshot(),null);}catch(Exception e){reply(id,null,"Импорт отменён.");}return;}
            worker.execute(()->{try(InputStream stream=getContentResolver().openInputStream(data.getData())){
                byte[] bytes=TunnelService.readBounded(stream,131072);
                JSONObject value=ProfileStore.validate(new JSONObject(new String(bytes,StandardCharsets.UTF_8)));
                synchronized(PROFILE_LOCK){importPending=false;profileRefresh.saveImport(ticket,value);}reply(id,snapshot(),null);
            }catch(Exception e){reply(id,null,"Не удалось импортировать подключение: "+e.getMessage());}
            finally{synchronized(PROFILE_LOCK){importPending=false;}profileRefresh.wake();}});
        }
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==104){long id=notificationId;notificationId=-1;if(id!=-1)connect(id);notifyState();}
    }
    @Override protected void onResume(){super.onResume();if(!destroyed&&current.get()==this){profileRefresh.wake();notifyState();}}
    private void retire(){synchronized(PROFILE_LOCK){destroyed=true;if(profileRefresh!=null)profileRefresh.close();if(account!=null)account.close();ui.removeCallbacksAndMessages(null);profileWorker.shutdownNow();worker.shutdownNow();}}
    @Override protected void onDestroy(){retire();if(current.get()==this)current.clear();web.removeJavascriptInterface("Android");web.destroy();super.onDestroy();}
}
