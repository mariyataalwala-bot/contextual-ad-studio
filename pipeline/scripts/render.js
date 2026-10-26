// NODE_PATH=<app>/node_modules node render.js page.html out.mp4 [fps=25] [subframes=1] [scale=1] [workers=auto]
// NODE_PATH=<app>/node_modules node render.js page.html --stills outdir t1 t2 ...
// Waits for every source frame to decode (window.seekA). Renders in parallel (several pages, each a slice of the
// timeline → segment files → joined), optional motion blur (subframes>1) and preview scale (e.g. 0.6667 = 1280x720).
const {chromium}=require('playwright');const {spawn}=require('child_process');const path=require('path');const fs=require('fs');const os=require('os');
const run=(cmd,args)=>new Promise((res,rej)=>{const p=spawn(cmd,args);let e='';p.stderr.on('data',d=>e+=d);p.on('close',c=>c?rej(new Error(e)):res());});
(async()=>{
 const a=process.argv.slice(2), html=a[0];
 // GPU drawing is ~25% faster where there is one (falls back to the CPU otherwise; RENDER_GPU=0 forces the CPU)
 const CPU=['--disable-dev-shm-usage','--disable-gpu'], GPU=['--disable-dev-shm-usage','--ignore-gpu-blocklist','--enable-gpu-rasterization',...(process.platform==='win32'?['--use-angle=d3d11']:[])];
 let useGpu=process.env.RENDER_GPU!=='0';
 const launch=async()=>{ if(useGpu){ try{ return await chromium.launch({args:GPU}); }catch(e){ useGpu=false; } } return chromium.launch({args:CPU}); };
 const b=await launch(), extra=[];   // one browser per worker: a single browser process serialises the screenshots
 const SCALE=a[1]==='--stills'?1:+(a[4]||1);
 const open=async(br=b)=>{const p=await br.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:SCALE});
   await p.goto('file://'+path.resolve(html)+'?render');
   await p.waitForFunction(()=>document.fonts.check('700 40px Poppins'),null,{timeout:20000}).catch(()=>{});
   await p.evaluate(()=>document.fonts.ready); return p;};
 const WANT=a[1]==='--stills'?1:Math.max(1,Math.min(+(a[5]||0)||Math.max(1,Math.min(10,os.cpus().length-2)),12));
 // every worker's browser + page opens at the same time (start-up was the slow part)
 const [p0,...rest]=await Promise.all([open(), ...[...Array(WANT-1)].map(async()=>{const br=await launch(); extra.push(br); return open(br);})]);
 const errs=[]; p0.on('pageerror',e=>errs.push(e.message));
 const T=await p0.evaluate(()=>window.DURATION);
 if(a[1]==='--stills'){fs.mkdirSync(a[2],{recursive:true}); for(const t of a.slice(3)){await p0.evaluate(async t=>await seekA(t),+t);await p0.screenshot({path:`${a[2]}/s_${t}.png`});} await b.close(); console.log('stills ok',errs.join(' | ')); return;}
 const out=a[1], FPS=+(a[2]||25), K=+(a[3]||1), N=Math.round(T*FPS), sub=1/(FPS*2*K);
 const WORK=WANT;
 const vf=K>1?`tmix=frames=${K}:weights='${Array(K).fill(1).join(' ')}',select='eq(mod(n\\,${K})\\,${K-1})',setpts=N/(${FPS})/TB`:'null';
 const pages=[p0,...rest];
 const per=Math.ceil(N/WORK); let done=0; const segs=[];
 await Promise.all(pages.map(async(p,w)=>{
   const f0=w*per, f1=Math.min(N,f0+per); if(f0>=f1) return;
   const seg=out.replace(/\.mp4$/,'')+`.part${w}.mp4`; segs[w]=seg;
   const ff=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate',String(FPS*K),'-c:v','mjpeg','-i','-','-vf',vf,'-r',String(FPS),'-c:v','libx264','-crf',SCALE<1?'20':'15','-preset',SCALE<1?'veryfast':'medium','-pix_fmt','yuv420p',seg]);
   ff.stderr.on('data',d=>process.stderr.write(d));
   for(let f=f0;f<f1;f++){for(let k=0;k<K;k++){const t=Math.max(0,f/FPS+(k-(K-1)/2)*sub);await p.evaluate(async t=>await seekA(t),t);
     const buf=await p.screenshot({type:'jpeg',quality:SCALE<1?88:94}); if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));}
     if(++done%100==0) console.log('frame',done,'/',N);}
   ff.stdin.end(); await new Promise(r=>ff.on('close',r));
 }));
 const list=out.replace(/\.mp4$/,'')+'.parts.txt'; fs.writeFileSync(list,segs.filter(Boolean).map(s=>`file '${path.resolve(s).replace(/\\/g,'/')}'`).join('\n'));
 await run('ffmpeg',['-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',out]);
 segs.filter(Boolean).forEach(s=>fs.unlinkSync(s)); fs.unlinkSync(list);
 fs.writeFileSync(out.replace(/\.mp4$/,'')+'.times.json',JSON.stringify(await p0.evaluate(()=>window.TIMES)));
 await Promise.all(extra.map(x=>x.close())); await b.close(); console.log('rendered',out,N,'frames',WORK,'workers',errs.length?'ERR '+errs.join(' | '):'');
})();
