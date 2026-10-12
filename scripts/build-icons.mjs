import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {Data} from 'resedit';

const root=path.resolve(import.meta.dirname,'..');
const sources=path.join(root,'build','brand');
await fs.mkdir(sources,{recursive:true});
const inputs=process.argv.slice(2);
if(inputs.length&&inputs.length!==2)throw Error('Pass both square icon and transparent foreground PNG sources.');
for(const [i,name] of ['icon-source.png','foreground-source.png'].entries()){
  const file=inputs[i]||path.join(sources,name);
  const meta=await sharp(file).metadata();
  if(meta.width!==meta.height||meta.width<512||i===1&&!meta.hasAlpha)throw Error('Square high-resolution artwork and transparent foreground are required.');
  // Re-encoding strips source metadata; only project artwork is retained.
  const data=await sharp(file).png().toBuffer();
  await fs.writeFile(path.join(sources,name),data);
}
const square=path.join(sources,'icon-source.png'),foreground=path.join(sources,'foreground-source.png');
await fs.mkdir(path.join(root,'public'),{recursive:true});
await sharp(square).resize(512,512).png().toFile(path.join(root,'public','icon.png'));
await sharp(square).resize(64,64).png().toFile(path.join(root,'public','tray.png'));
const ico=new Data.IconFile();
for(const size of [16,24,32,48,64,128,256]){
  const png=await sharp(square).resize(size,size).png().toBuffer();
  ico.icons.push({data:Data.RawIconItem.from(png,size,size,32)});
}
await fs.writeFile(path.join(root,'build','icon.ico'),Buffer.from(ico.generate()));
const res=path.join(root,'android','app','src','main','res');
for(const [density,scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]){
  const dir=path.join(res,'drawable-'+density);await fs.mkdir(dir,{recursive:true});
  // 108dp adaptive layer includes the platform mask's safe-zone margins.
  await sharp(foreground).resize(88*scale,88*scale).extend({top:10*scale,bottom:10*scale,left:10*scale,right:10*scale,background:'#00000000'}).png().toFile(path.join(dir,'ic_launcher_foreground.png'));
  // Android tints the alpha silhouette; a filled square is not a small notification icon.
  await sharp(foreground).trim().resize(20*scale,20*scale,{fit:'contain',background:'#00000000'}).extend({top:2*scale,bottom:2*scale,left:2*scale,right:2*scale,background:'#00000000'}).png().toFile(path.join(dir,'ic_notification.png'));
}
console.log('Zphone icons built: web, Windows ICO, tray, Android adaptive and notification layers.');
