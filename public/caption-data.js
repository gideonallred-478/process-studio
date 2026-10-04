function validPhrase(part){
 if(!part||typeof part!=='object'||Array.isArray(part)||typeof part.text!=='string'||part.text.length>200000)return false;
 return ['time','end'].every(key=>part[key]==null||typeof part[key]==='number'&&Number.isFinite(part[key])&&part[key]>=0);
}
export function validCaptionSegments(segments){return Array.isArray(segments)&&segments.length<=10000&&segments.every(validPhrase);}
export function safeCaptionSegments(segments){return Array.isArray(segments)?segments.filter(validPhrase).slice(0,10000):[];}
