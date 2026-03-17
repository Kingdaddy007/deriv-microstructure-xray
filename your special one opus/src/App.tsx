import { useEffect, useMemo, useState } from "react";

type BootPhase = "dark" | "pulse" | "trace" | "wordmark" | "ready";

type StoryStep = {
  label: string;
  time: string;
  description: string;
};

const storySteps: StoryStep[] = [
  {
    label: "00",
    time: "0.0s",
    description: "Void state. Total darkness. Core remains offline.",
  },
  {
    label: "01",
    time: "0.9s",
    description: "Electric core ignition. Heartbeat pulses emit sonar ripples.",
  },
  {
    label: "02",
    time: "2.2s",
    description: "Laser trace engages. Hexagonal chassis is etched line-by-line.",
  },
  {
    label: "03",
    time: "3.3s",
    description: "CIPHER wordmark resolves with typographic lock-in.",
  },
  {
    label: "04",
    time: "4.4s",
    description: "Account controls arm. Terminal is ready for entry.",
  },
];

const pulseRings = [0, 1, 2, 3];
const dustParticles = Array.from({ length: 32 }, (_, index) => ({
  id: index,
  size: 1 + ((index * 7) % 4),
  x: (index * 13.7) % 100,
  y: (index * 19.1) % 100,
  duration: 14 + (index % 8) * 2,
  delay: (index % 10) * 0.45,
}));

