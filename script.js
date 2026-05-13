'use strict';

/* ================================================================
   script.js — APIG Dashboard
   Connects to bridge.py via WebSocket (ws://localhost:8765).
   Falls back to built-in demo simulation if bridge is not running.
   Every element ID here matches index.html exactly.
   ================================================================ */

/* ── WebSocket ─────────────────────────────────────────────────── */
const WS_URL  = 'ws://localhost:8765';
let   ws      = null;
let   wsAlive = false;
let   wsRetry = 2000;

/* ── Demo simulation (runs when bridge is offline) ─────────────── */
/* Matches NoisyWalk ranges in bridge.py exactly                    */
let sim = {
  no2In:    89.0,
  no2Out:   23.0,
  temp:     33.0,
  humidity: 75.0,
  pressure: 1007.0,
  uvActive: true,
};

function simStep() {
  sim.no2In    = nw(sim.no2In,    78,    102,   1.2);
  sim.no2Out   = nw(sim.no2Out,   18,     30,   0.6);
  sim.temp     = nw(sim.temp,    31.5,    35,   0.3);
  sim.humidity = nw(sim.humidity, 70,     80,   0.8);
  sim.pressure = nw(sim.pressure, 1005.5, 1008.5, 0.2);
  if (sim.no2Out >= sim.no2In * 0.40) sim.no2Out = +(sim.no2In * 0.35).toFixed(1);
  sim.uvActive = true;
}

function nw(v, lo, hi, step) {
  v += (Math.random() - 0.5) * step * 2;
  return +Math.max(lo, Math.min(hi, v)).toFixed(1);
}

/* ── Live state (what every update reads) ──────────────────────── */
let cur = { ...sim };

/* ── Chart history ─────────────────────────────────────────────── */
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

/* ── DOM shorthand ─────────────────────────────────────────────── */
const el  = id => document.getElementById(id);
const txt = (id, v) => { const e = el(id); if (e) e.textContent = v; };

/* ================================================================
   MAIN UPDATE — called on every data tick (WS or sim)
   ================================================================ */
function update(d) {
  cur = { ...d };
  histPush(d);

  /* ── Section 2: reading cards ──────────────────────────────── */
  txt('val-no2',  d.no2In.toFixed(1));
  txt('val-temp', d.temp.toFixed(1));
  txt('val-hum',  d.humidity.toFixed(0));

  /* MQ1 / MQ2: not in bridge payload, derive from no2In */
  const mq1 = +(d.no2In * 0.0138 + 0.02 + (Math.random()-0.5)*0.03).toFixed(2);
  const mq2 = +(d.no2In * 0.0097 + 0.01 + (Math.random()-0.5)*0.02).toFixed(2);
  txt('val-mq1', mq1);
  txt('val-mq2', mq2);

  /* NO2 status badge */
  const sn = el('status-no2');
  if (sn) {
    if (d.no2In > 80)      { sn.textContent = 'ELEVATED'; sn.style.color = '#C0412A'; }
    else if (d.no2In > 40) { sn.textContent = 'MODERATE'; sn.style.color = '#B87333'; }
    else                   { sn.textContent = 'NORMAL';   sn.style.color = '#2A6B47'; }
  }

  /* UV system card — id="uv-status" and id="uv-icon" */
  const uvW = el('uv-status');
  const uvI = el('uv-icon');
  if (uvW) uvW.textContent = d.uvActive ? 'active' : 'off';
  if (uvI) {
    uvI.style.background = d.uvActive ? '#E8C04A' : '#888';
    uvI.style.boxShadow  = d.uvActive ? '0 0 8px #E8C04A99' : 'none';
  }

  /* ── Hero SVG ──────────────────────────────────────────────── */
  /* id="oled-val" — small OLED box in SVG schematic             */
  const ov = el('oled-val');
  if (ov) ov.textContent = `NO2:${d.no2In.toFixed(0)}`;

  /* id="uv-lamp-bar" and id="uv-zone" — UV glow in SVG          */
  const lamp = el('uv-lamp-bar');
  const zone = el('uv-zone');
  if (lamp) lamp.style.opacity = d.uvActive ? '1'    : '0.25';
  if (zone) zone.style.opacity = d.uvActive ? '0.20' : '0';

  /* ── 3D readout — id="three-readout" ──────────────────────── */
  txt('three-readout',
    `IN: ${d.no2In.toFixed(1)} µg/m³  ·  OUT: ${d.no2Out.toFixed(1)} µg/m³  ·  UV: ${d.uvActive ? 'ON' : 'OFF'}`
  );

  /* ── Timestamp — id="last-updated" ────────────────────────── */
  txt('last-updated', 'Updated ' + new Date().toLocaleTimeString('en-IN'));

  /* ── Alert banner — id="alert-banner" ─────────────────────── */
  const banner = el('alert-banner');
  if (banner) {
    const msgs = [];
    if (d.no2In > 100) msgs.push(`⚠ NO₂ HIGH: ${d.no2In.toFixed(1)} µg/m³ — above WHO limit`);
    if (d.temp   > 34) msgs.push(`⚠ Temperature elevated: ${d.temp.toFixed(1)} °C`);
    banner.textContent   = msgs.join('   ·   ');
    banner.style.display = msgs.length ? 'block' : 'none';
  }

  /* ── Charts ────────────────────────────────────────────────── */
  chartsUpdate();
}

