import fs from 'node:fs/promises';
import http from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import worker from '../../dist/server/index.js';
import {MemoryR2} from './memory-r2.mjs';
const require=createRequire(process.env.STUDIO_BROWSER_PACKAGE);
const {chromium}=require('playwright');
const env={RECORDINGS:new MemoryR2()},cookie='ps_owner='+'a'.repeat(32);
const checks=[],findings=[],pageErrors=[];
let origin,browser,heldJob,completeJob=false,transcriptionStarts=0;
const transcript='Sort the local CSV by name. Copy the name column into a new customer_name column in the local CSV.';
const result={title:'Synthetic original process',summary:'Synthetic workflow for a disposable audit.',steps:[{title:'Sort rows',instruction:'Sort the local CSV by name.',evidence:'Sort the local CSV by name.',automation:'candidate',integration:'none',approval:'not-required',decisionReviewed:true},{title:'Copy names',instruction:'Copy the name column into a new customer_name column in the local CSV.',evidence:'Copy the name column into a new customer_name column in the local CSV.',automation:'candidate',integration:'none',approval:'not-required',decisionReviewed:true}],actions:[]};
const request=async(path,options={})=>worker.fetch(new Request(origin+path,{...options,headers:{origin,cookie,...options.headers}}),env);
const api=async(path,options={})=>{const response=await request(path,options),data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,origin);let response;
 if(url.pathname==='/api/local/status')response=Response.json({available:true,ai:true,localSpeech:true,modelState:'ready',model:'Synthetic provider'});
 else if(url.pathname==='/api/chatgpt/status')response=Response.json({available:false,accounts:[],account:null});
 else if(url.pathname==='/api/local/sharing/status')response=Response.json({available:true,connected:false,links:{}});
 else if(url.pathname==='/api/desktop/status')response=Response.json({available:false});
 else if(url.pathname==='/api/local/camera')response=Response.json({available:true,surfaces:[{id:'synthetic-monitor-1',kind:'monitor',title:'Synthetic screen 1'},{id:'synthetic-monitor-2',kind:'monitor',title:'Synthetic screen 2'}]});
 else if(url.pathname==='/api/local/jobs'&&req.method==='POST'){
  for await(const chunk of req){};
  const stage=req.headers['x-job-stage'];
  if(stage==='transcribe'){transcriptionStarts++;response=Response.json({error:'Another local processing stage is running. Finish or cancel it first.'},{status:409});}
  else{heldJob={id:'f'.repeat(64),stage:'analyze',status:'running',recordId:req.headers['x-recording-id'],recordKey:req.headers['x-recording-key']};response=Response.json(heldJob,{status:202});}
 }else if(url.pathname.startsWith('/api/local/jobs/'))response=Response.json(req.method==='DELETE'?{...heldJob,status:'cancelled'}:completeJob?{...heldJob,status:'complete',result:{...structuredClone(result),title:'Synthetic late AI process',method:'local-model'}}:heldJob);
 else response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:{...req.headers,cookie},...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end(error.message);}});
