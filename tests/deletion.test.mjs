import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import worker from '../worker/index.js';import hosted from '../worker/hosted.js';import {MemoryR2} from './fixtures/memory-r2.mjs';import {createLocalSharing} from '../scripts/local-sharing.mjs';import {createLocalJobs} from '../scripts/local-jobs.mjs';

async function fixture(fn){const root=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(root,'ps-delete-'));try{
 const origin='http://127.0.0.1:4182',remote='https://vercel-logged-out.vercel.app',edge='https://media.test.workers.dev',cookie='ps_owner='+'1'.repeat(32),env={RECORDINGS:new MemoryR2()},remoteEnv={RECORDINGS:new MemoryR2(),STUDIO_ORIGIN:remote,MEDIA_ORIGIN:edge,STUDIO_RELAY_SECRET:'r'.repeat(40),MEDIA_SIGNING_SECRET:'m'.repeat(40),PUBLIC_RATE_LIMITER:{limit:async()=>({success:true})}};
 let state={},offline=false;const vault={read:async()=>structuredClone(state),write:async value=>state=structuredClone(value)};
 const remoteFetch=(url,options={})=>{if(offline)throw Error('synthetic offline');const headers=new Headers(options.headers);headers.set('x-studio-relay',remoteEnv.STUDIO_RELAY_SECRET);return hosted.fetch(new Request(edge+new URL(url).pathname,{...options,headers}),remoteEnv)};
 const request=(url,options={})=>new Request(origin+url,{...options,headers:{origin,cookie,...options.headers}});
 const sharing=createLocalSharing({directory,vault,fetchImpl:remoteFetch,loadRecord:async(id,req)=>{const response=await worker.fetch(request('/api/recordings/'+id),env);if(!response.ok)throw Error('Record unavailable');return response.json()}}),jobs=createLocalJobs(directory,async()=>Response.json({transcript:'Sort the local CSV by name ascending.',source:'Whisper',segments:[]}),{loadRecord:async(id,req)=>{const response=await worker.fetch(request('/api/recordings/'+id),env);if(!response.ok)throw Object.assign(Error('Recording unavailable.'),{status:response.status});return response.json()}});
 const module=await import('../scripts/local-deletion.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error}),deletion=module.createLocalDeletion?.({env,jobs,sharing})||(()=>null);
 const raw=async req=>await sharing(req)||await jobs(req)||await deletion(req)||await worker.fetch(req,env),api=async(url,options={})=>{const response=await raw(request(url,options));return {status:response.status,data:await response.json()}};
 const created=await api('/api/recordings',{method:'POST',headers:{'content-type':'application/json','x-recording-key':'synthetic-delete-record'},body:'{}'}),id=created.data.id,source='Sort the local CSV by name ascending.';
 await api('/api/recordings/'+id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript:source,reviewed:true,method:'manual',result:{title:'Sort',steps:[{title:'Sort',instruction:source,evidence:source,decisionReviewed:true}],actions:[]}})});
 const job=await api('/api/local/jobs',{method:'POST',headers:{'x-job-key':'synthetic-delete-record:transcribe','x-job-stage':'transcribe','x-recording-id':id,'content-type':'audio/wav'},body:'audio'});let completed;for(let i=0;i<100;i++){completed=await api('/api/local/jobs/'+job.data.id);if(completed.data.status==='complete')break;await new Promise(r=>setTimeout(r,5))}assert.equal(completed.data.status,'complete',JSON.stringify(completed.data));
 await api('/api/local/sharing/connect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});const publication=await api('/api/local/sharing/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,consent:true})});assert.equal(publication.status,201);
 await fn({api,id,jobId:job.data.id,publication:publication.data,remoteFetch,remoteRecordId:state.pending[id].remoteId,remoteOwner:state.ownerToken,setOffline:value=>offline=value});
 }finally{assert.equal(path.dirname(directory),root);await fs.rm(directory,{recursive:true,force:true})}}

test('permanent deletion removes completed processing copies and revokes online snapshots',()=>fixture(async f=>{
 assert.equal((await f.api('/api/recordings/'+f.id,{method:'DELETE'})).status,200);assert.equal((await f.api('/api/recordings/'+f.id+'/purge',{method:'DELETE'})).status,200);assert.equal((await f.api('/api/local/jobs/'+f.jobId)).status,404);assert.equal((await f.remoteFetch('https://vercel-logged-out.vercel.app/api/shared/'+f.publication.url.split('/').pop())).status,404);
}));
test('permanent deletion also removes the private hosted copy',()=>fixture(async f=>{
 await f.api('/api/recordings/'+f.id,{method:'DELETE'});await f.api('/api/recordings/'+f.id+'/purge',{method:'DELETE'});const copy=await f.remoteFetch('https://vercel-logged-out.vercel.app/api/recordings/'+f.remoteRecordId,{headers:{cookie:'ps_owner='+f.remoteOwner}});assert.equal(copy.status,410);
}));
test('a failed online revocation keeps the recording and lets the user retry deletion',()=>fixture(async f=>{
 f.setOffline(true);const deleted=await f.api('/api/recordings/'+f.id,{method:'DELETE'});assert.equal(deleted.status,503);assert.equal((await f.api('/api/recordings/'+f.id)).status,200);f.setOffline(false);assert.equal((await f.api('/api/recordings/'+f.id,{method:'DELETE'})).status,200);
}));

