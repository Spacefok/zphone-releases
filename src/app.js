import {createIcons,Power,Shield,SlidersHorizontal,CircleHelp,ChevronRight,ChevronDown,Sparkles,Route,Hand,Activity,UserRound,Check,X,Sun,Moon,Monitor,Download,Upload,RefreshCw,FileText,ExternalLink,LockKeyhole,Wifi,Signal,ShieldCheck,TriangleAlert,ArrowRight,RotateCw,MessageCircle,LoaderCircle,KeyRound,FolderOpen,Flag} from 'lucide';
import {request,subscribe,platform} from './bridge.js';
import {PROTOCOLS,VERSION} from '../shared/profiles.mjs';
import {createMotion} from './motion.js';
import {createIssueFlow,REPORT_CONSENT,REPORT_ACCEPTED} from './issue-report.js';
import {createDiagnosticFlow} from './diagnostic-state.js';
import './style.css';
const icons={Power,Shield,SlidersHorizontal,CircleHelp,ChevronRight,ChevronDown,Sparkles,Route,Hand,Activity,UserRound,Check,X,Sun,Moon,Monitor,Download,Upload,RefreshCw,FileText,ExternalLink,LockKeyhole,Wifi,Signal,ShieldCheck,TriangleAlert,ArrowRight,RotateCw,MessageCircle,LoaderCircle,KeyRound,FolderOpen,Flag};
const root=document.getElementById('app');
const motion=createMotion(root),regions=new WeakMap();
const themeMedia=window.matchMedia('(prefers-color-scheme: dark)');
const mobileMedia=window.matchMedia('(max-width: 480px)');
let state={version:VERSION,platform,settings:{location:'auto',protocol:'auto',theme:'system',mode:'isolated',split:{mode:'all',apps:[]}},profiles:[],connection:{status:'off'}};
let view='home',overlay=null,message='',update=null,updateBusy=false,pending=false;
const diagnosticFlow=createDiagnosticFlow(request);
const issue=createIssueFlow(request);
let apps=[],appsBusy=false,splitDraft=null,appQuery='',startupBusy=false;
let accountBusy=false,accountMessage='',firstSnapshot=true;
const splitNames={all:'Все приложения',exclude:'Выбранные без VPN',include:'Только выбранные через VPN'};
const names={auto:'Автоматически',FIN:'Финляндия',AMS:'Нидерланды',DEU:'Германия',TrustTunnel:'TrustTunnel',Mieru:'Mieru',NaiveProxy:'NaiveProxy',AmneziaWG:'AmneziaWG',Hysteria2:'Hysteria 2'};
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
const active=()=>['connecting','checking','recovering','connected','disconnecting'].includes(state.connection.status);
const busy=()=>pending||['connecting','checking','recovering','disconnecting'].includes(state.connection.status);
const flag=value=>value==='auto'?icon('sparkles'):`<img class="flag" src="./${value.toLowerCase()}.png" alt="">`;
const button=(action,text,glyph,classes='',attrs='')=>`<button type="button" class="${classes}" data-action="${action}" ${attrs}>${glyph?icon(glyph):''}<span>${text}</span></button>`;
function navigation(side=false){return `<nav class="${side?'side-nav':'bottom-nav'}" aria-label="Разделы">${[['home','Подключение','shield'],['account','Аккаунт','user-round'],['settings','Настройки','sliders-horizontal'],['help','Помощь','circle-help']].map(([key,label,glyph])=>button('nav',label,glyph,'nav-item',`data-value="${key}" ${view===key?'aria-current="page"':''} title="${label}"`)).join('')}</nav>`;}
function wordmark(){return `<div class="wordmark" aria-label="Zphone"><img class="brand-mark" src="./icon.png" width="30" height="30" alt=""><span>Zphone</span></div>`;}
function choice(kind,title){const value=state.settings[kind];return `<button type="button" class="choice" data-action="picker" data-value="${kind}" ${busy()?'disabled':''}><span class="choice-icon">${kind==='location'?flag(value):icon(value==='auto'?'sparkles':'route')}</span><span class="choice-copy"><small>${title}</small><strong>${escape(names[value])}</strong></span>${value!=='auto'?`<span class="manual">${icon('hand')}Вручную</span>`:''}${icon('chevron-right')}</button>`;}
function home(){
  const c=state.connection,connected=c.status==='connected';
  const labels={off:['Не подключено','Готово к подключению'],connecting:['Подключаемся','Устанавливаем соединение'],checking:['Проверяем интернет','Ожидаем ответ через туннель'],recovering:['Пробуем другой доступ','Проверяем доступность'],connected:[state.settings.mode==='isolated'&&platform==='windows'?'Прокси подключён':'Подключено',state.settings.mode==='isolated'&&platform==='windows'?'Системное подключение не изменено':'VPN активен'],error:['Нет ответа','Соединение не установлено']};
  labels.disconnecting=['Отключаемся','Завершаем соединение'];
  if(c.status==='recovering')labels.recovering=['Восстанавливаем соединение',c.retryAttempt?'Попытка '+c.retryAttempt+' из 5':'Проверяем доступность'];
  const [title,sub]=labels[c.status]||labels.off;
  return `<div class="home">${updateBanner()}<div class="network">${icon(platform==='android'?'signal':'monitor')}<span>${platform==='android'?'Android':platform==='windows'?'Windows':'Браузер'} · ${platform==='android'||state.settings.mode==='vpn'?'VPN':'Локальный прокси'}</span></div>
  <section class="connection-state" aria-live="polite"><h1>${title}</h1><p class="${connected?'good':c.status==='error'?'danger':''}">${sub}</p></section>
  <div class="power-space"><button type="button" class="power" data-action="power" data-state="${c.status}" aria-label="${active()?'Отключить':'Подключить'}" ${pending||state.updates?.state==='installing'?'disabled':''}>${icon(busy()?'loader-circle':c.status==='error'?'rotate-cw':'power')}</button></div>
  <div class="route-label">${c.route?`${escape(names[c.route.location])} · ${escape(c.route.protocol)}${connected&&Number.isFinite(c.latency)?' · '+c.latency+' мс':''}`:'Подключить'}</div>
  <div class="choices">${choice('location','Локация')}${choice('protocol','Протокол')}</div>
  ${!state.profiles.length?`<div class="access-empty"><p>${state.account?.state==='authorized'?'Аккаунт подтверждён. Осталось получить подключения.':'Подключения появятся после одобрения аккаунта.'}</p>${button('nav','Перейти в аккаунт','user-round','primary full','data-value="account"')}</div>`:''}
  ${c.error?`<div class="inline-error" role="alert">${escape(c.error)}</div>`:''}
  ${connected&&platform==='windows'&&state.settings.mode==='isolated'?button('testPage','Открыть страницу через прокси','external-link','text-button full'):''}
  ${button('details','Подробности соединения','activity','details full')}
  </div>`;
}
const toggle=(key,label,value)=>`<label class="switch-row"><span>${label}</span><input type="checkbox" role="switch" data-setting="${key}" ${value?'checked':''}><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span></label>`;
const currentUpdate=()=>state.updates?.state?state.updates:update;
function updateAction(current){
  if(current?.state==='available')return button('downloadUpdate','Скачать обновление '+escape(current.version),'download','primary full',updateBusy?'disabled':'');
  if(current?.state==='ready')return button('installUpdate',active()?'Отключите VPN для установки':'Установить обновление','refresh-cw','primary full',active()||updateBusy?'disabled':'');
  if(current?.state==='downloading')return `<p class="update-status" role="status">Загрузка · ${Number(current.percent)||0}%</p><progress class="update-progress" max="100" value="${Number(current.percent)||0}" aria-label="Загрузка обновления"></progress>`;
  if(current?.state==='installing')return '<p class="update-status" role="status">Ожидаем завершения установки</p>';
  if(current?.state==='error')return button('updates','Повторить проверку','refresh-cw','primary full',updateBusy?'disabled':'');
  return '';
}
function updateBanner(){const current=currentUpdate();
  if(!['important','critical'].includes(current?.priority)||!['available','downloading','ready','installing','error'].includes(current?.state))return '';
  return `<section class="update-banner ${current.priority==='critical'?'critical':''}" aria-label="${current.priority==='critical'?'Экстренное':'Важное'} обновление"><div class="update-banner-title">${icon('triangle-alert')}<h2>${current.priority==='critical'?'Экстренное':'Важное'} обновление · ${escape(current.version)}</h2></div>${current.notes?`<p class="update-notes">${escape(current.notes)}</p>`:''}${button('showUpdates','Перейти к обновлению','arrow-right','primary full')}</section>`;
}
function updates(){const current=currentUpdate();let text='Версия '+state.version;
  if(current?.state==='checking'||updateBusy)text='Проверяем…';else if(current?.state==='unconfigured'||current?.state==='error')text=current.message||'Источник обновлений ещё не настроен';else if(current?.state==='current')text='Установлена актуальная версия';else if(current?.state==='available')text='Доступна версия '+current.version;else if(current?.state==='downloading')text='Загрузка · '+(current.percent||0)+'%';else if(current?.state==='ready')text='Версия '+current.version+' готова к установке';
  if(current?.state==='installing')text='Ожидаем завершения установки';
  const working=updateBusy||['checking','downloading','installing'].includes(current?.state);
  return `<section class="updates"><div class="section-caption">Обновления</div><p class="update-status" role="status">${escape(text)}</p>${updateAction(current)}${current?.notes?`<p class="update-notes">${escape(current.notes)}</p>`:''}${current?.state==='error'?'':button('updates','Проверить обновления','refresh-cw','secondary full',working?'disabled':'')}${toggle('autoCheckUpdates','Проверять автоматически',state.settings.autoCheckUpdates!==false)}${toggle('autoDownloadUpdates','Скачивать автоматически',state.settings.autoDownloadUpdates===true)}${platform==='android'?toggle('updateWifiOnly','Загрузка только по Wi-Fi',state.settings.updateWifiOnly!==false):''}</section>`;}
