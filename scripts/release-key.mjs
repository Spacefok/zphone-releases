import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,createPrivateKey} from 'node:crypto';
import {pathToFileURL} from 'node:url';
function protect(bytes,operation){
  if(process.platform!=='win32')throw Error('This key is protected by the Windows account');
  const script=`Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${operation}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return Buffer.from(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:bytes.toString('base64'),windowsHide:true,encoding:'utf8',maxBuffer:65536}).trim(),'base64');
}
export async function loadReleaseKey(file){const bytes=await fs.readFile(file);return createPrivateKey(file.endsWith('.dpapi')?protect(bytes,'Unprotect'):{key:bytes,passphrase:process.env.ZPHONE_RELEASE_KEY_PASSWORD});}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const file=path.resolve(process.argv[2]||'');const root=path.resolve(import.meta.dirname,'..');
  if(!process.argv[2]||!file.endsWith('.dpapi')||file.startsWith(root+path.sep))throw Error('Pass an external .dpapi key file');
  const keys=generateKeyPairSync('rsa',{modulusLength:3072});await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,protect(Buffer.from(keys.privateKey.export({type:'pkcs8',format:'pem'})),'Protect'),{flag:'wx'});
  const publicKey=keys.publicKey.export({type:'spki',format:'pem'});await fs.writeFile(file+'.public.pem',publicKey,{flag:'wx'});
  const configFile=path.join(root,'updates.json'),config=JSON.parse(await fs.readFile(configFile,'utf8'));if(config.publicKey)throw Error('Public signing key already configured; review rotation manually');
  config.publicKey=publicKey;await fs.writeFile(configFile,JSON.stringify(config,null,2)+'\n');console.log('Release key created outside the project, encrypted for this Windows account. Nothing published.');
}
