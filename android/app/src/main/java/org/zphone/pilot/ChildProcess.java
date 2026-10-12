package org.zphone.pilot;

import android.system.Os;
import android.system.OsConstants;
import android.system.ErrnoException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;

final class ChildProcess {
    private final Process process;
    private final int pid;
    private ChildProcess(Process process,int pid){this.process=process;this.pid=pid;}
    static ChildProcess start(File binary,File output,String... arguments) throws Exception {
        // Older Android APIs have no public Process.pid(). exec preserves the shell's PID.
        ArrayList<String> command=new ArrayList<>(Arrays.asList("/system/bin/sh","-c","printf '%s\\n' \"$$\"; log=\"$1\"; shift; exec \"$@\" >\"$log\" 2>&1","zphone-child",output.getAbsolutePath(),binary.getAbsolutePath()));
        command.addAll(Arrays.asList(arguments));Process process=new ProcessBuilder(command).redirectError(new File("/dev/null")).start();
        try(BufferedReader reader=new BufferedReader(new InputStreamReader(process.getInputStream(),StandardCharsets.US_ASCII))){
            String value=reader.readLine();if(value==null||!value.matches("[1-9][0-9]{0,8}"))throw new IOException("Child PID unavailable");
            return new ChildProcess(process,Integer.parseInt(value));
        }catch(Exception e){process.destroy();throw e;}
    }
    boolean isAlive(){return process.isAlive();}
    void stop() throws Exception {
        if(!process.isAlive())return;
        process.destroy();if(process.waitFor(2,TimeUnit.SECONDS))return;
        try{Os.kill(pid,OsConstants.SIGKILL);}catch(ErrnoException e){if(e.errno!=OsConstants.ESRCH)throw e;}
        if(!process.waitFor(2,TimeUnit.SECONDS))throw new IOException("Test child did not stop");
    }
}