function accountSettings(){const account=state.account||{state:'unconfigured'};const labels={unconfigured:'Вход ещё не настроен',signed_out:'Вход не выполнен',authorized:'Вход подтверждён',pending:'Ожидаем одобрения',expired:'Заявка истекла',rejected:'Заявка отклонена'};
  const disabled=accountBusy?'disabled':'';
  return `<section class="account-settings"><p class="account-status ${account.state==='authorized'?'good':''}" role="status">${accountBusy?'Подождите…':labels[account.state]||'Проверяем вход'}</p>${account.message?`<p class="account-copy">${escape(account.message)}</p>`:''}${account.state==='pending'?`<p class="account-copy">Нажмите «Запустить» в боте и сверьте номер заявки. Доступ подтвердит администратор.</p><p class="login-number" aria-label="Номер заявки">${escape(account.number)}</p>${button('accountOpenBot','Открыть бота','message-circle','primary full',disabled)}${button('accountPoll','Проверить одобрение','refresh-cw','secondary full',disabled)}`:account.state==='authorized'?`<p class="account-copy">${state.profiles.length?'Подключений: '+state.profiles.length:'Теперь можно получить свои подключения.'}</p>${button('accountProfiles',state.profiles.length?'Обновить подключения':'Получить подключения','download','primary full',active()||accountBusy?'disabled':'')}${button('accountLogout','Выйти из аккаунта','user-round','text-button',disabled)}`:`<h3>Доступ через Telegram</h3><p class="account-copy">Для начала напишите нашему боту: нажмите кнопку ниже, затем «Запустить» в Telegram. После одобрения администратора здесь появятся ваши подключения.</p>${button('accountBegin',accountBusy?'Связываемся с сервисом…':'Войти через Telegram',accountBusy?'loader-circle':'message-circle','primary full',account.state==='unconfigured'||accountBusy?'disabled':'')}`}${accountMessage?`<p class="inline-error" role="alert">${escape(accountMessage)}</p>`:''}</section>`;}
