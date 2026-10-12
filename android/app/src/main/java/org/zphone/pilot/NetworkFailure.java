package org.zphone.pilot;

import java.util.Locale;

final class NetworkFailure extends Exception {
    final String code;
    final int httpStatus;

    private NetworkFailure(String code,int status){super(code);this.code=code;this.httpStatus=status;}

    static NetworkFailure fromCore(int status,String body){
        String text=body.toLowerCase(Locale.ROOT),code="CORE_HTTP_"+status;
        if(text.contains("timeout")||text.contains("timed out")||text.contains("deadline exceeded"))code="ETIMEDOUT";
        else if(text.contains("certificate")||text.contains("tls")||text.contains("ssl"))code="TLS_ERROR";
        else if(text.contains("authentication")||text.contains("unauthorized"))code="AUTH_REJECTED";
        else if(text.contains("no such host")||text.contains("dns")||text.contains("resolve"))code="DNS_ERROR";
        else if(text.contains("connection refused"))code="ECONNREFUSED";
        else if(text.contains("network is unreachable"))code="ENETUNREACH";
        return new NetworkFailure(code,status);
    }

    static String code(Throwable error){
        for(int depth=0;error!=null&&depth<8;depth++,error=error.getCause()){
            if(error instanceof NetworkFailure)return ((NetworkFailure)error).code;
            if(error instanceof java.net.SocketTimeoutException)return "ETIMEDOUT";
            if(error instanceof java.net.UnknownHostException)return "DNS_ERROR";
            if(error instanceof javax.net.ssl.SSLException)return "TLS_ERROR";
            if(error instanceof java.net.ConnectException)return "CONNECT_FAILED";
        }
        return "NETWORK_ERROR";
    }
}
