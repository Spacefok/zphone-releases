import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Android country policy runs offline on the JVM; profile integration compiles against the SDK',t=>{
  const home=process.env.JAVA_HOME||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Android/Android Studio/jbr'):null);
  const ext=process.platform==='win32'?'.exe':'';
  const javac=home?path.join(home,'bin/javac'+ext):'javac',java=home?path.join(home,'bin/java'+ext):'java';
  if(home&&!fs.existsSync(javac)){t.skip('Local JDK required');return;}
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'zphone-countries-test-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const source='android/app/src/main/java/org/zphone/pilot/';
  execFileSync(javac,['-encoding','UTF-8','-d',out,source+'Countries.java','test/java/CountriesTest.java'],{windowsHide:true,timeout:30000});
  assert.match(execFileSync(java,['-cp',out,'org.zphone.pilot.CountriesTest'],{windowsHide:true,encoding:'utf8',timeout:10000}),/passed/);
  const sdks=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'ZphoneBuild/android-sdk'):null].filter(Boolean);
  const android=sdks.map(sdk=>path.join(sdk,'platforms/android-34/android.jar')).find(file=>fs.existsSync(file));
  if(!android){t.diagnostic('Android SDK absent: JSON integration compile not run');return;}
  execFileSync(javac,['-encoding','UTF-8','-cp',out+path.delimiter+android,'-d',out,source+'Protocols.java',source+'ProfileStore.java'],{windowsHide:true,timeout:30000});
});
