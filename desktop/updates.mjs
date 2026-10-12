import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyRelease,readJson} from '../shared/release.mjs';
const require=createRequire(import.meta.url);

export class Updates {
  constructor({config,version,installed,logger,notify=()=>{},makeUpdater,fetcher=(...args)=>fetch(...args)}){
    Object.assign(this,{config,version,installed,logger,notify,makeUpdater,fetcher});
    this.state={state:config?.publicKey?'idle':'unconfigured'};
  }
  set(next){this.state={...this.state,...next};this.notify();return this.snapshot();}
  snapshot(){return {...this.state,installable:Boolean(this.installed)};}
  async release(){
    const {repository,channel='test'}=this.config;
    if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!['test','stable'].includes(channel))throw Error('Invalid update configuration');
    const url=`https://github.com/${repository}/releases/download/${channel}/release.json`;
    // GitHub redirects public release assets to its download CDN; no credentials are sent.
    const envelope=await readJson(await this.fetcher(url,{signal:AbortSignal.timeout(20000)}));
    const release=verifyRelease(envelope,this.config);
    this.envelope=envelope;this.selected=release;return release;
  }
  init(){
    if(this.updater)return;
    const owner=this;
    const {NsisUpdater}=require('electron-updater');
    const {GenericProvider}=require('electron-updater/out/providers/GenericProvider');
    class SignedProvider extends GenericProvider {
      async getLatestVersion(){const release=await owner.release();return {version:release.version,releaseNotes:release.notes,files:[{url:release.asset.url,sha512:release.asset.sha512,size:release.asset.bytes}]};}
    }
    const options={provider:'custom',updateProvider:SignedProvider,url:'https://github.com/'};
    this.updater=this.makeUpdater?this.makeUpdater(options):new NsisUpdater(options);
    Object.assign(this.updater,{autoDownload:false,autoInstallOnAppQuit:false,autoRunAppAfterInstall:true,allowDowngrade:false,disableDifferentialDownload:true,disableWebInstaller:true});
    this.updater.logger=null;
    this.updater.on('download-progress',progress=>this.set({state:'downloading',percent:Math.floor(progress.percent)}));
    this.updater.on('error',()=>{this.logger?.write('update.failed');this.set({state:'error',message:'Обновление не удалось. Текущее приложение не изменено.'});});
  }
  async check(){
    if(this.running)return this.snapshot();
    if(!this.config?.publicKey)return this.set({state:'unconfigured',message:'Источник обновлений ещё не настроен.'});
    if(['ready','installing'].includes(this.state.state))return this.snapshot();
    this.running=true;this.set({state:'checking',message:''});
    try{
      this.init();const result=await this.updater.checkForUpdates();
      const available=result?.isUpdateAvailable;
      // Older updater releases expose the availability through updateInfo only.
      const {compareVersion}=await import('../shared/profiles.mjs');
      const newer=available??(result?.updateInfo&&compareVersion(result.updateInfo.version,this.version)>0);
      return this.set({state:newer?'available':'current',version:result?.updateInfo.version,notes:this.selected?.notes||'',priority:this.selected?.priority||'normal'});
    }catch{this.logger?.write('update.check_failed');return this.set({state:'error',message:'Не удалось проверить подписанное обновление.'});}
    finally{this.running=false;}
  }
  async download(){
    if(this.running||this.state.state!=='available')return this.snapshot();
    this.running=true;this.set({state:'downloading',percent:0});
    try{const files=await this.updater.downloadUpdate();this.file=files[0];await this.verifyFile();return this.set({state:'ready',percent:100});}
    catch{this.file=null;this.logger?.write('update.download_failed');return this.set({state:'error',message:'Загрузка или проверка обновления не удалась.'});}
    finally{this.running=false;}
  }
  async verifyFile(){
    const release=verifyRelease(this.envelope,this.config),stat=await fs.stat(this.file);
    if(stat.size!==release.asset.bytes)throw Error('Invalid cached update');
    const hash=createHash('sha256');for await(const bytes of createReadStream(this.file))hash.update(bytes);
    if(hash.digest('hex')!==release.asset.sha256)throw Error('Invalid cached update');
  }
  async install({busy=false,isBusy=()=>busy}={}){
    if(isBusy())throw Error('Сначала отключите VPN. Обновление уже скачано.');
    if(!this.installed)throw Error('Для первого перехода установите подготовленную сборку через установщик.');
    if(this.state.state!=='ready'||!this.file)throw Error('Обновление ещё не готово.');
    await this.verifyFile();if(isBusy())throw Error('Сначала отключите VPN. Обновление уже скачано.');
    this.set({state:'installing'});this.logger?.write('update.install_requested');
    this.updater.quitAndInstall(false,true);
  }
}
