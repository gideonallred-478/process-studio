export const automationOptions = ['candidate', 'human', 'uncertain'];
export const connectionOptions = ['required', 'none', 'unknown'];
export const approvalOptions = ['required', 'not-required', 'unknown'];
const text = value => String(value || '').trim();

export function assessStep(step, { source = 'rules' } = {}) {
  const content = `${text(step.evidence)} ${text(step.instruction)}`;
  const judgment = /(?:^|[.!?;]\s*|\b(?:then|and|to|must|should|please|manager|person)\s+)(?:review|approve|decide|judge|assess|escalate|diagnose|interpret|sign[ -]?off)\b|\b(?:review|approve|assess|interpret)\s+(?:the|a|an|whether|if|each|any|all|this|that)\b|\b(?:human judgment|check for accuracy|log in|sign in|authenticate)\b/i.test(content);
  const active = content.replace(/\b(?:do not|don't|never|must not)\s+(?:send|publish|post|delete|remove|pay|refund|charge|transfer|purchase|cancel)\b[^.;!?]*?(?=[.;!?]|\b(?:but|then|and)\s+(?:send|publish|post|delete|pay|refund|charge|transfer|purchase|cancel)\b|$)/gi, '');
  const effect = /\b(send|publish|post|delete|pay|charge|transfer|purchase|cancel|grant access|change permissions)\b|\b(?:issue|process|give|execute)\s+(?:a\s+|the\s+)?(?:refund|payment)\b|(?:^|[.;!?]\s*)refund\s+\w/i.test(active) || /\bremove\b(?!\s+duplicates?)/i.test(active);
  const local = /\b(local|locally|csv|json)\b/i.test(active) && !/\b(crm|inbox|gmail|google sheets|slack|notion|sync|upload|api|send|publish|post)\b/i.test(active);
  const boundary = !local && /\b(email|inbox|crm|gmail|slack|notion|sheet|spreadsheet|calendar|upload|sync|database|api|account|send|publish|post)\b/i.test(active);
  const mechanical = /\b(sort|format|calculate|count|convert|rename|deduplicate|extract|copy|add|record|log|remind)\b/i.test(content);
  let automation = automationOptions.includes(step.automation) ? step.automation : source === 'rules' ? (judgment ? 'human' : mechanical ? 'candidate' : 'uncertain') : 'uncertain';
  let integration = connectionOptions.includes(step.integration) ? step.integration : boundary ? 'required' : 'unknown';
  let approval = approvalOptions.includes(step.approval) ? step.approval : 'unknown';
  const uncertainties = Array.isArray(step.uncertainties) ? step.uncertainties.map(text).filter(Boolean) : [];
  const safeguards = Array.isArray(step.safeguards) ? [...step.safeguards] : [];
  const policyOverrides = Array.isArray(step.policyOverrides) ? [...step.policyOverrides] : [];
  const override = (field, from, to, reason) => {
    if (from !== to && !policyOverrides.some(item => item.field === field && item.from === from && item.to === to && item.reason === reason)) policyOverrides.push({ field, from, to, reason });
  };
  if (judgment) { override('automation', automation, 'human', 'An explicit judgment or account-access action needs a person.'); override('approval', approval, 'required', 'Judgment or account access requires authorization.'); automation = 'human'; approval = 'required'; safeguards.push('Human judgment or account access needs review.'); }
  if (effect) { override('approval', approval, 'required', 'An external action or destructive change needs approval.'); approval = 'required'; safeguards.push('An external action or destructive change needs approval.'); }
  if (boundary) { override('integration', integration, 'required', 'The source names a tool boundary.'); integration = 'required'; }
  if (automation === 'uncertain' && !uncertainties.length) uncertainties.push('The source does not define enough detail to assess automation.');
  if (integration === 'unknown') uncertainties.push('Confirm which tools, if any, this step uses.');
  if (approval === 'unknown') uncertainties.push('Confirm who authorizes this step.');
  const unique = [...new Set(uncertainties)];
  return { ...step, automation, integration, approval, uncertainties: unique, safeguards: [...new Set(safeguards)], policyOverrides,
    category: automation === 'human' ? 'human' : integration === 'required' ? 'integration' : automation === 'candidate' ? 'automate' : 'human',
    reviewRequired: true, executable: false };
}

export function normalizeResult(result, source = 'rules') {
  return { ...result, steps: (result.steps || []).map(step => assessStep(step, { source })), executable: false, reviewRequired: true };
}
