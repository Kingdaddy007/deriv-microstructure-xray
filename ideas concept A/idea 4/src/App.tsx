import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const accountModes = ["REAL ACCOUNT", "DEMO ACCOUNT"] as const;

type AccountMode = (typeof accountModes)[number];

function CipherMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      aria-hidden="true"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="cipher-stroke" x1="18" y1="14" x2="102" y2="106" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C5CFC" />
          <stop offset="0.5" stopColor="#4EA8F6" />
          <stop offset="1" stopColor="#E5A820" />
        </linearGradient>
      </defs>
      <path d="M60 10L97 31.5V73.5L60 95L23 73.5V31.5L60 10Z" stroke="url(#cipher-stroke)" strokeWidth="3" />
      <path d="M60 23L85.5 37.8V67.3L60 82L34.5 67.3V37.8L60 23Z" stroke="url(#cipher-stroke)" strokeOpacity="0.78" strokeWidth="2.4" />
      <path d="M60 10V95" stroke="url(#cipher-stroke)" strokeOpacity="0.7" strokeWidth="1.8" />
      <path d="M23 31.5L60 52.5L97 31.5" stroke="url(#cipher-stroke)" strokeOpacity="0.58" strokeWidth="1.8" />
      <path d="M23 73.5L60 52.5L97 73.5" stroke="url(#cipher-stroke)" strokeOpacity="0.58" strokeWidth="1.8" />
      <circle cx="60" cy="52.5" r="4" fill="#4EA8F6" fillOpacity="0.95" />
    </svg>
  );
}

function Starfield() {
  const pointsRef = useRef<THREE.Points>(null);

  const geometry = useMemo(() => {
    const total = 2200;
    const positions = new Float32Array(total * 3);

    for (let i = 0; i < total; i += 1) {
      const radius = 7 + Math.random() * 10;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.68;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return starGeometry;
  }, []);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.01;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color="#86c8ff" size={0.04} sizeAttenuation transparent opacity={0.75} depthWrite={false} />
    </points>
  );
}

function EnergyBands() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();
    groupRef.current.rotation.z = t * 0.08;
    groupRef.current.children.forEach((child, index) => {
      child.rotation.x = t * (0.18 + index * 0.04);
      child.rotation.y = t * (0.24 + index * 0.05);
    });
  });

  return (
    <group ref={groupRef}>
      <mesh rotation={[1.05, 0, 0]}>
        <torusGeometry args={[2.1, 0.022, 32, 240]} />
        <meshStandardMaterial color="#4ea8f6" emissive="#4ea8f6" emissiveIntensity={1.9} metalness={0.9} roughness={0.16} />
      </mesh>
      <mesh rotation={[0.4, 0.3, 1.1]} scale={1.14}>
        <torusGeometry args={[1.8, 0.016, 32, 220]} />
        <meshStandardMaterial color="#7c5cfc" emissive="#7c5cfc" emissiveIntensity={1.5} metalness={0.95} roughness={0.18} />
      </mesh>
      <mesh rotation={[-0.82, -0.25, 0.52]} scale={0.92}>
        <torusGeometry args={[2.35, 0.012, 24, 220]} />
        <meshStandardMaterial color="#e5a820" emissive="#e5a820" emissiveIntensity={1.15} metalness={0.9} roughness={0.2} />
      </mesh>
    </group>
  );
}

