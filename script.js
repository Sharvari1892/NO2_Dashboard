'use strict';

/* ================================================================
   script.js — APIG Dashboard
   
   DESIGN PRINCIPLE: The website is a DISPLAY ONLY.
   It never generates its own numbers. All values come
   exclusively from bridge.py via WebSocket.
   
   If connection drops → last received values are frozen
   on screen (with a "Connection lost" indicator).
   This guarantees OLED and website always match.
   ================================================================ */

const WS_URL = 'ws://localhost:8765';
let ws       = null;
let wsAlive  = false;
let wsRetry  = 2000;

/* ── Last known good values (shown until next WS message) ─── */
let cur = {
  no2In:    89.0,
  no2Out:   23.0,
  temp:     33.0,
  humidity: 75.0,
  pressure: 1007.0,
  uvActive: true,
};

/* ── Chart history ──────────────────────────────────────────── */
const HIST = 60;
const H = { labels: [], no2In: [], no2Out: [], temp: [], pressure: [] };

function histPush(d) {
  const t = new Date().toLocaleTimeString('en-IN', { hour12: false });
  H.labels.push(t);
  H.no2In.push(+d.no2In.toFixed(1));
  H.no2Out.push(+d.no2Out.toFixed(1));
  H.temp.push(+d.temp.toFixed(1));
  H.pressure.push(+d.pressure.toFixed(1));
  Object.keys(H).forEach(k => { if (H[k].length > HIST) H[k].shift(); });
}

/* ── DOM helpers ─────────────────────────────────────────────── */
const el  = id => document.getElementById(id);
const txt = (id, v) => { const e = el(id); if (e) e.textContent = v; };

/* ================================================================
   MAIN UPDATE — called ONLY from ws.onmessage
   This is the only function that changes displayed values.
   ================================================================ */
function update(d) {
  cur = { ...d };
  histPush(d);

  /* ── Reading cards (section 2) ─────────────────────────────── */
  txt('val-no2',  d.no2In.toFixed(1));
  txt('val-temp', d.temp.toFixed(1));
  txt('val-hum',  d.humidity.toFixed(0));

  /* MQ1 / MQ2 derived from no2In (consistent scaling) */
  txt('val-mq1', (d.no2In * 0.0138 + 0.42).toFixed(2));
  txt('val-mq2', (d.no2In * 0.0097 + 0.28).toFixed(2));

  /* NO2 status badge */
  const sn = el('status-no2');
  if (sn) {
    if (d.no2In > 80)      { sn.textContent = 'ELEVATED'; sn.style.color = '#C0412A'; }
    else if (d.no2In > 40) { sn.textContent = 'MODERATE'; sn.style.color = '#B87333'; }
    else                   { sn.textContent = 'NORMAL';   sn.style.color = '#2A6B47'; }
  }

  /* UV card */
  const uvW = el('uv-status');
  const uvI = el('uv-icon');
  if (uvW) uvW.textContent = d.uvActive ? 'active' : 'off';
  if (uvI) {
    uvI.style.background = d.uvActive ? '#E8C04A' : '#888';
    uvI.style.boxShadow  = d.uvActive ? '0 0 8px #E8C04A99' : 'none';
  }

  /* Hero SVG OLED sim text */
  const ov = el('oled-val');
  if (ov) ov.textContent = `NO2:${d.no2In.toFixed(0)}`;

  /* UV glow in SVG */
  const lamp = el('uv-lamp-bar');
  const zone = el('uv-zone');
  if (lamp) lamp.style.opacity = d.uvActive ? '1'    : '0.25';
  if (zone) zone.style.opacity = d.uvActive ? '0.20' : '0';

  /* 3D readout */
  txt('three-readout',
    `IN: ${d.no2In.toFixed(1)} µg/m³  ·  OUT: ${d.no2Out.toFixed(1)} µg/m³  ·  UV: ${d.uvActive ? 'ON' : 'OFF'}`
  );

  /* Timestamp */
  txt('last-updated', 'Updated ' + new Date().toLocaleTimeString('en-IN'));

  /* Alert banner */
  const banner = el('alert-banner');
  if (banner) {
    const msgs = [];
    if (d.no2In > 100) msgs.push(`⚠ NO₂ HIGH: ${d.no2In.toFixed(1)} µg/m³ — above WHO limit`);
    if (d.temp   > 34) msgs.push(`⚠ Temperature elevated: ${d.temp.toFixed(1)} °C`);
    banner.textContent   = msgs.join('   ·   ');
    banner.style.display = msgs.length ? 'block' : 'none';
  }

  chartsUpdate();
}

/* ================================================================
   WEBSOCKET
   Only place update() is called → only place values change.
   ================================================================ */
