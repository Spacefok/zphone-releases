package org.zphone.pilot;

import java.util.ArrayList;
import java.util.Objects;

/** Activity-owned single flight. Network work never holds the commit lock. */
final class ProfileRefresh<T> {
    static final class Marker {
        final String version,scope,source;
        final long checkedAt;
        Marker(String version,String scope,long checkedAt){this(version,scope,checkedAt,"account");}
        Marker(String version,String scope,long checkedAt,String source){this.version=version;this.scope=scope;this.checkedAt=checkedAt;this.source=source;}
        boolean matches(String version,String scope){return this.version.equals(version)&&this.scope.equals(scope);}
    }
    static final class State {
        final String state;
        final long checkedAt;
        State(String state,long checkedAt){this.state=state;this.checkedAt=checkedAt;}
    }
    interface Host<T> {
        String scope();
        boolean blocked();
        boolean current();
        Marker marker();
        T fetch(String scope) throws Exception;
        void save(T value,Marker marker) throws Exception;
        int status(Exception error);
        void changed();
    }
    interface Driver {
        long now();
        void execute(Runnable work);
        void later(Runnable work,long delay);
        void cancel();
    }
    interface Completion {void done(Exception error);}
    static final class Import {
        final long epoch;
        final String scope;
        Import(long epoch,String scope){this.epoch=epoch;this.scope=scope;}
    }
    private final class Request {
        final long epoch;
        final String scope;
        final ArrayList<Completion> completions=new ArrayList<>();
        Request(long epoch,String scope){this.epoch=epoch;this.scope=scope;}
    }
    private static final long[] RETRY_MS={5000,30000,120000};
    private final Object lock;
    private final String version;
    private final Host<T> host;
    private final Driver driver;
    private volatile State view=new State("idle",0);
    private boolean alive=true;
    private long epoch,retryAt;
    private int attempts;
    private String scope,deniedScope;
    private Request flight;

    ProfileRefresh(Object lock,String version,Host<T> host,Driver driver){
        this.lock=lock;this.version=version;this.host=host;this.driver=driver;
    }
    State snapshot(){return view;}
    private void state(String name,long checkedAt){if(view.state.equals(name)&&view.checkedAt==checkedAt)return;view=new State(name,checkedAt);host.changed();}
    private void settled(Marker marker){state("import".equals(marker.source)?"idle":"current","import".equals(marker.source)?0:marker.checkedAt);}
    private void identity(){
        String next=host.scope();
        if(!Objects.equals(scope,next)){
            scope=next;epoch++;attempts=0;retryAt=0;deniedScope=null;driver.cancel();
        }
    }
    void wake(){request(false,null);}
    void manual(Completion completion){request(true,completion);}
    private void request(boolean manual,Completion completion){
        synchronized(lock){
            if(!alive||!host.current()){finish(completion,new Exception("Refresh superseded"));return;}
            identity();
            if(scope==null){state("idle",0);finish(completion,new Exception("Sign in required"));return;}
            if(!manual&&Objects.equals(deniedScope,scope)){state("sign_in",0);return;}
            Marker marker=host.marker();
            if(flight!=null){
                if(host.blocked()){state("deferred",0);finish(completion,new Exception("Refresh deferred"));return;}
                if(completion!=null){
                    if(flight.epoch==epoch&&flight.scope.equals(scope))flight.completions.add(completion);
                    else finish(completion,new Exception("Refresh superseded"));
                }
                if(flight.epoch!=epoch){if(marker!=null&&marker.matches(version,scope))settled(marker);else state("pending",0);}
                return;
            }
            if(!manual&&marker!=null&&marker.matches(version,scope)){settled(marker);return;}
            if(host.blocked()){state("deferred",0);finish(completion,new Exception("Refresh deferred"));return;}
            if(!manual&&(attempts>RETRY_MS.length||driver.now()<retryAt)){
                state("retry",0);
                if(attempts<=RETRY_MS.length){driver.cancel();driver.later(this::wake,retryAt-driver.now());}
                return;
            }
            if(manual){attempts=0;retryAt=0;deniedScope=null;}
            driver.cancel();attempts++;
            Request request=new Request(epoch,scope);flight=request;
            if(completion!=null)request.completions.add(completion);
            state("pending",0);
            try{driver.execute(()->perform(request));}
            catch(RuntimeException error){complete(request,null,error);}
        }
    }
    private void perform(Request request){
        synchronized(lock){
            if(!valid(request)||host.blocked()){complete(request,null,null);return;}
            state("refreshing",0);
        }
        T result=null;Exception error=null;
        try{result=host.fetch(request.scope);}catch(Exception failure){error=failure;}
        complete(request,result,error);
    }
    private boolean valid(Request request){
        return alive&&host.current()&&request.epoch==epoch&&Objects.equals(request.scope,host.scope());
    }
    private void complete(Request request,T result,Exception error){
        boolean revisit=false;
        synchronized(lock){
            if(flight!=request)return;
            flight=null;
            if(!valid(request)){
                error=new Exception("Refresh superseded");revisit=alive&&host.current();
            }else if(host.blocked()){
                state("deferred",0);error=new Exception("Refresh deferred");
            }else{
                if(error==null){
                    try{
                        if(result==null)throw new Exception("Refresh superseded");
                        Marker marker=new Marker(version,request.scope,driver.now());
                        // Same lock as connect/import/logout/lifecycle. Save includes its marker.
                        host.save(result,marker);
                        attempts=0;retryAt=0;deniedScope=null;state("current",marker.checkedAt);
                    }catch(Exception failure){error=failure;}
                }
                if(error!=null){
                    int status=host.status(error);
                    if(status==401||status==403){deniedScope=request.scope;state("sign_in",0);}
                    else{
                        state("retry",0);
                        if(attempts<=RETRY_MS.length){
                            long delay=RETRY_MS[attempts-1];retryAt=driver.now()+delay;
                            driver.later(this::wake,delay);
                        }
                    }
                }
            }
            for(Completion completion:request.completions)finish(completion,error);
        }
        if(revisit)wake();
    }
    private static void finish(Completion completion,Exception error){if(completion!=null)completion.done(error);}

    // Caller holds this same lock while setting/clearing its operation barriers.
    void invalidate(){synchronized(lock){epoch++;driver.cancel();state(host.scope()==null?"idle":"deferred",0);}}
    Import beginImport(){synchronized(lock){invalidate();return new Import(epoch,host.scope());}}
    void saveImport(Import ticket,T value) throws Exception {
        synchronized(lock){
            if(!alive||!host.current()||ticket==null||ticket.epoch!=epoch
                    ||!Objects.equals(ticket.scope,host.scope()))throw new Exception("Import superseded");
            // The caller releases only its picker barrier before this check, under the lock.
            if(host.blocked())throw new Exception("Import deferred");
            Marker marker=ticket.scope==null?null:new Marker(version,ticket.scope,driver.now(),"import");
            host.save(value,marker);
            attempts=0;retryAt=0;deniedScope=null;
            state("idle",0);
        }
    }
    void close(){synchronized(lock){alive=false;epoch++;driver.cancel();}}
}
