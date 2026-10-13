// YouTube capture helpers for the contextual-ad skill. Run with NODE_PATH=<skill>/node_modules.
//
//   node yt.js search  "<query>" [n]                    list results: title | channel | views·age | length | url
//   node yt.js meta    <videoId>                         title, channel, views, length, chapters, keywords, caption tracks
//   node yt.js scan    <videoId> <outdir> t1 t2 ...      one still per timestamp (fresh page per still; survives mid-roll ads)
//   node yt.js seq     <videoId> <outdir> <t0> <t1> [fps]   frame-accurate run of stills 001.jpg… (paused seeks)
//   node yt.js pages   <videoId> "<query>" <outdir> "<phrase1|phrase2>"
//                       → home.png, results.png, watch.png (1812x910, light theme) + pages.json (rects)
//   node yt.js audio   <videoId> <out.webm>              records the video's own audio track in real time
//
// Nothing is downloaded as a file: stills are screenshots of the player, audio is recorded from the player.
const {chromium}=require('playwright'); const fs=require('fs'); const path=require('path');
const HIDE='.ytp-chrome-bottom,.ytp-chrome-top,.ytp-gradient-bottom,.ytp-gradient-top,.ytp-ce-element,.ytp-paid-content-overlay,.ytp-caption-window-container,.ytp-pause-overlay,.ytp-spinner,.ytp-bezel,.ytp-tooltip,.ytp-overlays-container{display:none!important}';
const ctx=async(b,vp={width:1920,height:1080},scheme='light')=>{const c=await b.newContext({viewport:vp,locale:'en-IN',colorScheme:scheme});
  await c.addCookies([{name:'PREF',value:'hl=en',domain:'.youtube.com',path:'/'},{name:'SOCS',value:'CAI',domain:'.youtube.com',path:'/'}]); return c;};
const skipAds=async p=>{for(let i=0;i<40;i++){const ad=await p.evaluate(()=>document.querySelector('#movie_player')?.classList.contains('ad-showing')).catch(()=>false); if(!ad) return; await p.click('.ytp-skip-ad-button,.ytp-ad-skip-button-modern,.ytp-ad-skip-button',{timeout:800}).catch(()=>{}); await p.waitForTimeout(1500);}};
const pad3=n=>String(n).padStart(3,'0');
const [cmd,...A]=process.argv.slice(2);

