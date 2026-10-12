import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

export const diagnosticName=()=>`Zphone-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}.zip`;
export async function diagnosticArchive(logger,metadata={}){
  logger.flush();
  const archive=new AdmZip();let skipped=0,records=0;
  for(let i=0;i<logger.maxFiles;i++){
    const name=i?`diagnostics.${i}.jsonl`:'diagnostics.jsonl',file=path.join(logger.directory,name);
    let handle;
    try{
      const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*logger.maxBytes){skipped++;continue;}
      handle=await fs.open(file,'r');const bytes=Buffer.alloc(stat.size);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
      const lines=[];
      for(const line of bytes.subarray(0,bytesRead).toString('utf8').split('\n')){
        if(!line.trim())continue;
        try{
          const record=JSON.parse(line);
          if(!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(record.time)||!/^[-a-z0-9._]{1,80}$/i.test(record.event)||!/^[-a-f0-9]{36}$/i.test(record.session))throw Error('Invalid record');
          const clean=logger.clean(record.data);
          const safe=JSON.stringify({time:record.time,session:record.session,event:record.event,data:clean}).replace(/(?:[A-Z]:)?(?:\\\\|\/)Users(?:\\\\|\/)[^\\/" ]+/gi,'[user-home]');
          lines.push(safe);records++;
        }catch{skipped++;}
      }
      archive.addFile(name,Buffer.from(lines.join('\n')+'\n'));
    }catch(error){if(error.code!=='ENOENT')throw error;}finally{await handle?.close();}
  }
  const summary={format:1,created:new Date().toISOString(),records,skipped};
  for(const key of ['version','build','platform','os','arch','connectionStatus','location','protocol','mode','splitMode','splitAppCount','profileCount'])if(metadata[key]!==undefined)summary[key]=logger.clean(metadata[key]);
  archive.addFile('summary.json',Buffer.from(JSON.stringify(summary,null,2)));
  return archive.toBuffer();
}
export async function saveDiagnostics(logger,file,metadata){
  const bytes=await diagnosticArchive(logger,metadata),temporary=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try{await fs.writeFile(temporary,bytes,{mode:0o600,flag:'wx'});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
  return {ok:true};
}