function CoreShell() {
  const groupRef = useRef<THREE.Group>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();

    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.22;
      groupRef.current.rotation.x = Math.sin(t * 0.45) * 0.12;
      groupRef.current.position.y = Math.sin(t * 0.7) * 0.08;
    }

    if (outerRef.current) {
      outerRef.current.rotation.z = Math.cos(t * 0.35) * 0.15;
      outerRef.current.scale.setScalar(1 + Math.sin(t * 0.9) * 0.018);
    }

    if (innerRef.current) {
      innerRef.current.rotation.x = -t * 0.5;
      innerRef.current.rotation.y = t * 0.75;
    }

    if (haloRef.current) {
      haloRef.current.rotation.z = t * 0.1;
      haloRef.current.material.opacity = 0.18 + Math.sin(t * 1.2) * 0.03;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0.1, 0]}>
      <mesh ref={outerRef} castShadow receiveShadow>
        <icosahedronGeometry args={[1.22, 3]} />
        <meshPhysicalMaterial
          color="#09101a"
          emissive="#143a5a"
          emissiveIntensity={0.32}
          metalness={0.82}
          roughness={0.12}
          transmission={0.4}
          thickness={1}
          clearcoat={1}
          clearcoatRoughness={0.12}
        />
      </mesh>

      <mesh ref={innerRef} scale={0.54}>
        <octahedronGeometry args={[1, 2]} />
        <meshStandardMaterial color="#020407" emissive="#72bbff" emissiveIntensity={0.56} metalness={1} roughness={0.14} />
      </mesh>

      <mesh ref={haloRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.36, 1.82, 96]} />
        <meshBasicMaterial color="#4ea8f6" transparent opacity={0.18} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

      <EnergyBands />
    </group>
  );
}

