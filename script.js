import * as THREE from /* @vite-ignore */ 'https://cdn.skypack.dev/three@0.158.0';
import { OrbitControls } from /* @vite-ignore */ 'https://cdn.skypack.dev/three@0.158.0/examples/jsm/controls/OrbitControls.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Particle Generation for Hero (Original Section 1 Logic)
    const inGroup = document.getElementById('particles-in');
    const outGroup = document.getElementById('particles-out');
    
    function createParticles(group, count, isClean = false) {
        for (let i = 0; i < count; i++) {
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            const r = 2 + Math.random() * 2;
            const x = 50 + Math.random() * 50;
            const y = 110 + Math.random() * 80;
            
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', r);
            circle.classList.add('particle');
            if (isClean) circle.classList.add('clean');
            
            const duration = 2.8 + Math.random() * 1.4;
            const delay = Math.random() * 2;
            circle.style.animationDuration = `${duration}s`;
            circle.style.animationDelay = `${delay}s`;
            group.appendChild(circle);
        }
    }
    createParticles(inGroup, 20);
    createParticles(outGroup, 20, true);

    // 2. Intersection Observer for Scroll Animations
    const observerOptions = { threshold: 0.2 };
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                if (entry.target.id === 'comparison') animateComparison();
                else if (entry.target.classList.contains('process-track')) animateProcess();
                else if (entry.target.classList.contains('stage')) entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    observer.observe(document.getElementById('comparison'));
    document.querySelectorAll('.stage').forEach(stage => observer.observe(stage));
    observer.observe(document.querySelector('.process-track'));

    function animateComparison() {
        const bar = document.getElementById('reduction-bar-active');
        const counter = document.getElementById('reduction-counter');
        bar.style.width = '74%';
        let count = 0;
        const target = 74;
        const duration = 1500;
        const startTime = performance.now();
        function updateCounter(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            counter.innerText = Math.floor(progress * target);
            if (progress < 1) requestAnimationFrame(updateCounter);
        }
        requestAnimationFrame(updateCounter);
    }

    function animateProcess() {
        const rule = document.querySelector('.process-rule');
        rule.style.transform = 'scaleX(1)';
    }

    // 3. Live Data Simulation State
    let currentIncoming = 182;
    let currentOutgoing = 47;
    let currentTemp = 24.2;
    let currentPressure = 1013;
    let history = [];
    const maxHistory = 40;

    // 4. Three.js Interactive Schematic Implementation
    const scene = new THREE.Scene();
    const viewport = document.getElementById('schematic-viewport');
    const canvas = document.getElementById('schematic-canvas');
    const labelsContainer = document.getElementById('schematic-labels');
    
    const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);
    camera.position.set(6, 4, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap; // Faster than PCFSoft
    canvas.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15; // Snappier damping
    controls.minDistance = 4;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI * 0.75;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 2.5; // Faster rotation

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xF5F2ED, 0.5);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xFFFFFF, 0.8);
    keyLight.position.set(5, 8, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024); // Lower res for speed
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xE8EFF5, 0.3);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    // 3D Components Construction
    const components = new THREE.Group();
    scene.add(components);

    const materialPalette = {
        duct: new THREE.MeshStandardMaterial({ color: 0xE8E6E0, roughness: 0.6, metalness: 0.1 }),
        lining: new THREE.MeshStandardMaterial({ color: 0xF0EDE6, roughness: 0.8 }),
        pcb: new THREE.MeshStandardMaterial({ color: 0x1A2E1A, roughness: 0.8, metalness: 0.0 }),
        chip: new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.5 }),
        screen: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xA8BCCC, emissiveIntensity: 0.3 }),
        lampOff: new THREE.MeshStandardMaterial({ color: 0x888888 }),
        lampOn: new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFF3CC, emissiveIntensity: 0.8 })
    };

    // Duct (4 panels)
    const ductGroup = new THREE.Group();
    ductGroup.userData = { name: "Intervention Duct", desc: "Main photocatalytic treatment chamber.", originalPos: new THREE.Vector3(0, 0, 0) };
    const pSize = { w: 8, h: 2, d: 2, t: 0.05 };
    
    const panels = [
        { size: [pSize.w, pSize.t, pSize.d], pos: [0, pSize.h/2, 0] }, // Top
        { size: [pSize.w, pSize.t, pSize.d], pos: [0, -pSize.h/2, 0] }, // Bottom
        { size: [pSize.w, pSize.h, pSize.t], pos: [0, 0, pSize.d/2] }, // Front Wall
        { size: [pSize.w, pSize.h, pSize.t], pos: [0, 0, -pSize.d/2] } // Back Wall
    ];

    panels.forEach(p => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.size), materialPalette.duct);
        mesh.position.set(...p.pos);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        ductGroup.add(mesh);
        
        // Inner lining
        const lining = new THREE.Mesh(new THREE.BoxGeometry(p.size[0], p.size[1]*1.1, p.size[2]*1.1), materialPalette.lining);
        lining.position.copy(mesh.position);
        lining.scale.set(0.99, 0.99, 0.99);
        ductGroup.add(lining);
    });
    components.add(ductGroup);

    // UV Lamp
    const uvLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 8), materialPalette.lampOff); // Lower segments
    uvLamp.rotation.z = Math.PI / 2;
    uvLamp.position.set(0, 0.3, 0);
    uvLamp.userData = { name: "UV-C Lamp", desc: "Triggers the photocatalytic reaction on TiO2 surface.", originalPos: new THREE.Vector3(0, 0.3, 0) };
    ductGroup.add(uvLamp);

    const uvLight = new THREE.PointLight(0xFFF8E7, 0, 4);
    uvLight.position.copy(uvLamp.position);
    ductGroup.add(uvLight);

    // STM32 Board
    const stm32 = new THREE.Group();
    stm32.position.set(0, 0.5, -3);
    stm32.userData = { name: "STM32 Controller", desc: "Central processing unit for real-time sensor logic.", originalPos: new THREE.Vector3(0, 0.5, -3) };
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 1), materialPalette.pcb);
    pcb.castShadow = true;
    stm32.add(pcb);
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), materialPalette.chip);
    chip.position.y = 0.05;
    stm32.add(chip);
    components.add(stm32);

    // Gas Sensor
    const gasSensor = new THREE.Group();
    gasSensor.position.set(-5, -0.5, 1);
    gasSensor.userData = { name: "MQ-135 Gas Sensor", desc: "Detects NO2 concentration levels in ambient air.", originalPos: new THREE.Vector3(-5, -0.5, 1) };
    const sensorPcb = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.8), materialPalette.pcb);
    gasSensor.add(sensorPcb);
    [[-0.2, 0.2], [0.2, 0.2]].forEach(p => {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8), materialPalette.lampOff);
        cyl.position.set(p[0], 0.15, p[1]);
        gasSensor.add(cyl);
    });
    components.add(gasSensor);

    // BMP180
    const bmp180 = new THREE.Group();
    bmp180.position.set(-4.5, 0.5, -1);
    bmp180.userData = { name: "BMP180 Sensor", desc: "Monitors atmospheric pressure and temperature.", originalPos: new THREE.Vector3(-4.5, 0.5, -1) };
    const bmpPcb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), materialPalette.pcb);
    bmp180.add(bmpPcb);
    components.add(bmp180);

    // OLED
    const oled = new THREE.Group();
    oled.position.set(3, 0.5, 3);
    oled.rotation.y = -Math.PI / 4;
    oled.userData = { name: "OLED Status Display", desc: "Local visualization for direct system monitoring.", originalPos: new THREE.Vector3(3, 0.5, 3) };
    const oledFrame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.1), materialPalette.chip);
    const oledScreen = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.02), materialPalette.screen);
    oledScreen.position.z = 0.05;
    oled.add(oledFrame, oledScreen);
    components.add(oled);

    // Wires
    const wires = new THREE.Group();
    scene.add(wires);

    function createWire(start, end, color) {
        const points = [
            start,
            new THREE.Vector3().lerpVectors(start, end, 0.3).add(new THREE.Vector3(0, -0.5, 0)),
            new THREE.Vector3().lerpVectors(start, end, 0.7).add(new THREE.Vector3(0, -0.5, 0)),
            end
        ];
        const curve = new THREE.CatmullRomCurve3(points);
        const geo = new THREE.TubeGeometry(curve, 8, 0.02, 4, false); // Massive segment reduction
        const mat = new THREE.MeshStandardMaterial({ color });
        return new THREE.Mesh(geo, mat);
    }

    const wireConfigs = [
        { start: gasSensor.position, end: stm32.position, color: 0x8B7355 },
        { start: bmp180.position, end: stm32.position, color: 0x1A3D2B },
        { start: oled.position, end: stm32.position, color: 0x1A3D2B },
        { start: new THREE.Vector3(0, 1, 0), end: stm32.position, color: 0xC0412A }
    ];
    wireConfigs.forEach(c => wires.add(createWire(c.start, c.end, c.color)));

    // Particles (Instanced)
    const particleCount = 120;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(particleCount * 3);
    const pPhase = new Float32Array(particleCount);
    const pColor = new Float32Array(particleCount * 3);

    for(let i=0; i<particleCount; i++) {
        pPhase[i] = Math.random();
        pPos[i*3] = (pPhase[i] - 0.5) * 8;
        pPos[i*3+1] = (Math.random() - 0.5) * 1.5;
        pPos[i*3+2] = (Math.random() - 0.5) * 1.5;
    }

    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('phase', new THREE.BufferAttribute(pPhase, 1));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pColor, 3));

    // Programmatic Sprite Texture
    const canvasP = document.createElement('canvas');
    canvasP.width = 32; canvasP.height = 32;
    const ctxP = canvasP.getContext('2d');
    const gradP = ctxP.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradP.addColorStop(0, 'white'); gradP.addColorStop(1, 'transparent');
    ctxP.fillStyle = gradP; ctxP.fillRect(0, 0, 32, 32);
    const pTex = new THREE.CanvasTexture(canvasP);

    const pMat = new THREE.PointsMaterial({ size: 0.12, vertexColors: true, map: pTex, transparent: true, depthWrite: false });
    const pSystem = new THREE.Points(pGeo, pMat);
    components.add(pSystem);

    // Interaction & Animation
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hovered = null;
    const label = document.createElement('div');
    label.className = 'schematic-label';
    labelsContainer.appendChild(label);

    window.addEventListener('mousemove', (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    });

    const uiToggles = {
        wiring: document.getElementById('toggle-wiring'),
        explode: document.getElementById('toggle-explode'),
        live: document.getElementById('toggle-live')
    };

    function updateParticles(uvActive) {
        const pos = pGeo.attributes.position.array;
        const phases = pGeo.attributes.phase.array;
        const colors = pGeo.attributes.color.array;

        for(let i=0; i<particleCount; i++) {
            phases[i] += 0.012 + Math.random() * 0.018; // Even faster (5x original)
            if(phases[i] > 1.0) {
                phases[i] = 0;
                pos[i*3+1] = (Math.random() - 0.5) * 1.5;
                pos[i*3+2] = (Math.random() - 0.5) * 1.5;
            }
            pos[i*3] = (phases[i] - 0.5) * 8;

            // Color Logic
            let r=0.75, g=0.25, b=0.16; // Default Terracotta
            if (uvActive && phases[i] > 0.45) {
                if (phases[i] < 0.6) {
                    // Amber transition
                    r = 0.72; g = 0.45; b = 0.2;
                } else {
                    // Clean Green
                    r = 0.16; g = 0.42; b = 0.28;
                }
            }
            colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
        }
        pGeo.attributes.position.needsUpdate = true;
        pGeo.attributes.phase.needsUpdate = true;
        pGeo.attributes.color.needsUpdate = true;
    }

    function animate() {
        requestAnimationFrame(animate);
        controls.update();

        // Hover Detection
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(components.children, true);
        
        let found = null;
        if (intersects.length > 0) {
            let obj = intersects[0].object;
            while(obj.parent && !obj.userData.name) obj = obj.parent;
            if(obj.userData.name) found = obj;
        }

        if (found !== hovered) {
            if (hovered) hovered.position.y -= 0.15;
            hovered = found;
            if (hovered) {
                hovered.position.y += 0.15;
                label.innerHTML = `<strong>${hovered.userData.name}</strong><br>${hovered.userData.desc}`;
                label.classList.add('visible');
            } else {
                label.classList.remove('visible');
            }
        }

        if (hovered) {
            const vector = new THREE.Vector3();
            hovered.getWorldPosition(vector);
            vector.project(camera);
            label.style.left = `${(vector.x + 1) / 2 * viewport.clientWidth}px`;
            label.style.top = `${(-vector.y + 1) / 2 * viewport.clientHeight}px`;
        }

        // Explode View (Smooth Snappy Lerp)
        const explodeFactor = uiToggles.explode.checked ? 1.8 : 0;
        components.children.forEach(c => {
            if(c === pSystem || !c.userData.originalPos) return;
            const targetPos = c.userData.originalPos.clone().add(c.userData.originalPos.clone().normalize().multiplyScalar(explodeFactor));
            c.position.lerp(targetPos, 0.15); // Fast lerp
        });
        
        // Duct internal parts follow duct
        uvLamp.position.lerp(uvLamp.userData.originalPos, 0.15);

        // Wires Visibility
        wires.visible = uiToggles.wiring.checked;

        // UV System Simulation
        const uvActive = currentOutgoing < 60;
        uvLamp.material = uvActive ? materialPalette.lampOn : materialPalette.lampOff;
        uvLight.intensity = uvActive ? 0.8 : 0;
        
        updateParticles(uvActive);
        
        renderer.render(scene, camera);
    }

    animate();

    // Data Integration
    const no2Readout = document.getElementById('current-no2-readout');
    const uiIn = document.getElementById('ui-in-val');
    const uiOut = document.getElementById('ui-out-val');
    const uvStatusEl = document.getElementById('uv-status');

    function updateLiveReadouts(incoming, outgoing, temp, pressure) {
        currentIncoming = incoming;
        currentOutgoing = outgoing;
        currentTemp = temp;
        currentPressure = pressure;

        no2Readout.innerText = incoming.toFixed(2);
        uiIn.innerText = incoming.toFixed(0);
        uiOut.innerText = outgoing.toFixed(0);

        if (outgoing < 60) {
            uvStatusEl.innerText = 'active';
            uvStatusEl.classList.add('active');
            materialPalette.screen.emissiveIntensity = 0.8;
            setTimeout(() => materialPalette.screen.emissiveIntensity = 0.3, 400);
        } else {
            uvStatusEl.innerText = 'standby';
            uvStatusEl.classList.remove('active');
        }
    }

    setInterval(() => {
        if (!uiToggles.live.checked) return;
        const incoming = 160 + Math.random() * 40;
        const outgoing = 38 + Math.random() * 17;
        const temp = 23 + Math.random() * 3;
        const pressure = 1010 + Math.random() * 5;
        updateLiveReadouts(incoming, outgoing, temp, pressure);
    }, 1000);

    window.addEventListener('resize', () => {
        camera.aspect = viewport.clientWidth / viewport.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    });

});
