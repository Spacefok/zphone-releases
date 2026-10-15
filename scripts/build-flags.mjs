import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import {COUNTRIES} from '../shared/countries.mjs';

const root=path.resolve(import.meta.dirname,'..');
const revision='7aa5b2bdddd570ece62c812c0cb588ccdc099e2e';
const expected='85eb978343013df612ac9afcec2f51c42d280fd1ba33028f3fa9bd4cceab1903';
const url=`https://codeload.github.com/lipis/flag-icons/zip/${revision}`;
const archive=path.join(root,'downloads','flag-icons-7.5.0.zip');
await fs.mkdir(path.dirname(archive),{recursive:true});
let data;
try{data=await fs.readFile(archive);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('Flag source download failed');
  data=Buffer.from(await response.arrayBuffer());
}
if(createHash('sha256').update(data).digest('hex')!==expected)throw Error('Flag source checksum mismatch');
await fs.writeFile(archive,data);
const zip=new AdmZip(data),prefix=`flag-icons-${revision}/`;
const output=path.join(root,'public','flags');
await fs.mkdir(output,{recursive:true});
for(const country of COUNTRIES){
  const source=zip.getEntry(`${prefix}flags/4x3/${country.toLowerCase()}.svg`);
  if(!source)throw Error('Missing country flag');
  await sharp(source.getData(),{density:96}).resize(96,72,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}})
    .png().toFile(path.join(output,`${country.toLowerCase()}.png`));
}
const license=zip.getEntry(prefix+'LICENSE');
if(!license)throw Error('Missing flag license');
await fs.writeFile(path.join(root,'licenses','flag-icons-LICENSE.txt'),license.getData());
console.log(JSON.stringify({countryFlags:COUNTRIES.length,source:'flag-icons 7.5.0',revision}));
