import {readWorkspaceSession} from '../public/availability.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import worker from '../worker/index.js';
import {MemoryR2} from './fixtures/memory-r2.mjs';
import {uploadRecording} from '../public/uploads.js';
import * as captions from '../public/captions.js';

const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const cloud=await fs.readFile(new URL('../public/cloud.js',import.meta.url),'utf8');
const origin='https://synthetic.studio',cookie='ps_owner='+'4'.repeat(32);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
function ui(){
 const items=new Map(),listeners=new Map();
 const get=id=>{if(!items.has(id))items.set(id,{value:'',checked:false,href:'',dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},replaceChildren(...children){this.children=children},append(...children){this.children.push(...children)}});return items.get(id)};
 return {get,document:{getElementById:get,createElement:()=>get(crypto.randomUUID())},window:{addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event)}}};
}
async function harness({jobHandler}={}){
 const elements=ui(),env={RECORDINGS:new MemoryR2()},session=new Map(),requests=[];
 const fetchImpl=async(url,options={})=>{if(url.startsWith('/api/local/jobs')){requests.push({url,method:options.method||'GET',recordId:options.headers?.['x-recording-id']});return jobHandler?jobHandler(url,options):Response.json({id:'synthetic-job',status:'complete',result:{transcript:'Synthetic speech result.'}})}return worker.fetch(new Request(origin+url,{...options,headers:{...options.headers,origin,cookie}}),env)};
 const context=vm.createContext({...elements,crypto:crypto.webcrypto,fetch:fetchImpl,uploadRecording,getPreferences:()=>({aiMode:'local'}),discardRecordingCopies:async()=>{},Blob,URL,JSON,Date,TextEncoder,Uint8Array,AbortController,DOMException,setTimeout,clearTimeout,Event,CustomEvent,sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)}});
 context.readWorkspaceSession=()=>readWorkspaceSession(context.fetch);vm.runInContext(cloud.replace(/^import .*\r?\n/gm,'').replace(/^export /gm,''),context);
 const call=(code)=>vm.runInContext(code,context);return {context,call,requests,env,session,elements,fetchImpl};
}
async function savedPendingAudio(options){const h=await harness(options),audio=deferred();h.context.state={blob:new Blob(['synthetic video'],{type:'video/webm'}),recordingKind:'import',fileName:'synthetic.webm',processingAbort:new AbortController()};h.context.wavFromMedia=()=>audio.promise;h.context.getPreferences=()=>({aiMode:'local'});vm.runInContext(app.slice(app.indexOf('async function transcribeLocally('),app.indexOf('async function importRecording(')),h.context);await h.call('ensureRecording(state.blob,state.recordingKind,state.fileName)');return {...h,audio};}

test('cancelling during successful audio preparation prevents job creation',async()=>{
 const h=await savedPendingAudio(),pending=h.call('transcribeLocally(state.blob)');h.context.state.processingAbort.abort();h.context.state.cancelRequested=true;h.audio.resolve(new Blob(['wav']));await assert.rejects(pending,/cancel|abort/i);assert.equal(h.requests.length,0);
});

test('deleting during audio preparation cannot create a replacement recording',async()=>{
 const h=await savedPendingAudio(),original=h.call('recordingIdentity()'),pending=h.call('transcribeLocally(state.blob)');
 await h.fetchImpl('/api/recordings/'+original.id,{method:'DELETE'});await h.fetchImpl('/api/recordings/'+original.id+'/purge',{method:'DELETE'});h.call('resetRecording();state.blob=null;state.mode=null');h.audio.resolve(new Blob(['wav']));await assert.rejects(pending,/changed|removed|cancel|abort/i);
 assert.equal((await(await h.fetchImpl('/api/recordings')).json()).items.length,0);assert.equal(h.requests.length,0);
});

test('successful direct audio decoding rejects an aborted operation',async()=>{
 const decoded=deferred(),controller=new AbortController();const context=vm.createContext({state:{processingAbort:controller},window:{AudioContext:true},decodeWav:()=>decoded.promise,progress(){},Blob,DOMException});
 vm.runInContext(app.slice(app.indexOf('async function wavFromMedia('),app.indexOf('async function transcribeLocally(')),context);const pending=vm.runInContext('wavFromMedia(new Blob(),state.processingAbort.signal)',context);controller.abort();decoded.resolve(new Blob(['wav']));await assert.rejects(pending,/cancel|abort/i);
});

