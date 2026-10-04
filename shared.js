import { normalizeResult, assessStep } from './decision-policy.js';
import { validateLocalAnalysis, sourceCoverage, policyVersion } from './local-analysis.js';
export function sentences(transcript, minLength = 8) {
  return transcript.replace(/\r/g, '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > minLength);
}

function category(line) {
  const decision = assessStep({ instruction: line, evidence: line });
  const reason = decision.automation === 'human' ? 'This stated judgment or account access needs a person.' : decision.automation === 'candidate' ? 'The stated mechanical task may be prepared for review; confirm its connections and authorization.' : 'The source does not state a repeatable rule. Review the missing context.';
  return [decision.category, reason];
}

export function makeDraft(transcript, { minLength = 8 } = {}) {
  const lines = sentences(transcript, minLength);
  const heading = line => line.replace(/^(first|next|then|finally),?\s+/i, '').replace(/[.!?]$/, '').split(/\s+/).slice(0, 5).join(' ').replace(/^./, c => c.toUpperCase());
  const steps = lines.map((line, i) => {
    const [type, reason] = category(line);
    return { title: heading(line) || `Step ${i + 1}`, instruction: line, evidence: line, category: type, reason };
  });
  const actions = lines.filter(line => /need to|should|follow up|remember|next|must|then/i.test(line)).map(line => ({ text: line, evidence: line }));
  const coverage = sourceCoverage(transcript, steps);
  const issues = coverage.complete ? [] : ['Some source text is not represented in the draft. Review short lines, conditions and exceptions.'];
  return normalizeResult({ title: lines.length ? heading(lines[0]) : 'Untitled process', summary: 'Basic local draft. Decisions with missing context are marked uncertain; review every step.', owner: '', trigger: '', expectedOutcome: '', exceptionPath: '', outcome: '', exception: '', steps, actions, issues, policyVersion, validation: { sourceQuotesChecked: true, instructionsSourceExtractive: true, semanticAccuracyVerified: false, rejectedItems: 0, coverage } });
}

export function makePastedDraft(notes) {
  const clean = notes.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/gm, '');
  const draft = makeDraft(clean, { minLength: 2 });
  draft.summary = 'Local draft from pasted notes. Review each step and add missing detail.';
  return draft;
}

export function validateAiResult(input, transcript) {
  // Category-only callers also use the unified source checks and explicit unknowns.
  const steps = (Array.isArray(input?.steps) ? input.steps : []).map(step => ({ ...step,
    automation: step.automation || (step.category === 'automate' ? 'candidate' : step.category === 'human' ? 'human' : 'uncertain'),
    integration: step.integration || (step.category === 'integration' ? 'required' : 'unknown'),
    approval: step.approval || 'unknown', tools: step.tools || [], uncertainties: step.uncertainties || [] }));
  return validateLocalAnalysis({ ...input, steps }, transcript);
}

export function auditEvidence(result, transcript) {
  const source = String(transcript || '');
  const check = item => {
    const quote = String(item?.evidence || '').trim();
    return quote ? (source.includes(quote) ? 'matched' : 'unmatched') : 'inference';
  };
  const steps = (result?.steps || []).map(check);
  const actions = (result?.actions || []).map(check);
  return { steps, actions, matched: [...steps, ...actions].filter(x => x === 'matched').length, unmatched: [...steps, ...actions].filter(x => x === 'unmatched').length, inference: [...steps, ...actions].filter(x => x === 'inference').length };
}

export function moveStep(steps, index, direction) {
  const target = index + direction;
  if (!Number.isInteger(index) || ![-1, 1].includes(direction) || target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function splitStep(steps, index) {
  const step = steps[index];
  if (!step) return steps;
  const instruction = String(step.instruction || '').trim();
  const boundary = /[.!?]\s+(?=\S)/.exec(instruction);
  if (!boundary) return steps;
  const first = instruction.slice(0, boundary.index + 1);
  const second = instruction.slice(boundary.index + boundary[0].length);
  const exact = String(step.evidence || '').trim() === instruction;
  const make = (part) => assessStep({ ...step, title: part.replace(/[.!?]$/, '').split(/\s+/).slice(0, 5).join(' '), instruction: part, evidence: exact ? part : '', category: 'human', automation: 'uncertain', integration: 'unknown', approval: 'unknown', decisionReviewed: false, uncertainties: ['Review this split step again.'], reason: 'Review this split step before automating.' });
  return [...steps.slice(0, index), make(first), make(second), ...steps.slice(index + 1)];
}

export function mergeStep(steps, index, transcript) {
  if (!steps[index] || !steps[index + 1]) return steps;
  const first = steps[index], second = steps[index + 1];
  const instruction = `${first.instruction.trim()} ${second.instruction.trim()}`;
  const joinedEvidence = `${String(first.evidence || '').trim()} ${String(second.evidence || '').trim()}`.trim();
  const evidence = first.evidence && second.evidence && String(transcript || '').includes(joinedEvidence) ? joinedEvidence : '';
  const category = [first.category, second.category].includes('human') ? 'human' : [first.category, second.category].includes('integration') ? 'integration' : 'automate';
  const reason = [first.reason, second.reason].filter(Boolean).join(' ');
  return [...steps.slice(0, index), assessStep({ ...first, instruction, evidence, category, reason, automation: category === 'human' ? 'human' : 'uncertain', integration: [first.integration, second.integration].includes('required') ? 'required' : 'unknown', approval: [first.approval, second.approval].includes('required') ? 'required' : 'unknown', decisionReviewed: false, uncertainties: ['Review the merged step again.'] }), ...steps.slice(index + 2)];
}
