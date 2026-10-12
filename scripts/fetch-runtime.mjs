import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=[
  ['https://github.com/heiher/hev-socks5-tunnel/releases/download/2.18.0/hev-socks5-tunnel.aar','15ec8ed121663b562c99caa5bb602d1009f24e5b09e733438b81988f12feaaab','tunnel']
];
await fs.mkdir(path.join(root,'downloads'),{recursive:true});
for(const [url,sha,type] of assets) {
  const cache=path.join(root,'downloads',path.basename(url));
  let bytes=await fs.readFile(cache).catch(()=>null);
  if(!bytes){const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error(`Download ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());await fs.writeFile(cache,bytes);}
  if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error(`Checksum mismatch: ${type}`);
  const dest='android/app/libs/hev-socks5-tunnel.aar',output=bytes;
  const full=path.join(root,dest);await fs.mkdir(path.dirname(full),{recursive:true});await fs.writeFile(full,output);
  console.log(`Verified ${type}`);
}
for(const [name,code] of [['fin','1f1eb-1f1ee'],['ams','1f1f3-1f1f1'],['deu','1f1e9-1f1ea']]){
  const dir=path.join(root,'public');await fs.mkdir(dir,{recursive:true});
  const response=await fetch(`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`);if(!response.ok)throw Error('Flag resource unavailable');await fs.writeFile(path.join(dir,`${name}.png`),Buffer.from(await response.arrayBuffer()));
}
for(const [name,url] of [['mihomo','https://raw.githubusercontent.com/MetaCubeX/mihomo/v1.19.32/LICENSE'],['hev-socks5-tunnel','https://raw.githubusercontent.com/heiher/hev-socks5-tunnel/2.18.0/LICENSE']]){
  const response=await fetch(url);if(!response.ok)throw Error('License unavailable');await fs.mkdir(path.join(root,'licenses'),{recursive:true});await fs.writeFile(path.join(root,'licenses',name+'.txt'),await response.text());
}
