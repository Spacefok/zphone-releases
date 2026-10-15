package org.zphone.pilot;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import static java.util.Arrays.asList;

final class Protocols {
    static final List<String> ALL=asList("TrustTunnel","Mieru","NaiveProxy","AmneziaWG","Hysteria2");
    static boolean supportsIpv6(JSONObject profile){return Boolean.TRUE.equals(profile.opt("ipv6"))&&!profile.optString("protocol").equals("AmneziaWG");}
    private static boolean host(String s){return s.length()<=253&&s.matches("[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?");}
    private static boolean key(String s){return s.matches("[A-Za-z0-9+/]{43}=");}
    private static boolean ipv4(String s){if(!s.matches("[0-9]{1,3}(?:\\.[0-9]{1,3}){3}"))return false;for(String n:s.split("\\."))if(Integer.parseInt(n)>255)return false;return true;}
    private static void check(boolean value) throws Exception {if(!value)throw new Exception("Некорректное подключение.");}
    static JSONObject publicRoute(JSONObject p) throws Exception {
        return new JSONObject().put("location",p.getString("location")).put("protocol",p.getString("protocol"))
            .put("country",Countries.country(p.opt("location"),p.has("country"),p.opt("country")));
    }
    static JSONObject validate(JSONObject p) throws Exception {
        String protocol=p.getString("protocol");check(ALL.contains(protocol)&&host(p.optString("server")));
        Object port=p.get("port");check(port instanceof Number&&((Number)port).doubleValue()==p.getInt("port")&&p.getInt("port")>0&&p.getInt("port")<=65535);
        JSONObject out=new JSONObject();for(String k:asList("id","location","protocol","server","port"))out.put(k,p.get(k));
        out.put("country",Countries.country(p.opt("location"),p.has("country"),p.opt("country")));
        check(!p.has("ipv6")||p.get("ipv6") instanceof Boolean);out.put("ipv6",supportsIpv6(p));
        if(protocol.equals("AmneziaWG")){
            check(ipv4(p.optString("ip")));out.put("ip",p.getString("ip"));
            for(String k:asList("privateKey","publicKey","presharedKey")){check(key(p.optString(k)));out.put(k,p.getString(k));}
            int mtu=p.getInt("mtu");check(p.getDouble("mtu")==mtu&&mtu>=576&&mtu<=1400);out.put("mtu",mtu);
            JSONObject a=p.getJSONObject("awg"),clean=new JSONObject().put("version",3);
            check(a.getInt("version")==3&&a.getDouble("version")==3&&key(a.optString("header-protection-key")));clean.put("header-protection-key",a.getString("header-protection-key"));
            for(String k:asList("jc","jmin","jmax","s1","s2","s3","s4"))if(a.has(k)){int n=a.getInt(k);check(a.getDouble(k)==n&&n>=0&&n<=(k.equals("jc")?128:1400));clean.put(k,n);}
            check(clean.optInt("jmin")<=clean.optInt("jmax"));
            for(String k:asList("h1","h2","h3","h4","content-padding-addition","rekey-after-time","rekey-timeout","reject-after-time","keepalive-timeout","max-handshake-attempts"))if(a.has(k)){
                String v=a.get(k).toString();check(v.matches("[0-9]{1,10}(?:-[0-9]{1,10})?"));String[] parts=v.split("-");long lo=Long.parseLong(parts[0]),hi=Long.parseLong(parts[parts.length-1]);check(lo<=hi&&hi<=4294967295L);clean.put(k,v);
            }
            for(String k:asList("random-trailers","disable-cookies"))if(a.has(k)){check(a.get(k) instanceof Boolean);clean.put(k,a.getBoolean(k));}
            return out.put("awg",clean);
        }
        String password=p.optString("password");check(!password.isEmpty()&&password.length()<=512);out.put("password",password);
        if(!protocol.equals("Hysteria2")){String username=p.optString("username");check(!username.isEmpty()&&username.length()<=128);out.put("username",username);}
        if(p.has("sni")){check(host(p.getString("sni")));out.put("sni",p.getString("sni"));}
        if(p.has("fingerprint")){check(p.getString("fingerprint").matches("[a-fA-F0-9]{64}"));out.put("fingerprint",p.getString("fingerprint").toLowerCase(java.util.Locale.ROOT));}
        if(protocol.equals("NaiveProxy"))check(ipv4(p.getString("server"))&&p.has("sni")&&!p.has("fingerprint"));
        if(p.has("clientRandomPrefix")){check(protocol.equals("TrustTunnel")&&p.getString("clientRandomPrefix").matches("(?:[a-fA-F0-9]{2}){1,16}"));out.put("clientRandomPrefix",p.getString("clientRandomPrefix").toLowerCase(java.util.Locale.ROOT));}
        if(p.has("obfsPassword")){String v=p.getString("obfsPassword");check(protocol.equals("Hysteria2")&&v.length()>=8&&v.length()<=128);out.put("obfsPassword",v);}
        if(p.has("obfsType")){String v=p.getString("obfsType");check(protocol.equals("Hysteria2")&&p.has("obfsPassword")&&(v.equals("salamander")||v.equals("gecko")));out.put("obfsType",v);}
        return out;
    }
    static JSONObject proxy(JSONObject p,int naivePort) throws Exception {
        String protocol=p.getString("protocol");JSONObject out=new JSONObject().put("name","Zphone-Test").put("server",p.getString("server")).put("port",p.getInt("port")).put("udp",true);
        if(protocol.equals("AmneziaWG"))return out.put("type","wireguard").put("ip",p.getString("ip")).put("private-key",p.getString("privateKey")).put("public-key",p.getString("publicKey")).put("pre-shared-key",p.getString("presharedKey")).put("allowed-ips",new JSONArray().put("0.0.0.0/0")).put("persistent-keepalive",25).put("mtu",p.getInt("mtu")).put("amnezia-wg-option",p.getJSONObject("awg"));
        if(protocol.equals("NaiveProxy")){check(naivePort>0);return out.put("type","socks5").put("server","127.0.0.1").put("port",naivePort).put("udp",false);}
        out.put("password",p.getString("password"));if(p.has("username"))out.put("username",p.getString("username"));
        if(protocol.equals("Mieru"))return out.put("type","mieru").put("transport","TCP").put("multiplexing","MULTIPLEXING_LOW").put("handshake-mode","HANDSHAKE_STANDARD");
        out.put("type",protocol.equals("Hysteria2")?"hysteria2":"trusttunnel").put("sni",p.optString("sni",p.getString("server"))).put("skip-cert-verify",p.has("fingerprint"));
        if(p.has("fingerprint"))out.put("fingerprint",p.getString("fingerprint"));
        if(protocol.equals("TrustTunnel")){out.put("quic",false);if(p.has("clientRandomPrefix"))out.put("client-random-prefix",p.getString("clientRandomPrefix"));}
        if(protocol.equals("Hysteria2")&&p.has("obfsPassword"))out.put("obfs",p.optString("obfsType","salamander")).put("obfs-password",p.getString("obfsPassword"));
        return out;
    }
    private static String quote(String v) throws Exception {return URLEncoder.encode(v,"UTF-8").replace("+","%20");}
    static JSONObject naive(JSONObject p,int port) throws Exception {
        return new JSONObject().put("listen","socks://127.0.0.1:"+port).put("proxy","https://"+quote(p.getString("username"))+":"+quote(p.getString("password"))+"@"+p.getString("sni")+":"+p.getInt("port")).put("host-resolver-rules","MAP "+p.getString("sni")+" "+p.getString("server"));
    }
}
