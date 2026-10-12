import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
const root=path.resolve(import.meta.dirname,'..');
const version='v154.0.8037.49-4';
const artifacts=[
  {name:`naiveproxy-${version}-win-x64.zip`,hash:'120b99474848d2f737515c1043249b0998e235fda750f61893d774b317bf1870',platform:'windows'},
  {name:`naiveproxy-plugin-${version}-arm64-v8a.apk`,hash:'53d2ffd05fa13a8af22225bd738e5f59c7a499b369917c633a30c19c84f1f117',platform:'android'}
];
for(const item of artifacts){
  const url=`https://github.com/klzgrad/naiveproxy/releases/download/${version}/${item.name}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Naive download failed');
  const data=Buffer.from(await response.arrayBuffer());if(crypto.createHash('sha256').update(data).digest('hex')!==item.hash)throw Error('Naive digest mismatch');
  const zip=new AdmZip(data),entry=zip.getEntries().find(e=>item.platform==='windows'?e.entryName.endsWith('/naive.exe')||e.entryName==='naive.exe':/^lib\/arm64-v8a\/libnaive\.so$/.test(e.entryName));
  if(!entry)throw Error('Naive binary not found in '+item.name);
  const target=path.join(root,item.platform==='windows'?'runtime/windows/naive.exe':'android/app/src/main/jniLibs/arm64-v8a/libnaive.so');
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.getData());
  await fs.writeFile(target+'.build.json',JSON.stringify({version,url,archiveSha256:item.hash,binarySha256:crypto.createHash('sha256').update(entry.getData()).digest('hex')},null,2));
}
const response=await fetch(`https://raw.githubusercontent.com/klzgrad/naiveproxy/${version}/LICENSE`);if(!response.ok)throw Error('Naive license unavailable');
await fs.writeFile(path.join(root,'licenses/naiveproxy-LICENSE'),await response.text());
console.log('NaiveProxy Windows and Android binaries downloaded and hash-verified');
