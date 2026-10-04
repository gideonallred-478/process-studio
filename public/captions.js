const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

export function reconcileCaptionText(segments, previousTranscript, editedTranscript) {
  const copy=segments.map(part=>({...part}));
  if(normalize(segments.map(part=>part.text).join(' '))!==normalize(previousTranscript))return copy;
  const before=normalize(previousTranscript).split(' ').filter(Boolean),after=normalize(editedTranscript).split(' ').filter(Boolean);
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  if(start===before.length&&start===after.length)return copy;
  let end=before.length,afterEnd=after.length;
  while(end>start&&afterEnd>start&&before[end-1]===after[afterEnd-1]){end--;afterEnd--;}
  let offset=0;
  for(const part of copy){
    const tokens=normalize(part.text).split(' ').filter(Boolean),limit=offset+tokens.length;
    // Cross-phrase edits and insertions at a boundary need an explicit edit.
    if(start>=offset&&end<=limit&&(end>start||start>offset&&start<limit)){
      part.text=[...tokens.slice(0,start-offset),...after.slice(start,afterEnd),...tokens.slice(end-offset)].join(' ');
      return copy;
    }
    offset=limit;
  }
  return copy;
}

// Only existing phrase timestamps are used; an untimed transcript is never
// spread across the recording and presented as synchronized speech.
export function captionCues(segments = [], transcript = '', duration = Infinity) {
  const phrases = segments.filter(part => normalize(part.text));
  if (!phrases.length) return {cues: [], reason: 'Transcribe the recording to create captions.'};
  if (normalize(phrases.map(part => part.text).join(' ')) !== normalize(transcript))
    return {cues: [], reason: 'Transcript changed. Correct the timed phrases below to match; your transcript and timing are kept.'};
  if (phrases.some(part => !Number.isFinite(part.time) || part.time < 0))
    return {cues: [], reason: 'Caption timing needed. Set each replay point at the matching player time.'};
  if (phrases.some((part, index) => index && part.time <= phrases[index - 1].time))
    return {cues: [], reason: 'Replay points must increase in time. Adjust them before using captions.'};
  const limit = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const cues = phrases.map((part, index) => {
    const next = phrases[index + 1]?.time ?? limit;
    const end = Number.isFinite(part.end) && part.end > part.time ? part.end : Math.min(next, part.time + 6);
    return {start: part.time, end: Math.min(end, next, limit), text: normalize(part.text)};
  });
  if (cues.some(cue => cue.end - cue.start < .001))
    return {cues: [], reason: 'A replay point is outside the recording. Adjust its time.'};
  return {cues, reason: 'Captions ready · check phrase timing against playback.'};
}

function timestamp(seconds, separator) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}
export function subtitleFile(cues, format = 'vtt') {
  const vtt = format === 'vtt';
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (vtt ? 'WEBVTT\n\n' : '') + cues.map((cue, i) => `${i + 1}\n${timestamp(cue.start, vtt ? '.' : ',')} --> ${timestamp(cue.end, vtt ? '.' : ',')}\n${escape(cue.text)}\n`).join('\n');
}

export function setupCaptions(video, host, getSource) {
  let urls = [], track, signature = '', enabled = true;
  host.innerHTML = '<span class="caption-status" role="status"></span><div class="caption-actions"><button type="button" class="text-button caption-toggle" disabled>Captions on</button><a class="text-button caption-vtt hidden">Download VTT ↓</a><a class="text-button caption-srt hidden">Download SRT ↓</a></div>';
  const status = host.querySelector('.caption-status'), toggle = host.querySelector('button');
  function refresh() {
    const {segments = [], transcript = ''} = getSource();
    const result = captionCues(segments, transcript, video.duration);
    status.textContent = result.reason;
    toggle.disabled = !result.cues.length;
    const next = JSON.stringify(result.cues);
    if (signature === next) return;
    signature = next;
    track?.remove(); track = null;
    urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
    for (const format of ['vtt', 'srt']) {
      const link = host.querySelector('.caption-' + format);
      link.classList.toggle('hidden', !result.cues.length);
      link.removeAttribute('href');
      if (!result.cues.length) continue;
      const url = URL.createObjectURL(new Blob([subtitleFile(result.cues, format)], {type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip'}));
      urls.push(url); link.href = url; link.download = 'walkthrough-captions.' + format;
      if (format === 'vtt') {
        track = document.createElement('track');
        track.kind = 'captions'; track.label = 'Transcript captions'; track.src = url; track.default = enabled;
        video.append(track); track.track.mode = enabled ? 'showing' : 'hidden';
      }
    }
  }
  toggle.addEventListener('click', () => {
    enabled = !enabled; toggle.textContent = enabled ? 'Captions on' : 'Captions off';
    if (track) track.track.mode = enabled ? 'showing' : 'hidden';
  });
  video.addEventListener('loadedmetadata', refresh);
  refresh();
  return {refresh};
}
