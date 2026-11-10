package org.zphone.pilot;

import java.net.SocketTimeoutException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class BoundedRequestTest {
    static void check(boolean value){if(!value)throw new AssertionError();}
    static void stubborn(CountDownLatch latch){while(latch.getCount()>0)try{latch.await();}catch(InterruptedException ignored){}}
    public static void main(String[] args) throws Exception {
        BoundedRequest requests=new BoundedRequest();
        check(requests.run(()->42,1000,()->{})==42);
        try{requests.run(()->{throw new IllegalArgumentException();},1000,()->{});throw new AssertionError();}catch(IllegalArgumentException expected){}
        CountDownLatch release=new CountDownLatch(1),closed=new CountDownLatch(1);
        long started=System.nanoTime();
        try{requests.run(()->{stubborn(release);return 7;},60,closed::countDown);throw new AssertionError();}catch(SocketTimeoutException expected){}
        check(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)<1000);
        check(closed.await(1,TimeUnit.SECONDS));
        check(requests.run(()->9,1000,()->{})==9);
        // Even uninterruptible transports cannot create an unbounded queue or thread count.
        AtomicInteger entered=new AtomicInteger();
        for(int i=0;i<8;i++)try{requests.run(()->{entered.incrementAndGet();stubborn(release);return 1;},30,()->{});throw new AssertionError();}catch(SocketTimeoutException expected){}
        check(entered.get()<=3);release.countDown();
        Thread.sleep(100);
        CountDownLatch active=new CountDownLatch(1),hold=new CountDownLatch(1);
        ExecutorService caller=Executors.newSingleThreadExecutor();
        Future<?> f=caller.submit(()->{try{requests.run(()->{active.countDown();stubborn(hold);return 1;},10000,()->{});throw new AssertionError();}catch(CancellationException expected){}catch(Exception e){throw new RuntimeException(e);}});
        check(active.await(1,TimeUnit.SECONDS));requests.close();f.get(1,TimeUnit.SECONDS);hold.countDown();caller.shutdownNow();
        try{requests.run(()->1,100,()->{});throw new AssertionError();}catch(CancellationException expected){}
        System.out.println("Bounded request tests passed");
    }
}
