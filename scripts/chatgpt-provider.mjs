import crypto from 'node:crypto';
import {analysisPrompt,analysisSchema,validateLocalAnalysis,policyVersion} from '../local-analysis.js';
import {createChatGPTVault} from './chatgpt-vault.mjs';

const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const authorize=issuer+'/api/accounts/authorize',tokenEndpoint=issuer+'/api/accounts/oauth/token';
const scope='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const fail=(message,status=400)=>{const error=Error(message);error.status=status;throw error};
const random=()=>crypto.randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));

export function validateIdentity(token,keys,{clientId,nonce,subject,now=Date.now()}){
 let header,claims,signature,parts;
 try{parts=token.split('.');if(parts.length!==3)throw Error();header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));signature=Buffer.from(parts[2],'base64url')}catch{fail('OpenAI returned an invalid identity token.',401)}
 if(!['RS256','ES256'].includes(header.alg)||typeof header.kid!=='string')fail('Unsupported identity signature.',401);
 const jwk=keys.find(key=>key.kid===header.kid&&(!key.use||key.use==='sig')&&(!key.alg||key.alg===header.alg));
 if(!jwk||(header.alg==='RS256'&&jwk.kty!=='RSA')||(header.alg==='ES256'&&(jwk.kty!=='EC'||jwk.crv!=='P-256')))fail('The identity signing key was not found.',401);
 let valid=false;try{const key=crypto.createPublicKey({key:jwk,format:'jwk'});valid=crypto.verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),header.alg==='ES256'?{key,dsaEncoding:'ieee-p1363'}:key,signature)}catch{}
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!valid||claims.iss!==issuer||!aud.includes(clientId)||(aud.length>1&&claims.azp!==clientId)||!Number.isFinite(claims.exp)||claims.exp<=now/1000||claims.nbf>now/1000+60||!equal(claims.nonce,nonce)||typeof claims.sub!=='string'||!claims.sub||(subject&&claims.sub!==subject))fail('ChatGPT identity validation failed. Start sign-in again.',401);
 return claims;
}

export async function readResponseStream(response){
 if(!response.body)fail('ChatGPT returned an empty stream.',502);
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',completed=null,total=0,refused=false;const parts=new Map(),items=new Map();
 const event=block=>{
  const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')return;
  let item;try{item=JSON.parse(data)}catch{fail('ChatGPT returned an unreadable stream.',502)}
  if(['response.failed','response.incomplete','error'].includes(item.type))fail('ChatGPT could not complete this process. Retry or choose Local Qwen.',502);
  const key=(item.output_index??0)+':'+(item.content_index??0);
  if(item.type==='response.output_text.delta'&&typeof item.delta==='string')parts.set(key,(parts.get(key)||'')+item.delta);
  if(item.type==='response.output_text.done'&&typeof item.text==='string')parts.set(key,item.text);
  if(item.type==='response.output_item.done'&&item.item)items.set(item.output_index??items.size,item.item);
  if(item.type==='response.refusal.delta'||item.type==='response.refusal.done')refused=true;
  if(item.type==='response.completed'){if(item.response?.status!=='completed')fail('ChatGPT did not confirm completion.',502);completed=item.response}
 };
 try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>2*1024*1024)fail('ChatGPT response exceeded the process limit.',413);buffer=(buffer+decoder.decode(value,{stream:true})).replaceAll('\r\n','\n');let index;while((index=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,index));buffer=buffer.slice(index+2)}}buffer+=decoder.decode();if(buffer.trim())event(buffer);
 }catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
 if(!completed)fail('ChatGPT connection ended before completion. Your existing work was kept.',502);
 const output=completed.output?.length?completed.output:[...items.entries()].sort((a,b)=>a[0]-b[0]).map(([,item])=>item);
 const content=output.flatMap(item=>item.type==='message'?item.content||[]:[]);
 if(refused||content.some(part=>part.type==='refusal'))fail('ChatGPT declined to generate this process.',422);
 const text=content.filter(part=>part.type==='output_text').map(part=>part.text).join('')||[...parts.entries()].sort(([a],[b])=>{const [ai,ac]=a.split(':').map(Number),[bi,bc]=b.split(':').map(Number);return ai-bi||ac-bc}).map(([,text])=>text).join('');
 if(!text)fail('ChatGPT completed without a process.',502);return text;
}