(async()=>{
 const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage','--disable-gpu']});
 try{
 if(cmd==='search'){
   const [q,n='10']=A; const c=await ctx(b); const p=await c.newPage();
   await p.goto('https://www.youtube.com/results?search_query='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(4500);
   const r=await p.evaluate(n=>[...document.querySelectorAll('ytd-video-renderer')].slice(0,n).map(e=>({t:e.querySelector('#video-title')?.textContent.trim(),ch:e.querySelector('#channel-info #text, ytd-channel-name #text')?.textContent.trim(),meta:e.querySelector('#metadata-line')?.innerText.replace(/\n/g,' · '),len:e.querySelector('ytd-thumbnail-overlay-time-status-renderer, badge-shape')?.innerText?.trim().split('\n')[0],url:e.querySelector('a#thumbnail')?.href?.split('&')[0]})),+n);
   console.log('## '+q); r.forEach((x,i)=>console.log(`${i+1}. ${x.t} | ${x.ch} | ${x.meta} | ${x.len} | ${x.url}`));
 }
 else if(cmd==='searchjson'){
   const [q,n='12']=A; const c=await ctx(b); const p=await c.newPage();
   await p.goto('https://www.youtube.com/results?search_query='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(4500);
   const r=await p.evaluate(n=>[...document.querySelectorAll('ytd-video-renderer')].slice(0,n).map(e=>{const a=e.querySelector('a#thumbnail');const href=(a&&a.href)||'';const m=href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
     const meta=e.querySelector('#metadata-line'); const len=e.querySelector('ytd-thumbnail-overlay-time-status-renderer, badge-shape');
     return {id:m?m[1]:null,title:(e.querySelector('#video-title')||{}).textContent?.trim(),channel:(e.querySelector('#channel-info #text, ytd-channel-name #text')||{}).textContent?.trim(),
       meta:meta?meta.innerText.split('\n').join(' · '):'',length:len?len.innerText.trim().split('\n')[0]:''};}).filter(x=>x.id),+n);
   console.log(JSON.stringify(r));
 }
 else if(cmd==='meta'){
   const [id]=A; const c=await ctx(b); const p=await c.newPage();
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
       await p.waitForFunction(t=>{const v=document.querySelector('#movie_player video');return v.currentTime>=t+0.1&&v.readyState>=3},t,{timeout:15000});
       await p.evaluate(()=>document.querySelector('#movie_player video').pause()); await p.waitForTimeout(250);
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
   const [id,q,out,phr='']=A; fs.mkdirSync(out,{recursive:true}); const R={query:q,video:id};
   const c=await ctx(b,{width:1812,height:910}); const p=await c.newPage();
   // home (logged-out YouTube home) + the search box rect for the typing overlay
   await p.goto('https://www.youtube.com/',{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(5000);
   R.home=await p.evaluate(()=>{const i=document.querySelector('input[name=search_query], input.ytSearchboxComponentInput, input#search');const r=i.getBoundingClientRect();const cs=getComputedStyle(i);
     const box=(i.closest('.ytSearchboxComponentInputBox')||i.closest('#container')||i.parentElement).getBoundingClientRect();
     return {input:[r.x,r.y,r.width,r.height],box:[box.x,box.y,box.width,box.height],font:cs.fontSize,family:cs.fontFamily,color:cs.color,bg:getComputedStyle(document.body).backgroundColor};});
   await p.screenshot({path:path.join(out,'home.png')});
   // results
   await p.goto('https://www.youtube.com/results?search_query='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(5000);
   for(let i=0;i<3;i++){await p.mouse.wheel(0,500);await p.waitForTimeout(600);} await p.mouse.wheel(0,-4000); await p.waitForTimeout(2500);
   R.results=await p.evaluate(id=>[...document.querySelectorAll('ytd-video-renderer')].slice(0,6).map(e=>{const a=e.querySelector('a#thumbnail');const r=a.getBoundingClientRect();return {title:e.querySelector('#video-title')?.textContent.trim(),thumb:[r.x,r.y,r.width,r.height],target:a.href.includes(id)}}),id);
   await p.screenshot({path:path.join(out,'results.png')});
   // watch page with the query in the box, player paused
   await p.goto(`https://www.youtube.com/watch?v=${id}&t=5s`,{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForSelector('#movie_player video',{timeout:30000}); await p.waitForTimeout(5000);
   await p.evaluate(()=>{const v=document.querySelector('#movie_player video'); v.muted=true; v.pause();});
   await p.fill('input[name=search_query], input.ytSearchboxComponentInput',q).catch(()=>{}); await p.keyboard.press('Escape').catch(()=>{});
   await p.evaluate(()=>document.activeElement&&document.activeElement.blur()); await p.mouse.move(1800,900); await p.waitForTimeout(2500);
   R.watch=await p.evaluate(PH=>{const pr=document.querySelector('#movie_player').getBoundingClientRect();
     const h=document.querySelector('ytd-watch-metadata h1 yt-formatted-string')||document.querySelector('h1.ytd-watch-metadata');
     const find=(phrase)=>{const w=document.createTreeWalker(h,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const i=n.textContent.toLowerCase().indexOf(phrase.toLowerCase());if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+phrase.length);return [...r.getClientRects()].map(x=>[x.x,x.y,x.width,x.height]);}}return null;};
     const ph={}; PH.filter(Boolean).forEach(x=>ph[x]=find(x));
     return {player:[pr.x,pr.y,pr.width,pr.height],title:h.textContent,phrases:ph};},phr.split('|'));
   await p.screenshot({path:path.join(out,'watch.png')});
   fs.writeFileSync(path.join(out,'pages.json'),JSON.stringify(R,null,1));
   const tg=R.results.findIndex(r=>r.target); console.log(JSON.stringify(R.watch,null,1)); console.log('target result index:',tg);
   if(tg<0||R.results[tg].thumb[1]>760){ console.log('ERROR: the chosen video is not on the first screen of results for this query — pick a more specific query (e.g. words from its title) and rerun pages.'); process.exitCode=2; }
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
