// Fixed, read-only provider probes. Tokens are used once and never stored.
export async function connectionCheck(request,fetchImpl=fetch){
 const url=new URL(request.url);if(url.pathname!=='/api/connections/check')return null;
 const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 if(!['http://127.0.0.1:4182','http://localhost:4182'].includes(url.origin)||request.headers.get('origin')!==url.origin)return json({error:'Open the connection check from your local studio.'},403);
 if(request.method!=='POST')return json({error:'Use the local connection form.'},405);
 let body;try{const reader=request.body?.getReader();let size=0;const parts=[];if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();return json({error:'Connection settings are too large.'},413);}parts.push(value);}body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{return json({error:'Provide valid connection settings.'},400);}
 const {provider,token,resource}=body||{};
 if(!['google-sheets','gmail','slack'].includes(provider)||typeof token!=='string'||!token.trim()||token.length>4096||/[\r\n]/.test(token))return json({error:'Choose a supported app and provide a temporary access token.'},400);
 if(provider==='google-sheets'&&(typeof resource!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(resource)))return json({error:'Provide the spreadsheet ID, not a URL.'},400);
 const endpoint=provider==='google-sheets'?'https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(resource)+'?fields=spreadsheetId,sheets.properties':provider==='gmail'?'https://gmail.googleapis.com/gmail/v1/users/me/profile':'https://slack.com/api/auth.test';
 try{
  const response=await fetchImpl(endpoint,{method:provider==='slack'?'POST':'GET',headers:{authorization:'Bearer '+token.trim()},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)return json({provider,readAccessVerified:false,writeAccessVerified:false,error:response.status===401||response.status===403?'Access was refused. Check token expiry and the required permissions.':'The resource could not be read. Check its ID and account access.'},response.status===401||response.status===403?response.status:502);
  const data=await response.json();
  const verified=provider==='google-sheets'?data.spreadsheetId===resource:provider==='gmail'?typeof data.emailAddress==='string':data.ok===true;
  if(!verified)return json({provider,readAccessVerified:false,writeAccessVerified:false,error:'The provider did not confirm the expected resource or account.'},502);
  return json({provider,probe:provider==='google-sheets'?'spreadsheet-metadata':provider==='gmail'?'account-profile':'authentication',readAccessVerified:provider!=='slack',accountAccessVerified:true,writeAccessVerified:false,checkedAt:new Date().toISOString(),resource:provider==='google-sheets'?resource:undefined,note:provider==='slack'?'Workspace authentication verified. Channel access and message actions still need verification.':provider==='gmail'?'Gmail profile access verified. Reading messages, field mappings and write permissions still need verification.':'Spreadsheet metadata read access verified. Cell access, field mappings and write permission still need verification.'});
 }catch{return json({provider,readAccessVerified:false,writeAccessVerified:false,error:'The connection check could not complete. Check your network and retry.'},502);}
}
