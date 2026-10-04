import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
class Bucket { constructor(){this.items=new Map()} async put(key,value,options={}){const old=this.items.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=crypto.randomUUID();this.items.set(key,{value: typeof value==='string'?value:Buffer.from(value),...options,etag});return {etag};} async get(key){const item=this.items.get(key);if(!item)return null;return {etag:item.etag,body:item.value,json:async()=>JSON.parse(item.value),httpMetadata:item.httpMetadata};} async delete(key){this.items.delete(key)} async list({prefix='',limit=20}={}){return {objects:[...this.items.keys()].filter(key=>key.startsWith(prefix)).slice(0,limit).map(key=>({key}))};}}
const env=()=>({RECORDINGS:new Bucket()});
const req=(path,options={})=>new Request('https://studio.example'+path,{...options,headers:{origin:'https://studio.example',...options.headers}});

test('saving preserves source beyond analysis limits and all timed phrases',async()=>{
 const binding=env(),cookie=await session(binding),{id}=await (await create(binding,cookie)).json();
 const transcript='Complete source. '.repeat(900)+'FINAL EXCEPTION: do not send.';
 const segments=Array.from({length:250},(_,i)=>({text:'Phrase '+i,time:i,end:i+.5}));
 const response=await worker.fetch(req('/api/recordings/'+id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({transcript,segments})}),binding);
 assert.equal(response.status,200);const saved=await (await worker.fetch(req('/api/recordings/'+id,{headers:{cookie}}),binding)).json();
 assert.equal(saved.transcript,transcript);assert.deepEqual(saved.segments,segments);
});
test('oversized source is rejected without replacing the previous saved version',async()=>{
 const binding=env(),cookie=await session(binding),{id}=await (await create(binding,cookie)).json();
 const patch=transcript=>worker.fetch(req('/api/recordings/'+id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({transcript})}),binding);
 await patch('Keep these original words.');const response=await patch('x'.repeat(200001));
 assert.equal(response.status,413);const saved=await (await worker.fetch(req('/api/recordings/'+id,{headers:{cookie}}),binding)).json();assert.equal(saved.transcript,'Keep these original words.');
});
async function session(binding){const response=await worker.fetch(req('/api/session'),binding);return response.headers.get('set-cookie').split(';')[0];}
async function create(binding,cookie){return worker.fetch(req('/api/recordings',{method:'POST',headers:{cookie,'content-type':'video/webm'},body:Buffer.from('test recording bytes')}),binding);}
test('records are persistent and inaccessible from a different browser session',async()=>{const binding=env(), owner=await session(binding), other=await session(binding);const created=await create(binding,owner);assert.equal(created.status,201);const {id}=await created.json();assert.equal((await worker.fetch(req('/api/recordings/'+id,{headers:{cookie:other}}),binding)).status,404);const list=await worker.fetch(req('/api/recordings',{headers:{cookie:owner}}),binding);assert.equal((await list.json()).items.length,1);});
test('write requests from another website cannot upload or publish',async()=>{const response=await worker.fetch(req('/api/recordings',{method:'POST',headers:{origin:'https://attacker.example','content-type':'video/webm'},body:'data'}),env());assert.equal(response.status,403);});
test('share publication requires explicit consent and exposes only a published snapshot',async()=>{const binding=env(),cookie=await session(binding);const {id}=await (await create(binding,cookie)).json();const patch={transcript:'Copy the requested customer name into the CRM.',reviewed:true,result:{title:'Customer follow-up',summary:'Log the request.',steps:[{title:'Copy name',instruction:'Copy the requested customer name into the CRM.',evidence:'Copy the requested customer name into the CRM.',automation:'candidate',integration:'required',approval:'unknown',reason:'Needs an authorized connection.',decisionReviewed:true}],actions:[]},method:'manual'};assert.equal((await worker.fetch(req('/api/recordings/'+id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(patch)}),binding)).status,200);assert.equal((await worker.fetch(req('/api/recordings/'+id+'/share',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'}),binding)).status,400);const response=await worker.fetch(req('/api/recordings/'+id+'/share',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({consent:true,includeVideo:false})}),binding);assert.equal(response.status,201);const {shareId}=await response.json();const shared=await (await worker.fetch(req('/api/shared/'+shareId),binding)).json();assert.equal(shared.result.title,'Customer follow-up');assert.equal(shared.videoUrl,null);assert.equal(shared.owner,undefined);await worker.fetch(req('/api/recordings/'+id+'/share',{method:'DELETE',headers:{cookie}}),binding);assert.equal((await worker.fetch(req('/api/shared/'+shareId),binding)).status,404);});
test('hosted AI never pretends a rules draft is a completed model transformation',async()=>{const binding=env(),cookie=await session(binding);const {id}=await (await create(binding,cookie)).json();const response=await worker.fetch(req('/api/analyze',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id,transcript:'Copy the name from the request into the CRM.'})}),binding);assert.equal(response.status,503);const status=await (await worker.fetch(req('/api/status'),binding)).json();assert.equal(status.localOnly,false);assert.equal(status.ai,false);});

test('hosted transformation removes unsupported quotes and tool names and persists the verified draft',async t=>{
 const binding={...env(),OPENAI_API_KEY:'mock-key',CREATOR_CODE:'mock-code'},cookie=await session(binding);
 const {id}=await (await create(binding,cookie)).json();
 const transcript='Copy the name from the request into the CRM.';
 const step={title:'Copy name',instruction:transcript,evidence:transcript,automation:'candidate',integration:'required',approval:'unknown',tools:['CRM','InventedApp'],reason:'Specified field mapping.',uncertainties:[]};
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');const input=JSON.parse(options.body);assert.equal(input.response_format.json_schema.strict,true);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'Log request',summary:'Copy a name.',owner:'',trigger:'',outcome:'',exception:'',steps:[step,{...step,evidence:'Approve a refund.'}],actions:[{text:'Buy something',evidence:'Buy something'}]})}}]})});
 const response=await worker.fetch(req('/api/analyze',{method:'POST',headers:{cookie,'x-studio-code':'mock-code','content-type':'application/json'},body:JSON.stringify({id,transcript})}),binding);
 assert.equal(response.status,200);const output=await response.json();assert.equal(output.method,'hosted-model');assert.equal(output.steps.length,1);assert.deepEqual(output.steps[0].tools,['CRM']);assert.equal(output.actions.length,0);assert.equal(output.executable,false);assert.equal(output.validation.semanticAccuracyVerified,false);
 const stored=await (await worker.fetch(req('/api/recordings/'+id,{headers:{cookie}}),binding)).json();assert.equal(stored.result.title,'Log request');assert.equal(stored.reviewed,false);
});

test('creator access is checked before any paid provider call',async t=>{
 const binding={...env(),OPENAI_API_KEY:'mock-key',CREATOR_CODE:'mock-code'},cookie=await session(binding);const {id}=await (await create(binding,cookie)).json();
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not run')});
 const response=await worker.fetch(req('/api/analyze',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id,transcript:'Copy the request into the CRM.'})}),binding);
 assert.equal(response.status,401);assert.equal(calls,0);
});

