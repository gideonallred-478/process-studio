import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const helper=fileURLToPath(new URL('./desktop-camera.ps1',import.meta.url));
const execute=promisify(execFile);
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function inventory(){const {stdout}=await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',helper,'-Inventory'],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});return JSON.parse(stdout.trim());}
async function launch(directory){return spawn('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',helper,'-Directory',directory],{windowsHide:true,stdio:'ignore'});}
export function createDesktopCameraBridge(options={}) {
  const sessions=new Map();
  const list=options.inventory||inventory,run=options.launch||launch,platform=options.platform||process.platform;
  const cleanup=async(id)=>{const s=sessions.get(id);if(!s)return;sessions.delete(id);clearTimeout(s.expiry);s.child?.kill();await fs.rm(s.directory,{recursive:true,force:true});};
  const touch=(id,s)=>{clearTimeout(s.expiry);s.expiry=setTimeout(()=>cleanup(id).catch(()=>{}),12000);s.expiry.unref();};
  return async function desktopCameraBridge(request){
    const url=new URL(request.url);if(!url.pathname.startsWith('/api/local/camera'))return null;
    if(!['localhost','127.0.0.1'].includes(url.hostname))return reply({error:'Local access only'},403);
    const origin=request.headers.get('origin');if((request.method==='POST' && origin!==url.origin)||(origin&&origin!==url.origin))return reply({error:'Same-origin access required'},403);
    if(platform!=='win32')return reply({available:false,reason:'Desktop camera requires Windows'},200);
    try {
      if(url.pathname==='/api/local/camera'&&request.method==='GET')return reply({available:true,...await list()});
      if(request.method!=='POST')return reply({error:'POST required'},405);
      if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'JSON required'},415);
      const raw=await request.text();if(raw.length>250000)return reply({error:'Camera frame too large'},413);
      const body=JSON.parse(raw);
      if(url.pathname.endsWith('/start')){
        if(body.recording!==true)return reply({error:'Start only during active recording'},400);
        if(body.anchor && ![body.anchor.x,body.anchor.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))return reply({error:'Invalid camera anchor'},400);
        if(body.radius !== undefined && (!Number.isFinite(body.radius)||body.radius<.02||body.radius>.45))return reply({error:'Invalid camera radius'},400);
        if(sessions.size)return reply({error:'Desktop camera already in use'},409);
        const surface=(await list()).surfaces.find(s=>s.id===body.captureId);
        if(!surface||!['monitor','window'].includes(surface.kind))return reply({error:'Select the captured monitor or window'},400);
        const directory=await fs.mkdtemp(path.join(os.tmpdir(),'process-studio-camera-'));
        const id=randomUUID(),s={directory,surface};
        await fs.writeFile(path.join(directory,'state.json'),JSON.stringify({captureId:surface.id,anchor:body.anchor||{x:.85,y:.8},radius:body.radius||.11,active:true,acknowledgedDragRevision:0}));
        sessions.set(id,s);touch(id,s);
        try{s.child=await run(directory);s.child?.on?.('error',()=>cleanup(id).catch(()=>{}));s.child?.on?.('exit',()=>{s.exited=true;});}catch(error){await cleanup(id);throw error;}
        return reply({session:id,surface});
      }
      const s=sessions.get(body.session);if(!s)return reply({error:'Camera session expired'},404);
      if(url.pathname.endsWith('/stop')){await cleanup(body.session);return reply({stopped:true});}
      if(!url.pathname.endsWith('/update'))return reply({error:'Unknown camera action'},404);
      touch(body.session,s);
      const anchor=body.anchor;
      if(!anchor||![anchor.x,anchor.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))return reply({error:'Invalid camera anchor'},400);
      const radius=Number(body.radius);if(!Number.isFinite(radius)||radius<.02||radius>.45)return reply({error:'Invalid camera radius'},400);
      const acknowledgedDragRevision=body.lastDrag??0;
      if(!Number.isSafeInteger(acknowledgedDragRevision)||acknowledgedDragRevision<0)return reply({error:'Invalid drag acknowledgement'},400);
      if(body.frame){
        if(typeof body.frame!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.frame))return reply({error:'JPEG frame required'},400);
        const bytes=Buffer.from(body.frame.split(',')[1],'base64');
        if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)return reply({error:'Malformed JPEG frame'},400);
        await fs.writeFile(path.join(s.directory,'frame.jpg'),bytes);
      }
      await fs.writeFile(path.join(s.directory,'state.json'),JSON.stringify({captureId:s.surface.id,anchor,radius,active:true,acknowledgedDragRevision}));
      const status=await fs.readFile(path.join(s.directory,'status.json'),'utf8').then(JSON.parse).catch(()=>({ready:false}));
      if(status.error){await cleanup(body.session);return reply({error:status.error},422);}
      if(s.exited){await cleanup(body.session);return reply({error:'Desktop camera closed. Use the recording preview.'},503);}
      return reply(status);
    }catch(error){return reply({error:'Desktop camera unavailable: '+error.message},503);}
  };
}
export const desktopCameraBridge=createDesktopCameraBridge();
