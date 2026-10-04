import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
const root=path.resolve('.');
// Distinct page URLs share the application shell so navigation can retain a live recording.
for(const file of ['library.html','settings.html','recording.html','editor.html'])await fs.copyFile('public/index.html','public/'+file);
const assets={};const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.wav':'audio/wav'};
for(const entry of await fs.readdir('public',{withFileTypes:true})){if(!entry.isFile())continue;const bytes=await fs.readFile(path.join('public',entry.name));const binary=entry.name.endsWith('.wav');assets['/'+entry.name]={type:types[path.extname(entry.name)]||'application/octet-stream',body:bytes.toString(binary?'base64':'utf8').replace(/^\uFEFF/,''),binary};}
for(const file of ['shared.js','decision-policy.js','local-analysis.js'])assets['/'+file]={type:types['.js'],body:(await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''),binary:false};
await fs.writeFile('worker/assets.generated.js','export const assets = '+JSON.stringify(assets)+';\n');
await fs.mkdir('dist/server',{recursive:true});await fs.mkdir('dist/.openai',{recursive:true});
await build({absWorkingDir:root,tsconfigRaw:{},entryPoints:[path.join(root,'worker','index.js')],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await fs.mkdir('dist/cloudflare',{recursive:true});
await build({absWorkingDir:root,tsconfigRaw:{},entryPoints:[path.join(root,'worker','hosted.js')],outfile:'dist/cloudflare/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built hosted app without desktop model, speech, or Node runtime dependencies.');
