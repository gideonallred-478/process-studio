const attempts=new Map();
function uploadAttempt(key){if(attempts.has(key))return attempts.get(key);try{const value=Number(sessionStorage.getItem('studio-upload-attempt:'+key));if(Number.isInteger(value)&&value>=0&&value<=100)return value;}catch{}return 0;}
function advanceAttempt(key){const next=uploadAttempt(key)+1;attempts.set(key,next);try{sessionStorage.setItem('studio-upload-attempt:'+key,String(next));}catch{}}
export async function uploadRecording(blob,kind,filename,key,api,fetchImpl=fetch){
 if(!blob)return api('/api/recordings',{method:'POST',headers:{'content-type':'application/json','x-recording-key':key},body:JSON.stringify({kind,filename:filename||'Written walkthrough'})});
 const status=await api('/api/status');const mime=blob.type.split(';')[0];
 if(!status.directUploads)return api('/api/recordings',{method:'POST',headers:{'content-type':mime,'x-recording-key':key,'x-recording-kind':kind,'x-recording-name':encodeURIComponent(filename||'walkthrough.webm')},body:blob});
 for(let renewal=0;renewal<3;renewal++){
 let grant;try{grant=await api('/api/uploads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key,attempt:uploadAttempt(key),size:blob.size,mime,kind,filename:filename||'walkthrough.webm'})});}catch(error){if(error.status===410){advanceAttempt(key);continue;}throw error;}
 const target=new URL(grant.uploadUrl);if(target.origin!==status.mediaOrigin||target.protocol!=='https:'||target.username||target.password||target.pathname!=='/transfer/upload/'+grant.uploadId)throw Error('The upload destination failed validation. Your browser copy is retained.');
 if(grant.status!=='complete'){const response=await fetchImpl(target.href,{method:'PUT',headers:{'content-type':mime},body:blob,mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(180000)});if(response.status===410){advanceAttempt(key);continue;}if(!response.ok&&response.status!==409)throw Error((await response.json()).error||'Direct upload failed. Retry the saved browser copy.');}
 try{return await api('/api/uploads/'+grant.uploadId+'/complete',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});}catch(error){if(error.status===410){advanceAttempt(key);continue;}throw error;}
 }
 throw Error('Upload permissions expired. Retry the saved browser copy; the recording identity is retained.');
}
