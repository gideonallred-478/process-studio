import fs from 'node:fs/promises';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import worker from '../../dist/server/index.js';
import {MemoryR2} from './memory-r2.mjs';
const {chromium}=createRequire(process.env.STUDIO_BROWSER_PACKAGE)('playwright');
const env={RECORDINGS:new MemoryR2()},cookie='ps_owner='+'d'.repeat(32),checks=[],errors=[];
let origin,browser;
const server=http.createServer(async(req,res)=>{try {
 let response;
 if(req.url.startsWith('/api/local/status'))response=Response.json({available:false,ai:false,localSpeech:false});
 else if(req.url.startsWith('/api/chatgpt/status'))response=Response.json({available:false,accounts:[],account:null});
 else if(req.url.startsWith('/api/local/sharing/status'))response=Response.json({available:false,connected:false,links:{}});
 else response=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:{...req.headers,cookie},...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})}),env);
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end(error.message);}});
server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
await fs.mkdir('audit/visual-polish',{recursive:true});
const api=async(path,options={})=>{const response=await worker.fetch(new Request(origin+path,{...options,headers:{origin,cookie,...options.headers}}),env);const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
const transcript='Open the customer list. Sort the local CSV by name. Copy the name column into a new customer_name column. Review the follow-up before sending it.';
const result={title:'Customer follow-up, made repeatable',summary:'A clear process for organizing customer details and preparing the next follow-up. Keep the final message under human review.',owner:'Customer success',trigger:'A new customer enters the follow-up list',outcome:'An organized list and a reviewed follow-up',exception:'Pause if customer information is incomplete',steps:[{title:'Organize the customer list',instruction:'Sort the local customer list by name so the follow-up queue is easy to review.',evidence:'Sort the local CSV by name.',reason:'The source describes a clear sorting rule.',automation:'candidate',integration:'none',approval:'not-required',decisionReviewed:true},{title:'Prepare the customer name',instruction:'Copy the name into a new customer_name column for the next step.',evidence:'Copy the name column into a new customer_name column.',reason:'Copying a specified field has a repeatable rule.',automation:'candidate',integration:'none',approval:'not-required',decisionReviewed:true},{title:'Review the follow-up',instruction:'Check the customer details and message before sending.',evidence:'Review the follow-up before sending it.',reason:'Sending a customer message needs human review.',automation:'human',integration:'uncertain',approval:'required',decisionReviewed:true}],actions:[{text:'Check the customer list for incomplete names.',evidence:'Open the customer list.',done:false},{text:'Review the follow-up message before sending.',evidence:'Review the follow-up before sending it.',done:false}]};
const inspect=async(page,name,{ready=true}={})=>{
 if(ready)await page.waitForSelector('body[data-studio-ready=true]');
 await page.evaluate(()=>document.fonts.ready);
 const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,images:[...document.images].filter(img=>!img.complete||!img.naturalWidth).map(img=>img.src),polished:Boolean(document.querySelector('link[href="/polish.css"]')),background:getComputedStyle(document.body).backgroundColor}));
 await page.screenshot({path:'audit/visual-polish/'+name+'.png',fullPage:true});
 checks.push({name,passed:metrics.scroll<=metrics.width+1&&metrics.images.length===0&&metrics.polished,metrics});
};
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await inspect(page,'studio-desktop');
 await page.goto(origin+'/library.html');await inspect(page,'library-empty-desktop');
 const records=[];
 for(const title of [result.title,'New customer onboarding','Weekly operations review']){
  const record=await api('/api/recordings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'sample',filename:'Prepared visual example'})});
  await api('/api/recordings/'+record.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript,transcriptSource:'Prepared visual example',reviewed:true,result:{...result,title},method:'manual',segments:[]})});records.push(record.id);
 }
 await page.reload();await inspect(page,'library-desktop');
 const source=await api('/api/recordings',{method:'POST',headers:{'content-type':'audio/wav','x-recording-kind':'audio','x-recording-name':'prepared-speech.wav'},body:await fs.readFile('public/sample-walkthrough.wav')});
 await api('/api/recordings/'+source.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({transcript,transcriptSource:'Prepared visual example',reviewed:true,result,method:'manual',segments:[]})});
 await page.goto(origin+'/recording.html?record='+source.id);await inspect(page,'recording-desktop');
 await page.goto(origin+'/editor.html?record='+records[0]);await inspect(page,'editor-desktop');
 await page.locator('[data-editor-section="automation"]').click();await inspect(page,'automation-desktop');
 await page.goto(origin+'/settings.html');await inspect(page,'settings-desktop');
 await page.locator('#showExample').check();await page.goto(origin);await inspect(page,'studio-example-desktop');
 await page.goto(origin+'/r/'+records[0]);await page.waitForSelector('#resultContent:not(.hidden)');
 await page.locator('.result-tabs a[href="#procedure"]').click();await inspect(page,'result-desktop',{ready:false});
 await page.setViewportSize({width:390,height:844});
 for(const [name,path] of [['studio-mobile','/'],['library-mobile','/library.html'],['recording-mobile','/recording.html?record='+source.id],['editor-mobile','/editor.html?record='+records[0]],['settings-mobile','/settings.html']]){await page.goto(origin+path);await inspect(page,name);}
 await page.goto(origin+'/r/'+records[0]+'#procedure');await page.waitForSelector('#resultContent:not(.hidden)');await inspect(page,'result-mobile',{ready:false});
 await page.goto(origin+'/settings.html');await page.waitForSelector('body[data-studio-ready=true]');await page.locator('#themeChoice').selectOption('dark');await page.reload();await page.waitForSelector('body[data-studio-ready=true]');
 assert.equal(await page.locator('#themeChoice').inputValue(),'dark');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 checks.push({name:'Explicit dark preference survives reload',passed:true});
 await page.setViewportSize({width:1440,height:1050});
 for(const [name,path] of [['studio-dark','/'],['library-dark','/library.html'],['recording-dark','/recording.html?record='+source.id],['editor-dark','/editor.html?record='+records[0]],['automation-dark','/editor.html?record='+records[0]+'&section=automation'],['settings-dark','/settings.html']]){await page.goto(origin+path);await inspect(page,name);assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');}
 await page.goto(origin+'/r/'+records[0]+'#procedure');await page.waitForSelector('#resultContent:not(.hidden)');await inspect(page,'result-dark',{ready:false});assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.setViewportSize({width:390,height:844});
 for(const [name,path] of [['studio-dark-mobile','/'],['editor-dark-mobile','/editor.html?record='+records[0]],['settings-dark-mobile','/settings.html']]){await page.goto(origin+path);await inspect(page,name);}
 await page.goto(origin+'/r/'+records[0]+'#procedure');await page.waitForSelector('#resultContent:not(.hidden)');await inspect(page,'result-dark-mobile',{ready:false});
 await page.goto(origin+'/settings.html');await page.waitForSelector('body[data-studio-ready=true]');await page.locator('#themeChoice').selectOption('system');await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await page.locator('#themeChoice').selectOption('dark');await page.emulateMedia({colorScheme:'light'});assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 checks.push({name:'System follows appearance changes and explicit choice takes precedence',passed:true});
 checks.push({name:'No uncaught errors',passed:errors.length===0,errors});
 await fs.writeFile('audit/visual-polish-browser.json',JSON.stringify({at:new Date().toISOString(),synthetic:true,checks},null,2));
 console.log(JSON.stringify({checks}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
if(checks.some(check=>!check.passed))process.exitCode=1;