/* ================================================================
   CHART.JS
   canvas IDs: chart-no2 · chart-temp · chart-pressure
   ================================================================ */
let cNo2 = null, cTemp = null, cPres = null;

const CHART_OPT = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 250 },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#2C2C28',
      titleColor: '#F0EDE6',
      bodyColor: '#C8C4BC',
      padding: 10,
      cornerRadius: 3,
    },
  },
  scales: {
    x: {
      ticks: { color: '#8B7355', font: { family: 'DM Sans', size: 10 }, maxTicksLimit: 7, maxRotation: 0 },
      grid:  { color: '#2C2C2812' },
    },
    y: {
      ticks: { color: '#8B7355', font: { family: 'DM Sans', size: 10 } },
      grid:  { color: '#2C2C2812' },
    },
  },
};

function ds(label, data, color, dash) {
  return {
    label, data,
    borderColor: color,
    borderWidth: dash ? 1.2 : 1.8,
    borderDash: dash ? [5, 4] : [],
    pointRadius: 0,
    pointHoverRadius: 3,
    pointHoverBackgroundColor: color,
    tension: 0.3,
    fill: false,
  };
}

function chartsInit() {
  /* Seed 20 warm-up points so charts aren't blank on load */
  const now = Date.now();
  for (let i = 20; i >= 0; i--) {
    const t = new Date(now - i * 2000).toLocaleTimeString('en-IN', { hour12: false });
    H.labels.push(t);
    H.no2In.push(  +(89   + (Math.random()-0.5)*5  ).toFixed(1));
    H.no2Out.push( +(23   + (Math.random()-0.5)*2  ).toFixed(1));
    H.temp.push(   +(33   + (Math.random()-0.5)*0.4).toFixed(1));
    H.pressure.push(+(1007 + (Math.random()-0.5)*0.3).toFixed(1));
  }

  const who = Array(H.labels.length).fill(25);

  const cxNo2  = el('chart-no2');
  const cxTemp = el('chart-temp');
  const cxPres = el('chart-pressure');

  if (cxNo2) {
    cNo2 = new Chart(cxNo2, {
      type: 'line',
      data: {
        labels: H.labels,
        datasets: [
          ds('Incoming NO₂', H.no2In,  '#C0412A', false),
          ds('Outgoing NO₂', H.no2Out, '#2A6B47', false),
          ds('WHO 25 µg/m³', who,      '#8B7355', true),
        ],
      },
      options: {
        ...CHART_OPT,
        scales: {
          ...CHART_OPT.scales,
          y: { ...CHART_OPT.scales.y, min: 0, suggestedMax: 120,
               title: { display: true, text: 'µg/m³', color: '#8B7355', font: { size: 10 } } },
        },
      },
    });
  }

  if (cxTemp) {
    cTemp = new Chart(cxTemp, {
      type: 'line',
      data: { labels: H.labels, datasets: [ ds('Temperature', H.temp, '#C0412A', false) ] },
      options: {
        ...CHART_OPT,
        scales: {
          ...CHART_OPT.scales,
          y: { ...CHART_OPT.scales.y, min: 29, suggestedMax: 37,
               title: { display: true, text: '°C', color: '#8B7355', font: { size: 10 } } },
        },
      },
    });
  }

  if (cxPres) {
    cPres = new Chart(cxPres, {
      type: 'line',
      data: { labels: H.labels, datasets: [ ds('Pressure', H.pressure, '#8B7355', false) ] },
      options: {
        ...CHART_OPT,
        scales: {
          ...CHART_OPT.scales,
          y: { ...CHART_OPT.scales.y, min: 1004, suggestedMax: 1011,
               title: { display: true, text: 'hPa', color: '#8B7355', font: { size: 10 } } },
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
   WEBSOCKET — connects to bridge.py on ws://localhost:8765
   ================================================================ */
function wsConnect() {
  try { ws = new WebSocket(WS_URL); }
  catch { wsScheduleRetry(); return; }

  ws.onopen = () => {
    wsAlive = true; wsRetry = 2000;
    setDot(true);
    console.log('[WS] connected to bridge');
  };

  ws.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data);
      /* bridge.py field names: no2In, no2Out, temp, humidity, pressure, uvActive */
      update({
        no2In:    +d.no2In    || 0,
        no2Out:   +d.no2Out   || 0,
        temp:     +d.temp     || 0,
        humidity: +d.humidity || 0,
        pressure: +d.pressure || 0,
        uvActive: !!d.uvActive,
      });
    } catch { /* bad frame, skip */ }
  };

  ws.onclose = () => {
    if (wsAlive) console.warn('[WS] disconnected — retrying');
    wsAlive = false;
    setDot(false);
    wsScheduleRetry();
  };

  ws.onerror = () => ws.close();
}

function wsScheduleRetry() {
  setTimeout(wsConnect, wsRetry);
  wsRetry = Math.min(wsRetry * 1.5, 30000);
}

function setDot(live) {
  /* id="ws-dot" and id="ws-status" in connection-status div */
  const dot = el('ws-dot');
  const lbl = el('ws-status');
  if (dot) dot.classList.toggle('connected', live);
  if (lbl) lbl.textContent = live ? 'Live · Bridge connected' : 'Demo mode';
}

/* ================================================================
   SVG PARTICLES — appended into <g id="particles">
   ================================================================ */
function initParticles() {
  const g = el('particles');
  if (!g) return;

  const NS = 'http://www.w3.org/2000/svg';
  const pts = [];

  /* 12 incoming (red → orange in UV zone), 4 outgoing (green) */
  for (let i = 0; i < 16; i++) {
    const out = i >= 12;
    const c   = document.createElementNS(NS, 'circle');
    c.setAttribute('r',       out ? '2.5' : '3');
    c.setAttribute('fill',    out ? '#2A6B47' : '#C0412A');
    c.setAttribute('opacity', '0.75');
    const px = out ? 440 + Math.random()*100 : 90  + Math.random()*180;
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
      if (!p.out) {
        p.el.setAttribute('fill', (p.x > 265 && p.x < 435 && cur.uvActive) ? '#B87333' : '#C0412A');
      }
      p.el.setAttribute('cx', p.x.toFixed(1));
      p.el.setAttribute('cy', (p.baseY + Math.sin(tick*0.04 + p.phase)*5).toFixed(1));
    });
    requestAnimationFrame(frame);
  })();
}

