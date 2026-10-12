package org.zphone.pilot;

public final class NetworkFailureTest {
    private static void expect(String expected,String actual){if(!expected.equals(actual))throw new AssertionError(expected+" != "+actual);}
    public static void main(String[] args){
        NetworkFailure timeout=NetworkFailure.fromCore(504,"Get https://private.example/secret-token: context deadline exceeded");
        expect("ETIMEDOUT",timeout.code);expect("ETIMEDOUT",timeout.getMessage());
        if(timeout.httpStatus!=504)throw new AssertionError("HTTP status lost");
        expect("TLS_ERROR",NetworkFailure.fromCore(503,"tls: failed to verify certificate for private.example").code);
        expect("DNS_ERROR",NetworkFailure.fromCore(503,"lookup private.example: no such host").code);
        expect("ECONNREFUSED",NetworkFailure.fromCore(503,"dial tcp: connection refused").code);
        expect("AUTH_REJECTED",NetworkFailure.fromCore(503,"authentication failed: secret-token").code);
        expect("CORE_HTTP_503",NetworkFailure.fromCore(503,"private detail").getMessage());
        expect("ETIMEDOUT",NetworkFailure.code(new Exception("private",new java.net.SocketTimeoutException("secret"))));
        expect("DNS_ERROR",NetworkFailure.code(new java.net.UnknownHostException("private.example")));
        expect("TLS_ERROR",NetworkFailure.code(new javax.net.ssl.SSLException("secret")));
        expect("CONNECT_FAILED",NetworkFailure.code(new java.net.ConnectException("private")));
        expect("NETWORK_ERROR",NetworkFailure.code(new Exception("private://secret")));
        System.out.println("Network failure privacy and classification passed");
    }
}
