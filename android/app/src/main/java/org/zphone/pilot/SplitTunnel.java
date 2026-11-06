package org.zphone.pilot;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.VpnService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;

final class SplitTunnel {
    interface Installed {boolean contains(String id) throws Exception;}
    static JSONObject prune(JSONObject value,Installed installed) throws Exception {
        JSONObject clean=validate(value);JSONArray apps=clean.getJSONArray("apps"),kept=new JSONArray();
        for(int i=0;i<apps.length();i++)if(installed.contains(apps.getJSONObject(i).getString("id")))kept.put(apps.getJSONObject(i));
        return clean.put("apps",kept);
    }
    static boolean installed(Context context,String id) throws Exception {
        try{
            // Retain packages temporarily unavailable during replacement or on external storage.
            ApplicationInfo info=context.getPackageManager().getApplicationInfo(id,PackageManager.MATCH_UNINSTALLED_PACKAGES);
            return (info.flags&ApplicationInfo.FLAG_INSTALLED)!=0;
        }catch(PackageManager.NameNotFoundException absent){return false;}
    }
    static void requireSelection(String mode,int count) throws Exception {
        if(mode.equals("include")&&count==0)throw new Exception("Выберите хотя бы одно приложение для VPN.");
    }
    static JSONObject validate(JSONObject value) throws Exception {
        String mode=value.getString("mode");JSONArray apps=value.getJSONArray("apps"),out=new JSONArray();HashSet<String> seen=new HashSet<>();
        if(!mode.matches("all|exclude|include")||apps.length()>200)throw new Exception("Некорректные настройки приложений.");
        for(int i=0;i<apps.length();i++){
            JSONObject app=apps.getJSONObject(i);String id=app.getString("id"),name=app.getString("name");
            if(!id.matches("[A-Za-z][\\w]*(?:\\.[\\w]+)+")||id.equals("org.zphone.pilot")||id.equals("org.zphone.preview")||name.isEmpty()||name.length()>150)throw new Exception("Некорректное приложение.");
            if(seen.add(id))out.put(new JSONObject().put("id",id).put("name",name));
        }
        return new JSONObject().put("mode",mode).put("apps",out);
    }
    static JSONObject read(Context context) throws Exception {
        SettingsStore.initialize(context);
        return validate(new JSONObject(context.getSharedPreferences("settings",Context.MODE_PRIVATE).getString("split","{\"mode\":\"all\",\"apps\":[]}")));
    }
    static JSONArray apps(Context context) throws Exception {
        var manager=context.getPackageManager();var intent=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        var list=new ArrayList<JSONObject>();var seen=new HashSet<String>();
        for(var item:manager.queryIntentActivities(intent,0)){
            String id=item.activityInfo.packageName;
            if(id.equals(context.getPackageName())||!seen.add(id))continue;
            String name=String.valueOf(item.loadLabel(manager));
            list.add(new JSONObject().put("id",id).put("name",name.substring(0,Math.min(name.length(),150))));
        }
        list.sort((a,b)->a.optString("name").compareToIgnoreCase(b.optString("name")));
        return new JSONArray(list);
    }
    static void apply(Context context,VpnService.Builder builder) throws Exception {
        SettingsStore.pruneSplit(context);
        JSONObject split=read(context);String mode=split.getString("mode");JSONArray apps=split.getJSONArray("apps");
        requireSelection(mode,apps.length());
        if(!mode.equals("include"))builder.addDisallowedApplication(context.getPackageName());
        if(mode.equals("all"))return;
        int applied=0;
        for(int i=0;i<apps.length();i++){
            String id=apps.getJSONObject(i).getString("id");
            try{
                ApplicationInfo info=context.getPackageManager().getApplicationInfo(id,0);
                if(info.uid==context.getApplicationInfo().uid)throw new Exception("Нельзя направлять сам Zphone в его туннель.");
                if(mode.equals("include"))builder.addAllowedApplication(id);else builder.addDisallowedApplication(id);
                applied++;
            }catch(PackageManager.NameNotFoundException absent){
                if(installed(context,id))throw new Exception("Приложение временно недоступно. Повторите подключение после его обновления.");
                SettingsStore.removePackage(context,id);
            }
        }
        requireSelection(mode,applied);
    }
}
