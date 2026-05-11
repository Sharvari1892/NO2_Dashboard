// ═══════════════════════════════════════════════════
//  APIG Dashboard · script.js
//  1. Hero SVG Particle Animation
//  2. Live Data Simulation (replace with WebSocket)
//  3. Chart.js Time-Series Graphs
//  4. Three.js 3D Schematic
// ═══════════════════════════════════════════════════

// ─── Live data state ───────────────────────────────
const state = {
  no2In: 182,
  no2Out: 47,
  temp: 28.4,
  pressure: 1013,
  uvActive: true,
  histNo2In: [],
  histNo2Out: [],
  histTemp: [],
  histPressure: [],
  labels: [],
  maxPoints: 60
};

function simValue(base, noise, min, max) {
  const v = base + (Math.random() - 0.5) * noise;
  return Math.min(max, Math.max(min, Math.round(v * 10) / 10));
}

// ─── 1. HERO SVG PARTICLES ─────────────────────────
(function initHeroParticles() {
  const g = document.getElementById('particles');
  if (!g) return;

  const DUCT_X1 = 82, DUCT_X2 = 618;
  const DUCT_Y1 = 90, DUCT_Y2 = 178;
  const UV_START = 265, UV_END = 435; // treatment zone x range

  const NUM = 60;
  const particles = [];

  for (let i = 0; i < NUM; i++) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', 4 + Math.random() * 3);
    circle.setAttribute('opacity', 0.7 + Math.random() * 0.3);
    g.appendChild(circle);

    particles.push({
      el: circle,
      phase: Math.random(),
      speed: 0.0015 + Math.random() * 0.003,
      yOffset: DUCT_Y1 + 14 + Math.random() * (DUCT_Y2 - DUCT_Y1 - 28),
      yWobble: (Math.random() - 0.5) * 6,
      wobbleSpeed: 0.02 + Math.random() * 0.03,
      wobblePhase: Math.random() * Math.PI * 2
    });
  }

  function lerpColor(c1, c2, t) {
    const r1 = parseInt(c1.slice(1,3),16), g1 = parseInt(c1.slice(3,5),16), b1 = parseInt(c1.slice(5,7),16);
    const r2 = parseInt(c2.slice(1,3),16), g2 = parseInt(c2.slice(3,5),16), b2 = parseInt(c2.slice(5,7),16);
    const r = Math.round(r1 + (r2-r1)*t);
    const gv = Math.round(g1 + (g2-g1)*t);
    const b = Math.round(b1 + (b2-b1)*t);
    return `rgb(${r},${gv},${b})`;
  }

  const RED = '#C0412A', AMBER = '#B87333', GREEN = '#2A6B47';

  let tick = 0;
  function animateParticles() {
    tick++;
    const uvOn = state.uvActive;

    particles.forEach(p => {
      p.phase += p.speed;
      if (p.phase > 1) {
        p.phase -= 1;
        p.yOffset = DUCT_Y1 + 14 + Math.random() * (DUCT_Y2 - DUCT_Y1 - 28);
      }

      const x = DUCT_X1 + p.phase * (DUCT_X2 - DUCT_X1);
      const uvZoneStart = (UV_START - DUCT_X1) / (DUCT_X2 - DUCT_X1);
      const uvZoneEnd = (UV_END - DUCT_X1) / (DUCT_X2 - DUCT_X1);

      let color;
      if (!uvOn) {
        color = RED;
      } else if (p.phase < uvZoneStart) {
        color = RED;
      } else if (p.phase < uvZoneEnd) {
        const t = (p.phase - uvZoneStart) / (uvZoneEnd - uvZoneStart);
        color = t < 0.5 ? lerpColor(RED, AMBER, t*2) : lerpColor(AMBER, GREEN, (t-0.5)*2);
      } else {
        color = GREEN;
      }

      const wobble = Math.sin(tick * p.wobbleSpeed + p.wobblePhase) * p.yWobble;
      p.el.setAttribute('cx', x.toFixed(1));
      p.el.setAttribute('cy', (p.yOffset + wobble).toFixed(1));
      p.el.setAttribute('fill', color);
    });

    // UV glow
    const uvZone = document.getElementById('uv-zone');
    const uvLamp = document.getElementById('uv-lamp-bar');
    if (uvZone && uvLamp) {
      if (uvOn) {
        const pulse = 0.08 + Math.sin(tick * 0.04) * 0.04;
        uvZone.setAttribute('opacity', pulse.toFixed(3));
        uvLamp.setAttribute('opacity', (0.5 + Math.sin(tick * 0.04) * 0.2).toFixed(3));
      } else {
        uvZone.setAttribute('opacity', '0');
        uvLamp.setAttribute('opacity', '0.15');
      }
    }

    requestAnimationFrame(animateParticles);
  }
  animateParticles();
})();