test('changing source without regenerating marks an existing draft stale',async()=>{
 const binding=env(),cookie=await session(binding);const {id}=await (await create(binding,cookie)).json();
 const put=input=>worker.fetch(req('/api/recordings/'+id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(input)}),binding);
 await put({transcript:'Copy the name to the sheet.',result:{title:'Copy',summary:'Copy',steps:[],actions:[]},method:'manual',reviewed:true});
 const changed=await (await put({transcript:'Ask the manager to review the complaint.'})).json();assert.equal(changed.method,'stale');assert.equal(changed.reviewed,false);
});

test('save revisions reject overlapping stale edits and recording keys make uploads retryable',async()=>{
 const binding=env(),cookie=await session(binding),upload=()=>worker.fetch(req('/api/recordings',{method:'POST',headers:{cookie,'content-type':'video/webm','x-recording-key':'stable-recording-001'},body:'abcdefghij'}),binding);
 const [first,retry]=await Promise.all([upload(),upload()]);assert.deepEqual([first.status,retry.status].sort(),[200,201]);const a=await first.json(),b=await retry.json();assert.equal(a.id,b.id);assert.equal(a.revision,1);
 const put=transcript=>worker.fetch(req('/api/recordings/'+a.id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,transcript})}),binding);
 const updates=await Promise.all([put('The first saved source.'),put('The conflicting second source.')]);assert.deepEqual(updates.map(r=>r.status),[200,409]);assert.equal((await updates[1].json()).revision,2);
});

test('session refresh renews the existing ownership cookie',async()=>{
 const binding=env(),cookie=await session(binding),response=await worker.fetch(req('/api/session',{headers:{cookie}}),binding);
 assert.ok(response.headers.get('set-cookie').startsWith(cookie+';'));assert.match(response.headers.get('set-cookie'),/Max-Age=2592000/);
});

test('private media supports HEAD, byte ranges, suffix ranges and rejects invalid ranges',async()=>{
 const binding=env(),cookie=await session(binding),{id}=await (await create(binding,cookie)).json(),url='/api/recordings/'+id+'/video';
 const head=await worker.fetch(req(url,{method:'HEAD',headers:{cookie}}),binding);assert.equal(head.status,200);assert.equal(head.headers.get('accept-ranges'),'bytes');assert.equal(head.headers.get('content-length'),'20');assert.equal(await head.text(),'');
 const range=await worker.fetch(req(url,{headers:{cookie,range:'bytes=5-13'}}),binding);assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 5-13/20');assert.equal(await range.text(),'recording');
 const suffix=await worker.fetch(req(url,{headers:{cookie,range:'bytes=-5'}}),binding);assert.equal(await suffix.text(),'bytes');
 for(const value of ['bytes=90-','bytes=8-3','bytes=0-1,4-5','bytes=-0'])assert.equal((await worker.fetch(req(url,{headers:{cookie,range:value}}),binding)).status,416);
});

