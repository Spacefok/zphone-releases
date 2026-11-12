package org.zphone.pilot;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

final class AccountRecovery {
    static String proof(JSONObject bundle) throws Exception {
        if(bundle==null||bundle.optJSONArray("profiles")==null)return null;
        var profiles=bundle.getJSONArray("profiles");
        for(int i=0;i<profiles.length();i++){
            JSONObject profile=profiles.getJSONObject(i);String key=profile.optString("privateKey","");
            if(!profile.optString("protocol").equals("AmneziaWG")||!key.matches("[A-Za-z0-9+/]{43}="))continue;
            byte[] hash=MessageDigest.getInstance("SHA-256").digest(("zphone-reauth-v1:"+key).getBytes(StandardCharsets.UTF_8));
            StringBuilder out=new StringBuilder();for(byte value:hash)out.append(String.format(Locale.ROOT,"%02x",value&255));return out.toString();
        }
        return null;
    }
}
