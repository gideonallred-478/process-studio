import test from 'node:test';
import assert from 'node:assert/strict';
import hosted from '../worker/hosted.js';
import {MemoryR2} from './fixtures/memory-r2.mjs';
import {allocateUpload,cleanupUploads} from '../worker/cloud-storage.js';
const studio='https://vercel-logged-out.vercel.app',edge='https://process-studio-sharing.test.workers.dev';
const setup=()=>({RECORDINGS:new MemoryR2(),STUDIO_ORIGIN:studio,MEDIA_ORIGIN:edge,STUDIO_RELAY_SECRET:'r'.repeat(40),MEDIA_SIGNING_SECRET:'m'.repeat(40),PUBLIC_RATE_LIMITER:{limit:async()=>({success:true})},MAX_STORAGE_BYTES:10*1024*1024});
const cookie=char=>'ps_owner='+char.repeat(32);
const api=(env,path,{owner='a',method='GET',data,headers={}}={})=>hosted.fetch(new Request(edge+path,{method,headers:{origin:studio,cookie:cookie(owner),'x-studio-relay':env.STUDIO_RELAY_SECRET,...(data?{'content-type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),env);
const allocate=async(env,size=6*1024*1024,key='test-file-0001')=>{const response=await api(env,'/api/uploads',{method:'POST',data:{size,mime:'video/webm',kind:'import',filename:'synthetic.webm',key}});assert.equal(response.status,201);return response.json();};
const transfer=(env,grant,bytes)=>hosted.fetch(new Request(grant.uploadUrl,{method:'PUT',headers:{origin:studio,'content-type':'video/webm'},body:bytes}),env);
test('backend requires relay authentication and remains signed out of all hosted AI',async()=>{
 const env=setup();assert.equal((await hosted.fetch(new Request(edge+'/api/recordings',{headers:{cookie:cookie('a')}}),env)).status,403);
 const status=await (await api(env,'/api/status')).json();assert.equal(status.storage,true);assert.equal(status.directUploads,true);assert.equal(status.ai,false);
 assert.equal((await api(env,'/api/analyze',{method:'POST',data:{}})).status,403);
 const configured=env.MEDIA_ORIGIN;env.MEDIA_ORIGIN='REPLACE_WITH_WORKER_HTTPS_ORIGIN';assert.equal((await api(env,'/api/status')).status,503);env.MEDIA_ORIGIN=configured;
 delete env.MEDIA_SIGNING_SECRET;assert.equal((await api(env,'/api/status')).status,503);
});
test('upload larger than Vercel payload limit finalizes privately and playback uses R2 ranges',async()=>{
 const env=setup(),grant=await allocate(env),bytes=new Uint8Array(6*1024*1024);bytes[1]=7;
 assert.equal((await transfer(env,grant,bytes)).status,200);
 assert.equal((await api(env,`/api/uploads/${grant.uploadId}/complete`,{owner:'b',method:'POST',data:{}})).status,404);
 const complete=await api(env,`/api/uploads/${grant.uploadId}/complete`,{method:'POST',data:{}});assert.equal(complete.status,200);const record=await complete.json();assert.equal(record.size,bytes.length);
 const legacyPlayback=await api(env,'/api/recordings/'+record.id+'/video');assert.equal(legacyPlayback.status,307);assert.ok(legacyPlayback.headers.get('location').startsWith(edge));
 assert.equal((await api(env,'/api/recordings/'+record.id,{owner:'b'})).status,404);
 const media=await hosted.fetch(new Request(record.videoUrl,{headers:{range:'bytes=1-3'}}),env);assert.equal(media.status,206);assert.deepEqual([...new Uint8Array(await media.arrayBuffer())],[7,0,0]);assert.equal(env.RECORDINGS.rangeReads.at(-1).length,3);
 assert.equal((await api(env,`/api/uploads/${grant.uploadId}/complete`,{method:'POST',data:{}})).status,200);
 assert.equal((await transfer(env,grant,bytes)).status,409);
});
test('actual upload size and MIME are checked; quota reservation and expiry are bounded',async()=>{
 const env=setup(),grant=await allocate(env,4);
 assert.equal((await transfer(env,grant,new Uint8Array(5))).status,413);
 assert.equal((await transfer(env,grant,new Uint8Array(5))).headers.get('access-control-allow-origin'),studio);
 assert.equal((await transfer(env,grant,new Uint8Array(3))).status,400);
 assert.equal((await hosted.fetch(new Request(grant.uploadUrl,{method:'PUT',headers:{origin:studio,'content-type':'audio/wav'},body:new Uint8Array(4)}),env)).status,415);
 env.MAX_STORAGE_BYTES=4;assert.equal((await api(env,'/api/uploads',{method:'POST',data:{size:1,mime:'video/webm',key:'test-file-0002'}})).status,429);
 const key='uploads/grants/'+grant.uploadId+'.json',stored=await (await env.RECORDINGS.get(key)).json();stored.expiresAt=Date.now()-1;await env.RECORDINGS.put(key,JSON.stringify(stored));
 assert.equal((await transfer(env,grant,new Uint8Array(4))).status,410);
 await hosted.scheduled({},env);assert.equal((await env.RECORDINGS.get('controls/storage.json')).json instanceof Function,true);assert.equal((await (await env.RECORDINGS.get('controls/storage.json')).json()).bytes,0);
 const renewed=await api(env,'/api/uploads',{method:'POST',data:{size:4,mime:'video/webm',filename:'synthetic.webm',key:'test-file-0001',attempt:1}});assert.equal(renewed.status,201);const fresh=await renewed.json();assert.equal(fresh.id,grant.id);assert.notEqual(fresh.uploadId,grant.uploadId);assert.equal((await transfer(env,grant,new Uint8Array(4))).status,410);
});
test('failed allocation preserves the count of an existing record',async()=>{
 const env=setup();await env.RECORDINGS.put('controls/storage.json',JSON.stringify({bytes:0,records:1}));
 const put=env.RECORDINGS.put.bind(env.RECORDINGS);env.RECORDINGS.put=async(key,...args)=>{if(key.startsWith('uploads/grants/'))throw Error('synthetic storage failure');return put(key,...args)};
 await assert.rejects(allocateUpload(new Request(studio+'/api/uploads',{method:'POST',headers:{cookie:cookie('a')},body:JSON.stringify({key:'existing-record-01',size:4,mime:'video/webm'})}),env,async()=>Response.json({id:'a'.repeat(32)},{status:200})));
 assert.deepEqual(await (await env.RECORDINGS.get('controls/storage.json')).json(),{bytes:0,records:1});
});
test('expiry cleanup traverses all grant pages and repairs committed finalization',async()=>{
 const env=setup(),grant=await allocate(env,4);await transfer(env,grant,new Uint8Array(4));await api(env,`/api/uploads/${grant.uploadId}/complete`,{method:'POST',data:{}});
 const key='uploads/grants/'+grant.uploadId+'.json',stored=await (await env.RECORDINGS.get(key)).json();stored.status='received';stored.expiresAt=Date.now()-1;await env.RECORDINGS.put(key,JSON.stringify(stored));
 let pages=0;const list=env.RECORDINGS.list.bind(env.RECORDINGS);env.RECORDINGS.list=async options=>{pages++;if(!options.cursor)return {objects:[],truncated:true,cursor:'0'};return list({...options,cursor:undefined})};
 await cleanupUploads(env);assert.equal(pages,2);assert.equal((await (await env.RECORDINGS.get(key)).json()).status,'complete');assert.equal((await (await env.RECORDINGS.get('controls/storage.json')).json()).bytes,4);
});
test('retry keys cannot change upload identity or bypass the storage stop switch',async()=>{
 const env=setup(),grant=await allocate(env,4);const retry=await api(env,'/api/uploads',{method:'POST',data:{size:4,mime:'video/webm',kind:'import',filename:'synthetic.webm',key:'test-file-0001'}});assert.equal((await retry.json()).uploadId,grant.uploadId);
 assert.equal((await api(env,'/api/uploads',{method:'POST',data:{size:5,mime:'video/webm',key:'test-file-0001'}})).status,409);
 env.UPLOADS_PAUSED='true';assert.equal((await api(env,'/api/uploads',{method:'POST',data:{size:1,mime:'video/webm',key:'test-file-0002'}})).status,503);
 env.PUBLIC_RATE_LIMITER.limit=async()=>({success:false});assert.equal((await api(env,'/api/recordings')).status,429);
});
test('cleanup of an older permission preserves renewed uploads and their committed media',async()=>{
 const env=setup(),old=await allocate(env,4),key='uploads/grants/'+old.uploadId+'.json',stored=await (await env.RECORDINGS.get(key)).json();stored.expiresAt=Date.now()-1;await env.RECORDINGS.put(key,JSON.stringify(stored));
 const fresh=await (await api(env,'/api/uploads',{method:'POST',data:{size:4,mime:'video/webm',filename:'synthetic.webm',key:'test-file-0001',attempt:1}})).json();assert.equal(fresh.id,old.id);
 await hosted.scheduled({},env);assert.equal((await api(env,'/api/recordings/'+fresh.id)).status,200);
 await transfer(env,fresh,new Uint8Array([1,2,3,4]));const completed=await (await api(env,`/api/uploads/${fresh.uploadId}/complete`,{method:'POST',data:{}})).json();await hosted.scheduled({},env);
 assert.deepEqual([...new Uint8Array(await (await hosted.fetch(new Request(completed.videoUrl),env)).arrayBuffer())],[1,2,3,4]);assert.equal((await (await env.RECORDINGS.get('controls/storage.json')).json()).bytes,4);
});
test('shared video capabilities are revoked with the snapshot and private source stays private',async()=>{
 const env=setup(),grant=await allocate(env,4);await transfer(env,grant,new Uint8Array(4));const record=await (await api(env,`/api/uploads/${grant.uploadId}/complete`,{method:'POST',data:{}})).json();
 const transcript='Sort the local CSV by name ascending.';
 await api(env,'/api/recordings/'+record.id,{method:'PUT',data:{transcript,reviewed:true,method:'manual',result:{title:'Sort rows',summary:'Sort rows',steps:[{title:'Sort',instruction:transcript,evidence:transcript,automation:'candidate',integration:'none',approval:'not-required',decisionReviewed:true}],actions:[]}}});
 const publication=await (await api(env,'/api/recordings/'+record.id+'/share',{method:'POST',data:{consent:true,includeVideo:true}})).json();const snapshot=await (await api(env,'/api/shared/'+publication.shareId,{owner:'b'})).json();assert.ok(snapshot.videoUrl.startsWith(edge));assert.equal(snapshot.mediaKey,undefined);
 assert.equal((await hosted.fetch(new Request(snapshot.videoUrl),env)).status,200);
 await api(env,'/api/recordings/'+record.id+'/share',{method:'DELETE'});
 assert.equal((await hosted.fetch(new Request(snapshot.videoUrl),env)).status,404);
 assert.equal((await hosted.fetch(new Request(record.videoUrl.replace(/\.([^.]+)$/,(_,signature)=>'.'+(signature[0]==='a'?'b':'a')+signature.slice(1))),env)).status,403);
});