// ─── 2. LIVE DATA UPDATE ───────────────────────────
function updateReadings() {
  state.no2In = simValue(state.no2In, 12, 140, 220);
  state.no2Out = simValue(state.no2Out, 6, 30, 80);
  state.temp = simValue(state.temp, 0.5, 22, 38);
  state.pressure = simValue(state.pressure, 2, 990, 1030);
  state.uvActive = state.no2In > 140;

  // Current readings UI
  const elNo2In = document.getElementById('val-no2-in');
  const elNo2Out = document.getElementById('val-no2-out');
  const elTemp = document.getElementById('val-temp');
  const elPressure = document.getElementById('val-pressure');
  const elReduction = document.getElementById('val-reduction');
  const elStatus = document.getElementById('status-no2');
  const elUvWord = document.getElementById('uv-word');
  const elUvIcon = document.getElementById('uv-icon');

  if (elNo2In) elNo2In.textContent = Math.round(state.no2In);
  if (elNo2Out) elNo2Out.textContent = Math.round(state.no2Out);
  if (elTemp) elTemp.textContent = state.temp.toFixed(1);
  if (elPressure) elPressure.textContent = Math.round(state.pressure);

  if (elReduction) {
    const pct = Math.round((1 - state.no2Out / state.no2In) * 100);
    elReduction.textContent = `↓ ${pct}% reduction`;
  }

  if (elStatus) {
    if (state.no2In > 180) {
      elStatus.textContent = 'CRITICAL';
      elStatus.className = 'reading-status critical';
    } else if (state.no2In > 120) {
      elStatus.textContent = 'WARNING';
      elStatus.className = 'reading-status warning';
    } else {
      elStatus.textContent = 'SAFE';
      elStatus.className = 'reading-status safe';
    }
  }

  if (elUvWord) {
    elUvWord.textContent = state.uvActive ? 'active' : 'standby';
    elUvWord.className = 'fraunces uv-word' + (state.uvActive ? '' : ' standby-text');
  }
  if (elUvIcon) {
    elUvIcon.className = 'uv-lamp-icon ' + (state.uvActive ? 'active' : 'standby');
  }

  // OLED sim
  const oled = document.getElementById('oled-val');
  if (oled) oled.textContent = `NO₂:${Math.round(state.no2In)}`;

  // 3D readout
  const ro = document.getElementById('three-readout');
  if (ro) ro.textContent = `IN: ${Math.round(state.no2In)} µg/m³ · OUT: ${Math.round(state.no2Out)} µg/m³ · UV: ${state.uvActive ? 'ON' : 'OFF'}`;

  // History arrays
  const now = new Date();
  const label = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ':' + now.getSeconds().toString().padStart(2,'0');

  [state.histNo2In, state.histNo2Out, state.histTemp, state.histPressure, state.labels].forEach(arr => {
    if (arr.length >= state.maxPoints) arr.shift();
  });
  state.histNo2In.push(Math.round(state.no2In));
  state.histNo2Out.push(Math.round(state.no2Out));
  state.histTemp.push(parseFloat(state.temp.toFixed(1)));
  state.histPressure.push(Math.round(state.pressure));
  state.labels.push(label);

  updateCharts();
}