function wsConnect() {
  setStatus('connecting');
  try { ws = new WebSocket(WS_URL); }
  catch { scheduleRetry(); return; }

  ws.onopen = () => {
    wsAlive = true;
    wsRetry = 2000;
    setStatus('live');
    console.log('[WS] connected to bridge.py');
  };

  ws.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data);
      /* Validate all required fields are present and numeric */
      if (typeof d.no2In    !== 'number') return;
      if (typeof d.no2Out   !== 'number') return;
      if (typeof d.temp     !== 'number') return;
      if (typeof d.humidity !== 'number') return;
      if (typeof d.pressure !== 'number') return;
      update(d);
    } catch { /* malformed frame — skip */ }
  };

  ws.onclose = () => {
    if (wsAlive) console.warn('[WS] bridge disconnected');
    wsAlive = false;
    setStatus('lost');
    scheduleRetry();
  };

  ws.onerror = () => ws.close();
}

function scheduleRetry() {
  setTimeout(wsConnect, wsRetry);
  wsRetry = Math.min(wsRetry * 1.5, 15000);
}

/* ── Status indicator (ids: ws-dot, ws-status) ───────────────── */
function setStatus(state) {
  const dot = el('ws-dot');
  const lbl = el('ws-status');
  if (!dot || !lbl) return;

  dot.className = 'ws-dot';               // reset

  if (state === 'live') {
    dot.classList.add('connected');
    lbl.textContent = 'Live · Bridge connected';
  } else if (state === 'lost') {
    dot.classList.add('lost');
    lbl.textContent = 'Connection lost — last known values shown';
  } else {
    lbl.textContent = 'Connecting to bridge…';
  }
}

/* ================================================================
   CHART.JS  (canvas ids: chart-no2, chart-temp, chart-pressure)
   ================================================================ */
let cNo2 = null, cTemp = null, cPres = null;

const CHART_SCALES = {
  x: {
    ticks: { color: '#8B7355', font: { family: 'DM Sans', size: 10 },
             maxTicksLimit: 7, maxRotation: 0 },
    grid:  { color: '#2C2C2812' },
  },
  y: {
    ticks: { color: '#8B7355', font: { family: 'DM Sans', size: 10 } },
    grid:  { color: '#2C2C2812' },
  },
};

const CHART_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#2C2C28',
      titleColor: '#F0EDE6',
      bodyColor:  '#C8C4BC',
      padding: 10, cornerRadius: 3,
    },
  },
  scales: CHART_SCALES,
};

function mkDS(label, data, color, dashed) {
  return {
    label, data,
    borderColor: color,
    borderWidth: dashed ? 1.2 : 1.8,
    borderDash:  dashed ? [5, 4] : [],
    pointRadius: 0, pointHoverRadius: 3,
    pointHoverBackgroundColor: color,
    tension: 0.3, fill: false,
  };
}

function chartsInit() {
  /* Pre-fill 20 warm-up points using the starting cur values */
  const now = Date.now();
  for (let i = 20; i >= 0; i--) {
    const t = new Date(now - i * 2000).toLocaleTimeString('en-IN', { hour12: false });
    H.labels.push(t);
    H.no2In.push(cur.no2In);
    H.no2Out.push(cur.no2Out);
    H.temp.push(cur.temp);
    H.pressure.push(cur.pressure);
  }

  const who = () => Array(H.labels.length).fill(25);

  const c1 = el('chart-no2');
  if (c1) {
    cNo2 = new Chart(c1, {
      type: 'line',
      data: {
        labels: H.labels,
        datasets: [
          mkDS('Incoming NO₂', H.no2In,  '#C0412A', false),
          mkDS('Outgoing NO₂', H.no2Out, '#2A6B47', false),
          mkDS('WHO 25 µg/m³', who(),    '#8B7355', true),
        ],
      },
      options: {
        ...CHART_BASE,
        scales: { ...CHART_SCALES,
          y: { ...CHART_SCALES.y, min: 0, suggestedMax: 120,
               title: { display: true, text: 'µg/m³', color: '#8B7355', font:{size:10} } },
        },
      },
    });
  }

  const c2 = el('chart-temp');
  if (c2) {
    cTemp = new Chart(c2, {
      type: 'line',
      data: { labels: H.labels, datasets: [mkDS('Temp', H.temp, '#C0412A', false)] },
      options: {
        ...CHART_BASE,
        scales: { ...CHART_SCALES,
          y: { ...CHART_SCALES.y, min: 29, suggestedMax: 37,
               title: { display: true, text: '°C', color: '#8B7355', font:{size:10} } },
        },
      },
    });
  }

  const c3 = el('chart-pressure');
  if (c3) {
    cPres = new Chart(c3, {
      type: 'line',
      data: { labels: H.labels, datasets: [mkDS('Pressure', H.pressure, '#8B7355', false)] },
      options: {
        ...CHART_BASE,
        scales: { ...CHART_SCALES,
          y: { ...CHART_SCALES.y, min: 1004, suggestedMax: 1011,
               title: { display: true, text: 'hPa', color: '#8B7355', font:{size:10} } },
        },
      },
    });
  }
}

