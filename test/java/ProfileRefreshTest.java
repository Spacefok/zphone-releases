package org.zphone.pilot;

import java.util.ArrayDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class ProfileRefreshTest {
    static int tests;
    static void check(boolean value){if(!value)throw new AssertionError();}
    interface Test {void run() throws Exception;}
    static void test(String name,Test run) throws Exception {run.run();tests++;System.out.println("PASS "+name);}
    static final class Failure extends Exception {final int status;Failure(int status){this.status=status;}}
    static final class Driver implements ProfileRefresh.Driver {
        long time=100000,delay;Runnable timer;int cancels;
        final ArrayDeque<Runnable> queue=new ArrayDeque<>();
        public long now(){return time;}
        public void execute(Runnable work){queue.add(work);}
        public void later(Runnable work,long delay){check(delay>0);this.delay=delay;timer=work;}
        public void cancel(){timer=null;cancels++;}
        void work(){queue.remove().run();}
        void timer(){check(timer!=null);Runnable task=timer;timer=null;time+=delay;task.run();}
    }
    static final class Host implements ProfileRefresh.Host<String> {
        String scope="private-A",value="old-keys";boolean blocked,current=true,storeFailure;
        int fetches,saves,changes;Exception failure;Runnable duringFetch;
        ProfileRefresh.Marker marker;
        public String scope(){return scope;}
        public boolean blocked(){return blocked;}
        public boolean current(){return current;}
        public ProfileRefresh.Marker marker(){return marker;}
        public String fetch(String scope) throws Exception {fetches++;if(duringFetch!=null)duringFetch.run();if(failure!=null)throw failure;return "new-keys";}
        public void save(String value,ProfileRefresh.Marker marker) throws Exception {if(storeFailure)throw new Exception("disk failed");this.value=value;this.marker=marker;saves++;}
        public int status(Exception error){return error instanceof Failure?((Failure)error).status:0;}
        public void changed(){changes++;}
    }
    static final class Fixture {
        final Object guard=new Object();final Host host=new Host();final Driver driver=new Driver();
        final ProfileRefresh<String> refresh=new ProfileRefresh<>(guard,"0.6.9",host,driver);
        void success(){refresh.wake();driver.work();}
        void state(String state){check(refresh.snapshot().state.equals(state));}
        void unchanged(){check(host.value.equals("old-keys")&&host.saves==0&&host.marker==null);}
    }
    public static void main(String[] args) throws Exception {
        test("no account never fetches",()->{Fixture f=new Fixture();f.host.scope=null;for(int i=0;i<20;i++)f.refresh.wake();check(f.driver.queue.isEmpty());f.state("idle");f.unchanged();});
        test("legacy marker missing refreshes once",()->{Fixture f=new Fixture();f.success();for(int i=0;i<20;i++)f.refresh.wake();check(f.host.fetches==1&&f.driver.queue.isEmpty());f.state("current");check(f.host.marker.matches("0.6.9","private-A")&&f.refresh.snapshot().checkedAt==f.driver.time);});
        test("same version survives new coordinator",()->{Fixture f=new Fixture();f.success();ProfileRefresh<String> next=new ProfileRefresh<>(f.guard,"0.6.9",f.host,f.driver);next.wake();check(f.driver.queue.isEmpty()&&next.snapshot().state.equals("current"));});
        test("new installed version refreshes",()->{Fixture f=new Fixture();f.success();ProfileRefresh<String> next=new ProfileRefresh<>(f.guard,"0.7.0",f.host,f.driver);next.wake();f.driver.work();check(f.host.fetches==2&&f.host.marker.version.equals("0.7.0"));});
        test("new authorized session refreshes",()->{Fixture f=new Fixture();f.success();f.host.scope="private-B";f.refresh.wake();f.driver.work();check(f.host.fetches==2&&f.host.marker.scope.equals("private-B"));});
        test("active VPN defers without fetching",()->{Fixture f=new Fixture();f.host.blocked=true;f.refresh.wake();f.state("deferred");check(f.driver.queue.isEmpty()&&f.driver.timer==null);f.host.blocked=false;f.success();f.state("current");});
        test("manual blocked completion is not success",()->{Fixture f=new Fixture();f.host.blocked=true;Exception[] result={null};f.refresh.manual(error->result[0]=error);check(result[0]!=null);f.state("deferred");check(f.driver.queue.isEmpty());});
        test("VPN started during fetch prevents commit",()->{Fixture f=new Fixture();f.host.duringFetch=()->f.host.blocked=true;f.success();f.state("deferred");f.unchanged();f.host.duringFetch=null;f.host.blocked=false;f.success();f.state("current");});
        test("connect barrier cancels a queued fetch",()->{Fixture f=new Fixture();f.refresh.wake();f.host.blocked=true;f.refresh.invalidate();f.driver.work();check(f.host.fetches==0);f.unchanged();f.state("deferred");});
        test("session change discards late response",()->{Fixture f=new Fixture();f.host.duringFetch=()->f.host.scope="private-B";f.success();f.unchanged();f.host.duringFetch=null;f.driver.work();check(f.host.marker.scope.equals("private-B")&&f.host.saves==1);});
        test("logout discards late response",()->{Fixture f=new Fixture();f.host.duringFetch=()->{f.host.scope=null;f.refresh.invalidate();};f.success();f.unchanged();f.state("idle");check(f.driver.queue.isEmpty());});
        test("late 401 cannot reject a newer session",()->{Fixture f=new Fixture();f.host.failure=new Failure(401);f.host.duringFetch=()->f.host.scope="private-B";f.success();check(!f.refresh.snapshot().state.equals("sign_in"));f.host.failure=null;f.host.duringFetch=null;f.driver.work();f.state("current");});
        for(int status:new int[]{401,403})test("auth "+status+" stops retries without erasing keys",()->{Fixture f=new Fixture();f.host.failure=new Failure(status);f.success();for(int i=0;i<20;i++)f.refresh.wake();f.state("sign_in");f.unchanged();check(f.host.fetches==1&&f.driver.timer==null&&f.driver.queue.isEmpty());});
        test("offline retries are bounded and not a busy loop",()->{Fixture f=new Fixture();f.host.failure=new Exception("offline");f.success();long[] delays={5000,30000,120000};for(long delay:delays){check(f.driver.delay==delay);for(int i=0;i<20;i++)f.refresh.wake();check(f.driver.queue.isEmpty());f.driver.timer();f.driver.work();}check(f.host.fetches==4&&f.driver.timer==null);for(int i=0;i<20;i++)f.refresh.wake();check(f.driver.queue.isEmpty());f.state("retry");f.unchanged();});
        test("manual retry can recover after automatic budget",()->{Fixture f=new Fixture();f.host.failure=new Exception("offline");f.success();for(int i=0;i<3;i++){f.driver.timer();f.driver.work();}f.host.failure=null;f.refresh.manual(error->check(error==null));f.driver.work();f.state("current");});
        test("validation failure retains old vault and no marker",()->{Fixture f=new Fixture();f.host.failure=new Exception("invalid bundle");f.success();f.unchanged();f.state("retry");});
        test("store failure cannot mark success",()->{Fixture f=new Fixture();f.host.storeFailure=true;f.success();f.unchanged();f.state("retry");f.host.storeFailure=false;f.driver.timer();f.driver.work();f.state("current");check(f.host.saves==1);});
        test("manual joins automatic single flight",()->{Fixture f=new Fixture();int[] replies={0};f.refresh.wake();f.refresh.manual(error->{check(error==null);replies[0]++;});check(f.driver.queue.size()==1);f.driver.work();check(f.host.fetches==1&&replies[0]==1);});
        test("manual success updates marker and stays refreshing until complete",()->{Fixture f=new Fixture();f.success();f.refresh.manual(error->check(error==null));f.host.duringFetch=()->{f.refresh.wake();f.state("refreshing");};f.driver.work();check(f.host.fetches==2&&f.host.marker.source.equals("account"));f.refresh.wake();check(f.driver.queue.isEmpty());});
        test("manual import supersedes automatic response",()->{Fixture f=new Fixture();f.host.duringFetch=()->{try{ProfileRefresh.Import ticket=f.refresh.beginImport();f.refresh.saveImport(ticket,"imported-keys");}catch(Exception e){throw new RuntimeException(e);}};f.success();check(f.host.value.equals("imported-keys")&&f.host.saves==1&&f.host.marker.source.equals("import"));f.state("idle");f.refresh.wake();check(f.driver.queue.isEmpty());});
        test("import marker suppresses same version after restart but not next version",()->{Fixture f=new Fixture();f.refresh.saveImport(f.refresh.beginImport(),"imported");ProfileRefresh<String> same=new ProfileRefresh<>(f.guard,"0.6.9",f.host,f.driver);same.wake();check(same.snapshot().state.equals("idle")&&f.driver.queue.isEmpty());ProfileRefresh<String> next=new ProfileRefresh<>(f.guard,"0.7.0",f.host,f.driver);next.wake();f.driver.work();check(f.host.value.equals("new-keys"));});
        test("explicit account refresh can replace an import",()->{Fixture f=new Fixture();f.refresh.saveImport(f.refresh.beginImport(),"imported");f.refresh.manual(error->check(error==null));f.driver.work();f.state("current");check(f.host.marker.source.equals("account"));});
        test("import without account does not create scoped marker",()->{Fixture f=new Fixture();f.host.scope=null;f.refresh.saveImport(f.refresh.beginImport(),"imported");check(f.host.marker==null&&f.host.value.equals("imported"));f.state("idle");});
        test("stale import cannot overwrite a changed session",()->{Fixture f=new Fixture();ProfileRefresh.Import ticket=f.refresh.beginImport();f.host.scope="private-B";boolean denied=false;try{f.refresh.saveImport(ticket,"imported");}catch(Exception e){denied=true;}check(denied);f.unchanged();});
        test("failed import does not create success marker",()->{Fixture f=new Fixture();f.host.storeFailure=true;boolean denied=false;try{f.refresh.saveImport(f.refresh.beginImport(),"imported");}catch(Exception e){denied=true;}check(denied);f.unchanged();});
        test("destroyed activity worker cannot apply",()->{Fixture f=new Fixture();f.host.duringFetch=f.refresh::close;f.success();f.unchanged();check(f.driver.timer==null&&f.driver.queue.isEmpty());});
        test("replacement activity rejects prior worker even before destroy",()->{Fixture f=new Fixture();f.host.duringFetch=()->f.host.current=false;f.success();f.unchanged();check(f.driver.queue.isEmpty());});
        test("destroy cleans retry timer",()->{Fixture f=new Fixture();f.host.failure=new Exception("offline");f.success();check(f.driver.timer!=null);f.refresh.close();check(f.driver.timer==null);f.refresh.wake();check(f.driver.queue.isEmpty());});
        test("identical state and time do not notify repeatedly",()->{Fixture f=new Fixture();f.success();int before=f.host.changes;for(int i=0;i<20;i++)f.refresh.wake();check(f.host.changes==before);});
        test("snapshot and connect guard do not wait for network",()->{
            Fixture f=new Fixture();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),guarded=new CountDownLatch(1);
            f.host.duringFetch=()->{entered.countDown();try{check(release.await(3,TimeUnit.SECONDS));}catch(InterruptedException e){throw new RuntimeException(e);}};
            f.refresh.wake();Thread network=new Thread(f.driver::work);network.start();check(entered.await(1,TimeUnit.SECONDS));
            Thread ui=new Thread(()->{f.state("refreshing");synchronized(f.guard){f.host.blocked=true;f.refresh.invalidate();}guarded.countDown();});ui.start();
            try{check(guarded.await(1,TimeUnit.SECONDS));}finally{release.countDown();network.join(2000);ui.join(2000);}
            check(!network.isAlive()&&!ui.isAlive());f.unchanged();f.state("deferred");
        });
        System.out.println("Profile refresh: "+tests+" tests passed");
    }
}