test('deletion revokes snapshots, keeps recoverable media, and purge frees workspace capacity',async()=>{
 const binding={...env(),MAX_WORKSPACE_RECORDINGS:'1'},cookie=await session(binding),{id}=await (await create(binding,cookie)).json(),recordPath='/api/recordings/'+id;
 await worker.fetch(req(recordPath,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({transcript:'Copy the name into the sheet.',reviewed:true,result:{title:'Copy',summary:'Copy name',steps:[{instruction:'Copy the name into the sheet.',evidence:'Copy the name into the sheet.',decisionReviewed:true}],actions:[]}})}),binding);
 const published=await worker.fetch(req(recordPath+'/share',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({consent:true,includeVideo:true})}),binding),{shareId}=await published.json();assert.equal(published.status,201);
 const sharedHead=await worker.fetch(req('/api/shared/'+shareId+'/video',{method:'HEAD',headers:{range:'bytes=0-3'}}),binding);assert.equal(sharedHead.status,206);assert.equal(sharedHead.headers.get('content-length'),'4');
 await worker.fetch(req(recordPath,{method:'DELETE',headers:{cookie}}),binding);assert.equal((await worker.fetch(req(recordPath,{headers:{cookie}}),binding)).status,410);assert.equal((await worker.fetch(req('/api/shared/'+shareId),binding)).status,404);
 const list=await (await worker.fetch(req('/api/recordings?includeDeleted=true',{headers:{cookie}}),binding)).json();assert.ok(list.items[0].deletedAt);
 assert.equal((await worker.fetch(req(recordPath+'/restore',{method:'POST',headers:{cookie}}),binding)).status,200);assert.equal((await worker.fetch(req(recordPath+'/video',{headers:{cookie}}),binding)).status,200);
 await worker.fetch(req(recordPath,{method:'DELETE',headers:{cookie}}),binding);assert.equal((await worker.fetch(req(recordPath+'/purge',{method:'DELETE',headers:{cookie}}),binding)).status,200);assert.equal((await create(binding,cookie)).status,201);
});

test('library paginates every stored recording beyond the former 50 entry cutoff',async()=>{
 const binding={...env(),MAX_WORKSPACE_RECORDINGS:'65'},cookie=await session(binding);
 for(let n=0;n<53;n++)assert.equal((await create(binding,cookie)).status,201);
 const first=await (await worker.fetch(req('/api/recordings?limit=50',{headers:{cookie}}),binding)).json();assert.equal(first.total,53);assert.equal(first.items.length,50);assert.ok(first.cursor);
 const second=await (await worker.fetch(req('/api/recordings?cursor='+first.cursor,{headers:{cookie}}),binding)).json();assert.equal(second.items.length,3);assert.equal(second.cursor,null);
});

test('result provenance and warnings survive saving and sharing requires decision review',async()=>{
 const binding=env(),cookie=await session(binding),{id}=await (await create(binding,cookie)).json(),path='/api/recordings/'+id,transcript='Copy the name into the sheet.';
 const result={title:'Copy',summary:'Name copy',model:'test-model',modelVersion:'v2',policyVersion:'p2',expectedOutcome:'Name saved',exceptionPath:'Ask owner',provenance:{engine:'local',model:'test-model',secret:'discard me'},issues:['Source coverage needs review.'],validation:{warnings:['Instruction needs review.'],semanticAccuracyVerified:false},steps:[{instruction:transcript,evidence:transcript,decisionReviewed:false}],actions:[]};
 const put=()=>worker.fetch(req(path,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({transcript,reviewed:true,result})}),binding);
 const saved=await (await put()).json();assert.equal(saved.result.modelVersion,'v2');assert.equal(saved.result.expectedOutcome,'Name saved');assert.equal(saved.result.provenance.secret,undefined);
 const share=input=>worker.fetch(req(path+'/share',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({consent:true,...input})}),binding);
 assert.equal((await share({warningsAcknowledged:true})).status,400);result.steps[0].decisionReviewed=true;await put();assert.equal((await share({})).status,400);assert.equal((await share({warningsAcknowledged:true})).status,201);
});