// Seed initial history
for (let i = 0; i < 20; i++) {
  state.no2In = simValue(175, 20, 140, 220);
  state.no2Out = simValue(48, 8, 30, 80);
  state.temp = simValue(28.4, 0.8, 22, 38);
  state.pressure = simValue(1013, 3, 990, 1030);
  const d = new Date(Date.now() - (20-i)*2000);
  const l = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0') + ':' + d.getSeconds().toString().padStart(2,'0');
  state.histNo2In.push(Math.round(state.no2In));
  state.histNo2Out.push(Math.round(state.no2Out));
  state.histTemp.push(parseFloat(state.temp.toFixed(1)));
  state.histPressure.push(Math.round(state.pressure));
  state.labels.push(l);
}

setInterval(updateReadings, 2000);


// ─── 3. CHART.JS GRAPHS ────────────────────────────
let chartNo2, chartTemp, chartPressure;

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: {
    legend: { display: false },
    tooltip: {
      mode: 'index',
      intersect: false,
      backgroundColor: '#F7F6F2',
      titleColor: '#2C2C28',
      bodyColor: '#6B6962',
      borderColor: 'rgba(44,44,40,0.15)',
      borderWidth: 1,
      padding: 10,
      titleFont: { family: 'DM Sans', size: 11 },
      bodyFont: { family: 'DM Sans', size: 11 }
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(44,44,40,0.06)', drawBorder: false },
      ticks: { font: { family: 'DM Sans', size: 10 }, color: '#A8A69E', maxTicksLimit: 8, maxRotation: 0 },
      border: { display: false }
    },
    y: {
      grid: { color: 'rgba(44,44,40,0.06)', drawBorder: false },
      ticks: { font: { family: 'DM Sans', size: 10 }, color: '#A8A69E' },
      border: { display: false }
    }
  }
};

function makeLineDataset(label, data, color, fill) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: fill || 'transparent',
    borderWidth: 1.5,
    pointRadius: 0,
    pointHoverRadius: 3,
    tension: 0.35,
    fill: !!fill
  };
}

function initCharts() {
  const no2Canvas = document.getElementById('chart-no2');
  const tempCanvas = document.getElementById('chart-temp');
  const pressCanvas = document.getElementById('chart-pressure');
  if (!no2Canvas || !tempCanvas || !pressCanvas) return;

  const whoLine = {
    id: 'whoLine',
    beforeDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
      if (!y) return;
      const yVal = y.getPixelForValue(25);
      if (yVal < top || yVal > bottom) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(44,44,40,0.2)';
      ctx.setLineDash([4,4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, yVal);
      ctx.lineTo(right, yVal);
      ctx.stroke();
      ctx.restore();
    }
  };

  chartNo2 = new Chart(no2Canvas, {
    type: 'line',
    data: {
      labels: [...state.labels],
      datasets: [
        makeLineDataset('Incoming NO₂', [...state.histNo2In], '#C0412A', 'rgba(192,65,42,0.05)'),
        makeLineDataset('Outgoing NO₂', [...state.histNo2Out], '#2A6B47', 'rgba(42,107,71,0.05)')
      ]
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y, min: 0, max: 250, title: { display: false } }
      }
    },
    plugins: [whoLine]
  });

  chartTemp = new Chart(tempCanvas, {
    type: 'line',
    data: {
      labels: [...state.labels],
      datasets: [makeLineDataset('Temperature', [...state.histTemp], '#8B7355', 'rgba(139,115,85,0.06)')]
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y, min: 15, max: 45 }
      }
    }
  });

  chartPressure = new Chart(pressCanvas, {
    type: 'line',
    data: {
      labels: [...state.labels],
      datasets: [makeLineDataset('Pressure', [...state.histPressure], '#1A3D2B', 'rgba(26,61,43,0.06)')]
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y, min: 980, max: 1040 }
      }
    }
  });
}

