const {contextBridge,ipcRenderer}=require('electron');
const commands=new Set(['snapshot','import','connect','disconnect','settings','listApps','pickApp','checkUpdates','downloadUpdate','installUpdate','accountBegin','accountOpenBot','accountPoll','accountProfiles','accountLogout','openSupport','diagnose','testPage','openLogs','exportDiagnostics','markIssue','minimize','close']);
contextBridge.exposeInMainWorld('zphone',{
  platform:'windows',
  request:(command,data)=>commands.has(command)?ipcRenderer.invoke('zphone',command,data).catch(error=>{throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/,''));}):Promise.reject(new Error('Unknown command')),
  subscribe:callback=>{const listener=(_,state)=>callback(state);ipcRenderer.on('zphone-state',listener);return()=>ipcRenderer.removeListener('zphone-state',listener);}
});
