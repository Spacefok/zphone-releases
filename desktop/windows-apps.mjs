import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {validateSplit} from '../shared/split-tunnel.mjs';
const run=promisify(execFile);

export function applicationItem(file){
  return validateSplit({mode:'all',apps:[{id:file,name:path.win32.basename(file)}]}).apps[0];
}
export async function runningApplications(){
  const script=`[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();@(Get-Process | Where-Object {$_.Path} | Select-Object -ExpandProperty Path -Unique)|ConvertTo-Json -Compress`;
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,maxBuffer:1024*1024,encoding:'utf8'});
  const paths=JSON.parse(stdout||'[]');
  return (Array.isArray(paths)?paths:[paths]).flatMap(file=>{try{return [applicationItem(file)];}catch{return [];}}).sort((a,b)=>a.name.localeCompare(b.name));
}
