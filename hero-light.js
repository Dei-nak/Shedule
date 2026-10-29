(() => {
  const canvas = document.getElementById('hero-light');
  const host = canvas?.parentElement, header = host?.closest('.header');
  if (!canvas || !header) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) { host.dataset.renderer = 'fallback'; return; }
  const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.0,1.0);}`;
  const fragment = `
    precision mediump float;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float activity;
    uniform float time;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 uv=gl_FragCoord.xy/resolution;
      uv.y=1.0-uv.y;
      float aspect=resolution.x/resolution.y;
      vec2 p=vec2(uv.x*aspect,uv.y);
      vec2 mouse=vec2(pointer.x*aspect,pointer.y);
      float proximity=exp(-length((p-mouse)*vec2(.8,1.0))*2.5)*activity;
      float parallax=(pointer.x-.5)*.12*activity;
      float diagonal=p.x-.72*p.y;
      vec3 color=vec3(.026,.028,.032);
      float coverage=0.0;
      // Four restrained structural surfaces form the back layer.
      for(int i=0;i<4;i++){
        float layer=float(i);
        float drift=sin(time*.18+layer*1.8)*.022;
        float center=aspect*.48+layer*.34+parallax+drift;
        float d=diagonal-center;
        float wave=sin(p.y*2.6+time*.18+layer)*.009;
        d+=wave;
        float breadth=1.0+.035*sin(time*.20+layer);
        float face=smoothstep(-.24*breadth,-.21*breadth,d)*(1.0-smoothstep(.205*breadth,.22*breadth,d));
        float height=exp(-pow(abs((p.y-(.58-layer*.045))/.49),4.0));
        float lightCenter=.45+sin(time*.42+layer*.8)*.3+(pointer.y-.5)*activity*.22;
        float light=exp(-pow((p.y-lightCenter)/.35,2.0));
        float diffuse=exp(-pow(d/.2,2.0))*.14;
        float sheen=pow(smoothstep(-.22,.215,d),3.0)*face;
        float edge=exp(-abs(d-.211*breadth)*160.0);
        float halo=exp(-pow((d-.18)/.42,2.0))*.10;
        float exposure=(.66+.28*sin(time*.34+layer)+proximity*.85)*(1.0-layer*.045);
        float grain=hash(gl_FragCoord.xy+layer*13.0)-.5;
        float radiance=(diffuse+sheen*(.12+light*.34)+edge*(.11+light*.35)+halo)*height*exposure;
        color+=vec3(.96,.97,1.0)*max(0.0,radiance+grain*.052*face*height);
        coverage+=face*height*.9+halo*height*1.8;
      }
      // Two separate foreground surfaces overlap the back layer. Their scale
      // and opacity rise and fall together, instead of bending the base planes.
      for(int j=0;j<2;j++){
        float layer=float(j);
        float pulse=.5+.5*sin(time*.30+layer*2.8);
        float fade=pulse*pulse*(3.0-2.0*pulse);
        float scale=.60+.55*fade;
        float center=aspect*.58+layer*.40+parallax*.75+sin(time*.16+layer)*.014;
        float d=(diagonal-center)/scale;
        float face=smoothstep(-.17,-.15,d)*(1.0-smoothstep(.15,.17,d));
        float height=exp(-pow(abs((p.y-.50)/(.39*scale)),4.0));
        float edge=exp(-abs(d-.158)*145.0);
        float reflection=exp(-pow((p.y-(.40+.19*sin(time*.38+layer)))/.25,2.0));
        float alpha=face*height*fade*.55;
        vec3 surface=vec3(.07)+vec3(.86,.87,.89)*(pow(smoothstep(-.16,.16,d),2.0)*(.12+reflection*.24)+edge*.22+proximity*.08);
        color=mix(color,surface,alpha);
        color+=vec3(.96,.97,1.0)*edge*height*fade*.10;
        coverage=coverage+(1.0-coverage)*alpha;
      }
      float vignette=1.0-smoothstep(.25,.95,length((uv-vec2(.63,.5))*vec2(.7,1.0)));
      color*=.65+.35*vignette;
      // Leave the title area quiet while the reflections remain interactive.
      color*=.62+.38*smoothstep(.12,.5,uv.x);
      gl_FragColor=vec4(color,clamp(coverage,0.0,.97));
    }`;
  let program, uniforms, frame = 0, visible = true, lost = false, lastFrame = 0;
  const target = { x: .65, y: .45, activity: 0 }, current = { ...target };
  function shader(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function setup() {
    try {
      const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
      program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Light renderer unavailable');
      gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(program);
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      uniforms=Object.fromEntries(['resolution','pointer','activity','time'].map(name=>[name,gl.getUniformLocation(program,name)]));
      host.dataset.renderer='webgl';lost=false;resize();
    }catch(_){host.dataset.renderer='fallback';lost=true;}
  }
  function draw(now) {
    frame=0;
    if(lost)return;
    if(now-lastFrame>=30 || reduced.matches){
      lastFrame=now;
      const ease=reduced.matches?1:.045;
      for(const key of ['x','y','activity'])current[key]+=(target[key]-current[key])*ease;
      gl.useProgram(program);gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);
      gl.uniform2f(uniforms.pointer,current.x,current.y);
      gl.uniform1f(uniforms.activity,reduced.matches?0:current.activity);
      gl.uniform1f(uniforms.time,reduced.matches?0:now/1000);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
    if(visible&&!document.hidden&&!reduced.matches)frame=requestAnimationFrame(draw);
  }
  function restart(){if(frame)cancelAnimationFrame(frame);lastFrame=0;draw(performance.now());}
  function resize(){
    const bounds=header.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.max(1,Math.round(bounds.width*ratio));canvas.height=Math.max(1,Math.round(bounds.height*ratio));
    gl.viewport(0,0,canvas.width,canvas.height);restart();
  }
  header.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    const rect=header.getBoundingClientRect();target.x=(event.clientX-rect.left)/rect.width;target.y=(event.clientY-rect.top)/rect.height;target.activity=1;
  });
  header.addEventListener('pointerleave',()=>{target.activity=0;target.x=.65;target.y=.45;});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;if(frame)cancelAnimationFrame(frame);host.dataset.renderer='fallback';});
  canvas.addEventListener('webglcontextrestored',setup);
  new ResizeObserver(()=>{if(!lost&&program)resize();}).observe(header);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;restart();}).observe(header);
  document.addEventListener('visibilitychange',restart);reduced.addEventListener('change',restart);
  setup();
})();
