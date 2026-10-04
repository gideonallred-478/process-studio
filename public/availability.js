export async function readWorkspaceSession(fetchImpl=fetch){
 const response=await fetchImpl('/api/session');
 const data=await response.json().catch(()=>null);
 if(!response.ok&&data?.code==='HOSTED_STORAGE_NOT_CONFIGURED'&&data.storage===false)return data;
 if(!response.ok||!data)throw Error(data?.error||'Workspace could not open. Check your connection and retry.');
 return data;
}
let hosted=false,preview=false;
export const isHostedPreview=()=>preview;
export function applyHostedState(status){
 if(status?.edition!=='hosted')return;
 hosted=true;preview=status.storage===false&&status.code==='HOSTED_STORAGE_NOT_CONFIGURED';
 document.body.dataset.hostedPreview=String(preview);
 const notice=document.getElementById('hostedSetup');notice?.classList.toggle('hidden',!preview);
 if(preview){
  const empty=document.getElementById('libraryEmpty');if(empty)empty.textContent='Online recording storage is not connected yet. Your recordings remain in the local edition.';
  const label=document.querySelector('.workspace-label');if(label)label.textContent='Example preview';
  const footer=document.querySelector('.paste-footer > span');if(footer)footer.textContent='Creating and saving your own process runs in the local edition.';
 }
 applyHostedControls();
}
export function applyHostedControls(){
 const ids=hosted?['generateBtn','transcribeBtn','retryProcessing','sampleAudioBtn','aiMode','chatgptConnect','chatgptRefreshModels','chatgptAccount']:[];
 if(preview)ids.push('recordBtn','cameraOnlyBtn','importBtn','importFile','pasteBtn','saveCloudBtn','openResultBtn','backupWorkspace','restoreBackup','backupFile','downloadRecovery');
 for(const id of ids){const el=document.getElementById(id);if(!el)continue;el.disabled=true;el.setAttribute('aria-disabled','true');el.title=preview?'Open the local edition to record, process and save. Online storage is not connected.':'AI processing runs in the local edition.';}
 if(hosted){const hint=document.getElementById('generateHint');if(hint)hint.textContent='AI processing runs in the local edition. You can explore and export this prepared example here.';}
}
