import test from 'node:test';
import assert from 'node:assert/strict';
import {captionCues, subtitleFile} from '../public/captions.js';
import * as captions from '../public/captions.js';
test('a correction within one phrase retains its original times and surrounding phrases',()=>{
 const phrases=[{time:0,end:2,text:'Open the clam.'},{time:3,end:5,text:'Save the file.'}];
 const corrected=captions.reconcileCaptionText(phrases,'Open the clam. Save the file.','Open the claim. Save the file.');
 assert.deepEqual(corrected,[{time:0,end:2,text:'Open the claim.'},phrases[1]]);
 assert.equal(captionCues(corrected,'Open the claim. Save the file.',6).cues.length,2);
 assert.equal(phrases[0].text,'Open the clam.');
});
test('ambiguous bulk edits preserve the original timings for explicit phrase correction',()=>{
 const phrases=[{time:0,end:2,text:'one two'},{time:3,end:5,text:'three four'}];
 assert.deepEqual(captions.reconcileCaptionText(phrases,'one two three four','one changed four'),phrases);
});
test('uses timed speech, clips overlaps and media end, and retains real pauses', () => {
  const {cues} = captionCues([{time:0,end:2,text:'Hello.'},{time:5,end:12,text:'Next.'}], 'Hello. Next.', 9);
  assert.deepEqual(cues,[{start:0,end:2,text:'Hello.'},{start:5,end:9,text:'Next.'}]);
  assert.equal(captionCues([{time:0,end:8,text:'a'},{time:4,text:'b'}],'a b',10).cues[0].end,4);
});
test('never fabricates start times or captions from stale corrected text', () => {
  assert.equal(captionCues([{time:null,text:'Untimed'}],'Untimed').cues.length,0);
  assert.equal(captionCues([{time:0,text:'Old words'}],'Corrected words').cues.length,0);
  assert.equal(captionCues([{time:0,text:'a'},{time:0,text:'b'}],'a b').cues.length,0);
  assert.equal(captionCues([{time:20,text:'a'}],'a',10).cues.length,0);
});
test('exports parseable subtitle timestamps and escapes caption markup', () => {
  const cues=[{start:3599.9996,end:3601.25,text:'<script> & words'}];
  assert.match(subtitleFile(cues),/^WEBVTT\n\n1\n01:00:00\.000 --> 01:00:01\.250\n&lt;script&gt; &amp; words\n$/);
  assert.match(subtitleFile(cues,'srt'),/^1\n01:00:00,000 --> 01:00:01,250/);
});
test('old recordings infer bounded phrase ends without filling long pauses', () => {
  assert.deepEqual(captionCues([{time:1,text:'one'},{time:15,text:'two'}],'one  two',18).cues.map(c=>[c.start,c.end]),[[1,7],[15,18]]);
});
