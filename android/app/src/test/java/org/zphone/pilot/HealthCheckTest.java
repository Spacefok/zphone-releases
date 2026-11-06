package org.zphone.pilot;

import org.junit.Test;
import java.net.ConnectException;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public class HealthCheckTest {
    @Test public void oneReachableTargetIsEnough() throws Exception {
        List<HealthCheck.Result> rows=new ArrayList<>();
        int latency=HealthCheck.check(url->{if(!url.equals(HealthCheck.TARGETS.get(2)))throw new ConnectException();return 42;},()->true,rows::add);
        assertEquals(42,latency);assertEquals(3,rows.size());assertEquals(2,rows.stream().filter(row->row.error!=null).count());
    }
    @Test public void totalOutageFails() throws Exception {
        try{HealthCheck.check(url->{throw new ConnectException();},()->true,row->{});fail();}catch(ConnectException expected){}
    }
    @Test public void invalidDelayIsNotSuccess() throws Exception {
        try{HealthCheck.check(url->-1,()->true,row->{});fail();}catch(ConnectException expected){}
    }
    @Test public void changedConnectionDiscardsLateSuccess() throws Exception {
        AtomicBoolean valid=new AtomicBoolean(true);
        try{HealthCheck.check(url->{valid.set(false);return 30;},valid::get,row->{});fail();}catch(ConnectException expected){}
    }
    @Test public void stalledTargetsAreBounded() throws Exception {
        List<HealthCheck.Result> rows=new ArrayList<>();
        assertEquals(12,HealthCheck.check(url->{if(url.equals(HealthCheck.TARGETS.get(0)))return 12;Thread.sleep(60000);return 99;},()->true,rows::add,500));
        assertEquals(2,rows.stream().filter(row->row.error!=null).count());
    }
}
