import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('Android access deadlines survive stuck transports and shutdown',t=>{
  const home=process.env.JAVA_HOME||path.join(process.env.ProgramFiles,'Android/Android Studio/jbr');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'zphone-request-'));
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(out)),fs.realpathSync(os.tmpdir()));assert(path.basename(out).startsWith('zphone-request-'));fs.rmSync(out,{recursive:true,force:true});});
  const ext=process.platform==='win32'?'.exe':'';
  execFileSync(path.join(home,'bin/javac'+ext),['-encoding','UTF-8','-d',out,'android/app/src/main/java/org/zphone/pilot/BoundedRequest.java','test/java/BoundedRequestTest.java'],{windowsHide:true,timeout:30000});
  const result=execFileSync(path.join(home,'bin/java'+ext),['-cp',out,'org.zphone.pilot.BoundedRequestTest'],{windowsHide:true,encoding:'utf8',timeout:10000});
  assert.match(result,/Bounded request tests passed/);
});

test('Android reports do not occupy the control queue and keep offline export',()=>{
  const source='android/app/src/main/java/org/zphone/pilot/';
  const activity=fs.readFileSync(source+'MainActivity.java','utf8');
  assert.match(activity,/\(command.equals\("markIssue"\)\?reportWorker:worker\).execute/);
  assert.match(activity,/reportWorker.shutdownNow\(\)/);
  const account=fs.readFileSync(source+'Account.java','utf8');
  assert.match(account,/requests.run\(/);
  assert.match(account,/10000,connection::disconnect/);
  assert.match(account,/if\(pendingReport==body\)clearReport\(\)/);
  assert.match(account,/requests.close\(\)/);
  assert.match(fs.readFileSync('src/app.js','utf8'),/issue.error&&\(platform==='windows'\|\|platform==='android'\)/);
});