function updateCharts() {
  if (!chartNo2) return;
  chartNo2.data.labels = [...state.labels];
  chartNo2.data.datasets[0].data = [...state.histNo2In];
  chartNo2.data.datasets[1].data = [...state.histNo2Out];
  chartNo2.update('none');

  chartTemp.data.labels = [...state.labels];
  chartTemp.data.datasets[0].data = [...state.histTemp];
  chartTemp.update('none');

  chartPressure.data.labels = [...state.labels];
  chartPressure.data.datasets[0].data = [...state.histPressure];
  chartPressure.update('none');
}

// Wait for Chart.js to load
if (typeof Chart !== 'undefined') {
  initCharts();
} else {
  document.addEventListener('DOMContentLoaded', initCharts);
}


// ─── 4. THREE.JS 3D SCHEMATIC ──────────────────────
(function init3D() {
  const canvas = document.getElementById('three-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const W = canvas.parentElement.clientWidth;
  const H = canvas.parentElement.clientHeight || 520;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xEFEDE7, 1);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  camera.position.set(6, 4, 9);
  camera.lookAt(0, 0, 0);

  // ─ Lights ─
  scene.add(new THREE.AmbientLight(0xF5F2ED, 0.5));
  const dirLight = new THREE.DirectionalLight(0xFFFFFF, 0.9);
  dirLight.position.set(5, 8, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0xE8EFF5, 0.3);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  const uvPointLight = new THREE.PointLight(0xFFF8E7, 0, 3);
  uvPointLight.position.set(0, 0.3, 0);
  scene.add(uvPointLight);

  // ─ Materials ─
  const matDuct = new THREE.MeshStandardMaterial({ color: 0xE8E6E0, roughness: 0.6, metalness: 0.05 });
  const matInner = new THREE.MeshStandardMaterial({ color: 0xF5F2EC, roughness: 0.8, metalness: 0 });
  const matPCB = new THREE.MeshStandardMaterial({ color: 0x1A2E1A, roughness: 0.8, metalness: 0 });
  const matChip = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0 });
  const matOLED = new THREE.MeshStandardMaterial({ color: 0x0A1F0A, roughness: 0.5, metalness: 0, emissive: 0x0A4A1A, emissiveIntensity: 0.3 });
  const matWireRed = new THREE.MeshStandardMaterial({ color: 0xC0412A, roughness: 0.8, metalness: 0 });
  const matWireGreen = new THREE.MeshStandardMaterial({ color: 0x1A3D2B, roughness: 0.8, metalness: 0 });
  const matWireBrown = new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8, metalness: 0 });
  const matUV = new THREE.MeshStandardMaterial({ color: 0xE8C04A, roughness: 0.4, metalness: 0.1, emissive: 0xE8C04A, emissiveIntensity: 0 });

  // ─ Component registry for raycasting ─
  const interactable = [];
  const wireGroup = new THREE.Group();
  scene.add(wireGroup);

  function addMesh(geo, mat, pos, rot, label, desc, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || scene).add(m);
    if (label) interactable.push({ mesh: m, name: label, desc });
    return m;
  }

  // ─ Duct (4 panels — open ends) ─
  const ductLen = 7, ductH = 1.2, ductD = 1.2, wallT = 0.08;
  // Top
  addMesh(new THREE.BoxGeometry(ductLen, wallT, ductD), matDuct, [0, ductH/2, 0]);
  // Bottom
  addMesh(new THREE.BoxGeometry(ductLen, wallT, ductD), matDuct, [0, -ductH/2, 0]);
  // Front wall
  addMesh(new THREE.BoxGeometry(ductLen, ductH, wallT), matDuct, [0, 0, ductD/2]);
  // Back wall
  addMesh(new THREE.BoxGeometry(ductLen, ductH, wallT), matDuct, [0, 0, -ductD/2]);
  // TiO2 inner lining (front inner)
  addMesh(new THREE.BoxGeometry(ductLen, ductH-0.01, 0.02), matInner, [0, 0, ductD/2-wallT-0.01], null, 'TiO₂ coating', 'Photocatalytic titanium dioxide surface — converts NO₂ to nitrates under UV');

  // ─ UV Lamp ─
  const uvLampMesh = addMesh(new THREE.CylinderGeometry(0.04, 0.04, ductD-0.05, 12), matUV, [0, 0.25, 0], [Math.PI/2, 0, 0], 'UV Lamp', '365nm UV light source — activates TiO₂ photocatalytic reaction');

  // ─ Gas Sensor PCB ─
  const sensorPCB = addMesh(new THREE.BoxGeometry(0.9, 0.06, 0.7), matPCB, [-2.5, -1.2, 0], null, 'Gas Sensor (MQ)', 'Reads analog NO₂ concentration · output fed to STM32 ADC');
  addMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), matChip, [-2.3, -1.1, 0.1], null, null, null, scene);
  addMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), matChip, [-2.7, -1.1, -0.1], null, null, null, scene);

  // ─ BMP180 ─
  addMesh(new THREE.BoxGeometry(0.5, 0.04, 0.4), matPCB, [-1.5, -1.2, 0], null, 'BMP180 Sensor', 'Measures temperature & atmospheric pressure via I2C');
  addMesh(new THREE.BoxGeometry(0.14, 0.06, 0.14), matChip, [-1.5, -1.16, 0], null, null, null, scene);

  // ─ STM32 Board ─
  addMesh(new THREE.BoxGeometry(1.4, 0.06, 1.0), matPCB, [0, -1.2, 0], null, 'STM32 MCU', 'Brain of the system — ADC, I2C, UART · processes sensor data and controls UV relay');
  addMesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), matChip, [0, -1.14, 0], null, null, null, scene);
  // smaller components
  for (let i = 0; i < 4; i++) {
    addMesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), matChip, [-0.45 + i*0.25, -1.14, 0.3], null, null, null, scene);
  }

  // ─ OLED Display (upright) ─
  addMesh(new THREE.BoxGeometry(0.9, 0.6, 0.04), new THREE.MeshStandardMaterial({color:0x111111,roughness:0.5}), [2.5, -0.5, ductD/2+0.1], null, 'OLED Display', 'Shows live NO₂, temperature, pressure & system status locally');
  const oledScreen = addMesh(new THREE.BoxGeometry(0.78, 0.46, 0.01), matOLED, [2.5, -0.5, ductD/2+0.12], null, null, null, scene);

  // ─ Wires using CatmullRom curves ─
  function makeTube(points, mat, r) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const geo = new THREE.TubeGeometry(curve, 12, r || 0.025, 6, false);
    const m = new THREE.Mesh(geo, mat);
    wireGroup.add(m);
    return m;
  }
  // Sensor → STM32
  makeTube([[-2.5, -1.17, 0], [-1.5, -1.3, 0.2], [0, -1.17, 0.4]], matWireBrown);
  // BMP180 → STM32
  makeTube([[-1.5, -1.17, 0], [-0.7, -1.3, 0.2], [0, -1.17, 0.3]], matWireGreen);
  // STM32 → UV lamp
  makeTube([[0, -1.17, 0], [0, -0.5, 0.3], [0, 0.2, 0]], matWireGreen);
  // STM32 → OLED
  makeTube([[0.7, -1.17, 0], [1.8, -1.0, 0.4], [2.5, -0.8, 0.6]], matWireRed);
  // Power wire
  makeTube([[-3.2, -1.5, 0], [-2.5, -1.26, 0]], matWireRed);

  // ─ Ground plane ─
  const groundMesh = addMesh(new THREE.BoxGeometry(12, 0.04, 8), new THREE.MeshStandardMaterial({color: 0xE0DDD6, roughness:1}), [0, -1.8, 0]);
  groundMesh.receiveShadow = true;

  // ─ Particles (3D) ─
  const PART_COUNT = 80;
  const partPositions = new Float32Array(PART_COUNT * 3);
  const partColors = new Float32Array(PART_COUNT * 3);
  const partPhases = new Float32Array(PART_COUNT);
  const partSpeeds = new Float32Array(PART_COUNT);
  const partY = new Float32Array(PART_COUNT);
  const partZ = new Float32Array(PART_COUNT);

  for (let i = 0; i < PART_COUNT; i++) {
    partPhases[i] = Math.random();
    partSpeeds[i] = 0.003 + Math.random() * 0.004;
    partY[i] = (Math.random() - 0.5) * (ductH - 0.3);
    partZ[i] = (Math.random() - 0.5) * (ductD - 0.3);
  }

  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(partPositions, 3));
  partGeo.setAttribute('color', new THREE.BufferAttribute(partColors, 3));

  const partMat = new THREE.PointsMaterial({ size: 0.07, vertexColors: true, sizeAttenuation: true });
  const points = new THREE.Points(partGeo, partMat);
  scene.add(points);

  const colRed = new THREE.Color('#C0412A');
  const colAmber = new THREE.Color('#B87333');
  const colGreen = new THREE.Color('#2A6B47');
  const tmpColor = new THREE.Color();

  function updateParticles3D() {
    const uvOn = state.uvActive;
    for (let i = 0; i < PART_COUNT; i++) {
      partPhases[i] += partSpeeds[i];
      if (partPhases[i] > 1) {
        partPhases[i] -= 1;
        partY[i] = (Math.random() - 0.5) * (ductH - 0.3);
        partZ[i] = (Math.random() - 0.5) * (ductD - 0.3);
      }
      const ph = partPhases[i];
      const x = -ductLen/2 + ph * ductLen;
      partPositions[i*3] = x;
      partPositions[i*3+1] = partY[i];
      partPositions[i*3+2] = partZ[i];

      const uvS = 0.3, uvE = 0.7;
      if (!uvOn) {
        tmpColor.copy(colRed);
      } else if (ph < uvS) {
        tmpColor.copy(colRed);
      } else if (ph < uvE) {
        const t = (ph - uvS) / (uvE - uvS);
        if (t < 0.5) tmpColor.lerpColors(colRed, colAmber, t*2);
        else tmpColor.lerpColors(colAmber, colGreen, (t-0.5)*2);
      } else {
        tmpColor.copy(colGreen);
      }
      partColors[i*3] = tmpColor.r;
      partColors[i*3+1] = tmpColor.g;
      partColors[i*3+2] = tmpColor.b;
    }
    partGeo.attributes.position.needsUpdate = true;
    partGeo.attributes.color.needsUpdate = true;
  }

  // ─ Explode positions ─
  const basePositions = {};
  interactable.forEach((item, idx) => {
    basePositions[idx] = item.mesh.position.clone();
  });

  // ─ Simple orbit controls (manual) ─
  let isDown = false, lastX = 0, lastY = 0;
  let rotX = 0.4, rotY = 0.5;
  let autoRotate = true;
  let autoTimer = null;

  canvas.addEventListener('mousedown', e => {
    isDown = true; lastX = e.clientX; lastY = e.clientY;
    autoRotate = false;
    clearTimeout(autoTimer);
  });
  canvas.addEventListener('mouseup', () => {
    isDown = false;
    autoTimer = setTimeout(() => autoRotate = true, 3000);
  });
  canvas.addEventListener('mousemove', e => {
    if (!isDown) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    rotY += dx * 0.005;
    rotX += dy * 0.005;
    rotX = Math.max(-Math.PI*0.4, Math.min(Math.PI*0.4, rotX));
    lastX = e.clientX; lastY = e.clientY;
    handleHover(e);
  });
  canvas.addEventListener('wheel', e => {
    camera.position.multiplyScalar(1 + e.deltaY * 0.001);
    const d = camera.position.length();
    camera.position.setLength(Math.max(4, Math.min(18, d)));
  }, { passive: true });

  // Touch
  let lastTX = 0, lastTY = 0;
  canvas.addEventListener('touchstart', e => {
    lastTX = e.touches[0].clientX; lastTY = e.touches[0].clientY;
    autoRotate = false; clearTimeout(autoTimer);
  });
  canvas.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - lastTX, dy = e.touches[0].clientY - lastTY;
    rotY += dx * 0.005; rotX += dy * 0.005;
    rotX = Math.max(-Math.PI*0.4, Math.min(Math.PI*0.4, rotX));
    lastTX = e.touches[0].clientX; lastTY = e.touches[0].clientY;
  });
  canvas.addEventListener('touchend', () => {
    autoTimer = setTimeout(() => autoRotate = true, 3000);
  });

  // ─ Raycasting ─
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const labelEl = document.getElementById('component-label');
  const labelName = document.getElementById('label-name');
  const labelDesc = document.getElementById('label-desc');

  function handleHover(e) {
    if (!labelEl) return;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = interactable.map(i => i.mesh);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length > 0) {
      const found = interactable.find(i => i.mesh === hits[0].object);
      if (found) {
        labelName.textContent = found.name;
        labelDesc.textContent = found.desc;
        labelEl.classList.remove('hidden');
        labelEl.style.left = (e.clientX - canvas.getBoundingClientRect().left + 12) + 'px';
        labelEl.style.top = (e.clientY - canvas.getBoundingClientRect().top - 20) + 'px';
        canvas.style.cursor = 'pointer';
        return;
      }
    }
    labelEl.classList.add('hidden');
    canvas.style.cursor = 'grab';
  }
  canvas.addEventListener('mousemove', handleHover);

  // ─ Checkboxes ─
  const chkWire = document.getElementById('chk-wiring');
  const chkExplode = document.getElementById('chk-explode');
  const chkLive = document.getElementById('chk-live');

  if (chkWire) chkWire.addEventListener('change', () => { wireGroup.visible = chkWire.checked; });

  let explodeT = 0, explodeTarget = 0;
  if (chkExplode) chkExplode.addEventListener('change', () => { explodeTarget = chkExplode.checked ? 1 : 0; });

  // ─ Pivot for orbit ─
  const pivot = new THREE.Group();
  // Move all scene children into pivot
  scene.add(pivot);

  // ─ Animate loop ─
  let tick3d = 0;
  function animate() {
    requestAnimationFrame(animate);
    tick3d++;

    if (autoRotate) rotY += 0.003;

    pivot.rotation.x = rotX;
    pivot.rotation.y = rotY;

    // UV effects
    const uvOn = state.uvActive;
    matUV.emissiveIntensity = uvOn ? (0.6 + Math.sin(tick3d * 0.05) * 0.2) : 0;
    uvPointLight.intensity = uvOn ? (0.5 + Math.sin(tick3d * 0.05) * 0.2) : 0;

    // OLED pulse on data update
    if (tick3d % 60 === 0) {
      matOLED.emissiveIntensity = 0.8;
    } else {
      matOLED.emissiveIntensity = Math.max(0.3, matOLED.emissiveIntensity - 0.02);
    }

    // Explode
    explodeT += (explodeTarget - explodeT) * 0.06;
    interactable.forEach((item, idx) => {
      const base = basePositions[idx];
      if (!base) return;
      const dir = base.clone().normalize();
      item.mesh.position.lerpVectors(base, base.clone().add(dir.multiplyScalar(1.5)), explodeT);
    });

    updateParticles3D();
    renderer.render(scene, camera);
  }

  // Move all existing children into pivot
  const toMove = [];
  scene.children.forEach(c => { if (c !== pivot) toMove.push(c); });
  toMove.forEach(c => { scene.remove(c); pivot.add(c); });

  // Reposition camera
  camera.position.set(6, 4, 9);
  camera.lookAt(pivot.position);

  animate();

  // Resize
  window.addEventListener('resize', () => {
    const W2 = canvas.parentElement.clientWidth;
    const H2 = canvas.parentElement.clientHeight || 520;
    renderer.setSize(W2, H2);
    camera.aspect = W2 / H2;
    camera.updateProjectionMatrix();
  });
})();