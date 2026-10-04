import {readWorkspaceSession} from '../public/availability.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import worker from '../worker/index.js';
import {MemoryR2} from './fixtures/memory-r2.mjs';
import {uploadRecording} from '../public/uploads.js';
import {createDesktopCamera} from '../public/desktop-camera.js';
const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8'),cloud=await fs.readFile(new URL('../public/cloud.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('async function transcribeVideo()'),app.indexOf('function decisionControls('));
const helperStart=app.indexOf('function processSnapshot('),helpers=helperStart<0?'':app.slice(helperStart,app.indexOf('async function generate('));
const transcript='Sort the local CSV by name.';
for(const pendingStage of ['response','inventory'])test('stopping during camera '+pendingStage+' prevents a later matching dialog',async()=>{
 let resolvePending,selectionCalls=0;
 const pending=new Promise(resolve=>resolvePending=resolve);
 const inventory={available:true,surfaces:[{kind:'monitor',id:'one'},{kind:'monitor',id:'two'}]};
 const camera=createDesktopCamera({fetcher:async()=>pendingStage==='response'?pending:{ok:true,json:()=>pending},selectCapture:async()=>{selectionCalls++;return null;}});
 const startup=camera.start({recording:true,layout:{width:640,height:360,radius:60},track:{getSettings:()=>({displaySurface:'monitor'})}});
 await new Promise(resolve=>setImmediate(resolve));await camera.stop();
 resolvePending(pendingStage==='response'?{ok:true,json:async()=>inventory}:inventory);
 assert.equal(await startup,false);assert.equal(selectionCalls,0);
});
function elements(){const map=new Map();const get=id=>{if(!map.has(id))map.set(id,{value:'',checked:true,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},after(link){map.set(link.id,link)},remove(){}});return map.get(id)};return {get,document:{getElementById:get,createElement:()=>get(crypto.randomUUID())},window:{dispatchEvent(){},addEventListener(){}}};}
function generation(state,mode='local'){
 const ui=elements();ui.get('transcript').value=transcript;let finish,calls=0,saves=0;
 const ctx=vm.createContext({...ui,$:ui.get,state,AbortController,Blob,URL,JSON,recordingIdentity:()=>({key:'synthetic-key'}),getPreferences:()=>({aiMode:mode}),updateWords(){},toast(){},progress:(text,kind)=>Object.assign(ui.get('processProgress'),{textContent:text,dataset:{kind}}),renderResult(){},persistMetadata(){},analyzeSaved:()=>{calls++;return new Promise(resolve=>finish=resolve)},saveProcess:async()=>saves++});
 vm.runInContext(source,ctx);return {ui,ctx,start:()=>vm.runInContext('generate(true)',ctx),finish:value=>finish(value),calls:()=>calls,saves:()=>saves};
}
test('generation never starts while recording is active or paused, even in automatic mode',async()=>{
 for(const status of ['recording','paused']){const state={mode:'paste',recorder:{state:status},result:{title:'Keep'}};const h=generation(state);const pending=h.start();if(h.calls())h.finish({title:'Unexpected',method:'local-model'});await pending;assert.equal(h.calls(),0,'Generation started during '+status);}
});
for(const mode of ['local','chatgpt','hosted'])test(mode+' generation preserves newer process edits and retains its separate generated draft',async()=>{
 const state={mode:'paste',result:{title:'Original process',steps:[],actions:[]},method:'manual'},h=generation(state,mode),pending=h.start();
 assert.equal(h.calls(),1);state.result.title='Keep the newer manual title';h.finish({title:'Late generated title',steps:[],actions:[],method:mode==='chatgpt'?'chatgpt-plan':'local-model'});await pending;
 assert.equal(state.result.title,'Keep the newer manual title');assert.equal(h.saves(),0);assert.match(h.ui.get('downloadGeneratedDraft').href,/^blob:/);
});
test('generation replaces an unchanged process normally',async()=>{
 const state={mode:'paste',result:{title:'Original process',steps:[],actions:[]}},h=generation(state),pending=h.start();
 h.finish({title:'Updated AI process',steps:[],actions:[],method:'local-model'});await pending;
 assert.equal(state.result.title,'Updated AI process');assert.equal(h.saves(),1);assert.equal(state.generatedDraftUrl,undefined);
});
async function cloudHarness(){const ui=elements(),env={RECORDINGS:new MemoryR2()},origin='https://synthetic.test',cookie='ps_owner='+'c'.repeat(32);const fetchImpl=(path,options={})=>worker.fetch(new Request(origin+path,{...options,headers:{origin,cookie,...options.headers}}),env);
 const ctx=vm.createContext({...ui,crypto:crypto.webcrypto,fetch:fetchImpl,uploadRecording,discardRecordingCopies:async()=>{},getPreferences:()=>({aiMode:'local'}),sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},Blob,URL,JSON,Date,TextEncoder,Uint8Array,Event,CustomEvent,setTimeout,clearTimeout});ctx.readWorkspaceSession=()=>readWorkspaceSession(ctx.fetch);vm.runInContext(cloud.replace(/^import .*\r?\n/gm,'').replace(/^export /gm,''),ctx);return {ctx,env,fetchImpl};}
test('saving an active capture cannot create a text-only recording under its media identity',async()=>{
 for(const status of ['recording','paused']){const h=await cloudHarness();h.ctx.state={recorder:{state:status},blob:null,recordingKind:'screen-camera',fileName:'synthetic.webm',segments:[],result:null};await assert.rejects(vm.runInContext('saveProcess(state,"",false)',h.ctx),/record|stop|capture/i);assert.equal((await(await h.fetchImpl('/api/recordings')).json()).items.length,0);}
});
test('a keyed text record cannot be mistaken for a successful media upload or release its browser copy',async()=>{
 const h=await cloudHarness();await vm.runInContext('ensureRecording(null,"notes","Original notes")',h.ctx);h.ctx.media=new Blob(['synthetic video'],{type:'video/webm'});
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(vm.runInContext('ensureRecording(media,"screen","synthetic.webm")',h.ctx),/media|recording|video|identity/i);
 const saved=(await(await h.fetchImpl('/api/recordings')).json()).items[0];assert.equal((await(await h.fetchImpl('/api/recordings/'+saved.id)).json()).videoUrl,null);assert.notEqual(vm.runInContext('recordingContext().blob',h.ctx),h.ctx.media);
});
test('recovered analysis cannot replace an edited saved process with late output',async()=>{
 const ui=elements(),state={cancelRequested:false,result:{title:'Keep recovered edits',steps:[],actions:[]}};ui.get('transcript').value=transcript;
 const ctx=vm.createContext({...ui,$:ui.get,state,AbortController,Blob,URL,JSON,recordingIdentity:()=>({key:'synthetic-key'}),resumeLocalJob:async()=>({status:'complete',stage:'analyze',input:transcript,processSnapshot:'Old snapshot',result:{title:'Late recovered process',steps:[],actions:[],method:'local-model'}}),renderResult(){},persistMetadata(){},progress(){},updateWords(){}});
 const start=app.lastIndexOf('try { const job=await resumeLocalJob('),recovery=app.slice(start,app.indexOf('setInterval(status',start));await vm.runInContext('(async()=>{'+helpers+recovery+'})()',ctx);
 assert.equal(state.result.title,'Keep recovered edits');assert.match(ui.get('downloadGeneratedDraft').href,/^blob:/);
});
