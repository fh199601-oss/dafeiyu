import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const output=path.resolve('test-results/motion-stress');await fs.mkdir(output,{recursive:true});
const source=await fs.readFile('extension/assets/whale-poses.png');
const sourceHash=createHash('sha256').update(source).digest('hex');
assert.equal(sourceHash,'bfac17e641ab6695054155bea8f37324f027fd7d0d7d42ac81623d38283ad52d');
const base=pathToFileURL(path.resolve('extension')+path.sep).href;
const dependencies=['core.js','preview-bridge.js','sprite.js','original-art-data.js','original-mesh.js','click-audio.js','motion.js','rig.js','finance-core.js','pet.js'];
const fixture=path.join(output,'fixture.html');
await fs.writeFile(fixture,`<!doctype html><meta charset="utf-8"><base href="${base}"><style>body{margin:0;background:#edf3fa;color:#253b5a;font:16px system-ui}header{padding:18px 30px;height:55px}#stage{position:relative;width:900px;height:600px}canvas{image-rendering:auto}</style><header id="title">原图动作压力验收</header><div id="stage"></div>${dependencies.map(file=>`<script src="${file}"></script>`).join('')}`);
const browser=await chromium.launch({channel:'msedge',headless:true});const reports=[],errors=[];
try{
 if(!process.env.MOTION_STRESS_GEOMETRY_ONLY)for(const dpr of [1,2])for(const size of [100,205,280]){
  const name=`size-${size}-dpr-${dpr}`;
  const context=await browser.newContext({viewport:{width:900,height:700},deviceScaleFactor:dpr,recordVideo:{dir:output,size:{width:900,height:700}}});
  const page=await context.newPage();page.on('pageerror',error=>errors.push({name,message:error.message}));
  try{
   await page.goto(pathToFileURL(fixture).href);
   await page.evaluate(size=>{
    globalThis.rigs=[];const original=WhaleRig.create;WhaleRig.create=(...args)=>{const rig=original(...args);rigs.push(rig);return rig;};
    let settings={size,energy:'quiet',sound:false,interactionSound:false,clickMode:'companion',position:{x:.5,y:.68}};
    globalThis.pet=TrenchPet.mount({container:document.querySelector('#stage'),settings,patch:change=>({settings:settings=TrenchCore.patchSettings(settings,change)})});
    globalThis.renderTimes=[];const rig=rigs[0],draw=rig.draw.bind(rig);rig.draw=(...args)=>{const at=performance.now();draw(...args);renderTimes.push({action:args[0].action,ms:performance.now()-at});};
    document.querySelector('#title').textContent=`实际尺寸 ${size}px · DPR ${devicePixelRatio} · 原人物/原素材`;
   },size);
   await page.evaluate(()=>pet.ready);
   await expect(page.locator('.rig-canvas')).toHaveAttribute('data-ready','true');
   const actualSize=await page.locator('.pet').boundingBox();assert.equal(actualSize.width,size,`${name} uses the requested CSS size, not the home's enlarged preview`);
   const record={name,size,dpr,sourceHash,frames:[]};
   const snap=async label=>{const file=path.join(output,`${name}-${label}.png`);await page.screenshot({path:file});record.frames.push(file);};
   for(const [action,duration,peak]of [['alert',3.8,.24],['comfort',5,.9],['profit',3.4,1.5]]){
    await page.evaluate(action=>{pet.play(action,{silent:true});document.querySelector('#title').textContent+=` · ${action}`;},action);
    await page.waitForTimeout(peak*1000);await snap(action+'-peak');
    await page.waitForTimeout((duration-peak)*1000+100);
    const state=await page.evaluate(()=>pet.inspect());assert.equal(state.action,'idle',`${name} ${action} completes`);
   }
   const hit=page.locator('.hit'),box=await hit.boundingBox();const start={x:box.x+box.width*.5,y:box.y+box.height*.25};
   await page.mouse.move(start.x,start.y);await page.mouse.down();
   for(let cycle=0;cycle<3;cycle++){
    await page.mouse.move(start.x+150,start.y-20,{steps:1});await page.waitForTimeout(110);
    await page.mouse.move(start.x-150,start.y-20,{steps:1});await page.waitForTimeout(110);
   }
   const extreme=await page.evaluate(()=>pet.inspect());assert.equal(extreme.eyes,'fear');assert.ok(Number.isFinite(extreme.legL)&&Number.isFinite(extreme.legR));
   await snap('drag-reversal');await page.waitForTimeout(1800);await snap('drag-still');
   const settled=await page.evaluate(()=>({state:pet.inspect(),swing:rigs[0].model.swing}));assert.ok(Math.abs(settled.swing)<.03,`${name} stationary drag pendulum settles`);
   await page.mouse.up();await page.waitForTimeout(100);assert.equal((await page.evaluate(()=>pet.inspect())).action,'pat');await snap('release');
   await page.evaluate(()=>pet.play('profit',{silent:true}));await page.waitForTimeout(350);
   await page.evaluate(size=>pet.update({size,energy:'quiet',reducedMotion:true,sound:false,interactionSound:false}),size);
   const paused=await page.evaluate(()=>({state:pet.inspect(),particles:rigs[0].particles.length}));await page.waitForTimeout(250);
   assert.equal((await page.evaluate(()=>pet.inspect())).frame,paused.state.frame);assert.equal(paused.particles,0);
   await snap('reduced');
   await page.evaluate(size=>{pet.update({size,energy:'quiet',reducedMotion:false,sound:false,interactionSound:false});Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));},size);
   const hidden=(await page.evaluate(()=>pet.inspect())).frame;await page.waitForTimeout(300);assert.equal((await page.evaluate(()=>pet.inspect())).frame,hidden);
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(200);
   assert.ok((await page.evaluate(()=>pet.inspect())).frame>hidden);
   const perf=await page.evaluate(()=>{
    const values=renderTimes.map(x=>x.ms).sort((a,b)=>a-b),gl=rigs[0].art.mesh.gl,info=gl.getExtension('WEBGL_debug_renderer_info');
    const result={draws:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values.at(-1),renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'unknown',canvas:[rigs[0].canvas.width,rigs[0].canvas.height]};
    pet.destroy();return result;
   });record.performance=perf;reports.push(record);console.log(JSON.stringify({name,...perf}));
  }finally{const video=page.video();await context.close();if(video)await video.saveAs(path.join(output,`${name}.webm`));}
 }
 // Geometry/identity are independent of CSS size. Sample every animation frame
 // through each complete action and 24 seconds of abrupt drag/reverse/stillness.
 const page=await browser.newPage({viewport:{width:1240,height:900}});page.on('pageerror',error=>errors.push({name:'full-cycle',message:error.message}));await page.goto(pathToFileURL(fixture).href);
 const full=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1126;
  const rig=WhaleRig.create(canvas,'data:image/png;base64,'+WhaleOriginalArtData);await rig.ready;
  const result=[],captures=[];
  for(const [action,seconds]of [['alert',3.8],['comfort',5],['profit',3.4],['pat',2.6],['buy',2.8],['drag',24]]){
   const model=new WhaleMotion.Motion();model.play(action);const rect=WhaleSprite.rects[TrenchCore.ACTIONS[action].index];
   rig.art.mesh.render(action,rect,model.step(0));const mesh=rig.art.mesh.cache.get(action),face=WhaleOriginalMesh.poses[action].face;
   const rigidEdges=[],locked=[],upper=[];
   for(let j=0;j<mesh.indices.length;j+=3){const a=mesh.indices[j],b=mesh.indices[j+1],c=mesh.indices[j+2];if([a,b,c].every(i=>mesh.base[i*2+1]<250))upper.push([a,b,c]);
    for(const mask of mesh.masks)if([a,b,c].every(i=>mask[i]===1))rigidEdges.push([a,b,Math.hypot(mesh.base[a*2]-mesh.base[b*2],mesh.base[a*2+1]-mesh.base[b*2+1])]);}
   // The broad ellipse also contains the raised palm (alert) or clasped fingers
   // (pat). Audit the same painted eye/mouth patch as the pixel-identity test.
   for(let i=0;i<mesh.base.length/2;i++)if(Math.abs(mesh.base[i*2]-face[0])<30&&Math.abs(mesh.base[i*2+1]-face[1])<15)locked.push(i);
   let folds=0,rigidError=0,faceMovement=0,maxSwing=0,steps=0,maxRight=-Infinity,maxLeft=Infinity;
   const keyframes=[];
   const [sx,sy,w,h]=rect,ox=(380-w)/2+66,oy=370.5-h+66;
   for(let frame=0;frame<=Math.ceil(seconds*60);frame++){
    if(action==='drag'){const phase=frame%360;model.drag(phase<100?3200:phase<200?-3200:0);}
    const f=model.step(1/60);maxSwing=Math.max(maxSwing,Math.abs(model.swing));rig.art.mesh.render(action,rect,f);steps++;
    if(action==='drag'){
     if(model.swing>maxRight){maxRight=model.swing;keyframes[0]=structuredClone(f);}
     if(model.swing<maxLeft){maxLeft=model.swing;keyframes[1]=structuredClone(f);}
     if(frame===Math.ceil(seconds*60))keyframes[2]=structuredClone(f);
    }
    for(const[a,b,c]of upper){const v=mesh.vertices,area=(v[b*4]-v[a*4])*(v[c*4+1]-v[a*4+1])-(v[b*4+1]-v[a*4+1])*(v[c*4]-v[a*4]);if(area<=0)folds++;}
    for(const[a,b,length]of rigidEdges){const v=mesh.vertices;rigidError=Math.max(rigidError,Math.abs(Math.hypot(v[a*4]-v[b*4],v[a*4+1]-v[b*4+1])/length-1));}
    for(const i of locked)faceMovement=Math.max(faceMovement,Math.abs(mesh.vertices[i*4]-mesh.base[i*2]-ox),Math.abs(mesh.vertices[i*4+1]-mesh.base[i*2+1]-oy));
   }
   if(action==='drag'){model.play('pat');keyframes[3]=model.step(.08);captures.push({action,frames:keyframes});}
   else if(['alert','comfort','profit'].includes(action)){
    const times={alert:[.02,.1,.19,.28],comfort:[0,.4,.8,4.6],profit:[.08,.5,.96,1.55]}[action];
    captures.push({action,frames:times.map(t=>{const m=new WhaleMotion.Motion();m.play(action);m.t=t;return m.step(0);})});
   }
   result.push({action,steps,folds,rigidError,faceMovement,maxSwing,lockedVertices:locked.length});
  }
  for(const capture of captures){
   const sheet=document.createElement('canvas');sheet.id='cycle-'+capture.action;sheet.width=1440;sheet.height=390;document.body.append(sheet);const c=sheet.getContext('2d');c.fillStyle='#edf3fa';c.fillRect(0,0,sheet.width,sheet.height);
   capture.frames.forEach((frame,index)=>{rig.draw(frame);c.fillStyle='#253b5a';c.font='18px system-ui';c.fillText(`${capture.action} · ${index+1} · ${frame.time.toFixed(2)}s`,index*360+12,26);c.drawImage(canvas,256,410,512,512,index*360+5,35,350,350);});
  }
  rig.destroy();return result;
 });
 for(const action of ['alert','comfort','profit','drag'])await page.locator('#cycle-'+action).screenshot({path:path.join(output,'full-cycle-'+action+'.png')});
 await page.close();await fs.writeFile(path.join(output,process.env.MOTION_STRESS_GEOMETRY_ONLY?'geometry-report.json':'report.json'),JSON.stringify({sourceHash,reports,full,errors},null,2));
 assert.deepEqual(errors,[]);
 for(const frame of full){assert.equal(frame.folds,0,frame.action+' has no upper-body folds through its whole action');assert.ok(frame.rigidError<.00002,frame.action+' keeps rigid hand/paper shape');assert.ok(frame.faceMovement<.0001,frame.action+' protects painted face');}
 console.log(JSON.stringify({full,errors},null,2));
}finally{await browser.close();}
