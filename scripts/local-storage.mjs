import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {locked} from '../worker/storage-controls.js';

export function createFileBucket(directory,{fs:io=fs}={}) {
 const root=path.resolve(directory),etag=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const filename=key=>{const file=path.resolve(root,key);if(!file.startsWith(root+path.sep))throw Error('Invalid storage key.');return file};
 async function bytes(file){try{return await io.readFile(file)}catch(error){if(error.code==='ENOENT')return null;throw error}}
 async function replace(file,value){const temporary=file+'.'+crypto.randomUUID()+'.tmp';try{await io.mkdir(path.dirname(file),{recursive:true});await io.writeFile(temporary,value,{flag:'wx'});const handle=await io.open(temporary,'r+');try{await handle.sync()}finally{await handle.close()}for(let attempt=0;;attempt++){try{await io.rename(temporary,file);break}catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=5)throw error;await new Promise(resolve=>setTimeout(resolve,10*(attempt+1)))}}}finally{await io.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error})}}
 async function previous(file){const value=await bytes(file+'.previous');if(!value)return null;try{JSON.parse(value.toString());return value}catch{return null}}
 const bucket={
  async put(key,value,options={}) {const file=filename(key);return locked('file:'+file,async()=>{const old=await bytes(file);if(options.onlyIf?.etagMatches&&(!old||etag(old)!==options.onlyIf.etagMatches)||options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const next=typeof value==='string'?Buffer.from(value):Buffer.from(value);
   if(old&&key.endsWith('.json')){let valid=false;try{JSON.parse(old.toString());valid=true}catch{}if(valid)await replace(file+'.previous',old)}
   await replace(file,next);return {etag:etag(next)};
  })},
  async get(key,options={}) {const file=filename(key);return locked('file:'+file,async()=>{const value=await bytes(file);if(value===null)return null;const start=options.range?.offset??0,length=options.range?.length??value.length;return {etag:etag(value),size:value.length,body:options.range?value.subarray(start,start+length):value,
   async json(){try{return JSON.parse(value.toString())}catch{const recoverable=Boolean(await previous(file));throw Object.assign(Error('This recording is damaged. Restore its previous saved version or download the damaged data.'),{status:409,storageCorrupt:true,details:{corrupted:true,recoverable}})}},
   async arrayBuffer(){return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)}
  }})},
  async delete(key){const file=filename(key);return locked('file:'+file,async()=>{let entries=[];try{entries=await io.readdir(path.dirname(file))}catch(error){if(error.code!=='ENOENT')throw error}const abandoned=entries.filter(name=>name.startsWith(path.basename(file)+'.')&&name.endsWith('.tmp')).map(name=>path.join(path.dirname(file),name));for(const target of [file,file+'.previous',file+'.meta',...abandoned])await io.unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error})})},
  async list({prefix='',limit=1000,cursor}={}){const rows=[];async function visit(folder){let entries;try{entries=await io.readdir(folder,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return;throw error}for(const entry of entries){const file=path.join(folder,entry.name);if(entry.isDirectory())await visit(file);else if(!/\.(?:meta|previous|tmp)$/.test(entry.name)){const key=path.relative(root,file).replaceAll('\\','/');if(key.startsWith(prefix))rows.push({key})}}}await visit(root);rows.sort((a,b)=>a.key.localeCompare(b.key));const start=cursor?rows.findIndex(row=>row.key===cursor)+1:0,objects=rows.slice(start,start+limit),truncated=start+limit<rows.length;return {objects,truncated,...(truncated?{cursor:objects.at(-1).key}:{})}},
  async recover(key){const file=filename(key);return locked('file:'+file,async()=>{const current=await bytes(file);if(!current)throw Object.assign(Error('Recording not found.'),{status:404});let healthy=false;try{JSON.parse(current.toString());healthy=true}catch{}if(healthy)throw Object.assign(Error('This recording is healthy. Its current saved version was kept.'),{status:409});const value=await previous(file);if(!value)throw Object.assign(Error('No valid previous version is available. Download the damaged data before removing it.'),{status:409});await replace(file,value);return true})}
 };
 return bucket;
}
