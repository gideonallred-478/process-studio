import {setupCaptions,reconcileCaptionText} from '/captions.js';
import {getPreferences,cameraTarget} from '/preferences.js';
import {renderAutomation} from '/automation-ui.js';
import {buildBlueprint} from '/blueprint.js';
import {setupSettings,showEngineStatus} from '/settings.js';
import { setupCloud, ensureRecording, resetRecording, adoptRecording, saveProcess, transcribeSaved, analyzeSaved, progress, recordingIdentity, restoreIdentity, queueAutosave, resumeLocalJob, cancelLocalJob } from '/cloud.js';
import { assessStep, normalizeResult } from '/decision-policy.js';
import { auditEvidence, makeDraft, makePastedDraft, moveStep, splitStep, mergeStep } from '/shared.js';
import { createDesktopCamera } from '/desktop-camera.js';
import { setupRecovery } from '/recovery.js';
import { cameraLayout } from '/camera-layout.js';
import { nearbyPlacements, anchorFromWindow, anchorFromPreviewPointer, scorePlacements, choosePlacement } from '/camera-placement.js';

const $ = id => document.getElementById(id);
const desktop=createDesktopCamera({selectCapture:async surfaces=>new Promise(resolve=>{const dialog=$('captureDialog'),select=$('captureSurface');select.replaceChildren(...surfaces.map(surface=>{const option=document.createElement('option');option.value=surface.id;option.textContent=surface.title||surface.name||surface.id;return option}));dialog.showModal();const finish=value=>{dialog.close();$('captureConfirm').onclick=null;$('captureCancel').onclick=null;resolve(value)};$('captureConfirm').onclick=()=>finish(select.value);$('captureCancel').onclick=()=>finish(null);dialog.oncancel=()=>finish(null)})});
const sampleTranscript = `First, open the new customer inquiry in the CRM and check the service they asked about. Then copy the customer's name, email, and requested date into our follow-up sheet. I read their message to decide whether it is a routine booking question or something the manager needs to review. For a routine question, choose the matching response template and personalize the opening line. If the customer mentions a complaint or a refund, flag it for the manager instead of sending a template. Next, send the reply from the shared inbox and add a note to the CRM. We need to follow up after two business days if the customer has not replied. Finally, review the sheet each Friday to check that no inquiries were missed.`;
const sampleResult = {
  title: 'Respond to a new customer inquiry',
  owner: '', trigger: 'A new customer inquiry arrives.', outcome: 'The inquiry is logged, answered or flagged, and followed up.', exception: 'Complaints and refund requests go to the manager.',
  summary: 'A practical follow-up process for routine inquiries. Complaints and refunds stay with the manager; any CRM or inbox automation would need an authorized connection.',
  steps: [
    { title: 'Check the inquiry', instruction: 'Open the new inquiry in the CRM and identify the requested service.', evidence: 'open the new customer inquiry in the CRM and check the service they asked about', category: 'integration', reason: 'Reading CRM records requires a connected, authorized account.' },
    { title: 'Log the request', instruction: 'Record the customer’s name, email, and requested date in the follow-up sheet.', evidence: "copy the customer's name, email, and requested date into our follow-up sheet", category: 'automate', reason: 'The field mapping is repeatable once the CRM and sheet are connected.' },
    { title: 'Route sensitive cases', instruction: 'Review the message. Send complaints or refund requests to the manager.', evidence: 'If the customer mentions a complaint or a refund, flag it for the manager instead of sending a template', category: 'human', reason: 'Sensitive cases need a person to judge context and respond.' },
    { title: 'Prepare a reply', instruction: 'For a routine question, choose the matching template and personalize its opening.', evidence: 'choose the matching response template and personalize the opening line', category: 'human', reason: 'A draft can be prepared automatically, but the final wording deserves review.' },
    { title: 'Send and record', instruction: 'Send the reply from the shared inbox and add a CRM note.', evidence: 'send the reply from the shared inbox and add a note to the CRM', category: 'integration', reason: 'Sending and logging require inbox and CRM integrations.' },
    { title: 'Follow up', instruction: 'If there is no reply after two business days, create a follow-up reminder.', evidence: 'follow up after two business days if the customer has not replied', category: 'automate', reason: 'This is a clear time-based rule, pending business calendar setup.' },
    { title: 'Check exceptions', instruction: 'Each Friday, inspect the sheet for inquiries that were missed.', evidence: 'review the sheet each Friday to check that no inquiries were missed', category: 'human', reason: 'A report could help, but someone should resolve the exceptions.' }
  ],
  actions: [
    { text: 'Follow up after two business days if the customer has not replied.', evidence: 'follow up after two business days if the customer has not replied' },
    { text: 'Flag complaints or refund requests for the manager.', evidence: 'If the customer mentions a complaint or a refund, flag it for the manager instead of sending a template' },
    { text: 'Review the follow-up sheet each Friday for missed inquiries.', evidence: 'review the sheet each Friday to check that no inquiries were missed' }
  ]
};

const state = { mode: null, ai: false, localSpeech: false, recorder: null, stream: null, cameraStream: null, cameraPending: null, floatWindow: null, floatVideo: null, lastFloatBounds: null, cameraAnchor: null, anchorSource: null, dragOffset: null, compositor: null, recordingKind: null, audioContext: null, chunks: [], blob: null, blobUrl: null, fileName: '', transcriptSource: 'none', segments: [], method: null, result: null, recordingStarted: 0, timer: null, transcribing: false };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const categoryLabel = { automate: '✦ Automate', human: '◉ Human', integration: '↗ Integration' };
const recordingLabel = kind => ({ screen: 'screen', 'screen-camera': 'screen + camera', 'camera-only': 'camera only', 'sample-audio': 'sample audio', import: 'imported' })[kind] || 'video';

