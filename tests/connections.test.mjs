import test from 'node:test';
import assert from 'node:assert/strict';
import * as checker from '../scripts/connection-check.mjs';
const request=(body,origin='http://127.0.0.1:4182')=>new Request('http://127.0.0.1:4182/api/connections/check',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
test('connection checks reject foreign origins before transmitting credentials',async()=>{
 let calls=0;const response=await checker.connectionCheck(request({provider:'gmail',token:'test'},'https://outside.example'),()=>{calls++;});
 assert.equal(response.status,403);assert.equal(calls,0);
});
test('Sheets check calls one fixed metadata URL and never claims write readiness or returns token',async()=>{
 const response=await checker.connectionCheck(request({provider:'google-sheets',token:'private-fixture',resource:'abc123'}),async(url,options)=>{
  assert.equal(new URL(url).hostname,'sheets.googleapis.com');assert.match(url,/spreadsheets\/abc123/);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer private-fixture');
  return Response.json({spreadsheetId:'abc123',sheets:[]});
 });
 const result=await response.json();assert.equal(result.readAccessVerified,true);assert.equal(result.writeAccessVerified,false);assert.ok(!JSON.stringify(result).includes('private-fixture'));
});
test('unknown providers, arbitrary URLs and failed authentication stay unverified',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return Response.json({error:'token details should not leak'},{status:401});};
 assert.equal((await checker.connectionCheck(request({provider:'arbitrary',token:'x',resource:'https://outside.example'}),fetchImpl)).status,400);
 assert.equal((await checker.connectionCheck(request({provider:'google-sheets',token:'x',resource:'../../escape'}),fetchImpl)).status,400);
 assert.equal(calls,0);const response=await checker.connectionCheck(request({provider:'gmail',token:'x'}),fetchImpl);
 assert.equal(response.status,401);assert.equal((await response.json()).readAccessVerified,false);
});
test('Gmail profile and Slack authentication probes retain their narrow scope',async()=>{
 const gmail=await checker.connectionCheck(request({provider:'gmail',token:'fixture'}),async(url,options)=>{assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/profile');assert.equal(options.method,'GET');return Response.json({emailAddress:'fixture@example.test'});});
 const profile=await gmail.json();assert.equal(profile.probe,'account-profile');assert.equal(profile.writeAccessVerified,false);assert.match(profile.note,/Reading messages.*still need verification/);
 const slack=await checker.connectionCheck(request({provider:'slack',token:'fixture'}),async(url,options)=>{assert.equal(url,'https://slack.com/api/auth.test');assert.equal(options.method,'POST');return Response.json({ok:true});});
 const auth=await slack.json();assert.equal(auth.accountAccessVerified,true);assert.equal(auth.readAccessVerified,false);assert.equal(auth.writeAccessVerified,false);
});
