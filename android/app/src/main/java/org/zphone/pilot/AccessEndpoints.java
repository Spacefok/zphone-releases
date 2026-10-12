package org.zphone.pilot;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

final class AccessEndpoints {
    static List<String> validate(List<String> values) throws Exception {
        if(values.isEmpty()||values.size()>3)throw new Exception("Invalid access service");
        List<String> result=new ArrayList<>();
        for(String value:values){
            URI uri=new URI(value);
            if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath().isEmpty()||uri.getPath().equals("/"))||uri.getPort()>65535)throw new Exception("Invalid access service");
            String origin="https://"+uri.getRawAuthority();
            if(!result.contains(origin))result.add(origin);
        }
        return result;
    }
    static boolean retry(String route,int status,String code,boolean received){
        if(status==401||status==403||status==429||received)return false;
        boolean before=code.matches("ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|DNS_NO_PUBLIC_ADDRESS|DNS_ERROR")||code.matches(".*(CERT|TLS|SSL).*");
        if(route.endsWith("/redeem")||route.endsWith("/logout"))return status==0&&before;
        if(status!=0)return status==502||status==503||status==504;
        return before||code.matches("ETIMEDOUT|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EPIPE|NETWORK_ERROR|IO_ERROR|CONNECT_FAILED|ERR_CONNECTION_TIMED_OUT");
    }
}
