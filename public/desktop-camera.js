// Native desktop camera is available only through the local preview bridge.
// The browser fallback remains responsible for hosted pages and tab captures.
export function createDesktopCamera({ fetcher = fetch, selectCapture, readyTimeout = 12000 } = {}) {
  let session=null,timer=null,busy=false,video=null,layout=null,anchor=null,lastDrag=0,onAnchor=()=>{},onStatus=()=>{},generation=0;
  const state={active:false,excluded:false,bounds:null};
  const post=async(endpoint,body)=>{const response=await fetcher('/api/local/camera/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Desktop camera unavailable');return result;};
  const stop=async()=>{generation++;clearInterval(timer);timer=null;const id=session;session=null;state.active=false;state.excluded=false;if(id)await post('stop',{session:id}).catch(()=>{});};
  const canvas=typeof document!=='undefined'?document.createElement('canvas'):null;
  const send=async()=>{
    if(busy||!session)return;busy=true;const id=session;
    try{
      let frame;
      if(canvas&&video?.readyState>=2){canvas.width=240;canvas.height=240;const ctx=canvas.getContext('2d');const size=Math.min(video.videoWidth,video.videoHeight);ctx.drawImage(video,(video.videoWidth-size)/2,(video.videoHeight-size)/2,size,size,0,0,240,240);frame=canvas.toDataURL('image/jpeg',.65);}
      const result=await post('update',{session:id,anchor,radius:layout.radius/Math.min(layout.width,layout.height),lastDrag,frame});
      if(session!==id)return;
      state.bounds=result.bounds||state.bounds;state.excluded=result.excluded===true;state.active=result.ready===true;
      if(result.dragRevision>lastDrag){lastDrag=result.dragRevision;anchor=result.anchor;onAnchor(anchor);}
    }catch(error){if(session===id){onStatus(error.message);await stop();}}finally{busy=false;}
  };
  return {state,stop,move(position,nextLayout){if(nextLayout)layout=nextLayout;if(layout)anchor={x:position.cx/layout.width,y:position.cy/layout.height};},async start(options){
    await stop();const token=generation;video=options.video;layout=options.layout;anchor=options.anchor||{x:Number.isFinite(layout.cx)?layout.cx/layout.width:.85,y:Number.isFinite(layout.cy)?layout.cy/layout.height:.8};onAnchor=options.onAnchor||(()=>{});onStatus=options.onStatus||(()=>{});lastDrag=0;
    if(!options.recording)return false;
    const settings=options.track?.getSettings?.()||{};
    if(!['monitor','window'].includes(settings.displaySurface)){onStatus('Desktop camera movement is available for monitor or window captures. Drag the circle in the recording preview.');return false;}
    try{
      const response=await fetcher('/api/local/camera');if(generation!==token||!response.ok)return false;const inventory=await response.json();if(generation!==token||!inventory.available)return false;
      const surfaces=inventory.surfaces.filter(s=>s.kind===settings.displaySurface);
      // Native ids and getDisplayMedia sources cannot be matched reliably by size/title.
      // Ask explicitly unless there is exactly one monitor in the system.
      const selected=settings.displaySurface==='monitor'&&surfaces.length===1?surfaces[0]:await (options.selectCapture||selectCapture)?.(surfaces,settings);
      if(generation!==token)return false;
      if(!selected){onStatus('Choose the captured monitor or window to enable desktop camera movement.');return false;}
      const result=await post('start',{recording:true,captureId:typeof selected==='string'?selected:selected.id,anchor,radius:layout.radius/Math.min(layout.width,layout.height)});
      if(generation!==token){await post('stop',{session:result.session});return false;}session=result.session;state.bounds=result.surface.bounds;
      const deadline=Date.now()+readyTimeout;
      while(session && generation===token && Date.now()<deadline){await send();if(state.active&&state.excluded){timer=setInterval(send,100);return true;}await new Promise(resolve=>setTimeout(resolve,100));}
      if(session&&generation===token){onStatus('Desktop camera did not become ready. Use the recording preview.');await stop();}return false;
    }catch(error){if(generation===token){onStatus(error.message);await stop();}return false;}
  }};
}
