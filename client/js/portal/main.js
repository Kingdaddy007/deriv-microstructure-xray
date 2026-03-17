import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* ═══════════════════════════════════════════════════════
   Cipher Portal — The Grid Awakening (v3 Cinematic)
   Three.js Scene & Animation Controller
   ═══════════════════════════════════════════════════════ */

// ── DOM References ──
const bootContainer  = document.getElementById('boot-container');
const bootLogo       = document.getElementById('boot-logo');
const bootText       = document.getElementById('boot-text');
const airlockPanel   = document.getElementById('airlock-panel');
const flashOverlay   = document.getElementById('flash-overlay');
const btnDemo        = document.getElementById('btn-demo');
const btnReal        = document.getElementById('btn-real');
const btnInitiate    = document.getElementById('btn-initiate');

// ── State ──
let selectedMode = 'demo';
let phase = 'DARKNESS';
let phaseStartTime = 0;

// ── Account Toggles ──
btnDemo.addEventListener('click', () => {
    selectedMode = 'demo';
    btnDemo.classList.add('active');
    btnReal.classList.remove('active');
});
btnReal.addEventListener('click', () => {
    selectedMode = 'real';
    btnReal.classList.add('active');
    btnDemo.classList.remove('active');
});

// ── Skip Mechanism: click during boot → instant READY ──
document.addEventListener('click', (e) => {
    if (phase !== 'READY' && phase !== 'ENTRY' && !e.target.closest('.glass-panel')) {
        skipToReady();
    }
});

function skipToReady() {
    phase = 'READY';
    bootContainer.classList.remove('visible');
    bootContainer.classList.add('fade-out');

    bloomPass.strength = 0.8;
    gridHelper.material.opacity = 0.35;
    particleMat.opacity = 0.5;
    pillars.position.y = 0;
    heartbeatLight.intensity = 0;

    setTimeout(() => {
        bootContainer.style.display = 'none';
        airlockPanel.classList.add('visible');
    }, 300);
}

// ── Initiate Entry Flight ──
btnInitiate.addEventListener('click', () => {
    if (phase !== 'READY') return;
    phase = 'ENTRY';
    phaseStartTime = clock.getElapsedTime();

    airlockPanel.style.transition = 'opacity 0.2s ease, transform 0.2s ease, filter 0.2s ease';
    airlockPanel.style.opacity = '0';
    airlockPanel.style.transform = 'scale(1.05)';
    airlockPanel.style.filter = 'blur(8px)';

    setTimeout(() => {
        flashOverlay.style.opacity = '1';
        setTimeout(() => {
            window.location.href = 'terminal.html?mode=' + selectedMode;
        }, 600);
    }, 1800);
});

// ═══════════════════════════════════════════════════════
// THREE.JS SCENE SETUP (Cinematic v3)
// ═══════════════════════════════════════════════════════

const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020408, 0.012);

// Camera: On the grid, looking down the corridor
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 1.2, 0);
camera.lookAt(0, 0.8, -100);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x020408);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Post-Processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0, 0.3, 0.9
);
bloomPass.threshold = 0.35;  // Only bloom the brightest emissive points
bloomPass.strength = 0;      // starts dark
bloomPass.radius = 0.5;
composer.addPass(bloomPass);

// ═══════════════════════════════════════════════════════
// SCENE OBJECTS
// ═══════════════════════════════════════════════════════

// 1. Grid Floor
const gridHelper = new THREE.GridHelper(300, 120, new THREE.Color(0x00c8ff), new THREE.Color(0x001a2e));
gridHelper.material.opacity = 0;
gridHelper.material.transparent = true;
gridHelper.material.depthWrite = false;
scene.add(gridHelper);

