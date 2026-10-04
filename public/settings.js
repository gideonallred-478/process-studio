import {getPreferences,savePreferences} from '/preferences.js';
import {navigate} from '/navigation.js';
import {setupChatGPTSettings,showChatGPTStatus} from '/chatgpt-settings.js';
import {setupSharingSettings} from '/sharing-ui.js';
const $=id=>document.getElementById(id);
export function setupSettings({refreshStatus,isBusy}) {
  setupSharingSettings();
  setupChatGPTSettings({refreshStatus,isBusy});
  const themeChoice=$('themeChoice');themeChoice.value=window.studioTheme.get();
  themeChoice.addEventListener('change',()=>{window.studioTheme.set(themeChoice.value);$('settingsNotice').textContent='Appearance saved for this browser.';});
  window.addEventListener('studio-theme-changed',()=>{themeChoice.value=window.studioTheme.get();});
  function openSettings(){navigate('settings');refreshStatus()}
  $('quickSettings').addEventListener('click',openSettings);
  $('navSettings').addEventListener('click',refreshStatus);
  $('settingsBack').addEventListener('click',()=>navigate('studio'));
  const applyExample=()=>{$('exampleCard').classList.toggle('hidden',!getPreferences().showExample);$('studioPanel').classList.toggle('with-example',getPreferences().showExample)};
  $('showExample').checked=getPreferences().showExample;applyExample();
  $('showExample').addEventListener('change',()=>{savePreferences({showExample:$('showExample').checked});applyExample();$('settingsNotice').textContent=$('showExample').checked?'Example shown in Studio.':'Example hidden from Studio.'});
  $('settingsExample').addEventListener('click',()=>{if(isBusy()){ $('settingsNotice').textContent='Finish recording or processing before opening the example.';return; }$('exampleBtn').click()});
  $('aiMode').value=getPreferences().aiMode;$('spaceAware').checked=getPreferences().spaceAware;
  $('aiMode').addEventListener('change',async()=>{if(isBusy()){ $('aiMode').value=getPreferences().aiMode;$('settingsNotice').textContent='Finish recording or processing before changing AI engines.';return; }savePreferences({aiMode:$('aiMode').value});$('settingsNotice').textContent='AI choice saved for this browser. It applies to the next process.';await refreshStatus();});
  $('spaceAware').addEventListener('change',()=>{savePreferences({spaceAware:$('spaceAware').checked});$('settingsNotice').textContent=$('spaceAware').checked?'Space-aware movement on. The camera can move nearby to avoid busy content.':'Space-aware movement off. The camera stays at your chosen position; dragging still works.';});
  $('refreshEngines').addEventListener('click',refreshStatus);
}
export function showEngineStatus({local,hosted,chatgpt}){
 showChatGPTStatus(chatgpt);
 $('localEngineStatus').textContent=local?.ai?`Ready · ${local.model||'Local model'} · ${local.localSpeech?'transcription ready':'transcription unavailable'}`:local?.available?`Local model ${local.modelState||'not ready'}. ${local.error||''}`:'Unavailable here. On localhost, start the installed local edition on port 4173.';
 $('hostedEngineStatus').textContent=hosted?.edition==='hosted'?'Processing runs in the local edition. Choose Local Qwen, your own ChatGPT connection, or your own API key there.':hosted?.ai?'Configured. Creator access code required.':'Not configured. Add the server API key and creator code to use hosted AI.';
 $('hostedAccess').classList.toggle('hidden',hosted?.edition==='hosted'||getPreferences().aiMode!=='hosted');
}
