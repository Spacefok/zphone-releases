package org.zphone.pilot;

import java.net.SocketTimeoutException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.*;

// DNS and socket writes can ignore read timeouts. Bound both wait time and stuck workers.
final class BoundedRequest implements AutoCloseable {
    private static ThreadPoolExecutor pool(int size,String name){
        return new ThreadPoolExecutor(0,size,30,TimeUnit.SECONDS,new SynchronousQueue<>(),r->{Thread t=new Thread(r,name);t.setDaemon(true);return t;});
    }
    private static final ExecutorService transport=pool(4,"zphone-access-http");
    private static final ExecutorService cleanup=pool(2,"zphone-access-close");
    private final Set<Job<?>> active=new HashSet<>();
    private boolean closed;
    private static final class Job<T> {
        final FutureTask<T> future;
        final Runnable cancel;
        Job(Callable<T> task,Runnable cancel){future=new FutureTask<>(task);this.cancel=cancel;}
        void stop(){
            future.cancel(true);
            try{cleanup.execute(cancel);}catch(RejectedExecutionException ignored){}
        }
    }
    <T> T run(Callable<T> task,long timeoutMs,Runnable cancel) throws Exception {
        Job<T> job=new Job<>(task,cancel);
        synchronized(this){
            if(closed)throw new CancellationException();
            active.add(job);
            try{transport.execute(job.future);}catch(RejectedExecutionException error){active.remove(job);throw new SocketTimeoutException("Access transport busy");}
        }
        try{return job.future.get(timeoutMs,TimeUnit.MILLISECONDS);}
        catch(TimeoutException error){job.stop();throw new SocketTimeoutException("Access deadline exceeded");}
        catch(InterruptedException error){job.stop();Thread.currentThread().interrupt();throw error;}
        catch(ExecutionException error){Throwable cause=error.getCause();if(cause instanceof Exception)throw (Exception)cause;throw new RuntimeException(cause);}
        finally{synchronized(this){active.remove(job);}}
    }
    @Override public synchronized void close(){closed=true;for(Job<?> job:active)job.stop();active.clear();}
}
