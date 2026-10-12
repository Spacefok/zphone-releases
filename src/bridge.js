import {VERSION} from '../shared/profiles.mjs';
let sequence=0;
const pending=new Map(),listeners=new Set();
if(window.Android){
  window.zphoneReply=(id,payload)=>{
    const request=pending.get(id);if(!request)return;pending.delete(id);clearTimeout(request.timer);
    if(payload.error)request.reject(new Error(payload.error));else request.resolve(payload.result);
  };
  window.zphoneState=state=>listeners.forEach(fn=>fn(state));
}
export const platform=window.zphone?.platform||(window.Android?'android':'preview');
export function request(command,data={}){
  if(window.zphone)return window.zphone.request(command,data);
  if(window.Android)return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Приложение не ответило. Повторите действие.'));},['exportDiagnostics','downloadUpdate'].includes(command)?600000:90000);
    pending.set(id,{resolve,reject,timer});window.Android.request(id,command,JSON.stringify(data));
  });
  if(command==='snapshot')return Promise.resolve({version:VERSION,platform:'preview',settings:{theme:'system',location:'auto',protocol:'auto',mode:'isolated',split:{mode:'all',apps:[]}},profiles:[],connection:{status:'off'}});
  return Promise.reject(new Error('Подключение недоступно в браузере. Откройте приложение Zphone.'));
}
export function subscribe(callback){if(window.zphone)return window.zphone.subscribe(callback);listeners.add(callback);return()=>listeners.delete(callback);}