// 2. Reflective Floor Plane (dark glossy ground beneath the grid)
const floorGeo = new THREE.PlaneGeometry(300, 600);
const floorMat = new THREE.MeshStandardMaterial({
    color: 0x040810,
    roughness: 0.15,
    metalness: 0.9,
    transparent: true,
    opacity: 0.85
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.02;
floor.receiveShadow = true;
scene.add(floor);

// 3. Heartbeat Point Light (at the horizon)
const heartbeatLight = new THREE.PointLight(0x00c8ff, 0, 120);
heartbeatLight.position.set(0, 1.5, -80);
scene.add(heartbeatLight);

// 4. Ambient Light (very dim — lets the environment feel dark)
const ambientLight = new THREE.AmbientLight(0x0a1530, 0.3);
scene.add(ambientLight);

// 5. Directional Light (dramatic side-light for shadows and depth)
const dirLight = new THREE.DirectionalLight(0x3388cc, 0.6);
dirLight.position.set(15, 25, -30);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.left = -50;
dirLight.shadow.camera.right = 50;
dirLight.shadow.camera.top = 50;
dirLight.shadow.camera.bottom = -50;
dirLight.shadow.camera.far = 200;
scene.add(dirLight);

// 6. Rim/Back Light (cinematic blue edge glow from behind the cityscape)
const rimLight = new THREE.PointLight(0x0066ff, 1.5, 200);
rimLight.position.set(0, 8, -120);
scene.add(rimLight);

// 7. Data Pillars — corridor formation with MeshStandardMaterial
const pillarCount = 500;
const pillarGeo = new THREE.BoxGeometry(1, 1, 1);

// Standard material: reacts to light, casts shadows, has depth
const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x0a1929,
    roughness: 0.3,
    metalness: 0.7,
    transparent: true,
    opacity: 0.85,
    emissive: 0x000000,
    emissiveIntensity: 0
});
const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarCount);
pillars.castShadow = true;
pillars.receiveShadow = true;

const dummy = new THREE.Object3D();
const col = new THREE.Color();

for (let i = 0; i < pillarCount; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    // Wider corridor, more depth variation
    const x = side * (3 + Math.random() * 15);
    const z = -(5 + Math.random() * 200);
    const h = 1 + Math.random() * 8;
    const w = 0.4 + Math.random() * 1.2;

    dummy.position.set(x, h / 2, z);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    pillars.setMatrixAt(i, dummy.matrix);

    // Color: deep blues/purples with occasional bright cyan or white accent
    const roll = Math.random();
    if (roll > 0.95) {
        col.setHex(0x00ddff);  // bright cyan emissive accent
    } else if (roll > 0.88) {
        col.setHex(0x3366cc);  // medium blue glow
    } else if (roll > 0.75) {
        col.setHex(0x1a2a4a);  // dark navy
    } else {
        col.setHex(0x080e1c);  // near-black structural
    }
    pillars.setColorAt(i, col);
}
pillars.position.y = -8; // start below, will rise
scene.add(pillars);

// 8. Floating Particles
const particleCount = 1200;
const positions = new Float32Array(particleCount * 3);
const particleSpeeds = new Float32Array(particleCount);
for (let i = 0; i < particleCount; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 50;
    positions[i * 3 + 1] = Math.random() * 12;
    positions[i * 3 + 2] = -(Math.random() * 150);
    particleSpeeds[i] = 0.1 + Math.random() * 0.3;
}
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particleMat = new THREE.PointsMaterial({
    size: 0.04,
    color: 0x4488ee,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

// 9. Horizon Glow (large emissive sphere behind the cityscape)
const horizonGeo = new THREE.SphereGeometry(15, 16, 8);
const horizonMat = new THREE.MeshBasicMaterial({
    color: 0x003366,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide
});
const horizonGlow = new THREE.Mesh(horizonGeo, horizonMat);
horizonGlow.position.set(0, 2, -150);
scene.add(horizonGlow);

// ── Mouse Parallax ──
let mouseX = 0, mouseY = 0;
document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
});

// ── Resize ──
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// ═══════════════════════════════════════════════════════
// BOOT TIMELINE (matches design brief exactly)
// ═══════════════════════════════════════════════════════

const BOOT_TIMELINE = {
    DARKNESS:     { start: 0,   end: 1   },
    HEARTBEAT:    { start: 1,   end: 1.5 },
    GRID_RIPPLE:  { start: 1.5, end: 3   },
    LOGO_TRACE:   { start: 3,   end: 4   },
    TEXT_REVEAL:  { start: 4,   end: 5   },
    READY:        { start: 5 }
};

let bootPhaseTriggered = {
    heartbeat: false,
    gridRipple: false,
    logoTrace: false,
    textReveal: false,
    ready: false
};

