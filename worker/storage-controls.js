const queues = new Map();
export async function locked(key, fn) {
  const previous = queues.get(key) || Promise.resolve();
  let release; const next = new Promise(resolve => { release = resolve });
  queues.set(key, next); await previous;
  try { return await fn() } finally { release(); if (queues.get(key) === next) queues.delete(key) }
}
export function limit(env, name, fallback) { const value = Number(env[name]); return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback }
export async function mediaResponse(bucket, mediaKey, mime, request, baseHeaders) {
  const object = bucket.head ? await bucket.head(mediaKey) : await bucket.get(mediaKey);
  if (!object) return new Response('Recording unavailable.', { status:404, headers:baseHeaders });
  const bytes = bucket.head ? null : new Uint8Array(object.arrayBuffer ? await object.arrayBuffer() : await new Response(object.body).arrayBuffer());
  const size = bucket.head ? object.size : bytes.length;
  const responseHeaders = { ...baseHeaders, 'content-type':mime || 'video/webm', 'accept-ranges':'bytes', 'content-length':String(size) };
  const range = request.headers.get('range');
  let start=0,end=size-1,status=200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{...responseHeaders,'content-range':`bytes */${size}`,'content-length':'0'}});
    if (!match[1]) { const suffix=Number(match[2]); start=Math.max(0,size-suffix); if(!suffix) start=size }
    else { start=Number(match[1]); if(match[2]) end=Math.min(size-1,Number(match[2])) }
    if (start>=size || end<start) return new Response(null,{status:416,headers:{...responseHeaders,'content-range':`bytes */${size}`,'content-length':'0'}});
    status=206; responseHeaders['content-range']=`bytes ${start}-${end}/${size}`;responseHeaders['content-length']=String(end-start+1);
  }
  if(request.method==='HEAD')return new Response(null,{status,headers:responseHeaders});
  const ranged=bucket.head?await bucket.get(mediaKey,{...(status===206?{range:{offset:start,length:end-start+1}}:{})}):null;
  if(bucket.head&&!ranged)return new Response('Recording unavailable.',{status:404,headers:baseHeaders});
  return new Response(bucket.head?ranged.body:bytes.slice(start,end+1),{status,headers:responseHeaders});
}
export async function listAll(bucket,prefix) {
  const objects=[];let cursor;
  do { const page=await bucket.list({prefix,limit:1000,...(cursor?{cursor}:{})});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined;if(page.truncated&&!cursor)throw Error('Storage pagination did not return a cursor.'); } while(cursor);
  return objects;
}
export async function reserveQuota(env, category, amount, max, fail) {
  const bucket=env.RECORDINGS,day=new Date().toISOString().slice(0,10),quotaKey=`controls/${day}.json`;
  await locked('global-quotas',async()=>{for(let attempt=0;attempt<8;attempt++){const object=await bucket.get(quotaKey),counts=object?await object.json():{};if((counts[category]||0)+amount>max)fail('The hosted daily resource limit has been reached. Retry tomorrow or contact the workspace operator.',429);counts[category]=(counts[category]||0)+amount;const onlyIf=object?.etag?{etagMatches:object.etag}:!object?{etagDoesNotMatch:'*'}:null;const saved=await bucket.put(quotaKey,JSON.stringify(counts),{httpMetadata:{contentType:'application/json'},...(onlyIf?{onlyIf}:{})});if(saved!==null)return}fail('Hosted resource controls are busy. Retry shortly.',503)});
}
export function warningMessages(result) {
  return [...new Set([...(Array.isArray(result?.issues)?result.issues:[]),...(Array.isArray(result?.validation?.warnings)?result.validation.warnings:[]),...(Array.isArray(result?.warnings)?result.warnings:[])].map(String))];
}
