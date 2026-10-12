package org.zphone.pilot;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

final class Diagnostics {
    static final String VERSION="0.3.7",BUILD="android-20261012.11";
    private static Diagnostics instance;
    private final File directory;
    private final String session=UUID.randomUUID().toString();
    private boolean available=true;
    private static final int LIMIT=1024*1024,COUNT=5;
    private Diagnostics(Context context){directory=new File(context.getFilesDir(),"logs");available=directory.isDirectory()||directory.mkdirs();}
    static synchronized Diagnostics get(Context context){if(instance==null)instance=new Diagnostics(context.getApplicationContext());return instance;}
    private static JSONObject clean(JSONObject input) throws Exception {
        JSONObject result=new JSONObject();
        // Only operational fields created by native code. Never accept profile objects or raw core output.
        for(String key:new String[]{"version","build","status","location","protocol","stage","errorType","reason","attempt","delayMs","latency","splitMode","splitAppCount","profileCount","records","skipped"}){
            Object value=input.opt(key);
            if(value instanceof Number||value instanceof Boolean)result.put(key,value);
            else if(value instanceof String){String text=(String)value;if(text.length()<=100&&text.matches("[A-Za-z0-9 .:_-]*"))result.put(key,text);}
        }
        return result;
    }
    synchronized void write(String event,JSONObject data){
        try{
            if(!event.matches("[a-z._]{1,80}"))return;
            byte[] bytes=(new JSONObject().put("time",Instant.now().toString()).put("session",session).put("event",event).put("data",clean(data)).toString()+"\n").getBytes(StandardCharsets.UTF_8);
            File file=new File(directory,"diagnostics.jsonl");
            if(file.length()+bytes.length>LIMIT){
                Files.deleteIfExists(new File(directory,"diagnostics."+(COUNT-1)+".jsonl").toPath());
                for(int i=COUNT-2;i>=0;i--){File from=new File(directory,i==0?"diagnostics.jsonl":"diagnostics."+i+".jsonl");if(from.exists())Files.move(from.toPath(),new File(directory,"diagnostics."+(i+1)+".jsonl").toPath());}
            }
            try(FileOutputStream stream=new FileOutputStream(file,true)){stream.write(bytes);}available=true;
        }catch(Exception e){available=false;}
    }
    synchronized JSONObject snapshot() throws Exception {return new JSONObject().put("available",available).put("session",session);}
    static String filename(){return "Zphone-diagnostics-"+Instant.now().toString().replace(':','-')+"-"+UUID.randomUUID().toString().substring(0,6)+".zip";}
    void export(OutputStream stream,JSONObject metadata) throws Exception {stream.write(archive(metadata));stream.flush();}
    private synchronized byte[] archive(JSONObject metadata) throws Exception {
        int records=0,skipped=0;
        ByteArrayOutputStream buffer=new ByteArrayOutputStream();
        try(ZipOutputStream zip=new ZipOutputStream(buffer)){
            for(int i=0;i<COUNT;i++){
                File file=new File(directory,i==0?"diagnostics.jsonl":"diagnostics."+i+".jsonl");if(!file.exists())continue;
                if(file.length()>LIMIT*2){skipped++;continue;}
                zip.putNextEntry(new ZipEntry(file.getName()));
                try(BufferedReader reader=Files.newBufferedReader(file.toPath(),StandardCharsets.UTF_8)){
                    String line;while((line=reader.readLine())!=null){try{
                        JSONObject record=new JSONObject(line);String time=record.getString("time"),id=record.getString("session"),event=record.getString("event");
                        Instant.parse(time);UUID.fromString(id);if(!event.matches("[a-z._]{1,80}"))throw new Exception();
                        JSONObject safe=new JSONObject().put("time",time).put("session",id).put("event",event).put("data",clean(record.getJSONObject("data")));
                        zip.write((safe.toString()+"\n").getBytes(StandardCharsets.UTF_8));records++;
                    }catch(Exception e){skipped++;}}
                }
                zip.closeEntry();
            }
            JSONObject summary=clean(metadata).put("format",1).put("platform","android").put("created",Instant.now().toString()).put("records",records).put("skipped",skipped);
            zip.putNextEntry(new ZipEntry("summary.json"));zip.write(summary.toString(2).getBytes(StandardCharsets.UTF_8));zip.closeEntry();
        }
        return buffer.toByteArray();
    }
}
