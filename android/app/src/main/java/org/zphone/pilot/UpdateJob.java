package org.zphone.pilot;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.net.ConnectivityManager;
public final class UpdateJob extends JobService {
    private static final int ID=42;
    private volatile java.util.concurrent.atomic.AtomicBoolean cancellation;
    static void schedule(Context context){
        var scheduler=(JobScheduler)context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if(!context.getSharedPreferences("settings",MODE_PRIVATE).getBoolean("autoCheckUpdates",true)){scheduler.cancel(ID);return;}
        scheduler.schedule(new JobInfo.Builder(ID,new ComponentName(context,UpdateJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(12*60*60*1000L).setPersisted(true).build());
    }
    @Override public boolean onStartJob(JobParameters job){var stopped=new java.util.concurrent.atomic.AtomicBoolean();cancellation=stopped;new Thread(()->{try{
        var prefs=getSharedPreferences("settings",MODE_PRIVATE);if(!prefs.getBoolean("autoCheckUpdates",true))return;
        var result=UpdateCheck.check(this);boolean metered=((ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE)).isActiveNetworkMetered();
        if(!stopped.get()&&prefs.getBoolean("autoDownloadUpdates",false)&&(!prefs.getBoolean("updateWifiOnly",true)||!metered)&&result.optString("state").equals("available"))UpdateCheck.download(this,stopped::get);
    }catch(Exception ignored){}finally{if(!stopped.get())jobFinished(job,false);}},"update-check").start();return true;}
    @Override public boolean onStopJob(JobParameters job){var stopped=cancellation;if(stopped!=null)stopped.set(true);return true;}
}
