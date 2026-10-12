import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Android tunnel counters calculate rates and preserve session totals across recovery',t=>{
  const home=process.env.JAVA_HOME||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Android/Android Studio/jbr'):null);
  const javac=home?path.join(home,'bin',process.platform==='win32'?'javac.exe':'javac'):'javac';
  const java=home?path.join(home,'bin',process.platform==='win32'?'java.exe':'java'):'java';
  if(home&&!fs.existsSync(javac)){t.skip('JDK required for Android traffic tests');return;}
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'zphone-traffic-test-'));
  execFileSync(javac,['-encoding','UTF-8','-d',out,'android/app/src/main/java/org/zphone/pilot/TunnelTraffic.java','test/java/TunnelTrafficTest.java'],{windowsHide:true,timeout:30000});
  const result=execFileSync(java,['-cp',out,'org.zphone.pilot.TunnelTrafficTest'],{windowsHide:true,encoding:'utf8',timeout:10000});assert.match(result,/passed/);
});