const CIPHER_LETTERS = ['C', 'I', 'P', 'H', 'E', 'R'];
let revealedLetters = 0;

// ═══════════════════════════════════════════════════════
// FLAME / FIRE RING EFFECT (CSS-driven on logo, triggered from JS)
// ═══════════════════════════════════════════════════════

function activateFlameRing() {
    if (bootLogo) {
        bootLogo.classList.add('flame-active');
    }
}

function deactivateFlameRing() {
    if (bootLogo) {
        bootLogo.classList.remove('flame-active');
    }
}

// ═══════════════════════════════════════════════════════
// ANIMATION LOOP
// ═══════════════════════════════════════════════════════
const clock = new THREE.Clock();
const cameraBaseY = 1.2;

function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // ── Mouse parallax (gentle) ──
    if (phase !== 'ENTRY') {
        camera.position.x += (mouseX * 0.4 - camera.position.x) * 0.025;
        const targetY = cameraBaseY + mouseY * 0.15;
        camera.position.y += (targetY - camera.position.y) * 0.025;
        camera.lookAt(0, 0.8, -100);
    }

    // ── Grid infinite scroll toward user ──
    const gridCellSize = 300 / 120;
    gridHelper.position.z = (t * 1.2) % gridCellSize;

    // ── Particles gentle upward drift ──
    const posArr = particleGeo.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
        posArr[i * 3 + 1] += particleSpeeds[i] * 0.005;
        if (posArr[i * 3 + 1] > 12) posArr[i * 3 + 1] = 0;
    }
    particleGeo.attributes.position.needsUpdate = true;
    particles.rotation.y = t * 0.01;

    // ── Horizon glow breathing ──
    horizonMat.opacity = 0.08 + Math.sin(t * 0.4) * 0.04;

    // ═══════ PHASE: DARKNESS (0-1s) ═══════
    if (phase === 'DARKNESS') {
        if (t >= BOOT_TIMELINE.HEARTBEAT.start) {
            phase = 'HEARTBEAT';
        }
    }

    // ═══════ PHASE: HEARTBEAT (1-1.5s) ═══════
    else if (phase === 'HEARTBEAT') {
        const pulse = Math.sin(t * 8) * 0.5 + 0.5;
        heartbeatLight.intensity = pulse * 4;
        gridHelper.material.opacity = pulse * 0.04;

        // Subtle bloom begins
        bloomPass.strength = pulse * 0.15;

        if (t >= BOOT_TIMELINE.GRID_RIPPLE.start) {
            phase = 'GRID_RIPPLE';
        }
    }

    // ═══════ PHASE: GRID_RIPPLE (1.5-3s) ═══════
    else if (phase === 'GRID_RIPPLE') {
        const progress = (t - BOOT_TIMELINE.GRID_RIPPLE.start)
                       / (BOOT_TIMELINE.GRID_RIPPLE.end - BOOT_TIMELINE.GRID_RIPPLE.start);

        // Grid illuminates gradually
        gridHelper.material.opacity = THREE.MathUtils.lerp(0.04, 0.3, progress);

        // Bloom rises cleanly
        bloomPass.strength = THREE.MathUtils.lerp(0.15, 0.6, progress);

        // Heartbeat fades as ambient rises
        const pulse = Math.sin(t * 6) * 0.5 + 0.5;
        heartbeatLight.intensity = (1 - progress * 0.6) * pulse * 4;

        // Directional light fades in
        dirLight.intensity = THREE.MathUtils.lerp(0, 0.6, progress);

        // Pillars begin rising
        pillars.position.y = THREE.MathUtils.lerp(-8, -2, progress);

        // Particles appear
        particleMat.opacity = progress * 0.25;

        // Floor becomes visible
        floorMat.opacity = THREE.MathUtils.lerp(0, 0.85, progress);

        if (t >= BOOT_TIMELINE.LOGO_TRACE.start) {
            phase = 'LOGO_TRACE';
            bootContainer.classList.add('visible');
            bootLogo.classList.add('tracing');
            // Activate the flame ring around the logo
            activateFlameRing();
        }
    }

    // ═══════ PHASE: LOGO_TRACE (3-4s) ═══════
    else if (phase === 'LOGO_TRACE') {
        gridHelper.material.opacity = THREE.MathUtils.lerp(gridHelper.material.opacity, 0.35, 0.02);
        bloomPass.strength = THREE.MathUtils.lerp(bloomPass.strength, 0.7, 0.02);
        pillars.position.y = THREE.MathUtils.lerp(pillars.position.y, -0.5, 0.02);
        particleMat.opacity = THREE.MathUtils.lerp(particleMat.opacity, 0.35, 0.02);
        heartbeatLight.intensity *= 0.97;

        // Emissive pulse on pillar material during logo trace
        const emPulse = Math.sin(t * 4) * 0.5 + 0.5;
        pillarMat.emissive.setHex(0x001133);
        pillarMat.emissiveIntensity = emPulse * 0.3;

        if (t >= BOOT_TIMELINE.TEXT_REVEAL.start) {
            phase = 'TEXT_REVEAL';
            revealedLetters = 0;
            revealNextLetter();
        }
    }

    // ═══════ PHASE: TEXT_REVEAL (4-5s) ═══════
    else if (phase === 'TEXT_REVEAL') {
        gridHelper.material.opacity = THREE.MathUtils.lerp(gridHelper.material.opacity, 0.35, 0.02);
        bloomPass.strength = THREE.MathUtils.lerp(bloomPass.strength, 0.8, 0.02);
        pillars.position.y = THREE.MathUtils.lerp(pillars.position.y, 0, 0.02);
        particleMat.opacity = THREE.MathUtils.lerp(particleMat.opacity, 0.4, 0.02);

        // Settle emissive
        pillarMat.emissiveIntensity = THREE.MathUtils.lerp(pillarMat.emissiveIntensity, 0.1, 0.02);

        if (t >= BOOT_TIMELINE.READY.start && !bootPhaseTriggered.ready) {
            bootPhaseTriggered.ready = true;
            deactivateFlameRing();
            transitionToReady();
        }
    }

    // ═══════ PHASE: READY ═══════
    else if (phase === 'READY') {
        // Subtle idle breathing
        bloomPass.strength = 0.7 + Math.sin(t * 0.5) * 0.1;
        gridHelper.material.opacity = 0.28 + Math.sin(t * 0.3) * 0.04;
        pillars.position.y = THREE.MathUtils.lerp(pillars.position.y, 0, 0.05);

        // Gentle emissive pulse on pillars
        const emIdle = Math.sin(t * 0.8) * 0.5 + 0.5;
        pillarMat.emissive.setHex(0x001122);
        pillarMat.emissiveIntensity = emIdle * 0.08;
    }

    // ═══════ PHASE: ENTRY (fly-through) ═══════
    else if (phase === 'ENTRY') {
        const entryT = t - phaseStartTime;
        const speed = Math.pow(entryT, 2) * 3;

        camera.fov = THREE.MathUtils.lerp(camera.fov, 110, 0.04);
        camera.updateProjectionMatrix();

        camera.position.z -= speed * 0.15;
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0.3, 0.03);
        camera.lookAt(0, 0.25, camera.position.z - 50);

        // Bloom intensifies
        bloomPass.strength = THREE.MathUtils.lerp(bloomPass.strength, 4.0, 0.05);

        // Emissive pillars light up as you fly past
        pillarMat.emissive.setHex(0x0066ff);
        pillarMat.emissiveIntensity = THREE.MathUtils.lerp(pillarMat.emissiveIntensity, 1.0, 0.04);

        // Grid shifts bright
        gridHelper.material.color.lerp(new THREE.Color(0x88ddff), 0.02);
    }

    composer.render();
}

// ── Letter-by-letter "CIPHER" reveal ──
function revealNextLetter() {
    if (revealedLetters < CIPHER_LETTERS.length) {
        bootText.textContent += CIPHER_LETTERS[revealedLetters];
        revealedLetters++;
        setTimeout(revealNextLetter, 120);
    }
}

// ── Transition from boot to ready state ──
function transitionToReady() {
    phase = 'READY';

    bootContainer.classList.remove('visible');
    bootContainer.classList.add('fade-out');

    setTimeout(() => {
        bootContainer.style.display = 'none';
        airlockPanel.classList.add('visible');
    }, 600);
}

// Start the loop
animate();
