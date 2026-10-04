import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {locked} from '../worker/storage-controls.js';
export function createLocalJobs(directory,fetchImpl=fetch){
 const running=new Map(),root=path.resolve(directory);
 const file=id=>path.join(root,id+'.json');
 const save=async job=>{await fs.mkdir(root,{recursive:true});const temp=file(job.id)+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(job));await fs.rename(temp,file(job.id))};
 const read=async id=>JSON.parse(await fs.readFile(file(id),'utf8'));
 const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
 return async request=>locked('local-jobs-'+root,async()=>{
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/local/jobs'))return null;
  if(!['localhost','127.0.0.1'].includes(url.hostname))return json({error:'Local access only.'},403);
  if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'Open this request from the studio.'},403);
  const owner=crypto.createHash('sha256').update(request.headers.get('cookie')||'').digest('hex');
  if(!request.headers.get('cookie'))return json({error:'Open your workspace first.'},401);
  if(request.method==='POST'&&url.pathname==='/api/local/jobs'){
   const key=request.headers.get('x-job-key'),stage=request.headers.get('x-job-stage');if(!key||key.length>256||!['analyze','transcribe'].includes(stage))return json({error:'Invalid processing stage.'},400);
   const id=crypto.createHash('sha256').update(owner+key).digest('hex');let existing=await read(id).catch(()=>null);
   if(existing&&['complete','running','queued'].includes(existing.status)){
    if(existing.status==='complete'||running.has(id))return json(existing);
    existing.status='failed';existing.error='The local server restarted during processing. Retry this stage.';await save(existing);
   }
   if(running.size)return json({error:'Another local processing stage is running. Retry after it finishes.'},409);
   const max=stage==='transcribe'?25*1024*1024:250000;const parts=[];let size=0;const reader=request.body?.getReader();if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return json({error:'Processing input is too large.'},413)}parts.push(value)}const body=Buffer.concat(parts);
   const job={id,owner,stage,status:'queued',createdAt:new Date().toISOString()};await save(job);
   const controller=new AbortController();running.set(id,controller);
   void(async()=>{try{job.status='running';await save(job);const response=await fetchImpl('http://127.0.0.1:4173/api/'+(stage==='analyze'?'analyze':'transcribe-local'),{method:'POST',headers:{origin:'http://127.0.0.1:4173','content-type':stage==='analyze'?'application/json':'audio/wav'},body,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(390000)])});const data=await response.json();if(controller.signal.aborted)throw Error('Processing cancelled.');if(!response.ok)throw Error(data.error||'Local processing failed.');job.result=data;job.status='complete'}catch(error){job.status=controller.signal.aborted?'cancelled':'failed';job.error=error.message}finally{job.completedAt=new Date().toISOString();await save(job);running.delete(id)}})();return json(job,202);
  }
  const id=url.pathname.split('/').pop();if(!/^[a-f0-9]{64}$/.test(id))return json({error:'Unknown processing job.'},404);const job=await read(id).catch(()=>null);if(!job||job.owner!==owner)return json({error:'Unknown processing job.'},404);
  if(request.method==='DELETE'){if(job.status==='complete')return json(job);running.get(id)?.abort();job.status='cancelled';job.error='Processing cancelled. Retry when ready.';await save(job);return json(job)}
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  if(['queued','running'].includes(job.status)&&!running.has(id)){job.status='failed';job.error='The local server restarted. Retry this stage.';await save(job)}return json(job);
 });
}