export default function App() {
  const [phase, setPhase] = useState<BootPhase>("dark");
  const [selectedMode, setSelectedMode] = useState<"REAL" | "DEMO">("DEMO");
  const [cursor, setCursor] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase("pulse"), 500),
      window.setTimeout(() => setPhase("trace"), 2000),
      window.setTimeout(() => setPhase("wordmark"), 3200),
      window.setTimeout(() => setPhase("ready"), 4300),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      setCursor({
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight,
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  const activeStep = useMemo(() => {
    if (phase === "dark") return 0;
    if (phase === "pulse") return 1;
    if (phase === "trace") return 2;
    if (phase === "wordmark") return 3;
    return 4;
  }, [phase]);

  const particleOffset = {
    transform: `translate(${(cursor.x - 0.5) * 30}px, ${(cursor.y - 0.5) * 30}px)`,
  };

  return (
    <main className="cipher-app relative min-h-screen overflow-hidden bg-[#050810] text-white selection:bg-sky-400/30 selection:text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(78,168,246,0.09),_transparent_22%),linear-gradient(180deg,#050810_0%,#070b12_55%,#0a0e14_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(78,168,246,0.04)_0,transparent_18%,transparent_82%,rgba(124,92,252,0.04)_100%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-80 transition-transform duration-500 ease-out"
        style={{
          transform: `translate(${(cursor.x - 0.5) * -18}px, ${(cursor.y - 0.5) * -18}px)`,
        }}
      >
        <div className="absolute left-1/2 top-1/2 h-[62rem] w-[62rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(78,168,246,0.18),transparent_48%)] blur-3xl" />
      </div>

      <div className={`scan-grid ${phase === "dark" ? "opacity-0" : "opacity-100"}`} />
      <div className={`wireframe wireframe-a ${phase === "pulse" || phase === "trace" || phase === "wordmark" || phase === "ready" ? "opacity-100" : "opacity-0"}`} />
      <div className={`wireframe wireframe-b ${phase === "trace" || phase === "wordmark" || phase === "ready" ? "opacity-100" : "opacity-0"}`} />
      <div className={`architectural-lines ${phase === "pulse" || phase === "trace" || phase === "wordmark" || phase === "ready" ? "opacity-100" : "opacity-0"}`} />

      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={particleOffset}>
        {dustParticles.map((particle) => (
          <span
            key={particle.id}
            className={`dust-particle ${phase === "ready" ? "opacity-100" : "opacity-0"}`}
            style={{
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              animationDuration: `${particle.duration}s`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-8 py-10">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {pulseRings.map((ring) => (
            <span
              key={ring}
              className={`pulse-ring ${phase === "pulse" || phase === "trace" || phase === "wordmark" || phase === "ready" ? "opacity-100" : "opacity-0"}`}
              style={{ animationDelay: `${ring * 0.72}s` }}
            />
          ))}
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={`core-light ${phase === "dark" ? "opacity-0 scale-50" : "opacity-100 scale-100"}`} />
        </div>

        <div className="relative flex w-full max-w-[1600px] flex-1 items-center justify-center">
          <div className="absolute left-8 top-8 hidden max-w-sm xl:block">
            <div className={`timeline-panel ${phase === "wordmark" || phase === "ready" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
              <p className="mb-6 text-[0.62rem] font-semibold uppercase tracking-[0.55em] text-slate-500">
                Boot Sequence
              </p>
              <div className="space-y-4">
                {storySteps.map((step, index) => (
                  <div
                    key={step.label}
                    className={`timeline-item ${index <= activeStep ? "active" : "inactive"}`}
                  >
                    <div className="timeline-index">{step.label}</div>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="text-[0.65rem] uppercase tracking-[0.38em] text-slate-500">
                          {step.time}
                        </span>
                        <span className="h-px flex-1 bg-white/10" />
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-slate-300/80">
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative flex w-full flex-col items-center justify-center">
            <div className="relative flex items-center justify-center">
              <svg
                className={`cipher-logo ${phase === "trace" || phase === "wordmark" || phase === "ready" ? "trace-active" : ""}`}
                width="300"
                height="340"
                viewBox="0 0 300 340"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-label="Cipher logo"
              >
                <defs>
                  <linearGradient id="hexStroke" x1="35" y1="28" x2="265" y2="312" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#4EA8F6" />
                    <stop offset="0.5" stopColor="#7C5CFC" />
                    <stop offset="1" stopColor="#4EA8F6" />
                  </linearGradient>
                  <linearGradient id="innerStroke" x1="68" y1="77" x2="229" y2="259" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#D7EEFF" stopOpacity="0.95" />
                    <stop offset="0.48" stopColor="#4EA8F6" />
                    <stop offset="1" stopColor="#7C5CFC" />
                  </linearGradient>
                  <filter id="logoGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="4.5" result="blur" />
                    <feColorMatrix
                      in="blur"
                      type="matrix"
                      values="1 0 0 0 0  0 1 0 0 0.45  0 0 1 0 0.9  0 0 0 18 -7"
                    />
                  </filter>
                </defs>

                <g className="logo-breath">
                  <path
                    className="trace-path outer-path"
                    d="M150 28L241 81V187L150 240L59 187V81L150 28Z"
                    stroke="url(#hexStroke)"
                    strokeWidth="3"
                    strokeLinejoin="round"
                    filter="url(#logoGlow)"
                  />
                  <path
                    className="trace-path inner-path"
                    d="M150 77L198 105V162L150 190L102 162V105L150 77Z"
                    stroke="url(#innerStroke)"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                  <path
                    className="trace-path bridge-path"
                    d="M102 105L150 133L198 105M150 133V190M59 187L150 133L241 187"
                    stroke="url(#hexStroke)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.85"
                  />
                  <path
                    d="M150 28L241 81V187L150 240L59 187V81L150 28Z"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="1"
                    strokeLinejoin="round"
                  />
                </g>
              </svg>

              <div className={`logo-aura ${phase === "trace" || phase === "wordmark" || phase === "ready" ? "opacity-100" : "opacity-0"}`} />
            </div>

            <div className="mt-5 flex flex-col items-center gap-5">
              <div className={`wordmark-wrap ${phase === "wordmark" || phase === "ready" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
                <h1 className="cipher-wordmark" aria-label="CIPHER">
                  {"CIPHER".split("").map((letter, index) => (
                    <span
                      key={`${letter}-${index}`}
                      className="wordmark-letter"
                      style={{ animationDelay: `${3.25 + index * 0.12}s` }}
                    >
                      {letter}
                    </span>
                  ))}
                </h1>
                <p className="mt-4 text-center text-[0.72rem] uppercase tracking-[0.58em] text-slate-500">
                  Premium Trading Terminal
                </p>
              </div>

              <p className={`discipline-text ${phase === "ready" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
                Discipline is the Edge
              </p>
            </div>
          </div>

          <div className="absolute right-8 top-8 hidden max-w-xs xl:block">
            <div className={`status-panel ${phase === "ready" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
              <div className="flex items-center justify-between">
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.52em] text-slate-500">
                  Core Status
                </p>
                <span className="inline-flex items-center gap-2 text-[0.62rem] uppercase tracking-[0.38em] text-sky-300">
                  <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_12px_rgba(78,168,246,0.9)]" />
                  Ready
                </span>
              </div>
              <div className="mt-5 space-y-4 text-sm text-slate-300/85">
                <div className="status-row">
                  <span>Sequence</span>
                  <span>04 / FINAL</span>
                </div>
                <div className="status-row">
                  <span>Frame</span>
                  <span>Ready State</span>
                </div>
                <div className="status-row">
                  <span>Reactor</span>
                  <span>{selectedMode === "REAL" ? "Armed" : "Simulated"}</span>
                </div>
                <div className="status-row">
                  <span>Signal</span>
                  <span>Locked</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`relative z-20 mt-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-8 pb-2 pt-8 lg:flex-row ${phase === "ready" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} transition-all duration-1000`}>
          <div className="order-2 flex flex-col items-center gap-4 lg:order-1 lg:items-start">
            <div className="mode-switch">
              <button
                type="button"
                onClick={() => setSelectedMode("REAL")}
                className={`mode-pill real ${selectedMode === "REAL" ? "selected" : ""}`}
                aria-pressed={selectedMode === "REAL"}
              >
                REAL
              </button>
              <button
                type="button"
                onClick={() => setSelectedMode("DEMO")}
                className={`mode-pill demo ${selectedMode === "DEMO" ? "selected" : ""}`}
                aria-pressed={selectedMode === "DEMO"}
              >
                DEMO
              </button>
            </div>
            <p className="text-center text-[0.65rem] uppercase tracking-[0.42em] text-slate-500 lg:text-left">
              {selectedMode === "REAL"
                ? "Live account selected · authentication required"
                : "Simulation account selected · non-execution environment"}
            </p>
          </div>

          <div className="order-1 flex flex-col items-center gap-5 lg:order-2 lg:items-end">
            <button type="button" className={`enter-button ${selectedMode === "REAL" ? "real-armed" : "demo-armed"}`}>
              <span>Enter Terminal</span>
            </button>
            <p className="text-center text-[0.62rem] uppercase tracking-[0.48em] text-slate-600 lg:text-right">
              Secure interface // access channel live
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
