import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../public/automation-engine.js';
import { assessStep } from '../decision-policy.js';
import { validateLocalAnalysis } from '../local-analysis.js';
import {buildBlueprint} from '../public/blueprint.js';
const step = evidence => ({ evidence, instruction:evidence, automation:'candidate', integration:'none', approval:'not-required', uncertainties:[] });

test('conditional and prohibited source steps cannot run by confirming settings',()=>{
 for(const source of ['If status is approved, calculate quantity times price into a new total column.','Never sort the local CSV.','Calculate totals unless the customer is blocked.']){
  const assessment=engine.planStep(step(source),source);assert.equal(assessment.executionBlocked,true);
  const config={...engine.configureStep(step(source),source),operation:'calculate',field:'quantity',secondField:'price',operator:'multiply',outputField:'total',enabled:true,confirmed:true};
  assert.throws(()=>engine.runWorkflow([config],[{quantity:2,price:4,status:'rejected'}]),/condition|prohibition|blocked/i);
 }
});
test('conditions in an earlier source sentence cannot be dropped from a later operation',()=>{
 const source='Calculate quantity times price into a new total column.';
 const context='Only process approved requests. '+source;
 assert.equal(engine.planStep(step(source),context).executionBlocked,true);
});
test('runner refuses supplied rules it cannot enforce even without a source assessment',()=>{
 assert.throws(()=>engine.runPlan({operation:'copy',field:'name',outputField:'copy',condition:{field:'status',equals:'approved'}},[{name:'A',status:'rejected'}]),/condition|rule/i);
});
test('implicit branches and changes to the described operation or fields cannot execute',()=>{
 for(const source of ['Calculate quantity times price into a new total column for approved customers.','Copy the name for customers with status approved.','Sort everyone except blocked customers.'])assert.equal(engine.planStep(step(source),source).executionBlocked,true);
 const config=engine.configureStep(step('Calculate quantity multiplied by unit_price into a new total column in the local CSV.'));
 assert.throws(()=>engine.runPlan({...config,secondField:'cost'},[{quantity:2,unit_price:4,cost:1}]),/source|match|field/i);
 assert.throws(()=>engine.runPlan({...config,operation:'copy'},[{quantity:2,unit_price:4}]),/source|match|operation/i);
});

test('copy, lookup and duplicate-key settings preserve fields named by the source',()=>{
 const copy=engine.configureStep(step('Copy the column name into a new copied_name column in the local CSV.'));
 assert.equal(copy.field,'name');assert.equal(copy.outputField,'copied_name');
 assert.equal(engine.runPlan(copy,[{name:'Alice'}]).rows[0].copied_name,'Alice');
 assert.throws(()=>engine.runPlan({...copy,field:'other'},[{name:'Alice',other:'Bob'}]),/source/);
 const lookup=engine.configureStep(step('Copy review_date from matching rows by customer_id in the local CSV.'));
 assert.equal(lookup.field,'customer_id');assert.equal(lookup.secondField,'review_date');
 assert.throws(()=>engine.runPlan({...lookup,secondField:'other',outputField:'date',referenceRows:[{customer_id:'1',other:'wrong'}]},[{customer_id:'1'}]),/source/);
 const dedup=engine.configureStep(step('Remove duplicate rows from the local CSV by customer_id.'));
 assert.equal(dedup.operation,'deduplicate');assert.equal(dedup.field,'customer_id');
 assert.throws(()=>engine.runPlan({...dedup,field:'name'},[{customer_id:'1',name:'A'}]),/source/);
});

