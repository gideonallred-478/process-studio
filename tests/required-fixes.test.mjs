import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import crypto from 'node:crypto';
import worker from '../worker/index.js';
import {MemoryR2} from './fixtures/memory-r2.mjs';
import {uploadRecording} from '../public/uploads.js';
import {validCaptionSegments} from '../public/caption-data.js';

const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const origin='https://studio.example',cookie='ps_owner='+'8'.repeat(32);
const request=(url,options={})=>new Request(origin+url,{...options,headers:{origin,cookie,...options.headers}});
function elements(){const items=new Map();const get=id=>{if(!items.has(id))items.set(id,{value:'',checked:false,dataset:{},listeners:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},addEventListener(type,fn){this.listeners[type]=fn},click(){},pause(){},after(){},append(){},remove(){}});return items.get(id)};return {items,get,document:{getElementById:get,createElement:()=>get(crypto.randomUUID())}}}
async function bucket(directory,io=fs){try{const {createFileBucket}=await import('../scripts/local-storage.mjs');return createFileBucket(directory,{fs:io});}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;const text=await fs.readFile(new URL('../scripts/preview.mjs',import.meta.url),'utf8');const Bucket=vm.runInNewContext(text.slice(text.indexOf('class Bucket'),text.indexOf('async function publicSource'))+';Bucket',{directory,fs:io,path,Uint8Array,JSON});return new Bucket();}}
async function temporary(fn){const root=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(root,'ps-required-'));try{return await fn(directory)}finally{assert.equal(path.dirname(directory),root);await fs.rm(directory,{recursive:true,force:true})}}

test('caption-only edits from an older draft are offered separately',()=>{
 const source=app.slice(app.indexOf('function chooseRecoveryDraft('),app.indexOf('function offerDraftRecovery('));const saved={id:'a'.repeat(32),revision:3,transcript:'Same source',segments:[{text:'Same source',time:9}],method:'manual',transcriptSource:'Manual',reviewed:false};const draft={...saved,identity:{id:saved.id,revision:2},segments:[{text:'Same source',time:2}],modifiedAt:Date.now()+1000};const decision=vm.runInNewContext(source+';chooseRecoveryDraft(saved,draft)',{saved,draft});assert.equal(decision.conflict,draft);assert.equal(decision.saved,saved);
});

test('large supported video backups validate without exhausting the JavaScript stack',async()=>{
 const source=(await fs.readFile(new URL('../public/recovery.js',import.meta.url),'utf8'));const validation=source.slice(source.indexOf('function validateBackup('),source.indexOf('export function setupRecovery'));const backup={format:'process-studio-backup',version:1,records:[{transcript:'Synthetic backup source',segments:[],mime:'video/webm',media:'A'.repeat(4000000)}]};assert.equal(vm.runInNewContext(validation+';validateBackup(backup)',{backup,atob,validCaptionSegments}),backup);
});

test('saved-version recovery cannot revert a healthy record or resurrect a purged one',()=>temporary(async directory=>{
 const storage=await bucket(directory),env={RECORDINGS:storage};const created=await(await worker.fetch(request('/api/recordings',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env)).json();const url='/api/recordings/'+created.id;await worker.fetch(request(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript:'Newer saved source stays intact.'})}),env);assert.equal((await worker.fetch(request(url+'/recover',{method:'POST'}),env)).status,409);await worker.fetch(request(url,{method:'DELETE'}),env);await worker.fetch(request(url+'/purge',{method:'DELETE'}),env);assert.equal((await worker.fetch(request(url+'/recover',{method:'POST'}),env)).status,410);assert.equal((await worker.fetch(request(url),env)).status,410);
}));

