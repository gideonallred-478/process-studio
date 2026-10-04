import test from 'node:test';import assert from 'node:assert/strict';
import {createLocalSharing} from '../scripts/local-sharing.mjs';
import hosted from '../worker/hosted.js';
import {MemoryR2} from './fixtures/memory-r2.mjs';
const remote='https://vercel-logged-out.vercel.app',local='http://127.0.0.1:4182';
const source='Sort the local CSV by name ascending.';
const record=()=>({id:'a'.repeat(32),transcript:source,reviewed:true,mime:null,segments:[],transcriptSource:'Reviewed notes',method:'manual',result:{title:'Sort',steps:[{instruction:source,evidence:source,decisionReviewed:true}],actions:[]}});
test('two different local videos with identical reviewed text remain separate online recordings',async()=>{
 const edge='https://studio-media.test.workers.dev',env={RECORDINGS:new MemoryR2(),STUDIO_ORIGIN:remote,MEDIA_ORIGIN:edge,STUDIO_RELAY_SECRET:'r'.repeat(40),MEDIA_SIGNING_SECRET:'m'.repeat(40),PUBLIC_RATE_LIMITER:{limit:async()=>({success:true})}};
 let state={};const vault={read:async()=>structuredClone(state),write:async value=>{state=structuredClone(value)}};
 const fetchImpl=async(url,options={})=>{const headers=new Headers(options.headers);if(new URL(url).origin===remote)headers.set('x-studio-relay',env.STUDIO_RELAY_SECRET);return hosted.fetch(new Request(edge+new URL(url).pathname,{...options,headers}),env)};
 const handler=createLocalSharing({vault,fetchImpl,loadRecord:async(id,request,{media=false}={})=>({...record(),id,revision:1,mime:'video/webm',size:4,filename:'same-name.webm',kind:'import',...(media?{bytes:new Uint8Array(4).fill(id.startsWith('a')?1:2)}:{})})});
 const req=(route,input)=>handler(new Request(local+'/api/local/sharing/'+route,{method:'POST',headers:{origin:local},body:JSON.stringify(input)}));
 assert.equal((await req('connect',{})).status,200);assert.equal((await req('publish',{id:'a'.repeat(32),expectedRevision:1,consent:true,includeVideo:true})).status,201);
 const second=await req('publish',{id:'e'.repeat(32),expectedRevision:1,consent:true,includeVideo:true});assert.equal(second.status,201);const publication=await second.json();
 assert.notEqual(state.pending['a'.repeat(32)].remoteId,state.pending['e'.repeat(32)].remoteId);
 const shared=await (await fetchImpl(remote+'/api/shared/'+publication.url.split('/').pop())).json();assert.deepEqual([...new Uint8Array(await (await fetchImpl(shared.videoUrl)).arrayBuffer())],[2,2,2,2]);
});
test('video publication can retry a failed transfer and refuses a changed local revision',async()=>{
 let state={},snapshot={...record(),revision:3,mime:'video/webm',size:4,filename:'synthetic.webm',kind:'import'},allocations=0,transfers=0,published=0,changeSource=false;
 const vault={read:async()=>structuredClone(state),write:async value=>{state=structuredClone(value)}};
 const media='https://studio-media.test.workers.dev',fetchImpl=async(url,options={})=>{const path=new URL(url).pathname;
 if(path==='/api/status')return Response.json({storage:true,directUploads:true,mediaOrigin:media});
 if(path==='/api/session')return new Response('{}',{headers:{'set-cookie':'ps_owner='+ 'b'.repeat(32)}});
 if(path==='/api/uploads'){allocations++;return Response.json({id:'c'.repeat(32),uploadId:'d'.repeat(32),expiresAt:Date.now()+600000,uploadUrl:media+'/transfer/upload/'+ 'd'.repeat(32)});}
 if(path.startsWith('/transfer/upload/')){transfers++;if(transfers===1)throw Error('synthetic disconnected upload');return Response.json({received:true});}
 if(path.endsWith('/complete'))return Response.json({revision:2});
 if(path.endsWith('/share')){published++;return Response.json({url:remote+'/s/'+ 'd'.repeat(32)});}
 return Response.json({revision:2});};
 const handler=createLocalSharing({vault,fetchImpl,loadRecord:async(id,request,{media:withMedia=false}={})=>{if(changeSource&&withMedia)snapshot.revision++;return {...snapshot,...(withMedia?{bytes:new Uint8Array(4)}:{})}}});
 const req=(route,data)=>handler(new Request(local+'/api/local/sharing/'+route,{method:'POST',headers:{origin:local},body:JSON.stringify(data)}));
 await req('connect',{});const input={id:snapshot.id,expectedRevision:3,consent:true,includeVideo:true};assert.equal((await req('publish',input)).status,500);assert.equal(published,0);
 assert.equal((await req('publish',input)).status,201);assert.equal(allocations,1);assert.equal(transfers,2);assert.equal(published,1);
 snapshot.transcript+=' Check the result.';changeSource=true;assert.equal((await req('publish',input)).status,409);assert.equal(published,1);
});
test('source mutation during remote save cannot publish the obsolete snapshot',async()=>{
 let saved={},revision=3,published=0;
 const vault={read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value)}};
 const fetchImpl=async(url,options={})=>{const path=new URL(url).pathname;if(path==='/api/status')return Response.json({storage:true,directUploads:true});if(path==='/api/session')return new Response('{}',{headers:{'set-cookie':'ps_owner='+ 'b'.repeat(32)}});if(path==='/api/recordings')return Response.json({id:'c'.repeat(32)});if(options.method==='PUT'){revision++;return Response.json({revision:2});}if(path.endsWith('/share')){published++;return Response.json({url:remote+'/s/'+ 'd'.repeat(32)});}return Response.json({revision:1});};
 const handler=createLocalSharing({vault,fetchImpl,loadRecord:async()=>({...record(),revision})});const req=(route,input)=>handler(new Request(local+'/api/local/sharing/'+route,{method:'POST',headers:{origin:local},body:JSON.stringify(input)}));await req('connect',{});
 assert.equal((await req('publish',{id:'a'.repeat(32),expectedRevision:3,consent:true})).status,409);assert.equal(published,0);
});
function fixture(){let saved={accounts:[],active:null},requests=[],snapshot=record(),revoked=false;const vault={read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value)}};const fetchImpl=async(url,options={})=>{requests.push({url,options});const path=new URL(url).pathname;if(path==='/api/status')return Response.json({storage:true,directUploads:true,mediaOrigin:'https://studio-media.test.workers.dev'});if(path==='/api/session')return new Response('{}',{headers:{'set-cookie':'ps_owner='+ 'b'.repeat(32)+'; Secure'}});if(path==='/api/recordings'&&options.method==='POST')return Response.json({id:'c'.repeat(32),revision:1});if(path.endsWith('/share')&&options.method==='POST')return Response.json({shareId:'d'.repeat(32),url:remote+'/s/'+ 'd'.repeat(32)});if(path.endsWith('/share')&&options.method==='DELETE'){revoked=true;return Response.json({revoked:true})}if(options.method==='PUT')return Response.json({revision:2});return Response.json({id:'c'.repeat(32),revision:1});};const handler=createLocalSharing({vault,fetchImpl,loadRecord:async()=>snapshot});const req=(path,data,origin=local)=>handler(new Request(local+'/api/local/sharing/'+path,{method:data?'POST':'GET',headers:{origin,cookie:'ps_owner='+ 'e'.repeat(32),'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}));return {req,requests,get snapshot(){return snapshot},get revoked(){return revoked}};}
test('online publication requires local origin, connection, explicit consent and reviewed decisions',async()=>{
 const f=fixture();assert.equal((await f.req('connect',{},'https://foreign.test')).status,403);assert.equal(f.requests.length,0);
 assert.equal((await f.req('publish',{id:'a'.repeat(32),consent:true})).status,409);await f.req('connect',{});const before=f.requests.length;
 assert.equal((await f.req('publish',{id:'a'.repeat(32)})).status,400);assert.equal(f.requests.length,before);
 f.snapshot.result.steps[0].decisionReviewed=false;assert.equal((await f.req('publish',{id:'a'.repeat(32),consent:true})).status,400);assert.equal(f.requests.length,before);
});
test('publication sends only selected snapshot to fixed service; status excludes workspace secret; revoke works',async()=>{
 const f=fixture();await f.req('connect',{});const response=await f.req('publish',{id:'a'.repeat(32),consent:true,includeVideo:false});assert.equal(response.status,201);assert.equal((await response.json()).url,remote+'/s/'+ 'd'.repeat(32));assert.ok(f.requests.every(r=>r.url.startsWith(remote+'/')));
 const status=await (await f.req('status')).json();assert.equal(status.connected,true);assert.equal(status.ownerToken,undefined);assert.equal(status.remoteCookie,undefined);
 assert.match(f.requests.find(r=>r.url===remote+'/api/recordings'&&r.options.method==='POST').options.headers['x-recording-key'],/^online-/);
 const key=await (await f.req('recovery',{})).json();assert.equal(key.format,'process-studio-workspace-recovery');assert.equal(key.token,'b'.repeat(32));
 assert.equal((await f.req('revoke',{id:'a'.repeat(32)})).status,200);assert.equal(f.revoked,true);
 await f.req('disconnect',{});assert.equal((await (await f.req('status')).json()).connected,false);
 assert.equal((await f.req('recover',key)).status,200);assert.equal((await (await f.req('status')).json()).connected,true);
});
