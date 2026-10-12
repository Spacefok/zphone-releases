package org.zphone.pilot;

import java.util.Locale;

final class TunnelTraffic {
    private long uploaded,downloaded,lastUpload,lastDownload,lastTime=-1,uploadRate,downloadRate;
    static final class Snapshot {
        final long uploaded,downloaded,uploadRate,downloadRate;
        Snapshot(long u,long d,long ur,long dr){uploaded=u;downloaded=d;uploadRate=ur;downloadRate=dr;}
    }
    synchronized void reset(){uploaded=downloaded=0;pause();}
    synchronized void beginTunnel(long now){lastUpload=lastDownload=0;lastTime=now;uploadRate=downloadRate=0;}
    synchronized void pause(){uploadRate=downloadRate=0;lastTime=-1;}
    synchronized void sample(long[] stats,long now){
        if(stats==null||stats.length!=4||stats[1]<0||stats[3]<0)throw new IllegalArgumentException("Invalid tunnel counters");
        if(lastTime<0)beginTunnel(now);
        long up=stats[1],down=stats[3],du=up>=lastUpload?up-lastUpload:up,dd=down>=lastDownload?down-lastDownload:down;
        long elapsed=now-lastTime;uploaded+=du;downloaded+=dd;
        uploadRate=elapsed>0?(long)(du*1000.0/elapsed):0;downloadRate=elapsed>0?(long)(dd*1000.0/elapsed):0;
        lastUpload=up;lastDownload=down;lastTime=now;
    }
    synchronized Snapshot snapshot(){return new Snapshot(uploaded,downloaded,uploadRate,downloadRate);}
    static String bytes(long value){
        double size=Math.max(0,value);String[] units={"Б","КБ","МБ","ГБ","ТБ"};int unit=0;
        while(size>=1024&&unit<units.length-1){size/=1024;unit++;}
        return unit==0?(long)size+" "+units[unit]:String.format(Locale.ROOT,"%.1f %s",size,units[unit]);
    }
}
