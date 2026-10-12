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
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public class MainActivity extends Activity {
    static WeakReference<MainActivity> current=new WeakReference<>(null);
    private WebView web;
    private Account account;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private long importId=-1,vpnId=-1,exportId=-1,notificationId=-1;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);current=new WeakReference<>(this);
        try{account=new Account(this);}catch(Exception ignored){}
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
    static void notifyState(){MainActivity a=current.get();if(a!=null)a.runOnUiThread(()->{try{a.web.evaluateJavascript("window.zphoneState&&window.zphoneState("+a.snapshot()+")",null);}catch(Exception ignored){}});}
    JSONObject settings() throws Exception {
        var prefs=getSharedPreferences("settings",MODE_PRIVATE);
        return new JSONObject().put("location",prefs.getString("location","auto")).put("protocol",prefs.getString("protocol","auto")).put("theme",prefs.getString("theme","system")).put("mode","vpn").put("split",SplitTunnel.read(this)).put("autoCheckUpdates",prefs.getBoolean("autoCheckUpdates",true)).put("autoDownloadUpdates",prefs.getBoolean("autoDownloadUpdates",false)).put("updateWifiOnly",prefs.getBoolean("updateWifiOnly",true));
    }
    JSONObject snapshot() throws Exception {
        NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);var channel=manager.getNotificationChannel("vpn");
        return new JSONObject().put("version",Diagnostics.VERSION).put("build",Diagnostics.BUILD).put("platform","android").put("settings",settings()).put("updates",UpdateCheck.snapshot()).put("account",account==null?new JSONObject().put("state","unconfigured"):account.snapshot()).put("profiles",ProfileStore.publicProfiles(new ProfileStore(this).read())).put("diagnostics",Diagnostics.get(this).snapshot()).put("notificationsEnabled",manager.areNotificationsEnabled()&&(channel==null||channel.getImportance()!=NotificationManager.IMPORTANCE_NONE)).put("connection",TunnelService.snapshot());
    }
    private void reply(long id,Object result,String error){runOnUiThread(()->{try{JSONObject payload=new JSONObject();if(error!=null)payload.put("error",error);else payload.put("result",result);web.evaluateJavascript("window.zphoneReply&&window.zphoneReply("+id+","+payload+")",null);}catch(Exception ignored){}});}
    boolean anotherVpn(){
        ConnectivityManager manager=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        for(Network network:manager.getAllNetworks()){NetworkCapabilities c=manager.getNetworkCapabilities(network);if(c!=null&&c.hasTransport(NetworkCapabilities.TRANSPORT_VPN)&&!TunnelService.running())return true;}return false;
    }
    void connect(long id){runOnUiThread(()->{
        try{
            if(UpdateCheck.snapshot().optString("state").equals("installing"))throw new Exception("Завершите или отмените установку обновления.");
            if(TunnelService.running()){reply(id,snapshot(),null);return;}
            if(anotherVpn())throw new Exception("Сейчас работает другой VPN. Он не будет отключён. Сначала отключите его самостоятельно.");
            if(new ProfileStore(this).read()==null)throw new Exception("Сначала импортируйте тестовый доступ.");
            JSONObject split=SplitTunnel.read(this);if(split.getString("mode").equals("include")&&split.getJSONArray("apps").length()==0)throw new Exception("Выберите хотя бы одно приложение для VPN.");
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED&&!getSharedPreferences("settings",MODE_PRIVATE).getBoolean("notificationPermissionAsked",false)){
                if(notificationId!=-1)throw new Exception("Подтвердите запрос уведомлений.");
                notificationId=id;getSharedPreferences("settings",MODE_PRIVATE).edit().putBoolean("notificationPermissionAsked",true).apply();
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},104);return;
            }
            Intent prepare=VpnService.prepare(this);if(prepare!=null){vpnId=id;startActivityForResult(prepare,101);}else{startForegroundService(new Intent(this,TunnelService.class));reply(id,snapshot(),null);}
        }catch(Exception e){reply(id,null,e.getMessage());}
    });}
    final class Bridge {
        @JavascriptInterface public void request(long id,String command,String data){
            worker.execute(()->{
                try{
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
                            String link=account.begin();runOnUiThread(()->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(link))));result=snapshot();break;
                        case "accountPoll":account.poll();result=snapshot();break;
                        case "accountLogout":account.logout();result=snapshot();break;
                        case "accountProfiles":
                            if(TunnelService.running())throw new Exception("Сначала отключите тестовое соединение.");
                            new ProfileStore(MainActivity.this).write(account.profiles());result=snapshot();break;
                        case "listApps":result=new JSONObject().put("apps",SplitTunnel.apps(MainActivity.this));break;
                        case "connect":Diagnostics.get(MainActivity.this).write("user.connect",settings());connect(id);return;
                        case "disconnect":Diagnostics.get(MainActivity.this).write("user.disconnect",new JSONObject());TunnelService.disconnect();result=snapshot();break;
                        case "markIssue":Diagnostics.get(MainActivity.this).write("user.mark",TunnelService.snapshot());result=new JSONObject().put("ok",Diagnostics.get(MainActivity.this).snapshot().getBoolean("available"));break;
                        case "exportDiagnostics":
                            runOnUiThread(()->{if(exportId!=-1){reply(id,null,"Экспорт уже открыт.");return;}exportId=id;try{Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,Diagnostics.filename());startActivityForResult(save,103);}catch(Exception e){exportId=-1;reply(id,null,"Не удалось открыть сохранение файла.");}});return;
                        case "import":
                            if(TunnelService.running())throw new Exception("Сначала отключите тестовое соединение.");
                            runOnUiThread(()->{importId=id;Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(pick,102);});return;
                        case "settings":
                            if(TunnelService.running()&&(arg.has("location")||arg.has("protocol")||arg.has("split")))throw new Exception("Сначала отключите тестовое соединение.");
                            var editor=getSharedPreferences("settings",MODE_PRIVATE).edit();
                            for(String key:new String[]{"autoCheckUpdates","autoDownloadUpdates","updateWifiOnly"})if(arg.has(key)){if(!(arg.get(key) instanceof Boolean))throw new Exception("Некорректная настройка.");editor.putBoolean(key,arg.getBoolean(key));}
                            if(arg.has("split"))editor.putString("split",SplitTunnel.validate(arg.getJSONObject("split")).toString());
                            for(String key:new String[]{"location","protocol","theme"})if(arg.has(key)){
                                String value=arg.getString(key);boolean valid=key.equals("location")?value.matches("auto|FIN|AMS|DEU"):key.equals("protocol")?(value.equals("auto")||Protocols.ALL.contains(value)):value.matches("system|light|dark");
                                if(!valid)throw new Exception("Некорректные настройки.");editor.putString(key,value);
                            }
                            editor.apply();UpdateJob.schedule(MainActivity.this);Diagnostics.get(MainActivity.this).write("settings.changed",settings());result=snapshot();break;
                        case "diagnose":result=TunnelService.diagnose();break;
                        case "checkUpdates":result=UpdateCheck.check(MainActivity.this);break;
                        case "downloadUpdate":result=UpdateCheck.download(MainActivity.this);break;
                        case "installUpdate":UpdateCheck.install(MainActivity.this);result=new JSONObject().put("ok",true);break;
                        default:throw new Exception("Неизвестная команда.");
                    }
                    reply(id,result,null);
                }catch(Exception e){reply(id,null,e.getMessage()==null?"Не удалось выполнить действие.":e.getMessage());}
            });
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==101){long id=vpnId;vpnId=-1;if(result==RESULT_OK)connect(id);else reply(id,null,"Разрешение на VPN не выдано.");}
        if(request==103){long id=exportId;exportId=-1;
            if(result!=RESULT_OK||data==null||data.getData()==null){try{reply(id,new JSONObject().put("canceled",true),null);}catch(Exception ignored){}return;}
            worker.execute(()->{try(java.io.OutputStream stream=getContentResolver().openOutputStream(data.getData(),"wt")){
                Diagnostics logger=Diagnostics.get(this);logger.write("user.export_diagnostics",new JSONObject());
                JSONObject metadata=settings().put("version",Diagnostics.VERSION).put("build",Diagnostics.BUILD).put("status",TunnelService.snapshot().optString("status")).put("profileCount",ProfileStore.publicProfiles(new ProfileStore(this).read()).length());
                JSONObject split=SplitTunnel.read(this);metadata.put("splitMode",split.optString("mode")).put("splitAppCount",split.getJSONArray("apps").length());
                logger.export(stream,metadata);reply(id,new JSONObject().put("ok",true),null);
            }catch(Exception e){reply(id,null,"Не удалось сохранить архив диагностики.");}});return;
        }
        if(request==102){long id=importId;importId=-1;if(result!=RESULT_OK||data==null){try{reply(id,snapshot(),null);}catch(Exception e){reply(id,null,"Импорт отменён.");}return;}
            worker.execute(()->{try(InputStream stream=getContentResolver().openInputStream(data.getData())){
                byte[] bytes=TunnelService.readBounded(stream,131072);
                new ProfileStore(this).write(new JSONObject(new String(bytes,StandardCharsets.UTF_8)));reply(id,snapshot(),null);
            }catch(Exception e){reply(id,null,"Не удалось импортировать тестовый доступ: "+e.getMessage());}});
        }
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){
        super.onRequestPermissionsResult(request,permissions,results);
        if(request==104){long id=notificationId;notificationId=-1;if(id!=-1)connect(id);notifyState();}
    }
    @Override protected void onResume(){super.onResume();current=new WeakReference<>(this);notifyState();}
    @Override protected void onDestroy(){if(current.get()==this)current.clear();web.removeJavascriptInterface("Android");web.destroy();worker.shutdownNow();super.onDestroy();}
}
