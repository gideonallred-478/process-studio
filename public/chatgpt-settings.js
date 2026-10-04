import {api} from '/cloud.js';
import {getPreferences} from '/preferences.js';
const $=id=>document.getElementById(id);
const local=['127.0.0.1','localhost'].includes(location.hostname);
let pollTimer=null,modelAccount=null,refreshingModels=false,activeAccount=null;
export function showChatGPTStatus(status){
 activeAccount=status?.account?.id||null;
 $('chatgptPanel').classList.toggle('hidden',getPreferences().aiMode!=='chatgpt');
 $('chatgptConnect').disabled=!local;
 $('chatgptDisconnect').disabled=!status?.account?.connected||status?.pending;
 $('chatgptEngineStatus').textContent=!local?'Available in the local edition. Hosted subscription access needs separate eligibility.':status?.ai?'Connected · ChatGPT plan usage enabled':status?.error||'Not connected. Use Continue with ChatGPT with an eligible Plus or Pro plan.';
 $('chatgptNotice').textContent=status?.notice||'';
 $('chatgptPlanHint').classList.toggle('hidden',getPreferences().aiMode!=='chatgpt');
 if(status?.ai&&!status.account.welcomeAcknowledged&&!$('chatgptWelcome').open)$('chatgptWelcome').showModal();
 $('chatgptCancelSignIn').classList.toggle('hidden',!status?.pending);
 if(!status?.pending){$('chatgptSignInLink').classList.add('hidden');$('chatgptSignInLink').removeAttribute('href')}
 const select=$('chatgptAccount'),previous=select.value;select.replaceChildren();
 for(const account of status?.accounts||[]){const option=document.createElement('option');option.value=account.id;option.textContent=account.label+' · '+account.id.slice(-6)+(account.connected?'':' · reconnect');select.append(option)}
 const fresh=document.createElement('option');fresh.value='';fresh.textContent='Add a ChatGPT account';select.append(fresh);
 select.value=[...select.options].some(option=>option.value===previous)&&previous?previous:status?.account?.id||'';
 if(status?.ai&&modelAccount!==status.account.id&&!refreshingModels)void loadModels(status.account.id);
 if(!status?.ai){modelAccount=null;$('chatgptModel').replaceChildren();$('chatgptModel').disabled=true}
 if(status?.pending&&!pollTimer)pollTimer=setInterval(()=>window.dispatchEvent(new Event('studio-provider-refresh')),2500);
 if(!status?.pending&&pollTimer){clearInterval(pollTimer);pollTimer=null}
}
async function loadModels(accountId){
 refreshingModels=true;
 try{const data=await api('/api/chatgpt/models');if(activeAccount!==accountId||data.accountId!==accountId)return;const select=$('chatgptModel');select.replaceChildren();for(const model of data.models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;select.append(option)}select.value=data.selectedModel||data.models[0].id;select.disabled=false;modelAccount=accountId}
 catch(error){$('chatgptNotice').textContent=error.message;modelAccount=null}
 finally{refreshingModels=false}
}
export function setupChatGPTSettings({refreshStatus,isBusy}){
 const acknowledge=async()=>{try{await api('/api/chatgpt/welcome',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});$('chatgptWelcome').close()}catch(error){$('chatgptNotice').textContent=error.message}};
 $('chatgptWelcomeDone').addEventListener('click',acknowledge);$('chatgptWelcome').addEventListener('cancel',event=>{event.preventDefault();void acknowledge()});
 $('chatgptConnect').addEventListener('click',async()=>{
  if(isBusy()){$('chatgptNotice').textContent='Finish recording or processing before signing in.';return}
  const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;
  try{const data=await api('/api/chatgpt/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountId:$('chatgptAccount').value})});$('chatgptSignInLink').href=data.url;$('chatgptSignInLink').classList.remove('hidden');if(popup)popup.location.href=data.url;await refreshStatus()}
  catch(error){popup?.close();$('chatgptNotice').textContent=error.message}
 });
 $('chatgptCancelSignIn').addEventListener('click',async()=>{try{await api('/api/chatgpt/cancel-sign-in',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await refreshStatus()}catch(error){$('chatgptNotice').textContent=error.message}});
 $('chatgptDisconnect').addEventListener('click',async()=>{if(isBusy()){$('chatgptNotice').textContent='Finish processing before disconnecting.';return}try{await api('/api/chatgpt/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});$('chatgptOnlineConsent').checked=false;modelAccount=null;await refreshStatus()}catch(error){$('chatgptNotice').textContent=error.message}});
 $('chatgptModel').addEventListener('change',async()=>{if(isBusy()){$('chatgptNotice').textContent='Finish processing before changing models.';modelAccount=null;await refreshStatus();return}try{await api('/api/chatgpt/model',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:$('chatgptModel').value})});$('chatgptNotice').textContent='Model saved for this ChatGPT account.'}catch(error){$('chatgptNotice').textContent=error.message;modelAccount=null;await refreshStatus()}});
 $('chatgptRefreshModels').addEventListener('click',async()=>{modelAccount=null;await refreshStatus()});
 window.addEventListener('studio-provider-refresh',refreshStatus);
}
