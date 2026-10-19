package org.zphone.pilot;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.DnsResolver;
import android.net.NetworkCapabilities;
import android.os.CancellationSignal;
import org.json.JSONObject;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

final class ServiceProbe {
    static final List<String> HOSTS=List.of("www.google.com","gemini.google.com","www.youtube.com","www.amazon.com");
    private static void network(Context context,Diagnostics logger) throws Exception {
        ConnectivityManager manager=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
        String mode="unknown";
        try{String configured=android.provider.Settings.Global.getString(context.getContentResolver(),"private_dns_mode");mode="hostname".equals(configured)?"on":"opportunistic".equals(configured)?"auto":"off".equals(configured)?"off":"unknown";}catch(SecurityException ignored){}
        for(var network:manager.getAllNetworks()){
            var caps=manager.getNetworkCapabilities(network);var link=manager.getLinkProperties(network);
            if(caps==null||!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))continue;
            String type=caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)?"vpn":caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)?"wifi":caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)?"mobile":caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)?"ethernet":"other";
            JSONObject data=new JSONObject().put("stage","probe").put("networkType",type).put("validated",caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
            // Record only mode and activation, never the custom resolver hostname or addresses.
            if(link!=null)data.put("enabled",link.isPrivateDnsActive()).put("mode",mode);
            logger.write("network.snapshot",data);
        }
    }
    private static JSONObject systemDns(String host) throws Exception {
        CountDownLatch done=new CountDownLatch(1);CancellationSignal cancel=new CancellationSignal();
        AtomicReference<List<InetAddress>> addresses=new AtomicReference<>();
        DnsResolver.getInstance().query(null,host,DnsResolver.FLAG_EMPTY,Runnable::run,cancel,new DnsResolver.Callback<List<InetAddress>>(){
            public void onAnswer(List<InetAddress> value,int rcode){if(rcode==0)addresses.set(value);done.countDown();}
            public void onError(DnsResolver.DnsException error){done.countDown();}
        });
        try{if(!done.await(4500,TimeUnit.MILLISECONDS))throw new SocketTimeoutException();}finally{cancel.cancel();}
        List<InetAddress> value=addresses.get();if(value==null)throw new UnknownHostException();
        int a=0,aaaa=0;for(var address:value){if(address instanceof Inet4Address)a++;if(address instanceof Inet6Address)aaaa++;}
        return new JSONObject().put("count",a).put("records",aaaa);
    }
    private static JSONObject proxyDns(TunnelService.ProbeAccess access,String host) throws Exception {
        int a=0,aaaa=0;
        for(String type:List.of("A","AAAA")){
            JSONObject response=access.dns(host,type);if(response.optInt("Status",-1)!=0)throw new UnknownHostException();
            var answers=response.optJSONArray("Answer");int count=0;
            if(answers!=null)for(int i=0;i<answers.length();i++)if(answers.getJSONObject(i).optInt("type")== (type.equals("A")?1:28))count++;
            if(type.equals("A"))a=count;else aaaa=count;
        }
        return new JSONObject().put("count",a).put("records",aaaa);
    }
    private static JSONObject https(TunnelService.ProbeAccess access,String host) throws Exception {
        if(!access.valid())throw new ConnectException();
        Proxy proxy=new Proxy(Proxy.Type.HTTP,new InetSocketAddress("127.0.0.1",access.port));
        HttpURLConnection connection=(HttpURLConnection)new URL("https://"+host+"/").openConnection(proxy);
        connection.setConnectTimeout(4500);connection.setReadTimeout(4500);connection.setRequestMethod("HEAD");connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
        try{int status=connection.getResponseCode();if(status<100||status>599)throw new ConnectException();return new JSONObject().put("httpStatus",status);}
        finally{connection.disconnect();}
    }
    private static JSONObject sample(TunnelService.ProbeAccess access,int id,String transport,String phase,Callable<JSONObject> probe) throws Exception {
        long start=System.nanoTime();JSONObject data=new JSONObject().put("stage","probe").put("attempt",id).put("transport",transport).put("phase",phase);
        try{if(!access.valid())throw new ConnectException();JSONObject result=probe.call();for(var keys=result.keys();keys.hasNext();){String key=keys.next();data.put(key,result.get(key));}data.put("ok",true);}
        catch(Exception error){data.put("ok",false).put("errorCode",NetworkFailure.code(error));}
        if(!access.valid())data.put("ok",false).put("reason","cancelled");
        return data.put("durationMs",(System.nanoTime()-start)/1000000);
    }
    static void collect(Context context,Diagnostics logger){
        ExecutorService pool=Executors.newFixedThreadPool(12,r->{Thread t=new Thread(r,"zphone-report-probe");t.setDaemon(true);return t;});
        try{
            try{network(context,logger);}catch(Exception ignored){logger.write("network.snapshot_failed",new JSONObject().put("stage","probe"));}
            var access=TunnelService.probeAccess();
            if(access==null){logger.write("health.check",new JSONObject().put("stage","probe").put("ok",false).put("reason","unavailable"));return;}
            List<Callable<JSONObject>> tasks=new ArrayList<>();
            for(int i=0;i<HOSTS.size();i++){
                int id=i+1;String host=HOSTS.get(i);
                tasks.add(()->sample(access,id,"system","resolve",()->systemDns(host)));
                tasks.add(()->sample(access,id,"proxy","resolve",()->proxyDns(access,host)));
                // The app itself is excluded from Android VPN; HTTPS must explicitly use its proxy.
                tasks.add(()->sample(access,id,"proxy","request",()->https(access,host)));
            }
            for(var result:pool.invokeAll(tasks,15,TimeUnit.SECONDS)){
                if(result.isCancelled())logger.write("health.check",new JSONObject().put("stage","probe").put("ok",false).put("reason","timeout"));
                else logger.write("health.check",result.get());
            }
        }catch(Exception ignored){try{logger.write("network.snapshot_failed",new JSONObject().put("stage","probe"));}catch(Exception ignoredAgain){}}
        finally{pool.shutdownNow();}
    }
}
