import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBounds, windowFromAnchor } from '../public/camera-placement.js';
import { createDesktopCameraBridge } from '../scripts/desktop-camera-bridge.mjs';
import { createDesktopCamera } from '../public/desktop-camera.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('window mapping uses selected window coordinates, including negative monitor coordinates', () => {
  const bounds = captureBounds({displaySurface:'window'}, {left:-1500,top:100,width:1000,height:800});
  assert.deepEqual(windowFromAnchor({cx:500,cy:400},bounds,{width:1000,height:800,radius:80}),{left:-1080,top:420,width:160,height:160});
  assert.equal(captureBounds({displaySurface:'browser'},bounds),null);
  assert.equal(captureBounds({displaySurface:'window'},null),null);
});

test('local bridge denies foreign origins and never starts native UI during discovery', async () => {
  let started=0;
  const bridge=createDesktopCameraBridge({platform:'win32',inventory:async()=>({surfaces:[]}),launch:async()=>{started++;}});
  const rejected=await bridge(new Request('http://127.0.0.1:4182/api/local/camera/start',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'}));
  assert.equal(rejected.status,403);
  const found=await bridge(new Request('http://127.0.0.1:4182/api/local/camera'));
  assert.equal(found.status,200);
  assert.equal(started,0);
});

test('bridge requires recording consent and exact capture id, then expires session on stop', async () => {
  let started=0;
  const bridge=createDesktopCameraBridge({platform:'win32',inventory:async()=>({surfaces:[{id:'monitor:1',kind:'monitor',bounds:{left:0,top:0,width:1920,height:1080}}]}),launch:async()=>{started++;return {kill(){}};}});
  const post=(endpoint,body)=>bridge(new Request('http://localhost:4182/api/local/camera/'+endpoint,{method:'POST',headers:{origin:'http://localhost:4182','content-type':'application/json'},body:JSON.stringify(body)}));
  assert.equal((await post('start',{captureId:'monitor:1'})).status,400);
  assert.equal((await post('start',{recording:true,captureId:'unknown'})).status,400);
  assert.equal((await post('start',{recording:true,captureId:'monitor:1',anchor:{x:2,y:0}})).status,400);
  const response=await post('start',{recording:true,captureId:'monitor:1'});
  assert.equal(response.status,200);assert.equal(started,1);
  const {session}=await response.json();
  assert.equal((await post('update',{session,anchor:{x:.5,y:.5},radius:.1,frame:'data:image/png;base64,ABCD'})).status,400);
  assert.equal((await post('update',{session,anchor:{x:.5,y:.5},radius:.1,frame:'data:image/jpeg;base64,ABCD'})).status,400);
  assert.equal((await post('stop',{session})).status,200);
  assert.equal((await post('update',{session,anchor:{x:.5,y:.5}})).status,404);
});

test('desktop start waits for capture exclusion and uses valid fallback anchor', async () => {
  let updates=0,received;
  const camera=createDesktopCamera({fetcher:async(url,options)=>{
    const body=options?JSON.parse(options.body):null;
    if(url==='/api/local/camera')return Response.json({available:true,surfaces:[{id:'monitor:1',kind:'monitor'}]});
    if(url.endsWith('/start')){received=body;return Response.json({session:'test',surface:{bounds:{left:0,top:0,width:1920,height:1080}}});}
    if(url.endsWith('/update')){updates++;return Response.json({ready:updates>1,excluded:updates>1});}
    return Response.json({stopped:true});
  }});
  assert.equal(await camera.start({recording:true,layout:{width:1000,height:800,radius:80},track:{getSettings:()=>({displaySurface:'monitor'})}}),true);
  assert.deepEqual(received.anchor,{x:.85,y:.8});assert.equal(updates,2);assert.equal(camera.state.excluded,true);await camera.stop();
});

test('local camera mutation without Origin is rejected', async () => {
  const bridge=createDesktopCameraBridge({platform:'win32'});
  const result=await bridge(new Request('http://localhost:4182/api/local/camera/start',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
  assert.equal(result.status,403);
});

test('browser controller never launches for idle, tab, or unselected window captures', async () => {
  const calls=[];
  const camera=createDesktopCamera({fetcher:async(url)=>{calls.push(url);return Response.json({available:true,surfaces:[{id:'window:1',kind:'window'}]});}});
  const base={layout:{width:1000,height:800,cx:850,cy:640,radius:80},video:{},recording:false,track:{getSettings:()=>({displaySurface:'monitor'})}};
  assert.equal(await camera.start(base),false);assert.equal(calls.length,0);
  assert.equal(await camera.start({...base,recording:true,track:{getSettings:()=>({displaySurface:'browser'})}}),false);assert.equal(calls.length,0);
  assert.equal(await camera.start({...base,recording:true,track:{getSettings:()=>({displaySurface:'window'})}}),false);assert.deepEqual(calls,['/api/local/camera']);
  await camera.stop();
});

test('drag acknowledgement follows feedback and survives stale browser updates', async () => {
  let directory,updates=0,acknowledgement;
  const bridge=createDesktopCameraBridge({platform:'win32',inventory:async()=>({surfaces:[{id:'monitor:1',kind:'monitor',bounds:{left:0,top:0,width:1920,height:1080}}]}),launch:async(folder)=>{directory=folder;return {kill(){}};}});
  const camera=createDesktopCamera({fetcher:async(url,options)=>{
    const response=await bridge(new Request('http://localhost:4182'+url,{...options,headers:{...options?.headers,origin:'http://localhost:4182'}}));
    if(url.endsWith('/start'))await fs.writeFile(path.join(directory,'status.json'),JSON.stringify({ready:false,excluded:false,dragRevision:1,anchor:{x:.25,y:.3}}));
    if(url.endsWith('/update')){
      updates++;const persisted=JSON.parse(await fs.readFile(path.join(directory,'state.json'),'utf8'));
      if(updates===1){assert.equal(persisted.acknowledgedDragRevision,0);await fs.writeFile(path.join(directory,'status.json'),JSON.stringify({ready:true,excluded:true,dragRevision:1,anchor:{x:.25,y:.3}}));}
      else {acknowledgement=persisted;}
    }
    return response;
  }});
  try {
    assert.equal(await camera.start({recording:true,layout:{width:1000,height:800,radius:80},track:{getSettings:()=>({displaySurface:'monitor'})}}),true);
    assert.equal(acknowledgement.acknowledgedDragRevision,1);
    assert.deepEqual(acknowledgement.anchor,{x:.25,y:.3});
    const id=JSON.parse(await fs.readFile(path.join(directory,'state.json'),'utf8'));
    assert.equal(id.acknowledgedDragRevision,1);
  }finally{await camera.stop();}
});

test('native placement waits for drag acknowledgement', {skip:process.platform!=='win32'}, async () => {
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/desktop-camera.ps1'),'-ContractTest'],{windowsHide:true,timeout:20000});
  assert.match(stdout,/Drag acknowledgement contract passed/);
});
