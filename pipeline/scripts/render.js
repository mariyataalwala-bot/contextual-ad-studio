// NODE_PATH=<skill>/node_modules node render.js page.html out.mp4 [fps=25] [subframes=4]
// NODE_PATH=<skill>/node_modules node render.js page.html --stills outdir t1 t2 ...
// Waits for every source frame to decode (window.seekA), renders with motion blur, writes out.mp4 + out.times.json.
const {chromium}=require('playwright');const {spawn}=require('child_process');const path=require('path');const fs=require('fs');
(async()=>{
 const a=process.argv.slice(2), html=a[0];
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:1920,height:1080}});
 const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('file://'+path.resolve(html)+'?render');
 await p.waitForFunction(()=>document.fonts.check('700 40px Poppins'),null,{timeout:20000}).catch(()=>{});
 await p.evaluate(()=>document.fonts.ready);
 const T=await p.evaluate(()=>window.DURATION);
 if(a[1]==='--stills'){fs.mkdirSync(a[2],{recursive:true}); for(const t of a.slice(3)){await p.evaluate(async t=>await seekA(t),+t);await p.screenshot({path:`${a[2]}/s_${t}.png`});} await b.close(); console.log('stills ok',errs.join(' | ')); return;}
 const out=a[1], FPS=+(a[2]||25), K=+(a[3]||4), N=Math.round(T*FPS), sub=1/(FPS*2*K);
 const vf=`tmix=frames=${K}:weights='${Array(K).fill(1).join(' ')}',select='eq(mod(n\\,${K})\\,${K-1})',setpts=N/(${FPS})/TB`;
 const ff=spawn('ffmpeg',['-loglevel','error','-y','-f','image2pipe','-framerate',String(FPS*K),'-c:v','mjpeg','-i','-','-vf',vf,'-r',String(FPS),'-c:v','libx264','-crf','15','-preset','medium','-pix_fmt','yuv420p',out]);
 ff.stderr.on('data',d=>process.stderr.write(d));
 for(let f=0;f<N;f++){for(let k=0;k<K;k++){const t=Math.max(0,f/FPS+(k-(K-1)/2)*sub);await p.evaluate(async t=>await seekA(t),t);
   const buf=await p.screenshot({type:'jpeg',quality:94}); if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));}
   if(f%250==0) console.log('frame',f,'/',N);}
 ff.stdin.end();await new Promise(r=>ff.on('close',r));
 fs.writeFileSync(out.replace(/\.mp4$/,'')+'.times.json',JSON.stringify(await p.evaluate(()=>window.TIMES)));
 await b.close(); console.log('rendered',out,N,'frames',errs.length?'ERR '+errs.join(' | '):'');
})();
