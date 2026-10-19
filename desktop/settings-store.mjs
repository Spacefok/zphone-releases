import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateSplit} from '../shared/split-tunnel.mjs';

export function decodeSettings(text,defaults){
  const saved=JSON.parse(text);
  if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error('Invalid settings');
  // A missing field in an older version is not a request to erase other fields.
  return {...structuredClone(defaults),...saved,split:validateSplit(Object.hasOwn(saved,'split')?saved.split:defaults.split)};
}

export class SettingsStore {
  constructor(file,defaults,{io=fs,logger}={}){Object.assign(this,{file,defaults,io,logger});this.tail=Promise.resolve();}
  snapshot(){return structuredClone(this.value);}
  record(operation,ok){this.logger?.write('settings.changed',{stage:'startup',operation:operation==='load'?'parse':operation==='save'?'request':'cleanup',ok,splitMode:this.value?.split?.mode,splitAppCount:this.value?.split?.apps?.length});}
  async atomic(file,value){
    const tmp=file+'.'+crypto.randomUUID()+'.tmp';let handle;
    try{
      handle=await this.io.open(tmp,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;
      await this.io.rename(tmp,file);
    }finally{await handle?.close();await this.io.rm(tmp,{force:true}).catch(()=>{});}
  }
  async load(){
    await this.io.mkdir(path.dirname(this.file),{recursive:true});
    let primaryError,backupError,backup;
    try{backup=decodeSettings(await this.io.readFile(this.file+'.bak','utf8'),this.defaults);}catch(error){backupError=error;}
    try{this.value=decodeSettings(await this.io.readFile(this.file,'utf8'),backup||this.defaults);}
    catch(error){primaryError=error;}
    if(!this.value){
      if(backup){this.value=backup;await this.atomic(this.file,this.value);this.record('recover',true);}
      else{
        if(primaryError?.code!=='ENOENT'||backupError?.code!=='ENOENT')throw Error('Не удалось прочитать настройки и резервную копию. Файлы сохранены; автоматический сброс отменён.');
        this.value=structuredClone(this.defaults);await this.atomic(this.file,this.value);
      }
    }
    // Keep a durable copy even before the first settings change after an upgrade.
    await this.atomic(this.file+'.bak',this.value);this.record('load',true);return this.snapshot();
  }
  update(change,afterSave){
    const task=this.tail.then(async()=>{
      const previous=this.snapshot(),next=decodeSettings(JSON.stringify(await change(this.snapshot())),this.defaults);
      await this.atomic(this.file+'.bak',previous);await this.atomic(this.file,next);
      try{await afterSave?.(next);}catch(error){await this.atomic(this.file,previous);throw error;}
      this.value=next;
      // The main file is committed. A failed secondary copy must not undo that commit.
      try{await this.atomic(this.file+'.bak',next);}catch{this.record('backup',false);}
      this.record('save',true);return this.snapshot();
    });
    this.tail=task.catch(()=>{});return task;
  }
}
