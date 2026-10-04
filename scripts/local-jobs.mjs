import path from 'node:path';
import crypto from 'node:crypto';
import {locked} from '../worker/storage-controls.js';
import {createFileBucket} from './local-storage.mjs';
export function createLocalJobs(directory,fetchImpl=fetch,{loadRecord}={}){
 const root=path.resolve(directory),storage=createFileBucket(root),running=new Map();
 const owner=request=>crypto.createHash('sha256').update(request.headers.get('cookie')||'').digest('hex');
 const save=job=>storage.put(job.id+'.json',JSON.stringify(job)),read=async id=>{const value=await storage.get(id+'.json');return value?value.json():null};
 const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
 async function stop(job){
  const entry=running.get(job.id);if(!entry){if(job.status!=='complete'){job.status='cancelled';job.error='Processing stopped. Retry when ready.';await save(job)}return job}
  entry.cancelRequested=true;entry.job.status='cancelling';await save(entry.job);
  try{const response=await fetchImpl('http://127.0.0.1:4173/api/cancel',{method:'POST',headers:{origin:'http://127.0.0.1:4173','content-type':'application/json'},body:JSON.stringify({operationId:job.operationId||job.id}),redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||!(await response.json()).stopped)throw Error('Engine stop was not confirmed.');}
  catch{entry.job.error='The engine has not confirmed cancellation. Keep this recording and retry cancellation.';await save(entry.job);throw Object.assign(Error(entry.job.error),{status:503})}
  entry.controller.abort(Error('Processing cancelled.'));await entry.done;return read(job.id);
 }
 const handler=async request=>locked('local-jobs-'+root,async()=>{
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/local/jobs'))return null;
  if(!['localhost','127.0.0.1'].includes(url.hostname))return json({error:'Local access only.'},403);
  if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'Open this request from the studio.'},403);
  if(!request.headers.get('cookie'))return json({error:'Open your workspace first.'},401);
  const ownerId=owner(request);
  try{
   if(request.method==='POST'&&url.pathname==='/api/local/jobs'){
    const key=request.headers.get('x-job-key'),stage=request.headers.get('x-job-stage'),recordId=request.headers.get('x-recording-id');if(!key||key.length>256||!['analyze','transcribe'].includes(stage)||recordId&&!/^[a-f0-9]{32}$/.test(recordId))return json({error:'Invalid processing identity or stage.'},400);
    if(recordId&&loadRecord){const record=await loadRecord(recordId,request);if(record.deletedAt||record.purging)return json({error:'This recording was removed. Start a separate walkthrough.'},410);}
    const id=crypto.createHash('sha256').update(ownerId+key).digest('hex');let existing=await read(id).catch(()=>null);if(existing&&['running','queued','cancelling'].includes(existing.status)&&!running.has(id))existing=await read(id).catch(()=>null);
    if(existing&&existing.status==='complete')return json(existing);
    if(existing&&running.has(id))return json(await read(id));
    if(running.size)return json({error:'Another local processing stage is running. Finish or cancel it first.'},409);
    const max=stage==='transcribe'?25*1024*1024:250000,parts=[];let size=0;const reader=request.body?.getReader();if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return json({error:'Processing input is too large.'},413)}parts.push(value)}const body=Buffer.concat(parts);
    const job={id,operationId:id+'-'+crypto.randomBytes(12).toString('hex'),owner:ownerId,stage,recordId:recordId||null,recordKey:request.headers.get('x-recording-key')||null,status:'queued',createdAt:new Date().toISOString()};await save(job);
    const entry={controller:new AbortController(),job,cancelRequested:false,done:null};running.set(id,entry);
    entry.done=(async()=>{try{job.status='running';await save(job);entry.controller.signal.throwIfAborted();if(entry.cancelRequested)throw Error('Processing cancelled.');
     const response=await fetchImpl('http://127.0.0.1:4173/api/'+(stage==='analyze'?'analyze':'transcribe-local'),{method:'POST',headers:{origin:'http://127.0.0.1:4173','x-operation-id':job.operationId,'content-type':stage==='analyze'?'application/json':'audio/wav'},body,redirect:'error',signal:AbortSignal.any([entry.controller.signal,AbortSignal.timeout(390000)])});const result=await response.json();if(entry.cancelRequested||entry.controller.signal.aborted)throw Error('Processing cancelled.');if(!response.ok)throw Error(result.error||'Local processing failed.');job.result=result;job.status='complete';
    }catch(error){job.status=entry.cancelRequested||entry.controller.signal.aborted?'cancelled':'failed';job.error=error.message}
    finally{job.completedAt=new Date().toISOString();try{await save(job)}finally{running.delete(id)}}})();entry.done.catch(()=>{});return json(job,202);
   }
   const id=url.pathname.split('/').pop();if(!/^[a-f0-9]{64}$/.test(id))return json({error:'Unknown processing job.'},404);const job=await read(id).catch(()=>null);if(!job||job.owner!==ownerId)return json({error:'Unknown processing job.'},404);
   if(request.method==='DELETE')return json(await stop(job));
   if(request.method!=='GET')return json({error:'Method not allowed.'},405);
   if(['queued','running','cancelling'].includes(job.status)&&!running.has(id)){const committed=await read(id);if(committed&&!['queued','running','cancelling'].includes(committed.status))return json(committed);if(running.has(id))return json(committed||job);job.status='failed';job.error='The local server restarted. Retry this stage.';await save(job)}return json(job);
  }catch(error){return json({error:error.status?error.message:'The processing state could not be saved. Your recording remains available.'},error.status||500)}
 });
 handler.purgeForRecord=async(request,recordId)=>locked('local-jobs-'+root,async()=>{
  const ownerId=owner(request);for(const item of (await storage.list({limit:100000})).objects){if(!/^[a-f0-9]{64}\.json$/.test(item.key))continue;let job=await read(item.key.slice(0,-5)).catch(()=>null);if(!job){const previous=await storage.get(item.key+'.previous');job=previous?await previous.json().catch(()=>null):null;}if(!job||job.owner!==ownerId)continue;
   if(job.recordId===recordId||!job.recordId&&!running.has(job.id)){if(running.has(job.id))await stop(job);await storage.delete(item.key)}
  }
 });
 return handler;
}
