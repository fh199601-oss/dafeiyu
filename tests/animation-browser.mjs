import {chromium,expect}from'@playwright/test';
import {pathToFileURL}from'node:url';
import fs from'node:fs';
import path from'node:path';
import {PNG}from'pngjs';
const output=path.resolve('test-results/v02');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1000,height:850}});
const page=await context.newPage(),errors=[],steps=[];page.on('pageerror',e=>errors.push(e.message));
const log=s=>{steps.push(s);console.log('PASS '+s);};
const state=()=>page.evaluate(()=>window.testPet.inspect());
const play=a=>page.evaluate(a=>window.testPet.play(a,{silent:true}),a);
const image=async(name)=>{const b=await page.locator('.pet').screenshot();fs.writeFileSync(path.join(output,name+'.png'),b);return PNG.sync.read(b);};
function difference(a,b,region=[0,0,1,1]){let count=0;for(let y=Math.floor(a.height*region[1]);y<Math.floor(a.height*region[3]);y++)for(let x=Math.floor(a.width*region[0]);x<Math.floor(a.width*region[2]);x++){const i=(y*a.width+x)*4;if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>20)count++;}return count;}
try{
 // A renderer-only page avoids leaving the real home's timers and callbacks
 // attached after replacing its body with the animation fixture.
 const fixture=path.join(output,'animation-fixture.html'),base=pathToFileURL(path.resolve('extension')+path.sep).href;
 const dependencies=['core.js','preview-bridge.js','sprite.js','original-art-data.js','original-mesh.js','click-audio.js','motion.js','rig.js','finance-core.js','pet.js'];
 fs.writeFileSync(fixture,`<!doctype html><meta charset="utf-8"><base href="${base}"><body style="margin:0">${dependencies.map(file=>`<script src="${file}"></script>`).join('')}</body>`);
 await page.goto(pathToFileURL(fixture).href);
 await page.evaluate(()=>{
  document.body.innerHTML='<div id="stage" style="position:relative;width:1000px;height:850px;background:#edf3fa"></div>';
  window.testPet=TrenchPet.mount({container:document.querySelector('#stage'),preview:true,settings:{size:280,energy:'quiet'}});
 });await page.waitForSelector('.rig-canvas[data-ready="true"]');await page.evaluate(()=>testPet.ready);
 expect((await state()).mesh).toBe(true);
 expect((await state()).art).toBe('original-v01');
 const hit=page.locator('.hit');let box=await hit.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height*.18);await page.mouse.down();
 for(let i=1;i<=16;i++){await page.mouse.move(box.x+box.width/2+i*8,box.y+box.height*.18);await page.waitForTimeout(18);}
 let f=await state();expect(f.eyes).toBe('fear');expect((f.legL+f.legR)/2).toBeGreaterThan(.25);await image('drag-right');
 for(let i=1;i<=24;i++){await page.mouse.move(box.x+box.width/2+128-i*8,box.y+box.height*.18);await page.waitForTimeout(18);}
 f=await state();expect((f.legL+f.legR)/2).toBeLessThan(-.25);await image('drag-left');
 const hands1=f;await page.waitForTimeout(140);const hands2=await state();expect(Math.abs(hands2.armL-hands1.armL)+Math.abs(hands2.armR-hands1.armR)).toBeGreaterThan(.3);
 await page.mouse.up();log('Real mouse drag drives opposite leg inertia, flailing arms and >< eyes');
 await play('idle');await hit.click();await expect(page.locator('.rig-canvas')).toHaveAttribute('data-audio','played');
 expect((await state()).audioDuration).toBeCloseTo(.34,2);expect((await state()).audioPlays).toBe(1);expect((await state()).action).toBe('pat');
 const bounce1=await state();await page.waitForTimeout(130);const bounce2=await state();expect(bounce1.sy).not.toEqual(bounce2.sy);
 await page.evaluate(()=>testPet.update({size:280,energy:'quiet',interactionSound:false}));const count=(await state()).audioPlays;
 await hit.click();await page.waitForTimeout(200);expect((await state()).audioPlays).toBe(count);
 log('One click plays one 0.34 s clean reference chirp with squash/rebound; mute prevents playback');
 await play('alert');await page.waitForTimeout(90);const run1=await image('run-a');f=await state();expect(f.legL*f.legR).toBeLessThan(0);expect(f.armL*f.legL).toBeLessThan(0);
 await page.waitForTimeout(190);const run2=await image('run-b');expect(difference(run1,run2,[.27,.8,.75,1])).toBeGreaterThan(50);log('Rendered running feet change, with opposing arm and leg cycles');
 await play('sleep');await page.waitForTimeout(350);const z1=await image('sleep-a');expect((await state()).zz).toBe(3);await page.waitForTimeout(420);const z2=await image('sleep-b');expect(difference(z1,z2,[.67,0,1,.38])).toBeGreaterThan(15);log('Sleep emits separately moving Z characters');
 await play('news');await page.waitForTimeout(130);const reading1=await image('read-a'),read1=await state();await page.waitForTimeout(800);const reading2=await image('read-b'),read2=await state();
 expect(read2.gazeX-read1.gazeX).toBeGreaterThan(6);expect(read2.headY).toBe(read1.headY);expect(difference(reading1,reading2,[.32,.38,.67,.52])).toBeGreaterThan(15);log('Reading changes rendered pupils while head stays in place');
 await play('peek');await page.waitForTimeout(70);const peek1=await image('peek-a');await page.waitForTimeout(850);const peek2=await image('peek-b');
 expect(difference(peek1,peek2,[.77,.17,.98,.92])).toBe(0);expect(difference(peek1,peek2,[.35,.1,.72,.65])).toBeGreaterThan(200);log('Head emerges from behind a pixel-stationary wall');
 await play('comfort');await page.waitForTimeout(60);const comfort1=await image('comfort-a');await page.waitForTimeout(850);const comfort2=await image('comfort-b');
 expect((await state()).tissue).toBe(1);expect(difference(comfort1,comfort2,[.05,.5,.45,.85])).toBeGreaterThan(100);log('Original comfort arm extends with its original tissue');
 await play('profit');await page.waitForTimeout(420);f=await state();expect(f.bodyY).toBeLessThan(-35);expect(f.armL).toBeGreaterThan(2);expect(f.particles).toBeGreaterThan(20);await page.screenshot({path:path.join(output,'celebration.png')});log('Celebration jumps, raises both hands, and launches falling confetti');
 await page.evaluate(()=>testPet.update({size:280,energy:'quiet',reducedMotion:true}));const frame=(await state()).frame;await page.waitForTimeout(300);expect((await state()).frame).toBe(frame);log('Reduced motion cancels the frame loop');
 await page.evaluate(()=>testPet.update({size:280,energy:'quiet'}));await play('idle');await page.waitForTimeout(100);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
 const paused=(await state()).frame;await page.waitForTimeout(220);expect((await state()).frame).toBe(paused);
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(120);expect((await state()).frame).toBeGreaterThan(paused);log('Hidden document actually stops rendering and resumes safely');
 await page.evaluate(()=>testPet.destroy());const destroyed=(await state()).frame;await page.waitForTimeout(150);expect((await state()).frame).toBe(destroyed);log('Destroy releases the animation loop');
 expect(errors).toEqual([]);fs.writeFileSync(path.join(output,'animation-report.json'),JSON.stringify({passed:steps.length,steps,pageErrors:errors,testedAt:new Date().toISOString()},null,2));
}finally{await context.close();await browser.close();}
