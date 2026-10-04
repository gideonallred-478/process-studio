import test from 'node:test';import assert from 'node:assert/strict';
import {hostedRelay} from '../scripts/hosted-relay.mjs';
const origin='https://vercel-logged-out.vercel.app';
test('relay forwards only studio cookie and permitted headers; fixed backend; no AI entitlement',async()=>{
 let forwarded;const env={STUDIO_BACKEND_URL:'https://process-studio-sharing.test.workers.dev',STUDIO_RELAY_SECRET:'r'.repeat(40)};
 const request=new Request(origin+'/api/recordings',{headers:{cookie:'ps_owner='+ 'a'.repeat(32)+'; unrelated=private',authorization:'Bearer do-not-forward','x-studio-code':'do-not-forward','x-recording-key':'retry-record-01'}});
 const response=await hostedRelay(request,{env,fetchImpl:async(url,options)=>{forwarded={url,options};return Response.json({items:[]})}});assert.equal(response.status,200);assert.equal(forwarded.url,env.STUDIO_BACKEND_URL+'/api/recordings');assert.equal(forwarded.options.headers.get('authorization'),null);assert.equal(forwarded.options.headers.get('x-studio-code'),null);assert.equal(forwarded.options.headers.get('cookie'),'ps_owner='+ 'a'.repeat(32));
 const status=await hostedRelay(new Request(origin+'/api/chatgpt/status'),{env});assert.equal((await status.json()).account,null);
 assert.equal(forwarded.options.headers.get('x-recording-key'),'retry-record-01');
 assert.equal((await hostedRelay(new Request(origin+'/api/local/sharing/status'),{env})).status,503);
});
test('legacy video redirect stays on the configured media service',async()=>{
 const env={STUDIO_BACKEND_URL:'https://process-studio-sharing.test.workers.dev',STUDIO_RELAY_SECRET:'r'.repeat(40)},path='/api/recordings/'+ 'a'.repeat(32)+'/video';
 const response=await hostedRelay(new Request(origin+path),{env,fetchImpl:async()=>new Response(null,{status:307,headers:{location:env.STUDIO_BACKEND_URL+'/transfer/video/synthetic.token'}})});assert.equal(response.status,307);
 const rejected=await hostedRelay(new Request(origin+path),{env,fetchImpl:async()=>new Response(null,{status:307,headers:{location:'https://foreign.test/transfer/video/token'}})});assert.equal(rejected.status,502);
});
test('relay rejects foreign write origins, oversized metadata, redirects and unsafe backend configuration',async()=>{
 let calls=0;const env={STUDIO_BACKEND_URL:'https://process-studio-sharing.test.workers.dev',STUDIO_RELAY_SECRET:'r'.repeat(40)},fetchImpl=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://elsewhere.test'}})};
 assert.equal((await hostedRelay(new Request(origin+'/api/uploads',{method:'POST',headers:{origin:'https://foreign.test'},body:'{}'}),{env,fetchImpl})).status,403);
 assert.equal((await hostedRelay(new Request(origin+'/api/uploads',{method:'POST',headers:{origin},body:'x'.repeat(4*1024*1024+1)}),{env,fetchImpl})).status,413);assert.equal(calls,0);
 assert.equal((await hostedRelay(new Request(origin+'/api/status'),{env,fetchImpl})).status,502);
 assert.equal((await hostedRelay(new Request(origin+'/api/session'),{env:{...env,STUDIO_BACKEND_URL:'http://127.0.0.1:4173'},fetchImpl})).status,503);
});
test('unconfigured hosting reports preview capabilities without creating a workspace',async()=>{
 let calls=0;const options={env:{},fetchImpl:async()=>{calls++;throw Error('Must not forward')}};
 const response=await hostedRelay(new Request(origin+'/api/status'),options);
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{edition:'hosted',storage:false,ai:false,processing:'local',code:'HOSTED_STORAGE_NOT_CONFIGURED'});
 const session=await hostedRelay(new Request(origin+'/api/session'),options);assert.equal(session.status,503);assert.equal((await session.json()).code,'HOSTED_STORAGE_NOT_CONFIGURED');assert.equal(session.headers.get('set-cookie'),null);assert.equal(calls,0);
});
test('a configured storage outage remains an error, never an unconfigured preview',async()=>{
 const env={STUDIO_BACKEND_URL:'https://process-studio-sharing.test.workers.dev',STUDIO_RELAY_SECRET:'r'.repeat(40)};
 const response=await hostedRelay(new Request(origin+'/api/status'),{env,fetchImpl:async()=>{throw Error('Network outage')}});assert.equal(response.status,502);assert.equal((await response.json()).code,undefined);
});
