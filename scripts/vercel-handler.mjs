import worker from '../lib/studio-worker.mjs';
import {hostedRelay} from '../lib/hosted-relay.mjs';

// This deployment never loads the desktop auth provider, a token vault, or
// environment AI keys. Local accounts cannot become shared hosted accounts.
export async function hostedResponse(request) {
  const relayed=await hostedRelay(request);if(relayed)return relayed;
  const path = new URL(request.url).pathname;
  const json = (body, status = 200) => Response.json(body, {status, headers:{'cache-control':'no-store'}});
  if (path === '/api/chatgpt/status') return json({available:false,ai:false,account:null,accounts:[],pending:false,notice:'Not signed in. Hosted ChatGPT subscription access requires separate OpenAI eligibility.'});
  if (path.startsWith('/api/chatgpt/')) return json({error:'ChatGPT is signed out. Subscription sign-in is currently available only in the local edition.'},403);
  if (path === '/api/local/status') return json({available:false,ai:false,localSpeech:false});
  if (path.startsWith('/api/local/') || path.startsWith('/api/desktop/')) return json({error:'This feature needs the local edition on your computer.'},503);
  const response = await worker.fetch(request, {});
  if(response.headers.get('content-type')?.startsWith('text/html')&&process.env.STUDIO_BACKEND_URL){try{const backend=new URL(process.env.STUDIO_BACKEND_URL);if(backend.protocol==='https:'&&backend.hostname.endsWith('.workers.dev'))response.headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' "+backend.origin+"; media-src 'self' blob: "+backend.origin+"; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'");}catch{}}
  if (request.method !== 'HEAD' && response.headers.get('content-type')?.startsWith('text/html')) {
    const html = (await response.text()).replace('<body>', '<body><aside role="status" style="padding:10px 18px;background:#eaf2ff;color:#1746a2;font:13px system-ui;text-align:center">Record and process locally, share online. ChatGPT is signed out here. <a href="/local.html">Get the local edition</a>.</aside>');
    return new Response(html,{status:response.status,headers:response.headers});
  }
  return response;
}
export default async function handler(req, res) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (value != null) headers.set(name, Array.isArray(value) ? value.join(',') : value);
  const url = 'https://' + req.headers.host + req.url;
  const request = new Request(url, {method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
  const response = await hostedResponse(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