test('a permanently deleted upload identity cannot silently recreate the recording',()=>fixture(async f=>{
 await f.api('/api/recordings/'+f.id,{method:'DELETE'});await f.api('/api/recordings/'+f.id+'/purge',{method:'DELETE'});const recreated=await f.api('/api/recordings',{method:'POST',headers:{'content-type':'application/json','x-recording-key':'synthetic-delete-record'},body:'{}'});assert.equal(recreated.status,410);
}));
test('late processing requests cannot retain fresh copies of a permanently deleted recording',()=>fixture(async f=>{
 await f.api('/api/recordings/'+f.id,{method:'DELETE'});await f.api('/api/recordings/'+f.id+'/purge',{method:'DELETE'});const late=await f.api('/api/local/jobs',{method:'POST',headers:{'x-job-key':'late-deleted-source','x-job-stage':'transcribe','x-recording-id':f.id,'content-type':'audio/wav'},body:'audio'});if(late.status===202){for(let i=0;i<100;i++){const status=await f.api('/api/local/jobs/'+late.data.id);if(['complete','failed','cancelled'].includes(status.data.status))break;await new Promise(r=>setTimeout(r,5))}}assert.equal(late.status,410);
}));

test('browser cleanup removes the deleted source and keeps another walkthrough and provider settings',async()=>{
 const module=await import('../public/browser-cache.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error});assert.equal(typeof module.discardRecordingCopies,'function');
 const id='a'.repeat(32),draft=JSON.stringify({identity:{id,key:'draft-a'},transcript:'Deleted private source.'}),other=JSON.stringify({identity:{id:'b'.repeat(32),key:'draft-b'},transcript:'Keep this source.'});
 class Storage{constructor(entries){this.values=new Map(entries)}get length(){return this.values.size}key(index){return [...this.values.keys()][index]}getItem(key){return this.values.get(key)||null}setItem(key,value){this.values.set(key,value)}removeItem(key){this.values.delete(key)}}
 const cache=new Storage([['process-studio-latest',draft],['process-studio-record-'+id,draft],['process-studio-draft-draft-a',draft],['process-studio-record-'+'b'.repeat(32),other],['process-studio-preferences-v1','provider settings']]);const session=new Storage([['studio-active-job',JSON.stringify({recordId:id,key:'draft-a'})]]);
 await module.discardRecordingCopies(id,{localStorage:cache,sessionStorage:session,indexedDB:null});assert.equal(cache.getItem('process-studio-latest'),null);assert.equal(cache.getItem('process-studio-draft-draft-a'),null);assert.equal(cache.getItem('process-studio-record-'+id),null);assert.equal(session.getItem('studio-active-job'),null);assert.equal(cache.getItem('process-studio-record-'+'b'.repeat(32)),other);assert.equal(cache.getItem('process-studio-preferences-v1'),'provider settings');
});

test('disconnected online copies require their original workspace key before local deletion',()=>fixture(async f=>{
 await f.api('/api/local/sharing/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({acknowledgeLinks:true})});assert.equal((await f.api('/api/recordings/'+f.id,{method:'DELETE'})).status,503);assert.equal((await f.api('/api/recordings/'+f.id)).status,200);
 const recover=token=>f.api('/api/local/sharing/recover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({format:'process-studio-workspace-recovery',version:1,token})});assert.equal((await recover('2'.repeat(32))).status,409);assert.equal((await recover(f.remoteOwner)).status,200);assert.equal((await f.api('/api/recordings/'+f.id,{method:'DELETE'})).status,200);assert.equal((await f.api('/api/recordings/'+f.id+'/purge',{method:'DELETE'})).status,200);
}));
test('deletion retry identifies browser drafts cached before upload completed',async()=>{
 const {discardRecordingCopies}=await import('../public/browser-cache.js');class Storage{constructor(entries=[]){this.values=new Map(entries)}get length(){return this.values.size}key(i){return [...this.values.keys()][i]}getItem(k){return this.values.get(k)||null}setItem(k,v){this.values.set(k,v)}removeItem(k){this.values.delete(k)}}const draft=JSON.stringify({identity:{id:null,key:'pre-upload-key'},transcript:'Synthetic private source'}),cache=new Storage([['process-studio-latest',draft],['process-studio-draft-pre-upload-key',draft]]);await discardRecordingCopies('a'.repeat(32),{localStorage:cache,sessionStorage:new Storage(),indexedDB:null,cacheKeys:['pre-upload-key']});assert.equal(cache.length,0);
});

test('legacy pre-upload drafts can be matched to deleted identities without changing their saved cache',async()=>{
 const {discardRecordingCopies}=await import('../public/browser-cache.js');const {createHash}=await import('node:crypto');const workspaceHash='c'.repeat(64),key='legacy-pre-upload-key',id=createHash('sha256').update(workspaceHash+':'+key).digest('hex').slice(0,32);class Storage{constructor(){this.values=new Map([['process-studio-latest',JSON.stringify({identity:{id:null,key},transcript:'Legacy cached source'})]])}get length(){return this.values.size}key(i){return [...this.values.keys()][i]}getItem(k){return this.values.get(k)||null}setItem(k,v){this.values.set(k,v)}removeItem(k){this.values.delete(k)}}const cache=new Storage();await discardRecordingCopies(id,{localStorage:cache,sessionStorage:null,indexedDB:null,workspaceHash});assert.equal(cache.length,0);
});
