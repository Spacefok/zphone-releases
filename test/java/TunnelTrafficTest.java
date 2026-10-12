package org.zphone.pilot;

public class TunnelTrafficTest {
    static void eq(long expected,long actual){if(expected!=actual)throw new AssertionError(expected+" != "+actual);}
    public static void main(String[] args){
        TunnelTraffic traffic=new TunnelTraffic();traffic.reset();traffic.beginTunnel(1000);
        traffic.sample(new long[]{20,2048,10,4096},3000);
        TunnelTraffic.Snapshot value=traffic.snapshot();eq(1024,value.uploadRate);eq(2048,value.downloadRate);eq(2048,value.uploaded);eq(4096,value.downloaded);
        traffic.sample(new long[]{20,2048,10,4096},5000);eq(0,traffic.snapshot().uploadRate);eq(0,traffic.snapshot().downloadRate);
        traffic.pause();eq(0,traffic.snapshot().downloadRate);eq(4096,traffic.snapshot().downloaded);
        traffic.beginTunnel(6000);traffic.sample(new long[]{1,1000,2,3000},8000);eq(500,traffic.snapshot().uploadRate);eq(1500,traffic.snapshot().downloadRate);eq(7096,traffic.snapshot().downloaded);
        traffic.sample(new long[]{1,20,2,40},10000);eq(10,traffic.snapshot().uploadRate);eq(20,traffic.snapshot().downloadRate);eq(3068,traffic.snapshot().uploaded);
        traffic.sample(new long[]{1,21,2,41},10000);eq(0,traffic.snapshot().uploadRate);
        boolean invalid=false;try{traffic.sample(new long[]{1},12000);}catch(IllegalArgumentException e){invalid=true;}if(!invalid)throw new AssertionError("Invalid native counters accepted");
        if(!TunnelTraffic.bytes(1024).equals("1.0 КБ")||!TunnelTraffic.bytes(1048576).equals("1.0 МБ")||!TunnelTraffic.bytes(-1).equals("0 Б"))throw new AssertionError("Unexpected units");
        traffic.reset();eq(0,traffic.snapshot().uploaded);eq(0,traffic.snapshot().downloaded);
        System.out.println("Tunnel traffic direction, rates, idle, restart, resets and units passed");
    }
}