server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message});}};
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
 await check('Compiled root and all dedicated app pages initialize',async()=>{for(const path of ['/','/library.html','/recording.html','/editor.html','/settings.html']){const response=await page.goto(origin+path);assert.equal(response.status(),200);await page.waitForSelector('body[data-studio-ready=true]');}});
 await check('Provider, movement and example preferences survive reload',async()=>{await page.locator('#aiMode').selectOption('hosted');await page.locator('#spaceAware').uncheck();await page.locator('#showExample').check();await page.reload();await page.waitForSelector('body[data-studio-ready=true]');assert.equal(await page.locator('#aiMode').inputValue(),'hosted');assert.equal(await page.locator('#spaceAware').isChecked(),false);assert.equal(await page.locator('#showExample').isChecked(),true);await page.locator('#aiMode').selectOption('local');});
 const record=await api('/api/recordings',{method:'POST',headers:{'content-type':'application/json','x-recording-key':'synthetic-pre-polish-key'},body:'{}'});
 await api('/api/recordings/'+record.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript,transcriptSource:'Synthetic audit',reviewed:true,result,method:'manual',segments:[]})});
 await page.goto(origin+'/editor.html?record='+record.id);await page.waitForSelector('body[data-studio-ready=true]');
 await check('Private result sections and source-to-editor navigation work',async()=>{await page.locator('#openResultBtn').click();await page.waitForSelector('#resultContent:not(.hidden)');assert.equal(await page.locator('#procedureSteps li').count(),2);await page.locator('.result-tabs a[href="#sourceSection"]').click();assert.equal(await page.locator('#resultTranscript').textContent(),transcript);await page.locator('#editResult').click();await page.waitForSelector('body[data-studio-ready=true]');assert.equal(await page.locator('#processTitle').inputValue(),result.title);});
 await check('Local automation sample and full run produce a downloadable copy',async()=>{await page.locator('[data-editor-section="automation"]').click();const card=page.locator('[data-plan="0"]');await card.locator('.automation-step > summary').click();await card.getByText('Set up a local operation',{exact:true}).click();await card.locator('[data-key="enabled"]').check();await card.locator('[data-key="confirmed"]').check();await page.getByRole('button',{name:'Use example data',exact:true}).click();await page.locator('#automationVerify').click();assert.match(await page.locator('#automationOutcome').textContent(),/Sample passed/);await page.locator('#automationRun').click();assert.match(await page.locator('#automationOutcome').textContent(),/Completed: 2 input rows/);const downloadPromise=page.waitForEvent('download');await page.locator('#automationDownload').click();const download=await downloadPromise;const rows=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.deepEqual(rows.map(row=>row.name),['Alex','Zoe']);});
 await check('Cross-owner access, explicit snapshot and revocation remain enforced',async()=>{const other=await request('/api/recordings/'+record.id,{headers:{cookie:'ps_owner='+'b'.repeat(32)}});assert.equal(other.status,404);const saved=await api('/api/recordings/'+record.id);const shared=await api('/api/recordings/'+record.id+'/share',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:saved.revision,consent:true,includeVideo:false,warningsAcknowledged:true})});const snapshot=await api('/api/shared/'+shared.shareId);assert.equal(snapshot.videoUrl,null);await page.goto(origin+'/s/'+shared.shareId);await page.waitForSelector('#resultContent:not(.hidden)');assert.equal(await page.locator('#automationRun').count(),0);await api('/api/recordings/'+record.id+'/share',{method:'DELETE'});assert.equal((await request('/api/shared/'+shared.shareId)).status,404);});
 // Hold actual browser generation while editing a real saved process.
 await page.goto(origin+'/editor.html?record='+record.id);await page.waitForSelector('body[data-studio-ready=true]');
 await page.locator('button[data-page="source"]').first().click();
 await page.locator('#generateBtn').click();await page.waitForFunction(()=>document.getElementById('generateBtn').textContent==='Creating process…');
 for(let i=0;i<100&&!heldJob;i++)await new Promise(resolve=>setTimeout(resolve,25));assert.ok(heldJob,'Generation registered');
 await page.locator('button[data-page="editor"]').first().click();
 assert.equal(await page.locator('#generateBtn').textContent(),'Creating process…');
 const manualTitle='Manual title entered while generation runs';await page.locator('#processTitle').fill(manualTitle);await page.locator('#processTitle').dispatchEvent('input');
 for(let i=0;i<100;i++){if((await api('/api/recordings/'+record.id)).result.title===manualTitle)break;await new Promise(resolve=>setTimeout(resolve,25));}
 const savedDuring=(await api('/api/recordings/'+record.id)).result.title;assert.equal(savedDuring,manualTitle);
 completeJob=true;await page.waitForFunction(()=>document.getElementById('generateBtn').textContent==='Create process');
 const titleAfter=await page.locator('#processTitle').inputValue();
 for(let i=0;i<100;i++){if((await api('/api/recordings/'+record.id)).result.title===titleAfter)break;await new Promise(resolve=>setTimeout(resolve,25));}
 findings.push({name:'Process edits made during local AI generation are overwritten by the late result',reproduced:titleAfter!==manualTitle,savedDuring,titleAfter,savedAfter:(await api('/api/recordings/'+record.id)).result.title,scope:'Synthetic local job result through the compiled client and real in-memory storage'});
 await check('AI generation preserves process edits already saved during the request',async()=>{assert.equal(titleAfter,manualTitle);assert.equal((await api('/api/recordings/'+record.id)).result.title,manualTitle);assert.equal(await page.locator('#downloadGeneratedDraft').count(),1);const downloadPromise=page.waitForEvent('download');await page.locator('#downloadGeneratedDraft').click();const file=await downloadPromise;const separate=JSON.parse(await fs.readFile(await file.path(),'utf8'));assert.equal(separate.result.title,'Synthetic late AI process');});
 const captureContext=await browser.newContext({viewport:{width:1440,height:1000}});
 await captureContext.addInitScript(()=>{
  const makeVideo=()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');let frame=0;setInterval(()=>{ctx.fillStyle=frame++%2?'#123456':'#abcdef';ctx.fillRect(0,0,640,360)},50);return canvas.captureStream(10);};
  Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{const stream=makeVideo();stream.getVideoTracks()[0].getSettings=()=>({displaySurface:'monitor',width:640,height:360});window.__syntheticScreen=stream;return stream;}});
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async options=>{if(options.video)return makeVideo();const ctx=new AudioContext(),dest=ctx.createMediaStreamDestination(),osc=ctx.createOscillator();osc.connect(dest);osc.start();await ctx.resume();return dest.stream;}});
  if(window.documentPictureInPicture)window.documentPictureInPicture.requestWindow=async()=>{throw new DOMException('Synthetic overlay uses capture matching','AbortError')};
 });
 const capturePage=await captureContext.newPage();capturePage.on('pageerror',error=>pageErrors.push(error.message));
 await capturePage.goto(origin+'/');await capturePage.waitForSelector('body[data-studio-ready=true]');await capturePage.locator('#autoProcess').uncheck();
 await capturePage.locator('#recordBtn').click();await capturePage.waitForSelector('#captureDialog[open]');
 await new Promise(resolve=>setTimeout(resolve,1600));
 await capturePage.evaluate(()=>{const track=window.__syntheticScreen.getVideoTracks()[0];track.stop();track.dispatchEvent(new Event('ended'))});
 await capturePage.waitForFunction(()=>document.getElementById('videoStatus').textContent.startsWith('Saved'));
 if(await capturePage.locator('#captureDialog').evaluate(dialog=>dialog.open))await capturePage.locator('#captureCancel').click();
 await new Promise(resolve=>setTimeout(resolve,120));
 const captureAfter=await capturePage.evaluate(()=>({recordingControlsVisible:!document.getElementById('recordingControls').classList.contains('hidden'),recordButton:document.getElementById('recordBtn').textContent,cameraToggleDisabled:document.getElementById('cameraToggle').disabled,videoStatus:document.getElementById('videoStatus').textContent,tracksEnded:window.__syntheticScreen.getTracks().every(track=>track.readyState==='ended')}));
 findings.push({name:'Screen ending during camera-surface matching leaves recording controls active after saving',reproduced:captureAfter.tracksEnded&&captureAfter.recordingControlsVisible&&captureAfter.recordButton.includes('Stop recording'),...captureAfter,scope:'Synthetic canvas video and oscillator audio; real browser MediaRecorder; no hardware access'});
 await check('Screen ending while matching leaves controls idle and the recording saved',async()=>{assert.equal(captureAfter.recordingControlsVisible,false);assert.equal(captureAfter.cameraToggleDisabled,false);assert.equal(captureAfter.recordButton.includes('Stop recording'),false);assert.equal(await capturePage.locator('#captureDialog').evaluate(dialog=>dialog.open),false);assert.match(captureAfter.videoStatus,/^Saved/);});
 const overlapPage=await captureContext.newPage();overlapPage.on('pageerror',error=>pageErrors.push(error.message));
 await overlapPage.goto(origin+'/');await overlapPage.waitForSelector('body[data-studio-ready=true]');await overlapPage.locator('#autoProcess').uncheck();
 await overlapPage.locator('button[data-page="studio"]').first().click();await overlapPage.locator('#recordBtn').click();await overlapPage.waitForSelector('#captureDialog[open]');await overlapPage.locator('#captureCancel').click();await overlapPage.waitForFunction(()=>document.getElementById('recordBtn').textContent.includes('Stop recording'));
 completeJob=false;heldJob=null;
 await overlapPage.locator('#transcript').fill(transcript);await overlapPage.locator('#transcript').dispatchEvent('input');await overlapPage.locator('#reviewCheck').check();
 const generationAllowed=await overlapPage.locator('#generateBtn').isEnabled();
 await overlapPage.locator('#generateBtn').dispatchEvent('click');
 await new Promise(resolve=>setTimeout(resolve,180));
 await check('Generation is blocked during capture even if a click is dispatched',async()=>{assert.equal(generationAllowed,false);assert.equal(heldJob,null);});
 if(heldJob){completeJob=true;await overlapPage.waitForFunction(()=>document.getElementById('processTitle').value==='Synthetic late AI process');}
 await overlapPage.locator('button[data-page="source"]').first().click();await overlapPage.locator('#stopBtn').click();await overlapPage.waitForFunction(()=>document.getElementById('videoStatus').textContent.startsWith('Saved')&&!document.getElementById('recordBtn').disabled);
 await overlapPage.waitForFunction(async()=>{const {recordingIdentity}=await import('/cloud.js');return Boolean(recordingIdentity().id);});
 const overlapId=await overlapPage.evaluate(async()=>{const {recordingIdentity}=await import('/cloud.js');return recordingIdentity().id;});
 const afterOverlap=await api('/api/recordings/'+overlapId),playableNow=await overlapPage.evaluate(()=>Boolean(document.getElementById('video').src.startsWith('blob:')));
 await overlapPage.goto(origin+'/recording.html?record='+overlapId);await overlapPage.waitForSelector('body[data-studio-ready=true]');
 const videoMissingAfterReload=await overlapPage.locator('#video').evaluate(video=>video.classList.contains('hidden'));
 findings.push({name:'Generating from edited transcript during active recording saves a text identity and drops the eventual saved video',reproduced:generationAllowed&&playableNow&&!afterOverlap.videoUrl&&videoMissingAfterReload,generationAllowedWhileRecording:generationAllowed,playableInCurrentTab:playableNow,videoMissingAfterReload,savedVideoUrl:afterOverlap.videoUrl,savedKind:afterOverlap.kind,savedBytes:afterOverlap.size,scope:'Actual browser recording and generation controls with synthetic streams and mocked AI; real storage creation/idempotency'});
 await check('Capture remains durably playable after attempted premature generation and reload',async()=>{assert.ok(afterOverlap.videoUrl);assert.ok(afterOverlap.size>0);assert.equal(videoMissingAfterReload,false);});
 await captureContext.close();
 // Do not touch user browser/account/storage. All state above is disposable.
 checks.push({name:'No uncaught errors during broad browser journey',passed:pageErrors.length===0,pageErrors});
 await fs.writeFile('audit/pre-polish-repairs-browser.json',JSON.stringify({at:new Date().toISOString(),synthetic:true,artifact:'compiled',checks,findings,pageErrors},null,2));
 console.log(JSON.stringify({checks,findings,pageErrors}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
if(checks.some(check=>!check.passed))process.exitCode=1;
