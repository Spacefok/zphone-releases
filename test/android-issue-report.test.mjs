import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {REPORT_EVENTS} from '../desktop/diagnostics-report.mjs';

test('Android and desktop send exactly the same event allowlist',()=>{
  const source=fs.readFileSync('android/app/src/main/java/org/zphone/pilot/IssueReport.java','utf8');
  const events=source.match(/EVENTS=words\("([^"]+)"\)/)[1].split(' ');
  assert.deepEqual(events.sort(),[...REPORT_EVENTS].sort());
});
test('Android issue-report privacy and window policy runs on the local JVM without app or network',t=>{
  const javaHome=process.env.JAVA_HOME||(process.platform==='win32'?path.join(process.env.ProgramFiles,'Android/Android Studio/jbr'):null);
  const sdks=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,process.platform==='win32'?path.join(process.env.LOCALAPPDATA,'ZphoneBuild/android-sdk'):null].filter(Boolean);
  const android=sdks.map(sdk=>path.join(sdk,'platforms/android-34/android.jar')).find(file=>fs.existsSync(file));
  if(!javaHome||!android||!fs.existsSync(android)){t.skip('Local JDK and Android SDK 34 required');return;}
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'zphone-report-java-'));
  t.after(()=>fs.rmSync(out,{recursive:true,force:true}));
  const ext=process.platform==='win32'?'.exe':'';
  execFileSync(path.join(javaHome,'bin/javac'+ext),['-encoding','UTF-8','-cp',android,'-d',out,'android/app/src/main/java/org/zphone/pilot/IssueReport.java','test/java/IssueReportTest.java'],{windowsHide:true,timeout:30000});
  // The exercised policy methods use only Java primitives; JSON integration is compiled against Android's API.
  const result=execFileSync(path.join(javaHome,'bin/java'+ext),['-cp',out+path.delimiter+android,'org.zphone.pilot.IssueReportTest'],{windowsHide:true,encoding:'utf8',timeout:10000});
  assert.match(result,/passed/);
});
