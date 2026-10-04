import {randomUUID} from 'node:crypto';

export function createEngineOperations({runtime,readBody,send,analyze,windowsSpeechReady,transcribeWindowsWav}) {
 const active=new Map(),cancelled=new Map();
 return async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(!['/api/transcribe-local','/api/analyze','/api/cancel'].includes(pathname)||req.method!=='POST')return false;
  if(pathname==='/api/cancel'){
   const {operationId}=JSON.parse((await readBody(req,2000)).toString());if(!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId||'')){send(res,400,{error:'Invalid processing identity.'});return true}
   cancelled.set(operationId,Date.now());for(const [id,time] of cancelled)if(Date.now()-time>120000||cancelled.size>1000)cancelled.delete(id);const operation=active.get(operationId);if(operation){operation.controller.abort(new Error('Processing cancelled.'));await operation.done}send(res,200,{stopped:true});return true;
  }
  const stage=pathname==='/api/analyze'?'analyze':'transcribe',operationId=req.headers['x-operation-id']||randomUUID();
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)){send(res,400,{error:'Invalid processing identity.'});return true}
  if(cancelled.has(operationId)){send(res,499,{error:'Processing cancelled.'});return true}
  if([...active.values()].some(operation=>operation.stage===stage)){send(res,409,{error:'A local '+(stage==='analyze'?'analysis':'transcription')+' is already running.'});return true}
  if(stage==='transcribe'&&!['audio/wav','audio/x-wav'].includes(String(req.headers['content-type']||'').split(';')[0])){send(res,415,{error:'Local transcription requires a WAV audio track.'});return true}
  const controller=new AbortController();let release;
  const operation={controller,stage,done:new Promise(resolve=>release=resolve)};active.set(operationId,operation);
  const disconnect=()=>{if(!res.writableEnded)controller.abort(new Error('Processing connection closed.'))};req.once('aborted',disconnect);res.once('close',disconnect);
  try{
   const body=await readBody(req,stage==='analyze'?250000:25*1024*1024);controller.signal.throwIfAborted();let result;
   if(stage==='analyze'){
    const input=JSON.parse(body.toString()),transcript=String(input.transcript||'').trim();if(transcript.length<20||transcript.length>12000)throw Object.assign(Error('Use a walkthrough between 20 and 12,000 characters.'),{status:400});
    if(!(await runtime.status()).ai)throw Object.assign(Error('The local model is not ready. Check Settings.'),{status:503});controller.signal.throwIfAborted();result=await analyze(transcript,{endpoint:runtime.endpoint,apiKey:runtime.apiKey,signal:controller.signal});result={...result,modelSha256:runtime.modelSha256};
   }else{
    if(!body.length)throw Object.assign(Error('The audio track is empty.'),{status:400});
    if(!runtime.speechReady&&!await windowsSpeechReady)throw Object.assign(Error('Local transcription is unavailable. Run setup-local.ps1.'),{status:503});controller.signal.throwIfAborted();
    result=runtime.speechReady?await runtime.transcribe(body,{signal:controller.signal}):{...await transcribeWindowsWav(body,{signal:controller.signal}),source:'Windows local speech'};
   }
   controller.signal.throwIfAborted();if(!res.destroyed&&!res.writableEnded)send(res,200,result);
  }catch(error){if(!res.destroyed&&!res.writableEnded)send(res,controller.signal.aborted?499:error.status||500,{error:controller.signal.aborted?'Processing cancelled.':error.message||'Processing failed.'})}
  finally{req.removeListener('aborted',disconnect);res.removeListener('close',disconnect);active.delete(operationId);release()}
  return true;
 };
}