function accountView(){return `<div class="view account-view"><h2>Аккаунт</h2>${accountSettings()}<div class="section-caption">Доступ</div>${button('import',`Импортировать файл${state.profiles.length?' · '+state.profiles.length+' подключений':''}`,'key-round','choice',active()?'disabled':'')}</div>`;}
function logging(){return platform!=='preview'?`<section><div class="section-caption">Диагностика</div><div class="setting-state"><span>Локальный журнал</span><span class="${state.diagnostics?.available?'good':'danger'}">${icon(state.diagnostics?.available?'check':'triangle-alert')}${state.diagnostics?.available?'Включён':'Ошибка записи'}</span></div>${button('markIssue','Отметить сбой','flag','choice',issue.busy?'disabled':'')}${platform==='windows'?button('openLogs','Открыть папку журналов','folder-open','choice'):''}</section>`:'';}
function startupSettings(){return `<section class="startup-settings"><div class="section-caption">Запуск приложения</div>${[['startWithWindows','Запускать с Windows',Boolean(state.startup?.enabled),!state.startup?.available],['startInTray','Запускать в трее',state.settings.startInTray===true,false]].map(([key,label,checked,disabled])=>`<label class="switch-row"><span>${label}</span><input type="checkbox" role="switch" data-setting="${key}" ${checked?'checked':''} ${disabled?'disabled':''}><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span></label>`).join('')}${state.startup?.otherVersion?'<p class="update-status">Автозапуск другой сборки</p>':''}</section>`;}
function settings(){return `<div class="view"><h2>Настройки</h2><div class="section-caption">Внешний вид</div><div class="segment" role="group" aria-label="Тема">${[['system','monitor','Авто'],['light','sun','Светлая'],['dark','moon','Тёмная']].map(([value,glyph,label])=>button('theme',label,glyph,'',`data-value="${value}" aria-pressed="${state.settings.theme===value}"`)).join('')}</div>
  ${platform==='windows'?startupSettings():''}
  ${platform==='windows'?`<div class="section-caption">Режим подключения</div><div class="mode-options">${[['isolated','Локальный прокси','Без смены системных маршрутов'],['vpn','VPN','Весь трафик компьютера']].map(([value,label,sub])=>`<label class="mode-option"><input type="radio" name="mode" data-setting="mode" value="${value}" ${state.settings.mode===value?'checked':''} ${active()?'disabled':''}><span>${label}<small>${sub}</small></span></label>`).join('')}</div>`:''}
  <div class="section-caption">Маршрутизация</div>${button('split','Раздельное туннелирование','route','choice',active()?'disabled':'')}<p class="update-status">${splitNames[state.settings.split?.mode||'all']}${platform==='windows'&&state.settings.mode!=='vpn'?' · Действует в VPN-режиме':''}</p>
  <div class="setting-state"><span>Защищённый DNS</span><span class="good">${icon('lock-keyhole')}DoH</span></div>${platform==='android'?`<button type="button" class="choice" data-action="notificationSettings"><span class="choice-copy"><strong>Уведомления VPN</strong><small>${state.notificationsEnabled?'Разрешены':'Выключены'}</small></span>${icon('external-link')}</button>`:''}${updates()}</div>`;}