test('drafts, refund labels and local files do not imply external side effects',()=>{
 for(const source of ['Save email drafts locally; do not send them.','Add a label when the request contains refund.','Calculate totals in a local spreadsheet.']) {
  const result=assessStep(step(source));
  assert.equal(result.approval,'not-required');assert.equal(result.integration,'none');
 }
 assert.equal(assessStep(step('Send the reply.')).approval,'required');
 assert.equal(assessStep(step('Issue a refund.')).approval,'required');
 assert.equal(assessStep(step('Do not send emails, but publish the report.')).approval,'required');
 assert.equal(assessStep(step('Send the locally saved draft.')).integration,'required');
});
test('equivalent prepositions preserve feasibility but contradictions stay uncertain',()=>{
 const evidence='Copy the review date into the sheet.';
 const raw=instruction=>({steps:[{...step(evidence),title:'Copy',instruction,tools:[],reason:'Copy a field.'}]});
 assert.equal(validateLocalAnalysis(raw('Copy the review date to the sheet.'),evidence).steps[0].automation,'candidate');
 assert.equal(validateLocalAnalysis(raw('Delete the sheet.'),evidence).steps[0].automation,'uncertain');
});
test('planner distinguishes supported local task, incomplete rule, judgment and unknown CRM',()=>{
 assert.equal(engine.planStep(step('Sort the local CSV by customer_name ascending.')).operation,'sort');
 assert.equal(engine.planStep(step('Handle it the usual way.')).feasibility,'unknown');
 assert.equal(engine.planStep({...step('Decide whether the refund is fair.'),automation:'human'}).status,'Person decides');
 const plan=engine.planStep(step('Copy the customer name from the CRM into the sheet.'));
 assert.equal(plan.connection.state,'unidentified');assert.ok(plan.missing.some(x=>/CRM/.test(x)));
 assert.notEqual(plan.readiness,'ready');
});
test('CSV quotes, embedded newline, CRLF and BOM round trip without row loss',()=>{
 const text='\uFEFFname,note\r\n"A, B","line one\nline two"\r\nC,"say ""hi"""\r\n';
 const rows=engine.parseData(text,'csv');assert.equal(rows.length,2);assert.equal(rows[1].note,'say "hi"');
 assert.deepEqual(engine.parseData(engine.serializeData(rows,'csv'),'csv'),rows);
 assert.throws(()=>engine.parseData('name,name\na,b','csv'),/duplicate/i);
 assert.throws(()=>engine.parseData('name,note\n"unfinished','csv'),/quote/i);
});
test('sort and calculation preserve inputs and reject missing or malformed fields',()=>{
 const rows=[{name:'Z',qty:'2',price:'3.5'},{name:'A',qty:'1',price:'4'}], original=structuredClone(rows);
 const sorted=engine.runPlan({operation:'sort',field:'name',direction:'asc'},rows);
 assert.deepEqual(sorted.rows.map(x=>x.name),['A','Z']);assert.deepEqual(rows,original);
 const calculated=engine.runPlan({operation:'calculate',field:'qty',secondField:'price',outputField:'total',operator:'multiply'},rows);
 assert.equal(calculated.rows[0].total,7);assert.equal(calculated.rows.length,2);
 assert.throws(()=>engine.runPlan({operation:'calculate',field:'qty',secondField:'price',outputField:'total',operator:'multiply'},[{qty:'',price:'3'}]),/number/i);
 assert.throws(()=>engine.runPlan({operation:'sort',field:'absent'},rows),/field/i);
});
test('deduplication and filtering report discarded rows explicitly',()=>{
 const rows=[{id:'a'},{id:'a'},{id:'b'}];
 const output=engine.runPlan({operation:'deduplicate',field:'id'},rows);assert.equal(output.rows.length,2);assert.equal(output.audit.removedRows,1);
 assert.throws(()=>engine.runPlan({operation:'deduplicate',field:'id'},[{id:''}]),/empty/i);
 assert.equal(engine.runPlan({operation:'filter',field:'id',value:'b',comparison:'equals'},rows).rows.length,1);
});
test('template outputs are local drafts; unknown operations and unsafe fields cannot execute',()=>{
 const output=engine.runPlan({operation:'template',template:'Hello {{name}}',outputField:'draft'},[{name:'Alice'}]);
 assert.equal(output.rows[0].draft,'Hello Alice');assert.equal(output.audit.externalWrites,0);
 assert.throws(()=>engine.runPlan({operation:'template',template:'{{missing}}',outputField:'draft'},[{name:'Alice'}]),/field/i);
 assert.throws(()=>engine.runPlan({operation:'shell',command:'anything'},[]),/supported/i);
 assert.throws(()=>engine.runPlan({operation:'copy',field:'name',outputField:'__proto__'},[{name:'A'}]),/field/i);
 assert.throws(()=>engine.runPlan({operation:'copy',field:'name',outputField:'name'},[{name:'A'}]),/existing/i);
});
test('sample verification is scoped, failures stop execution and full runs revalidate',()=>{
 const plan={operation:'calculate',field:'qty',secondField:'price',outputField:'total',operator:'multiply'};
 const rows=[{qty:2,price:3},{qty:4,price:5}];
 const report=engine.verifyPlan(plan,rows);assert.equal(report.passed,true);assert.equal(report.scope,'Selected data only');
 assert.equal(engine.verifyPlan(plan,[{qty:'bad',price:3}]).passed,false);
 assert.throws(()=>engine.runPlan(plan,[{qty:'bad',price:3}]),/number/i);
});
test('a workflow chains only supported steps and stops atomically on a later error',()=>{
 const rows=[{id:'b',qty:2,price:3},{id:'a',qty:4,price:5}];
 const plans=[{operation:'sort',field:'id'},{operation:'calculate',field:'qty',secondField:'price',outputField:'total',operator:'multiply'}];
 const result=engine.runWorkflow(plans,rows);assert.equal(result.rows[0].id,'a');assert.equal(result.rows[0].total,20);assert.equal(result.audit.length,2);
 assert.throws(()=>engine.runWorkflow([...plans,{operation:'copy',field:'missing',outputField:'new'}],rows),/Step 3/);
 assert.deepEqual(rows,[{id:'b',qty:2,price:3},{id:'a',qty:4,price:5}]);
});
test('planner carries dependencies and exposes unsupported app actions',()=>{
 const plan=engine.planStep(step('Copy the name into the sheet.'),'Open the customer inquiry in the CRM.');
 assert.equal(plan.connection.state,'unidentified');assert.ok(plan.missing.some(x=>x.includes('CRM')));
 const unsupported=engine.planStep(step('Delete the Slack workspace.'));
 assert.equal(unsupported.connection.state,'unsupported-action');assert.notEqual(unsupported.status,'Supported app route; setup needed');
 assert.equal(engine.planStep(step('Sort the list.'),'Sort the list. Open the CRM afterwards.').connection.state,'local');
});
test('exports neutralize spreadsheet formulas and calculation stops on zero divisors',()=>{
 assert.match(engine.serializeData([{value:'=HYPERLINK("bad")'}],'csv'),/'=HYPERLINK/);
 assert.throws(()=>engine.runPlan({operation:'calculate',field:'a',secondField:'b',operator:'divide',outputField:'c'},[{a:1,b:0}]),/zero/i);
 assert.throws(()=>engine.parseData('[{"__proto__":"bad"}]','json'),/field/i);
});
test('empty filtered output preserves CSV headers and skips later operations',()=>{
 const result=engine.runWorkflow([{operation:'filter',field:'name',comparison:'equals',value:'Nobody'},{operation:'sort',field:'name'}],[{name:'Alice',qty:1}]);
 assert.equal(result.rows.length,0);assert.deepEqual(result.columns,['name','qty']);
 assert.equal(engine.serializeData(result.rows,'csv',result.columns),'name,qty');
});
test('suggested settings use explicit source fields and include visible form defaults',()=>{
 const source='Calculate quantity multiplied by unit_price into a new total column in the local CSV.';
 const config=engine.configureStep(step(source));
 assert.equal(config.operator,'multiply');assert.equal(config.field,'quantity');assert.equal(config.secondField,'unit_price');assert.equal(config.outputField,'total');assert.equal(config.confirmed,false);
 assert.equal(engine.configureStep(step('Filter the CSV.')).comparison,'equals');
});
test('matching rows by key rejects duplicate and missing matches instead of copying wrong values',()=>{
 const plan={operation:'lookup',field:'customer_id',secondField:'review_date',outputField:'copied_date',referenceRows:[{customer_id:'2',review_date:'2026-10-03'},{customer_id:'1',review_date:'2026-10-02'}]};
 const result=engine.runPlan(plan,[{customer_id:'1'},{customer_id:'2'}]);
 assert.equal(result.rows[0].copied_date,'2026-10-02');
 assert.throws(()=>engine.runPlan({...plan,referenceRows:[...plan.referenceRows,plan.referenceRows[0]]},[{customer_id:'2'}]),/duplicate/i);
 assert.throws(()=>engine.runPlan(plan,[{customer_id:'3'}]),/match/i);
 assert.equal(engine.planStep(step('Copy review_date from the local CSV into rows with matching customer_id.')).operation,'lookup');
});
test('exported blueprints include capability readiness and specific missing connection details',()=>{
 const blueprint=buildBlueprint({steps:[step('Copy the name from the CRM into the sheet.')]});
 assert.equal(blueprint[0].plan.connection.connected,false);assert.ok(blueprint[0].missing.some(x=>x.includes('Which CRM')));
});
test('template expansion stops before creating an oversized output',()=>{
 assert.throws(()=>engine.runPlan({operation:'template',template:'x'.repeat(10000),outputField:'draft'},Array.from({length:1100},()=>({name:'A'}))),/too large/i);
});
