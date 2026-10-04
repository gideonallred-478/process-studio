import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
test('the distributable includes its own engine and an installer with pinned downloads',async()=>{
 const root=await fs.stat('local-engine/server.js').catch(()=>null)?path.resolve('.'):path.resolve('release/process-studio-0.2');
 for(const file of ['Install-Studio.ps1','scripts/install-support.ps1','local-engine/server.js','local-engine/local-runtime.js','local-engine/local-analysis.js','local-engine/decision-policy.js','local-engine/local-transcribe.ps1','local-engine/artifacts.json'])assert.ok(await fs.stat(path.join(root,file)).catch(()=>null),'Missing packaged '+file);
 const plan=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'Install-Studio.ps1'),'-Plan'],{encoding:'utf8',windowsHide:true});
 assert.equal(plan.status,0,plan.stderr);const artifacts=JSON.parse(plan.stdout);
 assert.ok(artifacts.some(item=>item.name.includes('win-cpu-x64')));assert.ok(artifacts.some(item=>item.name.endsWith('.gguf')));
 assert.ok(artifacts.every(item=>/^[a-f0-9]{64}$/.test(item.sha256)&&item.source.startsWith('https://')));
 const chatPlan=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'Install-Studio.ps1'),'-Plan','-Mode','ChatGPT'],{encoding:'utf8',windowsHide:true});
 assert.equal(chatPlan.status,0,chatPlan.stderr);assert.ok(!JSON.parse(chatPlan.stdout).some(item=>item.name.endsWith('.gguf')));
});
test('installer refuses a corrupted cached artifact and preserves the previous file',async()=>{
 const root=await fs.mkdtemp(path.resolve('tests/fixtures/install-'));
 const support=path.resolve('scripts/install-support.ps1');
 try{
  await fs.mkdir(path.join(root,'cache'));await fs.writeFile(path.join(root,'cache','model.bin'),'corrupt');await fs.writeFile(path.join(root,'model.bin'),'previous');
  const sha=createHash('sha256').update('verified').digest('hex');
  const script=`$ErrorActionPreference='Stop'\n. '${support.replaceAll("'","''")}'\n$a=@{name='model.bin';source='https://huggingface.co/test/model.bin';sha256='${sha}'}\ntry { Receive-StudioArtifact -Artifact $a -Target (Join-Path $PSScriptRoot 'model.bin') -ArtifactCache (Join-Path $PSScriptRoot 'cache') -Offline; exit 3 } catch { if($_.Exception.Message -notmatch 'Checksum mismatch'){throw}; Write-Output 'Expected checksum refusal' }`;
  await fs.writeFile(path.join(root,'check.ps1'),script);
  const failed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'check.ps1')],{encoding:'utf8',windowsHide:true});
  assert.equal(failed.status,0,failed.stderr);assert.equal(await fs.readFile(path.join(root,'model.bin'),'utf8'),'previous');assert.equal(await fs.stat(path.join(root,'model.bin.partial')).catch(()=>null),null);
  await fs.writeFile(path.join(root,'cache','model.bin'),'verified');
  await fs.writeFile(path.join(root,'check.ps1'),script.slice(0,script.indexOf('try {'))+"Receive-StudioArtifact -Artifact $a -Target (Join-Path $PSScriptRoot 'model.bin') -ArtifactCache (Join-Path $PSScriptRoot 'cache') -Offline\n");
  const passed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'check.ps1')],{encoding:'utf8',windowsHide:true});
  assert.equal(passed.status,0,passed.stderr);assert.equal(await fs.readFile(path.join(root,'model.bin'),'utf8'),'verified');
 }finally{assert.ok(root.startsWith(path.resolve('tests/fixtures')+path.sep));await fs.rm(root,{recursive:true,force:true});}
});
test('archive extraction works on Windows PowerShell and rejects a path outside its target',async()=>{
 const root=await fs.mkdtemp(path.resolve('tests/fixtures/archive-'));
 try{
  const script=`$ErrorActionPreference='Stop'\n. '${path.resolve('scripts/install-support.ps1').replaceAll("'","''")}'\nAdd-Type -AssemblyName System.IO.Compression\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n$zip=[IO.Compression.ZipFile]::Open((Join-Path $PSScriptRoot 'valid.zip'),[IO.Compression.ZipArchiveMode]::Create)\n$entry=$zip.CreateEntry('nested/runtime.txt');$writer=New-Object IO.StreamWriter($entry.Open());$writer.Write('verified runtime');$writer.Dispose();$zip.Dispose()\nExpand-StudioArchive -Path (Join-Path $PSScriptRoot 'valid.zip') -Destination (Join-Path $PSScriptRoot 'extracted')\n$zip=[IO.Compression.ZipFile]::Open((Join-Path $PSScriptRoot 'invalid.zip'),[IO.Compression.ZipArchiveMode]::Create);$zip.CreateEntry('../outside.txt') | Out-Null;$zip.Dispose()\ntry { Expand-StudioArchive -Path (Join-Path $PSScriptRoot 'invalid.zip') -Destination (Join-Path $PSScriptRoot 'extracted');exit 3 } catch { if($_.Exception.Message -notmatch 'leaves the runtime'){throw} }`;
  await fs.writeFile(path.join(root,'check.ps1'),script);
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'check.ps1')],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(await fs.readFile(path.join(root,'extracted/nested/runtime.txt'),'utf8'),'verified runtime');assert.equal(await fs.stat(path.join(root,'outside.txt')).catch(()=>null),null);
 }finally{assert.ok(root.startsWith(path.resolve('tests/fixtures')+path.sep));await fs.rm(root,{recursive:true,force:true});}
});

