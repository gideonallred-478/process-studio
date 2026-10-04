# Recording acceptance

Open http://127.0.0.1:4182/ in Edge or Chrome. Select Local AI in Settings; the installed model and transcription engine should show Ready.

1. Record a 20–40 second screen walkthrough with the camera included. The desktop camera should appear as a circle. Drag the circle to a convenient position. If asked to match a monitor/window, select the surface chosen in the browser capture picker.
2. Show changing content beside the camera. With space-aware movement on, the circle should make small nearby adjustments; turn the option off and verify it holds your chosen anchor. This is visual busyness detection, so it cannot guarantee that important content is avoided.
3. Pause, resume, and stop. Watch the saved video: narration audible, picture correct, exactly one camera circle, no leftover desktop overlay. Seek to the middle and end.
4. Wait for transcription and the process draft. Correct the transcript, regenerate, review every instruction and decision, then open the result page. Verify the video, source, SOP, action items and blueprint agree.
5. Start another generation, reload the page, and verify the local job reconnects. Edit a source during generation and verify older output does not replace the edit. Use Retry unfinished processing after a failed stage.
6. In Settings, download a workspace backup. Restore that downloaded file and verify the same restored entries are reused on a second import. Test trash and restore using a disposable recording.
7. Repeat a short recording using camera only, a window capture, and any second monitor or different display scaling you use. Browser-tab capture uses the in-page preview rather than a native desktop position mapping.

Limits: automatic recording stops near 22 MiB; imports up to 25 MiB; local audio preparation supports walkthroughs under six minutes; source text up to 12,000 characters. Start with a short clip.

Do not publish during this acceptance run. Hosted credentials, live R2 storage, provider calls, HTTPS recording and external sharing require a separately approved deployment test. Local links work only on this computer.