function details(){const c=state.connection;return `<dl class="session">${[['Локация',c.route?names[c.route.location]:names[state.settings.location]],['Протокол',c.route?.protocol||names[state.settings.protocol]],['Выбор протокола',state.settings.protocol==='auto'?'Автоматический':'Ручной'],['Режим',platform==='android'?'VPN':state.settings.mode==='vpn'?'VPN':'Локальный прокси'],['Задержка',c.status==='connected'&&Number.isFinite(c.latency)?c.latency+' мс':'Не измерена'],['Локальный порт',c.port?String(c.port):'Не запущен'],['Доступы',state.profiles.length]].map(([key,value])=>`<div><dt>${key}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;}
function help(){const diagnostic=diagnosticFlow.result;return `<div class="view help-view"><h2>Помощь</h2><h3>Проверка подключения</h3><div class="help-actions">${button('diagnose','Проверить соединение','activity','primary full',diagnostic?.running?'disabled':'')}</div>${diagnostic?`<p class="diagnostic ${diagnostic.ok?'good':'danger'}" role="status">${diagnostic.running?'Проверяем…':diagnostic.ok?'Ответ получен · '+diagnostic.latency+' мс':escape(diagnostic.message)}</p>`:''}${logging()}<div class="section-caption">Обратная связь</div><button type="button" class="choice" data-action="openSupport"><span class="choice-icon">${icon('message-circle')}</span><span class="choice-copy"><strong>Написать в поддержку</strong><small>Telegram</small></span>${icon('external-link')}</button></div>`;}
function appRows(){
  const query=appQuery.toLocaleLowerCase();
  const selected=new Map(splitDraft.apps.map(app=>[app.id,app]));
  const choices=[...new Map([...apps,...splitDraft.apps].map(app=>[app.id,app])).values()].filter(app=>(app.name+' '+app.id).toLocaleLowerCase().includes(query));
  choices.sort((a,b)=>Number(selected.has(b.id))-Number(selected.has(a.id))||a.name.localeCompare(b.name));
  return choices.map(app=>`<label class="app-row"><input type="checkbox" data-app="${escape(app.id)}" ${selected.has(app.id)?'checked':''}><span><strong>${escape(app.name)}</strong><small>${escape(app.id)}</small></span></label>`).join('')||`<p class="update-status">${appsBusy?'Загрузка приложений…':'Приложения не найдены'}</p>`;
}
function splitView(){return `<div class="view split-view"><div class="view-heading">${button('splitBack','','chevron-down','icon-button','aria-label="Назад к настройкам" title="Назад"')}<h2>Приложения</h2></div>
  <div class="mode-options">${Object.entries(splitNames).map(([value,label])=>`<label class="mode-option"><input type="radio" name="split-mode" data-setting="splitMode" value="${value}" ${splitDraft.mode===value?'checked':''}><span>${label}</span></label>`).join('')}</div>
  ${splitDraft.mode!=='all'?`<p class="split-status">${splitDraft.mode==='include'?'Остальные приложения работают без VPN':'Остальные приложения используют VPN'}</p><div class="app-toolbar"><input type="search" id="app-search" aria-label="Поиск приложений" placeholder="Поиск приложений" value="${escape(appQuery)}">${button('refreshApps','','refresh-cw','icon-button',`aria-label="Обновить список" title="Обновить список" ${appsBusy?'disabled':''}`)}${platform==='windows'?button('pickApp','','folder-open','icon-button','aria-label="Выбрать файл .exe" title="Выбрать файл .exe"'):''}</div><div class="split-count">Выбрано: ${splitDraft.apps.length}</div><div class="app-results">${appRows()}</div>`:''}
  ${button('saveSplit','Сохранить','check','primary full split-save',appsBusy?'disabled':'')}</div>`;}
