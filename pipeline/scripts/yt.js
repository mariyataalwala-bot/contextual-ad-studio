// YouTube capture helpers for the contextual-ad skill. Run with NODE_PATH=<skill>/node_modules.
//
//   node yt.js search  "<query>" [n]                    list results: title | channel | views·age | length | url
//   node yt.js meta    <videoId>                         title, channel, views, length, chapters, keywords, caption tracks
//   node yt.js scan    <videoId> <outdir> t1 t2 ...      one still per timestamp (fresh page per still; survives mid-roll ads)
//   node yt.js seq     <videoId> <outdir> <t0> <t1> [fps]   frame-accurate run of stills 001.jpg… (paused seeks)
//   node yt.js pages   <videoId> "<query>" <outdir> "<phrase1|phrase2>"
//                       → home.png, results.png, watch.png (1812x910, light theme) + pages.json (rects)
//   node yt.js audio   <videoId> <out.webm>              records the video's own audio track in real time
//   node yt.js rec     <videoId> <out.webm> <t0> <seconds>  records a short stretch in real time (fast; replaces seq)
//   node yt.js home    <outdir>                          home.png + home.json (search box rects) — cacheable
//
// Nothing is downloaded as a file: stills are screenshots of the player, audio is recorded from the player.
const {chromium}=require('playwright'); const fs=require('fs'); const path=require('path');
const HIDE='.ytp-chrome-bottom,.ytp-chrome-top,.ytp-gradient-bottom,.ytp-gradient-top,.ytp-ce-element,.ytp-paid-content-overlay,.ytp-caption-window-container,.ytp-pause-overlay,.ytp-spinner,.ytp-bezel,.ytp-tooltip,.ytp-overlays-container{display:none!important}';
const ctx=async(b,vp={width:1920,height:1080},scheme='light')=>{const c=await b.newContext({viewport:vp,locale:'en-IN',colorScheme:scheme});
  await c.addCookies([{name:'PREF',value:'hl=en',domain:'.youtube.com',path:'/'},{name:'SOCS',value:'CAI',domain:'.youtube.com',path:'/'}]);
  if(LIGHT_ALL) await c.route('**/*',r=>['image','media','font'].includes(r.request().resourceType())?r.abort():r.continue());
  return c;};
