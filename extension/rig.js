/* Animate only the approved v0.1 pixels. Original head, face, clothes and proportions. */
(function(root){
 'use strict';
 const textures=new Map();
 const originalMesh=root.WhaleOriginalMesh;
 function releaseMesh(art){
  const mesh=art.mesh;art.mesh=null;
  if(typeof mesh.destroy==='function'){mesh.destroy();return;}
  // A page already open during an unpacked-extension update can still have
  // the pre-0.5.10 renderer. It has no destroy(), but its owned GL resources
  // must actually be released; skipping the missing method would leak them.
  mesh.disposed=true;mesh.available=false;
  const gl=mesh.gl;
  if(gl&&!gl.isContextLost()){
   if(mesh.texture)gl.deleteTexture(mesh.texture);if(mesh.buffer)gl.deleteBuffer(mesh.buffer);
   if(mesh.elements)gl.deleteBuffer(mesh.elements);if(mesh.program)gl.deleteProgram(mesh.program);
   gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  mesh.texture=mesh.buffer=mesh.elements=mesh.program=mesh.gl=mesh.image=null;
  mesh.cache?.clear();
  if(mesh.canvas)mesh.canvas.width=mesh.canvas.height=1;
 }
 function syncMesh(entry){
  if(!entry.art)return;
  if(entry.active>0&&!entry.art.mesh&&!entry.failed){
   try{entry.art.mesh=new originalMesh.Mesh(entry.art.image);}catch(error){entry.failed=true;console.warn('Original-art mesh unavailable',error.message);}
  }else if(entry.active===0&&entry.art.mesh){releaseMesh(entry.art);}
 }
 function acquireTexture(url){
  let entry=textures.get(url);
  if(!entry){
   entry={url,refs:0,active:0,art:null,failed:false,promise:null};textures.set(url,entry);
   entry.promise=new Promise((resolve,reject)=>{
   const image=new Image();image.onload=()=>{
    entry.art={image,mesh:null};
    if(entry.refs>0)syncMesh(entry);
    resolve(entry.art);
   };image.onerror=()=>reject(Error('原版素材加载失败'));
   if(url.startsWith('chrome-extension:')&&!location.protocol.startsWith('chrome-extension'))image.crossOrigin='anonymous';
   if(url.startsWith('file:')){
    // Browsers prohibit file:// textures in WebGL. This local-only JS wraps the
    // very same PNG bytes; ordinary extension pages use the original PNG directly.
    const useLocal=()=>{image.src='data:image/png;base64,'+globalThis.WhaleOriginalArtData;};
    if(globalThis.WhaleOriginalArtData)useLocal();
    else{const script=document.createElement('script');script.src=new URL('original-art-data.js',document.baseURI).href;script.onload=useLocal;script.onerror=()=>reject(Error('本地预览原图加载失败'));document.head.append(script);}
   }else image.src=url;
   });
  }
  entry.refs++;entry.active++;syncMesh(entry);return entry;
 }
 function releaseTexture(entry){
  if(--entry.refs===0){
   entry.active=0;syncMesh(entry);
   if(textures.get(entry.url)===entry)textures.delete(entry.url);
  }
 }
 class Rig{
  constructor(canvas,url){
   this.canvas=canvas;this.ctx=canvas.getContext('2d');this.model=new WhaleMotion.Motion();
   this.art=null;this.enabled=false;this.reduced=false;this.disposed=false;this.raf=0;
   this.last=0;this.frameCount=0;this.particles=[];this.burst=-1;this.state=null;
   // One mesh is shared by live users of an image. Hidden/reduced-motion pets
   // hold only the image, and disposed pets release their reference entirely.
   this.texture=acquireTexture(url);this.gpuActive=true;
   this.ready=this.texture.promise.then(art=>{if(this.disposed)return;this.art=art;canvas.dataset.ready='true';canvas.dataset.art='original-v01';this.draw(this.model.step(0,this.reduced));this.schedule();});
   this.ready.catch(()=>{canvas.dataset.ready='error';});
  }
  configure({size,enabled,reduced}){
   if(this.disposed)return;
   const scale=Math.min(devicePixelRatio||1,2)*size/512,w=Math.round(1024*scale),h=Math.round(1126*scale);
   if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
   this.enabled=enabled;this.reduced=reduced;this.setGpuActive(!!enabled&&!reduced);if(reduced)this.particles=[];
   if(!enabled||reduced){cancelAnimationFrame(this.raf);this.raf=0;this.last=0;}
   if(this.art&&enabled)this.draw(this.model.step(0,reduced));this.schedule();
  }
  schedule(){if(this.enabled&&!this.reduced&&this.art&&!this.disposed&&!this.raf)this.raf=requestAnimationFrame(t=>this.tick(t));}
  tick(now){this.raf=0;const dt=this.last?Math.min((now-this.last)/1000,.06):1/60;this.last=now;
   const f=this.model.step(dt);this.updateParticles(f,dt);this.draw(f);this.schedule();}
  play(action){this.model.play(action);this.burst=-1;this.particles=[];if(this.art)this.draw(this.model.step(0,this.reduced));this.schedule();}
  drag(vx){this.model.drag(vx);}
  gaze(x,y){this.model.gaze(x,y);}
  setGpuActive(active){
   if(this.gpuActive===active)return;
   this.gpuActive=active;this.texture.active+=active?1:-1;
   syncMesh(this.texture);
  }
  destroy(){
   if(this.disposed)return;
   this.disposed=true;cancelAnimationFrame(this.raf);this.raf=0;this.particles=[];
   this.setGpuActive(false);releaseTexture(this.texture);this.texture=null;this.art=null;
  }
  updateParticles(f,dt){
   if(f.confetti){const cycle=Math.floor(f.time/1.05),phase=f.time%1.05;
    if(phase>.28&&cycle!==this.burst){this.burst=cycle;
     for(let i=0;i<38;i++){const fromSky=i>=26,side=i%2?-1:1;
      this.particles.push({x:fromSky?60+Math.random()*400:256+side*115,y:fromSky?-180-Math.random()*140:260+f.bodyY,
       vx:fromSky?(Math.random()-.5)*70:side*(55+Math.random()*120),vy:fromSky?55+Math.random()*80:-170-Math.random()*150,
       life:2.7+Math.random(),angle:Math.random()*6,spin:(Math.random()-.5)*12,color:['#78b6f0','#efbb6e','#e9a5c7','#a5d3bf','#a7a4e9'][i%5]});}
    }
   }
   for(const p of this.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=110*dt;p.vx*=Math.exp(-dt*.35);p.angle+=p.spin*dt;p.life-=dt;}
   this.particles=this.particles.filter(p=>p.life>0&&p.y<570).slice(-110);
  }
  original(rect){const [x,y,w,h]=rect,s=512/380;this.ctx.drawImage(this.art.image,x,y,w,h,(512-w*s)/2,499.2-h*s,w*s,h*s);}
  fear(rect){
   const c=this.ctx,[sx,sy,w,h]=rect,s=512/380,ox=(512-w*s)/2,oy=499.2-h*s;
   c.save();c.translate(ox,oy);c.scale(s,s);
   const eyes=originalMesh.poses.drag.eyes;
   for(let i=0;i<eyes.length;i++){
    const [ex,ey,rx,ry]=eyes[i];c.save();c.beginPath();c.ellipse(ex,ey,rx+3,ry+3,-.08,0,Math.PI*2);c.clip();
    // The small expression mask samples existing skin pixels from below this same eye.
    c.drawImage(this.art.image,sx+ex-12,sy+ey+ry+3,24,2,ex-rx-5,ey-ry-5,(rx+5)*2,(ry+5)*2);c.restore();
    c.beginPath();if(i===0){c.moveTo(ex-12,ey-9);c.lineTo(ex+5,ey);c.lineTo(ex-12,ey+9);}else{c.moveTo(ex+12,ey-9);c.lineTo(ex-5,ey);c.lineTo(ex+12,ey+9);}
    c.strokeStyle='#293256';c.lineWidth=3.5;c.lineJoin='round';c.lineCap='round';c.stroke();
   }c.restore();
  }
  peek(rect,f){
   const c=this.ctx,[sx,sy,w,h]=rect,s=512/380,ox=(512-w*s)/2,oy=499.2-h*s,edge=ox+212*s;
   const reveal=Math.min(1,Math.max(0,-f.headX/75)),slide=(1-reveal)*235;
   c.save();c.beginPath();c.rect(-256,-410,edge+256,1126);c.clip();
   c.globalAlpha=Math.min(1,reveal*3);c.drawImage(this.art.image,sx,sy,212,h,ox+slide,oy,212*s,h*s);c.restore();
   // A fixed prop, separate from the original peeking character texture.
   c.fillStyle='#edf2f9';c.fillRect(edge,oy,512-edge,h*s);c.fillStyle='#bdcee4';c.fillRect(edge,oy,3,h*s);
   return edge;
  }
  draw(f,neutral=false){
   if(!this.art)return;const c=this.ctx,w=this.canvas.width,h=this.canvas.height;
   c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.scale(w/1024,h/1126);c.translate(256,410);
   const rect=WhaleSprite.rects[TrenchCore.ACTIONS[f.action].index];let wallX=0;
   c.save();
   if(!neutral&&!this.reduced){
    if(['pat','profit'].includes(f.action)){c.translate(256,490+f.bodyY);c.scale(f.sx,f.sy);c.translate(-256,-490);}
    else if(f.action==='alert')c.translate(0,f.bodyY*.45);
    else if(f.action==='close'){c.translate(256,380);c.scale(1,f.sy);c.translate(-256,-380);}
   }
   if(f.action==='peek'&&!neutral&&!this.reduced)wallX=this.peek(rect,f);
   else if(neutral||this.reduced)this.original(rect);
   else{
    const mesh=this.art.mesh?.render(f.action,rect,f);
    if(mesh){const unit=512/380;c.drawImage(mesh,-66*unit,-66*unit,512*unit,512*unit);}else this.original(rect);
    if(f.action==='drag')this.fear(rect);
   }
   c.restore();
   if(!neutral){
    if(f.zz){for(let i=0;i<f.zz;i++){const phase=(f.time*.45+i/3)%1;c.save();c.globalAlpha=Math.sin(phase*Math.PI)*.85;
     c.translate(352+phase*50+Math.sin(phase*5)*9,170-phase*135);c.rotate(-.12);c.fillStyle='#7c9ecb';c.font=`600 ${22+phase*20}px Georgia,serif`;c.fillText('Z',0,0);c.restore();}}
    for(const p of this.particles){c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.globalAlpha=Math.min(1,p.life);c.fillStyle=p.color;c.fillRect(-4,-2,8,4+Math.abs(Math.sin(p.angle))*4);c.restore();}
   }
   this.canvas.dataset.renderer=this.art.mesh?.available?'original-mesh':'original-static';
   this.state={...f,wallX:wallX||f.wallX,particles:this.particles.length,frame:++this.frameCount,art:'original-v01',mesh:this.art.mesh?.available||false};
  }
 }
 root.WhaleRig={create:(canvas,url)=>new Rig(canvas,url)};
})(globalThis);
