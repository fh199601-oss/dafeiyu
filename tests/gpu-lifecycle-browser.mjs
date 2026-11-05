import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('test-results/gpu-lifecycle');await fs.mkdir(output,{recursive:true});
// A low real browser context limit makes leaks fail quickly, rather than
// depending on garbage collection or the number of GMGN tabs already open.
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--max-active-webgl-contexts=4']});
const errors=[],warnings=[],passes=[];let completed=false,failure='';
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(['warning','error'].includes(m.type()))warnings.push(m.text());});
 await page.setContent('<!doctype html><title>GPU lifecycle fixture</title>');
 for(const file of ['core.js','sprite.js','original-art-data.js','original-mesh.js','motion.js','rig.js'])await page.addScriptTag({path:path.resolve('extension',file)});
 const result=await page.evaluate(async()=>{
  const results=[],held=[],url='data:image/png;base64,'+WhaleOriginalArtData;
  const create=()=>{const c=document.createElement('canvas');c.width=1024;c.height=1126;const r=WhaleRig.create(c,url);r.schedule=()=>{};held.push(r);return r;};
  const ok=(value,label)=>{if(!value)throw Error(label);results.push(label);};
  const chart=document.createElement('canvas').getContext('webgl');
  let a=create();await a.ready;let gl=a.art.mesh.gl;a.destroy();a.destroy();
  ok(gl.isContextLost()&&a.art===null,'Destroy releases the actual WebGL context immediately and is idempotent');

  a=create();const b=create();await Promise.all([a.ready,b.ready]);gl=a.art.mesh.gl;
  ok(gl===b.art.mesh.gl,'Two previews share one GPU context');
  a.destroy();b.play('alert');ok(!gl.isContextLost()&&b.canvas.dataset.renderer==='original-mesh','Destroying one preview preserves the other preview');
  b.destroy();ok(gl.isContextLost(),'The last preview releases the shared GPU context');

  const original=HTMLCanvasElement.prototype.getContext;let allocated=0;
  HTMLCanvasElement.prototype.getContext=function(type,...args){if(type==='webgl')allocated++;return original.call(this,type,...args);};
  a=create();a.destroy();await a.ready;
  ok(allocated===0,'Destroying before the image finishes loading never creates a delayed GPU context');
  a=create();a.configure({size:180,enabled:false,reduced:false});await a.ready;
  ok(allocated===0&&a.art.mesh===null,'A background pet loads its image without allocating WebGL');
  a.configure({size:180,enabled:true,reduced:false});gl=a.art.mesh.gl;
  a.configure({size:180,enabled:false,reduced:false});
  ok(gl.isContextLost()&&a.art.mesh===null,'Hiding the last active pet releases its GPU resources');
  a.configure({size:180,enabled:true,reduced:false});a.play('alert');
  ok(a.art.mesh.available&&a.canvas.dataset.renderer==='original-mesh','Returning to the page recreates the renderer and resumes the original animation');
  gl=a.art.mesh.gl;a.configure({size:180,enabled:true,reduced:true});
  ok(gl.isContextLost()&&a.art.mesh===null&&a.canvas.dataset.renderer==='original-static','Reduced motion uses the original image without keeping a GPU context');
  a.destroy();HTMLCanvasElement.prototype.getContext=original;

  a=create();const c=create();await Promise.all([a.ready,c.ready]);gl=a.art.mesh.gl;
  a.configure({size:180,enabled:false,reduced:false});
  ok(!gl.isContextLost(),'Pausing one consumer cannot release a context still used by another');
  c.configure({size:180,enabled:false,reduced:false});ok(gl.isContextLost(),'Pausing every consumer releases their shared context');
  a.destroy();c.destroy();

  for(let i=0;i<40;i++){
   const rig=create();await rig.ready;const context=rig.art.mesh.gl;
   rig.play('comfort');if(rig.canvas.dataset.renderer!=='original-mesh')throw Error('Animation was lost during repeated creation');
   rig.destroy();if(!context.isContextLost())throw Error('GPU retained after cycle '+i);
  }
  ok(!chart.isContextLost(),'Forty create/destroy cycles keep the website chart context intact');
  globalThis.gpuHeld=held;globalThis.gpuChart=chart;globalThis.gpuUrl=url;
  return results;
 });passes.push(...result);for(const line of result)console.log('PASS '+line);

 // Reinjecting rig.js creates a new module scope. The old instance must still
 // dispose its old pool, even when old JS objects remain strongly referenced.
 for(let i=0;i<20;i++){
  await page.evaluate(async()=>{const r=WhaleRig.create(document.createElement('canvas'),gpuUrl);r.schedule=()=>{};await r.ready;globalThis.previousRig=r;gpuHeld.push(r);});
  await page.addScriptTag({path:path.resolve('extension/rig.js')});
  assert.equal(await page.evaluate(()=>{const gl=previousRig.art.mesh.gl;previousRig.destroy();return gl.isContextLost()&&!gpuChart.isContextLost();}),true);
 }
 passes.push('Twenty script replacements release old pools even while references are retained');
 console.log('PASS '+passes.at(-1));
 await page.waitForTimeout(250);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);completed=true;
}catch(error){failure=error.stack||String(error);throw error;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify({completed,passes,errors,warnings,failure,realWebGL:true,contextLimit:4},null,2));await browser.close();}