let LIGHT_ALL=false;
const skipAds=async p=>{for(let i=0;i<40;i++){const ad=await p.evaluate(()=>document.querySelector('#movie_player')?.classList.contains('ad-showing')).catch(()=>false); if(!ad) return; await p.click('.ytp-skip-ad-button,.ytp-ad-skip-button-modern,.ytp-ad-skip-button',{timeout:800}).catch(()=>{}); await p.waitForTimeout(1500);}};
const pad3=n=>String(n).padStart(3,'0');
// wait until the first n matching images have loaded (max ~5 s)
const imgsLoaded=(p,sel,n)=>p.waitForFunction(({sel,n})=>{const im=[...document.querySelectorAll(sel)].slice(0,n);return im.length>=Math.min(n,1)&&im.every(i=>i.complete&&i.naturalWidth>0)},{sel,n},{timeout:5000}).catch(()=>{});
async function captureHome(out){   // logged-out YouTube home + the search box rect for the typing overlay
  const c=await ctx(B,{width:1812,height:910}); const p=await c.newPage();
  await p.goto('https://www.youtube.com/',{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForSelector('input[name=search_query], input.ytSearchboxComponentInput, input#search',{timeout:30000});
  await imgsLoaded(p,'ytd-rich-item-renderer img',6); await p.waitForTimeout(1500);
  const home=await p.evaluate(()=>{const i=document.querySelector('input[name=search_query], input.ytSearchboxComponentInput, input#search');const r=i.getBoundingClientRect();const cs=getComputedStyle(i);
    const box=(i.closest('.ytSearchboxComponentInputBox')||i.closest('#container')||i.parentElement).getBoundingClientRect();
    return {input:[r.x,r.y,r.width,r.height],box:[box.x,box.y,box.width,box.height],font:cs.fontSize,family:cs.fontFamily,color:cs.color,bg:getComputedStyle(document.body).backgroundColor};});
  await p.screenshot({path:path.join(out,'home.png')}); await c.close(); return home;
}
let B;
const [cmd,...A]=process.argv.slice(2);

(async()=>{
 const b=B=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--renderer-process-limit=1','--js-flags=--max-old-space-size=256']});
 const LIGHT=['search','searchjson','meta'].includes(cmd);
 try{
 if(cmd==='search'){
   const [q,n='10']=A; const c=await ctx(b); const p=await c.newPage();
   await p.goto('https://www.youtube.com/results?search_query='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(4500);
   const r=await p.evaluate(n=>[...document.querySelectorAll('ytd-video-renderer')].slice(0,n).map(e=>({t:e.querySelector('#video-title')?.textContent.trim(),ch:e.querySelector('#channel-info #text, ytd-channel-name #text')?.textContent.trim(),meta:e.querySelector('#metadata-line')?.innerText.replace(/\n/g,' · '),len:e.querySelector('ytd-thumbnail-overlay-time-status-renderer, badge-shape')?.innerText?.trim().split('\n')[0],url:e.querySelector('a#thumbnail')?.href?.split('&')[0]})),+n);
   console.log('## '+q); r.forEach((x,i)=>console.log(`${i+1}. ${x.t} | ${x.ch} | ${x.meta} | ${x.len} | ${x.url}`));
 }
 else if(cmd==='searchjson'){
   const [qs,n='12']=A; LIGHT_ALL=true; const c=await ctx(b); const p=await c.newPage(); const all=[];
   for(const q of qs.split('||')){
   await p.goto('https://www.youtube.com/results?search_query='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(4000);
   const r=await p.evaluate(n=>[...document.querySelectorAll('ytd-video-renderer')].slice(0,n).map(e=>{const a=e.querySelector('a#thumbnail');const href=(a&&a.href)||'';const m=href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
     const meta=e.querySelector('#metadata-line'); const len=e.querySelector('ytd-thumbnail-overlay-time-status-renderer, badge-shape');
     return {id:m?m[1]:null,title:(e.querySelector('#video-title')||{}).textContent?.trim(),channel:(e.querySelector('#channel-info #text, ytd-channel-name #text')||{}).textContent?.trim(),
       meta:meta?meta.innerText.split('\n').join(' · '):'',length:len?len.innerText.trim().split('\n')[0]:''};}).filter(x=>x.id),+n);
   r.forEach(x=>{x.query=q; all.push(x);});
   if(!r.length){ const t=await p.evaluate(()=>document.body.innerText.slice(0,300)); console.error('no results for',q,'| page says:',t.replace(/\s+/g,' ')); }
   }
   console.log(JSON.stringify(all));
 }
 else if(cmd==='meta'){
   const [id]=A; LIGHT_ALL=true; const c=await ctx(b); const p=await c.newPage();
   await p.goto('https://www.youtube.com/watch?v='+id,{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(5000);
   const r=await p.evaluate(()=>{const v=ytInitialPlayerResponse.videoDetails, s=JSON.stringify(window.ytInitialData||{}); const ch=[]; const re=/"chapterRenderer":\{"title":\{"simpleText":"([^"]+)"\},"timeRangeStartMillis":(\d+)/g; let m; while((m=re.exec(s))) ch.push([+m[2]/1000,m[1]]);
     const caps=(ytInitialPlayerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks||[]).map(x=>x.languageCode+(x.kind?'/'+x.kind:''));
     const fmt=(ytInitialPlayerResponse.streamingData?.adaptiveFormats||[]).find(f=>f.width);
     return {title:v.title,channel:v.author,views:v.viewCount,length:v.lengthSeconds,keywords:v.keywords,chapters:ch,captions:caps,size:fmt?[fmt.width,fmt.height]:null,description:(v.shortDescription||'').slice(0,800)};});
   console.log(JSON.stringify(r,null,1));
 }
 else if(cmd==='scan'){
   const [id,out,...ts]=A; fs.mkdirSync(out,{recursive:true});
   for(const t of ts.map(Number)){
     const c=await ctx(b); const p=await c.newPage();
     try{
       await p.goto(`https://www.youtube.com/watch?v=${id}&t=${Math.floor(t)}s`,{waitUntil:'domcontentloaded',timeout:45000});
       await p.waitForSelector('#movie_player video',{timeout:20000}); await skipAds(p); await p.addStyleTag({content:HIDE});
       await p.evaluate(t=>{const v=document.querySelector('#movie_player video'); v.muted=true; v.currentTime=t; v.play().catch(()=>{});},t);
       await p.waitForFunction(()=>{const v=document.querySelector('#movie_player video');return v.currentTime>0.05&&v.readyState>=3},null,{timeout:15000});   // playback started
       // then pause and seek back to the exact time, so the still shows precisely t (short shots matter)
       await p.evaluate(t=>new Promise(r=>{const v=document.querySelector('#movie_player video'); v.pause(); v.addEventListener('seeked',()=>setTimeout(r,150),{once:true}); v.currentTime=t; setTimeout(r,5000);}),t);
       await p.waitForFunction(()=>{const v=document.querySelector('#movie_player video');return !v.seeking&&v.readyState>=2},null,{timeout:10000}).catch(()=>{}); await p.waitForTimeout(200);
       await (await p.$('#movie_player video')).screenshot({path:path.join(out,`f_${String(Math.round(t*10)).padStart(5,'0')}.png`)}); console.log('ok',t);
     }catch(e){console.log('fail',t,e.message.split('\n')[0]);}
     await c.close();
   }
 }
 else if(cmd==='seq'){
   const [id,out,t0s,t1s,fpsS='25']=A; const t0=+t0s,t1=+t1s,fps=+fpsS; fs.mkdirSync(out,{recursive:true});
   const c=await ctx(b); const p=await c.newPage();
   await p.goto(`https://www.youtube.com/watch?v=${id}&t=${Math.floor(t0)}s`,{waitUntil:'domcontentloaded',timeout:60000});
   await p.waitForSelector('#movie_player video',{timeout:30000}); await p.waitForTimeout(3000); await skipAds(p); await p.addStyleTag({content:HIDE});
   await p.evaluate(()=>{const v=document.querySelector('#movie_player video'); v.muted=true; v.pause();});
   const el=await p.$('#movie_player video'); let n=1;
   for(let t=t0;t<=t1+1e-6;t+=1/fps){
     await p.evaluate(t=>new Promise(r=>{const v=document.querySelector('#movie_player video'); v.addEventListener('seeked',()=>setTimeout(r,120),{once:true}); v.currentTime=t; setTimeout(r,4000);}),t);
     await p.waitForFunction(()=>{const v=document.querySelector('#movie_player video');return !v.seeking&&v.readyState>=2},null,{timeout:8000}).catch(()=>console.log('slow',t.toFixed(2)));
     await el.screenshot({path:path.join(out,pad3(n++)+'.jpg'),type:'jpeg',quality:92});
   }
   console.log('frames',n-1, 'size', JSON.stringify(await p.evaluate(()=>{const v=document.querySelector('#movie_player video');return [v.videoWidth,v.videoHeight]})));
 }
 else if(cmd==='pages'){
   // home (reused from home.json if present), results and watch are captured in parallel; waits are event-based
   const [id,q,out,phr='']=A; fs.mkdirSync(out,{recursive:true}); const R={query:q,video:id};
   const hj=path.join(out,'home.json');
   const doHome=async()=>{ if(fs.existsSync(hj)&&fs.existsSync(path.join(out,'home.png'))){R.home=JSON.parse(fs.readFileSync(hj,'utf8')).home;return;} R.home=await captureHome(out); };
   const doResults=async()=>{ const c=await ctx(b,{width:1812,height:910}); const p=await c.newPage();
     await p.goto('https://www.youtube.com/results?search_query='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:60000});
     await p.waitForSelector('ytd-video-renderer a#thumbnail',{timeout:30000});
     for(let i=0;i<3;i++){await p.mouse.wheel(0,500);await p.waitForTimeout(250);} await p.mouse.wheel(0,-4000);
     await imgsLoaded(p,'ytd-video-renderer a#thumbnail img',4); await p.waitForTimeout(400);
     R.results=await p.evaluate(id=>[...document.querySelectorAll('ytd-video-renderer')].slice(0,6).map(e=>{const a=e.querySelector('a#thumbnail');const r=a.getBoundingClientRect();return {title:e.querySelector('#video-title')?.textContent.trim(),thumb:[r.x,r.y,r.width,r.height],target:a.href.includes(id)}}),id);
     await p.screenshot({path:path.join(out,'results.png')}); };
   const doWatch=async()=>{ const c=await ctx(b,{width:1812,height:910}); const p=await c.newPage();
     await p.goto(`https://www.youtube.com/watch?v=${id}&t=5s`,{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForSelector('#movie_player video',{timeout:30000});
     await p.waitForSelector('ytd-watch-metadata h1',{timeout:20000}).catch(()=>{});
     await p.waitForFunction(()=>{const v=document.querySelector('#movie_player video');return v&&v.readyState>=2},null,{timeout:12000}).catch(()=>{});
     await skipAds(p); await p.evaluate(()=>{const v=document.querySelector('#movie_player video'); v.muted=true; v.pause();});
     await p.fill('input[name=search_query], input.ytSearchboxComponentInput',q).catch(()=>{}); await p.keyboard.press('Escape').catch(()=>{});
     await p.evaluate(()=>document.activeElement&&document.activeElement.blur()); await p.mouse.move(1800,900);
     await imgsLoaded(p,'#secondary ytd-thumbnail img, #secondary yt-image img, #secondary img.yt-core-image',3); await p.waitForTimeout(800);
     R.watch=await p.evaluate(PH=>{const pr=document.querySelector('#movie_player').getBoundingClientRect();
       const h=document.querySelector('ytd-watch-metadata h1 yt-formatted-string')||document.querySelector('h1.ytd-watch-metadata');
       const find=(phrase)=>{const w=document.createTreeWalker(h,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const i=n.textContent.toLowerCase().indexOf(phrase.toLowerCase());if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+phrase.length);return [...r.getClientRects()].map(x=>[x.x,x.y,x.width,x.height]);}}return null;};
       // every title character's rect, so keyword highlights can be worked out later without re-capturing
       const chars=[]; const w=document.createTreeWalker(h,NodeFilter.SHOW_TEXT); let n;
       while((n=w.nextNode())) for(let i=0;i<n.textContent.length;i++){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const b=r.getBoundingClientRect();chars.push([n.textContent[i],b.x,b.y,b.width,b.height]);}
       const ph={}; PH.filter(Boolean).forEach(x=>ph[x]=find(x));
       return {player:[pr.x,pr.y,pr.width,pr.height],title:h.textContent,phrases:ph,chars};},phr.split('|'));
     await p.screenshot({path:path.join(out,'watch.png')}); };
   await Promise.all([doHome(),doResults(),doWatch()]);
   fs.writeFileSync(path.join(out,'pages.json'),JSON.stringify(R,null,1));
   const tg=R.results.findIndex(r=>r.target); console.log('target result index:',tg);
   if(tg<0||R.results[tg].thumb[1]>760){ console.log('ERROR: the chosen video is not on the first screen of results for this query — pick a more specific query (e.g. words from its title) and rerun pages.'); process.exitCode=2; }
 }
 else if(cmd==='home'){
   const [out]=A; fs.mkdirSync(out,{recursive:true}); const home=await captureHome(out);
   fs.writeFileSync(path.join(out,'home.json'),JSON.stringify({home},null,1)); console.log('home ok');
 }
 else if(cmd==='rec'){   // record t0 … t0+seconds in real time from the player's own video (no overlays, no frame-by-frame seeks)
   const [id,out,t0s,durS]=A; const t0=+t0s, dur=+durS;
   const c=await ctx(b); const p=await c.newPage();
   await p.goto(`https://www.youtube.com/watch?v=${id}&t=${Math.max(0,Math.floor(t0))}s`,{waitUntil:'domcontentloaded',timeout:60000});
   await p.waitForSelector('#movie_player video',{timeout:30000});
   await p.waitForFunction(()=>{const v=document.querySelector('#movie_player video');return v&&v.readyState>=2},null,{timeout:20000}).catch(()=>{}); await skipAds(p);
   const r=await p.evaluate(({t0,dur})=>new Promise(async(res)=>{
     const v=document.querySelector('#movie_player video'), mp=document.querySelector('#movie_player'); v.muted=true;
     // the player already streams 720p at this window size; only switch (which flushes the buffer) when it's lower
     if(!/hd720|hd1080|highres/.test(mp.getPlaybackQuality?.()||'hd720')){ try{mp.setPlaybackQualityRange('hd720','hd720');}catch(e){} }
     // warm-up: YouTube may switch quality in the first second of playback, which would leave a hole in the recording
     await v.play().catch(()=>{}); await new Promise(r=>setTimeout(r,1100)); v.pause();
     await new Promise(r=>{v.addEventListener('seeked',r,{once:true}); v.currentTime=t0; setTimeout(r,5000);});
     const ok=()=>{for(let i=0;i<v.buffered.length;i++) if(v.buffered.start(i)<=t0+0.05&&v.buffered.end(i)>=t0+dur+0.3) return true; return false;};
     for(let i=0;i<50&&!ok();i++) await new Promise(r=>setTimeout(r,100));
     const types=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
     const rec=new MediaRecorder(v.captureStream(),{mimeType:types.find(t=>MediaRecorder.isTypeSupported(t)),videoBitsPerSecond:16000000}); const ch=[]; let stalls=0;
     v.addEventListener('waiting',()=>stalls++);
     let gaps=0, lastF=0; const onF=(now)=>{ if(lastF&&now-lastF>250) gaps++; lastF=now; if(rec.state==='recording') v.requestVideoFrameCallback(onF); };   // watches every presented frame
     rec.ondataavailable=e=>ch.push(e.data);
     rec.onstop=async()=>{const buf=new Uint8Array(await new Blob(ch).arrayBuffer()); let s=''; for(let i=0;i<buf.length;i+=32768) s+=String.fromCharCode.apply(null,buf.subarray(i,i+32768));
       res({b64:btoa(s),w:v.videoWidth,h:v.videoHeight,stalls,gaps,ad:!!document.querySelector('#movie_player')?.classList.contains('ad-showing'),end:v.currentTime});};
     rec.start(100); v.requestVideoFrameCallback(onF); await v.play().catch(()=>{});
     const iv=setInterval(()=>{ if(v.currentTime>=t0+dur+0.12){ clearInterval(iv); v.pause(); rec.stop(); } },15);
     setTimeout(()=>{ if(rec.state!=='inactive'){ clearInterval(iv); rec.stop(); } },(dur+8)*1000);
   }),{t0,dur});
   fs.writeFileSync(out,Buffer.from(r.b64,'base64')); console.log('rec',out,r.w+'x'+r.h,'stalls',r.stalls+r.gaps,'end',r.end.toFixed(2),'ad',r.ad);
   if(r.ad||r.stalls>0||r.gaps>0||r.end<t0+dur) process.exitCode=3;   // ad, buffering or a hole inside the stretch → caller retries   // ad or buffering inside the stretch → caller falls back to seq
 }
 else if(cmd==='adrec'){   // record the ad in real time: video + sound together (much faster than frame-by-frame)
   const [id,out]=A; const c=await ctx(b,{width:1920,height:1080}); const p=await c.newPage();
   await p.goto('https://www.youtube.com/watch?v='+id,{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForSelector('#movie_player video',{timeout:30000}); await p.waitForTimeout(3000); await skipAds(p);
   // ask for the highest quality the player offers
   await p.evaluate(()=>{try{const mp=document.querySelector('#movie_player'); const q=mp.getAvailableQualityLevels?.()||[]; const best=q.find(x=>/hd1080|hd720/.test(x))||q[0]; if(best){mp.setPlaybackQualityRange?.(best,best); mp.setPlaybackQuality?.(best);}}catch(e){}});
   await p.waitForTimeout(1500);
   const r=await p.evaluate(()=>new Promise(async(res)=>{
     const v=document.querySelector('#movie_player video'); v.pause(); v.currentTime=0; await new Promise(r=>v.addEventListener('seeked',r,{once:true}));
     await new Promise(r=>{ if(v.readyState>=3) r(); else v.addEventListener('canplay',r,{once:true}); setTimeout(r,8000); });
     v.muted=false; v.volume=1; const st=v.captureStream();
     const types=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
     const rec=new MediaRecorder(st,{mimeType:types.find(t=>MediaRecorder.isTypeSupported(t)),videoBitsPerSecond:12000000,audioBitsPerSecond:192000}); const ch=[];
     rec.ondataavailable=e=>ch.push(e.data);
     rec.onstop=async()=>{const buf=new Uint8Array(await new Blob(ch).arrayBuffer()); let s=''; for(let i=0;i<buf.length;i+=32768) s+=String.fromCharCode.apply(null,buf.subarray(i,i+32768)); res({b64:btoa(s),dur:v.duration,w:v.videoWidth,h:v.videoHeight});};
     rec.start(250); await v.play(); v.addEventListener('ended',()=>rec.stop(),{once:true}); setTimeout(()=>{if(rec.state!=='inactive') rec.stop();},(v.duration+3)*1000);}));
   fs.writeFileSync(out,Buffer.from(r.b64,'base64')); console.log('recorded',out,'duration',r.dur,'size',r.w+'x'+r.h);
 }
 else if(cmd==='audio'){
   const [id,out]=A; const c=await ctx(b,{width:1280,height:800}); const p=await c.newPage();
   await p.goto('https://www.youtube.com/watch?v='+id,{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForSelector('#movie_player video',{timeout:30000}); await p.waitForTimeout(4000); await skipAds(p);
   const r=await p.evaluate(()=>new Promise(async(res)=>{
     const v=document.querySelector('#movie_player video'); v.pause(); v.currentTime=0; await new Promise(r=>v.addEventListener('seeked',r,{once:true}));
     v.muted=false; v.volume=1; const at=v.captureStream().getAudioTracks(); if(!at.length) return res({err:'no audio track'});
     const rec=new MediaRecorder(new MediaStream(at),{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:192000}); const ch=[];
     rec.ondataavailable=e=>ch.push(e.data);
     rec.onstop=async()=>{const buf=new Uint8Array(await new Blob(ch).arrayBuffer()); let s=''; for(let i=0;i<buf.length;i+=32768) s+=String.fromCharCode.apply(null,buf.subarray(i,i+32768)); res({b64:btoa(s),dur:v.duration});};
     rec.start(250); await v.play(); v.addEventListener('ended',()=>rec.stop(),{once:true}); setTimeout(()=>{if(rec.state!=='inactive') rec.stop();},(v.duration+2)*1000);}));
   if(r.err) console.log(r.err); else {fs.writeFileSync(out,Buffer.from(r.b64,'base64')); console.log('audio',out,'duration',r.dur);}
 }
 else console.log('unknown command; see header of yt.js');
 } finally { await b.close(); }
})();
