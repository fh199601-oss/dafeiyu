import {chromium,expect}from'@playwright/test';
import fs from'node:fs';import path from'node:path';import {createHash}from'node:crypto';import {pathToFileURL}from'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const original=fs.readFileSync('dist/trench-whale-v0.1.0/extension/assets/whale-poses.png');
const current=fs.readFileSync('extension/assets/whale-poses.png');
expect(sha(current)).toBe(sha(original));
for(const file of ['motion.js','original-mesh.js'])expect(sha(fs.readFileSync('extension/'+file))).toBe(sha(fs.readFileSync('dist/trench-whale-v0.5.17/extension/'+file)));
const wrapper=fs.readFileSync('extension/original-art-data.js','utf8').match(/WhaleOriginalArtData="([A-Za-z0-9+/=]+)"/)[1];expect(sha(Buffer.from(wrapper,'base64'))).toBe(sha(current));
const manifest=JSON.parse(fs.readFileSync('extension/manifest.json'));expect(manifest.content_scripts[0].js).not.toContain('rig-parts.js');expect(fs.existsSync('extension/assets/whale-rig.png')).toBe(false);
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:920,height:570}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(pathToFileURL(path.resolve('extension/home.html')).href);await page.waitForSelector('.rig-canvas[data-ready="true"]');
 const result=await page.evaluate(async()=>{
  const testCanvas=document.createElement('canvas');testCanvas.width=1024;testCanvas.height=1126;
  const testRig=WhaleRig.create(testCanvas,new URL('assets/whale-poses.png',document.baseURI).href);await testRig.ready;
  const baseline=document.createElement('canvas');baseline.width=1024;baseline.height=1126;const ctx=baseline.getContext('2d');
  const neutral=[];const faces=[];
  const image=testRig.art.image,mesh=testRig.art.mesh,model=new WhaleMotion.Motion();
  const copy=document.createElement('canvas');copy.width=380;copy.height=380;const dc=copy.getContext('2d');
  const pixels=()=>{dc.clearRect(0,0,380,380);dc.drawImage(mesh.canvas,66,66,380,380,0,0,380,380);return dc.getImageData(0,0,380,380).data;};
  for(const [action,info]of Object.entries(TrenchCore.ACTIONS)){
   model.play(action);const f=model.step(0);testRig.draw(f,true);const [x,y,w,h]=WhaleSprite.rects[info.index],s=512/380;
   ctx.clearRect(0,0,1024,1126);ctx.drawImage(image,x,y,w,h,256+(512-w*s)/2,410+499.2-h*s,w*s,h*s);
   const a=testCanvas.getContext('2d').getImageData(0,0,1024,1126).data,b=ctx.getImageData(0,0,1024,1126).data;let changed=0;
   for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;neutral.push({action,differentChannels:changed});
   if(action!=='news'){
    mesh.render(action,WhaleSprite.rects[info.index],f,true);const before=pixels();
    let animated;for(let i=0;i<12;i++)animated=model.step(.06);animated.blink=false;
    mesh.render(action,WhaleSprite.rects[info.index],animated);const after=pixels(),face=WhaleOriginalMesh.poses[action].face;
    const ox=(380-w)/2,oy=370.5-h;let altered=0;
    for(let py=Math.round(oy+face[1]-15);py<Math.round(oy+face[1]+15);py++)for(let px=Math.round(ox+face[0]-30);px<Math.round(ox+face[0]+30);px++){
     const index=(py*380+px)*4;for(let c=0;c<4;c++)if(before[index+c]!==after[index+c])altered++;
    }faces.push({action,differentChannels:altered});
   }
  }
  // Side by side is the original v0.1 at rest and the production renderer at rest.
  document.body.innerHTML='<main style="padding:34px;background:#f3f6fb;height:570px;font-family:Microsoft YaHei, sans-serif;color:#324864"><div style="font-size:22px;font-weight:600">同一张原图，只加动作</div><p style="color:#8394ab;font-size:12px">静止基准帧对照 · 角色源文件与 V0.1 完全相同</p><div style="display:flex;gap:22px;margin-top:24px"><section style="width:415px;background:white;border:1px solid #dce5f1;border-radius:20px;padding:20px;text-align:center"><b>V0.1 原始形象</b><div id="before" style="position:relative;width:280px;height:280px;margin:24px auto 0"></div></section><section style="width:415px;background:white;border:1px solid #dce5f1;border-radius:20px;padding:20px;text-align:center"><b>V0.2.1 恢复原形象</b><div id="after" style="position:relative;width:280px;height:280px;margin:24px auto 0"></div></section></div></main>';
  document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>link.remove());document.body.style.margin='0';
  const source=document.createElement('canvas');source.width=280;source.height=280;document.querySelector('#before').append(source);
  const [x,y,w,h]=WhaleSprite.rects[0],s=280/380;source.getContext('2d').drawImage(image,x,y,w,h,(280-w*s)/2,280*.975-h*s,w*s,h*s);
  const shown=document.createElement('canvas');shown.width=560;shown.height=Math.round(1126*280/512);shown.style.cssText='position:absolute;width:560px;height:615.78125px;left:-140px;top:-224.21875px';document.querySelector('#after').append(shown);
  const shownRig=WhaleRig.create(shown,new URL('assets/whale-poses.png',document.baseURI).href);await shownRig.ready;model.play('idle');shownRig.draw(model.step(0),true);
  testRig.destroy();return {neutral,faces};
 });
 for(const r of result.neutral)expect(r.differentChannels,`Original pixels ${r.action}`).toBe(0);
 for(const r of result.faces)expect(r.differentChannels,`Unchanged painted face ${r.action}`).toBe(0);
 await page.screenshot({path:'design/v0.2.1-原图对照.png'});
 expect(errors).toEqual([]);
 fs.writeFileSync('test-results/identity-report.json',JSON.stringify({sourceSha256:sha(current),...result,pageErrors:errors},null,2));
 console.log('PASS The full character atlas is byte-identical to v0.1, including the restored closed-eye pat expression. The preview wrapper and animation parameters are unchanged.');
 console.log(`PASS ${result.neutral.length} neutral poses match the approved atlas exactly; ${result.faces.length} animated face regions stay unchanged.`);
}finally{await browser.close();}
