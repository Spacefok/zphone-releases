package org.zphone.pilot;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class PackageRemovedReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(!Intent.ACTION_PACKAGE_FULLY_REMOVED.equals(intent.getAction())||intent.getBooleanExtra(Intent.EXTRA_REPLACING,false))return;
        android.net.Uri data=intent.getData();
        if(data==null||!"package".equals(data.getScheme()))return;
        try{SettingsStore.removePackage(context,data.getSchemeSpecificPart());MainActivity.notifyState();}
        catch(Exception ignored){} // Startup and the next connect retry cleanup if storage is unavailable.
    }
}
