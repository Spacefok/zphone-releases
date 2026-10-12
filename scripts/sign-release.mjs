import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,sign} from 'node:crypto';
import {verifyRelease} from '../shared/release.mjs';
import {loadReleaseKey} from './release-key.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output||!process.env.ZPHONE_RELEASE_KEY)throw Error('Usage: sign-release <release-draft.json> <release.json>; set ZPHONE_RELEASE_KEY outside the repository');
const root=path.resolve(import.meta.dirname,'..'),keyPath=path.resolve(process.env.ZPHONE_RELEASE_KEY);
if(keyPath.startsWith(root+path.sep))throw Error('Signing key must stay outside the repository');
const draft=JSON.parse(await fs.readFile(input,'utf8')),config=JSON.parse(await fs.readFile(path.join(root,'updates.json'),'utf8'));
for(const [platform,asset] of Object.entries(draft.assets)){
  if(!['windows-x64','android-arm64'].includes(platform))throw Error('Unsupported artifact');
  const file=await fs.readFile(asset.localFile);delete asset.localFile;
  asset.bytes=file.length;asset.sha256=createHash('sha256').update(file).digest('hex');asset.sha512=createHash('sha512').update(file).digest('base64');
}
const privateKey=await loadReleaseKey(keyPath);
const payload=Buffer.from(JSON.stringify(draft));const envelope={payload:payload.toString('base64'),signature:sign('RSA-SHA256',payload,privateKey).toString('base64')};
for(const platform of Object.keys(draft.assets))verifyRelease(envelope,{...config,platform});
await fs.writeFile(output,JSON.stringify(envelope)+'\n',{flag:'wx'});console.log('Signed locally. Nothing published.');
