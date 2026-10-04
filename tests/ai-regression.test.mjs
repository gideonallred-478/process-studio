import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSchema, validateLocalAnalysis, sourceCoverage, analyzeLocally } from '../local-analysis.js';
import { assessStep, normalizeResult } from '../decision-policy.js';
import { makeDraft, sentences, validateAiResult } from '../shared.js';
const step=(source, extra={})=>({title:'Task',instruction:source,evidence:source,automation:'candidate',integration:'none',approval:'not-required',tools:[],reason:'Mechanical work.',uncertainties:[],...extra});

test('contradictory instruction with a genuine quote becomes source text with retained proposal and warning',()=>{
 const source='Copy the customer name into the sheet.';
 const result=validateLocalAnalysis({steps:[step(source,{instruction:'Delete all customer records.'})]},source);
 assert.equal(result.steps[0].instruction,source);
 assert.equal(result.steps[0].proposedInstruction,'Delete all customer records.');
 assert.equal(result.steps[0].automation,'uncertain');
 assert.equal(result.steps[0].modelDecision.automation,'candidate');
 assert.ok(result.steps[0].policyOverrides.some(x=>x.field==='automation'));
 assert.equal(result.validation.sourceExtractiveReplacements,1);
 assert.ok(result.issues.some(x=>x.includes('replaced')));
 assert.equal(result.executable,false);
 assert.equal(result.validation.semanticAccuracyVerified,false);
});

test('follow-up text cannot hide an invented action behind a valid quote',()=>{
 const source='Copy the name.';
 const result=validateLocalAnalysis({steps:[step(source)],actions:[{text:'Delete the account.',evidence:source}]},source);
 assert.equal(result.actions[0].text,source);
 assert.equal(result.actions[0].proposedText,'Delete the account.');
 assert.ok(result.issues.some(x=>x.includes('follow-up')));
});

test('review as field name preserves mechanical decision; explicit review gets explained safeguards',()=>{
 const mechanical=assessStep(step('Copy the review date into the sheet.'),{source:'model'});
 assert.equal(mechanical.automation,'candidate');assert.equal(mechanical.approval,'not-required');
 const judgment=assessStep(step('Review the complaint in the CRM.'),{source:'model'});
 assert.equal(judgment.automation,'human');assert.equal(judgment.approval,'required');
 assert.ok(judgment.policyOverrides.some(x=>x.field==='automation'&&x.from==='candidate'&&x.to==='human'));
 const again=normalizeResult({steps:[judgment],model:'fixture-model',modelVersion:'fixture-version'},'model');
 assert.deepEqual(again.steps[0].policyOverrides,judgment.policyOverrides);
 assert.equal(again.model,'fixture-model');
});

test('rules fallback retains all fourteen sentences rather than silently truncating',()=>{
 const lines=Array.from({length:14},(_,i)=>'Copy customer field '+(i+1)+' into the sheet.');const source=lines.join(' ');
 assert.equal(sentences(source).length,14);
 const result=makeDraft(source);assert.equal(result.steps.length,14);assert.equal(result.steps.at(-1).instruction,lines.at(-1));
 assert.equal(result.validation.coverage.complete,true);
});

test('missing source and rejected items have independent coverage and rejection notices',()=>{
 const first='Copy the name.';const last='If the name is missing, ask the manager.';
 const result=validateLocalAnalysis({steps:[step(first),step('Invented step.')]},first+' '+last);
 assert.equal(result.steps.length,1);assert.equal(result.validation.rejectedItems,1);
 assert.equal(result.validation.coverage.complete,false);
 assert.ok(result.validation.coverage.omittedSegments.includes(last));
 assert.ok(result.issues.some(x=>x.includes('rejected')));assert.ok(result.issues.some(x=>x.includes('coverage')));
});

test('repeated source excerpts cannot falsely establish full coverage',()=>{
 const result=sourceCoverage('Copy the name. Copy the name.',[step('Copy the name.')]);
 assert.equal(result.complete,false);assert.equal(result.coveredCharacters,0);
});

test('both AI entry points use canonical facts and keep unstated or invented facts unknown',()=>{
 for(const field of ['owner','trigger','expectedOutcome','exceptionPath']) assert.ok(analysisSchema.required.includes(field));
 const source='Alice copies the name when an order arrives. Ask the manager if it is missing.';
 const raw={steps:[step(source)],owner:'Alice',trigger:'when an order arrives',expectedOutcome:'All records automatically synchronized',exceptionPath:'Ask the manager if it is missing.'};
 for(const validate of [validateLocalAnalysis,validateAiResult]){
  const result=validate(raw,source);assert.equal(result.owner,'Alice');assert.equal(result.trigger,'when an order arrives');
  assert.equal(result.expectedOutcome,'');assert.equal(result.outcome,'');assert.equal(result.exception,result.exceptionPath);
  assert.ok(result.issues.some(x=>x.includes('expectedOutcome')));
 }
});

test('legacy category-only validation also refuses contradictory instructions',()=>{
 const source='Copy the name.';
 const result=validateAiResult({steps:[{instruction:'Delete records.',evidence:source,category:'automate'}]},source);
 assert.equal(result.steps[0].instruction,source);assert.equal(result.steps[0].automation,'uncertain');
});

test('local request uses unified schema and keeps engine provenance',async()=>{
 const source='Copy the name into the sheet.';
 const result=await analyzeLocally(source,{fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);assert.deepEqual(body.response_format.json_schema.schema,analysisSchema);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({steps:[step(source)]})}}]});
 }});
 assert.equal(result.method,'local-model');assert.ok(result.model);assert.ok(result.modelVersion);assert.equal(result.policyVersion,'2026-10-03-v2');
});

test('automation, integration and approval remain independent on a specified outgoing template',()=>{
 const source='Send the approved email template from the inbox.';
 const result=validateLocalAnalysis({steps:[step(source)]},source).steps[0];
 assert.equal(result.automation,'candidate');assert.equal(result.integration,'required');assert.equal(result.approval,'required');
 assert.deepEqual(result.modelDecision,{automation:'candidate',integration:'none',approval:'not-required'});
 assert.ok(result.policyOverrides.some(x=>x.field==='integration'));assert.ok(result.policyOverrides.some(x=>x.field==='approval'));
});

test('model validation retains more than sixteen supported steps without a hidden cap',()=>{
 const lines=Array.from({length:22},(_,i)=>'Copy customer field '+(i+1)+'.');
 const result=validateLocalAnalysis({steps:lines.map(line=>step(line))},lines.join(' '));
 assert.equal(result.steps.length,22);assert.equal(result.validation.coverage.complete,true);
});
