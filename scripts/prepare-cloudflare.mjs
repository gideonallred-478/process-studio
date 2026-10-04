import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const destination=path.resolve('release/cloudflare-sharing');
const argument=process.argv.find(value=>value.startsWith('--backend='))?.slice(10);
let backend='REPLACE_WITH_WORKER_HTTPS_ORIGIN';
if(argument){const url=new URL(argument);if(url.protocol!=='https:'||!url.hostname.endsWith('.workers.dev')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use the exact HTTPS workers.dev backend origin.');backend=url.origin;}
const config=JSON.parse(await fs.readFile('wrangler.jsonc','utf8'));config.main='index.js';config.vars.MEDIA_ORIGIN=backend;config.vars.UPLOADS_PAUSED='true';
await fs.mkdir(destination,{recursive:true});
// Wrangler creates its own scratch folder beside the configuration. It is not
// part of the uploadable source package; never follow a substituted symlink.
const scratch=path.resolve(destination,'.wrangler');
if(path.dirname(scratch)!==destination)throw Error('Unexpected Wrangler scratch path.');
const scratchEntry=await fs.lstat(scratch).catch(error=>{if(error.code==='ENOENT')return null;throw error});
if(scratchEntry?.isSymbolicLink())throw Error('Wrangler scratch must not be a symlink.');
if(scratchEntry)await fs.rm(scratch,{recursive:true,force:true});
await fs.copyFile('dist/cloudflare/index.js',path.join(destination,'index.js'));
await fs.writeFile(path.join(destination,'wrangler.jsonc'),JSON.stringify(config,null,2));
await fs.copyFile('HOSTED_SHARING.md',path.join(destination,'README.md'));
const allowed=['index.js','wrangler.jsonc','README.md','PAYLOAD.json'];
for(const entry of await fs.readdir(destination,{withFileTypes:true}))if(!allowed.includes(entry.name)||!entry.isFile())throw Error('Unexpected Cloudflare payload entry: '+entry.name);
const files=[];for(const file of allowed.filter(file=>file!=='PAYLOAD.json')){const bytes=await fs.readFile(path.join(destination,file));if(/(?:sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)/.test(bytes.toString()))throw Error('Potential credential in '+file);files.push({file,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
await fs.writeFile(path.join(destination,'PAYLOAD.json'),JSON.stringify({sourceOnly:true,recordingsIncluded:false,credentialsIncluded:false,uploadsPaused:true,backendConfigured:Boolean(argument),files},null,2));
console.log('Prepared Cloudflare source-only payload: '+destination);
