import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const app=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const functions=app.slice(app.indexOf('async function transcribeVideo()'),app.indexOf('function decisionControls('));
test('automatic processing advances from transcription to analysis and saves the process',async()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false});return elements.get(id)};
 const state={blob:{},ai:true,hosted:true,mode:'import',segments:[]};let analyzed=0,saved=0;
 const context=vm.createContext({AbortController,recordingIdentity:()=>({key:"test-key"}),state,$,status:async()=>{},getPreferences:()=>({aiMode:'hosted'}),updateWords(){},renderCues(){},setTranscript(text){$('transcript').value=text},toast(){},progress(){},persistMetadata(){},renderResult(){},makeDraft(){throw Error('unexpected fallback')},makePastedDraft(){throw Error('unexpected fallback')},
 transcribeLocally:async()=>({transcript:'Copy the requested name into the CRM.'}),
 analyzeSaved:async()=>{analyzed++;assert.equal(state.analyzing,true);return {method:'hosted-model',steps:[],actions:[]}},
 saveProcess:async()=>{saved++}});
 vm.runInContext(functions,context);await vm.runInContext('processRecording()',context);
 assert.equal(analyzed,1);assert.equal(saved,1);assert.equal(state.analyzing,false);assert.equal(state.transcribing,false);assert.equal(state.method,'hosted-model');
});
test('failed transcription preserves the source and does not start analysis',async()=>{
 const element={value:'Previously corrected transcript',checked:false};const state={blob:{},ai:true,localSpeech:true,mode:'import',segments:[]};let analyzed=0;
 const context=vm.createContext({AbortController,recordingIdentity:()=>({key:"test-key"}),state,$:()=>element,status:async()=>{},getPreferences:()=>({aiMode:'local'}),updateWords(){},renderCues(){},setTranscript(text){element.value=text},toast(){},progress(){},transcribeLocally:async()=>{throw Error('service unavailable')},analyzeSaved:async()=>{analyzed++}});
 vm.runInContext(functions,context);await vm.runInContext('processRecording()',context);assert.equal(analyzed,0);assert.equal(element.value,'Previously corrected transcript');assert.equal(state.transcribing,false);
});
test('editing the source during analysis keeps edits and rejects obsolete output',async()=>{
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false});return elements.get(id)};$('transcript').value='Copy the requested name into the CRM.';const state={blob:{},mode:'paste',result:{title:'Existing'},method:'stale'};let resolve,saved=0;
 const context=vm.createContext({AbortController,recordingIdentity:()=>({key:"test-key"}),getPreferences:()=>({aiMode:'local'}),state,$,updateWords(){},toast(){},progress(){},renderResult(){throw Error('obsolete output rendered')},persistMetadata(){},analyzeSaved:()=>new Promise(r=>resolve=r),saveProcess:async()=>saved++});vm.runInContext(functions,context);const pending=vm.runInContext('generate(true)',context);$('transcript').value='Keep this newer corrected source text.';resolve({method:'hosted-model',title:'Obsolete'});await pending;assert.equal(state.result.title,'Existing');assert.equal(state.method,'stale');assert.equal(saved,0);assert.equal(state.analyzing,false);
});

test('failed regeneration preserves the existing process and does not save a replacement',async()=>{
 const state={mode:'paste',result:{title:'Keep this process'},method:'local-model'},element={value:'Copy the requested name into the CRM.',checked:true};let saved=0;
 const context=vm.createContext({AbortController,recordingIdentity:()=>({key:'test'}),getPreferences:()=>({aiMode:'local'}),state,$:()=>element,updateWords(){},toast(){},progress(){},analyzeSaved:async()=>{throw Error('offline')},saveProcess:async()=>saved++,renderResult(){throw Error('replacement rendered')},persistMetadata(){}});
 vm.runInContext(functions,context);await vm.runInContext('generate()',context);assert.equal(state.result.title,'Keep this process');assert.equal(saved,0);
});
test('ChatGPT never sends an automatically transcribed recording before review and consent',async()=>{
 const state={blob:{},mode:'import'},elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:'Copy the requested name into the CRM.',checked:false});return elements.get(id)};let calls=0;
 const context=vm.createContext({recordingIdentity:()=>({key:'test'}),getPreferences:()=>({aiMode:'chatgpt'}),state,$,toast(){},progress(){},analyzeSaved:async()=>calls++});vm.runInContext(functions,context);await vm.runInContext('generate(true)',context);assert.equal(calls,0);$('reviewCheck').checked=true;await vm.runInContext('generate(true)',context);assert.equal(calls,0);
});
