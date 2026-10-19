const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ZPHONE_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const output=process.argv[2]||await fs.mkdtemp(path.join(os.tmpdir(),'zphone-report-ui-'));
  await fs.mkdir(output,{recursive:true});const dist=path.join(output,'web');
  const {build}=await import('vite');await build({root,build:{outDir:dist,emptyOutDir:false},logLevel:'error'});
  const server=http.createServer(async(req,res)=>{
    const file=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(dist+path.sep)){res.writeHead(404).end();return;}
    try{const bytes=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const results=[];
  try{
    browser=await chromium.launch({headless:true,...(process.env.ZPHONE_CHROMIUM_PATH?{executablePath:process.env.ZPHONE_CHROMIUM_PATH}:{})});
    for(const [platform,width,height] of [['windows',960,810],['windows',380,620],['android',320,700],['android',800,360]]){
      const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      // Permit only the temporary local UI server. No account, update, VPN or production traffic.
      await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
      await page.addInitScript(({platform})=>{
        const state={version:'0.6.7',platform,settings:{theme:'light',location:'FIN',protocol:'TrustTunnel',mode:'vpn',split:{mode:'all',apps:[]}},profiles:[{location:'FIN',protocol:'TrustTunnel'}],diagnostics:{available:true},account:{state:'authorized'},connection:{status:'connected',route:{location:'FIN',protocol:'TrustTunnel'}}};
        window.testCalls=[];window.testState=state;
        const request=async(command,data)=>{
          window.testCalls.push({command,data});
          if(command==='snapshot')return state;
          if(command==='markIssue')return new Promise((resolve,reject)=>{window.completeReport=(kind)=>kind==='fail'?reject(Error('Сеть недоступна. Повторите отправку.')):resolve(kind==='bad'?{ok:true}:{ok:true,state:'queued',reportId:'abcdefab-1234-4567-8901-abcdefabcdef'});});
          throw Error('Unexpected command '+command);
        };
        if(platform==='android')window.Android={request:(id,command,data)=>request(command,JSON.parse(data)).then(result=>window.zphoneReply(id,{result}),error=>window.zphoneReply(id,{error:error.message}))};
        else window.zphone={platform,request,subscribe:callback=>{window.updateState=callback;}};
        window.changeAccount=value=>{state.account.state=value;(window.updateState||window.zphoneState)(state);};
      },{platform});
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
      const nav=platform==='windows'?'.side-nav':'.bottom-nav';
      await page.locator(`${nav} [data-value="help"]`).click();
      assert.equal(await page.locator('[data-action="exportDiagnostics"]').count(),0);
      const calls=()=>page.evaluate(()=>window.testCalls.filter(x=>x.command==='markIssue').length);
      await page.locator('[data-action="markIssue"]').click();
      assert.match(await page.locator('.sheet').innerText(),/Отправить.*администратору.*аккаунтом.*Пароли.*история посещений/s);assert.equal(await calls(),0);
      await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await calls(),0);
      await page.locator('[data-action="markIssue"]').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.sheet').count(),0);assert.equal(await calls(),0);
      await page.evaluate(()=>window.changeAccount('signed_out'));await page.locator('[data-action="markIssue"]').click();
      assert.match(await page.locator('.sheet').innerText(),/Импорт файла не выполняет вход/);assert.equal(await page.locator('[data-action="sendIssue"]').count(),0);assert.equal(await calls(),0);
      await page.getByRole('button',{name:'Отмена',exact:true}).click();await page.evaluate(()=>window.changeAccount('authorized'));
      await page.locator('[data-action="markIssue"]').click();
      await page.screenshot({path:path.join(output,`${platform}-${width}-consent.png`)});
      await page.locator('[data-action="sendIssue"]').click();assert.equal(await calls(),1);
      assert.equal(await page.locator('[data-action="sendIssue"]').isDisabled(),true);
      await page.evaluate(()=>document.querySelector('[data-action="sendIssue"]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
      await page.keyboard.press('Escape');assert.equal(await calls(),1);assert.equal(await page.locator('.sheet').count(),1);
      assert.match(await page.locator('.sheet').innerText(),/Отправляем/);
      await page.evaluate(()=>window.completeReport('fail'));await page.waitForFunction(()=>!document.querySelector('[data-action="sendIssue"]').disabled);
      assert.match(await page.locator('.sheet').innerText(),/Сеть недоступна/);
      await page.locator('[data-action="sendIssue"]').click();assert.equal(await calls(),2);
      await page.evaluate(()=>window.completeReport('bad'));await page.waitForFunction(()=>!document.querySelector('[data-action="sendIssue"]').disabled);
      assert.match(await page.locator('.sheet').innerText(),/не подтверждён/);
      await page.screenshot({path:path.join(output,`${platform}-${width}-failure.png`)});
      await page.locator('[data-action="sendIssue"]').click();await page.evaluate(()=>window.completeReport('ok'));
      await page.waitForFunction(()=>!document.querySelector('.sheet'));
      assert.match(await page.locator('.notice').innerText(),/принят сервером/);
      const bounds=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,calls:window.testCalls,connection:window.testState.connection.status}));
      assert(bounds.width<=bounds.viewport);assert.equal(bounds.connection,'connected');assert(bounds.calls.every(x=>['snapshot','markIssue'].includes(x.command)));assert.deepEqual(errors,[]);
      results.push({platform,width,height,cancel:true,consent:true,unsigned:true,doubleClick:true,progress:true,retry:true,invalidAck:true,backendAccepted:true});
      await context.close();
    }
    await fs.writeFile(path.join(output,'issue-report-ui.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({output,results}));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