test('hosted limits stop excess uploads and provider requests before resource use',async t=>{
 const binding={...env(),MAX_DAILY_RECORDINGS:'1',MAX_UPLOAD_BYTES:'4'},cookie=await session(binding);
 assert.equal((await create(binding,cookie)).status,413);
 const upload=()=>worker.fetch(req('/api/recordings',{method:'POST',headers:{cookie,'content-type':'video/webm'},body:'1234'}),binding);
 assert.equal((await upload()).status,201);assert.equal((await upload()).status,429);
 const aiBinding={...env(),OPENAI_API_KEY:'mock',CREATOR_CODE:'code',MAX_DAILY_AI_REQUESTS:'1'},aiCookie=await session(aiBinding),{id}=await (await create(aiBinding,aiCookie)).json();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('provider failure',{status:503})});
 const analyze=operationKey=>worker.fetch(req('/api/analyze',{method:'POST',headers:{cookie:aiCookie,'x-studio-code':'code','content-type':'application/json'},body:JSON.stringify({id,operationKey,transcript:'Copy the name into the sheet.'})}),aiBinding);
 assert.equal((await analyze('operation-first')).status,502);assert.equal((await analyze('operation-second')).status,429);assert.equal(calls,1);
});

test('a delayed hosted response cannot overwrite edits and completed jobs are retryable without a provider call',async t=>{
 const binding={...env(),OPENAI_API_KEY:'mock',CREATOR_CODE:'code'},cookie=await session(binding),{id}=await (await create(binding,cookie)).json();
 let release,started,signal=new Promise(resolve=>{started=resolve}),calls=0;const blocked=new Promise(resolve=>{release=resolve});
 t.mock.method(globalThis,'fetch',async()=>{calls++;started();await blocked;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'Copy',summary:'Name copy',owner:'',trigger:'',outcome:'',exception:'',steps:[{title:'Copy name',instruction:'Copy the name into the sheet.',evidence:'Copy the name into the sheet.',automation:'candidate',integration:'required',approval:'unknown',tools:['sheet'],reason:'Specified copy.',uncertainties:[]}],actions:[]})}}]})});
 const analyze=operationKey=>worker.fetch(req('/api/analyze',{method:'POST',headers:{cookie,'x-studio-code':'code','content-type':'application/json'},body:JSON.stringify({id,operationKey,transcript:'Copy the name into the sheet.'})}),binding);
 const running=analyze('operation-first');await signal;assert.equal((await analyze('operation-first')).status,409);
 await worker.fetch(req('/api/recordings/'+id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({transcript:'The newer source must survive.'})}),binding);
 release();assert.equal((await running).status,409);const stored=await (await worker.fetch(req('/api/recordings/'+id,{headers:{cookie}}),binding)).json();assert.equal(stored.transcript,'The newer source must survive.');assert.equal(stored.jobs.analyze.status,'failed');
 const completed=await analyze('operation-second');assert.equal(completed.status,200);const retry=await analyze('operation-second');assert.equal(retry.status,200);assert.equal(calls,2);assert.equal((await retry.json()).revision,(await completed.json()).revision);
});

test('private workspace recovery keys restore ownership and reject malformed imports',async()=>{
 const binding=env(),cookie=await session(binding),{id}=await (await create(binding,cookie)).json();
 const response=await worker.fetch(req('/api/workspace/recovery',{headers:{cookie}}),binding),backup=await response.json();assert.equal(backup.private,true);assert.equal(backup.token,cookie.split('=')[1]);assert.match(response.headers.get('content-disposition'),/attachment/);
 const recovered=await worker.fetch(req('/api/workspace/recover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(backup)}),binding),restoredCookie=recovered.headers.get('set-cookie').split(';')[0];assert.equal(recovered.status,200);assert.equal((await worker.fetch(req('/api/recordings/'+id,{headers:{cookie:restoredCookie}}),binding)).status,200);
 assert.equal((await worker.fetch(req('/api/workspace/recover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...backup,token:'invalid'})}),binding)).status,400);
});

test('conditional storage writes reject edits arriving from another worker isolate',async t=>{
 const binding=env(),cookie=await session(binding),{id}=await (await create(binding,cookie)).json();const original=binding.RECORDINGS.put.bind(binding.RECORDINGS);let injected=false;
 t.mock.method(binding.RECORDINGS,'put',async(key,value,options)=>{
  if(key.endsWith('/'+id+'.json')&&options?.onlyIf?.etagMatches&&!injected){injected=true;const current=JSON.parse(binding.RECORDINGS.items.get(key).value);current.transcript='A different worker saved this source.';current.revision=2;await original(key,JSON.stringify(current));}
  return original(key,value,options);
 });
 const response=await worker.fetch(req('/api/recordings/'+id,{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,transcript:'A conflicting source edit.'})}),binding);
 assert.equal(response.status,409);assert.equal((await response.json()).revision,2);const stored=await (await worker.fetch(req('/api/recordings/'+id,{headers:{cookie}}),binding)).json();assert.equal(stored.transcript,'A different worker saved this source.');
});
