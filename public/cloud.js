import {discardRecordingCopies} from '/browser-cache.js';
import {getPreferences} from '/preferences.js';
import {uploadRecording} from '/uploads.js';
import {readWorkspaceSession} from '/availability.js';
const $=id=>document.getElementById(id);
const fresh=()=>({key:crypto.randomUUID(),id:null,blob:undefined,upload:null,queue:Promise.resolve(),revision:null});
let workspace=fresh(),dirty=false,changeVersion=0,autosaveTimer,snapshotProvider;
const activeJobs=new Set();
let historyVersion=0;
function checkOperation(context,signal){
 signal?.throwIfAborted();
 if(context.removed||context!==workspace)throw Error('The recording changed or was removed. Processing stopped.');
}
let storageUnavailable=false;
const ready=readWorkspaceSession().then(session=>{storageUnavailable=session.storage===false&&session.code==='HOSTED_STORAGE_NOT_CONFIGURED';return session});
function sessionGet(key){try{return sessionStorage.getItem(key)}catch{return null}}
function sessionSet(key,value){try{sessionStorage.setItem(key,value)}catch{}}
function sessionRemove(key){try{sessionStorage.removeItem(key)}catch{}}
let creatorCode=sessionGet('studio-creator-code')||'';
export function progress(message,kind='working'){const el=$('processProgress');if(el){el.textContent=message;el.dataset.kind=kind;el.classList.remove('hidden')}}
export async function api(path,options={}){const session=await ready;if(session.storage===false&&session.code==='HOSTED_STORAGE_NOT_CONFIGURED')throw Error('Online storage is not connected. Open the local edition to record, process and save.');const response=await fetch(path,{...options,headers:{...(creatorCode?{'x-studio-code':creatorCode}:{}),...options.headers}});const data=await response.json();if(!response.ok){const error=Error(data.error||'The request did not complete.');error.status=response.status;throw error}return data}
export function recordingContext(){return workspace}
export function recordingIdentity(){return {id:workspace.id,key:workspace.key,revision:workspace.revision}}
export function hasPendingLocalJob(){try{const job=JSON.parse(sessionGet('studio-active-job')||'null');return Boolean(job&&job.recordId===workspace.id&&job.key===workspace.key)}catch{return false;}}
export async function ensureRecording(blob,kind,filename,context=workspace){
 if(context.removed)throw Error('This recording was removed.');
 if(context.id&&context.blob===blob)return context.id;
 if(context.upload)return context.upload;
 progress(blob?'Uploading your recording…':'Saving your walkthrough…');
 context.upload=(async()=>{const data=await uploadRecording(blob,kind,filename,context.key,api);if(blob&&(!data.mime||data.size!==blob.size||data.mime!==blob.type.split(';')[0]))throw Error('The saved recording identity did not accept this video or audio. Your browser copy is kept; download it before closing this page.');context.blob=blob;context.id=data.id;context.revision=data.revision??1;if(context===workspace){$('openResultBtn').href='/r/'+data.id;window.dispatchEvent(new Event('recording-saved'));progress('Recording saved.','done')}return data.id})();
 try{return await context.upload}finally{context.upload=null}
}
export function resetRecording(){clearTimeout(autosaveTimer);workspace=fresh();dirty=false}
export function adoptRecording(id,blob,revision=null,key=null){workspace=fresh();workspace.id=id;workspace.blob=blob;workspace.revision=revision;if(key)workspace.key=key;$('openResultBtn').href='/r/'+id}
export function restoreIdentity(identity,blob){if(identity?.id)adoptRecording(identity.id,blob,identity.revision,identity.key);else if(identity?.key){workspace=fresh();workspace.key=identity.key}}
export async function saveProcess(state,transcript,reviewed){
 if(state.starting||['recording','paused'].includes(state.recorder?.state)||state.finalizing&&(!state.blob||!workspace.id||workspace.blob!==state.blob))throw Error('Stop recording and wait for its video to save before saving or processing this walkthrough.');
 const context=workspace,version=changeVersion,snapshot=JSON.parse(JSON.stringify({transcript,transcriptSource:state.transcriptSource,reviewed,result:state.result,method:state.method,segments:state.segments}));const blob=state.blob,kind=state.recordingKind,name=state.fileName;
 const save=async()=>{const id=await ensureRecording(blob,kind,name,context);const data=await api('/api/recordings/'+id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...snapshot,...(context.revision?{expectedRevision:context.revision}:{})})});context.revision=data.revision??context.revision;if(context===workspace&&version===changeVersion){dirty=false;progress('All changes saved.','done');window.dispatchEvent(new Event('recording-saved'))}return id};
 const pending=context.queue.then(save,save);context.queue=pending.catch(()=>{});return pending;
}
export function queueAutosave(){changeVersion++;dirty=true;clearTimeout(autosaveTimer);if(storageUnavailable){progress('Online saving is unavailable. Export your current text and process to keep a copy.','done');return;}progress('Changes saved in this browser. Saving to your workspace…');autosaveTimer=setTimeout(async()=>{if(!snapshotProvider)return;const snapshot=snapshotProvider();if(snapshot.state.recorder&&['recording','paused'].includes(snapshot.state.recorder.state))return;try{await saveProcess(snapshot.state,snapshot.transcript,snapshot.reviewed)}catch(error){dirty=true;progress((snapshot.state.browserCacheUnavailable?'Workspace save failed and browser recovery storage is unavailable. Keep this tab open and export the current text and process. ':'Workspace save failed. Your browser draft is retained. ')+'Use Save changes to retry. '+error.message,'error')}},900)}
async function localJob(stage,input,body,context,signal,processSnapshot=null){
 checkOperation(context,signal);
 const previousTranscript=$('transcript').value,jobKey=context.key+':'+stage+':'+await fingerprint(input);
 checkOperation(context,signal);
 const registration=api('/api/local/jobs',{method:'POST',headers:{'content-type':stage==='transcribe'?'audio/wav':'application/json','x-job-key':jobKey,'x-job-stage':stage,'x-recording-id':context.id,'x-recording-key':context.key},body});
 let stopPromise,job,stopped=false;
 const handle={context,stop:()=>stopPromise||=(registration.then(saved=>api('/api/local/jobs/'+saved.id,{method:'DELETE'})).then(result=>{if(!['cancelled','failed','complete'].includes(result.status))throw Error('Cancellation is not confirmed. Retry cancellation.');stopped=true;return result;}).catch(error=>{if(error.status===404||error.status===410){stopped=true;return {status:'cancelled'};}error.cancellationUnconfirmed=true;throw error;}))};
 activeJobs.add(handle);
 const abort=()=>{handle.stop().catch(()=>{})};signal?.addEventListener('abort',abort,{once:true});
 try{
  job=await registration;
  if(context===workspace&&!context.removed)sessionSet('studio-active-job',JSON.stringify({id:job.id,recordId:context.id,key:context.key,stage,input,previousTranscript,processSnapshot}));
  checkOperation(context,signal);
  while(['queued','running','cancelling'].includes(job.status)){
   await new Promise(resolve=>setTimeout(resolve,1200));checkOperation(context,signal);
   job=await api('/api/local/jobs/'+job.id);checkOperation(context,signal);
   progress(stage==='transcribe'?'Transcribing locally. You can return to this saved job.':'Creating the process locally. You can return to this saved job.');
  }
  if(job.status!=='complete')throw Error(job.error||'Processing stopped. Retry this stage.');return job.result;
 }catch(error){
  if(signal?.aborted||context.removed||context!==workspace)await handle.stop();
  throw error;
 }finally{
  signal?.removeEventListener('abort',abort);activeJobs.delete(handle);
  let saved;try{saved=JSON.parse(sessionGet('studio-active-job')||'null')}catch{}
  if(saved?.id===job?.id&&(stopped||['complete','failed','cancelled'].includes(job?.status)))sessionRemove('studio-active-job');
 }
}
async function fingerprint(input){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('').slice(0,24)}
export async function cancelLocalJob(context=workspace){const active=[...activeJobs].filter(job=>job.context===context);if(active.length)await Promise.all(active.map(job=>job.stop()));else{let job;try{job=JSON.parse(sessionGet('studio-active-job')||'null')}catch{}if(job?.key===context.key&&job.recordId===context.id){const result=await api('/api/local/jobs/'+job.id,{method:'DELETE'});if(!['cancelled','failed','complete'].includes(result.status))throw Error('Cancellation is not confirmed. Retry cancellation.');sessionRemove('studio-active-job');}}if(getPreferences().aiMode==='chatgpt')await api('/api/chatgpt/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});progress('Cancellation requested. Your last saved source is retained.','done')}
export async function resumeLocalJob({signal}={}){
 let saved;try{saved=JSON.parse(sessionGet('studio-active-job')||'null')}catch{sessionRemove('studio-active-job');return null;}
 const context=workspace;
 if(!saved||saved.key!==context.key||saved.recordId!==context.id)return null;
 checkOperation(context,signal);
 window.dispatchEvent(new CustomEvent('processing-resumed',{detail:{stage:saved.stage}}));
 try{
  let job=await api('/api/local/jobs/'+encodeURIComponent(saved.id),{signal});checkOperation(context,signal);
  const verify=()=>{if(job.recordId!==context.id||job.recordKey!==context.key||job.stage!==saved.stage){sessionRemove('studio-active-job');throw Error('This saved job does not match the recording. Retry unfinished processing.');}};
  verify();
  while(['queued','running','cancelling'].includes(job.status)){progress('Reconnecting to your saved processing job…');await new Promise(resolve=>setTimeout(resolve,1200));checkOperation(context,signal);job=await api('/api/local/jobs/'+encodeURIComponent(saved.id),{signal});checkOperation(context,signal);verify();}
  sessionRemove('studio-active-job');return {...saved,...job};
 }catch(error){if(error.status===404||error.status===410){sessionRemove('studio-active-job');throw Error('The saved processing job is no longer available. Your source is kept. Retry unfinished processing.');}throw error;}
}
export async function transcribeSaved(blob,kind,name,wav,{context=workspace,signal}={}){checkOperation(context,signal);const id=await ensureRecording(blob,kind,name,context);checkOperation(context,signal);if(getPreferences().aiMode!=='hosted')return localJob('transcribe',context.key,wav,context,signal);const result=await api('/api/recordings/'+id+'/transcribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationKey:context.key+'-transcribe-'+context.revision}),signal});checkOperation(context,signal);context.revision=result.revision??context.revision;return result}
export async function analyzeSaved(state,transcript){
 const mode=getPreferences().aiMode,consent=$('chatgptOnlineConsent')?.checked===true;
 if(mode==='chatgpt'&&!consent)throw Error('Open Settings and allow sending the transcript to OpenAI, or select Local Qwen.');
 const context=workspace,signal=state.processingAbort?.signal;checkOperation(context,signal);const id=await ensureRecording(state.blob,state.recordingKind,state.fileName,context);checkOperation(context,signal);await context.queue;checkOperation(context,signal);clearTimeout(autosaveTimer);await saveProcess(state,transcript,snapshotProvider?.().reviewed||false);checkOperation(context,signal);
 progress(mode==='local'?'Creating the process with local Qwen.':mode==='chatgpt'?'Creating the process with your ChatGPT plan.':'Creating the process with the OpenAI API.');
 if(mode==='local')return localJob('analyze',transcript,JSON.stringify({transcript}),context,signal,state.generationCheckpoint??null);
 if(mode==='chatgpt'){const data=await api('/api/chatgpt/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transcript,consent}),signal});checkOperation(context,signal);return data;}
 const operationKey=context.key+'-'+context.revision+'-'+await fingerprint(transcript);checkOperation(context,signal);
 const data=await api('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,transcript,operationKey}),signal});checkOperation(context,signal);const saved=await api('/api/recordings/'+id);context.revision=saved.revision;return data;
}
export async function refreshHistory(){
 const version=++historyVersion;
 try{
  const session=await ready;if(session.storage===false&&session.code==='HOSTED_STORAGE_NOT_CONFIGURED'){if(version!==historyVersion)return;const empty=document.createElement('p');empty.id='libraryEmpty';empty.className='library-empty';empty.textContent='Online recording storage is not connected yet. Your recordings remain in the local edition.';$('recentRecordings').replaceChildren(empty);return;}
  let data={items:[]},cursor;
  do{const page=await api('/api/recordings?includeDeleted=true'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(version!==historyVersion)return;data.items.push(...page.items);cursor=page.cursor||page.nextCursor}while(cursor);
  try{const deleted=await api('/api/workspace/deletions');if(version!==historyVersion)return;for(const item of deleted.records||deleted.ids?.map(id=>({id}))||[]){await discardRecordingCopies(item.id,{workspaceHash:deleted.workspaceHash,cacheKeys:[...(item.cacheKeys||[]),...(workspace.id===item.id?[workspace.key]:[])]});if(version!==historyVersion)return;window.dispatchEvent(new CustomEvent('recording-deleted',{detail:{id:item.id,synced:true}}));}}catch(error){if(version===historyVersion)progress('Browser copy cleanup needs retry: '+error.message,'error')}
  if(version!==historyVersion)return;
  const host=$('recentRecordings');host.replaceChildren();
  for(const item of data.items){
   const row=document.createElement('div');row.className='recent-item'+(item.deletedAt?' is-deleted':'');
   row.dataset.search=item.title||item.filename||'Saved walkthrough';
   const link=document.createElement('a');link.href='/r/'+item.id;
   const cover=document.createElement('div');cover.className='library-cover';cover.setAttribute('aria-hidden','true');
   const written=['notes','sample'].includes(item.kind),audio=item.kind==='audio';
   // Abstract media icons are placeholders, not fabricated thumbnails of a recording.
   cover.innerHTML='<svg viewBox="0 0 48 48">'+(written?'<rect x="12" y="6" width="24" height="36" rx="4"/><path d="M18 16h12m-12 8h12m-12 8h8"/>':audio?'<path d="M10 19v10m7-16v22m7-28v34m7-28v22m7-16v10"/>':'<rect x="5" y="9" width="38" height="30" rx="5"/><path d="m20 17 11 7-11 7z"/>')+'</svg>';
   const kind=document.createElement('span');kind.className='library-kind';kind.textContent=written?'Written walkthrough':audio?'Audio walkthrough':'Recording';cover.append(kind);
   const title=document.createElement('span');title.className='library-title';title.textContent=item.title||item.filename||'Saved walkthrough';
   const meta=document.createElement('span');meta.className='library-meta';
   const date=new Date(item.createdAt);const dateLabel=Number.isNaN(date.getTime())?'Saved':date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
   meta.textContent=dateLabel+' · '+(item.deletedAt?'In trash':item.hasResult?'Process ready':'Source saved');link.append(cover,title,meta);
   const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=item.deletedAt?'Restore':'Move to trash';
   if(item.corrupted){title.textContent='Damaged recording';meta.textContent=item.recoverable?'Previous saved version available':'Download the damaged data before removing it';button.textContent='Restore previous version';button.disabled=!item.recoverable;button.addEventListener('click',async()=>{try{await api('/api/recordings/'+item.id+'/recover',{method:'POST'});await refreshHistory()}catch(error){progress(error.message,'error')}});link.href='/api/recordings/'+item.id+'/damaged';link.download='damaged-recording.json';const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Delete damaged recording';remove.addEventListener('click',async()=>{if(!window.confirm('Download the damaged data first if you need it. Permanently remove this damaged recording and its app-managed copies? Downloaded backups remain. This cannot be undone.'))return;try{await api('/api/recordings/'+item.id+'/damaged',{method:'DELETE'});await refreshHistory()}catch(error){progress(error.message,'error')}});row.append(link,button,remove);host.append(row);continue;}
   button.addEventListener('click',async()=>{try{await api('/api/recordings/'+item.id+(item.deletedAt?'/restore':''),{method:item.deletedAt?'POST':'DELETE'});await refreshHistory()}catch(error){progress(error.message,'error')}});row.append(link,button);
   if(item.deletedAt){const purge=document.createElement('button');purge.type='button';purge.className='text-button';purge.textContent='Delete permanently';purge.addEventListener('click',async()=>{if(!window.confirm('Permanently delete this walkthrough and its recording? This also removes app-managed cached copies and revokes known online links. Downloaded exports and backups remain. This cannot be undone.'))return;try{const saved=await api('/api/recordings/'+item.id+'?includeDeleted=true');await api('/api/recordings/'+item.id+'/purge',{method:'DELETE'});try{await discardRecordingCopies(item.id,{transcript:saved.transcript,cacheKeys:[saved.cacheKey,...(workspace.id===item.id?[workspace.key]:[])]});window.dispatchEvent(new CustomEvent('recording-deleted',{detail:{id:item.id}}));}catch(error){progress('Workspace copy deleted. Browser cleanup needs retry: '+error.message,'error');}await refreshHistory()}catch(error){progress(error.message,'error')}});row.append(purge)}host.append(row);
  }
  const empty=document.createElement('p');empty.id='libraryEmpty';empty.className='library-empty'+(data.items.length?' hidden':'');empty.textContent='Your walkthroughs will appear here. Record or upload your first one above.';host.append(empty);
  $('historySection').classList.remove('hidden');
 }catch(error){if(version===historyVersion)progress(error.message,'error')}
}
export function setupCloud(getSnapshot){snapshotProvider=getSnapshot;window.addEventListener('recording-saved',()=>refreshHistory());window.addEventListener('studio-page-changed',event=>{if(event.detail.page==='library')refreshHistory()});window.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshHistory()});const deletionChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('process-studio-deletions'):null;deletionChannel?.addEventListener('message',()=>refreshHistory());window.addEventListener('recording-deleted',event=>{if(!event.detail.synced)deletionChannel?.postMessage({id:event.detail.id})});$('creatorCode').value=creatorCode;$('creatorCode').addEventListener('change',event=>{creatorCode=event.target.value.trim();sessionSet('studio-creator-code',creatorCode)});for(const id of ['saveCloudBtn','openResultBtn'])$(id).addEventListener('click',async event=>{event.preventDefault();try{const snapshot=getSnapshot();const recordId=await saveProcess(snapshot.state,snapshot.transcript,snapshot.reviewed);await refreshHistory();if(id==='openResultBtn')location.href='/r/'+recordId}catch(error){dirty=true;progress(error.message,'error')}});window.addEventListener('beforeunload',event=>{const {state}=getSnapshot();if(dirty||workspace.upload||state.transcribing||state.analyzing||['recording','paused'].includes(state.recorder?.state)){event.preventDefault();event.returnValue=''}});refreshHistory()}
