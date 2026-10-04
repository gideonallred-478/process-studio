// No network, filesystem access, eval, or model-generated executable code.
export const capabilities = Object.freeze([
 {id:'sort',label:'Sort rows',required:['field'],effect:'Reorder rows; retain all rows'},
 {id:'filter',label:'Keep matching rows',required:['field','comparison','value'],effect:'Remove non-matching rows from the output copy'},
 {id:'deduplicate',label:'Remove duplicate rows',required:['field'],effect:'Keep the first row for each non-empty key'},
 {id:'calculate',label:'Calculate a new column',required:['field','secondField','operator','outputField'],effect:'Add a numeric column'},
 {id:'copy',label:'Copy a column',required:['field','outputField'],effect:'Add a column; preserve the original'},
 {id:'lookup',label:'Copy from matching rows',required:['field','secondField','outputField','referenceRows'],effect:'Match a unique key in a reference file; stop on missing or duplicate matches'},
 {id:'template',label:'Create template drafts',required:['template','outputField'],effect:'Add locally generated text; never send it'},
]);
export const connectors = Object.freeze([
 {id:'google-sheets',name:'Google Sheets',match:/\bgoogle sheets?\b/i,route:'Sheets API or CSV import/export',actions:['Read rows','Append rows','Update cells'],source:'https://developers.google.com/workspace/sheets/api/reference/rest',verifiedAt:'2026-10-03',requires:['Choose the spreadsheet and columns','Authorize account access','Check plan quotas and permissions']},
 {id:'gmail',name:'Gmail',match:/\bgmail\b/i,route:'Gmail API',actions:['Read messages','Create drafts','Send messages'],source:'https://developers.google.com/workspace/gmail/api/reference/rest',verifiedAt:'2026-10-03',requires:['Choose the mailbox and action','Authorize the required account permissions','Sending needs approval']},
 {id:'slack',name:'Slack',match:/\bslack\b/i,route:'Slack Web API',actions:['Read permitted conversations','Post messages'],source:'https://docs.slack.dev/reference/methods/',verifiedAt:'2026-10-03',requires:['Choose the workspace and channel','Install an authorized app with required scopes','Check workspace plan limits']},
]);
const safeField = name => { if(typeof name!=='string'||!name.trim()||name.length>100||['__proto__','constructor','prototype'].includes(name)) throw new Error('Choose a valid field name.');return name; };
const localOnly = text => /\b(local|locally|csv|json)\b/i.test(text)&&! /\b(crm|gmail|google sheets|slack|notion|inbox|sync|upload)\b/i.test(text);
export function executionRules(step,context='') {
 const source=String(step.evidence||step.instruction||'');
 const text=[source,step.instruction||'',context,...(step.uncertainties||[])].join(' ');
 const conditions=/\b(if|unless|until|when|only|except|otherwise|provided|before|after|where|whose)\b|\b(?:for|with)\s+(?:status|approved|rejected|eligible|valid|active|blocked|customers who|rows that)\b/i.test(text);
 const prohibitions=/\b(do not|don't|must not|cannot|never|without|avoid|skip)\b/i.test(text);
 // Execution accepts a bounded unconditional sentence, not an arbitrary
 // sentence merely containing an operation word. Unknown qualifiers block.
 const sentence=source.trim().replace(/[.]$/,'').trim();
 const place='(?:the |a |our )?(?:local )?(?:CSV|JSON|spreadsheet|file|data|sheet|list|rows)';
 const tail='(?: in '+place+')?';
 const grammar=[
  'sort '+place+'(?: by [A-Za-z_][\\w-]*)?(?: ascending| descending)?',
  '(?:filter|deduplicate) '+place,
  'remove duplicate(?:s| rows)(?: from '+place+')?(?: by [A-Za-z_][\\w-]*)?',
  'calculate [A-Za-z_][\\w]* (?:multiplied by|times|\\*|plus|\\+|minus|divided by) [A-Za-z_][\\w]* into (?:a |the )?(?:new )?[A-Za-z_][\\w]* column'+tail,
  'copy (?:the )?(?:column |field )?[A-Za-z_][\\w]* (?:into|to) (?:a |the )?(?:new )?[A-Za-z_][\\w]* (?:column|field)'+tail,
  'copy (?:the )?[A-Za-z_][\\w]* from matching rows by [A-Za-z_][\\w]*'+tail,
  '(?:create|populate|fill|expand|generate) (?:the |a |approved )*template(?: drafts)?'+tail
 ];
 const recognized=grammar.some(pattern=>new RegExp('^'+pattern+'$','i').test(sentence));
 const reason=conditions?'This source has a condition or dependency the local runner cannot enforce. Keep this step manual or provide a separate unconditional walkthrough.':prohibitions?'This source has a prohibition the local runner cannot enforce. Keep this step manual.':!recognized?'This wording is outside the supported unconditional rules. Keep it manual or describe one supported operation without extra qualifiers.':'';
 return {executionBlocked:Boolean(reason),blockedReason:reason};
}
export function planStep(step, context='') {
 const source=String(step.evidence||step.instruction||'');
 const sourceIndex=context.indexOf(source),earlierContext=sourceIndex>=0?context.slice(0,sourceIndex):context;
 const previousSentence=earlierContext.split(/[.!?]\s*/).filter(s=>s.trim()).at(-1)||'';
 const refersBack=/\b(it|its|them|their|that|these|those|sheet|row|name|date|record|customer)\b/i.test(source);
 const externalContext=refersBack&&/\b(crm|gmail|google sheets|slack|notion|inbox)\b/i.test(previousSentence)?previousSentence:'';
 const combined=source+' '+externalContext;
 let operation=/\bsort\b/i.test(source)?'sort':/\bdeduplicat|remove duplicate/i.test(source)?'deduplicate':/\bfilter\b/i.test(source)?'filter':/\bcalculat|\bmultiply\b/i.test(source)?'calculate':/\btemplate\b/i.test(source)?'template':/\bcopy\b/i.test(source)?'copy':null;
 if(operation==='copy'&&/\bmatch(?:ing|ed)?\b/i.test(source))operation='lookup';
 const named=connectors.filter(c=>c.match.test(combined));
 const external=!localOnly(source)&&(/\b(crm|gmail|google sheets|slack|notion|inbox|calendar|sync|upload)\b/i.test(combined)||step.integration==='required');
 const missing=[];
 const rules=executionRules(step,context);if(rules.executionBlocked)missing.push(rules.blockedReason);
 const human=step.automation==='human'||/\b(decide|judge|approve|diagnose)\b/i.test(source);
 if(/\bcrm\b/i.test(combined))missing.push('Which CRM do you use? Its specific read/write action must be checked.');
 if(external&&!named.length)missing.push('Identify the app and required action; no supported connection is verified.');
 for(const c of named)missing.push(...c.requires);
 const unsupportedAction=named.length>0&&/\b(delete|refund|pay|grant|cancel|workspace settings|permissions)\b/i.test(source);
 if(unsupportedAction)missing.push('This requested action is outside the supported connector catalog; a generic app route does not verify it.');
 if(!operation&&!human)missing.push('Define an exact repeatable rule or choose a supported local operation.');
 if(operation&&!external)missing.push('Choose the input file and confirm the fields and operation settings.');
 const vague=/\b(usual way|as usual|best response|handle it)\b/i.test(source);
 if(vague)missing.push('Define the rule explicitly; the usual way is not an executable specification.');
 const feasibility=human?'human':vague?'unknown':operation?'supported-operation':step.automation==='candidate'?'candidate':'unknown';
 const fieldMatch=/\b(?:by|column|field)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(source);
 return {version:1,source,...rules,operation:external?null:operation,feasibility,status:human?'Person decides':external?unsupportedAction?'Requested app action is not verified':named.length?'Documented app route; setup needed':'App details needed':rules.executionBlocked?'Rule not executable':operation?'Local operation available':'Rule needed',
  suggestedSettings:operation==='sort'&&fieldMatch?{field:fieldMatch[1],direction:/\bdescend/i.test(source)?'desc':'asc'}:{},
  readiness:'not-verified',approval:step.approval||'unknown',connection:{state:external?unsupportedAction?'unsupported-action':named.length?'documented-route':'unidentified':'local',connected:false,routes:named.map(({match,...c})=>c)},missing:[...new Set(missing)],
  constraints:(source.match(/\b(?:do not|don't|never|must not)\b[^.!?]*/gi)||[]),externalExecutionAvailable:false};
}
export function validatePlan(plan) {
 if(plan?.sourceStep){
  const rules=executionRules(plan.sourceStep,plan.sourceContext||'');if(rules.executionBlocked)throw new Error(rules.blockedReason);
  const expected=configureStep(plan.sourceStep,plan.sourceContext||'');
  if(expected.operation!==plan.operation)throw new Error('The selected operation must match the source operation.');
  const explicit=['field','secondField','outputField','operator','direction'].filter(key=>expected[key]!==undefined&&(key!=='operator'||expected.operation==='calculate')&&(key!=='direction'||expected.operation==='sort'));
  for(const key of explicit)if(plan[key]!==expected[key])throw new Error('The '+key+' setting must match the source.');
 }
 if(plan?.executionBlocked)throw new Error(plan.blockedReason||'This source rule is blocked.');
 if(['condition','conditions','constraints','dependencies','branch','branches','predicate'].some(key=>plan?.[key]!=null))throw new Error('Conditional rules and prohibitions are not supported by this local runner.');
 const capability=capabilities.find(c=>c.id===plan?.operation);
 if(!capability)throw new Error('This operation is not supported by the local runner.');
 for(const key of capability.required)if(plan[key]===undefined||plan[key]===null||String(plan[key]).trim()==='')throw new Error('Choose '+key.replace(/([A-Z])/g,' $1').toLowerCase()+'.');
 for(const key of ['field','secondField','outputField'])if(plan[key]!==undefined&&plan[key]!=='')safeField(plan[key]);
 if(plan.direction&&!['asc','desc'].includes(plan.direction))throw new Error('Choose ascending or descending order.');
 if(plan.operation==='filter'&&!['equals','contains'].includes(plan.comparison))throw new Error('Choose a supported comparison.');
 if(plan.operation==='calculate'&&!['multiply','add','subtract','divide'].includes(plan.operator))throw new Error('Choose a supported calculation.');
 if(plan.template?.length>10000)throw new Error('Template is too long.');
 return capability;
}
export function configureStep(step,context='') {
 const assessment=planStep(step,context),source=assessment.source;
 const config={operation:assessment.operation||'',direction:'asc',operator:'multiply',comparison:'equals',...assessment.suggestedSettings,...executionRules(step,context),sourceStep:{evidence:step.evidence,instruction:step.instruction,uncertainties:step.uncertainties},sourceContext:context,enabled:false,confirmed:false};
 const calculation=/\bcalculate\s+([a-zA-Z_][\w]*)\s+(multiplied by|times|\*|plus|\+|minus|divided by)\s+([a-zA-Z_][\w]*)\s+into\s+(?:(?:a|the)\s+)?(?:new\s+)?([a-zA-Z_][\w]*)\s+column\b/i.exec(source);
 if(config.operation==='calculate'&&calculation){config.field=calculation[1];config.secondField=calculation[3];config.outputField=calculation[4];config.operator=/minus/i.test(calculation[2])?'subtract':/divided/i.test(calculation[2])?'divide':/plus|\+/i.test(calculation[2])?'add':'multiply';}
 const copy=/^copy (?:the )?(?:column |field )?([A-Za-z_][\w]*) (?:into|to) (?:a |the )?(?:new )?([A-Za-z_][\w]*) (?:column|field)\b/i.exec(source.trim());
 if(config.operation==='copy'&&copy){config.field=copy[1];config.outputField=copy[2];}
 const lookup=/^copy (?:the )?([A-Za-z_][\w]*) from matching rows by ([A-Za-z_][\w]*)\b/i.exec(source.trim());
 if(config.operation==='lookup'&&lookup){config.field=lookup[2];config.secondField=lookup[1];}
 const duplicateKey=/\bby ([A-Za-z_][\w-]*)/i.exec(source);
 if(config.operation==='deduplicate'&&duplicateKey)config.field=duplicateKey[1];
 return config;
}
function validateRows(rows) {
 if(!Array.isArray(rows)||rows.length===0)throw new Error('Provide at least one data row.');
 if(rows.length>25000)throw new Error('Use at most 25,000 rows per local run.');
 for(const row of rows) {
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Each row must contain named fields.');
  for(const [key,value] of Object.entries(row)) {safeField(key);if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new Error('Use flat rows with text, numbers, booleans or null values.');if(typeof value==='number'&&!Number.isFinite(value))throw new Error('All numbers must be finite.');}
 }
}
function field(row,name) {safeField(name);if(!Object.hasOwn(row,name))throw new Error('Missing field: '+name);return row[name];}
function numeric(value) {if(value===null||typeof value==='boolean'||String(value).trim()===''||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value).trim()))throw new Error('Every calculation input must be a valid number.');const n=Number(value);if(!Number.isFinite(n))throw new Error('Every calculation input must be a finite number.');return n;}
export function runPlan(plan,input) {
 const capability=validatePlan(plan);validateRows(input);
 const rows=input.map(row=>({...row}));
 if(plan.field)for(const row of rows)field(row,plan.field);
 if(plan.outputField&&rows.some(row=>Object.hasOwn(row,plan.outputField)))throw new Error('Choose a new output field; existing columns are preserved.');
 let output=rows;
 if(plan.operation==='sort') {const sign=plan.direction==='desc'?-1:1;output.sort((a,b)=>sign*String(field(a,plan.field)??'').localeCompare(String(field(b,plan.field)??''),'en',{numeric:false}));}
 if(plan.operation==='filter')output=rows.filter(row=>plan.comparison==='equals'?String(field(row,plan.field)??'')===String(plan.value):String(field(row,plan.field)??'').includes(String(plan.value)));
 if(plan.operation==='deduplicate') {const seen=new Set();output=rows.filter(row=>{const value=field(row,plan.field);if(value===null||String(value).trim()==='')throw new Error('Duplicate keys cannot be empty.');const key=JSON.stringify([typeof value,value]);if(seen.has(key))return false;seen.add(key);return true;});}
 if(plan.operation==='copy')for(const row of rows)row[plan.outputField]=field(row,plan.field);
 if(plan.operation==='lookup'){
  validateRows(plan.referenceRows);const lookup=new Map();
  const keyFor=row=>{const key=field(row,plan.field);if(key===null||String(key).trim()==='')throw new Error('Matching keys cannot be empty.');return JSON.stringify([typeof key,key]);};
  for(const row of plan.referenceRows){const key=keyFor(row);if(lookup.has(key))throw new Error('Duplicate matching key in the reference file.');lookup.set(key,field(row,plan.secondField));}
  for(const row of rows){const key=keyFor(row);if(!lookup.has(key))throw new Error('No matching reference row for key '+String(field(row,plan.field))+'.');row[plan.outputField]=lookup.get(key);}
 }
 if(plan.operation==='calculate')for(const row of rows){const a=numeric(field(row,plan.field)),b=numeric(field(row,plan.secondField));if(plan.operator==='divide'&&b===0)throw new Error('Cannot divide by zero.');const value={multiply:()=>a*b,add:()=>a+b,subtract:()=>a-b,divide:()=>a/b}[plan.operator]();if(!Number.isFinite(value))throw new Error('The calculation produced a non-finite number.');row[plan.outputField]=value;}
 if(plan.operation==='template')for(const row of rows){row[plan.outputField]=plan.template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_,name)=>String(field(row,name.trim())??''));if(/[{}]/.test(row[plan.outputField]))throw new Error('Use complete template fields such as {{first_name}}.');}
 let outputCharacters=0;for(const row of output){outputCharacters+=JSON.stringify(row).length;if(outputCharacters>10*1024*1024)throw new Error('Output is too large. Use fewer rows or a shorter template (10 MB text limit).');}
 return {rows:output,audit:{version:1,operation:capability.id,inputRows:input.length,outputRows:output.length,removedRows:input.length-output.length,externalWrites:0,originalChanged:false,completedAt:new Date().toISOString()},plan:{...plan}};
}
export function verifyPlan(plan,rows) {
 try{const result=runPlan(plan,rows);return {passed:true,scope:'Selected data only',checks:['Required fields present','Operation completed','Original input preserved','No external writes'],...result};}
 catch(error){return {passed:false,scope:'Selected data only',error:error.message};}
}
export function parseData(text,format='csv') {
 if(typeof text!=='string'||text.length>5*1024*1024)throw new Error('Use a text file smaller than 5 MB.');
 text=text.replace(/^\uFEFF/,'');
 if(format==='json'){const rows=JSON.parse(text);validateRows(rows);return rows;}
 if(format!=='csv')throw new Error('Choose CSV or JSON data.');
 const table=[];let row=[],value='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
  if(c==='"'){if(value||closed)throw new Error('Unexpected CSV quote.');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){row.push(value);value='';closed=false;if(c!==','){table.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}continue;}
  if(closed)throw new Error('Unexpected text after a CSV quote.');value+=c;
 }
 if(quoted)throw new Error('Unclosed CSV quote.');if(row.length||value||closed){row.push(value);table.push(row);}
 const headers=table.shift();if(!headers?.length)throw new Error('CSV needs a header row.');headers.forEach(safeField);
 if(new Set(headers).size!==headers.length)throw new Error('Duplicate CSV header names are not allowed.');
 const rows=table.map((values,index)=>{if(values.length!==headers.length)throw new Error('CSV row '+(index+2)+' has the wrong number of fields.');return Object.fromEntries(headers.map((name,i)=>[name,values[i]]));});validateRows(rows);return rows;
}
export function serializeData(rows,format='json',columns=[]) {
 if(format==='json')return JSON.stringify(rows,null,2);
 const fields=[...new Set([...columns,...rows.flatMap(row=>Object.keys(row))])];
 // Spreadsheet programs can interpret these prefixes as formulas. Neutralize on CSV export.
 const escape=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)&&!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(text))text="'"+text;return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
 return [fields.map(escape).join(','),...rows.map(row=>fields.map(name=>escape(row[name])).join(','))].join('\r\n');
}

export function runWorkflow(plans,rows) {
 if(!Array.isArray(plans)||!plans.length||plans.length>100)throw new Error('Select between one and 100 local steps.');
 validateRows(rows);plans.forEach(validatePlan);
 let current=rows;const audit=[],columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 for(let index=0;index<plans.length;index++){
  if(!current.length){audit.push({step:index+1,operation:plans[index].operation,skipped:true,reason:'No rows remain after filtering.',inputRows:0,outputRows:0,externalWrites:0});continue;}
  try{const result=runPlan(plans[index],current);current=result.rows;if(plans[index].outputField&&!columns.includes(plans[index].outputField))columns.push(plans[index].outputField);audit.push({...result.audit,step:index+1});}
  catch(error){throw new Error('Step '+(index+1)+': '+error.message);}
 }
 return {rows:current,columns,audit,externalWrites:0,originalChanged:false,completedAt:new Date().toISOString(),plans:plans.map(p=>({...p}))};
}