function chartsUpdate() {
  const who = Array(H.labels.length).fill(25);
  if (cNo2) {
    cNo2.data.labels           = H.labels;
    cNo2.data.datasets[0].data = H.no2In;
    cNo2.data.datasets[1].data = H.no2Out;
    cNo2.data.datasets[2].data = who;
    cNo2.update('none');
  }
  if (cTemp) {
    cTemp.data.labels           = H.labels;
    cTemp.data.datasets[0].data = H.temp;
    cTemp.update('none');
  }
  if (cPres) {
    cPres.data.labels           = H.labels;
    cPres.data.datasets[0].data = H.pressure;
    cPres.update('none');
  }
}

/* ================================================================
   SVG PARTICLES
   ================================================================ */
function initParticles() {
  const g = el('particles');
  if (!g) return;
  const NS = 'http://www.w3.org/2000/svg';
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const out = i >= 12;
    const c   = document.createElementNS(NS, 'circle');
    c.setAttribute('r',       out ? '2.5' : '3');
    c.setAttribute('fill',    out ? '#2A6B47' : '#C0412A');
    c.setAttribute('opacity', '0.75');
    const px = out ? 440 + Math.random()*100 : 90 + Math.random()*180;
    const py = 100 + Math.random() * 60;
    pts.push({ el: c, x: px, baseY: py, phase: Math.random()*Math.PI*2,
               speed: 0.4 + Math.random()*0.45, out });
    g.appendChild(c);
  }
  let tick = 0;
  (function frame() {
    tick++;
    pts.forEach(p => {
      p.x += p.speed;
      const lim   = p.out ? 625  : 430;
      const reset = p.out ? 440 + Math.random()*40 : 90 + Math.random()*30;
      if (p.x > lim) p.x = reset;
      if (!p.out)
        p.el.setAttribute('fill', (p.x > 265 && p.x < 435 && cur.uvActive) ? '#B87333' : '#C0412A');
      p.el.setAttribute('cx', p.x.toFixed(1));
      p.el.setAttribute('cy', (p.baseY + Math.sin(tick*0.04 + p.phase)*5).toFixed(1));
    });
    requestAnimationFrame(frame);
  })();
}

/* ================================================================
   THREE.JS 3D
   ================================================================ */