function TacticalBeams() {
  const beamRefs = useRef<Array<THREE.Mesh | null>>([]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    beamRefs.current.forEach((beam, index) => {
      if (!beam) return;
      const material = beam.material;
      if (Array.isArray(material)) return;
      (material as THREE.MeshBasicMaterial).opacity = 0.07 + Math.sin(t * 0.9 + index) * 0.015;
    });
  });

  const register = (mesh: THREE.Mesh | null, index: number) => {
    beamRefs.current[index] = mesh;
  };

  return (
    <group>
      <mesh ref={(mesh) => register(mesh, 0)} position={[-4.6, 1.8, -2.8]} scale={[0.3, 9.4, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#4ea8f6" transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={(mesh) => register(mesh, 1)} position={[4.8, 1.6, -2.4]} scale={[0.24, 8.2, 1]} rotation={[0, 0, 0.16]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#7c5cfc" transparent opacity={0.08} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={(mesh) => register(mesh, 2)} position={[0, -3.55, -3.1]} scale={[8.8, 0.16, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#e5a820" transparent opacity={0.07} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#05070c"]} />
      <fog attach="fog" args={["#05070c", 8, 20]} />
      <ambientLight intensity={0.42} color="#89bfff" />
      <directionalLight position={[3.8, 4.2, 3]} intensity={1.7} color="#dce7ff" castShadow />
      <directionalLight position={[-4.2, -1.6, 1.8]} intensity={0.72} color="#7c5cfc" />
      <pointLight position={[0, 0.4, 2.5]} intensity={16} distance={10} color="#4ea8f6" />
      <pointLight position={[0, -2.2, -1.8]} intensity={4.5} distance={10} color="#e5a820" />
      <TacticalBeams />
      <Starfield />
      <CoreShell />
    </>
  );
}

function StatPill({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "profit" | "risk" | "warning" }) {
  const toneClasses = {
    neutral: "border-white/10 text-slate-300",
    profit: "border-emerald-400/25 text-emerald-300",
    risk: "border-rose-400/25 text-rose-300",
    warning: "border-amber-400/25 text-amber-300",
  } as const;

  return (
    <div className={`rounded-full border bg-white/5 px-3 py-2 backdrop-blur-md ${toneClasses[tone]}`}>
      <div className="text-[0.56rem] uppercase tracking-[0.28em] text-white/45">{label}</div>
      <div className="mt-1 font-mono text-[0.78rem] tracking-[0.16em]">{value}</div>
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(19,26,36,0.82),rgba(10,14,20,0.68))] shadow-[0_30px_120px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl ${className}`}
    >
      {children}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<AccountMode>("REAL ACCOUNT");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsReady(true), 450);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070c] text-white selection:bg-cyan-400/30 selection:text-white">
      <div className="absolute inset-0">
        <Canvas dpr={[1, 1.5]} shadows camera={{ position: [0, 0, 6.3], fov: 38 }} gl={{ antialias: true, alpha: true }}>
          <Scene />
        </Canvas>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(78,168,246,0.16),transparent_16%),radial-gradient(circle_at_50%_52%,rgba(124,92,252,0.1),transparent_25%),linear-gradient(180deg,rgba(5,7,12,0.1),rgba(5,7,12,0.7)_68%,rgba(5,7,12,0.94))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:120px_120px] opacity-[0.08]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/10 shadow-[0_0_180px_rgba(78,168,246,0.08)]" />

      <div className="relative z-10 flex min-h-screen flex-col justify-between p-5 sm:p-8 lg:p-10">
        <header className="flex items-start justify-between gap-6">
          <div className="max-w-md">
            <div className="mb-3 flex items-center gap-3 text-[0.66rem] uppercase tracking-[0.42em] text-white/60">
              <CipherMark className="h-8 w-8" />
              <span>CIPHER AIRLOCK</span>
            </div>
            <p className="max-w-sm text-xs uppercase tracking-[0.3em] text-white/32 sm:text-[0.7rem]">
              Volatility 100 synthetic indices · touch/no-touch barrier workflow · 24/7 quant execution
            </p>
          </div>

          <div className="hidden items-center gap-3 lg:flex">
            <StatPill label="Market" value="V100 LIVE" tone="profit" />
            <StatPill label="Window" value="05S–05M" tone="warning" />
            <StatPill label="Risk" value="BARRIER OPS" tone="risk" />
          </div>
        </header>

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:py-10">
          <div className="max-w-3xl self-center">
            <div className={`transition-all duration-1000 ${isReady ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}>
              <div className="mb-5 flex items-center gap-3 text-[0.66rem] uppercase tracking-[0.38em] text-cyan-200/82">
                <div className="h-px w-14 bg-gradient-to-r from-cyan-300/80 to-transparent" />
                Institutional-grade synthetic index terminal
              </div>
              <h1 className="text-[clamp(4rem,12vw,10rem)] font-semibold leading-[0.88] tracking-[0.45em] text-white/96 drop-shadow-[0_0_24px_rgba(78,168,246,0.12)]">
                CIPHER
              </h1>
              <div className="mt-4 max-w-2xl space-y-4">
                <p className="max-w-xl text-sm leading-7 text-slate-300/80 sm:text-base">
                  Enter a disciplined operating state for ultra-short-horizon barrier decisions. Precision in time. Precision in price. Nothing else.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Panel className="p-4">
                    <div className="text-[0.62rem] uppercase tracking-[0.32em] text-white/42">Execution model</div>
                    <div className="mt-2 font-mono text-sm tracking-[0.14em] text-cyan-100">TOUCH / NO-TOUCH</div>
                  </Panel>
                  <Panel className="p-4">
                    <div className="text-[0.62rem] uppercase tracking-[0.32em] text-white/42">Decision tempo</div>
                    <div className="mt-2 font-mono text-sm tracking-[0.14em] text-emerald-300">05 SEC → 05 MIN</div>
                  </Panel>
                  <Panel className="p-4">
                    <div className="text-[0.62rem] uppercase tracking-[0.32em] text-white/42">Mindset</div>
                    <div className="mt-2 font-mono text-sm tracking-[0.14em] text-amber-300">DISCIPLINE IS THE EDGE</div>
                  </Panel>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center lg:justify-end">
            <Panel className="w-full max-w-[30rem] p-4 sm:p-6">
              <div className="rounded-[24px] border border-white/8 bg-black/18 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[0.62rem] uppercase tracking-[0.32em] text-white/40">Portal authorization</div>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[0.16em] text-white">Choose entry mode</h2>
                  </div>
                  <CipherMark className="h-12 w-12 opacity-95" />
                </div>

                <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
                  <div className="grid grid-cols-2 gap-2">
                    {accountModes.map((item) => {
                      const active = mode === item;
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setMode(item)}
                          className={`group relative overflow-hidden rounded-[18px] border px-4 py-4 text-left transition-all duration-300 ${
                            active
                              ? "border-cyan-300/35 bg-[linear-gradient(135deg,rgba(78,168,246,0.18),rgba(124,92,252,0.15))] shadow-[0_0_0_1px_rgba(78,168,246,0.1),0_16px_36px_rgba(10,15,25,0.4)]"
                              : "border-white/8 bg-black/10 hover:border-white/16 hover:bg-white/[0.05]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-[0.62rem] uppercase tracking-[0.3em] text-white/38">Mode</div>
                              <div className="mt-2 text-sm font-medium tracking-[0.22em] text-white">{item}</div>
                            </div>
                            <div
                              className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                                active ? "border-cyan-300/60 bg-cyan-300/18" : "border-white/20 bg-transparent"
                              }`}
                            >
                              <div
                                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                                  active ? "bg-cyan-300 shadow-[0_0_12px_rgba(120,205,255,0.9)]" : "bg-transparent"
                                }`}
                              />
                            </div>
                          </div>
                          <div className="mt-3 text-xs leading-6 text-slate-400">
                            {item === "REAL ACCOUNT"
                              ? "Live capital environment. Every touch threshold carries consequence."
                              : "Simulation environment. Train pattern recognition without financial exposure."}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[0.58rem] uppercase tracking-[0.28em] text-white/38">Selected</div>
                    <div className="mt-2 font-mono text-sm tracking-[0.16em] text-cyan-100">{mode === "REAL ACCOUNT" ? "LIVE" : "PAPER"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[0.58rem] uppercase tracking-[0.28em] text-white/38">Primary rule</div>
                    <div className="mt-2 font-mono text-sm tracking-[0.16em] text-white/80">TIME / PRICE</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <div className="text-[0.58rem] uppercase tracking-[0.28em] text-white/38">Status</div>
                    <div className="mt-2 font-mono text-sm tracking-[0.16em] text-emerald-300">AIRLOCK READY</div>
                  </div>
                </div>

                <button
                  type="button"
                  className="group relative mt-6 inline-flex w-full items-center justify-between overflow-hidden rounded-[22px] border border-cyan-300/25 bg-[linear-gradient(90deg,rgba(78,168,246,0.22),rgba(124,92,252,0.18),rgba(229,168,32,0.12))] px-5 py-4 text-left shadow-[0_18px_50px_rgba(7,12,20,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] transition-all duration-300 hover:translate-y-[-1px] hover:border-cyan-200/45 hover:shadow-[0_24px_70px_rgba(23,45,76,0.6),inset_0_1px_0_rgba(255,255,255,0.1)]"
                >
                  <div>
                    <div className="text-[0.58rem] uppercase tracking-[0.32em] text-cyan-100/62">Terminal entry</div>
                    <div className="mt-2 text-sm font-semibold tracking-[0.28em] text-white">INITIATE TERMINAL</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(78,168,246,1)]" />
                    <span className="font-mono text-xs tracking-[0.22em] text-white/72">{mode === "REAL ACCOUNT" ? "LIVE ACCESS" : "DEMO ACCESS"}</span>
                  </div>
                  <div className="pointer-events-none absolute inset-0 translate-x-[-120%] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.22),transparent)] transition-transform duration-1000 group-hover:translate-x-[120%]" />
                </button>

                <div className="mt-5 grid gap-2 text-[0.65rem] uppercase tracking-[0.28em] text-white/36 sm:grid-cols-2">
                  <span>Remember: time and price. Nothing else.</span>
                  <span className="text-right text-white/28">Discipline / Focus / Detachment</span>
                </div>
              </div>
            </Panel>
          </div>
        </section>

        <footer className="flex flex-col gap-4 border-t border-white/8 pt-4 text-[0.64rem] uppercase tracking-[0.28em] text-white/28 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-md leading-6">Synthetic market environment for high-frequency touch/no-touch barrier analysis.</div>
          <div className="grid gap-2 text-right font-mono tracking-[0.22em] text-white/36 sm:grid-cols-3 sm:gap-6">
            <span>DERIV / V100</span>
            <span>24·7 ENGINE</span>
            <span>CLEAR MIND REQUIRED</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
