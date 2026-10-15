const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.ZPHONE_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),output=process.argv[2];
if(!output)throw Error('Output directory required');
(async()=>{
  const {VERSION}=await import(pathToFileURL(path.join(root,'shared/profiles.mjs')));
  const dist=path.join(root,'dist');await fs.mkdir(output,{recursive:true});
  const server=http.createServer(async(req,res)=>{
    const file=path.resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(dist+path.sep)){res.writeHead(404).end();return;}
    try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;const results=[];
  try{
    browser=await chromium.launch({headless:true,...(process.env.ZPHONE_CHROMIUM_PATH?{executablePath:process.env.ZPHONE_CHROMIUM_PATH}:{})});
    const origin=`http://127.0.0.1:${server.address().port}`;
    for(const [platform,width,height] of [['windows',960,810],['android',412,915],['android',320,700]])for(const theme of ['dark','light']){
      const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.addInitScript(({platform,theme,version})=>{
        window.qaState={version,platform,settings:{theme,location:'DEU',protocol:'AmneziaWG',mode:'vpn',split:{mode:'all',apps:[]}},profiles:[{id:'cz',location:'DEU',country:'CZ',protocol:'AmneziaWG'},{id:'fi',location:'FIN',country:'FI',protocol:'AmneziaWG'},{id:'nl',location:'AMS',country:'NL',protocol:'NaiveProxy'}],connection:{status:'off'},account:{state:'authorized'}};
        window.zphone={platform,subscribe:callback=>window.qaNotify=callback,request:async(command,data)=>{
          if(command==='snapshot')return window.qaState;
          if(command==='settings'){Object.assign(window.qaState.settings,data);return window.qaState;}
          throw Error('Unexpected QA command');
        }};
      },{platform,theme,version:VERSION});
      await page.goto(origin+'/index.html');
      const picker=page.locator('[data-action="picker"][data-value="location"]');
      await picker.click();
      assert.deepEqual(await page.locator('.sheet [data-action="select"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.value)),['auto','DEU','FIN','AMS']);
      for(const [location,label] of [['DEU','Чехия'],['FIN','Финляндия'],['AMS','Нидерланды']])assert((await page.locator(`.sheet [data-value="${location}"]`).innerText()).includes(label));
      await page.locator('.country-flag').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));
      assert((await page.locator('.country-flag').evaluateAll(images=>images.map(img=>img.naturalWidth===96&&img.naturalHeight===72))).every(Boolean));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`${platform}-${width}-${theme}-countries.png`)});
      await page.locator('[data-action="closeModal"]').click();
      await page.evaluate(()=>{window.qaState.profiles=window.qaState.profiles.slice(0,1);window.qaNotify(window.qaState);});
      await picker.click();
      assert.deepEqual(await page.locator('.sheet [data-action="select"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.value)),['auto','DEU']);
      await page.locator('[data-action="closeModal"]').click();
      await page.evaluate(()=>{window.qaState.profiles=[];window.qaNotify(window.qaState);});
      await picker.click();
      assert.deepEqual(await page.locator('.sheet [data-action="select"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.value)),['auto']);
      await page.locator('[data-action="closeModal"]').click();
      const nav=platform==='android'?'.bottom-nav':'.side-nav';
      await page.locator(`${nav} [data-value="account"]`).click();
      for(const status of ['pending','refreshing','current','deferred','retry','sign_in']){
        await page.evaluate(status=>{window.qaState.profileSync={state:status};window.qaNotify(window.qaState);},status);
        assert((await page.locator('.profile-sync-status').innerText()).length>0);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      }
      assert.equal(await page.getByRole('button',{name:'Войти заново',exact:true}).count(),1);
      assert.deepEqual(errors,[]);
      results.push({platform,width,height,theme,flagsLoaded:true,availableOnly:true,emptyCatalogHidden:true});
      await page.close();
    }
    await fs.writeFile(path.join(output,'ui-results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({cases:results.length,passed:true,noVpnStarted:true}));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
