// Catalogue: every piece in three views. Grid and index list them; the field plots each piece on one radar
// at the coordinate its product page reports (ring = collection, bearing = place on that orbit).
// Catalogue data, theme, concept bag and header menu come from shared.js.
(async () => {
 const buildStart=performance.now();
 const main=document.querySelector('#catalogue');
 // Every piece's summary (no long text): data/index.json.
 try{await radarData.all();}catch(error){console.error(error);showLoadError(main,'the catalogue');return;}
 radarPerf&&radarPerf.record('catalogue data',performance.now()-buildStart);
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 const pad=(n,size=2)=>String(n).padStart(size,'0');
 const slug=s=>s.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const coord=p=>'R'+pad(p.collection+1)+' / '+bearingLabel(p)+'°';
 const linkFor=p=>productUrl(p)+'&from=catalogue';
 const priceHtml=p=>(reduced(p)?'<del>'+money(p.original)+'</del>':'')+money(p.price);
 const colourOf=p=>p.dark?'Washed black':'Chalk';

 // ---------- State: filters, sort, search and view, mirrored in the URL ----------
 const groups={
  collection:{label:'Collection',options:[['all','All'],...collectionData.map(c=>[c.id,c.title])]},
  colour:{label:'Colour',options:[['all','All'],['chalk','Chalk'],['black','Washed black']]},
  artwork:{label:'Artwork',options:[['all','All'],...[...new Set(products.map(p=>p.category))].map(c=>[slug(c),c])]}
 };
 const sorts=[['orbit','Orbit'],['price-up','Price ↑'],['price-down','Price ↓'],['name','Name']];
 const views=['field','grid','index'];
 const defaults={view:'grid',collection:'all',colour:'all',artwork:'all',sort:'orbit',q:'',ring:''};
 const state={...defaults},params=new URLSearchParams(location.search);
 for(const key of Object.keys(groups))if(groups[key].options.some(([v])=>v===params.get(key)))state[key]=params.get(key);
 if(views.includes(params.get('view')))state.view=params.get('view');
 if(sorts.some(([v])=>v===params.get('sort')))state.sort=params.get('sort');
 state.q=(params.get('q')||'').trim().slice(0,60);
 if(collectionData.some(c=>c.id===params.get('ring')))state.ring=params.get('ring');
 const returning=productById(params.get('piece')||'');

 const haystack=new Map(products.map(p=>[p,fold([p.name,p.title,p.discipline,p.category,collectionData[p.collection].title,colourOf(p)].join(' '))]));
 const matches=p=>(state.collection==='all'||collectionData[p.collection].id===state.collection)
  &&(state.colour==='all'||(state.colour==='black')===p.dark)
  &&(state.artwork==='all'||slug(p.category)===state.artwork)
  &&fold(state.q).split(/\s+/).filter(Boolean).every(word=>haystack.get(p).includes(word));
 // Orbit order: ring by ring, then clockwise by stored bearing.
 const orbit=(a,b)=>a.collection-b.collection||a.bearing-b.bearing||a.position-b.position;
 const order={orbit,'price-up':(a,b)=>a.price-b.price||orbit(a,b),'price-down':(a,b)=>b.price-a.price||orbit(a,b),name:(a,b)=>a.name.localeCompare(b.name)};

 // ---------- Markup ----------
 // Ring radii as a fraction of the field's half-width; R01 is innermost, as on the homepage locator.
 const ringRadius=k=>(k+1.4)/4.4*.8;
 const at=(fraction,degrees)=>{const a=degrees*Math.PI/180;return 'left:'+(50+50*fraction*Math.sin(a)).toFixed(3)+'%;top:'+(50-50*fraction*Math.cos(a)).toFixed(3)+'%';};
 const chip=(group,value,label)=>'<button class="chip" data-group="'+group+'" data-value="'+value+'" aria-pressed="false">'+esc(label)+'</button>';
 document.querySelector('.catalogue-kicker').textContent=products.length+' pieces / '+collectionData.length+' collections';
 main.insertAdjacentHTML('beforeend',
  '<div class="filters" id="filters">'+Object.entries(groups).map(([key,g])=>'<div class="filter-row" role="group" aria-labelledby="filter-'+key+'"><span class="filter-label" id="filter-'+key+'">'+esc(g.label)+'</span>'+g.options.map(([v,l])=>chip(key,v,l)).join('')+'</div>').join('')+'</div>'+
  '<div class="toolbar">'+
   '<button class="filter-toggle" aria-expanded="false" aria-controls="filters">Filter +</button>'+
   '<div class="sort-row" role="group" aria-labelledby="sort-label"><span class="filter-label" id="sort-label">Sort</span>'+sorts.map(([v,l])=>chip('sort',v,l)).join('')+'</div>'+
   '<label class="search"><span class="visually-hidden">Search the catalogue</span><input type="search" placeholder="Search" autocomplete="off" spellcheck="false" maxlength="60"><kbd aria-hidden="true">/</kbd></label>'+
   '<p class="result-count" aria-hidden="true"></p><p class="visually-hidden" aria-live="polite" id="result-status"></p>'+
   '<button class="clear-filters" hidden>Clear ×</button>'+
   '<div class="view-switch" role="group" aria-label="View">'+views.map(v=>chip('view',v,v)).join('<span aria-hidden="true">/</span>')+'</div>'+
  '</div>'+
  '<section class="catalogue-grid" aria-label="Catalogue grid"></section>'+
  '<section class="catalogue-index" aria-label="Catalogue index"><div class="index-head" aria-hidden="true"><span>No.</span><span>Piece</span><span>Collection</span><span>Colour</span><span>Artwork</span><span>Coordinate</span><span>Price</span></div><ol class="index-list"></ol><div class="index-sweep" aria-hidden="true"></div></section>'+
  '<div class="load-more-row" hidden><span class="shown-count"></span><button class="load-more">Show more ↓</button></div>'+
  '<section class="field-view" aria-label="Catalogue field"><div class="field-side"><div class="field-head"><span class="field-mode"></span><button class="zoom-out" hidden>← All rings</button></div><p class="field-pick" hidden></p><div class="field-stage"><canvas class="field-canvas" aria-hidden="true"></canvas>'+
   collectionData.map((c,k)=>'<button class="ring-label" data-ring="'+esc(k)+'" style="'+at(ringRadius(k),22.5)+'">'+pad(k+1)+'</button>').join('')+'<div class="blip-layer"></div>'+
   '<span class="field-centre" aria-hidden="true">+</span></div>'+
   '<p class="field-legend">'+collectionData.map((c,k)=>'<span>'+pad(k+1)+' '+esc(c.title)+'</span>').join('')+'<span><i class="key"></i>Chalk</span><span><i class="key washed"></i>Washed black</span><span class="step-hint">← → to step · Esc to zoom out</span></p></div>'+
   '<aside class="contact" aria-label="Contact"></aside></section>'+
  '<div class="empty-state" hidden><span class="mono muted">No signal</span><p>Nothing in range for these filters.</p><button class="clear-filters">Clear filters ×</button></div>'
 );
 const grid=main.querySelector('.catalogue-grid'),indexSection=main.querySelector('.catalogue-index'),indexList=main.querySelector('.index-list'),fieldView=main.querySelector('.field-view');
 const stage=main.querySelector('.field-stage'),contact=main.querySelector('.contact'),toolbar=main.querySelector('.toolbar'),filtersEl=main.querySelector('#filters');
 const search=toolbar.querySelector('input'),count=toolbar.querySelector('.result-count'),status=toolbar.querySelector('#result-status'),filterToggle=toolbar.querySelector('.filter-toggle'),empty=main.querySelector('.empty-state');
 // Cards, rows and blips are created on first use and cached, so a view costs nothing until it is shown.
 const tpl=document.createElement('template'),cards=new Map(),rows=new Map(),blips=new Map();
 function cardFor(p){
  let el=cards.get(p);
  if(!el){tpl.innerHTML=productCard(p);el=tpl.content.firstElementChild;el.href=linkFor(p);el.querySelector('.signal-tag').textContent=coord(p);cards.set(p,el);}
  return el;
 }
 function rowFor(p){
  let el=rows.get(p);
  if(!el){tpl.innerHTML='<li data-product="'+p.id+'"><a class="index-row" href="'+linkFor(p)+'" aria-label="'+esc(p.name)+', number '+p.id+', '+esc(collectionData[p.collection].title)+', '+colourOf(p)+', '+esc(p.category)+', '+coord(p).replace('°',' degrees')+', '+money(p.price)+'"><span class="index-no">'+p.id+'</span><span class="index-name">'+esc(p.name)+'</span><span>'+esc(collectionData[p.collection].title)+'</span><span>'+colourOf(p)+'</span><span>'+esc(p.category)+'</span><span class="index-coord">'+coord(p)+'</span><span class="index-price">'+priceHtml(p)+'</span></a></li>';el=tpl.content.firstElementChild;rows.set(p,el);}
  return el;
 }
 const blipHtml=p=>'<a class="blip'+(p.dark?' washed':'')+'" href="'+linkFor(p)+'" data-product="'+p.id+'" style="'+at(ringRadius(p.collection),bearingOf(p))+'" aria-label="'+esc(p.name)+', '+esc(collectionData[p.collection].title)+', '+colourOf(p)+', '+coord(p).replace('°',' degrees')+', '+money(p.price)+'"></a>';
 const sections={grid,index:indexSection,field:fieldView};

 // ---------- Applying state ----------
 // Grid and Index render in batches; more load as the "Show more" row nears the viewport.
 const batchSize=()=>state.view==='index'?120:48;
 const moreRow=main.querySelector('.load-more-row'),moreButton=moreRow.querySelector('.load-more');
 let visible=new Set(products),currentList=products,limit=48,statusTimer=0,urlTimer=0;
 function writeUrl(){
  const q=new URLSearchParams();
  for(const key of Object.keys(defaults))if(state[key]!==defaults[key])q.set(key,state[key]);
  const search=q.toString();
  history.replaceState(null,'',location.pathname+(search?'?'+search:''));
  // The product page reads this to send "← Catalogue" back to the same view and filters.
  try{sessionStorage.setItem('radar-catalogue',search);}catch(e){}
 }
 // Render the active list view from `from` up to the current limit (from 0 replaces the list).
 function renderList(from){
  const isGrid=state.view==='grid',container=isGrid?grid:indexList;
  const els=currentList.slice(from,limit).map(isGrid?cardFor:rowFor);
  els.forEach(el=>el.classList.remove('arriving'));
  if(from)container.append(...els);else container.replaceChildren(...els);
  updateMoreRow();
  return els;
 }
 function updateMoreRow(){
  const shown=Math.min(limit,currentList.length);
  moreRow.hidden=state.view==='field'||shown>=currentList.length;
  moreRow.querySelector('.shown-count').textContent='Showing '+shown+' of '+currentList.length;
 }
 // Fade in only the first items of a batch, with a single layout for the whole batch (not one per element).
 function animateIn(els){
  if(motion.matches||!els.length)return;
  const few=els.slice(0,24);
  void main.offsetWidth;
  few.forEach((el,i)=>{el.style.animationDelay=Math.min(i,14)*22+'ms';el.classList.add('arriving');});
 }
 main.addEventListener('animationend',event=>{if(event.target.classList.contains('arriving')&&!event.target.closest('.contact'))event.target.classList.remove('arriving');});
 function apply({animate=false,typing=false,keepLimit=false}={}){
  const applyStart=performance.now();
  currentList=products.filter(matches).sort(order[state.sort]);
  const list=currentList;
  visible=new Set(list);
  if(!keepLimit)limit=batchSize();
  if(state.view==='field')renderField();
  else{const els=renderList(0);if(animate)animateIn(els);}
  updateMoreRow();
  main.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed',String(state[c.dataset.group]===c.dataset.value)));
  for(const [view,el] of Object.entries(sections))el.hidden=state.view!==view||(view!=='field'&&!list.length);
  empty.hidden=!!list.length||state.view==='field';
  toolbar.querySelector('.sort-row').hidden=state.view==='field';
  const active=['collection','colour','artwork'].filter(k=>state[k]!=='all').length+(state.q?1:0);
  toolbar.querySelector('.clear-filters').hidden=!active;
  filterToggle.textContent='Filter '+(filtersEl.classList.contains('open')?'−':'+')+(active?' ('+active+')':'');
  const text=list.length?pad(list.length)+' of '+products.length+' in range':'No signal';
  count.textContent=text;
  clearTimeout(statusTimer);statusTimer=setTimeout(()=>{status.textContent=list.length?list.length+' of '+products.length+' pieces in range':'No pieces match these filters';},typing?600:50);
  if(state.view==='field'){if(fieldMode==='summary')showOverview();else if(!contactPiece||!shown.includes(contactPiece))showContact(shown[0]||null,'tracking');}
  clearTimeout(urlTimer);urlTimer=setTimeout(writeUrl,typing?300:0);
  syncField();
  radarPerf&&radarPerf.record('catalogue apply',performance.now()-applyStart);
 }
 function loadMore(focusFirst){
  if(state.view==='field'||limit>=currentList.length)return;
  const from=limit;limit+=batchSize();
  const els=renderList(from);animateIn(els);
  // Keyboard users continue from the first new item rather than back at the button.
  if(focusFirst&&els[0])(els[0].matches('a')?els[0]:els[0].querySelector('a')).focus({preventScroll:true});
 }
 moreButton.addEventListener('click',()=>loadMore(true));
 new IntersectionObserver(entries=>{
  if(!entries.some(e=>e.isIntersecting))return;
  loadMore(false);
  // A tall screen may still show the row after one batch; keep going until it is out of reach.
  requestAnimationFrame(()=>{if(!moreRow.hidden&&moreRow.getBoundingClientRect().top<innerHeight+600)loadMore(false);});
 },{rootMargin:'0px 0px 600px 0px'}).observe(moreRow);
 main.addEventListener('click',event=>{
  const c=event.target.closest('.chip');
  if(c){const group=c.dataset.group,value=c.dataset.value;if(state[group]===value)return;state[group]=value;apply({animate:true});return;}
  if(event.target.closest('.clear-filters')){Object.assign(state,{collection:'all',colour:'all',artwork:'all',q:''});search.value='';apply({animate:true});}
 });
 search.value=state.q;
 search.addEventListener('input',()=>{state.q=search.value.trim();apply({typing:true});});
 document.addEventListener('keydown',event=>{
  if(event.key!=='/'||event.metaKey||event.ctrlKey||event.altKey||event.target.closest('input,textarea,select,[contenteditable]'))return;
  event.preventDefault();search.focus();search.select();
 });
 filterToggle.addEventListener('click',()=>{
  const open=!filtersEl.classList.contains('open');
  filtersEl.classList.toggle('open',open);filterToggle.setAttribute('aria-expanded',String(open));apply();
  // The toolbar may be pinned far down the page; bring the opened panel into view beneath it.
  if(open){const top=filtersEl.getBoundingClientRect().top+scrollY-toolbar.offsetHeight-4;if(top<scrollY)scrollTo({top,behavior:motion.matches?'instant':'smooth'});}
 });

 // ---------- Index: a sweep line passes down the rows ----------
 const sweep=indexSection.querySelector('.index-sweep');
 new ResizeObserver(()=>{
  sweep.style.setProperty('--top',indexList.offsetTop+'px');sweep.style.setProperty('--h',indexList.offsetHeight+'px');
  sweep.style.animationDuration=Math.max(4,indexList.offsetHeight/220).toFixed(1)+'s';
 }).observe(indexList);

 // ---------- Field: levels of detail ----------
 // Detail: every piece in range is a blip on its collection ring (while each ring has room).
 // Summary: too many to plot; rings show density and counts, and you zoom into one.
 // Zoom: one collection fills the radar. Bearings are kept; pieces alternate across a few bands.
 // Only pieces in range get a link; filtered-out pieces are faint canvas dots, so the page stays light.
 const DETAIL_MAX=150,fieldHead=main.querySelector('.field-mode'),zoomOut=main.querySelector('.zoom-out'),blipLayer=stage.querySelector('.blip-layer');
 const ringButtons=[...stage.querySelectorAll('.ring-label')];
 let fieldMode='detail',zoomRing=-1,autoZoom=false,ringCounts=[],shown=[],roving=null;
 const ringCapacity=k=>Math.floor(Math.PI*2*ringRadius(k)*(half||300)/14);
 const bandCache=new Map();
 // Pieces are dealt to bands in bearing order by a smooth weighted round-robin, weighted by each band's
 // circumference, so outer bands take more pieces and spacing is even. Stable for a given collection.
 function bandOf(p){
  let entry=bandCache.get(p.collection);
  if(!entry){
   const ring=products.filter(q=>q.collection===p.collection).sort((a,b)=>a.bearing-b.bearing),bands=Math.min(6,Math.max(1,Math.ceil(ring.length/48)));
   const radii=Array.from({length:bands},(_,b)=>bands===1?.62:.3+.5*b/(bands-1)),total=radii.reduce((t,r)=>t+r,0),credit=radii.map(()=>0),index=new Map();
   for(const q of ring){radii.forEach((r,b)=>{credit[b]+=r;});const pick=credit.indexOf(Math.max(...credit));credit[pick]-=total;index.set(q,pick);}
   entry={bands,radii,index};bandCache.set(p.collection,entry);
  }
  return entry;
 }
 function radiusOf(p){
  if(fieldMode!=='zoom')return ringRadius(p.collection);
  const {radii,index}=bandOf(p);return radii[index.get(p)];
 }
 const pointOf=p=>{const a=bearingOf(p)*Math.PI/180,r=radiusOf(p);return [50+50*r*Math.sin(a),50-50*r*Math.cos(a)];};
 function layoutField(){
  ringCounts=collectionData.map(()=>0);for(const p of currentList)ringCounts[p.collection]++;
  let ring=collectionData.findIndex(c=>c.id===state.ring);
  // A ring with no pieces at all can't be zoomed into (e.g. an old ?ring= link).
  if(ring>=0&&!products.some(p=>p.collection===ring)){ring=-1;state.ring='';}
  const fits=currentList.length<=DETAIL_MAX&&ringCounts.every((n,k)=>n<=ringCapacity(k));
  autoZoom=false;
  // Too busy, but only one ring in range (e.g. a collection filter): open that ring directly.
  if(ring<0&&!fits){const busy=ringCounts.flatMap((n,k)=>n?[k]:[]);if(busy.length===1){ring=busy[0];autoZoom=true;}}
  zoomRing=ring;fieldMode=ring>=0?'zoom':fits?'detail':'summary';
 }
 function renderField(){
  layoutField();
  armed=null;pick.hidden=true;
  shown=fieldMode==='summary'?[]:currentList.filter(p=>fieldMode==='detail'||p.collection===zoomRing).sort(orbit);
  const els=shown.map(p=>{
   let el=blips.get(p);
   if(!el){tpl.innerHTML=blipHtml(p);el=tpl.content.firstElementChild;blips.set(p,el);}
   const [x,y]=pointOf(p);el.style.left=x.toFixed(3)+'%';el.style.top=y.toFixed(3)+'%';el.tabIndex=-1;el.classList.remove('active','ping');
   return el;
  });
  blipLayer.replaceChildren(...els);
  // One tab stop for the whole radar; arrow keys move between blips.
  roving=blips.get(shown.includes(contactPiece)?contactPiece:shown[0])||null;
  if(roving)roving.tabIndex=0;
  targets=shown.map(p=>{const a=-Math.PI/2+bearingOf(p)*Math.PI/180;return {p,el:blips.get(p),a,lag:((a-angle)%tau+tau)%tau};});
  stage.classList.toggle('summary',fieldMode==='summary');
  stage.classList.toggle('dense',shown.length>60);
  ringButtons.forEach((button,k)=>{
   const summary=fieldMode==='summary';
   button.hidden=fieldMode==='zoom';
   button.textContent=pad(k+1)+(summary?' · '+ringCounts[k]:'');
   button.disabled=summary&&!ringCounts[k];
   button.tabIndex=summary?0:-1;
   if(summary){button.removeAttribute('aria-hidden');button.setAttribute('aria-label','Zoom into '+esc(collectionData[k].title)+', '+ringCounts[k]+' in range');}
   else{button.setAttribute('aria-hidden','true');button.removeAttribute('aria-label');}
  });
  const total=currentList.length.toLocaleString('en-IN');
  fieldHead.innerHTML=fieldMode==='zoom'?'<b>Ring '+pad(zoomRing+1)+' · '+esc(collectionData[zoomRing].title)+'</b> · '+ringCounts[zoomRing]+' in range'+(autoZoom?' · only ring in range':'')
   :fieldMode==='summary'?'<b>All rings</b> · '+total+' in range · too many to plot one by one':'<b>All rings</b> · '+shown.length+' plotted';
  zoomOut.hidden=fieldMode!=='zoom'||autoZoom;
  if(size){paintBase();lastPaint=0;paintField(performance.now());}
 }
 function zoomTo(k,focus){
  const from=zoomRing;
  state.ring=k>=0?collectionData[k].id:'';apply();
  if(!focus)return;
  // Zooming in lands on the radar's blip; zooming out returns to the ring you came from.
  const target=k>=0?roving:ringButtons[from]&&!ringButtons[from].hidden&&!ringButtons[from].disabled?ringButtons[from]:roving;
  target&&target.focus({preventScroll:true});
 }
 main.addEventListener('click',event=>{const b=event.target.closest('[data-ring]');if(b&&!b.disabled)zoomTo(Number(b.dataset.ring),true);});
 zoomOut.addEventListener('click',()=>zoomTo(-1,true));
 // In summary, clicking near a ring zooms into it.
 stage.addEventListener('click',event=>{
  if(fieldMode!=='summary'||event.target.closest('button,a'))return;
  const r=stage.getBoundingClientRect(),d=Math.hypot(event.clientX-r.left-half,event.clientY-r.top-half)/half;
  let k=-1,best=.09;collectionData.forEach((c,i)=>{const gap=Math.abs(ringRadius(i)-d);if(gap<best&&ringCounts[i]){best=gap;k=i;}});
  if(k>=0)zoomTo(k,false);
 });

 // ---------- Field: contact panel ----------
 let contactPiece=null,locked=false,unlockTimer=0,lastSwap=0;
 function showOverview(){
  contactPiece=null;contact.dataset.mode='overview';
  contact.innerHTML='<div class="contact-head"><span>Contact / <b>Overview</b></span><span>'+currentList.length.toLocaleString('en-IN')+' in range</span></div>'+
   '<div class="contact-body"><h2>Too many signals to plot one by one</h2><p class="contact-note">Zoom into a ring, or narrow the filters.</p><ul class="ring-list">'+
   collectionData.map((c,k)=>'<li><button data-ring="'+esc(k)+'"'+(ringCounts[k]?'':' disabled')+'><span>'+pad(k+1)+' '+esc(c.title)+'</span><span>'+ringCounts[k].toLocaleString('en-IN')+' ↗</span></button></li>').join('')+'</ul></div>';
 }
 function showContact(p,mode){
  if(p===contactPiece&&contact.dataset.mode===mode&&contact.childElementCount)return;
  contactPiece=p;contact.dataset.mode=mode;
  shown.forEach(q=>blips.get(q).classList.toggle('active',q===p));
  if(!p){contact.innerHTML='<div class="contact-head"><span>Contact / <b>None</b></span></div><div class="contact-body contact-empty"><h2>No signal</h2><p>Nothing in range for these filters.</p><button class="clear-filters">Clear filters ×</button></div>';return;}
  contact.innerHTML='<div class="contact-head"><span>Contact / <b>'+(mode==='selected'?'Selected':'Tracking')+'</b></span><span>'+coord(p)+'</span></div>'+
   '<div class="contact-body"><div class="garment-space contact-garment"><div class="concept-tee'+(p.dark?' dark':'')+'" data-morph>'+art(p,{eager:true,sizes:'200px'})+'</div></div>'+
   '<span class="contact-no">No. '+p.id+' · '+esc(collectionData[p.collection].title)+'</span><h2>'+esc(p.name)+'</h2><p class="contact-price">'+priceHtml(p)+'</p>'+
   '<dl class="contact-readout"><div><dt>Colour</dt><dd>'+colourOf(p)+'</dd></div><div><dt>Artwork</dt><dd>'+esc(p.title)+'</dd></div><div><dt>Discipline</dt><dd>'+esc(p.discipline)+'</dd></div></dl>'+
   '<a class="contact-open" href="'+linkFor(p)+'"><span>Open piece</span><span aria-hidden="true">↗</span></a></div>';
  if(!motion.matches)contact.querySelector('.contact-body').classList.add('arriving');
 }
 // Hover or focus selects a contact; it releases back to sweep tracking a moment after you leave.
 function select(p){clearTimeout(unlockTimer);locked=true;showContact(p,'selected');}
 function release(){clearTimeout(unlockTimer);unlockTimer=setTimeout(()=>{locked=false;},2500);}
 stage.addEventListener('pointerover',event=>{const b=event.target.closest('.blip');if(b)select(productById(b.dataset.product));});
 stage.addEventListener('pointerout',event=>{if(event.target.closest('.blip'))release();});
 stage.addEventListener('focusin',event=>{
  const b=event.target.closest('.blip');if(!b)return;
  if(roving&&roving!==b)roving.tabIndex=-1;
  roving=b;b.tabIndex=0;select(productById(b.dataset.product));
 });
 stage.addEventListener('focusout',release);
 contact.addEventListener('pointerenter',()=>{clearTimeout(unlockTimer);locked=true;});
 contact.addEventListener('pointerleave',release);
 contact.addEventListener('focusin',()=>{clearTimeout(unlockTimer);locked=true;});
 contact.addEventListener('focusout',release);
 stage.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&fieldMode==='zoom'&&!autoZoom){event.preventDefault();zoomTo(-1,true);return;}
  const b=event.target.closest('.blip');if(!b||!shown.length)return;
  const i=shown.indexOf(productById(b.dataset.product));
  const next={ArrowRight:i+1,ArrowDown:i+1,ArrowLeft:i-1,ArrowUp:i-1,Home:0,End:shown.length-1}[event.key];
  if(next===undefined)return;
  event.preventDefault();blips.get(shown[(next+shown.length)%shown.length]).focus();
 });
 // Touch screens: blips are close together, so the first tap selects (named just above the radar) and a
 // second tap on the same blip, or "Open", opens it.
 const coarse=matchMedia('(hover: none)'),pick=main.querySelector('.field-pick');
 let armed=null;
 stage.addEventListener('click',event=>{
  const b=event.target.closest('.blip');if(!b||!coarse.matches)return;
  const p=productById(b.dataset.product);
  if(armed===p)return;
  event.preventDefault();armed=p;select(p);
  pick.hidden=false;pick.innerHTML='Selected · <b>'+esc(p.name)+'</b> · '+coord(p)+' <a href="'+linkFor(p)+'">Open ↗</a>';
 });
 // Opening the contact (or its blip) morphs the panel's garment into the product stage.
 main.addEventListener('click',event=>{
  const target=event.target.closest('.contact-open,.blip'),tee=contact.querySelector('[data-morph]');
  if(target&&tee&&contactPiece&&target.getAttribute('href')===linkFor(contactPiece))tee.style.viewTransitionName='piece';
 });

 // ---------- Field: radar ----------
 const canvas=stage.querySelector('.field-canvas'),ctx=canvas.getContext('2d'),base=document.createElement('canvas'),baseCtx=base.getContext('2d');
 const tau=Math.PI*2,sweepWidth=1.4,speed=18*Math.PI/180;
 let targets=[],size=0,half=0,cells=[],angle=-Math.PI/2+.6,frame=0,lastPaint=0,inView=false;
 function resizeField(){
  const width=stage.clientWidth;if(!width||fieldView.hidden)return;
  const dpr=Math.min(devicePixelRatio||1,1.5),cw=width<520?6:7,ch=width<520?9:10,firstSize=!size;
  size=width;half=width/2;
  canvas.width=base.width=Math.round(size*dpr);canvas.height=base.height=Math.round(size*dpr);
  for(const c of [ctx,baseCtx]){c.setTransform(dpr,0,0,dpr,0,0);c.font='11px monospace';c.textAlign='center';c.textBaseline='middle';}
  const limit=half*.97;cells=[];
  for(let col=-Math.floor(limit/cw);col<=Math.floor(limit/cw);col++)for(let row=-Math.floor(limit/ch);row<=Math.floor(limit/ch);row++){
   const x=col*cw,y=row*ch;if(Math.hypot(x,y)>limit)continue;
   const vertical=col%16===0,horizontal=row%10===0;
   cells.push({x:half+x,y:half+y,theta:Math.atan2(y,x),glyph:vertical&&horizontal?'+':vertical?'|':horizontal?'-':'',axis:col===0||row===0,echo:0});
  }
  // Ring capacity depends on the radar's size, so the first real size can change the mode.
  if(firstSize&&state.view==='field')renderField();
  paintBase();lastPaint=0;paintField(performance.now());
 }
 function ringDots(c,r,spacing){const steps=Math.max(16,Math.round(tau*r/spacing));for(let i=0;i<steps;i++){const a=i/steps*tau;c.fillText('.',half+Math.cos(a)*r,half+Math.sin(a)*r);}}
 function paintBase(){
  baseCtx.clearRect(0,0,size,size);
  for(const cell of cells)if(cell.glyph){baseCtx.fillStyle=tones[cell.axis?34:17];baseCtx.fillText(cell.glyph,cell.x,cell.y);}
  if(fieldMode==='zoom'){
   const {radii}=bandOf(products.find(p=>p.collection===zoomRing));
   baseCtx.fillStyle=tones[40];
   for(const r of radii)ringDots(baseCtx,r*half,6);
  }else collectionData.forEach((c,k)=>{baseCtx.fillStyle=tones[fieldMode==='summary'&&!ringCounts[k]?22:46];ringDots(baseCtx,ringRadius(k)*half,6);});
  baseCtx.fillStyle=tones[26];ringDots(baseCtx,half*.97,6);
  // Pieces without a link: filtered-out ones as faint dots; in summary, everything in range as a density band.
  const plotted=new Set(shown),pool=fieldMode==='zoom'?products.filter(p=>p.collection===zoomRing):products;
  for(const p of pool){
   if(plotted.has(p))continue;
   const on=visible.has(p);if(fieldMode!=='summary'&&on)continue;
   baseCtx.fillStyle=tones[on?66:18];
   const [x,y]=pointOf(p);baseCtx.fillText(on?':':'.',x/100*size,y/100*size);
  }
  // Bearing scale: a mark every 10°, crosses every 30°, labels at the cardinals.
  for(let d=0;d<360;d+=10){const a=-Math.PI/2+d*Math.PI/180;baseCtx.fillStyle=tones[d%90?32:64];baseCtx.fillText(d%30?'.':'+',half+Math.cos(a)*half*.88,half+Math.sin(a)*half*.88);}
  baseCtx.font='9px monospace';baseCtx.fillStyle=tones[72];
  for(const d of [0,90,180,270]){const a=-Math.PI/2+d*Math.PI/180;baseCtx.fillText(pad(d,3),half+Math.cos(a)*half*.93,half+Math.sin(a)*half*.93);}
  baseCtx.font='11px monospace';
 }
 function paintField(now){
  if(!size||(!motion.matches&&now-lastPaint<33))return;
  const dt=Math.min((now-lastPaint)/1000,.05),paintStart=performance.now();lastPaint=now;
  ctx.clearRect(0,0,size,size);ctx.drawImage(base,0,0,base.width,base.height,0,0,size,size);
  if(motion.matches)return;
  // Counterclockwise, like the homepage radar. A blip pings as the leading edge crosses its bearing.
  angle=(angle-speed*dt)%tau;
  const decay=Math.exp(-dt/.9);
  for(const cell of cells){
   const lag=((cell.theta-angle)%tau+tau)%tau,strength=lag<sweepWidth?Math.pow(1-lag/sweepWidth,1.6):0;
   cell.echo=Math.max(cell.echo*decay,strength>0?.04+strength*.1:0);
   const b=Math.max(strength,cell.echo);if(b<.012)continue;
   ctx.fillStyle=tones[Math.round(12+b*70)];ctx.fillText(cell.glyph||(b>.72?'#':b>.43?'+':b>.19?':':'.'),cell.x,cell.y);
  }
  for(const t of targets){
   const lag=((t.a-angle)%tau+tau)%tau;
   if(lag<t.lag)ping(t,now);
   t.lag=lag;
  }
  radarPerf&&radarPerf.record('field paint',performance.now()-paintStart);
 }
 function ping(t,now){
  t.el.classList.remove('ping');void t.el.offsetWidth;t.el.classList.add('ping');
  // Without a selection, the contact panel tracks what the sweep finds, at a readable pace.
  if(!locked&&now-lastSwap>1700){showContact(t.p,'tracking');lastSwap=now;}
 }
 stage.addEventListener('animationend',event=>{if(event.target.classList.contains('blip'))event.target.classList.remove('ping');});
 const running=()=>state.view==='field'&&inView&&!document.hidden&&!motion.matches;
 function fieldTick(now){frame=0;if(!running())return;paintField(now);frame=requestAnimationFrame(fieldTick);}
 function syncField(){
  if(frame)cancelAnimationFrame(frame);frame=0;
  if(state.view!=='field')return;
  if(!size)resizeField();
  if(running())frame=requestAnimationFrame(fieldTick);else{lastPaint=0;paintField(performance.now());}
 }
 new ResizeObserver(resizeField).observe(stage);
 new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;syncField();}).observe(stage);
 document.addEventListener('visibilitychange',syncField);
 motion.addEventListener('change',syncField);
 document.addEventListener('radar:theme',()=>{if(size){paintBase();lastPaint=0;paintField(performance.now());}});

 // ---------- First render, and landing back on a piece from its product page ----------
 apply();
 if(returning&&visible.has(returning)&&state.view==='field'&&!shown.includes(returning)){state.ring=collectionData[returning.collection].id;apply();}
 if(returning&&visible.has(returning)&&(state.view!=='field'||shown.includes(returning))){
  // Make sure the returning piece's batch is rendered before scrolling to it.
  if(state.view!=='field'){const i=currentList.indexOf(returning);if(i>=limit){limit=Math.ceil((i+1)/batchSize())*batchSize();renderList(0);}}
  const target=state.view==='field'?blips.get(returning):state.view==='index'?rowFor(returning).querySelector('a'):cardFor(returning);
  // Select explicitly: focus events do not fire when the window itself is not focused yet.
 if(state.view==='field')select(returning);
 target.scrollIntoView({block:'center',behavior:'instant'});
  target.focus({preventScroll:true});
  target.classList.add('returned');
 }
 radarPerf&&radarPerf.record('catalogue build',performance.now()-buildStart);
})();