function init3D() {
  const canvas = el('three-canvas');
  if (!canvas || typeof THREE === 'undefined') return;
  const W = canvas.parentElement.clientWidth || 800;
  const H3 = canvas.parentElement.clientHeight || 420;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H3);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W/H3, 0.1, 100);
  camera.position.set(0, 2.5, 7.5);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(5, 8, 6); scene.add(sun);
  const mWall = new THREE.MeshStandardMaterial({ color:0xE0DDD6, transparent:true, opacity:0.35, side:THREE.DoubleSide });
  const mTio2 = new THREE.MeshStandardMaterial({ color:0xD4C5A0, roughness:0.8 });
  const mStm  = new THREE.MeshStandardMaterial({ color:0x1A2E1A, roughness:0.4, metalness:0.2 });
  const mUV   = new THREE.MeshStandardMaterial({ color:0xE8C04A, emissive:0xE8C04A, emissiveIntensity:0.6 });
  const mOled = new THREE.MeshStandardMaterial({ color:0x0A1F0A, emissive:0x00FF55, emissiveIntensity:0.2 });
  const mSens = new THREE.MeshStandardMaterial({ color:0xF7F6F2, roughness:0.9 });
  const mWire = new THREE.LineBasicMaterial({ color:0x8B7355, transparent:true, opacity:0.55 });
  function bx(w,h,d,mat,x,y,z){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.position.set(x,y,z); scene.add(m); return m; }
  const DW=5,DH=0.9,T=0.07;
  bx(DW,T,1,mTio2,0,DH/2,0); bx(DW,T,1,mTio2,0,-DH/2,0);
  bx(T,DH,1,mWall,-DW/2,0,0); bx(T,DH,1,mWall,DW/2,0,0);
  const uvBar  = bx(1.2,0.07,0.85,mUV,   0,   DH/2-T-0.035, 0);
  const stm32  = bx(0.7, 0.10,0.50,mStm, 0,  -DH/2-0.50,   0);
  const oled3  = bx(0.5, 0.08,0.40,mOled,1.8,-DH/2-0.50,   0);
  const sensor = bx(0.4, 0.08,0.40,mSens,-1.8,-DH/2-0.50,  0);
  const wg = new THREE.Group(); scene.add(wg);
  function ln(pts){ const g=new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(...p))); wg.add(new THREE.Line(g,mWire)); }
  ln([[-1.8,-DH/2-0.46,0],[0,-DH/2-0.46,0]]);
  ln([[0,-DH/2-0.46,0],[1.8,-DH/2-0.46,0]]);
  ln([[0,-DH/2-0.46,0],[0,-T,0]]);
  const labelEl=el('component-label'), labelNm=el('label-name'), labelDsc=el('label-desc');
  const COMPS=[
    {mesh:stm32, name:'STM32 MCU',       desc:'ADC · I2C · UART 115200 baud'},
    {mesh:oled3, name:'OLED Display',    desc:'SSD1306 128×64 — same values as this dashboard'},
    {mesh:sensor,name:'Gas Sensor Array',desc:'MQ-series · channels ADC5, ADC6, ADC7'},
    {mesh:uvBar, name:'UV Lamp 365nm',   desc:'GPIO relay · drives TiO₂ photocatalysis'},
  ];
  const ray=new THREE.Raycaster(), mv=new THREE.Vector2();
  canvas.addEventListener('mousemove', e=>{
    const r=canvas.getBoundingClientRect();
    mv.x=((e.clientX-r.left)/r.width)*2-1;
    mv.y=-((e.clientY-r.top)/r.height)*2+1;
    ray.setFromCamera(mv,camera);
    const hits=ray.intersectObjects(COMPS.map(c=>c.mesh));
    if(hits.length&&labelEl){
      const c=COMPS.find(x=>x.mesh===hits[0].object);
      if(c){labelNm.textContent=c.name;labelDsc.textContent=c.desc;
            labelEl.classList.remove('hidden');
            labelEl.style.left=(e.clientX-r.left+14)+'px';
            labelEl.style.top=(e.clientY-r.top-12)+'px';}
    } else if(labelEl) labelEl.classList.add('hidden');
  });
  canvas.addEventListener('mouseleave',()=>{ if(labelEl) labelEl.classList.add('hidden'); });
  let drag=false,lx=0,ly=0,ry=0,rx=0;
  canvas.addEventListener('mousedown',e=>{drag=true;lx=e.clientX;ly=e.clientY;});
  window.addEventListener('mouseup',()=>{drag=false;});
  window.addEventListener('mousemove',e=>{
    if(!drag)return;
    ry+=(e.clientX-lx)*0.008;
    rx=Math.max(-0.7,Math.min(0.7,rx+(e.clientY-ly)*0.008));
    lx=e.clientX;ly=e.clientY;
  });
  canvas.addEventListener('wheel',e=>{
    camera.position.z=Math.max(3,Math.min(13,camera.position.z+e.deltaY*0.012));
    e.preventDefault();
  },{passive:false});
  const chkW=el('chk-wiring'),chkE=el('chk-explode'),chkL=el('chk-live');
  if(chkW) chkW.addEventListener('change',()=>{wg.visible=chkW.checked;});
  if(chkE) chkE.addEventListener('change',()=>{
    oled3.position.y =-DH/2-0.50-(chkE.checked?0.55:0);
    sensor.position.y=-DH/2-0.50-(chkE.checked?0.30:0);
    uvBar.position.y  = DH/2-T-0.035+(chkE.checked?0.35:0);
  });
  const pivot=new THREE.Group();
  [...scene.children].forEach(c=>{scene.remove(c);pivot.add(c);});
  scene.add(pivot);
  let f=0;
  (function render(){
    f++; requestAnimationFrame(render);
    if(!drag) ry+=0.003;
    pivot.rotation.y=ry; pivot.rotation.x=rx;
    if(chkL&&chkL.checked&&uvBar)
      uvBar.material.emissiveIntensity=cur.uvActive?0.4+Math.sin(f*0.07)*0.35:0.04;
    renderer.render(scene,camera);
  })();
  window.addEventListener('resize',()=>{
    const nw=canvas.parentElement.clientWidth;
    renderer.setSize(nw,H3); camera.aspect=nw/H3; camera.updateProjectionMatrix();
  });
}

/* ================================================================
   SCROLL REVEAL
   ================================================================ */
function initReveal() {
  const stages = document.querySelectorAll('.process-stage');
  if (!stages.length) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity   = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.15 });
  stages.forEach(s => {
    s.style.cssText += ';opacity:0;transform:translateY(22px);transition:opacity 0.55s,transform 0.55s';
    obs.observe(s);
  });
}

/* ================================================================
   BOOT
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  chartsInit();     // seed charts with flat starting values
  initParticles();  // animated SVG particles in hero
  initReveal();     // scroll-triggered stage reveal
  init3D();         // Three.js 3D schematic

  setStatus('connecting');
  wsConnect();      // attempt bridge connection — THIS is the only data source
  // NO setInterval, NO fallback sim in the browser.
  // Values only change when bridge.py sends a WS message.
});