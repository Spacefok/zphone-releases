import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const web=path.join(root,'android/app/src/main/assets/web');
const realRoot=await fs.realpath(root),realAssets=await fs.realpath(path.dirname(web));
if(!realAssets.startsWith(realRoot+path.sep))throw Error('Android assets must remain in the workspace');
const previous=await fs.lstat(web).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
if(previous?.isSymbolicLink())throw Error('Refusing to replace a linked assets directory');
// Hashed bundles from prior builds must not remain in the APK.
await fs.rm(web,{recursive:true,force:true});
await fs.cp(path.join(root,'dist'),web,{recursive:true});
await fs.cp(path.join(root,'updates.json'),path.join(root,'android/app/src/main/assets/updates.json'));
await fs.cp(path.join(root,'licenses'),path.join(root,'android/app/src/main/assets/licenses'),{recursive:true});
const sdk=path.join(process.env.LOCALAPPDATA,'ZphoneBuild','android-sdk').replaceAll('\\','/');
await fs.writeFile(path.join(root,'android/local.properties'),'sdk.dir='+sdk+'\n');
console.log('Android assets synchronized');
