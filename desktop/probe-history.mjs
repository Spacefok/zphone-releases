import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE='service-probes.json',WINDOW=180000,LIMIT=128;
export function probeRows(rows,fields,now=Date.now()){
  if(!Array.isArray(rows))return [];
  return rows.filter(row=>row&&typeof row.time==='string'&&Number.isFinite(Date.parse(row.time))&&
    Date.parse(row.time)>=now-WINDOW&&Date.parse(row.time)<=now&&
    typeof row.session==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.session)&&
    ['health.check','network.snapshot','network.snapshot_failed'].includes(row.event)&&row.data?.stage==='probe')
    .map(row=>({time:row.time,session:row.session,event:row.event,data:fields(row.data)}))
    .sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).slice(-LIMIT);
}
export function readProbeHistory(directory,fields,now=Date.now()){
  try{
    const file=path.join(directory,FILE),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>131072)return [];
    return probeRows(JSON.parse(fs.readFileSync(file,'utf8')),fields,now);
  }catch{return [];}
}
export function saveProbeHistory(directory,rows,fields,now=Date.now()){
  const data=probeRows([...readProbeHistory(directory,fields,now),...rows],fields,now);
  const target=path.join(directory,FILE),temporary=target+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(data),{mode:0o600,flag:'wx'});fs.renameSync(temporary,target);}
  finally{try{fs.unlinkSync(temporary);}catch{}}
}