function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 4200); }
function words(value) { return (value.trim().match(/\S+/g) || []).length; }
function updateWords() { $('retryProcessing').classList.toggle('hidden',!state.blob&&!state.result);$('cancelProcessing').classList.toggle('hidden',getPreferences().aiMode==='hosted'||!state.transcribing&&!state.analyzing); $('wordCount').textContent = `${words($('transcript').value)} words`; const ready = $('transcript').value.trim().length >= 20 && $('transcript').value.trim().length <= 12000 && (['sample', 'paste'].includes(state.mode) || $('reviewCheck').checked); $('generateBtn').disabled = !ready || state.transcribing || state.analyzing; $('generateHint').textContent = $('transcript').value.trim().length>12000 ? 'Your full source is kept. AI analysis supports up to 12,000 characters; split this walkthrough before generating.' : state.mode === 'sample' ? 'Sample source. Edit it or explore the prepared process.' : state.mode === 'paste' ? 'Edit your notes above, then regenerate the draft at any time.' : $('reviewCheck').checked ? 'Transcript reviewed. Generated steps will show whether their source quotes match.' : 'Play the recording, correct the transcript, then check the review box.'; }
function setTranscript(value, source, help) { const changed = $('transcript').value.trim() !== String(value).trim(); $('transcript').value = value; state.transcriptSource = source; $('transcriptSource').textContent = source; if (help) $('transcriptHelp').textContent = help; if (state.mode !== 'sample') $('reviewCheck').checked = false; if (changed && state.result && !$('results').classList.contains('hidden')) { state.method = 'stale'; $('resultNotice').textContent = 'Transcript changed after this process was generated. Regenerate before using or exporting it.'; updateEvidenceUI(); } updateWords(); lastCaptionTranscript=$('transcript').value;captions.refresh(); persistMetadata(); }
$('transcriptCues').addEventListener('input',event=>{const cue=event.target.closest('.cue');if(!cue||!event.target.matches('textarea'))return;const part=state.segments[Number(cue.dataset.index)];if(!part)return;const previous=state.segments.map(part=>part.text).join(' ').replace(/\s+/g,' ').trim();part.text=event.target.value;const transcript=$('transcript').value.replace(/\s+/g,' ').trim();if(transcript===previous)setTranscript(state.segments.map(part=>part.text).join(' '),state.transcriptSource,'Caption correction saved with its original timing. Check against playback.');else{captions.refresh();persistMetadata();}lastCaptionTranscript=$('transcript').value;});
function timeLabel(seconds) { const value = Math.floor(seconds); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
const captions = setupCaptions($('video'), $('captionControls'), () => ({segments:state.segments,transcript:$('transcript').value}));
let lastCaptionTranscript=$('transcript').value;
function renderCues() {
  lastCaptionTranscript=$('transcript').value;captions.refresh();
  const host = $('transcriptCues'); host.classList.toggle('hidden', !state.segments.length);
  if (!state.segments.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<strong>Replay points</strong><p>Edit each timed phrase to correct captions without retranscribing. Matching transcript corrections keep their timing. For larger edits, match these phrases to the transcript above.</p>${state.segments.map((segment, i) => `<div class="cue" data-index="${i}"><textarea class="cue-words" aria-label="Timed caption phrase ${i+1}">${esc(segment.text)}</textarea><div class="cue-actions"><button type="button" class="cue-mark">Mark at player time</button>${Number.isFinite(segment.time) ? `<button type="button" class="cue-play">▶ ${timeLabel(segment.time)}</button>` : '<span>Time not set</span>'}</div></div>`).join('')}`;
}
function showSession(mode) { state.mode = mode; $('session').classList.remove('hidden'); $('results').classList.add('hidden'); $('sessionTitle').textContent = mode === 'sample' ? 'Example walkthrough' : mode === 'sample-audio' ? 'Spoken sample walkthrough' : mode === 'import' ? 'Imported recording' : mode === 'paste' ? 'Pasted walkthrough' : 'Your walkthrough'; $('sessionBadge').textContent = mode === 'sample' ? 'SAMPLE · NOT A LIVE RECORDING' : mode === 'sample-audio' ? 'SAMPLE AUDIO · SYNTHETIC' : mode === 'import' ? 'IMPORTED RECORDING' : mode === 'paste' ? 'WRITTEN SOURCE' : 'LIVE RECORDING'; $('sessionBadge').style.background = mode.startsWith('sample') ? '#fff0d9' : ''; $('sessionBadge').style.color = mode.startsWith('sample') ? '#9b7342' : ''; $('reviewRow').classList.toggle('hidden', ['sample', 'paste'].includes(mode)); window.dispatchEvent(new Event('studio-session-opened')); updateWords(); }

async function status() {
  const read=async path=>{try{const response=await fetch(path);return response.ok?await response.json():null}catch{return null}};
  const [hosted,local,chatgpt]=await Promise.all([read('/api/status'),read('/api/local/status'),read('/api/chatgpt/status')]);
  const mode=getPreferences().aiMode, selected=mode==='local'?local:mode==='chatgpt'?chatgpt:hosted;
  state.hosted=mode==='hosted';state.ai=Boolean(selected?.ai);state.localSpeech=Boolean(local?.localSpeech);
  $('providerStatus').textContent=mode==='local'?(state.ai?'Local Qwen ready · offline':'Local Qwen unavailable · check Settings'):mode==='chatgpt'?(state.ai?'ChatGPT connected · local transcription':'Connect ChatGPT in Settings'):(state.ai?'OpenAI API ready':'OpenAI API setup pending · check Settings');
  showEngineStatus({local,hosted,chatgpt});
}

async function openSample() {
  if (state.transcribing || state.analyzing) return toast('Wait for processing to finish before opening the example.');
  if (['recording','paused'].includes(state.recorder?.state)) return toast('Stop your recording before opening the example.');
  resetRecording(); state.blob = null; state.blobUrl = null; state.recordingKind = 'sample'; showSession('sample');
  state.segments = []; renderCues();
  $('videoWrap').style.background = '#252131';
  $('video').classList.add('hidden');
  $('videoPlaceholder').classList.remove('hidden');
  $('videoPlaceholder').innerHTML = '<span>✦</span><strong>Example walkthrough</strong><small>Sample transcript and process · no video was recorded</small>';
  $('videoStatus').textContent = 'Sample data for preview';
  $('downloadVideo').classList.add('hidden'); $('transcribeBtn').classList.add('hidden');
  setTranscript(sampleTranscript, 'Sample transcript', 'This is demonstration content, not speech captured from a recording.');
  state.result = structuredClone(sampleResult); state.method = 'sample';
  renderResult();
}

function stopCamera() {
  const floating = state.floatWindow; state.floatWindow = null; state.floatVideo = null; state.lastFloatBounds = null;
  document.body.classList.remove('floating-camera-active');
  if (floating && !floating.closed) floating.close();
  if (document.pictureInPictureElement === $('cameraPreview')) document.exitPictureInPicture().catch(() => {});
  $('floatCameraBtn').textContent = 'Show camera on screen ↗';
  state.cameraStream?.getTracks().forEach(track => track.stop()); state.cameraStream = null;
  $('cameraPreview').srcObject = null; $('liveCamera').srcObject = null;
  for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height', 'maxWidth']) $('liveCamera').style[property] = '';
  $('cameraPreviewWrap').classList.add('hidden'); $('liveCamera').classList.add('hidden');
  $('cameraToggle').disabled = false;
  $('cameraHelp').textContent = $('cameraToggle').checked ? 'Your camera will appear when recording starts. Uncheck for screen only.' : 'Screen only. Check the box to include your camera next time.';
}
async function attachFloatingCamera(stream) {
  const video = state.floatVideo;
  if (!video || !state.floatWindow || state.floatWindow.closed) return;
  video.srcObject = stream;
  await video.play();
  video.classList.add('ready');
}
async function prepareCamera() {
  if (state.cameraStream?.getVideoTracks().some(track => track.readyState === 'live')) return state.cameraStream;
  if (state.cameraPending) return state.cameraPending;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera capture is unavailable in this browser.');
  state.cameraPending = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
    try {
      const preview = $('cameraPreview'); preview.srcObject = stream; await preview.play();
      state.cameraStream = stream; $('cameraPreviewWrap').classList.remove('hidden');
      await attachFloatingCamera(stream);
      $('cameraHelp').textContent = state.floatWindow ? 'Drag the floating preview. Use the in-app circle to choose its recorded position.' : 'Drag the circle in the recording preview to guide its saved position.';
      return stream;
    } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  })();
  try { return await state.cameraPending; } finally { state.cameraPending = null; }
}
async function openFloatingCamera() {
  if (state.floatWindow && !state.floatWindow.closed) return true;
  if (window.documentPictureInPicture?.requestWindow) {
    let floating;
    try {
      floating = await window.documentPictureInPicture.requestWindow({ width: 194, height: 194, disallowReturnToOpener: true, preferInitialWindowPlacement: false });
      const doc = floating.document;
      doc.title = 'Process Studio camera';
      const style = doc.createElement('style');
      style.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body{display:grid;place-items:center}.bubble{width:min(100vw,100vh);aspect-ratio:1;border-radius:50%;overflow:hidden;box-sizing:border-box;background:#252131;position:relative}.bubble:before{content:"Camera starting…";position:absolute;inset:0;display:grid;place-items:center;color:#e9e4f2;font:13px Arial,sans-serif}.bubble:has(video.ready):before{display:none}.bubble video{width:100%;height:100%;object-fit:cover;display:none}.bubble video.ready{display:block}';
      doc.head.append(style);
      const bubble = doc.createElement('div'); bubble.className = 'bubble';
      const video = doc.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true;
      bubble.append(video); doc.body.append(bubble);
      floating.addEventListener('pagehide', () => {
        if (state.floatWindow !== floating) return;
        state.floatWindow = null; state.floatVideo = null; state.lastFloatBounds = null;
        document.body.classList.remove('floating-camera-active');
        $('floatCameraBtn').textContent = 'Show camera on screen ↗';
        $('cameraHelp').textContent = 'The floating window closed. Use Show camera on screen to reopen it.';
      });
      state.floatWindow = floating; state.floatVideo = video; state.lastFloatBounds = null; state.anchorSource = 'floating';
      document.body.classList.add('floating-camera-active');
      if (state.cameraStream) await attachFloatingCamera(state.cameraStream);
      $('floatCameraBtn').textContent = 'Hide floating camera';
      $('cameraHelp').textContent = 'Drag the floating preview. Use the in-app circle to choose its recorded position.';
      return true;
    } catch (error) {
      if (floating && !floating.closed) floating.close();
      return false;
    }
  }
  return false;
}
async function toggleFloatingCamera() {
  if (state.floatWindow && !state.floatWindow.closed) { state.floatWindow.close(); return; }
  if (document.pictureInPictureElement === $('cameraPreview')) { await document.exitPictureInPicture(); return; }
  if (!state.cameraStream?.getVideoTracks().some(track => track.readyState === 'live')) return toast('Turn on the camera first.');
  if (await openFloatingCamera()) return;
  if (document.pictureInPictureEnabled && $('cameraPreview').requestPictureInPicture) {
    try {
      await $('cameraPreview').requestPictureInPicture();
      document.body.classList.add('floating-camera-active');
      $('floatCameraBtn').textContent = 'Hide floating camera';
      $('cameraHelp').textContent = 'Drag this camera window. Drag the bubble in the recording preview to guide its saved position.';
      return;
    } catch (error) { return toast(`Floating camera could not open: ${error.message}`); }
  }
  toast('This browser cannot float the camera. You can still drag it in the recording preview.');
}
function suggestedCameraAnchor(layout) {return state.cameraAnchor?{cx:state.cameraAnchor.x*layout.width,cy:state.cameraAnchor.y*layout.height}:null;}
function waitForVideo(video) {
  if (video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('The video source did not become ready.')); }, 8000);
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('loadedmetadata', ready); video.removeEventListener('error', failed); };
    const ready = () => { cleanup(); resolve(); }; const failed = () => { cleanup(); reject(new Error('The video source could not be opened.')); };
    video.addEventListener('loadedmetadata', ready, { once: true }); video.addEventListener('error', failed, { once: true });
  });
}
async function composeCameraBubble(screenVideo, cameraVideo) {
  if (!HTMLCanvasElement.prototype.captureStream) throw new Error('This browser cannot include a camera bubble in a recording.');
  await Promise.all([waitForVideo(screenVideo), waitForVideo(cameraVideo)]);
  const layout = cameraLayout(screenVideo.videoWidth, screenVideo.videoHeight, cameraVideo.videoWidth, cameraVideo.videoHeight);
  const canvas = document.createElement('canvas'); canvas.width = layout.width; canvas.height = layout.height;
  const ctx = canvas.getContext('2d', { alpha: false }); if (!ctx) throw new Error('Camera composition could not start.');
  let spots = nearbyPlacements(layout, suggestedCameraAnchor(layout) || undefined);
  const analysisWidth = 96, analysisHeight = Math.max(8, Math.round(layout.height / layout.width * analysisWidth));
  const analysisCanvas = document.createElement('canvas'); analysisCanvas.width = analysisWidth; analysisCanvas.height = analysisHeight;
  const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  let previousFrame = null, currentSpot = 0, lastMoveAt = performance.now(), lastCheckAt = 0, analysisAvailable = Boolean(analysisCtx);
  const position = { ...spots[0] };
  const bubble = $('liveCamera');
  const placePreview = () => {
    const wrap = $('videoWrap');
    const scale = Math.min(wrap.clientWidth / screenVideo.videoWidth, wrap.clientHeight / screenVideo.videoHeight);
    const offsetX = (wrap.clientWidth - screenVideo.videoWidth * scale) / 2;
    const offsetY = (wrap.clientHeight - screenVideo.videoHeight * scale) / 2;
    const x = offsetX + (position.cx - layout.radius) * scale * (screenVideo.videoWidth / layout.width);
    const y = offsetY + (position.cy - layout.radius) * scale * (screenVideo.videoHeight / layout.height);
    const size = layout.radius * 2 * scale * (screenVideo.videoWidth / layout.width);
    bubble.style.left = `${x}px`; bubble.style.top = `${y}px`;
    bubble.style.right = 'auto'; bubble.style.bottom = 'auto';
    bubble.style.width = `${size}px`; bubble.style.height = `${size}px`; bubble.style.maxWidth = 'none';
  };
  const paint = () => {
    if (screenVideo.readyState < 2) return;
    ctx.drawImage(screenVideo, 0, 0, layout.width, layout.height);
    const now = performance.now();
    const preferred = suggestedCameraAnchor(layout);
    if (preferred && Math.hypot(preferred.cx - spots[0].cx, preferred.cy - spots[0].cy) > 10) {
      spots = nearbyPlacements(layout, preferred);
      currentSpot = 0; lastMoveAt = now; previousFrame = null; if(state.anchorSource==='preview'){position.cx=preferred.cx;position.cy=preferred.cy;}
    }
    if (getPreferences().spaceAware && analysisAvailable && now - lastCheckAt >= 1500) {
      lastCheckAt = now;
      try {
        analysisCtx.drawImage(screenVideo, 0, 0, analysisWidth, analysisHeight);
        const frame = analysisCtx.getImageData(0, 0, analysisWidth, analysisHeight).data;
        const factor = analysisWidth / layout.width;
        const sampleSpots = spots.map(spot => ({ cx: spot.cx * factor, cy: spot.cy * factor }));
        const scores = scorePlacements(frame, previousFrame, analysisWidth, analysisHeight, sampleSpots, layout.radius * factor);
        const next = choosePlacement(scores, currentSpot, lastMoveAt, now);
        if (next !== currentSpot) { currentSpot = next; lastMoveAt = now; }
        previousFrame = new Uint8ClampedArray(frame);
      } catch { analysisAvailable = false; }
    }
    const target = cameraTarget(spots, currentSpot, getPreferences().spaceAware);
    position.cx += (target.cx - position.cx) * 0.12;
    position.cy += (target.cy - position.cy) * 0.12;
    placePreview();
    if(desktop.state.active)desktop.move(position,layout);
    if (cameraVideo.readyState < 2) return;
    const { radius, crop } = layout; const { cx, cy } = position;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(cameraVideo, crop.x, crop.y, crop.size, crop.size, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore(); ctx.beginPath(); ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2); ctx.lineWidth = Math.max(4, Math.round(radius * 0.045)); ctx.strokeStyle = '#fff'; ctx.stroke();
  };
  paint(); const frameTimer = setInterval(paint, 1000 / 30);
  const stream = canvas.captureStream(30);
  return { stream, layout, stop() { clearInterval(frameTimer); stream.getTracks().forEach(track => track.stop()); } };
}
function dragRecordingBubble(event) {
  if (!state.dragOffset || !state.compositor) return;
  const wrap = $('videoWrap'), source = $('video');
  const rect = wrap.getBoundingClientRect();
  state.cameraAnchor = anchorFromPreviewPointer(
    { x: event.clientX, y: event.clientY },
    { left: rect.left, top: rect.top, width: wrap.clientWidth, height: wrap.clientHeight },
    { width: source.videoWidth, height: source.videoHeight }, state.dragOffset
  );
  state.anchorSource = 'preview';
}
function releaseMedia() {
  void desktop.stop();$('floatCameraBtn').disabled=false;
  state.compositor?.stop(); state.compositor = null;
  state.stream?.getTracks().forEach(track => track.stop()); state.stream = null; stopCamera();
  state.audioContext?.close().catch(() => {}); state.audioContext = null;
  clearInterval(state.timer); $('recordingControls').classList.add('hidden'); $('cameraToggle').disabled = false; $('cameraOnlyBtn').disabled = false; $('recordBtn').disabled = false;
}
function stopRecording() { if (state.recorder && ['recording','paused'].includes(state.recorder.state)) state.recorder.stop(); else releaseMedia(); }

async function decodeWav(blob){
 const context=new AudioContext();try{const audio=await context.decodeAudioData(await blob.arrayBuffer());const rate=16000,length=Math.floor(audio.duration*rate);if(length>rate*360)throw Error('Use a walkthrough under six minutes.');const bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes);const tag=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))};tag(0,'RIFF');view.setUint32(4,36+length*2,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,length*2,true);const channels=Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i));let peak=0;for(let i=0;i<length;i++){const index=Math.min(audio.length-1,Math.floor(i*audio.sampleRate/rate));let value=channels.reduce((sum,data)=>sum+data[index],0)/channels.length;peak=Math.max(peak,Math.abs(value));value=Math.max(-1,Math.min(1,value));view.setInt16(44+i*2,value<0?value*32768:value*32767,true)}if(peak<0.0005)throw Error('No audible speech found.');return new Blob([bytes],{type:'audio/wav'})}finally{await context.close()}
}

async function wavFromMedia(blob) {
  if (!window.AudioContext) throw new Error('This browser cannot extract an audio track from the recording.');
  try { return await decodeWav(blob); } catch(error) { if(state.processingAbort?.signal.aborted)throw Error('Audio preparation cancelled.');if(error.message.includes('under six minutes'))throw error; progress('Preparing audio by replaying the recording. This stage takes the recording duration.'); }
  const url = URL.createObjectURL(blob);
  const media = document.createElement('video'); media.src = url; media.preload = 'auto'; media.playsInline = true;
  media.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px'; document.body.appendChild(media);
  const context = new AudioContext();
  const source = context.createMediaElementSource(media);
  const processor = context.createScriptProcessor(4096, 2, 1);
  const silent = context.createGain(); silent.gain.value = 0;
  source.connect(processor); processor.connect(silent); silent.connect(context.destination);
  const chunks = []; let total = 0; let peak = 0;
  processor.onaudioprocess = event => {
    const input = event.inputBuffer;
    const mono = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let value = 0;
      for (let channel = 0; channel < input.numberOfChannels; channel++) value += input.getChannelData(channel)[i];
      mono[i] = value / input.numberOfChannels; peak = Math.max(peak, Math.abs(mono[i]));
    }
    chunks.push(mono); total += mono.length;
  };
  let timer;
  try {
    const finished = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Audio extraction took too long.')), 360000);
      media.onended = () => resolve();
      media.onerror = () => reject(new Error('The browser could not play this recording.'));state.processingAbort?.signal.addEventListener('abort',()=>reject(new Error('Audio preparation cancelled.')),{once:true});
    });
    await Promise.all([context.resume(), media.play()]);
    await finished;
    if (!total || peak < 0.0005) throw new Error('No audible speech track was found in this recording.');
    const combined = new Float32Array(total); let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    const rate = 16000; const length = Math.floor(total * rate / context.sampleRate);
    const buffer = new ArrayBuffer(44 + length * 2); const view = new DataView(buffer);
    const tag = (position, value) => { for (let i = 0; i < value.length; i++) view.setUint8(position + i, value.charCodeAt(i)); };
    tag(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, combined[Math.min(total - 1, Math.floor(i * context.sampleRate / rate))]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  } finally { clearTimeout(timer); processor.disconnect(); source.disconnect(); silent.disconnect(); media.pause(); media.removeAttribute('src'); media.load(); media.remove(); await context.close().catch(() => {}); URL.revokeObjectURL(url); }
}

async function transcribeLocally(blob) {
  const local=getPreferences().aiMode!=='hosted';
  if(local)progress('Preparing audio for local transcription.');
  const wav=local?await wavFromMedia(blob):null;
  return transcribeSaved(blob,state.recordingKind,state.fileName,wav);
}

async function importRecording(file, sample = false) {
  if (!file) return;
  if (['recording','paused'].includes(state.recorder?.state)) return toast('Stop the current recording before importing another.');
  if (!/^(video\/(webm|mp4)|audio\/(webm|mp4|mpeg|wav|x-wav|ogg))$/.test(file.type)) return toast('Choose a WebM, MP4, MP3, WAV, or OGG recording.');
  if (state.analyzing || state.transcribing) return toast('Wait until processing finishes before importing another recording.');
  if (file.size > 25 * 1024 * 1024) return toast('Choose a recording under 25 MB for transcription.');
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  resetRecording(); state.blob = file; state.blobUrl = URL.createObjectURL(file); state.fileName = file.name; state.result = null; state.method = null; state.segments = []; state.recordingKind = sample ? 'sample-audio' : 'import'; renderCues();
  showSession(sample ? 'sample-audio' : 'import');
  $('video').src = state.blobUrl; $('video').classList.remove('hidden'); $('videoPlaceholder').classList.add('hidden');
  $('downloadVideo').href = state.blobUrl; $('downloadVideo').download = file.name; $('downloadVideo').classList.remove('hidden');
  $('videoStatus').textContent = `${sample ? 'Synthetic sample' : 'Imported'} · ${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  setTranscript('', 'Pending', 'Transcribe this recording, then play it to check the words.');
  $('transcribeBtn').textContent = 'Transcribe saved recording ↗'; $('transcribeBtn').classList.remove('hidden');
  try { await storeVideo(file); } catch { toast('The import is available now, but browser storage was unavailable.'); }
  persistMetadata();
  try { await ensureRecording(file, state.recordingKind, state.fileName); if ($('autoProcess').checked && !sample) await processRecording(); } catch(error) { progress(error.message, 'error'); }
}

async function loadSpokenSample() {
  try {
    const response = await fetch('/sample-walkthrough.wav'); if (!response.ok) throw new Error('The spoken sample could not be loaded.');
    const blob = await response.blob();
    await importRecording(new File([blob], 'sample-walkthrough.wav', { type: 'audio/wav' }), true);
  } catch (error) { toast(error.message); }
}

async function createFromNotes() {
  if(state.analyzing || state.transcribing) return toast('Wait for processing to finish before starting another process.');
  const notes = $('pasteInput').value.trim();
  if (notes.length < 20) { $('pasteInput').focus(); return toast('Add a few details before creating a process.'); }
  if (['recording','paused'].includes(state.recorder?.state)) return toast('Stop recording before starting from notes.');
  stopCamera();
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  resetRecording(); state.blob = null; state.blobUrl = null; state.fileName = ''; state.recordingKind = 'paste';
  state.result = null; state.method = null; state.segments = []; renderCues();
  showSession('paste');
  const video = $('video'); video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load(); video.classList.add('hidden');
  $('videoPlaceholder').innerHTML = '<span>✎</span><strong>Written walkthrough</strong><small>Your notes are the source for this process.</small>';
  $('videoPlaceholder').classList.remove('hidden'); $('videoStatus').textContent = 'Written source · no recording needed';
  $('downloadVideo').classList.add('hidden'); $('transcribeBtn').classList.add('hidden');
  setTranscript(notes, 'Pasted walkthrough', 'Edit these notes whenever you like. Regenerate the process after changes.');
  state.result = makePastedDraft(notes); state.method = 'basic-draft';
  renderResult(); persistMetadata();
  try { await saveProcess(state, notes, true); if(state.ai) await generate(); } catch(error) { progress(error.message,'error'); }
}

async function startRecording(kind = 'screen') {
  state.cameraAnchor=null;state.lastFloatBounds=null;
  if (state.recorder && ['recording','paused'].includes(state.recorder.state)) return stopRecording();
  if (state.transcribing || state.analyzing) return toast('Wait for the current process to finish before recording.');
  if (state.starting) return;
  state.starting = true;
  try {
  if (!window.MediaRecorder || (kind === 'screen' && !navigator.mediaDevices?.getDisplayMedia)) return toast('Recording is unavailable in this browser. Try Chrome or Edge.');
  let screen = null, camera = null, mic = null;
  const useCamera = kind === 'camera' || $('cameraToggle').checked;
  const hadFloating = Boolean(state.floatWindow && !state.floatWindow.closed);
  const floatingReady = useCamera ? await openFloatingCamera() : false;
  if (kind === 'screen') {
    try { screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
    catch (error) { if (!hadFloating && state.floatWindow) state.floatWindow.close(); return toast(error.name === 'NotAllowedError' ? 'Screen sharing was canceled.' : `Screen capture failed: ${error.message}`); }
    if (useCamera) {
      try { camera = await prepareCamera(); }
      catch (error) { screen.getTracks().forEach(track => track.stop()); stopCamera(); return toast(`Camera unavailable (${error.message}). Turn off Include camera to record the screen alone.`); }
      if (!floatingReady) toast('The camera will appear in the recording preview, but this browser could not float it over your screen.');
    }
  } else {
    try { camera = await prepareCamera(); $('cameraToggle').checked = true; }
    catch (error) { stopCamera(); return toast(`Camera recording could not start: ${error.message}`); }
    if (!floatingReady) toast('The camera recording is starting, but this browser could not float the preview over your screen.');
  }
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { progress('Microphone unavailable. This recording has no narration unless screen audio is shared. You can paste its transcript afterward.', 'error'); }
  state.stream = new MediaStream([...(screen?.getTracks() || []), ...(camera?.getTracks() || []), ...(mic?.getTracks() || [])]);
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) { releaseMedia(); return toast('This browser cannot create a WebM recording.'); }
  let videoTrack;
  try {
    const live = $('video'); live.pause(); live.removeAttribute('src'); live.srcObject = screen || camera;
    live.controls = false; live.muted = true; live.classList.remove('hidden'); live.classList.add('live-source'); live.classList.toggle('camera-full', kind === 'camera');
    $('videoPlaceholder').classList.add('hidden'); await live.play();
    if (screen && camera) {
      $('liveCamera').srcObject = camera; $('liveCamera').classList.remove('hidden'); await $('liveCamera').play();
      try { state.compositor = await composeCameraBubble(live, $('cameraPreview')); }
      catch (error) { stopCamera(); camera = null; toast(`Camera bubble unavailable (${error.message}). Recording the screen only.`); }
    }
    videoTrack = state.compositor?.stream.getVideoTracks()[0] || (screen || camera).getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video track was available.');
  } catch (error) {
    releaseMedia(); $('video').srcObject = null; $('video').controls = true; $('video').muted = false;
    return toast(`Recording could not start: ${error.message}`);
  }
  let audioTracks = mic?.getAudioTracks() || screen?.getAudioTracks() || [];
  if (mic && window.AudioContext) {
    let audioContext;
    try {
      audioContext = new AudioContext(); const dest = audioContext.createMediaStreamDestination();
      audioContext.createMediaStreamSource(mic).connect(dest);
      if (screen?.getAudioTracks().length) audioContext.createMediaStreamSource(screen).connect(dest);
      await audioContext.resume(); if (audioContext.state !== 'running') throw new Error('Audio mixer did not start.');
      audioTracks = dest.stream.getAudioTracks(); state.audioContext = audioContext;
    } catch { audioContext?.close().catch(() => {}); if (screen?.getAudioTracks().length) toast('Screen audio could not be mixed; microphone audio will continue.'); }
  }
  const recordingStream = new MediaStream([videoTrack, ...audioTracks]);
  let recorder;
  try { recorder = new MediaRecorder(recordingStream, { mimeType: type, videoBitsPerSecond: 2_000_000 }); }
  catch (error) { releaseMedia(); $('video').srcObject = null; $('video').controls = true; $('video').muted = false; return toast(`Recording could not start: ${error.message}`); }
  state.recorder = recorder; state.recordingKind = kind === 'camera' ? 'camera-only' : camera ? 'screen-camera' : 'screen';
  resetRecording(); state.chunks = []; state.blob = null; state.fileName = 'process-walkthrough.webm'; state.result = null; state.segments = []; renderCues();
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  showSession('live'); $('sessionBadge').textContent = state.recordingKind === 'camera-only' ? 'CAMERA RECORDING' : state.recordingKind === 'screen-camera' ? 'SCREEN + CAMERA' : 'SCREEN RECORDING';
  $('downloadVideo').classList.add('hidden'); $('transcribeBtn').classList.add('hidden');
  setTranscript('', 'Pending', 'Your saved recording can be transcribed after you stop.');
  recorder.ondataavailable = event => { if (event.data.size) state.chunks.push(event.data); if (state.chunks.reduce((sum,chunk)=>sum+chunk.size,0)>22*1024*1024 && recorder.state!=='inactive') { progress('Recording stopped near the upload size limit. Your captured video is being saved.', 'done'); recorder.stop(); } };
  recorder.onerror = () => { progress('The browser interrupted recording. Saving any video captured so far.', 'error'); if(recorder.state!=='inactive') recorder.stop(); };
  recorder.onstop = async () => {
    const blob = new Blob(state.chunks, { type: type.split(';')[0] });
    releaseMedia(); $('recordBtn').innerHTML = '<span class="button-icon">●</span> Record a walkthrough'; $('cameraOnlyBtn').textContent = 'Record camera only';
    const live = $('video'); live.pause(); live.srcObject = null; live.controls = true; live.muted = false; live.classList.remove('live-source', 'camera-full');
    if (!blob.size) return toast('No video was captured. Please try again.');
    state.blob = blob; state.blobUrl = URL.createObjectURL(blob);
    live.src = state.blobUrl; live.classList.remove('hidden'); $('videoPlaceholder').classList.add('hidden'); $('downloadVideo').href = state.blobUrl;
    $('downloadVideo').download = state.fileName; $('downloadVideo').classList.remove('hidden'); $('videoStatus').textContent = `Saved ${recordingLabel(state.recordingKind)} recording · ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
    try { await storeVideo(blob); } catch { toast('Recording is playable now, but browser storage is unavailable. Download a copy.'); }
    setTranscript('', 'Pending', 'Use the button to transcribe the saved recording. If unavailable, paste its transcript.');
    $('transcribeBtn').textContent = 'Transcribe saved recording ↗'; $('transcribeBtn').classList.remove('hidden'); persistMetadata();
    try { await ensureRecording(blob, state.recordingKind, state.fileName); if($('autoProcess').checked) await processRecording(); } catch(error) { progress(error.message, 'error'); }
  };
  (screen || camera).getVideoTracks()[0].addEventListener('ended', () => { if (['recording','paused'].includes(recorder.state)) recorder.stop(); }, { once: true });
  if(screen&&camera&&screen.getVideoTracks()[0].getSettings().displaySurface==='monitor'){if(state.floatWindow&&!state.floatWindow.closed)state.floatWindow.close();if(document.pictureInPictureElement)await document.exitPictureInPicture().catch(()=>{});}
  try { recorder.start(1000); } catch (error) { releaseMedia(); const live = $('video'); live.pause(); live.srcObject = null; live.controls = true; live.muted = false; live.classList.remove('live-source', 'camera-full'); return toast(`Recording could not start: ${error.message}`); }
  if(camera&&(state.compositor||kind==='camera')){const active=await desktop.start({recording:true,video:$('cameraPreview'),track:screen?.getVideoTracks()[0]||{getSettings:()=>({displaySurface:'monitor'})},layout:state.compositor?.layout||cameraLayout(window.screen.width,window.screen.height,$('cameraPreview').videoWidth,$('cameraPreview').videoHeight),anchor:state.cameraAnchor||undefined,onAnchor:anchor=>{state.cameraAnchor=anchor;state.anchorSource='preview'},onStatus:message=>{$('cameraHelp').textContent=message}});if(active){$('floatCameraBtn').disabled=true;$('floatCameraBtn').textContent='Camera on screen';if(state.floatWindow&&!state.floatWindow.closed)state.floatWindow.close();$('cameraHelp').textContent='Drag the circle itself. Space-aware movement stays close to your chosen position.';}else if(screen?.getVideoTracks()[0].getSettings().displaySurface==='monitor'&&state.floatWindow){state.floatWindow.close();$('cameraHelp').textContent='Desktop overlay unavailable. Use the camera circle in the recording preview.';}}
  if(screen&&screen.getVideoTracks()[0].getSettings().displaySurface==='monitor')$('floatCameraBtn').disabled=true;
  state.recordingStarted = Date.now(); state.pausedMs = 0; state.pausedAt = null; $('recordingControls').classList.remove('hidden'); $('pauseBtn').textContent = 'Pause'; $('cameraToggle').disabled = true;
  if (kind === 'camera') { $('recordBtn').disabled = true; $('cameraOnlyBtn').textContent = '■ Stop camera recording'; }
  else { $('cameraOnlyBtn').disabled = true; $('recordBtn').innerHTML = '<span class="button-icon">■</span> Stop recording'; }
  state.timer = setInterval(() => { $('videoStatus').textContent = `Recording ${recordingLabel(state.recordingKind)} · ${Math.floor(((state.pausedAt || Date.now()) - state.recordingStarted - state.pausedMs) / 1000)}s`; }, 1000);
  $('videoStatus').textContent = `Recording ${recordingLabel(state.recordingKind)} · 0s`;
  } finally { state.starting = false; }
}

async function transcribeVideo() {
  if (!state.blob || state.transcribing) return;
  const previous = $('transcript').value, previousSource = state.transcriptSource, sourceBlob = state.blob, sourceKey=recordingIdentity().key;
  state.cancelRequested=false;state.processingAbort=new AbortController();state.transcribing = true; updateWords();
  $('transcribeBtn').disabled = true; $('transcribeBtn').textContent = 'Transcribing recording…';
  $('transcriptSource').textContent = getPreferences().aiMode!=='hosted'?'Local transcription':'Hosted transcription';
  $('transcriptHelp').textContent = 'Transcribing with your selected engine. Keep this tab open.';
  try {
    const data = await transcribeLocally(sourceBlob);
    if(state.cancelRequested || recordingIdentity().key!==sourceKey || state.blob!==sourceBlob || $('transcript').value!==previous){progress('Your source changed during transcription. The saved job is retained; your edits were kept.','done');return false}
    state.segments = (data.segments || []).map(part => ({ text: String(part.text || ''), time: data.timestamped && Number.isFinite(part.time) ? part.time : null, end: data.timestamped && Number.isFinite(part.end) ? part.end : null })).filter(part => part.text);
    renderCues();
    setTranscript(data.transcript.trim(), data.source || 'Hosted transcription', 'Play the recording and check these words. AI drafts still require review.');
      return true;
  } catch (error) {
    if(recordingIdentity().key===sourceKey && state.blob===sourceBlob && $('transcript').value===previous)setTranscript(previous, previous.trim() ? previousSource : 'Manual entry needed', 'Transcription could not complete: ' + error.message + ' You can paste a transcript instead.');
    toast(error.message); return false;
  } finally {
    state.transcribing = false; $('transcribeBtn').disabled = false; $('transcribeBtn').textContent = 'Transcribe again'; updateWords();
  }
}

async function generate(auto = false) {
  if(state.analyzing) return;
  const transcript = $('transcript').value.trim(), sourceBlob=state.blob, sourceKey=recordingIdentity().key;
  if (transcript.length < 20) return toast('Add at least a short transcript first.');
  if(getPreferences().aiMode==='chatgpt'&&state.blob&&!$('reviewCheck').checked)return progress('Transcript ready. Check the words against your recording before sending them to ChatGPT.','done');
  if(getPreferences().aiMode==='chatgpt'&&!$('chatgptOnlineConsent').checked)return progress('Open Settings and allow sending this transcript to OpenAI, or select Local Qwen.','error');
  if (!auto && state.mode !== 'sample' && state.mode !== 'paste' && !$('reviewCheck').checked) return toast('Review the transcript against the recording first.');
  $('generateBtn').disabled = true; $('generateBtn').textContent = 'Analyzing locally…';
  try {
    state.cancelRequested=false;state.analyzing = true;
    updateWords();
    $('generateBtn').textContent = 'Creating process…';
    const data = await analyzeSaved(state, transcript);
    if(state.cancelRequested || recordingIdentity().key!==sourceKey || state.blob!==sourceBlob || $('transcript').value.trim()!==transcript){progress('Processing cancelled or source changed. Your last saved work was kept.','done');return}
    state.result = data; state.method = data.method;
  } catch (error) {
    if(state.cancelRequested || recordingIdentity().key!==sourceKey || state.blob!==sourceBlob || $('transcript').value.trim()!==transcript)return;
    if(state.result){progress('Generation failed. Your previous process was kept. '+error.message,'error');return;}
    state.result = state.mode === 'paste' ? makePastedDraft(transcript) : makeDraft(transcript); state.method = 'rules-after-error';
    state.result.issues = ['AI analysis was unavailable: ' + error.message]; progress(error.message, 'error');
    toast('A basic editable draft is available. ' + error.message);
  } finally { state.analyzing = false; $('generateBtn').textContent = 'Create process'; updateWords(); }
  renderResult(); persistMetadata();
  try { await saveProcess(state, transcript, $('reviewCheck').checked); } catch(error) { progress(error.message, 'error'); }
}

async function processRecording(retry = false) {
  await status();
  if(retry && $('transcript').value.trim().length>=20){await generate(true);return}
  if(!state.hosted&&!state.localSpeech)return progress('Recording saved. Start local Whisper to transcribe, or paste the words manually.','done');
  if(!await transcribeVideo()) return;
  if(!state.ai) return progress('Transcript saved. Connect your selected AI in Settings before generating the process.', 'done');
  if($('transcript').value.trim().length >= 20) await generate(true);
}

function decisionControls(step, i) {
  const select = (key, label, values) => '<label>' + label + '<select class="step-' + key + '" aria-label="Step ' + (i + 1) + ' ' + label + '">' + values.map(([value, name]) => '<option value="' + value + '" ' + (step[key] === value ? 'selected' : '') + '>' + name + '</option>').join('') + '</select></label>';
  return '<div class="decision-fields">' + select('automation', 'Automation', [['candidate','Candidate'],['human','Human judgment'],['uncertain','Uncertain']]) + select('integration', 'Connection', [['required','Needed'],['none','None identified'],['unknown','Unknown']]) + select('approval', 'Approval', [['required','Required'],['not-required','Not required'],['unknown','Unknown']]) + '</div>';
}
function decisionDetails(step) {
  const notes = [...(step.safeguards || []), ...(step.uncertainties || [])];
  return '<div class="decision-notes">' + (step.tools?.length ? '<p>Named tools: ' + step.tools.map(esc).join(', ') + '</p>' : '') + notes.map(note => '<p>' + esc(note) + '</p>').join('') + '</div><label class="decision-review"><input type="checkbox" class="step-reviewed" ' + (step.decisionReviewed ? 'checked' : '') + '> I checked these decisions against the source</label>';
}

function renderResult(scroll = true) {
  if (!state.result) return;
  state.result = normalizeResult(state.result, ['local-model','hosted-model','chatgpt-plan'].includes(state.method) ? 'model' : 'rules');
  $('markdownPreview').classList.add('hidden');
  $('results').classList.remove('hidden');
  $('resultNotice').textContent = state.method === 'stale' ? 'Source changed. Regenerate and review the decisions again.' : ['local-model','hosted-model','chatgpt-plan'].includes(state.method) ? 'AI draft · Check each decision against the source. Matching quotes do not verify the interpretation. ' + (state.result.issues || []).join(' ') : state.mode === 'sample' ? 'Prepared sample. Explore the editor, then analyze your own walkthrough.' : 'Basic draft. Its decisions are conservative suggestions, not a model analysis. ' + (state.result.issues || []).join(' ');
  $('processTitle').value = state.result.title; $('processSummary').value = state.result.summary;
  $('processOwner').value = state.result.owner || ''; $('processTrigger').value = state.result.trigger || '';
  $('processOutcome').value = state.result.outcome || ''; $('processException').value = state.result.exception || '';
  $('stepCount').textContent = `${state.result.steps.length} STEPS`;
  $('steps').innerHTML = state.result.steps.map((step, i) => `<div class="step" data-index="${i}"><span class="step-num">${String(i + 1).padStart(2, '0')}</span><div class="step-content"><div class="step-top"><input class="step-title" aria-label="Step ${i + 1} title" value="${esc(step.title)}"><button class="icon-button remove-step" type="button" aria-label="Remove step ${i + 1}">×</button></div><textarea class="step-instruction" aria-label="Step ${i + 1} instruction">${esc(step.instruction)}</textarea><details class="step-details"><summary>Review source and automation decisions</summary><div class="step-controls">${decisionControls(step, i)}<button class="step-edit step-up" type="button" aria-label="Move step ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑ Up</button><button class="step-edit step-down" type="button" aria-label="Move step ${i + 1} down" ${i === state.result.steps.length - 1 ? 'disabled' : ''}>↓ Down</button><button class="step-edit step-split" type="button" aria-label="Split step ${i + 1}" ${/[.!?]\s+\S/.test(step.instruction) ? '' : 'disabled'}>Split</button><button class="step-edit step-merge" type="button" aria-label="Merge step ${i + 1} with next" ${i === state.result.steps.length - 1 ? 'disabled' : ''}>Merge next</button></div><textarea class="step-reason" aria-label="Step ${i + 1} automation reason">${esc(step.reason)}</textarea><div class="evidence-label">SOURCE QUOTE</div><textarea class="step-evidence" aria-label="Step ${i + 1} source quote">${esc(step.evidence)}</textarea><span class="evidence-badge"></span>${decisionDetails(step)}</details></div></div>`).join('');
  $('actions').innerHTML = state.result.actions.length ? state.result.actions.map((action, i) => `<div class="action-row" data-index="${i}"><input class="action-check" type="checkbox" aria-label="Mark action ${i + 1} done" ${action.done ? 'checked' : ''}><div class="action-body"><textarea class="action-text" aria-label="Action ${i + 1}">${esc(action.text)}</textarea><div class="evidence-label">SOURCE QUOTE</div><textarea class="action-evidence" aria-label="Action ${i + 1} source quote">${esc(action.evidence)}</textarea><span class="evidence-badge"></span></div><button class="icon-button remove-action" type="button" aria-label="Remove action ${i + 1}">×</button></div>`).join('') : '<p class="action-empty">No action items were clear in the transcript. Add one if needed.</p>';
  renderFlow(); updateEvidenceUI(); if (scroll) window.dispatchEvent(new Event('studio-result-ready'));
}

function updateEvidenceUI() {
  if (!state.result) return;
  const audit = auditEvidence(state.result, $('transcript').value);
  const labels = { matched: '✓ Source match', unmatched: '⚠ Quote not found', inference: '◌ Inference / no quote' };
  [...$('steps').querySelectorAll('.step')].forEach((el, i) => { const badge = el.querySelector('.evidence-badge'); badge.className = `evidence-badge ${audit.steps[i]}`; badge.textContent = labels[audit.steps[i]]; });
  [...$('actions').querySelectorAll('.action-row')].forEach((el, i) => { const badge = el.querySelector('.evidence-badge'); badge.className = `evidence-badge ${audit.actions[i]}`; badge.textContent = labels[audit.actions[i]]; });
  $('evidenceSummary').textContent = `${audit.matched} source matches · ${audit.unmatched} ${audit.unmatched === 1 ? 'quote' : 'quotes'} to fix · ${audit.inference} marked as inference`;
  $('resultNotice').classList.toggle('warning', audit.unmatched > 0 || state.method === 'stale');
}

function collectEdits(autosave = true) {
  if (!state.result) return;
  state.result.title = $('processTitle').value; state.result.summary = $('processSummary').value;
  state.result.owner = $('processOwner').value; state.result.trigger = $('processTrigger').value;
  state.result.outcome = $('processOutcome').value; state.result.exception = $('processException').value;
  state.result.steps = [...$('steps').querySelectorAll('.step')].map((el, i) => {
    const before = state.result.steps[i] || {};
    const updated = { ...before, title: el.querySelector('.step-title').value, instruction: el.querySelector('.step-instruction').value, reason: el.querySelector('.step-reason').value, evidence: el.querySelector('.step-evidence').value, automation: el.querySelector('.step-automation').value, integration: el.querySelector('.step-integration').value, approval: el.querySelector('.step-approval').value };
    const changed = ['instruction','evidence','reason','automation','integration','approval'].some(key => updated[key] !== before[key]);
    const checked = el.querySelector('.step-reviewed');
    updated.decisionReviewed = !changed && checked.checked;
    const result = assessStep(updated, { source: 'model' });
    if (!result.evidence || !$('transcript').value.includes(result.evidence)) result.decisionReviewed = false;
    for (const key of ['automation','integration','approval']) el.querySelector('.step-' + key).value = result[key];
    checked.checked = result.decisionReviewed;
    return result;
  });
  state.result.actions = [...$('actions').querySelectorAll('.action-row')].map(el => ({ text: el.querySelector('.action-text').value, evidence: el.querySelector('.action-evidence').value, done: el.querySelector('.action-check').checked }));
  updateEvidenceUI();
  persistMetadata(autosave);
}

function renderFlow() {
  let planner=document.getElementById('automationPlanner');
  if(!planner){planner=document.createElement('section');planner.id='automationPlanner';planner.className='automation-section';$('flow').after(planner);}
  renderAutomation(state.result,{context:$('transcript').value,container:planner});
  const automationLabel = { candidate: 'Automation candidate', human: 'Human judgment', uncertain: 'Uncertain' };
  const connectionLabel = { required: 'Connection needed', none: 'No connection identified', unknown: 'Connection unknown' };
  const approvalLabel = { required: 'Approval required', 'not-required': 'No approval identified', unknown: 'Approval unknown' };
  $('flow').innerHTML = state.result.steps.map((step, i) => '<div class="flow-card"><span class="flow-number">STEP ' + String(i + 1).padStart(2,'0') + '</span><h4>' + esc(step.title) + '</h4><p>' + esc(step.reason || 'Review the source and missing details.') + '</p><span class="category ' + (step.automation === 'candidate' ? 'automate' : 'human') + '">' + automationLabel[step.automation] + '</span><span class="category integration">' + connectionLabel[step.integration] + '</span><span class="category human">' + approvalLabel[step.approval] + '</span></div>' + (i < state.result.steps.length - 1 ? '<div class="flow-arrow" aria-hidden="true">→</div>' : '')).join('');
}

function filename(ext) { return `${(state.result?.title || 'process').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'process'}.${ext}`; }
function prepareDownload(anchor, name, content, type) { if (anchor.dataset.url) URL.revokeObjectURL(anchor.dataset.url); const url = URL.createObjectURL(new Blob([content], { type })); anchor.href = url; anchor.download = name; anchor.dataset.url = url; }
function markdown() {
  const r = state.result;
  const audit = auditEvidence(r, $('transcript').value);
  return `# ${r.title}\n\n> ${state.mode.startsWith('sample') ? 'Sample demonstration content' : state.mode === 'import' ? 'Imported recording' : state.mode === 'paste' ? 'Pasted walkthrough' : 'Live recording session'} · Transcript source: ${state.transcriptSource} · Process method: ${state.method}\n> Evidence: ${audit.matched} matched, ${audit.unmatched} unmatched, ${audit.inference} inference.\n\n${r.summary}\n\n- Owner: ${r.owner || 'To define'}\n- Trigger: ${r.trigger || 'To define'}\n- Expected result: ${r.outcome || 'To define'}\n- Exception path: ${r.exception || 'To define'}\n\n## Procedure\n\n${r.steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.instruction}\n   - Automation: ${s.automation} · Connection: ${s.integration} · Approval: ${s.approval}. ${s.reason}\n   - Decision checked: ${s.decisionReviewed ? 'yes' : 'no'}\n   - Missing details: ${(s.uncertainties || []).join('; ') || 'None reported'}\n   - Source quote: “${s.evidence}” (${audit.steps[i]})`).join('\n\n')}\n\n## Action items\n\n${r.actions.map((a, i) => `- [${a.done ? 'x' : ' '}] ${a.text}\n  - Source quote: “${a.evidence}” (${audit.actions[i]})`).join('\n')}\n\n## ${state.mode === 'paste' ? 'Pasted notes' : 'Transcript'}\n\n${$('transcript').value.trim()}\n${state.segments.some(segment => Number.isFinite(segment.time)) ? `\n## Audio replay points\n\n${state.segments.filter(segment => Number.isFinite(segment.time)).map(segment => `- ${timeLabel(segment.time)} — ${segment.text}`).join('\n')}\n` : ''}\n---\nAutomation recommendations only. No integrations are connected or running.\n`;
}

function openDb() { return new Promise((resolve, reject) => { const request = indexedDB.open('process-studio', 1); request.onupgradeneeded = () => request.result.createObjectStore('recordings'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function storeVideo(blob) { const db = await openDb(); await new Promise((resolve, reject) => { const tx = db.transaction('recordings', 'readwrite'); tx.objectStore('recordings').put(blob, 'latest'); tx.objectStore('recordings').put(blob, recordingIdentity().key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close(); }
async function getVideo() { const db = await openDb(); const blob = await new Promise((resolve, reject) => { const tx = db.transaction('recordings', 'readonly'); const request = tx.objectStore('recordings').get('latest'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close(); return blob; }
function persistMetadata(autosave = true) { if(state.restoring)return; if (!['live', 'import', 'sample-audio', 'paste'].includes(state.mode)) return; try { localStorage.setItem('process-studio-latest', JSON.stringify({ identity: recordingIdentity(), modifiedAt:Date.now(), mode: state.mode, recordingKind: state.recordingKind, fileName: state.fileName, transcript: $('transcript').value, transcriptSource: state.transcriptSource, segments: state.segments, reviewed: $('reviewCheck').checked, result: state.result, method: state.method })); localStorage.setItem("process-studio-draft-"+recordingIdentity().key,localStorage.getItem("process-studio-latest"));if(recordingIdentity().id)localStorage.setItem("process-studio-record-"+recordingIdentity().id,localStorage.getItem("process-studio-latest")); if(autosave)queueAutosave(); } catch { progress("Browser recovery storage is unavailable. Download a backup.", "error"); } }
async function restoreLatest() {
  state.restoring=true;
  try {
    const requestedId = new URLSearchParams(location.search).get('record');
    if(requestedId){
      const response = await fetch('/api/recordings/'+encodeURIComponent(requestedId));
      let saved = await response.json();const browserDraft=JSON.parse(localStorage.getItem('process-studio-record-'+requestedId)||localStorage.getItem('process-studio-latest')||'null');if(browserDraft?.identity?.id===requestedId && browserDraft.modifiedAt>new Date(saved.updatedAt).getTime())saved={...saved,...browserDraft,kind:saved.kind,filename:saved.filename,videoUrl:saved.videoUrl,revision:saved.revision,reviewed:browserDraft.reviewed}; if(!response.ok) throw new Error(saved.error);
      state.recordingKind=saved.kind; state.fileName=saved.filename; state.blob=saved.videoUrl?await fetch(saved.videoUrl).then(r=>r.blob()):null;
      state.blobUrl=state.blob?URL.createObjectURL(state.blob):null; adoptRecording(requestedId,state.blob,saved.revision,browserDraft?.identity?.id===requestedId?browserDraft.identity.key:null);
      showSession(['notes','paste'].includes(saved.kind)?'paste':saved.kind==='sample'?'sample':'import');videoStatus.textContent=state.blob?'Saved recording · '+state.fileName:'Written source · no recording needed';if(['notes','paste'].includes(saved.kind))pasteInput.value=saved.transcript||'';
      if(state.blobUrl){$('video').src=state.blobUrl;$('video').classList.remove('hidden');$('videoPlaceholder').classList.add('hidden');$('downloadVideo').href=state.blobUrl;$('downloadVideo').download=state.fileName;$('downloadVideo').classList.remove('hidden');$('transcribeBtn').classList.remove('hidden');}else{$('video').classList.add('hidden');$('videoPlaceholder').innerHTML='<strong>Written walkthrough</strong><small>Saved source material</small>';}
      setTranscript(saved.transcript||'',saved.transcriptSource||'Pending','Recovered from your saved workspace.');$('reviewCheck').checked=Boolean(saved.reviewed);state.segments=saved.segments||[];renderCues();state.result=saved.result;state.method=saved.method;if(state.result)renderResult();updateWords();return;
    }
    const saved = JSON.parse(localStorage.getItem('process-studio-latest') || '{}');
    if (saved.identity?.id) { const recoveredUrl=new URL(location.href);recoveredUrl.searchParams.set('record',saved.identity.id);location.replace(recoveredUrl.href); return; }
    restoreIdentity(saved.identity,null);
    if (saved.mode === 'paste') {
      state.recordingKind = 'paste'; state.fileName = ''; state.segments = [];
      $('pasteInput').value = saved.transcript || '';
      showSession('paste');
      $('video').classList.add('hidden'); $('videoPlaceholder').innerHTML = '<span>✎</span><strong>Written walkthrough</strong><small>Your notes are the source for this process.</small>';
      $('videoPlaceholder').classList.remove('hidden'); $('videoStatus').textContent = 'Written source · no recording needed';
      setTranscript(saved.transcript || '', saved.transcriptSource || 'Pasted walkthrough', 'Recovered from this browser. Edit your notes and regenerate whenever needed.');
      state.result = saved.result || null; state.method = saved.method || null;
      if (state.result) renderResult();
      persistMetadata(); return;
    }
    const blob = await getVideo(); if (!blob) return;
    state.blob = blob; restoreIdentity(saved.identity,blob); state.blobUrl = URL.createObjectURL(blob); state.fileName = saved.fileName || 'process-walkthrough.webm'; state.recordingKind = saved.recordingKind || saved.mode || 'screen';
    showSession(['import','sample-audio'].includes(saved.mode) ? saved.mode : 'live');
    if (saved.mode === 'live') $('sessionBadge').textContent = state.recordingKind === 'camera-only' ? 'CAMERA RECORDING' : state.recordingKind === 'screen-camera' ? 'SCREEN + CAMERA' : 'SCREEN RECORDING';
    $('video').src = state.blobUrl; $('video').classList.remove('hidden'); $('videoPlaceholder').classList.add('hidden');
    $('downloadVideo').href = state.blobUrl; $('downloadVideo').download = state.fileName; $('downloadVideo').classList.remove('hidden');
    $('videoStatus').textContent = `Saved ${recordingLabel(state.recordingKind)} recording · ${state.fileName} · ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
    state.segments = Array.isArray(saved.segments) ? saved.segments : []; renderCues();
    setTranscript(saved.transcript || '', saved.transcriptSource || 'Pending', 'Recovered from this browser. Play the recording to check the words.');
    $('reviewCheck').checked = Boolean(saved.reviewed); updateWords(); state.result = saved.result || null; state.method = saved.method || null;
    if (state.result) renderResult(); $('transcribeBtn').classList.remove('hidden'); persistMetadata();
  } catch(error) { progress(error.message, 'error'); } finally {state.restoring=false;persistMetadata(false)}
}

$('pauseBtn').addEventListener('click', () => { const recorder=state.recorder; if(recorder?.state==='recording'){recorder.pause();state.pausedAt=Date.now();$('pauseBtn').textContent='Resume';progress('Recording paused. Resume or stop to save.', 'done');}else if(recorder?.state==='paused'){recorder.resume();state.pausedMs+=Date.now()-state.pausedAt;state.pausedAt=null;$('pauseBtn').textContent='Pause';progress('Recording resumed.', 'working');} });
$('stopBtn').addEventListener('click',stopRecording);
$('recordBtn').addEventListener('click', () => startRecording('screen'));
$('cameraOnlyBtn').addEventListener('click', () => startRecording('camera'));
$('floatCameraBtn').addEventListener('click', toggleFloatingCamera);
$('cameraPreview').addEventListener('leavepictureinpicture', () => { document.body.classList.remove('floating-camera-active'); $('floatCameraBtn').textContent = 'Show camera on screen ↗'; });
$('liveCamera').addEventListener('pointerdown', event => {
  if (!state.compositor) return;
  event.preventDefault();
  const rect = $('liveCamera').getBoundingClientRect();
  state.dragOffset = { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) };
  $('liveCamera').setPointerCapture(event.pointerId);
  dragRecordingBubble(event);
});
$('liveCamera').addEventListener('pointermove', dragRecordingBubble);
$('liveCamera').addEventListener('pointerup', () => { state.dragOffset = null; });
$('liveCamera').addEventListener('lostpointercapture', () => { state.dragOffset = null; });
$('cameraToggle').addEventListener('change', async () => {
  if (!$('cameraToggle').checked) return stopCamera();
  $('cameraToggle').disabled = true; $('cameraHelp').textContent = 'Starting camera preview…';
  await openFloatingCamera();
  try { await prepareCamera(); }
  catch (error) { $('cameraToggle').checked = false; stopCamera(); toast(`Camera unavailable: ${error.message}`); }
  finally { $('cameraToggle').disabled = false; }
});
$('exampleBtn').addEventListener('click', openSample); $('navExample').addEventListener('click', openSample); $('navStudio').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
$('sampleAudioBtn').addEventListener('click', loadSpokenSample);
$('pasteBtn').addEventListener('click', createFromNotes);
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async event => { await importRecording(event.target.files?.[0]); event.target.value = ''; });
$('copyMd').addEventListener('click', async () => {
  collectEdits(); const value = markdown();
  $('markdownText').value = value; $('markdownPreview').classList.remove('hidden'); $('markdownText').focus(); $('markdownText').select();
  let copied = false; try { copied = document.execCommand('copy'); } catch {}
  if (!copied && navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(value); } catch {} }
  toast('Markdown is selected below. Press Ctrl+C if it was not copied automatically.');
});
$('closeMarkdownPreview').addEventListener('click', () => $('markdownPreview').classList.add('hidden'));
$('transcribeBtn').addEventListener('click', transcribeVideo); $('generateBtn').addEventListener('click', () => generate());
$('transcriptCues').addEventListener('click', event => { const cue = event.target.closest('.cue'); if (!cue) return; const segment = state.segments[Number(cue.dataset.index)]; if (!segment) return; if (event.target.classList.contains('cue-mark')) { if (!$('video').src) return toast('Play the recording before setting a replay point.'); segment.time = Number($('video').currentTime.toFixed(2)); renderCues(); persistMetadata(); } else if (event.target.classList.contains('cue-play') && Number.isFinite(segment.time)) { $('video').currentTime = segment.time; $('video').play().catch(() => toast('Playback was blocked by this browser.')); } });
$('reviewCheck').addEventListener('change', () => { updateWords(); persistMetadata(); });
$('transcript').addEventListener('input', () => { state.segments=reconcileCaptionText(state.segments,lastCaptionTranscript,$('transcript').value);lastCaptionTranscript=$('transcript').value;renderCues(); const source = state.transcriptSource; state.transcriptSource = state.mode === 'sample' ? 'Edited sample transcript' : state.mode === 'paste' ? 'Edited pasted walkthrough' : ['Pending', 'Manual entry needed'].includes(source) ? 'Manual transcript from recording' : source.startsWith('Reviewed ') ? source : `Reviewed ${source}`; $('transcriptSource').textContent = state.transcriptSource; if (state.mode !== 'sample') $('reviewCheck').checked = false; if (state.result && !$('results').classList.contains('hidden')) { state.method = 'stale'; $('resultNotice').textContent = 'Source text changed after this process was generated. Regenerate to match the current source before using or exporting it.'; updateEvidenceUI(); } updateWords(); persistMetadata(); });
$('processTitle').addEventListener('input', collectEdits); $('processSummary').addEventListener('input', collectEdits);
$('processOwner').addEventListener('input', collectEdits); $('processTrigger').addEventListener('input', collectEdits);
$('processOutcome').addEventListener('input', collectEdits); $('processException').addEventListener('input', collectEdits);
$('steps').addEventListener('input', () => { collectEdits(); renderFlow(); }); $('steps').addEventListener('change', () => { collectEdits(); renderFlow(); });
$('steps').addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  const index = Number(button.closest('.step')?.dataset.index); if (!Number.isInteger(index)) return;
  if (!['remove-step', 'step-up', 'step-down', 'step-split', 'step-merge'].some(name => button.classList.contains(name))) return;
  collectEdits();
  if (button.classList.contains('remove-step')) state.result.steps.splice(index, 1);
  else if (button.classList.contains('step-up')) state.result.steps = moveStep(state.result.steps, index, -1);
  else if (button.classList.contains('step-down')) state.result.steps = moveStep(state.result.steps, index, 1);
  else if (button.classList.contains('step-split')) state.result.steps = splitStep(state.result.steps, index);
  else if (button.classList.contains('step-merge')) state.result.steps = mergeStep(state.result.steps, index, $('transcript').value);
  renderResult(false); persistMetadata();
});
$('actions').addEventListener('input', collectEdits); $('actions').addEventListener('change', collectEdits);
$('actions').addEventListener('click', event => { if (!event.target.classList.contains('remove-action')) return; collectEdits(); state.result.actions.splice(Number(event.target.closest('.action-row').dataset.index), 1); renderResult(); });
$('addStep').addEventListener('click', () => { collectEdits(); state.result.steps.push({ title: 'New step', instruction: '', category: 'human', reason: 'Review this step before automating.', evidence: '' }); renderResult(); });
$('addAction').addEventListener('click', () => { collectEdits(); state.result.actions.push({ text: '', evidence: '', done: false }); renderResult(); });
$('downloadMd').addEventListener('click', event => { collectEdits(); prepareDownload(event.currentTarget, filename('md'), markdown(), 'text/markdown'); });
$('downloadJson').addEventListener('click', event => { collectEdits(); prepareDownload(event.currentTarget, filename('json'), JSON.stringify({ kind: state.mode, recordingKind: state.recordingKind, recordingName: state.fileName, transcriptSource: state.transcriptSource, method: state.method, reviewed: $('reviewCheck').checked, transcript: $('transcript').value.trim(), audioReplayPoints: state.segments.filter(segment => Number.isFinite(segment.time)), evidenceAudit: auditEvidence(state.result, $('transcript').value), ...state.result, workflowBlueprint: buildBlueprint(state.result), note: 'Automation recommendations only. No integrations are connected or running.' }, null, 2), 'application/json'); });
$('saveReviewBtn').addEventListener('click', () => {
  collectEdits();
  if (state.mode.startsWith('sample') || state.method === 'stale') return toast('Use a current real walkthrough to save reviewed examples.');
  const expected = state.result.steps.filter(step => step.decisionReviewed && step.evidence && $('transcript').value.includes(step.evidence)).map(({ evidence, automation, integration, approval }) => ({ evidence, automation, integration, approval }));
  if (!expected.length) return toast('Check at least one step decision before saving.');
  const transcript = $('transcript').value.trim();
  try {
    const examples = JSON.parse(localStorage.getItem('process-studio-reviewed') || '[]').filter(item => item.transcript !== transcript);
    examples.push({ transcript, expected, reviewedAt: new Date().toISOString(), origin: 'human-reviewed', modelVersion: state.result.modelVersion || state.method, modelSha256: state.result.modelSha256 || null, policyVersion: state.result.policyVersion || '2026-10-02-v1' });
    localStorage.setItem('process-studio-reviewed', JSON.stringify(examples)); toast('Reviewed example saved on this browser.');
  } catch { toast('Browser storage is unavailable. Export the process JSON instead.'); }
});
$('downloadReviews').addEventListener('click', event => {
  const examples = JSON.parse(localStorage.getItem('process-studio-reviewed') || '[]');
  if (!examples.length) { event.preventDefault(); return toast('Save a reviewed example first.'); }
  prepareDownload(event.currentTarget, 'reviewed-workflows.jsonl', examples.map(item => JSON.stringify(item)).join('\n') + '\n', 'application/x-ndjson');
});
$('retryProcessing').addEventListener('click',()=>processRecording(true));$('cancelProcessing').addEventListener('click',()=>{state.cancelRequested=true;state.processingAbort?.abort();cancelLocalJob().catch(error=>progress(error.message,'error'))});
setupRecovery();
setupSettings({refreshStatus:status,isBusy:()=>state.starting||state.analyzing||state.transcribing||['recording','paused'].includes(state.recorder?.state)});
setupCloud(() => { if(state.result) collectEdits(false); return {state,transcript:$('transcript').value.trim(),reviewed:$('reviewCheck').checked || ['sample','paste'].includes(state.mode)}; });
await status(); updateWords(); await restoreLatest();document.body.dataset.studioReady='true';window.dispatchEvent(new Event('studio-ready'));
window.addEventListener('recording-saved',()=>persistMetadata(false));
try { const job=await resumeLocalJob(); if(job?.status==='complete' && job.stage==='analyze' && job.input===$('transcript').value.trim()){state.result=job.result;state.method=job.result.method;renderResult();persistMetadata();}else if(job?.status==='complete' && job.stage==='transcribe' && $('transcript').value===job.previousTranscript){setTranscript(job.result.transcript,job.result.source,'Recovered local transcription. Check these words.');state.segments=job.result.segments||[];renderCues();persistMetadata();if($('autoProcess').checked&&state.ai)await generate(true);}else if(job?.status==='failed')progress(job.error,'error'); }catch(error){progress(error.message,'error')}
setInterval(status, 20000);

