// Product page: the radar sweeps once, slows and locks onto a single piece.
// Catalogue data (loaded per piece), theme, concept bag and header menu come from shared.js.
(async () => {
 const buildStart=performance.now();
 const main=document.querySelector('#piece');
 const motion=matchMedia('(prefers-reduced-motion: reduce)');
 const pad=(n,size=2)=>String(n).padStart(size,'0');
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 // Loads this piece in full and its collection's summaries; null if there is no such piece.
 let p;
 try{p=await radarData.piece(new URLSearchParams(location.search).get('id')||'');}
 catch(error){console.error(error);document.title='Signal interrupted — RADAR STUDIO';showLoadError(main,'this piece');return;}
 radarPerf&&radarPerf.record('product data',performance.now()-buildStart);

 if(!p){
  document.title='Signal lost — RADAR STUDIO';
  main.innerHTML='<section class="signal-lost"><span class="mono muted">No signal / 404</span><h1>Signal lost</h1><p>There is no piece at this coordinate.</p><a class="mono" href="index.html#collections">← Back to collections</a></section>';
  return;
 }

 const collection=collectionData[p.collection];
 // Positions give the curated order but may have gaps (a piece removed), so the rank in the sorted list is the index.
 const siblings=products.filter(x=>x.collection===p.collection).sort((a,b)=>a.position-b.position);
 const count=siblings.length,index=siblings.indexOf(p),rank=s=>siblings.indexOf(s)+1;
 const prev=siblings[(index-1+count)%count],next=siblings[(index+1)%count];
 // Bearing is the piece's place around its collection orbit; the ring matches the homepage locator.
 const bearing=bearingOf(p),ring=pad(p.collection+1);
 // No hash: the homepage positions itself on the piece without a competing anchor jump.
 const backUrl='index.html?piece='+p.id+'&collection='+collection.id;
 // Arriving from the catalogue keeps that context: links carry it on and the crumb returns to the same view and filters.
 const fromCatalogue=new URLSearchParams(location.search).get('from')==='catalogue';
 const link=s=>productUrl(s)+(fromCatalogue?'&from=catalogue':'');
 const catalogueUrl=(() => {let saved='';try{saved=sessionStorage.getItem('radar-catalogue')||'';}catch(e){}const q=new URLSearchParams(saved);q.set('piece',p.id);return 'catalogue.html?'+q;})();
 const sizes=[['XS',96],['S',102],['M',108],['L',114],['XL',120]];
 const ringSvg=(d,steps)=>{const r=d/2-.5;return '<svg viewBox="0 0 '+d+' '+d+'" aria-hidden="true"><circle cx="'+d/2+'" cy="'+d/2+'" r="'+r+'" pathLength="'+(steps||Math.round(2*Math.PI*r/3))+'"/></svg>';};

 document.title=p.name+' — RADAR STUDIO';
 const crumb=document.querySelector('.crumb');
 if(fromCatalogue){crumb.href=catalogueUrl;crumb.textContent='← Catalogue';}
 else{crumb.href=backUrl;crumb.innerHTML='← <span class="crumb-trail">Collections / </span>'+esc(collection.title);}

 const price=reduced(p)?'<del>'+money(p.original)+'</del><span>'+money(p.price)+'</span>'+(collection.id==='end-of-season'?'<span class="muted">End of season</span>':''):'<span>'+money(p.price)+'</span>';
 const readout=[
  ['Colour',p.dark?'Washed black':'Chalk'],
  ['Shape','Relaxed · heavy cotton'],
  ['Artwork',p.title],
  ['Discipline',p.discipline],
  ['Category',p.category],
  ['Bearing',bearingLabel(p)+'° / Ring '+ring],
  ['Source','Supplied reference']
 ];
 // Large collections show a window of the orbit: this piece and five either side, wrapping around.
 const ORBIT_WINDOW=5,windowed=count>ORBIT_WINDOW*2+1;
 const orbitPieces=windowed?Array.from({length:ORBIT_WINDOW*2+1},(_,k)=>siblings[(index+k-ORBIT_WINDOW+count)%count]):siblings;
 const arc=(() => {
  // Pieces sit along a shallow arc, echoing the collection orbit on the homepage.
  const slots=orbitPieces.length;
  const point=i=>{const a=(slots<2?0:(i/(slots-1)-.5))*50*Math.PI/180;return [150+300*Math.sin(a),330-300*Math.cos(a)];};
  const [x0,y0]=point(-.35),[x1,y1]=point(slots-1+.35);
  const ends=windowed?(() => {const [ax,ay]=point(-.9),[bx,by]=point(slots-1+.9);return '<text class="arc-more" x="'+ax.toFixed(1)+'" y="'+(ay+3).toFixed(1)+'" aria-hidden="true">···</text><text class="arc-more" x="'+bx.toFixed(1)+'" y="'+(by+3).toFixed(1)+'" aria-hidden="true">···</text>';})():'';
  return '<svg class="orbit-arc" viewBox="0 0 300 70" role="list"><path class="arc-path" d="M'+x0.toFixed(1)+' '+y0.toFixed(1)+' A300 300 0 0 1 '+x1.toFixed(1)+' '+y1.toFixed(1)+'" pathLength="90"/>'+ends+orbitPieces.map((s,i)=>{
   const [x,y]=point(i),current=s===p;
   return '<a role="listitem" href="'+link(s)+'" aria-label="'+pad(rank(s))+' '+esc(s.name)+'"'+(current?' aria-current="page" class="current"':'')+'><circle class="hit" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="11"/>'+(current?'<circle class="halo" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="9" pathLength="24"/>':'')+'<circle class="dot" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(current?4:2.6)+'"/></a>';
  }).join('')+'</svg>';
 })();

 // "More on this orbit": the twelve nearest pieces around this one (six after, six before), in orbit order.
 const MORE_LIMIT=12,nearby=count-1<=MORE_LIMIT?siblings.filter(s=>s!==p):[...Array.from({length:MORE_LIMIT/2},(_,k)=>siblings[(index-MORE_LIMIT/2+k+count)%count]),...Array.from({length:MORE_LIMIT/2},(_,k)=>siblings[(index+1+k)%count])];
 // Media shown on the stage, in order. Without a list in the data, a piece shows its garment front and back.
 const media=p.media&&p.media.length?p.media:[{type:'garment',side:'front',label:'Front'},{type:'garment',side:'back',label:'Back'}];
 // Thumbnails from build_images.py: path with / as --, then -<width>.<ext>.
 const mediaThumb=(src,width,ext)=>'assets/thumbs/'+src.replace(/\.[a-z0-9]+$/i,'').replace(/\//g,'--')+'-'+width+'.'+ext;
 const mediaSet=(src,ext)=>mediaThumb(src,640,ext)+' 640w, '+mediaThumb(src,1280,ext)+' 1280w';
 const MEDIA_SIZES='(max-width: 900px) 90vw, 55vw';
 const peekSrc=m=>m.type==='image'?m.src:m.type==='video'?m.poster:'';
 main.innerHTML=
  '<div class="piece-hero">'+
  '<section class="piece-stage" aria-label="'+esc(p.name)+', garment view">'+
   '<canvas class="lock-field" aria-hidden="true"></canvas>'+
   '<div class="lock-readout mono" aria-hidden="true"><span class="lock-state">Scanning 000%</span><span>BRG '+bearingLabel(p)+'° / R'+ring+'</span><span>'+pad(index+1)+' / '+pad(count)+'</span><span class="media-state"></span></div>'+
   '<div class="garment-space piece-garment">'+
    '<div class="tee-view"><div class="concept-tee '+(p.dark?'dark':'')+'">'+art({...p,title:'Artwork: '+p.title},{className:'tee-art',eager:true,sizes:'(max-width: 900px) 40vw, 300px'})+'<img class="neck-mark" src="assets/radar-logo-updated.png" alt=""></div></div>'+
   '</div>'+
   '<div class="media-frame" hidden></div>'+
   '<button class="media-pause mono" hidden>Pause loop ‖</button>'+
   '<div class="loupe '+(p.dark?'dark-tee':'chalk')+'" hidden aria-hidden="true">'+ringSvg(200,140)+'<span class="loupe-cross">+</span><span class="loupe-coords mono"></span></div>'+
   '<div class="view-controls mono">'+
    '<div class="media-strip" role="radiogroup" aria-label="Views of '+esc(p.name)+'">'+media.map((m,i)=>'<button role="radio" aria-checked="false" tabindex="-1" data-media="'+i+'"><span class="media-no">'+pad(i+1)+'</span>'+esc(m.label)+(m.type==='video'?' ▶':'')+(peekSrc(m)?'<span class="media-peek" aria-hidden="true"><img src="'+esc(mediaThumb(peekSrc(m),160,'jpg'))+'" alt="" loading="lazy"></span>':'')+'</button>').join('')+'</div>'+
    '<p class="visually-hidden" aria-live="polite" id="media-status"></p>'+
    '<button class="loupe-toggle" aria-pressed="false">Art detail +</button>'+
   '</div>'+
  '</section>'+
  '<section class="piece-info" aria-labelledby="piece-title">'+
   '<p class="piece-kicker mono muted">'+ring+' / '+esc(collection.title)+' · '+pad(index+1)+' of '+pad(count)+'</p>'+
   '<h1 id="piece-title">'+esc(p.name)+'</h1>'+
   '<p class="piece-price mono">'+price+'</p>'+
   '<div class="size-field">'+
    '<div class="size-head mono"><span id="size-label">Size</span><span class="size-value">Choose a ring</span></div>'+
    '<div class="size-rings" role="radiogroup" aria-labelledby="size-label">'+sizes.map(([size,chest],i)=>{
     const d=40+i*36;
     return '<button class="size-ring" role="radio" aria-checked="false" tabindex="'+(i===2?0:-1)+'" data-size="'+esc(size)+'" data-chest="'+chest+'" aria-label="'+esc(size)+', '+chest+' centimetre chest" style="--d:'+d+'px;--layer:'+(10-i)+'">'+ringSvg(d)+'<span class="size-label">'+esc(size)+'</span></button>';
    }).join('')+'<span class="center-dot" aria-hidden="true">+</span></div>'+
    '<p class="size-note mono muted">Relaxed shape · chest readings are illustrative</p>'+
   '</div>'+
   '<div class="piece-add-row"><button class="piece-add" disabled><span>Select a size</span><span aria-hidden="true">↗</span></button></div>'+
   '<p class="visually-hidden" aria-live="polite" id="bag-status"></p>'+
   '<dl class="readout">'+readout.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>'+
   '<div class="signal-notes"><h2 class="mono muted">Signal notes</h2><p>'+esc(p.description)+'</p><p class="mono muted">'+esc(p.status)+'<br>Illustrative garment / sample price</p></div>'+
  '</section></div>'+
  '<nav class="orbit-nav" aria-label="Pieces in '+esc(collection.title)+'">'+
   '<a class="orbit-step prev" href="'+link(prev)+'"><span class="mono muted">← '+pad(rank(prev))+'</span><span>'+esc(prev.name)+'</span></a>'+arc+
   '<a class="orbit-step next" href="'+link(next)+'"><span class="mono muted">'+pad(rank(next))+' →</span><span>'+esc(next.name)+'</span></a>'+
  '</nav>'+
  '<section class="more-orbit" aria-labelledby="more-title"><div class="more-head"><h2 id="more-title" class="mono">More on this orbit</h2>'+(nearby.length<count-1?'<a class="mono" href="catalogue.html?collection='+collection.id+'">View all '+count+' in the catalogue ↗</a>':'<a class="mono" href="'+backUrl+'">View all '+esc(collection.title)+' ↗</a>')+'</div>'+
   '<div class="more-rail" tabindex="0" role="region" aria-label="More from '+esc(collection.title)+'">'+nearby.map(productCard).join('')+'</div></section>';

 if(fromCatalogue)main.querySelectorAll('.more-rail .product-card').forEach(card=>{card.href=link(productById(card.dataset.product));});
 const stage=main.querySelector('.piece-stage'),garment=stage.querySelector('.piece-garment'),teeView=stage.querySelector('.tee-view'),tee=stage.querySelector('.concept-tee');

 // ---------- Lock-on radar ----------
 const canvas=stage.querySelector('.lock-field'),ctx=canvas.getContext('2d');
 const base=document.createElement('canvas'),baseCtx=base.getContext('2d'),stateLabel=stage.querySelector('.lock-state');
 const tau=Math.PI*2,cellW=7,cellH=10,sweepWidth=1.7,lockAngle=-Math.PI/2+bearing*Math.PI/180;
 const ease=x=>1-Math.pow(1-x,3);
 let width=0,height=0,cells=[],cx=0,cy=0,reticle=0,start=performance.now(),frame=0,lastPaint=0,visible=true,lastLabel='';
 function resize(){
  const rect=stage.getBoundingClientRect(),tv=teeView.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);
  width=rect.width;height=rect.height;
  canvas.width=base.width=Math.round(width*dpr);canvas.height=base.height=Math.round(height*dpr);
  for(const c of [ctx,baseCtx]){c.setTransform(dpr,0,0,dpr,0,0);c.font='11px monospace';c.textAlign='center';c.textBaseline='middle';}
  cx=tv.left+tv.width/2-rect.left;cy=tv.top+tv.height/2-rect.top;
  reticle=Math.max(tv.width,tv.height)*.6;
  const rx=tv.width*.6,ry=tv.height*.6;
  cells=[];
  for(let col=-Math.ceil(cx/cellW);col<=Math.ceil((width-cx)/cellW);col++)for(let row=-Math.ceil(cy/cellH);row<=Math.ceil((height-cy)/cellH);row++){
   const x=cx+col*cellW,y=cy+row*cellH,vertical=col%16===0,horizontal=row%10===0;
   // Marks fade softly under the garment, as on the collection arcs.
   const edge=clamp((Math.hypot((x-cx)/rx,(y-cy)/ry)-.5)/.7,0,1);
   cells.push({x,y,theta:Math.atan2(y-cy,x-cx),glyph:vertical&&horizontal?'+':vertical?'|':horizontal?'-':'',axis:col===0||row===0,quiet:.08+.92*edge*edge*(3-2*edge),echo:0});
  }
  paintBase();lastPaint=0;paint(performance.now());
 }
 function ringDots(c,r,spacing){const steps=Math.max(12,Math.round(tau*r/spacing));for(let i=0;i<steps;i++){const a=i/steps*tau;c.fillText('.',cx+Math.cos(a)*r,cy+Math.sin(a)*r);}}
 function paintBase(){
  baseCtx.clearRect(0,0,width,height);
  for(const cell of cells)if(cell.glyph){baseCtx.fillStyle=tones[Math.round((cell.axis?34:17)*cell.quiet)];baseCtx.fillText(cell.glyph,cell.x,cell.y);}
  baseCtx.fillStyle=tones[30];ringDots(baseCtx,reticle*1.55,7);
  baseCtx.fillStyle=tones[22];ringDots(baseCtx,reticle*2.2,7);
 }
 function paint(now){
  if(!width||(!motion.matches&&now-lastPaint<33))return;
  const dt=Math.min((now-lastPaint)/1000,.05);lastPaint=now;
  const t=motion.matches?99:(now-start)/1000,scan=clamp(t/1.6,0,1);
  // Two and a quarter turns that decelerate onto the bearing, then a slow, dim idle sweep.
  const angle=t<1.6?lockAngle+tau*2.25*(1-ease(scan)):lockAngle-(t-1.6)*.3;
  const intensity=motion.matches?0:t<1.6?1:Math.max(.3,1-(t-1.6)*.7);
  const lock=ease(clamp((t-1.1)/.9,0,1)),decay=Math.exp(-dt/.85);
  ctx.clearRect(0,0,width,height);
  ctx.drawImage(base,0,0,base.width,base.height,0,0,width,height);
  for(const cell of cells){
   const lag=((cell.theta-angle)%tau+tau)%tau;
   const strength=lag<sweepWidth?Math.pow(1-lag/sweepWidth,1.55)*intensity:0;
   cell.echo=Math.max(cell.echo*decay,strength>0?.05+strength*.12:0);
   const b=Math.max(strength,cell.echo);if(b<.01)continue;
   const shade=Math.round((13+b*77)*cell.quiet);if(shade<3)continue;
   ctx.fillStyle=tones[shade];ctx.fillText(cell.glyph||(b>.72?'#':b>.43?'+':b>.19?':':'.'),cell.x,cell.y);
  }
  // The reticle closes in from a wide ring onto the garment.
  const r=reticle*(1+1.6*(1-lock));
  ctx.fillStyle=tones[Math.round(30+48*lock)];ringDots(ctx,r,7);
  for(let k=0;k<4;k++){
   const a=k*tau/4;
   for(let j=0;j<3;j++){ctx.fillStyle=tones[Math.round((70-j*18)*lock)];ctx.fillText(k%2?'|':'-',cx+Math.cos(a)*(r+9+j*9),cy+Math.sin(a)*(r+9+j*9));}
  }
  if(lock>0){
   // The lock beam marks the piece's bearing.
   ctx.fillStyle=tones[Math.round(46*lock)];
   for(let d=r+40;d<Math.hypot(width,height);d+=9){const x=cx+Math.cos(lockAngle)*d,y=cy+Math.sin(lockAngle)*d;if(x<0||y<0||x>width||y>height)break;ctx.fillText(':',x,y);}
  }
  const label=t<1.6?'Scanning '+pad(Math.round(scan*100),3)+'%':t<2?'Locking':'Signal locked / '+pad(index+1);
  if(label!==lastLabel){stateLabel.textContent=label;lastLabel=label;stage.classList.toggle('locked',t>=2);}
 }
 function tick(now){frame=0;if(!visible||document.hidden||motion.matches)return;paint(now);frame=requestAnimationFrame(tick);}
 function sync(){if(frame)cancelAnimationFrame(frame);frame=0;if(visible&&!document.hidden&&!motion.matches)frame=requestAnimationFrame(tick);else{lastPaint=0;paint(performance.now());}}
 new ResizeObserver(resize).observe(stage);
 new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();}).observe(stage);
 document.addEventListener('visibilitychange',sync);
 motion.addEventListener('change',()=>{cells.forEach(cell=>{cell.echo=0;});sync();});
 document.addEventListener('radar:theme',()=>{paintBase();lastPaint=0;paint(performance.now());});
 tee.querySelector('.tee-art').addEventListener('load',resize);

 // ---------- Size rings: a radio group drawn as concentric radar rings ----------
 const ringButtons=[...main.querySelectorAll('.size-ring')],sizeValue=main.querySelector('.size-value'),add=main.querySelector('.piece-add'),status=main.querySelector('#bag-status');
 let chosen='',addedTimer=0;
 function choose(button,focus){
  chosen=button.dataset.size;
  ringButtons.forEach(b=>{const on=b===button;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1;});
  if(focus)button.focus();
  sizeValue.textContent=chosen+' / '+button.dataset.chest+' cm chest';
  add.disabled=false;clearTimeout(addedTimer);
  add.innerHTML='<span>Add to bag / '+chosen+'</span><span aria-hidden="true">↗</span>';
 }
 ringButtons.forEach((button,i)=>{
  button.addEventListener('click',()=>choose(button,false));
  button.addEventListener('keydown',event=>{
   const step={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1}[event.key];
   const target=step?ringButtons[clamp(i+step,0,ringButtons.length-1)]:event.key==='Home'?ringButtons[0]:event.key==='End'?ringButtons[ringButtons.length-1]:null;
   if(target){event.preventDefault();choose(target,true);}
  });
 });
 add.addEventListener('click',()=>{
  if(!chosen)return;
  bag.add(p,chosen);
  status.textContent=p.name+', size '+chosen+', added to the concept bag.';
  add.innerHTML='<span>Added / '+chosen+'</span><span aria-hidden="true">✓</span>';
  document.querySelectorAll('.bag-open').forEach(b=>{b.classList.remove('pinged');void b.offsetWidth;b.classList.add('pinged');});
  clearTimeout(addedTimer);
  addedTimer=setTimeout(()=>{add.innerHTML='<span>Add another / '+chosen+'</span><span aria-hidden="true">↗</span>';},1600);
 });
 document.querySelectorAll('.bag-open').forEach(b=>b.addEventListener('animationend',()=>b.classList.remove('pinged')));

 // ---------- Media: garment views, photos and video, with a radar-wipe between them ----------
 const strip=[...stage.querySelectorAll('[data-media]')],mediaFrame=stage.querySelector('.media-frame'),pauseButton=stage.querySelector('.media-pause');
 const loupeToggle=stage.querySelector('.loupe-toggle'),mediaState=stage.querySelector('.media-state'),mediaStatus=main.querySelector('#media-status');
 const mediaEls=new Map(),preloaded=new Set();
 let current=-1,surface=teeView,userPaused=false;
 function mediaElement(i){
  // Built on first view and kept, so a video keeps its place when you come back to it.
  if(mediaEls.has(i))return mediaEls.get(i);
  const m=media[i],tpl=document.createElement('template');
  if(m.type==='image')tpl.innerHTML='<picture><source type="image/avif" srcset="'+esc(mediaSet(m.src,'avif'))+'" sizes="'+MEDIA_SIZES+'"><img class="media-image" src="'+esc(mediaThumb(m.src,640,'jpg'))+'" srcset="'+esc(mediaSet(m.src,'jpg'))+'" sizes="'+MEDIA_SIZES+'" alt="'+esc(m.alt)+'" decoding="async"></picture>';
  else{
   const loop=m.mode==='loop';
   // preload="none": nothing but the poster loads until the video is shown.
   tpl.innerHTML='<video class="media-video" playsinline preload="none" poster="'+esc(mediaThumb(m.poster,1280,'jpg'))+'" aria-label="'+esc(m.alt)+'"'+(loop?' muted loop':' controls')+'><source src="assets/'+esc(m.src)+'" type="video/mp4">'+(m.captions?'<track kind="captions" src="assets/'+esc(m.captions)+'" srclang="en" label="English" default>':'')+'</video>';
  }
  const el=tpl.content.firstElementChild;mediaEls.set(i,el);return el;
 }
 const activeVideo=()=>media[current]&&media[current].type==='video'?mediaEls.get(current):null;
 function playLoop(){const v=activeVideo();if(v&&media[current].mode==='loop'&&!userPaused&&!motion.matches&&!document.hidden&&stageVisible)v.play().catch(()=>{});syncPause();}
 function syncPause(){
  const m=media[current],v=activeVideo();
  pauseButton.hidden=!(m&&m.type==='video'&&m.mode==='loop');
  if(v)pauseButton.textContent=v.paused?'Play loop ▶':'Pause loop ‖';
 }
 function showMedia(i,{focus=false,announce=false}={}){
  if(i===current)return;
  const m=media[i];
  const old=activeVideo();if(old)old.pause();
  current=i;userPaused=false;
  strip.forEach((b,k)=>{b.setAttribute('aria-checked',String(k===i));b.tabIndex=k===i?0:-1;});
  if(focus)strip[i].focus();
  if(loupeOn)setLoupe(false);
  if(m.type==='garment'){
   garment.classList.remove('media-hidden');mediaFrame.hidden=true;tee.classList.toggle('back',m.side==='back');surface=teeView;
  }else{
   // The garment stays laid out (invisibly) so the radar keeps its centre.
   garment.classList.add('media-hidden');mediaFrame.hidden=false;mediaFrame.replaceChildren(mediaElement(i));surface=mediaFrame;
  }
  loupeToggle.disabled=!(m.type==='image'||(m.type==='garment'&&m.side==='front'));
  const label=pad(i+1)+' / '+pad(media.length)+' · '+m.label;
  mediaState.textContent='Media '+label;
  if(announce)mediaStatus.textContent=m.label+', '+(i+1)+' of '+media.length;
  if(!motion.matches&&stage.dataset.ready){surface.classList.remove('wipe');void surface.offsetWidth;surface.classList.add('wipe');}
  playLoop();
  preloadNext(i);
 }
 // Fetch the next item's image (or poster) ahead of time, so moving on feels instant.
 function preloadNext(i){
  const k=(i+1)%media.length,m=media[k],src=peekSrc(m);
  if(!src||preloaded.has(k))return;preloaded.add(k);
  const link=document.createElement('link');link.rel='preload';link.as='image';
  if(m.type==='image'){link.setAttribute('imagesrcset',mediaSet(src,'avif'));link.setAttribute('imagesizes',MEDIA_SIZES);link.type='image/avif';}
  else link.href=mediaThumb(src,1280,'jpg');
  document.head.append(link);
 }
 strip.forEach((button,i)=>{
  button.addEventListener('click',()=>showMedia(i,{announce:true}));
  button.addEventListener('keydown',event=>{
   const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];
   const target=step?(current+step+media.length)%media.length:event.key==='Home'?0:event.key==='End'?media.length-1:null;
   if(target===null)return;
   event.preventDefault();showMedia(target,{focus:true,announce:true});
  });
 });
 for(const el of [teeView,mediaFrame])el.addEventListener('animationend',()=>el.classList.remove('wipe'));
 pauseButton.addEventListener('click',()=>{const v=activeVideo();if(!v)return;if(v.paused){userPaused=false;v.play().catch(()=>{});}else{userPaused=true;v.pause();}syncPause();});
 mediaFrame.addEventListener('play',syncPause,true);mediaFrame.addEventListener('pause',syncPause,true);
 // Video pauses when the stage scrolls away or the tab is hidden; a loop resumes when it comes back.
 let stageVisible=true;
 new IntersectionObserver(([entry])=>{stageVisible=entry.isIntersecting;const v=activeVideo();if(!stageVisible&&v)v.pause();else playLoop();}).observe(stage);
 document.addEventListener('visibilitychange',()=>{const v=activeVideo();if(document.hidden&&v)v.pause();else playLoop();});
 motion.addEventListener('change',()=>{const v=activeVideo();if(motion.matches&&v&&media[current].mode==='loop')v.pause();else playLoop();});

 // ---------- Art detail lens (garment front and photos) ----------
 const loupe=stage.querySelector('.loupe'),coords=loupe.querySelector('.loupe-coords'),artImg=tee.querySelector('.tee-art');
 let loupeOn=false,lens={x:.5,y:.5};
 const lensImage=()=>media[current].type==='image'?mediaEls.get(current).querySelector('img'):artImg;
 function artRect(){
  // Images are contained in their box, so measure the drawn image rather than the element.
  const img=lensImage(),b=img.getBoundingClientRect(),nw=img.naturalWidth||1,nh=img.naturalHeight||1,s=Math.min(b.width/nw,b.height/nh),w=nw*s,h=nh*s;
  return {left:b.left+(b.width-w)/2,top:b.top+(b.height-h)/2,width:w,height:h};
 }
 function placeLoupe(){
  const a=artRect(),g=stage.getBoundingClientRect(),zoom=media[current].type==='image'?2.4:3.2,size=loupe.offsetWidth;
  loupe.style.left=(a.left+lens.x*a.width-g.left)+'px';loupe.style.top=(a.top+lens.y*a.height-g.top)+'px';
  loupe.style.backgroundSize=(a.width*zoom)+'px '+(a.height*zoom)+'px';
  loupe.style.backgroundPosition=(size/2-lens.x*a.width*zoom)+'px '+(size/2-lens.y*a.height*zoom)+'px';
  coords.textContent='X '+pad(Math.round(lens.x*100),3)+' / Y '+pad(Math.round(lens.y*100),3);
 }
 function setLoupe(on){
  const target=surface===mediaFrame?mediaFrame:garment,photo=media[current].type==='image';
  loupeOn=on;loupe.hidden=!on;
  for(const el of [garment,mediaFrame]){el.classList.remove('inspecting');el.removeAttribute('tabindex');el.removeAttribute('aria-label');}
  loupeToggle.setAttribute('aria-pressed',String(on));loupeToggle.textContent=on?'Art detail −':'Art detail +';
  if(!on)return;
  // Full resolution is fetched only when the lens opens: the original artwork, or a photo's 1280px version.
  loupe.classList.toggle('photo',photo);
  loupe.style.backgroundImage='url('+(photo?mediaThumb(media[current].src,1280,'jpg'):'assets/'+p.image)+')';
  lens={x:.5,y:.5};target.classList.add('inspecting');target.tabIndex=0;target.setAttribute('aria-label','Art detail lens. Use the arrow keys to move it, Escape to close.');placeLoupe();
 }
 loupeToggle.addEventListener('click',()=>setLoupe(!loupeOn));
 function follow(event){
  if(!loupeOn||(event.pointerType!=='mouse'&&!event.buttons&&event.type==='pointermove'))return;
  const a=artRect();lens={x:clamp((event.clientX-a.left)/a.width,0,1),y:clamp((event.clientY-a.top)/a.height,0,1)};placeLoupe();
 }
 for(const el of [garment,mediaFrame]){el.addEventListener('pointermove',follow);el.addEventListener('pointerdown',follow);el.addEventListener('keydown',nudge);}
 function nudge(event){
  if(!loupeOn)return;
  if(event.key==='Escape'){setLoupe(false);loupeToggle.focus();return;}
  const move={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if(!move)return;
  event.preventDefault();event.stopPropagation();
  lens={x:clamp(lens.x+move[0]*.05,0,1),y:clamp(lens.y+move[1]*.05,0,1)};placeLoupe();
 }
 loupeToggle.addEventListener('keydown',nudge);
 addEventListener('resize',()=>{if(loupeOn)placeLoupe();});
 showMedia(0);stage.dataset.ready='1';

 // ---------- Moving along the orbit: arrow keys and swipes ----------
 document.addEventListener('keydown',event=>{
  if(document.activeElement!==document.body||event.altKey||event.metaKey||event.ctrlKey)return;
  if(event.key==='ArrowLeft')location.href=link(prev);
  if(event.key==='ArrowRight')location.href=link(next);
 });
 let swipe=null;
 stage.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'&&!loupeOn&&!event.target.closest('video,button'))swipe={x:event.clientX,y:event.clientY};},{passive:true});
 stage.addEventListener('pointerup',event=>{
  if(!swipe)return;const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;swipe=null;
  if(Math.abs(dx)>70&&Math.abs(dy)<50&&media.length>1)showMedia((current+(dx<0?1:-1)+media.length)%media.length,{announce:true});
 });
 stage.addEventListener('pointercancel',()=>{swipe=null;});
 radarPerf&&radarPerf.record('product build',performance.now()-buildStart);
})();
