import {planStep} from './automation-engine.js';
export function buildBlueprint(result) {
 const context=(result?.steps||[]).map(s=>s.evidence||s.instruction||'').join(' ');
 return (result?.steps||[]).map((step,index)=>{
  const plan=planStep(step,context);
  return {number:index+1,title:step.title,instruction:step.instruction,source:step.evidence,tools:Array.isArray(step.tools)?step.tools:[],automation:step.automation||'uncertain',integration:step.integration||'unknown',approval:step.approval||'unknown',condition:(/\b(if|when|unless|until)\b[^.!?]*/i.exec(step.instruction||'')||[])[0]||null,plan,missing:[...new Set([...(step.uncertainties||[]),...plan.missing,...(step.approval==='required'?['Keep a person responsible for approval.']:[])])],reviewed:Boolean(step.decisionReviewed)};
 });
}
