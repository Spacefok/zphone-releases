// Dev-mode UI checks only: mocked native bridges, no app build or VPN engine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import {countryName,countryFlag,profileCountry} from '../shared/countries.mjs';
import {PROTOCOLS,VERSION} from '../shared/profiles.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ZPHONE_PLAYWRIGHT_PATH||'playwright');
const output=await fs.mkdtemp(path.join(os.tmpdir(),'zphone-countries-ui-'));
const root=path.resolve(import.meta.dirname,'..');
const server=await createServer({root,configFile:false,cacheDir:path.join(output,'vite-cache'),server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
let browser;
const results=[];
const profiles=locations=>locations.flatMap((entry,index)=>PROTOCOLS.map((protocol,p)=>({id:`mock-${index}-${p}`,...entry,protocol})));
const scenarios={
  empty:[],
  legacy:profiles([{location:'FIN'},{location:'AMS'},{location:'DEU'}]),
  modern:profiles([{location:'DEU',country:'CZ'},{location:'JP'},{location:'AIA'}]),
  long:profiles([{location:'GS'},{location:'TF'},{location:'UM'}]),
};
try{
  await server.listen();
  const url=`http://127.0.0.1:${server.httpServer.address().port}/`;
  browser=await chromium.launch({headless:true,...(process.env.ZPHONE_CHROMIUM_PATH?{executablePath:process.env.ZPHONE_CHROMIUM_PATH}:{})});
  for(const platform of ['windows','android'])for(const [scenario,items] of Object.entries(scenarios)){
    const context=await browser.newContext({viewport:platform==='windows'?{width:960,height:840}:{width:360,height:740},reducedMotion:'reduce',serviceWorkers:'block'});
    const page=await context.newPage(),errors=[],outside=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>{
      if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();
      outside.push(route.request().url());return route.abort();
    });
    await page.addInitScript(({platform,items,version})=>{
      const state={version,platform,settings:{location:'auto',protocol:'auto',theme:'light',mode:'isolated',split:{mode:'all',apps:[]}},profiles:items,connection:{status:'off'},account:{state:'unconfigured'}};
      window.mockCalls=[];
      const request=async(command,data={})=>{
        window.mockCalls.push({command,data});
        if(command==='settings'){Object.assign(state.settings,data);return structuredClone(state);}
        if(command==='snapshot')return structuredClone(state);
        throw Error('Unexpected native command: '+command);
      };
      if(platform==='android')window.Android={request:(id,command,data)=>request(command,JSON.parse(data)).then(result=>window.zphoneReply(id,{result}),error=>window.zphoneReply(id,{error:error.message}))};
      else window.zphone={platform,request,subscribe:callback=>{window.mockSubscriber=callback;}};
      window.mockUpdate=patch=>{Object.assign(state,patch);(window.mockSubscriber||window.zphoneState)(structuredClone(state));};
    },{platform,items,version:VERSION});
    await page.goto(url);
    const picker=page.locator('[data-action="picker"][data-value="location"]');
    await picker.click();
    const options=page.locator('[data-kind="location"][data-action="select"]');
    const locations=[...new Set(items.map(p=>p.location))];
    assert.deepEqual(await options.evaluateAll(nodes=>nodes.map(n=>n.dataset.value)),['auto',...locations]);
    assert.equal(await options.locator('[disabled]').count(),0);
    for(const location of locations){
      const option=page.locator(`[data-kind="location"][data-value="${location}"]`),country=profileCountry(items.find(p=>p.location===location));
      assert.equal(await option.locator('strong').textContent(),countryName(country));
      assert.equal(await option.locator('.country-flag').textContent(),countryFlag(country));
    }
    assert.equal(await page.locator('.option img').count(),0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert(await options.evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth)));
    const screenshot=path.join(output,`${platform}-${scenario}.png`);
    await page.screenshot({path:screenshot});
    if(scenario==='modern'){
      await page.locator('[data-kind="location"][data-value="DEU"]').click();
      assert.equal(await picker.locator('strong').textContent(),countryName('CZ'));
      assert.deepEqual(await page.evaluate(()=>window.mockCalls.filter(c=>c.command==='settings')),[{command:'settings',data:{location:'DEU'}}]);
      await page.evaluate(()=>window.mockUpdate({connection:{status:'connected',route:{location:'DEU',country:'CZ',protocol:'Mieru'}}}));
      assert((await page.locator('.route-label').textContent()).includes(countryName('CZ')));
      await page.locator('[data-action="details"]').click();
      assert((await page.locator('.session').textContent()).includes(countryName('CZ')));
      await page.locator('[data-action="closeModal"]').click();
      await picker.click();
      assert.equal(await options.count(),0,'Active connection still requires explicit disconnect confirmation');
      assert.equal(await page.locator('[data-action="confirmSwitch"]').count(),1);
      await page.locator('[data-action="closeModal"]').click();
      await page.evaluate(()=>window.mockUpdate({connection:{status:'off'},profiles:[]}));
      await picker.click();
      assert.deepEqual(await options.evaluateAll(nodes=>nodes.map(n=>n.dataset.value)),['auto']);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
    assert((await page.evaluate(()=>window.mockCalls)).every(c=>['snapshot','settings'].includes(c.command)));
    results.push({platform,scenario,locations:locations.length,pass:true,screenshot});
    await context.close();
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({output,passed:results.length,results}));
}finally{await browser?.close();await server.close();}
