package org.zphone.pilot;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
public final class UpdateReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)==PackageInstaller.STATUS_PENDING_USER_ACTION){
            Intent confirm=intent.getParcelableExtra(Intent.EXTRA_INTENT);if(confirm!=null)try{context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}catch(Exception ignored){UpdateCheck.installFailed();}
        }else if(intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)!=PackageInstaller.STATUS_SUCCESS)UpdateCheck.installFailed();
    }
}
