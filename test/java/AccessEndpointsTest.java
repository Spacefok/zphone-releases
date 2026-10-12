package org.zphone.pilot;
import java.util.List;
public class AccessEndpointsTest {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args) throws Exception {
        check(AccessEndpoints.validate(List.of("https://first.example:12443","https://second.example")).size()==2);
        for(String bad:List.of("http://example.com","https://u:p@example.com","https://example.com/path","https://example.com?x=1","https://example.com#x")){
            boolean denied=false;try{AccessEndpoints.validate(List.of(bad));}catch(Exception e){denied=true;}check(denied);
        }
        for(String route:List.of("/v1/device/redeem","/v1/session/logout")){
            check(!AccessEndpoints.retry(route,0,"ETIMEDOUT",false));check(!AccessEndpoints.retry(route,502,"NETWORK_ERROR",false));
            check(AccessEndpoints.retry(route,0,"DNS_ERROR",false));
        }
        check(AccessEndpoints.retry("/v1/session/profiles",0,"ETIMEDOUT",false));
        check(AccessEndpoints.retry("/v1/session/profiles",0,"CONNECT_FAILED",false));
        check(AccessEndpoints.retry("/v1/device/start",503,"NETWORK_ERROR",false));
        for(int status:List.of(401,403,429))check(!AccessEndpoints.retry("/v1/device/start",status,"NETWORK_ERROR",false));
        check(!AccessEndpoints.retry("/v1/device/start",0,"NETWORK_ERROR",true));
        System.out.println("Access endpoint tests passed");
    }
}
