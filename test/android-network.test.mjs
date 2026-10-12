import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Android network failures preserve actionable codes without private core messages',t=>{
  const home=process.env.JAVA_HOME||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Android/Android Studio/jbr'):null);
  const javac=home?path.join(home,'bin',process.platform==='win32'?'javac.exe':'javac'):'javac';
  const java=home?path.join(home,'bin',process.platform==='win32'?'java.exe':'java'):'java';
  if(home&&!fs.existsSync(javac)){t.skip('JDK required for Android network tests');return;}
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'zphone-network-test-'));
  execFileSync(javac,['-encoding','UTF-8','-d',out,'android/app/src/main/java/org/zphone/pilot/NetworkFailure.java','test/java/NetworkFailureTest.java','android/app/src/main/java/org/zphone/pilot/AccessEndpoints.java','test/java/AccessEndpointsTest.java'],{windowsHide:true,timeout:30000});
  const result=execFileSync(java,['-cp',out,'org.zphone.pilot.NetworkFailureTest'],{windowsHide:true,encoding:'utf8',timeout:10000});assert.match(result,/passed/);
  assert.match(execFileSync(java,['-cp',out,'org.zphone.pilot.AccessEndpointsTest'],{windowsHide:true,encoding:'utf8',timeout:10000}),/passed/);
});