test('cancellation while a job is registering stops the returned job',async()=>{
 const registration=deferred();const h=await harness({jobHandler:(url,options)=>options.method==='POST'?registration.promise:Response.json({id:'synthetic-job',status:'cancelled'})});
 await h.call('ensureRecording(null,"notes","synthetic")');h.context.controller=new AbortController();const pending=h.call('transcribeSaved(null,"notes","synthetic",new Blob(),{context:recordingContext(),signal:controller.signal})');
 while(!h.requests.length)await new Promise(resolve=>setImmediate(resolve));h.context.controller.abort();registration.resolve(Response.json({id:'synthetic-job',status:'running'}));
 await assert.rejects(pending,/cancel|abort|stopped/i);assert.ok(h.requests.some(request=>request.method==='DELETE'&&request.url==='/api/local/jobs/synthetic-job'));
});

test('job recovery never adopts an unrelated record with a matching key',async()=>{
 const h=await harness();await h.call('ensureRecording(null,"notes","synthetic")');const identity=h.call('recordingIdentity()');h.session.set('studio-active-job',JSON.stringify({id:'synthetic-job',recordId:'a'.repeat(32),key:identity.key,stage:'transcribe'}));
 assert.equal(await h.call('resumeLocalJob()'),null);assert.equal(h.requests.length,0);
});

test('a missing saved job gives a retry message and releases its stale browser reference',async()=>{
 const h=await harness({jobHandler:()=>Response.json({error:'Unknown processing job.'},{status:404})});await h.call('ensureRecording(null,"notes","synthetic")');const identity=h.call('recordingIdentity()');h.session.set('studio-active-job',JSON.stringify({id:'synthetic-job',recordId:identity.id,key:identity.key,stage:'transcribe'}));
 await assert.rejects(h.call('resumeLocalJob()'),/retry/i);assert.equal(h.session.has('studio-active-job'),false);
});

test('malformed caption entries in a later backup are rejected before restoring any copies',async()=>{
 const source=await fs.readFile(new URL('../public/recovery.js',import.meta.url),'utf8'),validation=source.slice(source.indexOf('function validateBackup('),source.indexOf('export function setupRecovery'));
 for(const segments of [[null],['phrase'],[{}],[{text:'Words',time:'0'}],[{text:'Words',time:-1}],null]){
  const backup={format:'process-studio-backup',version:1,records:[{transcript:'Valid earlier source.',segments:[]},{transcript:'Words',segments}]};
  assert.throws(()=>vm.runInNewContext(validation+';validateBackup(backup)',{backup,atob,validCaptionSegments:captions.validCaptionSegments}),/invalid/i);
 }
});

test('workspace rejects malformed caption writes without changing the saved source',async()=>{
 const h=await harness();await h.call('ensureRecording(null,"notes","synthetic")');const identity=h.call('recordingIdentity()');
 for(const segments of [[null],['phrase'],[{}],[{text:'Words',time:'0'}],[{text:'Words',end:-1}],null]){
  const response=await h.fetchImpl('/api/recordings/'+identity.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript:'Do not save this invalid replacement.',segments})});
  assert.equal(response.status,400);assert.equal((await(await h.fetchImpl('/api/recordings/'+identity.id)).json()).transcript,'');
 }
});

test('damaged saved caption entries cannot crash playback cues or transcript correction',()=>{
 const segments=[null,{text:'Words',time:0,end:1},'broken'];
 assert.doesNotThrow(()=>captions.captionCues(segments,'Words',2));assert.doesNotThrow(()=>captions.reconcileCaptionText(segments,'Words','Corrected words'));
 assert.equal(captions.captionCues(segments,'Words',2).cues[0].text,'Words');
});

test('an older library response cannot replace a newer library state',async()=>{
 const h=await harness(),lists=[];h.context.fetch=async(url,options)=>{if(url.startsWith('/api/recordings?')){const next=deferred();lists.push(next);return next.promise;}return h.fetchImpl(url,options)};
 const first=h.call('refreshHistory()');while(lists.length<1)await new Promise(resolve=>setImmediate(resolve));const second=h.call('refreshHistory()');while(lists.length<2)await new Promise(resolve=>setImmediate(resolve));
 lists[1].resolve(Response.json({items:[{id:'b'.repeat(32),title:'New source',kind:'notes'}]}));await second;
 lists[0].resolve(Response.json({items:[{id:'a'.repeat(32),title:'Old source',kind:'notes'}]}));await first;
 const rows=h.elements.get('recentRecordings').children.filter(row=>row.className?.startsWith('recent-item'));assert.deepEqual(rows.map(row=>row.children[0].children[1].textContent),['New source']);
});

