function keys(storage){return Array.from({length:storage?.length||0},(_,i)=>storage.key(i)).filter(Boolean)}
function parsed(storage,key){try{return JSON.parse(storage?.getItem(key)||'null')}catch{return null}}
async function deleteMedia(database,aliases,latest){
 if(!database)return;const db=await new Promise((resolve,reject)=>{const request=database.open('process-studio',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('recordings'))request.result.createObjectStore('recordings')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close another recording tab and retry browser cleanup.'))});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('recordings','readwrite'),store=tx.objectStore('recordings');for(const alias of aliases)store.delete(alias);if(latest)store.delete('latest');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Browser media cleanup stopped.'))})}finally{db.close()}
}
export async function discardRecordingCopies(id,{localStorage:storage=globalThis.localStorage,sessionStorage:session=globalThis.sessionStorage,indexedDB:database=globalThis.indexedDB,transcript,cacheKeys=[]}={}){
 const aliases=new Set(cacheKeys.filter(Boolean)),sources=new Set(transcript?[transcript]:[]),remove=[];let latest=false;
 for(const key of keys(storage)){if(!/^process-studio-(?:latest|record-|draft-)/.test(key))continue;const draft=parsed(storage,key);if(draft?.identity?.id===id||aliases.has(draft?.identity?.key)||key==='process-studio-record-'+id){if(draft?.identity?.key)aliases.add(draft.identity.key);if(draft?.transcript)sources.add(draft.transcript);remove.push(key);if(key==='process-studio-latest')latest=true}}
 await deleteMedia(database,aliases,latest);
 for(const key of remove)storage.removeItem(key);for(const alias of aliases)storage.removeItem('process-studio-draft-'+alias);
 const job=parsed(session,'studio-active-job');if(job?.recordId===id||aliases.has(job?.key))session.removeItem('studio-active-job');
 const examples=parsed(storage,'process-studio-reviewed');if(Array.isArray(examples)){const kept=examples.filter(item=>!sources.has(item.transcript));if(kept.length!==examples.length)storage.setItem('process-studio-reviewed',JSON.stringify(kept))}
 const workflow=parsed(storage,'ps-local-workflow');try{if(workflow&&sources.has(JSON.parse(workflow.source).context))storage.removeItem('ps-local-workflow')}catch{}
}
export async function releaseUploadedMedia(identity){
 if(!identity?.id||!identity.key)return;const latest=parsed(globalThis.localStorage,'process-studio-latest')?.identity?.key===identity.key;await deleteMedia(globalThis.indexedDB,[identity.key],latest);
}
