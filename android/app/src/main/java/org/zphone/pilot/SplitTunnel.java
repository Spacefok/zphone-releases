package org.zphone.pilot;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.VpnService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;

final class SplitTunnel {
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
        JSONObject split=read(context);String mode=split.getString("mode");JSONArray apps=split.getJSONArray("apps");
        if(mode.equals("include")&&apps.length()==0)throw new Exception("Выберите хотя бы одно приложение для VPN.");
        if(!mode.equals("include"))builder.addDisallowedApplication(context.getPackageName());
        if(mode.equals("all"))return;
        for(int i=0;i<apps.length();i++){
            String id=apps.getJSONObject(i).getString("id");
            ApplicationInfo info=context.getPackageManager().getApplicationInfo(id,0);
            if(info.uid==context.getApplicationInfo().uid)throw new Exception("Нельзя направлять сам Zphone в его туннель.");
            if(mode.equals("include"))builder.addAllowedApplication(id);else builder.addDisallowedApplication(id);
        }
    }
}
