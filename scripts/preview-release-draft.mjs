import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {VERSION} from '../shared/profiles.mjs';
const root=path.resolve(import.meta.dirname,'..');
const priority=process.argv[2]||'normal',notes=process.argv[3]||'Обновление Zphone.';
if(!['normal','important','critical'].includes(priority)||notes.length>4000)throw Error('Invalid release description');
const metadata=JSON.parse(await fs.readFile(path.join(root,'android/app/build/outputs/apk/release/output-metadata.json'),'utf8'));
const android=metadata.elements[0];if(android.versionName!==VERSION)throw Error('Build the matching Android version first');
const output=process.argv[4]?path.resolve(root,process.argv[4]):path.join(root,'release','public-'+VERSION);
if(!output.startsWith(path.join(root,'release')+path.sep))throw Error('Draft output must stay under release');
await fs.mkdir(output,{recursive:true});
for(const name of ['release-draft.json','release.json','SHA256SUMS.txt']){
 try{await fs.access(path.join(output,name));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 throw Error('Draft output already exists; select a new directory');
}
const base=`https://github.com/Spacefok/zphone-releases/releases/download/v${VERSION}/`;
const files={
 'windows-x64':{localFile:path.join(root,`release/installer/Zphone-${VERSION}-windows-x64-setup.exe`)},
 'android-arm64':{localFile:path.join(root,`release/android/Zphone-${VERSION}-arm64.apk`),package:'org.zphone.preview',versionCode:android.versionCode}
};
const checksums=[];
for(const file of Object.values(files)){
 file.url=base+path.basename(file.localFile);
 checksums.push(crypto.createHash('sha256').update(await fs.readFile(file.localFile)).digest('hex')+'  '+path.basename(file.localFile));
}
await fs.writeFile(path.join(output,'SHA256SUMS.txt'),checksums.join('\n')+'\n',{flag:'wx'});
const draft={format:'zphone-release-v1',channel:'test',version:VERSION,priority,published:new Date().toISOString(),expires:new Date(Date.now()+30*86400000).toISOString(),notes,assets:files};
await fs.writeFile(path.join(output,'release-draft.json'),JSON.stringify(draft,null,2),{flag:'wx'});
console.log('Private draft and public checksums prepared');
