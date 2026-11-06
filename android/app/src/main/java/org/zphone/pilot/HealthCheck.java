package org.zphone.pilot;

import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

final class HealthCheck {
    static final List<String> TARGETS=List.of("https://www.gstatic.com/generate_204","https://cp.cloudflare.com/generate_204","https://www.apple.com/library/test/success.html");
    interface Request { int run(String url) throws Exception; }
    static final class Result {
        final int target,latency;final long durationMs;final Exception error;
        Result(int target,int latency,long durationMs,Exception error){this.target=target;this.latency=latency;this.durationMs=durationMs;this.error=error;}
    }
    static int check(Request request,BooleanSupplier valid,Consumer<Result> record) throws Exception {return check(request,valid,record,11000);}
    static int check(Request request,BooleanSupplier valid,Consumer<Result> record,long timeoutMs) throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(TARGETS.size(),r->{Thread t=new Thread(r,"zphone-reachability");t.setDaemon(true);return t;});
        try{
            List<Callable<Result>> tasks=new ArrayList<>();
            for(int i=0;i<TARGETS.size();i++){
                final int target=i+1;final String url=TARGETS.get(i);
                tasks.add(()->{
                    long start=System.nanoTime();int latency=-1;Exception failure=null;
                    try{if(!valid.getAsBoolean())throw new ConnectException();latency=request.run(url);if(latency<0)throw new ConnectException();}
                    catch(Exception error){failure=error;}
                    return new Result(target,latency,(System.nanoTime()-start)/1000000,failure);
                });
            }
            List<Future<Result>> results=pool.invokeAll(tasks,timeoutMs,TimeUnit.MILLISECONDS);
            int best=Integer.MAX_VALUE;
            for(int i=0;i<results.size();i++){
                Future<Result> future=results.get(i);
                Result result=future.isCancelled()?new Result(i+1,-1,timeoutMs,new SocketTimeoutException()):future.get();
                if(!valid.getAsBoolean())result=new Result(result.target,-1,result.durationMs,new ConnectException());
                record.accept(result);
                if(result.error==null)best=Math.min(best,result.latency);
            }
            if(!valid.getAsBoolean()||best==Integer.MAX_VALUE)throw new ConnectException("Connectivity checks unavailable");
            return best;
        }finally{pool.shutdownNow();}
    }
}
