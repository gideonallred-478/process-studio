import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/theme.js',import.meta.url),'utf8').catch(()=> '');
function setup({stored=null,dark=false,blocked=false}={}){
 const listeners={},system={matches:dark,addEventListener:(_,fn)=>listeners.system=fn},root={dataset:{},style:{}},values=new Map(stored?[['process-studio-theme',stored]]:[]);
 const window={matchMedia:()=>system,addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent(){}};
 vm.runInNewContext(source,{window,document:{documentElement:root},localStorage:{getItem:key=>{if(blocked)throw Error('Storage unavailable');return values.get(key)},setItem:(key,value)=>{if(blocked)throw Error('Storage unavailable');values.set(key,value)}},CustomEvent:class{}});
 return {root,theme:window.studioTheme,system,values,listeners};
}
test('System follows the device appearance and reacts to changes',()=>{
 const h=setup({dark:true});assert.ok(h.theme,'Theme controls must initialize');assert.equal(h.theme.get(),'system');assert.equal(h.root.dataset.theme,'dark');
 h.system.matches=false;h.listeners.system();assert.equal(h.root.dataset.theme,'light');
});
test('an explicit theme survives reload and ignores system appearance changes',()=>{
 const h=setup({dark:true});assert.ok(h.theme,'Theme controls must initialize');h.theme.set('light');assert.equal(h.values.get('process-studio-theme'),'light');
 h.listeners.system();assert.equal(h.root.dataset.theme,'light');assert.equal(setup({stored:h.values.get('process-studio-theme'),dark:true}).root.dataset.theme,'light');
 h.theme.set('dark');assert.equal(h.root.dataset.theme,'dark');assert.equal(h.root.style.colorScheme,'only dark');
});
test('invalid or unavailable storage falls back safely and theme changes synchronize between tabs',()=>{
 const h=setup({stored:'invalid',blocked:true});assert.ok(h.theme,'Theme controls must initialize');assert.equal(h.theme.get(),'system');h.theme.set('dark');assert.equal(h.root.dataset.theme,'dark');
 h.listeners.storage({key:'process-studio-theme',newValue:'light'});assert.equal(h.root.dataset.theme,'light');
 h.listeners.storage({key:'unrelated',newValue:'dark'});assert.equal(h.root.dataset.theme,'light');
});
