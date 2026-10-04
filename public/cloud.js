import {discardRecordingCopies} from '/browser-cache.js';
import {getPreferences} from '/preferences.js';
import {uploadRecording} from '/uploads.js';
const $=id=>document.getElementById(id);
const fresh=()=>({key:crypto.randomUUID(),id:null,blob:undefined,upload:null,queue:Promise.resolve(),revision:null});
let workspace=fresh(),dirty=false,changeVersion=0,autosaveTimer,snapshotProvider;
const ready=fetch('/api/session').then(r=>{if(!r.ok)throw Error('Workspace could not open.');return r.json()});
function sessionGet(key){try{return sessionStorage.getItem(key)}catch{return null}}
function sessionSet(key,value){try{sessionStorage.setItem(key,value)}catch{}}
function sessionRemove(key){try{sessionStorage.removeItem(key)}catch{}}
let creatorCode=sessionGet('studio-creator-code')||'';
export function progress(message,kind='working'){const el=$('processProgress');if(el){el.textContent=message;el.dataset.kind=kind;el.classList.remove('hidden')}}
export async function api(path,options={}){await ready;const response=await fetch(path,{...options,headers:{...(creatorCode?{'x-studio-code':creatorCode}:{}),...options.headers}});const data=await response.json();if(!response.ok){const error=Error(data.error||'The request did not complete.');error.status=response.status;throw error}return data}
export function recordingContext(){return workspace}
export function recordingIdentity(){return {id:workspace.id,key:workspace.key,revision:workspace.revision}}
export async function ensureRecording(blob,kind,filename,context=workspace){
 if(context.id&&context.blob===blob)return context.id;
 if(context.upload)return context.upload;
 context.blob=blob;progress(blob?'Uploading your recording…':'Saving your walkthrough…');
 context.upload=(async()=>{const data=await uploadRecording(blob,kind,filename,context.key,api);context.id=data.id;context.revision=data.revision??1;if(context===workspace){$('openResultBtn').href='/r/'+data.id;window.dispatchEvent(new Event('recording-saved'));progress('Recording saved.','done')}return data.id})();
 try{return await context.upload}finally{context.upload=null}
}
export function resetRecording(){clearTimeout(autosaveTimer);workspace=fresh();dirty=false}
export function adoptRecording(id,blob,revision=null,key=null){workspace=fresh();workspace.id=id;workspace.blob=blob;workspace.revision=revision;if(key)workspace.key=key;$('openResultBtn').href='/r/'+id}
export function restoreIdentity(identity,blob){if(identity?.id)adoptRecording(identity.id,blob,identity.revision,identity.key);else if(identity?.key){workspace=fresh();workspace.key=identity.key}}
export async function saveProcess(state,transcript,reviewed){
 const context=workspace,version=changeVersion,snapshot=JSON.parse(JSON.stringify({transcript,transcriptSource:state.transcriptSource,reviewed,result:state.result,method:state.method,segments:state.segments}));const blob=state.blob,kind=state.recordingKind,name=state.fileName;
 const save=async()=>{const id=await ensureRecording(blob,kind,name,context);const data=await api('/api/recordings/'+id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...snapshot,...(context.revision?{expectedRevision:context.revision}:{})})});context.revision=data.revision??context.revision;if(context===workspace&&version===changeVersion){dirty=false;progress('All changes saved.','done');window.dispatchEvent(new Event('recording-saved'))}return id};
 const pending=context.queue.then(save,save);context.queue=pending.catch(()=>{});return pending;
}
export function queueAutosave(){changeVersion++;dirty=true;clearTimeout(autosaveTimer);progress('Changes saved in this browser. Saving to your workspace…');autosaveTimer=setTimeout(async()=>{if(!snapshotProvider)return;const snapshot=snapshotProvider();if(snapshot.state.recorder&&['recording','paused'].includes(snapshot.state.recorder.state))return;try{await saveProcess(snapshot.state,snapshot.transcript,snapshot.reviewed)}catch(error){dirty=true;progress((snapshot.state.browserCacheUnavailable?'Workspace save failed and browser recovery storage is unavailable. Keep this tab open and export the current text and process. ':'Workspace save failed. Your browser draft is retained. ')+'Use Save changes to retry. '+error.message,'error')}},900)}
async function localJob(stage,input,body,context){
 const identity={key:context.key};if(context!==workspace)throw Error('The recording changed. Your previous work remains saved.');const previousTranscript=$('transcript').value;const jobKey=identity.key+':'+stage+':'+await fingerprint(input);
 let job=await api('/api/local/jobs',{method:'POST',headers:{'content-type':stage==='transcribe'?'audio/wav':'application/json','x-job-key':jobKey,'x-job-stage':stage,'x-recording-id':context.id,'x-recording-key':context.key},body});
 sessionSet('studio-active-job',JSON.stringify({id:job.id,recordId:context.id,key:identity.key,stage,input,previousTranscript}));
 while(['queued','running','cancelling'].includes(job.status)){await new Promise(resolve=>setTimeout(resolve,1200));job=await api('/api/local/jobs/'+job.id);progress(stage==='transcribe'?'Transcribing locally. You can return to this saved job.':'Creating the process locally. You can return to this saved job.')}
 sessionRemove('studio-active-job');if(job.status!=='complete')throw Error(job.error||'Processing stopped. Retry this stage.');return job.result;
}
async function fingerprint(input){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('').slice(0,24)}
export async function cancelLocalJob(){const job=JSON.parse(sessionGet('studio-active-job')||'null');if(job)await api('/api/local/jobs/'+job.id,{method:'DELETE'});if(getPreferences().aiMode==='chatgpt')await api('/api/chatgpt/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});progress('Cancellation requested. Your last saved source is retained.','done')}
export async function resumeLocalJob(){const saved=JSON.parse(sessionGet('studio-active-job')||'null');if(!saved||saved.key!==workspace.key)return null;let job=await api('/api/local/jobs/'+saved.id);while(['queued','running','cancelling'].includes(job.status)){progress('Reconnecting to your saved processing job…');await new Promise(resolve=>setTimeout(resolve,1200));job=await api('/api/local/jobs/'+saved.id)}sessionRemove('studio-active-job');return {...saved,...job}}
export async function transcribeSaved(blob,kind,name,wav){const context=workspace,id=await ensureRecording(blob,kind,name,context);if(getPreferences().aiMode!=='hosted'){const data=await localJob('transcribe',context.key,wav,context);return data}const result=await api('/api/recordings/'+id+'/transcribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationKey:context.key+'-transcribe-'+context.revision})});context.revision=result.revision??context.revision;return result}
export async function analyzeSaved(state,transcript){
 const mode=getPreferences().aiMode,consent=$('chatgptOnlineConsent')?.checked===true;
 if(mode==='chatgpt'&&!consent)throw Error('Open Settings and allow sending the transcript to OpenAI, or select Local Qwen.');
 const context=workspace,id=await ensureRecording(state.blob,state.recordingKind,state.fileName,context);await context.queue;clearTimeout(autosaveTimer);await saveProcess(state,transcript,snapshotProvider?.().reviewed||false);
 progress(mode==='local'?'Creating the process with local Qwen.':mode==='chatgpt'?'Creating the process with your ChatGPT plan.':'Creating the process with the OpenAI API.');
 if(mode==='local')return localJob('analyze',transcript,JSON.stringify({transcript}),context);
 if(mode==='chatgpt')return api('/api/chatgpt/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transcript,consent})});
 const data=await api('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,transcript,operationKey:context.key+'-'+context.revision+'-'+await fingerprint(transcript)})});if(context===workspace){const saved=await api('/api/recordings/'+id);context.revision=saved.revision}return data;
}
export async function refreshHistory(){
 try{
  let data={items:[]},cursor;
  do{const page=await api('/api/recordings?includeDeleted=true'+(cursor?'&cursor='+encodeURIComponent(cursor):''));data.items.push(...page.items);cursor=page.cursor||page.nextCursor}while(cursor);
  try{const deleted=await api('/api/workspace/deletions');for(const item of deleted.records||deleted.ids?.map(id=>({id}))||[]){await discardRecordingCopies(item.id,{cacheKeys:[...(item.cacheKeys||[]),...(workspace.id===item.id?[workspace.key]:[])]});window.dispatchEvent(new CustomEvent('recording-deleted',{detail:{id:item.id,synced:true}}));}}catch(error){progress('Browser copy cleanup needs retry: '+error.message,'error')}
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
 }catch(error){progress(error.message,'error')}
}
export function setupCloud(getSnapshot){snapshotProvider=getSnapshot;window.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshHistory()});const deletionChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('process-studio-deletions'):null;deletionChannel?.addEventListener('message',()=>refreshHistory());window.addEventListener('recording-deleted',event=>{if(!event.detail.synced)deletionChannel?.postMessage({id:event.detail.id})});$('creatorCode').value=creatorCode;$('creatorCode').addEventListener('change',event=>{creatorCode=event.target.value.trim();sessionSet('studio-creator-code',creatorCode)});for(const id of ['saveCloudBtn','openResultBtn'])$(id).addEventListener('click',async event=>{event.preventDefault();try{const snapshot=getSnapshot();const recordId=await saveProcess(snapshot.state,snapshot.transcript,snapshot.reviewed);await refreshHistory();if(id==='openResultBtn')location.href='/r/'+recordId}catch(error){dirty=true;progress(error.message,'error')}});window.addEventListener('beforeunload',event=>{const {state}=getSnapshot();if(dirty||workspace.upload||state.transcribing||state.analyzing||['recording','paused'].includes(state.recorder?.state)){event.preventDefault();event.returnValue=''}});refreshHistory()}
