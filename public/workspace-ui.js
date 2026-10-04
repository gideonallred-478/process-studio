import {initNavigation} from '/navigation.js';
initNavigation();
const search = document.getElementById('librarySearch');
function filterLibrary() {
  const query = (search?.value || '').trim().toLocaleLowerCase();
  let visible = 0;
  for (const card of document.querySelectorAll('.recent-item')) {
    const match = (card.dataset.search || card.textContent).toLocaleLowerCase().includes(query);
    card.classList.toggle('hidden', !match);
    if (match) visible++;
  }
  const empty = document.getElementById('libraryEmpty');
  if (empty) {
    empty.classList.toggle('hidden', visible > 0);
    empty.textContent = query ? 'No walkthroughs match your search.' : 'Your walkthroughs will appear here. Record or upload your first one above.';
  }
}
search?.addEventListener('input', filterLibrary);
document.getElementById('recentRecordings') && new MutationObserver(filterLibrary).observe(document.getElementById('recentRecordings'), {childList:true});
const tabs = [...document.querySelectorAll('.result-tabs a')];
if (tabs.length) {
  const updateTabs = () => {
    const active = tabs.find(link => link.hash === location.hash) || tabs[0];
    document.body.dataset.resultSection=active.hash.slice(1);
    for (const link of tabs) {
      link.classList.toggle('active', link === active);
      if (link === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  for(const link of tabs)link.addEventListener('click',event=>{event.preventDefault();history.pushState({},'',link.hash);updateTabs();window.scrollTo({top:0,behavior:'instant'})});
  window.addEventListener('popstate',updateTabs);
  window.addEventListener('hashchange', updateTabs);
  updateTabs();
}
