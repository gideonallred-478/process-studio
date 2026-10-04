import worker from '../worker/index.js';
import {locked} from '../worker/storage-controls.js';
export function createLocalDeletion({env,jobs,sharing}){
 return async request=>{
  const url=new URL(request.url),match=/^\/api\/recordings\/([a-f0-9]{32})(?:\/(purge|damaged))?$/.exec(url.pathname);if(!match||request.method!=='DELETE')return null;
  if(request.headers.get('origin')!==url.origin)return Response.json({error:'Open deletion from the studio.'},{status:403});
  return locked('local-deletion:'+match[1],async()=>{
   const current=await worker.fetch(new Request(new URL('/api/recordings/'+match[1]+'?includeDeleted=true',url),{headers:{cookie:request.headers.get('cookie')}}),env);const data=await current.json();if(!current.ok&&!(match[2]==='damaged'&&current.status===409&&data.corrupted))return Response.json(data,{status:current.status});if(match[2]==='purge'&&!data.deletedAt)return Response.json({error:'Move the walkthrough to trash before permanently removing it.'},{status:400});
   try{await sharing.revokeForRecord(match[1]);if(match[2]){await jobs.purgeForRecord(request,match[1]);await sharing.purgeForRecord(match[1]);}}
   catch{return Response.json({error:'Deletion could not finish its privacy cleanup. Your recording was kept. Reconnect and retry to revoke online links and stop processing.'},{status:503})}
   return worker.fetch(request,env);
  });
 };
}