test('damaged data can be downloaded and explicitly removed with its recovery copies',()=>temporary(async directory=>{
 const storage=await bucket(directory),env={RECORDINGS:storage};const created=await(await worker.fetch(request('/api/recordings',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env)).json();const owner=crypto.createHash('sha256').update('8'.repeat(32)).digest('hex'),key='owners/'+owner+'/'+created.id+'.json',url='/api/recordings/'+created.id;await storage.put(key,'{"broken');assert.equal((await worker.fetch(request(url+'/damaged'),env)).status,200);assert.equal((await worker.fetch(request(url+'/damaged',{method:'DELETE'}),env)).status,200);assert.equal(await storage.get(key),null);assert.equal(await storage.get(key+'.previous'),null);assert.equal((await worker.fetch(request(url),env)).status,410);
}));

test('an interrupted metadata replacement preserves the last committed recording',()=>temporary(async directory=>{
 let interrupt=false;const io={...fs,writeFile:async(file,value,options)=>{if(interrupt){await fs.writeFile(file,String(value).slice(0,8),options);throw Error('simulated interrupted write')}return fs.writeFile(file,value,options)}};
 const storage=await bucket(directory,io);await storage.put('owners/example/record.json',JSON.stringify({transcript:'Keep the committed source.'}));interrupt=true;
 await assert.rejects(storage.put('owners/example/record.json',JSON.stringify({transcript:'Incomplete replacement.'})),/interrupted/);
 assert.equal((await(await storage.get('owners/example/record.json')).json()).transcript,'Keep the committed source.');
}));

test('a damaged record does not hide healthy records from the library',()=>temporary(async directory=>{
 const storage=await bucket(directory),env={RECORDINGS:storage};const created=await(await worker.fetch(request('/api/recordings',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env)).json();
 const owner=crypto.createHash('sha256').update('8'.repeat(32)).digest('hex');await storage.put('owners/'+owner+'/'+'9'.repeat(32)+'.json','{"broken');
 const response=await worker.fetch(request('/api/recordings'),env);assert.equal(response.status,200);const library=await response.json();assert.ok(library.items.some(row=>row.id===created.id));assert.ok(library.items.some(row=>row.id==='9'.repeat(32)&&row.corrupted));
}));

test('reimporting an old backup cannot overwrite a restored recording that was edited',async()=>{
 const env={RECORDINGS:new MemoryR2()},ui=elements();const api=async(url,options={})=>{const response=await worker.fetch(request(url,options),env),data=await response.json();if(!response.ok)throw Error(data.error);return data};
 const source=(await fs.readFile(new URL('../public/recovery.js',import.meta.url),'utf8')).replace(/^import .*\r?\n/gm,'').replace('export function setupRecovery','function setupRecovery');
 const ctx=vm.createContext({...ui,crypto:crypto.webcrypto,api,uploadRecording,refreshHistory:async()=>{},progress(){},Blob,Uint8Array,JSON,URL,setTimeout,btoa,atob,validCaptionSegments});vm.runInContext(source+';setupRecovery()',ctx);
 const entry={id:'9'.repeat(32),kind:'notes',filename:'Synthetic backup',transcript:'Original backup source with sufficient words.',transcriptSource:'Manual',reviewed:false,result:null,method:null,segments:[]};const event={target:{files:[{size:1000,text:async()=>JSON.stringify({format:'process-studio-backup',version:1,records:[entry]})}],value:''}};
 await ui.get('backupFile').listeners.change(event);const first=(await api('/api/recordings')).items[0];assert.ok(first);
 await api('/api/recordings/'+first.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript:'Keep these newer edits after the first restoration.'})});
 await ui.get('backupFile').listeners.change(event);assert.equal((await api('/api/recordings/'+first.id)).transcript,'Keep these newer edits after the first restoration.');
});

test('browser storage exhaustion does not prevent workspace autosave',()=>{
 const source=app.slice(app.indexOf('function persistMetadata('),app.indexOf('async function restoreLatest('));const ui=elements();let queued=0;
 const ctx=vm.createContext({...ui,$:ui.get,state:{mode:'import',segments:[]},recordingIdentity:()=>({id:'a'.repeat(32),key:'draft-a'}),localStorage:{setItem(){throw Error('QuotaExceededError')}},queueAutosave(){queued++},progress(){},Date,JSON});vm.runInContext(source,ctx);vm.runInContext('persistMetadata()',ctx);assert.equal(queued,1);
});

test('an invalid later backup entry is rejected before creating any restored records',async()=>{
 const env={RECORDINGS:new MemoryR2()},ui=elements();const api=async(url,options={})=>{const response=await worker.fetch(request(url,options),env),data=await response.json();if(!response.ok)throw Error(data.error);return data};
 const source=(await fs.readFile(new URL('../public/recovery.js',import.meta.url),'utf8')).replace(/^import .*\r?\n/gm,'').replace('export function setupRecovery','function setupRecovery');vm.runInNewContext(source+';setupRecovery()',{...ui,crypto:crypto.webcrypto,api,uploadRecording,refreshHistory:async()=>{},progress(){},Blob,Uint8Array,JSON,URL,setTimeout,btoa,atob,validCaptionSegments});
 const record={id:'9'.repeat(32),kind:'notes',filename:'Synthetic backup',transcript:'Valid first entry with enough words.',segments:[]};const event={target:{files:[{size:1000,text:async()=>JSON.stringify({format:'process-studio-backup',version:1,records:[record,{...record,id:'7'.repeat(32),transcript:'x'.repeat(200001)}]})}],value:''}};await ui.get('backupFile').listeners.change(event);assert.equal((await api('/api/recordings')).items.length,0);
});

test('a delayed stop/save callback cannot clear a newer source',async()=>{
 const source=app.slice(app.indexOf('  recorder.onstop = async () => {'),app.indexOf("  (screen || camera).getVideoTracks()[0].addEventListener"));const ui=elements();let finish;const pending=new Promise(resolve=>finish=resolve),uploads=[];const state={chunks:[new Blob(['old recording'])],recordingKind:'screen',fileName:'first.webm'};let key='first';const recorder={};
 const ctx=vm.createContext({...ui,$:ui.get,state,recorder,capturedRecording:{context:{key:'first'},chunks:state.chunks,kind:state.recordingKind,name:state.fileName},Blob,URL,type:'video/webm',releaseMedia(){},recordingLabel:kind=>kind,toast(){},storeVideo:()=>pending,setTranscript:text=>ui.get('transcript').value=text,persistMetadata(){},recordingIdentity:()=>({key}),recordingContext:()=>({key}),ensureRecording:async(blob,kind,name,context)=>uploads.push({key:context?.key||key,kind,name}),processRecording(){},progress(){},updateWords(){}});vm.runInContext(source,ctx);const stopped=recorder.onstop();await new Promise(r=>setImmediate(r));
 key='second';state.blob=null;state.recordingKind='paste';state.fileName='';ui.get('transcript').value='Keep the newer written source.';finish();await stopped;assert.equal(ui.get('transcript').value,'Keep the newer written source.');assert.ok(uploads.every(row=>row.key==='first'));
});