export function createChatGPTProvider({directory,fetchImpl=fetch,vault=createChatGPTVault(directory),now=()=>Date.now()}={}){
 let state,initializing,attempt=null,notice='',refreshing=null,inflight=null,generation=0,disconnecting=false;
 const init=async()=>{if(state)return state;if(!initializing)initializing=vault.read().then(async value=>{state=value;await vault.write(state);return state}).catch(error=>{initializing=null;state=null;throw error});return initializing};
 const persist=()=>vault.write(state);
 const active=()=>state.accounts.find(account=>account.clientId===state.active);
 const safeAccount=account=>({id:account.clientId,label:account.email||account.name||'ChatGPT account',connected:Boolean(account.accessToken),selectedModel:account.selectedModel||'',welcomeAcknowledged:account.welcomeAcknowledged===true});
 const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
 async function remote(url,options={}){
  let response;try{response=await fetchImpl(url,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(20000)})}catch{fail('OpenAI could not be reached. Check your connection and retry.',503)}return response;
 }
 async function tokenRequest(values){const response=await remote(tokenEndpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});let data;try{data=await response.json()}catch{fail('OpenAI token response was unreadable.',502)}if(!response.ok)fail(data.error==='invalid_grant'?'ChatGPT access expired. Sign in again.':'ChatGPT access could not be renewed. Sign in again.',401);return data;}
 function credentials(data,previous={}){
  const scopes=typeof data.scope==='string'?data.scope.split(/\s+/):previous.scopes||[];
  if(!scopes.includes('chatgpt.tokens.use.direct'))fail('ChatGPT plan usage was not authorized. Sign in and enable plan usage.',403);
  if(typeof data.access_token!=='string'||!data.access_token||String(data.token_type).toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0)fail('OpenAI returned incomplete access credentials.',502);
  return {accessToken:data.access_token,refreshToken:data.refresh_token||previous.refreshToken,idToken:data.id_token||previous.idToken,scopes,expiresAt:now()+data.expires_in*1000,earliestRefreshAt:data.earliest_refresh_at||null};
 }
 async function access(account){
  if(disconnecting)fail('ChatGPT is disconnecting. Wait before starting another request.',409);
  if(!account?.accessToken)fail('Connect your ChatGPT account in Settings first.',401);
  if(account.expiresAt>now()+60000)return account.accessToken;
  if(!account.refreshToken)fail('ChatGPT access expired. Sign in again.',401);
  if(refreshing){await refreshing;return access(account)}
  refreshing=(async()=>{const data=await tokenRequest({grant_type:'refresh_token',client_id:account.clientId,refresh_token:account.refreshToken,resource});Object.assign(account,credentials(data,account));await persist();return account.accessToken})().finally(()=>{refreshing=null});
  return refreshing;
 }
 async function catalog(account){
  const token=await access(account);const response=await remote(resource+'/models',{headers:{authorization:'Bearer '+token}});
  if(!response.ok)fail(response.status===401?'ChatGPT access expired. Sign in again.':'The account model list is unavailable. Refresh or sign in again.',response.status===401?401:502);
  const data=await response.json();if(!Array.isArray(data.models))fail('ChatGPT returned an invalid model list.',502);
  const models=data.models.filter(model=>model.visibility==='list'&&typeof model.slug==='string'&&typeof model.display_name==='string').map(model=>({id:model.slug,name:model.display_name}));
  if(!models.length)fail('This ChatGPT account has no eligible models available.',403);return models;
 }
 async function start(body){
  if(inflight||disconnecting||refreshing)fail('Finish processing or reconnecting before changing ChatGPT accounts.',409);
  const known=body.accountId?state.accounts.find(account=>account.clientId===body.accountId):null;
  if(body.accountId&&!known)fail('Select a saved ChatGPT account or add a new one.');
  generation++;const verifier=random(),callback='http://127.0.0.1:4182/auth/callback';
  attempt={state:random(),nonce:random(),verifier,callback,expiresAt:now()+10*60000,clientId:known?.clientId,subject:known?.subject};notice='Complete sign-in in the OpenAI window.';
  const params=new URLSearchParams({client_id:known?.clientId||'dynamic_agent_client',ext_agent_host_id:state.hostId,response_type:'code',redirect_uri:callback,scope,resource,state:attempt.state,nonce:attempt.nonce,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')});
  if(!known)params.set('agent_name_hint','Process Studio');if(known?.email)params.set('login_hint',known.email);
  return {url:authorize+'?'+params,pending:true};
 }
 async function callback(url){
  const pending=attempt;if(!pending||pending.expiresAt<now()||!equal(url.searchParams.get('state'),pending.state))fail('This sign-in link is expired or invalid. Return to Settings and start again.',401);
  attempt=null;
  if(url.searchParams.has('error')){notice='Sign-in cancelled or plan usage declined. Local Qwen is still available.';return}
  const code=url.searchParams.get('code'),issued=url.searchParams.get('client_id');
  if(!code||code.length>4096||(!pending.clientId&&(!issued||issued==='dynamic_agent_client'))||(issued&&pending.clientId&&issued!==pending.clientId))fail('ChatGPT registration was incomplete. Start sign-in again.',401);
  const clientId=pending.clientId||issued;if(!/^[a-zA-Z0-9_-]{1,256}$/.test(clientId))fail('Invalid ChatGPT registration.',401);
  let account=state.accounts.find(item=>item.clientId===clientId);if(!account){if(state.accounts.length>=20)fail('Too many saved accounts. Disconnect an account before adding another.');account={clientId};state.accounts.push(account);await persist()}
  const epoch=generation;
  const data=await tokenRequest({grant_type:'authorization_code',client_id:clientId,code,code_verifier:pending.verifier,redirect_uri:pending.callback,resource});
  const keysResponse=await remote(issuer+'/.well-known/jwks.json');if(!keysResponse.ok)fail('OpenAI identity keys could not be checked.',502);
  const keys=await keysResponse.json();const identity=validateIdentity(data.id_token,keys.keys||[],{clientId,nonce:pending.nonce,subject:pending.subject||account.subject,now:now()});
  const tokens=credentials(data);if(epoch!==generation)fail('The selected connection changed during sign-in.',409);
  Object.assign(account,tokens,{subject:identity.sub,email:typeof identity.email==='string'?identity.email:undefined,name:typeof identity.name==='string'?identity.name:undefined});state.active=clientId;await persist();notice='ChatGPT connected. Choose a model and allow online transcript processing.';
 }
 async function disconnect(){
  if(disconnecting)fail('ChatGPT is already disconnecting.',409);
  disconnecting=true;attempt=null;inflight?.abort();
  if(refreshing)await refreshing.catch(()=>{});
  generation++;
  const account=active();let revoked=true;
  if(account?.refreshToken){revoked=false;try{const discovery=await remote(issuer+'/.well-known/openid-configuration');const config=await discovery.json();const endpoint=new URL(config.revocation_endpoint);if(endpoint.origin!==issuer)throw Error();const response=await remote(endpoint.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:account.refreshToken,token_type_hint:'refresh_token',client_id:account.clientId})});revoked=response.status===200}catch{}}
  try{if(account){for(const key of ['accessToken','refreshToken','idToken','scopes','expiresAt','earliestRefreshAt'])delete account[key];await persist()}}finally{disconnecting=false}
  notice=revoked?'Disconnected.':'Disconnected locally. Remote revocation was not confirmed; remove access in ChatGPT Settings.';return {revoked,notice};
 }
 async function analyze(body){
  if(body.consent!==true)fail('Allow sending this transcript to OpenAI in Settings before generating.',403);
  const transcript=String(body.transcript||'').trim();if(transcript.length<20||transcript.length>12000)fail('Use a walkthrough between 20 and 12,000 characters.');
  if(inflight)fail('A ChatGPT process is already running. Finish or cancel it first.',409);
  const account=active(),epoch=generation,controller=new AbortController();inflight=controller;
  try{const models=await catalog(account),model=account.selectedModel||models[0].id;if(!models.some(item=>item.id===model))fail('Your chosen model is unavailable. Select another in Settings.',409);
   const token=await access(account);if(epoch!==generation)fail('ChatGPT account changed. Retry.',409);
   const response=await remote(resource+'/responses',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(360000)]),body:JSON.stringify({model,input:[{role:'user',content:transcript}],instructions:analysisPrompt,store:false,stream:true,text:{format:{type:'json_schema',name:'process',strict:true,schema:analysisSchema}}})});
   if(!response.ok)fail(response.status===429?'ChatGPT usage is currently limited. Check Manage usage or choose Local Qwen.':response.status===401?'ChatGPT access expired. Sign in again.':'ChatGPT could not generate this process. Retry or choose Local Qwen.',response.status===429?429:502);
   const text=await readResponseStream(response);if(epoch!==generation||controller.signal.aborted)fail('Processing cancelled. Your last saved work was kept.',409);
   let raw;try{raw=JSON.parse(text)}catch{fail('ChatGPT did not return a complete structured process.',422)}
   const result=validateLocalAnalysis(raw,transcript);return {...result,method:'chatgpt-plan',model,policyVersion};
  }finally{if(inflight===controller)inflight=null}
 }
 async function bodyOf(request){const reader=request.body?.getReader();let size=0,parts=[];if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>60000){await reader.cancel();fail('Request is too large.',413)}parts.push(value)}try{return JSON.parse(Buffer.concat(parts).toString())}catch{fail('Provide valid settings.')}}
 return async request=>{
  const url=new URL(request.url),callbackRoute=url.pathname==='/auth/callback';if(!callbackRoute&&!url.pathname.startsWith('/api/chatgpt/'))return null;
  try{
   if(!['http://127.0.0.1:4182','http://localhost:4182'].includes(url.origin))fail('ChatGPT sign-in is available in the local studio only.',403);
   if(callbackRoute){if(request.method!=='GET'||url.hostname!=='127.0.0.1')fail('Invalid sign-in callback.',403);await init();await callback(url);return new Response('<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Process Studio · ChatGPT</title></head><body><h1>Return to Process Studio</h1><p>Sign-in finished. You can close this window and return to Settings.</p><a href="/settings.html">Open Settings</a></body></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"}})}
   if(request.headers.get('sec-fetch-site')==='cross-site'||(request.method!=='GET'&&request.headers.get('origin')!==url.origin))fail('Open this request from your local studio.',403);
   if(!request.headers.get('cookie'))fail('Open your workspace first.',401);
   await init();const name=url.pathname.slice('/api/chatgpt/'.length);
   if(name==='status'&&request.method==='GET'){if(attempt?.expiresAt<now()){attempt=null;notice='Sign-in timed out. Try again.'}return json({available:true,ai:Boolean(active()?.accessToken&&active()?.scopes?.includes('chatgpt.tokens.use.direct')),account:active()?safeAccount(active()):null,accounts:state.accounts.map(safeAccount),pending:Boolean(attempt),notice})}
   if(name==='models'&&request.method==='GET'){const account=active();return json({models:await catalog(account),selectedModel:account?.selectedModel||'',accountId:account?.clientId})}
   if(request.method!=='POST')fail('Method not allowed.',405);
   const body=await bodyOf(request);
   if(name==='start')return json(await start(body));
   if(name==='cancel-sign-in'){attempt=null;generation++;notice='Sign-in cancelled. Your existing connection was kept.';return json({cancelled:true})}
   if(name==='disconnect')return json(await disconnect());
   if(name==='welcome'){const account=active();if(!account?.accessToken)fail('Connect ChatGPT first.',401);account.welcomeAcknowledged=true;await persist();return json({acknowledged:true})}
   if(name==='cancel'){inflight?.abort();return json({cancelled:true})}
   if(name==='model'){if(inflight)fail('Finish processing before changing the model.',409);const account=active(),models=await catalog(account);if(!models.some(item=>item.id===body.model))fail('Choose an available ChatGPT model.');account.selectedModel=body.model;await persist();return json({selectedModel:body.model})}
   if(name==='analyze')return json(await analyze(body));
   fail('Not found.',404);
  }catch(error){if(callbackRoute){notice=error.status?error.message:'Sign-in could not finish. Return to Settings and retry.';return new Response('Sign-in did not finish. Return to Process Studio Settings and retry.',{status:error.status||500,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','content-type':'text/plain'}})}return json({available:true,ai:false,error:error.status?error.message:'ChatGPT processing could not complete. Your saved work was kept.'},error.status||500)}
 };
}
