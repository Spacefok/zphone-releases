import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const source='android/app/src/main/java/org/zphone/pilot/';
test('Android refresh policy runs offline with injectable session, VPN, storage and scheduler',t=>{
  const home=process.env.JAVA_HOME||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Android/Android Studio/jbr'):null);
  const ext=process.platform==='win32'?'.exe':'';
  const javac=home?path.join(home,'bin/javac'+ext):'javac',java=home?path.join(home,'bin/java'+ext):'java';
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'zphone-profile-refresh-'));
  t.after(()=>{
    assert.equal(path.dirname(fs.realpathSync(out)),fs.realpathSync(os.tmpdir()));
    assert(path.basename(out).startsWith('zphone-profile-refresh-'));
    fs.rmSync(out,{recursive:true,force:true});
  });
  execFileSync(javac,['-encoding','UTF-8','-d',out,source+'ProfileRefresh.java','test/java/ProfileRefreshTest.java'],{windowsHide:true,timeout:30000});
  const result=execFileSync(java,['-cp',out,'org.zphone.pilot.ProfileRefreshTest'],{windowsHide:true,encoding:'utf8',timeout:10000});
  assert.match(result,/Profile refresh: 31 tests passed/);t.diagnostic(result.trim());
  const sdks=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'ZphoneBuild/android-sdk'):null].filter(Boolean);
  const android=sdks.map(sdk=>path.join(sdk,'platforms/android-34/android.jar')).find(file=>fs.existsSync(file));
  if(!android){t.diagnostic('No Android SDK: atomic vault JVM checks not run');return;}
  const cp=out+path.delimiter+android;
  execFileSync(javac,['-encoding','UTF-8','-cp',cp,'-d',out,source+'Countries.java',source+'Protocols.java',source+'ProfileStore.java','test/java/ProfileStoreAtomicTest.java'],{windowsHide:true,timeout:30000});
  const atomic=execFileSync(java,['-cp',cp,'org.zphone.pilot.ProfileStoreAtomicTest',out],{windowsHide:true,encoding:'utf8',timeout:10000});
  assert.match(atomic,/Atomic vault: 4 checks passed/);t.diagnostic(atomic.trim());
});

test('Native wiring keeps snapshots and identity outside network monitors',()=>{
  const account=fs.readFileSync(source+'Account.java','utf8');
  assert(!/synchronized\s+(?:JSONObject\s+(?:profiles|snapshot)|Session\s+session)/.test(account));
  assert.match(account,/call\("\/v1\/session\/profiles",new JSONObject\(\),captured\.token\)/);
  assert.match(account,/if\(session!=captured\|\|closed\)/);
  const activity=fs.readFileSync(source+'MainActivity.java','utf8');
  const snapshot=activity.slice(activity.indexOf('JSONObject snapshot()'),activity.indexOf('private void reply('));
  assert(!snapshot.includes('ProfileStore(this).read'));
  assert.match(snapshot,/put\("profileSync",profileSync\(\)\)/);
  assert.match(activity,/connectionRequested=true;profileRefresh\.invalidate\(\)/);
  assert.match(activity,/profileRefresh\.manual\(/);
  assert.match(activity,/ui\.removeCallbacksAndMessages\(null\)/);
  assert.match(activity,/if\(running\)a\.connectionRequested=false/);
  const store=fs.readFileSync(source+'ProfileStore.java','utf8');
  assert.match(store,/StandardCopyOption\.ATOMIC_MOVE,StandardCopyOption\.REPLACE_EXISTING/);
  assert.match(store,/stream\.getFD\(\)\.sync\(\)/);
  assert(!/Files\.write\(file\.toPath\(\),data\)/.test(store));
  assert(!store.includes('ProfileRefresh.'));
});
