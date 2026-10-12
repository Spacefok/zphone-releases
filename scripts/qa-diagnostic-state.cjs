const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require(process.env.ZPHONE_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),dist=path.resolve(process.argv[2]||path.join(root,'dist'));
(async()=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-diagnostic-state-'));
  const server=http.createServer(async(req,res)=>{
    const file=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(dist+path.sep)){res.writeHead(404).end();return;}
    try{const bytes=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const results=[];
  try{
    browser=await chromium.launch({headless:true,...(process.env.ZPHONE_CHROMIUM_PATH?{executablePath:process.env.ZPHONE_CHROMIUM_PATH}:{})});
    for(const platform of ['windows','android']){
      const scenarios=['latency-refresh','off','error','recovering','route-change','account-change','late-success'];
      for(const scenario of scenarios){
        const context=await browser.newContext({viewport:platform==='windows'?{width:960,height:810}:{width:380,height:720},reducedMotion:'reduce'});
        const page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
        await page.addInitScript(({platform})=>{
          let state={version:'0.6.7',platform,settings:{theme:'light',location:'FIN',protocol:'AmneziaWG',mode:'vpn',split:{mode:'all',apps:[]}},profiles:[{location:'FIN',protocol:'AmneziaWG'}],account:{state:'authorized'},connection:{status:'connected',latency:245,route:{location:'FIN',protocol:'AmneziaWG'}},diagnostics:{available:true}};
          window.calls=[];
          const request=async(command)=>{
            window.calls.push(command);
            if(command==='snapshot')return structuredClone(state);
            if(command==='diagnose')return new Promise(resolve=>{window.finishDiagnostic=()=>resolve({ok:true,latency:269});});
            throw Error('Unexpected mock request '+command);
          };
          if(platform==='android')window.Android={request:(id,command)=>request(command).then(result=>window.zphoneReply(id,{result}),error=>window.zphoneReply(id,{error:error.message}))};
          else window.zphone={platform,request,subscribe:callback=>{window.stateCallback=callback;}};
          window.changeState=kind=>{
            state=structuredClone(state);
            if(kind==='latency-refresh')state.connection.latency=310;
            else if(kind==='route-change')state.connection.route={location:'AMS',protocol:'Mieru'};
            else if(kind==='account-change')state.account.state='signed_out';
            else state.connection.status=kind;
            (window.stateCallback||window.zphoneState)(structuredClone(state));
          };
        },{platform});
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        await page.locator(`${platform==='windows'?'.side-nav':'.bottom-nav'} [data-value="help"]`).click();
        await page.locator('[data-action="diagnose"]').click();
        await page.waitForFunction(()=>typeof window.finishDiagnostic==='function');
        if(scenario==='late-success')await page.evaluate(()=>window.changeState('off'));
        await page.evaluate(()=>window.finishDiagnostic());
        if(scenario!=='late-success'){
          await page.waitForFunction(()=>document.querySelector('.diagnostic')?.textContent.includes('Ответ получен'));
          await page.evaluate(kind=>window.changeState(kind),scenario);
        }
        // Drain the bridge reply and a render frame before examining a delayed response.
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const observed=await page.evaluate(()=>({text:document.querySelector('.diagnostic')?.textContent||'',calls:window.calls}));
        const expectedSuccess=scenario==='latency-refresh',actualSuccess=observed.text.includes('Ответ получен');
        const pass=actualSuccess===expectedSuccess&&errors.length===0&&observed.calls.every(c=>['snapshot','diagnose'].includes(c));
        results.push({platform,scenario,pass,expectedSuccess,actualSuccess,text:observed.text,errors});
        if(scenario==='recovering'||scenario==='late-success')await page.screenshot({path:path.join(output,`${platform}-${scenario}.png`)});
        await context.close();
      }
    }
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({output,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results}));
    if(results.some(r=>!r.pass))process.exitCode=1;
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
