import {build} from 'esbuild';import path from 'node:path';
await build({entryPoints:['public/app.js','public/result.js','public/workspace-ui.js'],bundle:true,write:false,outdir:'unused',platform:'browser',format:'esm',tsconfigRaw:{},plugins:[{name:'studio-browser-paths',setup(build){build.onResolve({filter:/^\//},({path:file})=>({path:path.resolve(['shared.js','decision-policy.js'].includes(file.slice(1))?file.slice(1):'public'+file)}))}}]});
console.log('Browser module imports are valid.');