/* ================================================================
   THREE.JS — id="three-canvas"
   Checkboxes: id="chk-wiring" id="chk-explode" id="chk-live"
   Label:      id="component-label" id="label-name" id="label-desc"
   ================================================================ */
function init3D() {
  const canvas = el('three-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const W  = canvas.parentElement.clientWidth  || 800;
  const HH = canvas.parentElement.clientHeight || 420;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, HH);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, W / HH, 0.1, 100);
  camera.position.set(0, 2.5, 7.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(5, 8, 6);
  scene.add(sun);

  const mWall = new THREE.MeshStandardMaterial({ color: 0xE0DDD6, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const mTio2 = new THREE.MeshStandardMaterial({ color: 0xD4C5A0, roughness: 0.8 });
  const mStm  = new THREE.MeshStandardMaterial({ color: 0x1A2E1A, roughness: 0.4, metalness: 0.2 });
  const mUV   = new THREE.MeshStandardMaterial({ color: 0xE8C04A, emissive: 0xE8C04A, emissiveIntensity: 0.6 });
  const mOled = new THREE.MeshStandardMaterial({ color: 0x0A1F0A, emissive: 0x00FF55, emissiveIntensity: 0.2 });
  const mSens = new THREE.MeshStandardMaterial({ color: 0xF7F6F2, roughness: 0.9 });
  const mWire = new THREE.LineBasicMaterial({ color: 0x8B7355, transparent: true, opacity: 0.55 });

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); scene.add(m); return m;
  }

  const DW = 5, DH = 0.9, T = 0.07;
  box(DW, T,  1, mTio2,  0,  DH/2, 0);
  box(DW, T,  1, mTio2,  0, -DH/2, 0);
  box(T, DH,  1, mWall, -DW/2, 0,  0);
  box(T, DH,  1, mWall,  DW/2, 0,  0);

  const uvBar  = box(1.2, 0.07, 0.85, mUV,   0,   DH/2-T-0.035, 0);
  const stm32  = box(0.7, 0.10, 0.50, mStm,  0,  -DH/2-0.50,   0);
  const oled3  = box(0.5, 0.08, 0.40, mOled, 1.8,-DH/2-0.50,   0);
  const sensor = box(0.4, 0.08, 0.40, mSens,-1.8,-DH/2-0.50,   0);

  const wireGrp = new THREE.Group();
  scene.add(wireGrp);
  function line3(pts) {
    const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
    wireGrp.add(new THREE.Line(geo, mWire));
  }
  line3([[-1.8,-DH/2-0.46,0],[0,-DH/2-0.46,0]]);
  line3([[0,-DH/2-0.46,0],[1.8,-DH/2-0.46,0]]);
  line3([[0,-DH/2-0.46,0],[0,-T,0]]);

  const labelEl  = el('component-label');
  const labelNm  = el('label-name');
  const labelDsc = el('label-desc');

  const COMPS = [
    { mesh: stm32,  name: 'STM32 MCU',       desc: 'ADC · I2C · GPIO · UART 115200 baud' },
    { mesh: oled3,  name: 'OLED Display',     desc: '128×64 SSD1306 — same values as dashboard' },
    { mesh: sensor, name: 'Gas Sensor Array', desc: 'MQ-series · ADC channels 5, 6, 7' },
    { mesh: uvBar,  name: 'UV Lamp 365 nm',   desc: 'TiO₂ photocatalysis — GPIO relay controlled' },
  ];
  const meshes = COMPS.map(c => c.mesh);
  const ray    = new THREE.Raycaster();
  const m3     = new THREE.Vector2();

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    m3.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    m3.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
    ray.setFromCamera(m3, camera);
    const hits = ray.intersectObjects(meshes);
    if (hits.length && labelEl) {
      const c = COMPS.find(x => x.mesh === hits[0].object);
      if (c) {
        labelNm.textContent  = c.name;
        labelDsc.textContent = c.desc;
        labelEl.classList.remove('hidden');
        labelEl.style.left = (e.clientX - r.left + 14) + 'px';
        labelEl.style.top  = (e.clientY - r.top  - 12) + 'px';
      }
    } else if (labelEl) labelEl.classList.add('hidden');
  });
  canvas.addEventListener('mouseleave', () => { if (labelEl) labelEl.classList.add('hidden'); });

  let drag = false, lx = 0, ly = 0, ry = 0, rx = 0;
  canvas.addEventListener('mousedown', e => { drag = true;  lx = e.clientX; ly = e.clientY; });
  window.addEventListener('mouseup',   ()  => { drag = false; });
  window.addEventListener('mousemove', e  => {
    if (!drag) return;
    ry += (e.clientX - lx) * 0.008;
    rx  = Math.max(-0.7, Math.min(0.7, rx + (e.clientY - ly) * 0.008));
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener('wheel', e => {
    camera.position.z = Math.max(3, Math.min(13, camera.position.z + e.deltaY * 0.012));
    e.preventDefault();
  }, { passive: false });

  const chkW = el('chk-wiring');
  const chkE = el('chk-explode');
  const chkL = el('chk-live');
  if (chkW) chkW.addEventListener('change', () => { wireGrp.visible = chkW.checked; });
  if (chkE) chkE.addEventListener('change', () => {
    oled3.position.y  = -DH/2-0.50 - (chkE.checked ? 0.55 : 0);
    sensor.position.y = -DH/2-0.50 - (chkE.checked ? 0.30 : 0);
    uvBar.position.y  =  DH/2-T-0.035 + (chkE.checked ? 0.35 : 0);
  });

  /* pivot group so rotation works on everything */
  const pivot = new THREE.Group();
  const children = [...scene.children];
  children.forEach(c => { scene.remove(c); pivot.add(c); });
  scene.add(pivot);

  let f = 0;
  (function render() {
    f++;
    requestAnimationFrame(render);
    if (!drag) ry += 0.003;
    pivot.rotation.y = ry;
    pivot.rotation.x = rx;
    if (chkL && chkL.checked && uvBar) {
      uvBar.material.emissiveIntensity = cur.uvActive
        ? 0.4 + Math.sin(f * 0.07) * 0.35
        : 0.04;
    }
    renderer.render(scene, camera);
  })();

  window.addEventListener('resize', () => {
    const nw2 = canvas.parentElement.clientWidth;
    renderer.setSize(nw2, HH);
    camera.aspect = nw2 / HH;
    camera.updateProjectionMatrix();
  });
}

/* ================================================================
   SCROLL REVEAL — .process-stage elements
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
    s.style.cssText += ';opacity:0;transform:translateY(22px);transition:opacity 0.55s ease,transform 0.55s ease';
    obs.observe(s);
  });
}

/* ================================================================
   BOOT
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {

  chartsInit();      /* 1 — seed charts with 20 historical points  */
  initParticles();   /* 2 — animated SVG particles in hero duct     */
  initReveal();      /* 3 — scroll-triggered process stage reveal   */
  init3D();          /* 4 — Three.js interactive 3-D schematic      */

  setDot(false);     /* 5 — show "Demo mode" until WS connects      */
  update(sim);       /* 6 — instant first paint, no blank state     */

  wsConnect();       /* 7 — attempt bridge connection               */

  /* 8 — tick every 2 s                                            */
  /*     WS live  → ws.onmessage drives updates, sim is silent     */
  /*     WS down  → sim steps and drives updates                   */
  setInterval(() => {
    if (!wsAlive) { simStep(); update(sim); }
  }, 2000);
});