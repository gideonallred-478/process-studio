import fs from 'node:fs/promises';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import sourceWorker from '../../worker/index.js';
import {MemoryR2} from './memory-r2.mjs';
const worker=process.env.STUDIO_TEST_BUILT==='true'?(await import('../../dist/server/index.js')).default:sourceWorker;
const require=createRequire(process.env.STUDIO_BROWSER_PACKAGE||new URL('../../package.json',import.meta.url));
const {chromium}=require('playwright');
const cookie='ps_owner='+'6'.repeat(32),env={RECORDINGS:new MemoryR2()},jobs=[],results=[],errors=[],failures=[];
let origin,browser,jobStatusRequests=0,reconnectRecord;
const api=async(url,options={})=>{const response=await worker.fetch(new Request(origin+url,{...options,headers:{origin,cookie,...options.headers}}),env);if(!response.ok)throw Error(await response.text());return response.json()};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,origin);let response;
 if(url.pathname==='/api/local/status')response=Response.json({available:true,ai:false,localSpeech:true});
 else if(url.pathname==='/api/chatgpt/status')response=Response.json({available:false,accounts:[],account:null});
 else if(url.pathname==='/api/local/sharing/status')response=Response.json({available:true,connected:false,links:{}});
 else if(url.pathname==='/api/desktop/status')response=Response.json({available:false});
 else if(url.pathname==='/api/local/jobs'&&req.method==='POST'){
  for await(const chunk of req){};
  const job={id:'synthetic-job-'+jobs.length,status:'complete',stage:'transcribe',result:{transcript:'Open the spreadsheet and sort the synthetic rows by name.',source:'Synthetic test',segments:[]}};
  jobs.push({recordId:req.headers['x-recording-id'],job});response=Response.json(job);
 }else if(url.pathname.startsWith('/api/local/jobs/')){
  jobStatusRequests++;
  response=Response.json(url.pathname.endsWith('/synthetic-persisted-job')?{id:'synthetic-persisted-job',recordId:reconnectRecord.id,recordKey:'synthetic-reconnect-key',stage:'transcribe',status:'complete',result:{transcript:'Recovered synthetic source words.',source:'Synthetic speech',segments:[]}}:jobs.at(-1)?.job||{status:'cancelled'});
 }else if(process.env.STUDIO_TEST_BUILT!=='true'&&req.method==='GET'&&(url.pathname==='/'||/\.(?:js|css|html|svg)$/.test(url.pathname)&&!url.pathname.slice(1).includes('/'))){
  const name=url.pathname==='/'?'index.html':url.pathname.slice(1),source=['shared.js','decision-policy.js','local-analysis.js'].includes(name)?name:'public/'+name;
  const bytes=await fs.readFile(source);response=new Response(bytes,{headers:{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html'}});
 }else response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:{...req.headers,cookie},...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end(error.message)}});
