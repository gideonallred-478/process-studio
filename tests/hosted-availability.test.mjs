import test from 'node:test';import assert from 'node:assert/strict';
import {readWorkspaceSession} from '../public/availability.js';
test('only an explicit unconfigured hosted session opens as a preview',async()=>{
 const data=await readWorkspaceSession(async()=>Response.json({code:'HOSTED_STORAGE_NOT_CONFIGURED',storage:false},{status:503}));assert.equal(data.storage,false);
 await assert.rejects(readWorkspaceSession(async()=>Response.json({error:'Storage is paused'},{status:503})),/Storage is paused/);
 await assert.rejects(readWorkspaceSession(async()=>new Response('bad gateway',{status:502})),/Workspace could not open/);
 await assert.rejects(readWorkspaceSession(async()=>{throw Error('Offline')}),/Offline/);
 const valid={owner:'synthetic-owner'};assert.deepEqual(await readWorkspaceSession(async()=>Response.json(valid)),valid);
});
