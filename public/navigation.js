const routes={studio:'/',library:'/library.html',source:'/recording.html',editor:'/editor.html',settings:'/settings.html'};
const names={studio:'Studio',library:'My library',source:'Review recording',editor:'Process editor',settings:'Settings'};
const panels={studio:'studioPanel',library:'libraryPanel',source:'sourcePanel',editor:'editorPanel',settings:'settingsPanel'};
let ready=false;
export function currentPage(){return Object.keys(routes).find(key=>routes[key]===location.pathname)||'studio'}
export function navigate(page,{replace=false,section}={}){
 if(!routes[page])page='studio';
 const url=new URL(location.href);url.pathname=routes[page];url.hash='';url.searchParams.delete('view');
 if(section)url.searchParams.set('section',section);
 else if(page!=='editor')url.searchParams.delete('section');
 if(url.href!==location.href)history[replace?'replaceState':'pushState']({},'',url);
 renderPage(page);
}
function renderPage(page=currentPage()){
 for(const [key,id] of Object.entries(panels))document.getElementById(id)?.classList.toggle('hidden',key!==page);
 for(const element of document.querySelectorAll('button[data-page],a[data-page]')){
  const active=element.dataset.page===page;element.classList.toggle('active',active);
  if(active)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current');
 }
 const heading=document.getElementById('currentView');if(heading)heading.textContent=names[page];
 document.title=names[page]+' · Process Studio';
 document.body.dataset.page=page;
 renderEditorSection();
 window.dispatchEvent(new CustomEvent('studio-page-changed',{detail:{page}}));
 window.scrollTo({top:0,behavior:'instant'});
}
function renderEditorSection(){
 const selected=new URL(location.href).searchParams.get('section');
 const section=['procedure','actions','automation'].includes(selected)?selected:'procedure';
 document.body.dataset.editorSection=section;
 for(const pane of document.querySelectorAll('[data-editor-pane]'))pane.classList.toggle('hidden',pane.dataset.editorPane!==section);
 for(const button of document.querySelectorAll('[data-editor-section]')){
  const active=button.dataset.editorSection===section;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));
 }
}
export function syncAvailablePages(){
 for(const [view,id] of [['source','session'],['editor','results']]){
  const available=!document.getElementById(id)?.classList.contains('hidden');
  for(const button of document.querySelectorAll(`button[data-page="${view}"]`))button.disabled=!available;
  document.getElementById(view+'Empty')?.classList.toggle('hidden',available);
 }
 const editorAvailable=!document.getElementById('results')?.classList.contains('hidden');
 const sourceToEditor=document.getElementById('sourceToEditor');if(sourceToEditor)sourceToEditor.disabled=!editorAvailable;
}
export function initNavigation(){
 if(!document.getElementById('studioPanel'))return;
 ready=document.body.dataset.studioReady==='true';
 for(const button of document.querySelectorAll('button[data-page],a[data-page]'))button.addEventListener('click',event=>{event.preventDefault();if(!button.disabled)navigate(button.dataset.page)});
 for(const button of document.querySelectorAll('[data-editor-section]'))button.addEventListener('click',()=>navigate('editor',{replace:true,section:button.dataset.editorSection}));
 document.getElementById('sourceToEditor')?.addEventListener('click',()=>navigate('editor'));
 window.addEventListener('popstate',()=>renderPage());
 window.addEventListener('studio-session-opened',()=>{syncAvailablePages();if(ready)navigate('source')});
 window.addEventListener('studio-result-ready',()=>{syncAvailablePages();if(ready&&currentPage()!=='editor')navigate('editor')});
 window.addEventListener('studio-ready',()=>{ready=true;syncAvailablePages();renderPage()});
 for(const id of ['session','results'])new MutationObserver(syncAvailablePages).observe(document.getElementById(id),{attributes:true,attributeFilter:['class']});
 syncAvailablePages();renderPage();
}