async function loadApps(){appsBusy=true;render();try{const result=await request('listApps');apps=result.apps;}catch(error){message=error.message;}finally{appsBusy=false;render();}}
function modal(){if(!overlay)return '';let title,content;
  if(['location','protocol'].includes(overlay)){
    title=overlay==='location'?'Локация':'Протокол';
    const values=overlay==='location'?['auto',...new Set(state.profiles.map(p=>p.location))]:['auto',...PROTOCOLS];
    const missing=overlay==='protocol'&&PROTOCOLS.some(protocol=>!state.profiles.some(p=>p.protocol===protocol));
    content=`<div class="option-list" role="group" aria-label="${title}">${values.map(value=>{
      const unavailable=overlay==='protocol'&&value!=='auto'&&!state.profiles.some(p=>p.protocol===value);
      const subtitle=unavailable?'Доступ не импортирован':value==='auto'?'Проверка доступных подключений':overlay==='protocol'?'Ручной выбор':'Доступная локация';
      return `<button type="button" class="option" data-action="select" data-kind="${overlay}" data-value="${value}" aria-pressed="${state.settings[overlay]===value}" ${unavailable?'disabled':''}>${overlay==='location'?flag(value):icon(value==='auto'?'sparkles':'shield-check')}<span><strong>${names[value]}</strong><small>${subtitle}</small></span>${state.settings[overlay]===value?icon('check'):''}</button>`;
    }).join('')}</div>${missing?button('nav','Управление доступами','user-round','text-button full','data-value="account"'):''}`;
  }
  else if(overlay==='issue'){
    title='Отметить сбой';
    const authorized=state.account?.state==='authorized';
    content=authorized?`<p class="modal-copy">${REPORT_CONSENT}</p>${issue.error?`<p class="inline-error" role="alert">${escape(issue.error)}</p>`:''}<div aria-live="polite" aria-busy="${issue.busy}">${issue.busy?'<p class="modal-copy" role="status">Отправляем отчёт…</p>':''}${button('sendIssue',issue.error?'Повторить отправку':'Отправить',issue.busy?'loader-circle':'upload','primary full',issue.busy?'disabled':'')}</div>`:`<p class="modal-copy">Для отправки сбоя войдите через бота в разделе «Аккаунт». Импорт файла не выполняет вход.</p>${button('nav','Перейти в аккаунт','user-round','primary full','data-value="account"')}`;
    content+=button('closeModal','Отмена','x','secondary full',issue.busy?'disabled':'');
  }
  else if(overlay==='switch'){title='Сменить подключение?';content=`<p class="modal-copy">Текущее соединение будет отключено перед выбором нового.</p>${button('confirmSwitch','Отключить соединение','power','primary full')}`;}
  else{title='Соединение';content=details();}
  return `<div class="overlay"><section class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="sheet-head"><h2>${title}</h2><button type="button" class="icon-button" data-action="closeModal" aria-label="Закрыть" ${overlay==='issue'&&issue.busy?'disabled':''}>${icon('x')}</button></div>${content}</section></div>`;
}
function render(){
  const nextMotion={view,overlay,message,status:state.connection.status,theme:state.settings.theme==='system'?(themeMedia.matches?'dark':'light'):state.settings.theme,startWithWindows:Boolean(state.startup?.enabled),startInTray:state.settings.startInTray===true};
  const captured=motion.before(nextMotion);
  const focused=document.activeElement;
  const focusAttributes=focused&&root.contains(focused)?['data-action','data-setting','data-value','data-kind','name','value','id'].filter(key=>focused.hasAttribute(key)).map(key=>`[${key}="${CSS.escape(focused.getAttribute(key))}"]`).join(''):'';
  const focusSelector=focusAttributes?(focused.closest('.bottom-nav')?'.bottom-nav ':focused.closest('.side-nav')?'.side-nav ':'')+focusAttributes:'';
  root.dataset.platform=platform;
  root.dataset.layout=platform==='android'||platform==='preview'&&mobileMedia.matches?'mobile':'desktop';
  const theme=nextMotion.theme;
  document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;
  if(!root.querySelector('.shell'))root.innerHTML=`<div class="shell"><aside class="sidebar">${wordmark()}<div data-region="side-nav"></div><div class="side-foot" data-region="side-foot"></div></aside><div class="main"><header class="mobile-header">${wordmark()}</header><main data-region="content"></main><div data-region="bottom-nav"></div><footer data-region="footer"></footer></div></div><div data-region="modal"></div><div data-region="notice"></div>`;
  const region=(name,html)=>{const element=root.querySelector(`[data-region="${name}"]`);if(regions.get(element)!==html){element.innerHTML=html;regions.set(element,html);}};
  root.querySelector('.shell').inert=Boolean(overlay);
  region('side-nav',navigation(true));region('bottom-nav',navigation());
  region('side-foot',`<span>${state.profiles.length?'Доступы: '+state.profiles.length:'Нет доступа'}</span>`);
  region('content',view==='home'?home():view==='account'?accountView():view==='settings'?settings():view==='split'?splitView():help());
  region('footer',`<span>Zphone</span><span title="${escape(state.build||'')}">${state.version}</span>`);
  region('modal',modal());
  region('notice',message?`<div class="notice" role="alert"><span>${escape(message)}</span><button class="icon-button" type="button" data-action="dismiss" aria-label="Закрыть сообщение">${icon('x')}</button></div>`:'');
  createIcons({icons,root,attrs:{'stroke-width':1.7,width:20,height:20}});
  for(const input of root.querySelectorAll('.startup-settings input'))input.disabled=startupBusy||input.dataset.setting==='startWithWindows'&&!state.startup?.available;
  if(focusSelector&&!focused.isConnected)root.querySelector(focusSelector)?.focus({preventScroll:true});
  motion.after(nextMotion,captured);
}
function acceptState(value){diagnosticFlow.accept(value);state=value;if(firstSnapshot){firstSnapshot=false;if(!state.profiles.length&&state.account?.state!=='unconfigured')view='account';}}
async function call(command,data){try{const result=await request(command,data);if(result?.connection)acceptState(result);return result;}catch(error){message=error.message;return null;}finally{render();}}
let nextPicker='protocol',waitingPicker=false;
root.addEventListener('click',async event=>{
  const control=event.target.closest('button[data-action]');if(!control||control.disabled)return;
  const action=control.dataset.action,value=control.dataset.value;
  if(action==='nav'){view=value;overlay=null;message='';render();window.scrollTo(0,0);return;}
  if(action==='showUpdates'){view='settings';overlay=null;message='';render();root.querySelector('.updates')?.scrollIntoView({block:'start'});return;}
  if(action==='dismiss'){message='';render();return;}
  if(action==='closeModal'){if(overlay==='issue'&&issue.busy)return;overlay=null;render();return;}
  if(action==='details'){overlay='details';render();root.querySelector('[data-action="closeModal"]')?.focus();return;}
  if(action==='picker'){nextPicker=value;overlay=active()?'switch':value;render();root.querySelector('[data-action="closeModal"]')?.focus();return;}
  if(action==='confirmSwitch'){overlay=null;waitingPicker=true;await call('disconnect');if(!active()){waitingPicker=false;overlay=nextPicker;}render();return;}
  if(action==='select'){overlay=null;await call('settings',{[control.dataset.kind]:value});return;}
  if(action==='theme'){await call('settings',{theme:value});return;}
  if(action==='split'){splitDraft=structuredClone(state.settings.split||{mode:'all',apps:[]});appQuery='';view='split';await loadApps();return;}
  if(action==='splitBack'){view='settings';render();return;}
  if(action==='refreshApps'){await loadApps();return;}
  if(action==='pickApp'){try{const result=await request('pickApp');if(result.app){apps.push(result.app);if(!splitDraft.apps.some(app=>app.id.toLowerCase()===result.app.id.toLowerCase()))splitDraft.apps.push(result.app);}}catch(error){message=error.message;}render();return;}
  if(action==='saveSplit'){
    if(splitDraft.mode==='include'&&!splitDraft.apps.length){message='Выберите хотя бы одно приложение для VPN.';render();return;}
    if(await call('settings',{split:splitDraft})){view='settings';render();}return;
  }
  if(action==='power'){
    if(!active()&&!state.profiles.length){view='account';render();return;}
    pending=true;render();await call(active()?'disconnect':'connect');pending=false;render();return;
  }
  if(action==='updates'){updateBusy=true;render();try{update=await request('checkUpdates');}catch(error){update={state:'error',message:error.message};}state.updates=update;updateBusy=false;render();return;}
  if(['downloadUpdate','installUpdate'].includes(action)){if(updateBusy)return;updateBusy=true;render();try{const result=await call(action);if(result?.state)state.updates=result;}finally{updateBusy=false;render();}return;}
  if(['accountBegin','accountOpenBot','accountPoll','accountProfiles','accountLogout'].includes(action)){
    if(accountBusy)return;accountBusy=true;accountMessage='';message='';render();
    try{acceptState(await request(action));if(action==='accountProfiles'){view='home';window.scrollTo(0,0);}}
    catch(error){accountMessage=error.message;}
    finally{accountBusy=false;render();}return;
  }
  if(action==='diagnose'){const flight=diagnosticFlow.run();render();await flight;render();return;}
  if(action==='markIssue'){if(issue.busy)return;overlay='issue';message='';render();root.querySelector('[data-action="closeModal"]')?.focus();return;}
  if(action==='sendIssue'){
    if(overlay!=='issue'||issue.busy||state.account?.state!=='authorized')return;
    const flight=issue.send();render();const result=await flight;
    if(result){overlay=null;message=REPORT_ACCEPTED;}render();return;
  }
  if(['import','testPage','openLogs','openSupport','notificationSettings'].includes(action))await call(action);
});
root.addEventListener('change',async event=>{
  const target=event.target;
  if(['autoCheckUpdates','autoDownloadUpdates','updateWifiOnly'].includes(target.dataset.setting)){target.disabled=true;await call('settings',{[target.dataset.setting]:target.checked});return;}
  if(['startWithWindows','startInTray'].includes(target.dataset.setting)){
    const key=target.dataset.setting,value=target.checked;startupBusy=true;render();
    try{await call('settings',{[key]:value});}finally{startupBusy=false;render();}return;
  }
  if(target.dataset.setting==='mode')call('settings',{mode:target.value});
  if(target.dataset.setting==='splitMode'){splitDraft.mode=target.value;render();}
  if(target.dataset.app){
    const id=target.dataset.app,app=[...apps,...splitDraft.apps].find(item=>item.id===id);
    splitDraft.apps=splitDraft.apps.filter(item=>item.id!==id);if(target.checked&&app)splitDraft.apps.push(app);
    root.querySelector('.split-count').textContent='Выбрано: '+splitDraft.apps.length;
  }
});
root.addEventListener('input',event=>{if(event.target.id==='app-search'){appQuery=event.target.value;root.querySelector('.app-results').innerHTML=appRows();}});
root.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&overlay&&!(overlay==='issue'&&issue.busy)){overlay=null;render();}
  if(event.key==='Tab'&&overlay){const items=[...root.querySelectorAll('.sheet button:not(:disabled)')],first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
subscribe(value=>{acceptState(value);if(waitingPicker&&!active()){waitingPicker=false;overlay=nextPicker;}render();});
themeMedia.addEventListener('change',()=>{if(state.settings.theme==='system')render();});
mobileMedia.addEventListener('change',()=>{if(platform==='preview')render();});
render();
call('snapshot');