test('successful saves refresh the library without an explicit Save click',async()=>{
 const h=await harness();h.context.getSnapshot=()=>({state:{},transcript:'',reviewed:false});h.call('setupCloud(getSnapshot)');await new Promise(resolve=>setImmediate(resolve));await h.call('ensureRecording(null,"notes","Saved synthetic walkthrough")');
 for(let i=0;i<20&&!h.elements.get('recentRecordings').children.some(row=>row.className?.startsWith('recent-item'));i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.elements.get('recentRecordings').children.filter(row=>row.className?.startsWith('recent-item')).length,1);
});

test('unconfirmed cancellation retains the saved job reference for a retry',async()=>{
 const h=await harness({jobHandler:(url,options)=>options.method==='DELETE'?Response.json({error:'Cancellation not confirmed.'},{status:503}):Response.json({id:'synthetic-job',status:'running'})});
 await h.call('ensureRecording(null,"notes","synthetic")');h.context.controller=new AbortController();
 const pending=h.call('transcribeSaved(null,"notes","synthetic",new Blob(),{context:recordingContext(),signal:controller.signal})');
 while(!h.session.has('studio-active-job'))await new Promise(resolve=>setImmediate(resolve));h.context.controller.abort();
 await assert.rejects(pending,/not confirmed/i);assert.equal(h.session.has('studio-active-job'),true);
});

test('cancellation transport failure is not reported as successful cancellation',async()=>{
 const h=await savedPendingAudio({jobHandler:(url,options)=>{if(options.method==='DELETE')throw new TypeError('Failed to fetch');return Response.json({id:'synthetic-job',status:'running'})}});
 Object.assign(h.context,{updateWords(){},setTranscript(){},toast(){},renderCues(){}});
 vm.runInContext(app.slice(app.indexOf('async function transcribeVideo('),app.indexOf('async function generate(')),h.context);
 const pending=h.call('transcribeVideo()');h.audio.resolve(new Blob(['wav']));while(!h.session.has('studio-active-job'))await new Promise(resolve=>setImmediate(resolve));
 h.context.state.cancelRequested=true;h.context.state.processingAbort.abort();await pending;
 assert.match(h.elements.get('processProgress').textContent,/not confirmed/i);assert.equal(h.elements.get('processProgress').dataset.kind,'error');assert.equal(h.session.has('studio-active-job'),true);
});

test('cancelled recovered processing cannot apply a late completed transcript',async()=>{
 const pendingJob=deferred(),elements=ui(),state={cancelRequested:false,ai:false};elements.get('transcript').value='Keep the original source.';
 const context=vm.createContext({...elements,$:elements.get,state,AbortController,resumeLocalJob:()=>pendingJob.promise,setTranscript:text=>elements.get('transcript').value=text,renderResult(){},renderCues(){},persistMetadata(){},generate(){},progress(){},updateWords(){}});
 const start=app.lastIndexOf('try { const job=await resumeLocalJob('),source=app.slice(start,app.indexOf('setInterval(status',start));
 const pending=vm.runInContext('(async()=>{'+source+'})()',context);state.cancelRequested=true;pendingJob.resolve({status:'complete',stage:'transcribe',previousTranscript:'Keep the original source.',result:{transcript:'Do not apply these cancelled words.',segments:[]}});await pending;
 assert.equal(elements.get('transcript').value,'Keep the original source.');
});

test('resume rejects late job output when its captured operation is aborted',async()=>{
 const response=deferred(),h=await harness({jobHandler:()=>response.promise});await h.call('ensureRecording(null,"notes","synthetic")');const identity=h.call('recordingIdentity()');h.session.set('studio-active-job',JSON.stringify({id:'synthetic-job',recordId:identity.id,key:identity.key,stage:'transcribe'}));h.context.controller=new AbortController();
 const pending=h.call('resumeLocalJob({signal:controller.signal})');h.context.controller.abort();response.resolve(Response.json({id:'synthetic-job',recordId:identity.id,recordKey:identity.key,stage:'transcribe',status:'complete',result:{transcript:'Late recovered words.'}}));await assert.rejects(pending,/cancel|abort/i);
});
