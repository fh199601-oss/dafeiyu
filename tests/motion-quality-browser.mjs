import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';
const out=path.resolve('test-results/motion-quality');await fs.mkdir(out,{recursive:true});
const label=process.env.MOTION_CAPTURE_LABEL||'current';
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1110},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.setContent('<body style="margin:0;background:#f1f5fa"><canvas id="sheet" width="1440" height="1110"></canvas></body>');
for(const file of ['core.js','sprite.js','original-art-data.js','original-mesh.js','motion.js','rig.js'])await page.addScriptTag({path:path.resolve('extension',file)});
await page.evaluate(()=>{globalThis.CurrentMesh=WhaleOriginalMesh;});
let baselineAvailable=false;
try{await fs.access(path.resolve('dist/trench-whale-v0.4.3/extension/original-mesh.js'));await page.addScriptTag({path:path.resolve('dist/trench-whale-v0.4.3/extension/original-mesh.js')});baselineAvailable=true;}catch{}
await page.evaluate(has=>{globalThis.BaselineMesh=has?WhaleOriginalMesh:null;globalThis.WhaleOriginalMesh=CurrentMesh;},baselineAvailable);
const data=await page.evaluate(async()=>{
const texture='data:image/png;base64,'+WhaleOriginalArtData;const buffer=document.createElement('canvas');buffer.width=1024;buffer.height=1126;
const rig=WhaleRig.create(buffer,texture);await rig.ready;const c=document.querySelector('#sheet').getContext('2d');c.fillStyle='#f1f5fa';c.fillRect(0,0,1440,1110);const phases=[0,.12,.24,.36,.52,.8],reports=[];
for(const [row,action] of ['alert','drag','comfort'].entries()){
  for(const [column,t] of phases.entries()){
    const model=new WhaleMotion.Motion();model.play(action);model.t=t;model.clock=t;model.swing=.65*Math.sin(t*7);const f=model.step(0);
    rig.draw(f);c.fillStyle='#253b5a';c.font='16px sans-serif';c.fillText(`${action} · ${t.toFixed(2)}s`,column*240+18,row*370+30);
    c.fillStyle='white';c.fillRect(column*240+8,row*370+45,224,305);c.drawImage(buffer,240,380,550,560,column*240+8,row*370+60,224,228);
    const mesh=rig.art.mesh.cache.get(action);let inverted=0,upperInverted=0,upperFolds=[],minRatio=1,maxRatio=1,rigidError=0;
    if(mesh)for(let j=0;j<mesh.indices.length;j+=3){const ids=[mesh.indices[j],mesh.indices[j+1],mesh.indices[j+2]],pt=ids.map(i=>[mesh.vertices[i*4],mesh.vertices[i*4+1]]),base=ids.map(i=>[mesh.base[i*2],mesh.base[i*2+1]]);const area=p=>(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);const ratio=area(pt)/area(base);if(ratio<=0){inverted++;if(base.every(p=>p[1]<250)){upperInverted++;upperFolds.push(base);}}minRatio=Math.min(minRatio,ratio);maxRatio=Math.max(maxRatio,ratio);}
    if(mesh?.masks)for(const mask of mesh.masks)for(let j=0;j<mesh.indices.length;j+=3){const ids=[mesh.indices[j],mesh.indices[j+1],mesh.indices[j+2]];if(!ids.every(i=>mask[i]===1))continue;for(let edge=0;edge<3;edge++){const a=ids[edge],b=ids[(edge+1)%3],length=Math.hypot(mesh.base[a*2]-mesh.base[b*2],mesh.base[a*2+1]-mesh.base[b*2+1]),actual=Math.hypot(mesh.vertices[a*4]-mesh.vertices[b*4],mesh.vertices[a*4+1]-mesh.vertices[b*4+1]);rigidError=Math.max(rigidError,Math.abs(actual/length-1));}}
    reports.push({action,t,inverted,upperInverted,upperFolds,minRatio,maxRatio,rigidError});
  }
}
const cycle=[];const previous=BaselineMesh?new BaselineMesh.Mesh(rig.art.image):null;
for(const action of ['alert','drag','comfort','pat','buy','profit'])for(let k=0;k<=36;k++){
 const model=new WhaleMotion.Motion();model.play(action);model.t=k/30;model.clock=k/30;model.swing=.65*Math.sin(k/30*7);const f=model.step(0),rect=WhaleSprite.rects[TrenchCore.ACTIONS[action].index];
 rig.art.mesh.render(action,rect,f);previous?.render(action,rect,f);
 const mesh=rig.art.mesh.cache.get(action),old=previous?.cache.get(action);let upperFolds=0,rigidError=0,oldRigidError=0,rigidEdges=0;
 for(let j=0;j<mesh.indices.length;j+=3){const ids=[mesh.indices[j],mesh.indices[j+1],mesh.indices[j+2]],base=ids.map(i=>[mesh.base[i*2],mesh.base[i*2+1]]),pt=ids.map(i=>[mesh.vertices[i*4],mesh.vertices[i*4+1]]);const area=p=>(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);if(base.every(p=>p[1]<250)&&area(pt)<=0)upperFolds++;
 for(const mask of mesh.masks){if(!ids.every(i=>mask[i]===1))continue;for(let edge=0;edge<3;edge++){const a=ids[edge],b=ids[(edge+1)%3],length=Math.hypot(mesh.base[a*2]-mesh.base[b*2],mesh.base[a*2+1]-mesh.base[b*2+1]);const error=m=>Math.abs(Math.hypot(m.vertices[a*4]-m.vertices[b*4],m.vertices[a*4+1]-m.vertices[b*4+1])/length-1);rigidError=Math.max(rigidError,error(mesh));if(old)oldRigidError=Math.max(oldRigidError,error(old));rigidEdges++;}}}
 cycle.push({action,time:k/30,upperFolds,rigidError,oldRigidError,rigidEdges});
}
let normalDragDifference=0;
if(previous)for(const [left,right]of [[-.4,-.3],[-.2,.2],[0,.1],[.3,.4]]){
 const model=new WhaleMotion.Motion();model.play('drag');const f=model.step(0);f.legL=left;f.legR=right;
 const rect=WhaleSprite.rects[TrenchCore.ACTIONS.drag.index];previous.render('drag',rect,f);rig.art.mesh.render('drag',rect,f);
 const current=rig.art.mesh.cache.get('drag'),old=previous.cache.get('drag');
 for(let i=0;i<current.base.length/2;i++)if(current.base[i*2+1]>255)for(let axis=0;axis<2;axis++)normalDragDifference=Math.max(normalDragDifference,Math.abs(current.vertices[i*4+axis]-old.vertices[i*4+axis]));
}
const closeups=document.createElement('canvas');closeups.id='hand-comparison';closeups.width=1320;closeups.height=900;document.body.append(closeups);const detail=closeups.getContext('2d');detail.fillStyle='#f1f5fa';detail.fillRect(0,0,1320,900);
const crops={alert:[10,148,218,100,.24],drag:[65,170,170,80,.36],comfort:[6,210,140,84,.8]};
for(const [row,action] of ['alert','drag','comfort'].entries()){
 const [cx,cy,cw,ch,t]=crops[action],model=new WhaleMotion.Motion();model.play(action);model.t=t;model.clock=t;const f=model.step(0),rect=WhaleSprite.rects[TrenchCore.ACTIONS[action].index],[sx,sy,w,h]=rect;
 for(const [column,mesh]of [previous,rig.art.mesh].entries()){
  if(!mesh)continue;mesh.render(action,rect,f);detail.fillStyle='#253b5a';detail.font='20px sans-serif';detail.fillText((column?'修正后 · ':'之前 · ')+action,column*660+24,row*300+36);detail.fillStyle='white';detail.fillRect(column*660+15,row*300+50,630,235);
  const scale=Math.min(2.4,580/cw,210/ch);detail.drawImage(mesh.canvas,66+(380-w)/2+cx,66+370.5-h+cy,cw,ch,column*660+35,row*300+60,cw*scale,ch*scale);
 }
}
rig.destroy();return {reports,cycle,normalDragDifference};
});
await page.locator('#sheet').screenshot({path:path.join(out,label+'-keyframes.png')});await page.locator('#hand-comparison').screenshot({path:path.join(out,label+'-hands-before-after.png')});await fs.writeFile(path.join(out,label+'-geometry.json'),JSON.stringify({...data,errors},null,2));console.log(JSON.stringify({label,frames:data.reports.length,sampledFrames:data.cycle.length,upperFolds:data.cycle.reduce((n,r)=>n+r.upperFolds,0),rigidError:Math.max(...data.cycle.map(r=>r.rigidError)),legacyRigidError:Math.max(...data.cycle.map(r=>r.oldRigidError)),pageErrors:errors},null,2));assert.equal(errors.length,0,'Renderer has no page errors');
assert.equal(data.cycle.length,222,'Six actions sampled across complete arm cycles');
assert.equal(data.normalDragDifference,0,'Normal short-drag leg geometry remains identical to the previous version');
for(const frame of data.cycle){assert.equal(frame.upperFolds,0,frame.action+' upper-body triangles must never turn inside out at '+frame.time);assert(frame.rigidEdges>20,frame.action+' has a measurable rigid palm/paper region');assert(frame.rigidError<.00002,frame.action+' painted hand and paper must retain their shape');}
await browser.close();
