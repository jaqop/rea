/** Mechanical guards informed by independent-engine comparison. No semantic verdict. */
function words(text) {
  return [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map(match=>({start:match.index,end:match.index+match[0].length,key:match[0].normalize('NFD').replace(/\p{M}|ـ/gu,'').toLowerCase().replace(/[أإآٱ]/gu,'ا').replace(/ى/gu,'ي')}));
}
function keys(tokens,n) {const set=new Set();for(let i=0;i+n<=tokens.length;i++)set.add(tokens.slice(i,i+n).map(x=>x.key).join(' '));return set;}
export function createBorrowingGuard(source,target,{reject_words=8,review_words=5}={}) {
  if(typeof source!=='string'||typeof target!=='string')throw Error('Borrowing guard needs source and original target text.');
  if(!Number.isSafeInteger(reject_words)||reject_words<5||reject_words>30||!Number.isSafeInteger(review_words)||review_words<3||review_words>=reject_words)throw Error('Invalid borrowing guard word lengths.');
  const s=words(source),t=words(target),rejectSource=keys(s,reject_words),rejectOriginal=keys(t,reject_words),reviewSource=keys(s,review_words),reviewOriginal=keys(t,review_words);
  return candidate=>{
    const tokens=words(candidate);
    const find=(n,sourceKeys,originalKeys)=>{const matches=[];for(let i=0;i+n<=tokens.length&&matches.length<20;i++){const key=tokens.slice(i,i+n).map(x=>x.key).join(' ');if(sourceKeys.has(key)&&!originalKeys.has(key)){const start=tokens[i].start,end=tokens[i+n-1].end;matches.push({start,end,words:n,text:candidate.slice(start,end)});}}return matches;};
    return{rejected:find(reject_words,rejectSource,rejectOriginal),review:find(review_words,reviewSource,reviewOriginal),scope:'Normalized literal word sequences only. Existing target wording is exempt. Zero matches do not prove originality; ordinary wording can yield false positives.'};
  };
}