server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
function check(name,fn){try{fn();results.push(name)}catch(error){failures.push({name,error:error.message})}}
const newContext=async()=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{AudioContext.prototype.decodeAudioData=function(){const buffer=this.createBuffer(1,16000,16000);buffer.getChannelData(0).fill(.1);return new Promise(resolve=>{window.__resolveSyntheticAudio=()=>resolve(buffer)})}});
 return context;
};
try{
 browser=await chromium.launch({channel:'msedge',headless:true});let context=await newContext();let page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(origin+'/');await page.waitForSelector('body[data-studio-ready=true]');await page.waitForSelector('#libraryEmpty',{state:'attached'});
 await page.locator('#importFile').setInputFiles({name:'synthetic.webm',mimeType:'video/webm',buffer:Buffer.from('synthetic-video-bytes')});await page.waitForFunction(()=>typeof window.__resolveSyntheticAudio==='function');
 const originalId=(await api('/api/recordings')).items[0].id;
 await page.locator('#navLibrary').click();await page.waitForTimeout(100);const visibleSavedRows=await page.locator('#recentRecordings .recent-item').count();
 check('Saved recording appears immediately in Library',()=>assert.equal(visibleSavedRows,1));
 await page.evaluate(async()=>{const {refreshHistory}=await import('/cloud.js');await refreshHistory()});
 await page.getByRole('button',{name:'Move to trash',exact:true}).click();await page.getByRole('button',{name:'Delete permanently',exact:true}).waitFor();await page.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#recentRecordings .recent-item').length===0);assert.equal((await api('/api/recordings')).items.length,0);
 await page.evaluate(()=>window.__resolveSyntheticAudio());await page.waitForFunction(()=>!document.getElementById('transcribeBtn').disabled);
 const afterDelete=await api('/api/recordings');
 check('Purge during audio preparation leaves no recording, media or newly started job',()=>{assert.equal(afterDelete.items.length,0);assert.equal(jobs.length,0);assert.equal([...env.RECORDINGS.items.keys()].filter(key=>key.startsWith('media/')).length,0)});
 await context.close();context=await newContext();page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/');await page.waitForSelector('body[data-studio-ready=true]');await page.locator('#importFile').setInputFiles({name:'synthetic-cancel.webm',mimeType:'video/webm',buffer:Buffer.from('synthetic cancel video')});await page.waitForFunction(()=>typeof window.__resolveSyntheticAudio==='function');
 await page.locator('[data-page="studio"]').first().click();await page.locator('.advanced-capture summary').click();const beforeCancel=jobs.length;
 await page.locator('#cancelProcessing').click();await page.waitForFunction(()=>document.getElementById('processProgress').textContent.includes('Cancellation requested'));await page.evaluate(()=>window.__resolveSyntheticAudio());await page.waitForFunction(()=>!document.getElementById('transcribeBtn').disabled);
 check('Cancel during audio preparation starts no transcription job',()=>assert.equal(jobs.length,beforeCancel));await context.close();
 context=await newContext();await context.addInitScript(()=>{AudioContext.prototype.decodeAudioData=async()=>{throw Error('Synthetic decode fallback')};HTMLMediaElement.prototype.play=function(){return new Promise(resolve=>{window.__resolveSyntheticPlay=resolve})}});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/');await page.waitForSelector('body[data-studio-ready=true]');
 const fallbackWav=Buffer.alloc(32044);fallbackWav.write('RIFF');fallbackWav.writeUInt32LE(32036,4);fallbackWav.write('WAVEfmt ',8);fallbackWav.writeUInt32LE(16,16);fallbackWav.writeUInt16LE(1,20);fallbackWav.writeUInt16LE(1,22);fallbackWav.writeUInt32LE(16000,24);fallbackWav.writeUInt32LE(32000,28);fallbackWav.writeUInt16LE(2,32);fallbackWav.writeUInt16LE(16,34);fallbackWav.write('data',36);fallbackWav.writeUInt32LE(32000,40);for(let i=44;i<fallbackWav.length;i+=2)fallbackWav.writeInt16LE(3000,i);
 await page.locator('#importFile').setInputFiles({name:'synthetic-fallback.wav',mimeType:'audio/wav',buffer:fallbackWav});await page.waitForFunction(()=>typeof window.__resolveSyntheticPlay==='function');
 await page.locator('[data-page="studio"]').first().click();await page.locator('.advanced-capture summary').click();await page.locator('#cancelProcessing').click();await page.waitForTimeout(150);
 const fallbackFinished=await page.locator('#transcribeBtn').isEnabled();check('Cancel releases fallback audio preparation even while playback is pending',()=>assert.equal(fallbackFinished,true));
 await page.evaluate(()=>window.__resolveSyntheticPlay());await page.waitForFunction(()=>!document.getElementById('transcribeBtn').disabled);await context.close();
 reconnectRecord=await api('/api/recordings',{method:'POST',headers:{'content-type':'application/json','x-recording-key':'synthetic-reconnect-key'},body:JSON.stringify({kind:'notes',filename:'Synthetic recovery'})});
 context=await browser.newContext();await context.addInitScript(({id})=>{sessionStorage.setItem('studio-active-job',JSON.stringify({id:'synthetic-persisted-job',recordId:id,key:'synthetic-reconnect-key',stage:'transcribe',previousTranscript:''}))},{id:reconnectRecord.id});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));const statusBefore=jobStatusRequests;await page.goto(origin+'/recording.html?record='+reconnectRecord.id);await page.waitForSelector('body[data-studio-ready=true]');
 const recovery=await page.evaluate(async()=>{const {recordingIdentity}=await import('/cloud.js');return {identity:recordingIdentity(),transcript:document.getElementById('transcript').value}});
 check('Lost browser draft reconnects the durable recording job and restores its transcript',()=>{assert.equal(recovery.identity.key,'synthetic-reconnect-key');assert.equal(jobStatusRequests-statusBefore,1);assert.equal(recovery.transcript,'Recovered synthetic source words.')});
 await page.waitForTimeout(1000);await page.locator('[data-page="settings"]').first().click();const beforeBackup=(await api('/api/recordings')).items.length;
 await page.locator('#backupFile').setInputFiles({name:'synthetic-malformed-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'process-studio-backup',version:1,records:[{transcript:'Valid first source.',segments:[]},{transcript:'Synthetic invalid timing.',segments:[null]}]}))});
 await page.waitForFunction(()=>/invalid|restored as/.test(document.getElementById('backupStatus').textContent));const backupStatus=await page.locator('#backupStatus').textContent();const afterBackup=(await api('/api/recordings')).items.length;
 check('Malformed later backup entry is rejected before any copies are created',()=>{assert.match(backupStatus,/invalid/i);assert.equal(afterBackup,beforeBackup)});
 const recordKey=[...env.RECORDINGS.items.keys()].find(key=>key.startsWith('owners/')&&key.endsWith('/'+reconnectRecord.id+'.json'));
 const damaged=await(await env.RECORDINGS.get(recordKey)).json();damaged.segments=[null];await env.RECORDINGS.put(recordKey,JSON.stringify(damaged));
 await context.close();context=await browser.newContext();page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/recording.html?record='+reconnectRecord.id);await page.waitForSelector('body[data-studio-ready=true]');const damagedView={transcript:await page.locator('#transcript').inputValue(),help:await page.locator('#transcriptHelp').textContent()};
 check('Existing damaged captions keep the source usable and explain recovery',()=>{assert.equal(damagedView.transcript,'Recovered synthetic source words.');assert.match(damagedView.help,/damaged|skipped/i)});
 await context.close();
 const missing=await api('/api/recordings',{method:'POST',headers:{'content-type':'video/webm','x-recording-key':'synthetic-missing-video'},body:new Blob(['synthetic lost media'],{type:'video/webm'})});
 await api('/api/recordings/'+missing.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript:'Keep the source when the saved media is unavailable.',segments:[]})});
 const mediaKey=[...env.RECORDINGS.items.keys()].find(key=>key.startsWith('media/')&&key.endsWith('/'+missing.id));await env.RECORDINGS.delete(mediaKey);
 context=await browser.newContext();page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/recording.html?record='+missing.id);await page.waitForSelector('body[data-studio-ready=true]');
 const missingView=await page.evaluate(async()=>{const {recordingContext}=await import('/cloud.js');return {hasMedia:!!recordingContext().blob,transcript:document.getElementById('transcript').value,status:document.getElementById('videoStatus').textContent}});
 check('Missing source video is not downloaded as a fake video and the transcript is retained',()=>{assert.equal(missingView.hasMedia,false);assert.equal(missingView.transcript,'Keep the source when the saved media is unavailable.');assert.match(missingView.status,/unavailable|missing|retry/i)});
 await page.screenshot({path:'audit/completion-repairs-browser.png',fullPage:true});check('No uncaught browser errors',()=>assert.deepEqual(errors,[]));
 const report={at:new Date().toISOString(),synthetic:true,browser:'isolated headless Edge',artifact:process.env.STUDIO_TEST_BUILT==='true'?'built':'source',results,failures,pageErrors:errors};await fs.writeFile('audit/completion-repairs-browser-'+report.artifact+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert.deepEqual(failures,[]);
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
