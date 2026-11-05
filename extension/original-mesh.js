/* Deform the approved v0.1 artwork in place. No generated replacement body or face. */
(function(root){
 'use strict';
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const poses={
  idle:{face:[135,175,58,32],eyes:[[103,164,22,12],[168,170,22,12]],tail:[208,307,288,270,36],hair:[151,43,112,15,30]},
  sleep:{face:[145,156,58,30]},
  pat:{face:[148,178,58,32],arms:[[119,241,135,217,22],[178,242,157,217,22]],legs:[[113,328,110,350,22],[160,330,159,351,22]]},
  buy:{face:[151,179,58,35],arms:[[101,245,77,225,23],[184,242,189,224,23]],legs:[[100,323,84,346,23],[184,325,198,345,23]]},
  profit:{face:[142,158,60,32],arms:[[91,191,45,149,24],[185,199,234,172,24]],legs:[[115,285,134,318,23],[161,278,176,298,23]]},
  close:{face:[151,165,58,29],arms:[[134,202,120,218,21],[209,193,225,210,21]]},
  comfort:{face:[146,166,58,32],tissue:[132,215,65,238,42]},
  pout:{face:[145,171,58,32],legs:[[102,313,93,331,20],[179,314,185,333,20]]},
  alert:{face:[88,154,54,34],arms:[[74,189,39,172,23],[154,205,190,206,23]],legs:[[115,273,77,310,26],[162,271,165,289,22]]},
  news:{face:[143,156,58,28],eyes:[[111,160,16,15],[173,158,16,15]]},
  drag:{face:[145,151,58,30],eyes:[[112,149,19,17],[175,141,19,17]],arms:[[116,199,93,198,24],[187,194,205,195,24]],legs:[[122,265,128,304,23],[167,264,168,300,23]]},
  peek:{face:[158,155,58,34]}
 };
 // Preserve a whole hand/cuff (and the whole paper) as one rigid piece. The
 // previous radial brush blended THROUGH the palm, shrinking fingers whenever
 // it rotated. These masks blend only outside the painted limb, at the shoulder
 // and adjacent hair. The image itself is never replaced or repainted.
 const rigidParts={
  alert:[
   {name:'left-hand',pivot:[84,203],feather:25,polygon:[[22,159],[48,157],[57,174],[56,194],[72,198],[87,204],[85,218],[61,222],[32,212],[20,191]]},
   {name:'right-hand',pivot:[158,204],feather:24,polygon:[[169,187],[192,186],[209,192],[213,210],[204,222],[181,221],[165,212]]}
  ],
  drag:[
   {name:'left-hand',pivot:[119,201],feather:30,polygon:[[76,181],[89,175],[103,176],[112,187],[111,204],[100,215],[79,213],[72,201]]},
   {name:'right-hand',pivot:[181,198],feather:30,polygon:[[188,178],[202,174],[218,179],[225,192],[221,207],[207,216],[187,209],[181,195]]}
  ],
  comfort:[
   {name:'hand-and-tissue',pivot:[128,232],feather:28,polygon:[[73,215],[103,217],[119,227],[114,245],[91,254],[88,283],[17,277],[10,259],[40,238]]}
  ],
  pat:[
   {name:'clasped-hands',pivot:[148,250],feather:18,polygon:[[118,197],[158,195],[174,206],[178,226],[164,245],[140,251],[115,239],[110,216]]}
  ],
  buy:[
   {name:'left-hand',pivot:[101,245],feather:18,polygon:[[63,207],[84,204],[98,218],[97,238],[82,250],[62,242],[56,226]]},
   {name:'right-hand',pivot:[184,242],feather:18,polygon:[[177,205],[197,204],[211,215],[211,235],[199,248],[181,245],[171,228]]}
  ],
  profit:[
   {name:'left-hand',pivot:[91,191],feather:24,polygon:[[24,130],[44,125],[60,139],[70,160],[98,177],[105,196],[84,204],[61,184],[47,169],[27,160]]},
   {name:'right-hand',pivot:[185,199],feather:24,polygon:[[214,149],[238,149],[255,164],[249,184],[227,193],[205,209],[181,205],[179,186],[200,173]]}
  ]
 };
 function polygonField(x,y,points,feather){
  let inside=false,distance=Infinity;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
   const [ax,ay]=points[j],[bx,by]=points[i];
   if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
   const vx=bx-ax,vy=by-ay,u=clamp(((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy),0,1);
   distance=Math.min(distance,Math.hypot(x-ax-u*vx,y-ay-u*vy));
  }
  if(inside)return 1;
  const w=1-clamp(distance/feather,0,1);return w*w*(3-2*w);
 }
 function rigidFrames(action,f){
  const t=f.time;
  // Keep the near-cheek hand on the outside of the face. Crossing a locked face
  // with a flat painted sleeve produces a fold even when the palm itself is rigid.
  if(action==='alert')return [{a:(f.armL/1.15-1)*.16},{a:f.armR*.23}];
  if(action==='drag')return [{a:-.19*(1+Math.sin(t*22))},{a:.19*(1+Math.sin(t*24+1))}];
  if(action==='comfort')return [{a:f.tissue*.065,dx:-f.tissue*12,dy:-f.tissue*2}];
  if(action==='pat')return [{a:Math.sin(t*9)*.045*Math.exp(-t),dy:-Math.max(0,Math.sin(t*9))*2*Math.exp(-t)}];
  if(action==='buy')return [{a:Math.sin(t*8)*.14},{a:-Math.sin(t*8)*.14}];
  if(action==='profit')return [{a:Math.sin(t*6)*.10},{a:-Math.sin(t*6)*.10}];
  return [];
 }
 function bone(x,y,b,angle,dx=0,dy=0){
  const [px,py,tx,ty,r]=b,vx=tx-px,vy=ty-py;
  const u=clamp(((x-px)*vx+(y-py)*vy)/(vx*vx+vy*vy),0,1);
  const distance=Math.hypot(x-px-u*vx,y-py-u*vy);
  const weight=1-clamp((distance/r-.45)/.55,0,1);if(!weight)return [0,0];
  const ease=weight*weight*(3-2*weight),s=Math.sin(angle),c=Math.cos(angle);
  return [((x-px)*(c-1)-(y-py)*s+dx)*ease,((x-px)*s+(y-py)*(c-1)+dy)*ease];
 }
 function build(w,h,action){
  const nx=Math.ceil(w/5),ny=Math.ceil(h/5),base=[],indices=[];
  for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++)base.push(x*w/nx,y*h/ny);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=y*(nx+1)+x,b=a+1,d=a+nx+1,e=d+1;indices.push(a,b,e,a,e,d);}
  const masks=(rigidParts[action]||[]).map(part=>{
   const weights=new Float32Array(base.length/2),face=poses[action].face;
   for(let i=0;i<weights.length;i++){
    const x=base[i*2],y=base[i*2+1],weight=polygonField(x,y,part.polygon,part.feather);
    const distance=face?Math.pow((x-face[0])/face[2],2)+Math.pow((y-face[1])/face[3],2):Infinity;
    const fade=clamp((distance-1.03)/.65,0,1);
    // Taper the surrounding hair smoothly into the locked face. A hard cut in
    // displacement makes triangles fold at the cheek even with a rigid hand.
    weights[i]=weight===1?1:weight*fade*fade*(3-2*fade);
   }
   return weights;
  });
  return {base:new Float32Array(base),indices:new Uint16Array(indices),vertices:new Float32Array(base.length*2),masks};
 }
 function deformations(action,f){
  const p=poses[action],bones=[],t=f.time;
  const add=(b,a,dx=0,dy=0)=>b&&bones.push({b,a,dx,dy});
  if(action==='idle'){add(p.tail,f.tail*.55);add(p.hair,f.ahoge*.45);}
  if(action==='profit'){
   add(p.legs[0],f.legL*.6);add(p.legs[1],f.legR*.6);
  }
  if(action==='pout')add(p.legs[1],f.legR*.55,0,-Math.max(0,Math.sin(t*13))*3);
  return bones;
 }
 class Mesh{
  constructor(image){
   this.disposed=false;
   this.image=image;this.canvas=document.createElement('canvas');this.canvas.width=512;this.canvas.height=512;
   this.gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
   this.cache=new Map();this.available=!!this.gl;
   this.onLost=e=>{if(this.disposed)return;e.preventDefault();this.available=false;};
   this.onRestored=()=>{if(this.disposed)return;try{this.init();this.available=true;}catch{this.destroy();}};
   this.canvas.addEventListener('webglcontextlost',this.onLost);
   this.canvas.addEventListener('webglcontextrestored',this.onRestored);
   try{if(this.gl)this.init();}catch(error){this.destroy();throw error;}
  }
  destroy(){
   if(this.disposed)return;
   this.disposed=true;this.available=false;
   this.canvas.removeEventListener('webglcontextlost',this.onLost);
   this.canvas.removeEventListener('webglcontextrestored',this.onRestored);
   const gl=this.gl;
   if(gl&&!gl.isContextLost()){
    if(this.texture)gl.deleteTexture(this.texture);if(this.buffer)gl.deleteBuffer(this.buffer);
    if(this.elements)gl.deleteBuffer(this.elements);if(this.program)gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
   }
   this.texture=this.buffer=this.elements=this.program=null;this.gl=null;
   this.cache.clear();this.image=null;this.canvas.width=this.canvas.height=1;
  }
  init(){
   const gl=this.gl;
   function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
   const vs=shader(gl.VERTEX_SHADER,'attribute vec2 position; attribute vec2 uv; varying vec2 tex; void main(){gl_Position=vec4(position.x/256.0-1.0,1.0-position.y/256.0,0.0,1.0);tex=uv;}');
   const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT).precision?'highp':'mediump';
   const fs=shader(gl.FRAGMENT_SHADER,'precision '+precision+' float; varying vec2 tex; uniform sampler2D art; void main(){gl_FragColor=texture2D(art,tex);}');
   this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
   if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
   gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(this.program);
   this.buffer=gl.createBuffer();this.elements=gl.createBuffer();
   this.position=gl.getAttribLocation(this.program,'position');this.uv=gl.getAttribLocation(this.program,'uv');
   this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.image);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  }
  render(action,rect,f,neutral=false){
   const gl=this.gl;if(this.disposed||!this.available||gl.isContextLost())return null;
   const [sx,sy,w,h]=rect;
   if(!this.cache.has(action))this.cache.set(action,build(w,h,action));const mesh=this.cache.get(action);
   const p=poses[action],bones=neutral?[]:deformations(action,f),offsetX=(380-w)/2,offsetY=370.5-h;
   const parts=neutral?[]:rigidFrames(action,f).map((frame,i)=>({...frame,part:rigidParts[action][i],sn:Math.sin(frame.a),cs:Math.cos(frame.a),weights:mesh.masks[i]}));
   for(let i=0;i<mesh.base.length;i+=2){
    const x=mesh.base[i],y=mesh.base[i+1];let dx=0,dy=0;
    const face=p.face,protect=face&&Math.pow((x-face[0])/face[2],2)+Math.pow((y-face[1])/face[3],2)<1.03;
    if(!protect)for(const b of bones){const delta=bone(x,y,b.b,b.a,b.dx,b.dy);dx+=delta[0];dy+=delta[1];}
    for(const r of parts){
     const weight=r.weights[i/2];if(!weight)continue;
     const [px,py]=r.part.pivot;
     dx+=((x-px)*(r.cs-1)-(y-py)*r.sn+(r.dx||0))*weight;
     dy+=((x-px)*r.sn+(y-py)*(r.cs-1)+(r.dy||0))*weight;
    }
    if(!neutral&&(action==='drag'||action==='alert')){
     // Below the hem each shoe moves as a rigid piece. Blend at the hip and
     // between the legs, rather than squeezing the shoe silhouette radially.
     const split=(p.legs[0][0]+p.legs[1][0])/2;
     for(let side=0;side<2;side++){
      const [px,py]=p.legs[side],rawAngle=(side?f.legR:f.legL)*(action==='drag'?.8:.5);
      // Preserve the normal drag arc exactly. Only extreme sustained/reversed
      // velocity tapers the rendered angle; the pendulum physics stays intact.
      const magnitude=Math.abs(rawAngle),angle=action==='drag'&&magnitude>.35?Math.sign(rawAngle)*(.35+.15*Math.tanh((magnitude-.35)/.15)):rawAngle;
      const vertical=clamp((y-py+6)/18,0,1),right=clamp((x-split+6)/12,0,1);
      const fade=clamp((p.legs[1][0]+85-x)/40,0,1);
      const weight=vertical*vertical*(3-2*vertical)*(side?right:1-right)*fade;
      const sn=Math.sin(angle),cs=Math.cos(angle);
      dx+=((x-px)*(cs-1)-(y-py)*sn)*weight;dy+=((x-px)*sn+(y-py)*(cs-1))*weight;
     }
    }
    if(action==='news'&&!neutral){
     for(const [ex,ey,rx,ry]of p.eyes){const d=Math.pow((x-ex)/rx,2)+Math.pow((y-ey)/ry,2);if(d<1){const weight=(1-d)*(1-d);dx+=f.gazeX*.27*weight;dy+=(f.gazeY-4)*.25*weight;}}
    }
    // Blink preserves the actual painted eye: compress its own pixels into the lid.
    if(action==='idle'&&f.blink&&!neutral){
     for(const [ex,ey,rx,ry]of p.eyes){const d=Math.pow((x-ex)/(rx+5),2)+Math.pow((y-ey)/(ry+7),2);if(d<1)dy-=(y-ey)*.82*Math.pow(1-d,.5);}
    }
    const out=i*2;mesh.vertices[out]=x+dx+offsetX+66;mesh.vertices[out+1]=y+dy+offsetY+66;
    mesh.vertices[out+2]=(sx+x)/this.image.width;mesh.vertices[out+3]=(sy+y)/this.image.height;
   }
   gl.viewport(0,0,512,512);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);
   gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.DYNAMIC_DRAW);
   gl.enableVertexAttribArray(this.position);gl.vertexAttribPointer(this.position,2,gl.FLOAT,false,16,0);
   gl.enableVertexAttribArray(this.uv);gl.vertexAttribPointer(this.uv,2,gl.FLOAT,false,16,8);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
   gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);return this.canvas;
  }
 }
 root.WhaleOriginalMesh={Mesh,poses,rigidParts};
})(globalThis);
