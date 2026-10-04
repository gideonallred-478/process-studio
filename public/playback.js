export function mediaPermissionExpiry(value,baseUrl=globalThis.location?.href){
 try{const url=new URL(value,baseUrl),token=url.pathname.split('/transfer/video/')[1];if(!token)return null;const payload=token.split('.')[0].replaceAll('-','+').replaceAll('_','/');const data=JSON.parse(atob(payload));return Number.isFinite(data.expiresAt)?data.expiresAt:null}catch{return null}
}

export function setupManagedPlayback(video,{recordPath,record,status,retry,baseUrl=globalThis.location?.href,fetchImpl=fetch,now=Date.now}={}){
 const controller=new AbortController();let cancelLoad;let pending=null,disposed=false,terminal=false,currentUrl=record?.videoUrl||'',expiry=mediaPermissionExpiry(currentUrl,baseUrl);
 const allowedOrigin=currentUrl?new URL(currentUrl,baseUrl).origin:null;
 async function refresh({force=false}={}){
  if(disposed||terminal||!currentUrl||!force&&(!expiry||expiry-now()>60000))return;
  if(pending)return pending;
  pending=(async()=>{const time=video.currentTime||0,paused=video.paused;
   try{const response=await fetchImpl(recordPath,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}),data=await response.json();if(disposed)return;if(!response.ok){if([404,410].includes(response.status)){terminal=true;video.pause();video.removeAttribute('src');video.load()}throw Error(data.error||'Recording playback is unavailable.')}
    const target=new URL(data.videoUrl,baseUrl);if(!data.videoUrl||target.origin!==allowedOrigin||target.username||target.password)throw Error('Playback permission could not be verified.');
    if(disposed)return;if(target.href!==new URL(currentUrl,baseUrl).href){await new Promise((resolve,reject)=>{let timer;const cleanup=()=>{cancelLoad=null;clearTimeout(timer);video.removeEventListener('loadedmetadata',ready);video.removeEventListener('error',failed)};const ready=()=>{cleanup();try{video.currentTime=Math.min(time,Number.isFinite(video.duration)?Math.max(0,video.duration-.01):time)}catch{}resolve()};const failed=()=>{cleanup();reject(Error('The recording could not be loaded. Retry playback.'))};cancelLoad=()=>{cleanup();resolve()};video.addEventListener('loadedmetadata',ready,{once:true});video.addEventListener('error',failed,{once:true});timer=setTimeout(()=>{cleanup();reject(Error('Playback loading timed out. Retry playback.'))},15000);video.src=target.href;video.load()})}
    if(disposed)return;currentUrl=target.href;expiry=mediaPermissionExpiry(currentUrl,baseUrl);if(!paused)await video.play().catch(()=>{});if(status)status.textContent='';if(retry)retry.hidden=true;
   }catch(error){if(disposed)return;if(status)status.textContent=error.message+' '+(terminal?'':'Use Retry playback.');if(retry){retry.hidden=terminal;retry.disabled=terminal}}
  })().finally(()=>pending=null);return pending;
 }
 const onPlay=()=>void refresh(),onError=()=>void refresh({force:true}),onRetry=()=>void refresh({force:true}),doc=globalThis.document,onVisible=()=>{if(!doc?.hidden)void refresh()};
 video.addEventListener('play',onPlay);video.addEventListener('seeking',onPlay);video.addEventListener('error',onError);retry?.addEventListener('click',onRetry);doc?.addEventListener('visibilitychange',onVisible);const timer=setInterval(onVisible,60000);
 return {refresh,dispose(){disposed=true;controller.abort();cancelLoad?.();clearInterval(timer);video.removeEventListener('play',onPlay);video.removeEventListener('seeking',onPlay);video.removeEventListener('error',onError);retry?.removeEventListener('click',onRetry);doc?.removeEventListener('visibilitychange',onVisible)}};
}
