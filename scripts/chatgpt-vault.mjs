import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

// DPAPI binds encrypted credentials to this Windows user. Values enter through
// stdin, never command arguments or PowerShell interpolation.
function protect(value, decrypt=false){
 if(process.platform!=='win32')throw Error('Saved ChatGPT sign-in currently requires Windows credential protection.');
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Windows credential protection timed out.'));},15000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2*1024*1024)child.kill()});child.stderr.resume();
  child.on('error',()=>{clearTimeout(timer);reject(Error('Windows credential protection is unavailable.'))});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.from(output.trim(),'base64')):reject(Error('Windows credential protection failed.'))});
  child.stdin.on('error',()=>{});child.stdin.end(Buffer.from(value).toString('base64'));
 });
}
export function createChatGPTVault(directory){
 const root=path.resolve(directory),file=path.join(root,'credentials.dpapi');let queue=Promise.resolve();
 return {
  async read(){
   let bytes;try{bytes=await fs.readFile(file)}catch(error){if(error.code==='ENOENT')return {hostId:'urn:uuid:'+crypto.randomUUID(),accounts:[],active:null};throw Error('ChatGPT connection storage could not be read.')}
   try{return JSON.parse((await protect(bytes,true)).toString('utf8'))}catch{throw Error('This Windows user could not unlock the saved ChatGPT connection.')}
  },
  write(value){const snapshot=JSON.stringify(value);const pending=queue.then(async()=>{const bytes=await protect(Buffer.from(snapshot));await fs.mkdir(root,{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,file)}finally{await fs.unlink(temp).catch(()=>{})}});queue=pending.catch(()=>{});return pending;}
 };
}
