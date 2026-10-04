// Apply the saved appearance before the page paints, including result pages.
(() => {
  const key='process-studio-theme',valid=value=>['light','dark','system'].includes(value)?value:'system';
  const system=window.matchMedia('(prefers-color-scheme: dark)');
  let choice='system';try{choice=valid(localStorage.getItem(key));}catch{}
  function apply(){
    const resolved=choice==='system'?(system.matches?'dark':'light'):choice;
    document.documentElement.dataset.theme=resolved;
    // Each palette is drawn by Studio; prevent browser auto-darkening it twice.
    document.documentElement.style.colorScheme='only '+resolved;
    window.dispatchEvent(new CustomEvent('studio-theme-changed',{detail:{choice,resolved}}));
  }
  window.studioTheme={get:()=>choice,set(value){choice=valid(value);try{localStorage.setItem(key,choice);}catch{}apply();}};
  system.addEventListener('change',()=>{if(choice==='system')apply();});
  window.addEventListener('storage',event=>{if(event.key===key){choice=valid(event.newValue);apply();}});
  apply();
})();
