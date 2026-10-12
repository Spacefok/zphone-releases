import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {Data} from 'resedit';
import config from '../electron-builder.cjs';
import {VERSION} from '../shared/profiles.mjs';

const read=relative=>fs.readFile(new URL('../'+relative,import.meta.url),'utf8');
const binary=relative=>fs.readFile(new URL('../'+relative,import.meta.url));

test('branding changes display names without changing upgrade or storage identity',async()=>{
  const pkg=JSON.parse(await read('package.json')),lock=JSON.parse(await read('package-lock.json'));
  assert.equal(pkg.version,VERSION);assert.equal(lock.version,VERSION);assert.equal(lock.packages[''].version,VERSION);
  assert.equal(config.productName,'Zphone');assert.equal(config.appId,'org.zphone.preview');
  assert.equal(config.executableName,'Zphone-Preview');assert.equal(config.win.requestedExecutionLevel,'requireAdministrator');
  assert.equal(config.nsis.deleteAppDataOnUninstall,false);assert.equal(config.win.icon,'build/icon.ico');
  const main=await read('desktop/main.cjs');
  assert.match(main,/app\.setName\('Zphone'\)/);
  assert.match(main,/app\.setPath\('userData',path\.join\(app\.getPath\('appData'\),'ZphonePreview'\)\)/);
  assert.match(main,/name:'ZphonePreview',elevation:true/);
  assert.match(main,/mode:'isolated'/);
  const gradle=await read('android/app/build.gradle');
  assert(gradle.includes(`versionName '${VERSION}'`));assert.match(gradle,/applicationId 'org.zphone.preview'/);
  assert.match(gradle,/keyAlias 'zphone-preview'/);
  const diagnostics=await read('android/app/src/main/java/org/zphone/pilot/Diagnostics.java');
  assert(diagnostics.includes(`VERSION="${VERSION}"`));
  const updates=JSON.parse(await read('updates.json'));assert.equal(updates.channel,'test');
});

test('launcher, notification and installer use Zphone branding',async()=>{
  const manifest=await read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest,/android:label="Zphone"/);assert.match(manifest,/android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest,/android:roundIcon="@mipmap\/ic_launcher"/);
  assert.match(await read('android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml'),/<monochrome /);
  const service=await read('android/app/src/main/java/org/zphone/pilot/TunnelService.java');
  assert.match(service,/setSmallIcon\(R.drawable.ic_notification\)/);
  assert.match(service,/setSession\("Zphone"\)/);
  assert.match(service,/new NotificationChannel\("vpn","VPN-подключение"/);
  assert.match(await read('build/installer.nsh'),/"Launch Zphone"/);
  assert.match(await read('index.html'),/<title>Zphone<\/title>/);
});

test('user-visible native messages do not retain pilot branding',async()=>{
  const files=['desktop/main.cjs','desktop/tray.cjs','desktop/engine.mjs','desktop/updates.mjs','shared/profiles.mjs',
    ...['MainActivity','TunnelService','Protocols','ProfileStore','UpdateCheck','ChildProcess'].map(name=>`android/app/src/main/java/org/zphone/pilot/${name}.java`)];
  for(const file of files)assert.doesNotMatch(await read(file),/Zphone (?:Test|Preview)|[Тт]естов[а-яё]*|Тест подключён/,file);
});

test('Windows icon contains distinct nonblank sizes and strips source metadata',async()=>{
  const ico=Data.IconFile.from(await binary('build/icon.ico'));
  assert.deepEqual(ico.icons.map(i=>i.data.width),[16,24,32,48,64,128,256]);
  for(const item of ico.icons){
    const data=Buffer.from(item.data.bin),meta=await sharp(data).metadata(),stats=await sharp(data).stats();
    assert.equal(meta.width,item.data.width);assert(stats.channels[0].stdev>30);assert(!meta.exif&&!meta.xmp&&!meta.icc);
  }
  for(const file of ['public/icon.png','public/tray.png']){
    const meta=await sharp(await binary(file)).metadata();assert(!meta.exif&&!meta.xmp&&!meta.icc);
  }
});

test('Android adaptive mark fits the safe zone and notification alpha is not a square',async()=>{
  for(const [density,scale] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]){
    for(const [name,dp] of [['ic_launcher_foreground',108],['ic_notification',24]]){
      const {data,info}=await sharp(await binary(`android/app/src/main/res/drawable-${density}/${name}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(info.width,dp*scale);assert.equal(info.height,dp*scale);assert.equal(data[3],0);
      let painted=0;
      for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
        if(data[(y*info.width+x)*4+3]<128)continue;
        painted++;
        if(dp===108)assert(Math.hypot(x+0.5-info.width/2,y+0.5-info.height/2)<=33*scale,`${density}: outside safe zone`);
      }
      assert(painted>info.width*info.height*0.08);assert(painted<info.width*info.height*0.6);
    }
  }
});
