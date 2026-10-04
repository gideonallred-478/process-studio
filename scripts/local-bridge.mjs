const base='http://127.0.0.1:4173';
const routes={'/api/local/status':'/api/status','/api/local/analyze':'/api/analyze','/api/local/transcribe':'/api/transcribe-local'};
export async function localBridge(request,fetchImpl=fetch){
 const url=new URL(request.url),path=routes[url.pathname];if(!path)return null;
 const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
 if(!['localhost','127.0.0.1'].includes(url.hostname))return json({error:'Local AI is available only on this computer.'},403);
 const method=url.pathname.endsWith('/status')?'GET':'POST';if(request.method!==method)return json({error:'Method not allowed.'},405);
 if(method==='POST'&&request.headers.get('origin')!==url.origin)return json({error:'Open this request from the studio.'},403);
 try{
  let body;
  if(method==='POST'){
   const max=url.pathname.endsWith('/transcribe')?25*1024*1024:250000;
   const reader=request.body?.getReader(),parts=[];let size=0;
   if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return json({error:'Local processing input is too large.'},413)}parts.push(value)}
   body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length}
  }
  const response=await fetchImpl(base+path,{method,headers:{origin:base,'content-type':request.headers.get('content-type')||'application/json'},body,redirect:'error',signal:AbortSignal.timeout(method==='GET'?3000:390000)});
  const data=await response.json();return json(method==='GET'?{...data,available:true}:data,response.status);
 }catch{return json({available:false,ai:false,localSpeech:false,error:'Local AI is unavailable. Start the installed local studio on port 4173 and retry.'},503)}
}
