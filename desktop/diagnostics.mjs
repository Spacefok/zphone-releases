import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {isIP} from 'node:net';

const secretKey=/^(?:password|username|private[-_ ]?key|pre[-_ ]?shared[-_ ]?key|header[-_ ]?protection[-_ ]?key|obfs[-_ ]?password|secret|token|authorization|fingerprint|clientRandomPrefix)$/i;
const publicHosts=new Set(['localhost','www.gstatic.com','www.cloudflare.com','example.com','1.1.1.1','1.0.0.1','8.8.8.8','127.0.0.1','0.0.0.0','::1']);
export class Diagnostics {
  constructor(directory,{maxBytes=1024*1024,maxFiles=5}={}) {
    this.directory=directory;this.maxBytes=maxBytes;this.maxFiles=maxFiles;
    this.secrets=new Set();this.pending=[];this.pendingBytes=0;this.timer=null;
    this.salt=crypto.randomBytes(32);this.session=crypto.randomUUID();this.available=true;
    try{fs.mkdirSync(directory,{recursive:true});}catch{this.available=false;}
  }
  protect(value){if(typeof value==='string'&&value.length){this.secrets.add(value);this.secrets.add(encodeURIComponent(value));}}
  protectProfiles(profiles){
    for(const p of profiles){
      for(const key of ['password','username','server','sni','fingerprint','clientRandomPrefix','privateKey','publicKey','presharedKey','obfsPassword','ip'])this.protect(p[key]);
      this.protect(p.awg?.['header-protection-key']);
      for(const value of [p.privateKey,p.presharedKey,p.awg?.['header-protection-key']])if(value)this.protect(Buffer.from(value,'base64').toString('hex'));
      if(p.username&&p.password)this.protect(Buffer.from(p.username+':'+p.password).toString('base64'));
    }
  }
  host(value){return publicHosts.has(value.toLowerCase())?value:'host#'+crypto.createHmac('sha256',this.salt).update(value.toLowerCase()).digest('hex').slice(0,10);}
  redact(value){
    let text=String(value).replace(/\x1b\[[0-9;]*m/g,'');
    for(const secret of [...this.secrets].sort((a,b)=>b.length-a.length))text=text.split(secret).join('[redacted]');
    if(isIP(text))return this.host(text);
    text=text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[private key redacted]');
    text=text.replace(/(authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;"}]+/gi,'$1[redacted]');
    text=text.replace(/((?:password|private[-_ ]?key|preshared[-_ ]?key|headerprotectionkey|secret|token)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[redacted]');
    // No URL paths, query strings, credentials, or browsing hostnames in support logs.
    text=text.replace(/\b(https?|socks5h?):\/\/[^\s<>"']+/gi,raw=>{
      try{const url=new URL(raw);return url.protocol+'//'+this.host(url.hostname)+(url.port?':'+url.port:'')+'/[path]';}catch{return '[url]';}
    });
    text=text.replace(/\b(?:[a-z0-9_-]+\.)+[a-z]{2,63}\b/gi,value=>this.host(value));
    text=text.replace(/(?<![a-z0-9:])(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]*(?:%[a-z0-9_-]+)?(?![a-z0-9:])/gi,value=>isIP(value)?this.host(value):value);
    text=text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,value=>this.host(value));
    text=text.replace(/\[([a-f0-9]*:[a-f0-9:]+)\]/gi,(_,value)=>'['+this.host(value)+']');
    return text.length>6000?text.slice(0,6000)+' [truncated]':text;
  }
  clean(value,depth=0){
    if(depth>6)return '[depth limit]';
    if(typeof value==='string')return this.redact(value);
    if(value instanceof Error)return {name:this.redact(value.name),message:this.redact(value.message),code:this.clean(value.code,depth+1)};
    if(Array.isArray(value))return value.slice(0,100).map(item=>this.clean(item,depth+1));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([key,item])=>[key,secretKey.test(key)?'[redacted]':this.clean(item,depth+1)]));
    return value;
  }
  write(event,data={}){
    try{
      const line=JSON.stringify({time:new Date().toISOString(),session:this.session,event,data:this.clean(data)})+'\n';
      this.pending.push(line);this.pendingBytes+=Buffer.byteLength(line);
      if(this.pendingBytes>=65536||/error|failed|exit|quit|mark/.test(event))this.flush();
      else if(!this.timer){this.timer=setTimeout(()=>this.flush(),200);this.timer.unref();}
    }catch{this.available=false;}
  }
  attach(stream,label){
    if(!stream)return;
    const decoder=new StringDecoder('utf8');let line='',dropping=false;
    const consume=text=>{
      for(const part of text.split(/(?<=\n)/)){
        if(!dropping)line+=part;
        if(line.length>16384){line='';dropping=true;}
        if(part.endsWith('\n')){
          if(dropping)this.write('core.line_dropped',{stream:label,reason:'oversized'});
          else if(line.trim())this.write('core.log',{stream:label,message:line.trimEnd()});
          line='';dropping=false;
        }
      }
    };
    stream.on('data',chunk=>consume(decoder.write(chunk)));
    stream.on('end',()=>{consume(decoder.end());if(!dropping&&line.trim())this.write('core.log',{stream:label,message:line.trimEnd()});});
    stream.on('error',error=>this.write('core.stream_error',{stream:label,error}));
  }
  flush(){
    clearTimeout(this.timer);this.timer=null;
    if(!this.pending.length)return;
    const data=this.pending.join('');this.pending=[];this.pendingBytes=0;
    const file=path.join(this.directory,'diagnostics.jsonl');
    try{
      fs.mkdirSync(this.directory,{recursive:true});
      let size=0;try{size=fs.statSync(file).size;}catch{}
      if(size&&size+Buffer.byteLength(data)>this.maxBytes){
        fs.rmSync(path.join(this.directory,`diagnostics.${this.maxFiles-1}.jsonl`),{force:true});
        for(let i=this.maxFiles-2;i>=0;i--){const from=path.join(this.directory,i?`diagnostics.${i}.jsonl`:'diagnostics.jsonl');if(fs.existsSync(from))fs.renameSync(from,path.join(this.directory,`diagnostics.${i+1}.jsonl`));}
      }
      fs.appendFileSync(file,data,{mode:0o600});this.available=true;
    }catch{this.available=false;}
  }
}
