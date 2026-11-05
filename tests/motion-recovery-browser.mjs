import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('test-results/motion-stress');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[],reports=[];
try{
 for(const dpr of [1,2]){
  const page=await browser.newPage({viewport:{width:1120,height:850},deviceScaleFactor:dpr});page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<body style="margin:0;background:#edf3fa;color:#253b5a;font:16px system-ui"><h2 style="margin:20px">欢呼只跳跃，不拉伸手掌与原脸</h2><main style="display:grid;grid-template-columns:repeat(3,350px);gap:12px;margin:20px"></main></body>');
  for(const file of ['core.js','sprite.js','original-art-data.js','original-mesh.js','motion.js','rig.js'])await page.addScriptTag({path:path.resolve('extension',file)});
  const result=await page.evaluate(async()=>{
   const rigs=[],sizes=[100,205,280];
   for(const old of [true,false])for(const size of sizes){
    const card=document.createElement('section');card.style.cssText='height:350px;background:white;border-radius:18px;overflow:hidden';
    card.innerHTML=`<div style="padding:15px">${old?'之前：整体挤压':'修正：保持比例'} · ${size}px</div><div style="position:relative;width:${size}px;height:${size}px;margin:5px auto"></div>`;document.querySelector('main').append(card);
    const canvas=document.createElement('canvas');canvas.style.cssText='position:absolute;width:200%;height:219.921875%;left:-50%;top:-80.078125%';card.lastElementChild.append(canvas);
    const rig=WhaleRig.create(canvas,'data:image/png;base64,'+WhaleOriginalArtData);rig.schedule=()=>{};await rig.ready;rig.configure({size,enabled:true,reduced:false});
    const model=new WhaleMotion.Motion();model.play('profit');model.t=.08;const frame=model.step(0);
    if(old){frame.sx=1.09;frame.sy=.91;frame.bodyY=0;}rig.draw(frame);rigs.push(rig);
   }
   globalThis.recoveryRigs=rigs;return rigs.map(rig=>({canvas:[rig.canvas.width,rig.canvas.height],sx:rig.state.sx,sy:rig.state.sy}));
  });
  await page.screenshot({path:path.join(output,`celebration-proportions-dpr-${dpr}.png`)});reports.push({dpr,sizes:result});
  for(const frame of result.slice(3)){assert.equal(frame.sx,1);assert.equal(frame.sy,1);}
  await page.evaluate(()=>{
   globalThis.testRig=recoveryRigs.at(-1);const m=new WhaleMotion.Motion();m.play('alert');m.t=.37;globalThis.fixedFrame=m.step(0);testRig.draw(fixedFrame);
   globalThis.originalPixels=testRig.ctx.getImageData(0,0,testRig.canvas.width,testRig.canvas.height).data;
   globalThis.loss=testRig.art.mesh.gl.getExtension('WEBGL_lose_context');if(!loss)throw Error('Context-loss fixture extension unavailable');loss.loseContext();
  });
  await page.waitForFunction(()=>!testRig.art.mesh.available);
  await page.evaluate(()=>testRig.draw(fixedFrame));assert.equal(await page.evaluate(()=>testRig.canvas.dataset.renderer),'original-static');
  await page.waitForTimeout(100);await page.evaluate(()=>loss.restoreContext());await page.waitForFunction(()=>testRig.art.mesh.available);
  const restored=await page.evaluate(()=>{
   testRig.draw(fixedFrame);const pixels=testRig.ctx.getImageData(0,0,testRig.canvas.width,testRig.canvas.height).data;let changed=0,maxDelta=0;for(let i=0;i<pixels.length;i++)if(pixels[i]!==originalPixels[i]){changed++;maxDelta=Math.max(maxDelta,Math.abs(pixels[i]-originalPixels[i]));}
   const renderer=testRig.canvas.dataset.renderer;recoveryRigs.forEach(rig=>rig.destroy());return{changed,maxDelta,renderer,channels:pixels.length};
  });
  // ANGLE may round a few interpolated channels by 1/255 after context restore.
  // Larger pixel changes or a changed silhouette are not accepted.
  assert.ok(restored.maxDelta<=1,'GPU restoration keeps the same pose within one color quantization step');assert.ok(restored.changed/restored.channels<.001,'Restoration cannot shift or reshape the character');assert.equal(restored.renderer,'original-mesh');reports.at(-1).restored=restored;
  await page.close();
 }
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'recovery-report.json'),JSON.stringify({reports,errors},null,2));console.log(JSON.stringify({reports,errors},null,2));
}finally{await browser.close();}
