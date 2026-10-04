import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const destination = path.resolve('release/vercel-logged-out');
const backendArgument=process.argv.find(value=>value.startsWith('--backend='))?.slice(10);
let mediaOrigin='';if(backendArgument){const backend=new URL(backendArgument);if(backend.protocol!=='https:'||!backend.hostname.endsWith('.workers.dev')||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw Error('Use the exact HTTPS workers.dev backend origin.');mediaOrigin=backend.origin;}
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'"+(mediaOrigin?' '+mediaOrigin:'')+"; media-src 'self' blob:"+(mediaOrigin?' '+mediaOrigin:'')+"; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'";
await fs.mkdir(path.join(destination,'api'),{recursive:true});
await fs.mkdir(path.join(destination,'lib'),{recursive:true});
await fs.unlink(path.join(destination,'api','studio-worker.mjs')).catch(error=>{if(error.code!=='ENOENT')throw error});
await fs.mkdir(path.join(destination,'public'),{recursive:true});
await fs.writeFile(path.join(destination,'public','robots.txt'),'User-agent: *\nDisallow: /\n');
// Explicit allowlist: do not walk or copy the workspace, public local data,
// desktop auth files, environment files, research, or preview recordings.
const files = [
  ['dist/server/index.js','lib/studio-worker.mjs'],
  ['scripts/vercel-handler.mjs','api/index.mjs'],
  ['scripts/hosted-relay.mjs','lib/hosted-relay.mjs'],
  ['release/process-studio-local-sharing-2026-10-03.zip','public/local-release.zip'],
  ['public/index.html','public/index.html']
];
for (const [source, target] of files) await fs.copyFile(source,path.join(destination,target));
const home = path.join(destination,'public','index.html');
await fs.writeFile(home,(await fs.readFile(home,'utf8')).replace('<body>','<body><aside role="status" style="padding:10px 18px;background:#eaf2ff;color:#1746a2;font:13px system-ui;text-align:center">Record and process locally, share online. ChatGPT is signed out here. <a href="/local.html">Get the local edition</a>.</aside>'));
await fs.writeFile(path.join(destination,'package.json'), JSON.stringify({name:'process-studio-logged-out',private:true,type:'module',engines:{node:'22.x'}},null,2));
await fs.writeFile(path.join(destination,'vercel.json'), JSON.stringify({version:2,framework:null,buildCommand:'',outputDirectory:'public',functions:{'api/index.mjs':{includeFiles:'lib/**'}},headers:[{source:'/',headers:[{key:'Cache-Control',value:'no-store'},{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'Content-Security-Policy',value:csp}]}],rewrites:[{source:'/',destination:'/index.html'},{source:'/:path*',destination:'/api/index'}]},null,2));
await fs.writeFile(path.join(destination,'.vercelignore'), '*\n!api\n!api/index.mjs\n!lib\n!lib/studio-worker.mjs\n!lib/hosted-relay.mjs\n!public\n!public/robots.txt\n!public/index.html\n!public/local-release.zip\n!package.json\n!vercel.json\n');
const expected = ['api/index.mjs','lib/studio-worker.mjs','lib/hosted-relay.mjs','public/local-release.zip','public/robots.txt','public/index.html','package.json','vercel.json','.vercelignore','PAYLOAD.json','README.md'];
async function inventory(folder) {
  const result=[];
  for (const item of await fs.readdir(folder,{withFileTypes:true})) {
    if(folder===destination&&['.vercel','.gitignore'].includes(item.name))continue;
    if (item.isSymbolicLink()) throw Error('Deployment payload must not contain symlinks.');
    const file=path.join(folder,item.name);
    if(item.isDirectory())result.push(...await inventory(file));else result.push(path.relative(destination,file).replaceAll('\\','/'));
  }
  return result;
}
for (const file of await inventory(destination)) if(!expected.includes(file)) throw Error('Unexpected deployment file: '+file);
const manifest=[];
for (const file of expected.filter(file=>!['PAYLOAD.json','README.md'].includes(file))) {
  const bytes=await fs.readFile(path.join(destination,file));
  if (/(?:sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.|credentials\.dpapi)/.test(bytes.toString())) throw Error('Potential credential in deployment payload: '+file);
  manifest.push({file,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
await fs.writeFile(path.join(destination,'PAYLOAD.json'),JSON.stringify({chatgpt:'logged-out',accounts:0,aiCredentialsIncluded:false,recordingsIncluded:false,files:manifest},null,2));
await fs.writeFile(path.join(destination,'README.md'),'# Prepared Vercel sharing release\n\nDeploy only this allowlisted directory. ChatGPT is logged out and hosted inference/sign-in routes are disabled. No author account, recordings or AI keys are included. The public local-release.zip contains source and an installer, with no local credentials or model weights.\n\nStorage activates only after the private Cloudflare backend is provisioned and STUDIO_BACKEND_URL / STUDIO_RELAY_SECRET are configured privately on Vercel. Prepare this stage with --backend=<exact workers.dev origin> to authorize direct media transport in its CSP. Without those settings, the API returns a clear setup error. AI processing stays local. See HOSTED_SHARING.md in the source release for provisioning and activation gates.\n');
console.log('Prepared verified source-only Vercel release: '+destination);
