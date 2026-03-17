const accounts = [
  { id: "Prime", region: "NY4", profile: "Latency Priority" },
  { id: "Execution", region: "LD4", profile: "Balanced Fill Model" },
  { id: "Archive", region: "TY3", profile: "Historical Sync" },
];

export default function App() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02030a] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_130%,rgba(8,55,110,0.38),transparent_48%),radial-gradient(circle_at_50%_50%,rgba(7,20,45,0.45),transparent_70%)]" />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-px w-[110vw] -translate-x-1/2 bg-cyan-300/90 horizon-pulse" />
        <div className="absolute left-1/2 top-1/2 h-24 w-[130vw] -translate-x-1/2 -translate-y-1/2 bg-cyan-300/30 blur-3xl horizon-pulse" />
        <div className="absolute left-1/2 top-1/2 h-36 w-[140vw] -translate-x-1/2 -translate-y-1/2 bg-cyan-300/20 blur-[130px] horizon-pulse" />
      </div>

      <div className="pointer-events-none absolute inset-0">
        <div
          className="grid-floor absolute left-1/2 top-1/2 h-[170vh] w-[220vw] -translate-x-1/2"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, rgba(89,201,255,0.3) 0, rgba(89,201,255,0.3) 1px, transparent 1px, transparent 72px), repeating-linear-gradient(to bottom, rgba(89,201,255,0.3) 0, rgba(89,201,255,0.3) 1px, transparent 1px, transparent 72px)",
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 scan-sweep" />

      <section className="relative z-10 flex min-h-screen flex-col items-center px-6 pt-18 text-center">
        <p className="mb-5 text-[10px] tracking-[0.58em] text-cyan-300/75">GRID HORIZON</p>
        <h1 className="text-6xl font-semibold tracking-[0.28em] text-white sm:text-7xl">CIPHER</h1>
        <p className="mt-4 text-xl font-medium tracking-[0.22em] text-cyan-100/90">Time &amp; Price</p>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-slate-300/70">
          Coordinate every market decision inside a single geometric field where direction, momentum,
          and execution remain under absolute control.
        </p>

        <div className="mt-auto w-full max-w-4xl pb-16">
          <div className="accounts-plane mx-auto flex max-w-3xl flex-wrap items-end justify-center gap-4 sm:gap-6">
            {accounts.map((account, index) => (
              <button
                key={account.id}
                className="account-object group relative w-[220px] border border-cyan-300/25 bg-[#050918]/90 p-4 text-left backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:border-cyan-200/70"
                style={{ animationDelay: `${index * 1.3}s` }}
              >
                <span className="absolute inset-0 bg-[linear-gradient(125deg,rgba(98,220,255,0.1),transparent_55%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <p className="relative text-[10px] tracking-[0.38em] text-cyan-300/75">{account.region}</p>
                <p className="relative mt-2 text-xl font-medium tracking-[0.12em] text-white">{account.id}</p>
                <p className="relative mt-2 text-xs tracking-[0.16em] text-slate-300/70">{account.profile}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <style>{`
        .grid-floor {
          transform-origin: top center;
          transform: perspective(980px) rotateX(79deg);
          animation: gridDrift 18s linear infinite;
          mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0), #000 18%, #000 70%, rgba(0, 0, 0, 0));
        }

        .accounts-plane {
          transform: perspective(1400px) rotateX(32deg);
          transform-origin: center bottom;
        }

        .account-object {
          box-shadow: 0 0 0 1px rgba(111, 229, 255, 0.1), 0 18px 50px rgba(2, 10, 26, 0.9), 0 0 22px rgba(68, 195, 255, 0.16);
          animation: objectFloat 7s ease-in-out infinite;
        }

        .horizon-pulse {
          animation: horizonPulse 5.5s ease-in-out infinite;
        }

        .scan-sweep {
          background: linear-gradient(to bottom, transparent 0%, rgba(74, 210, 255, 0.05) 46%, transparent 55%);
          animation: sweep 9s linear infinite;
        }

        @keyframes horizonPulse {
          0%,
          100% {
            opacity: 0.78;
            filter: saturate(1);
          }
          50% {
            opacity: 1;
            filter: saturate(1.35);
          }
        }

        @keyframes gridDrift {
          from {
            background-position: 0 0, 0 0;
          }
          to {
            background-position: 72px 0, 0 72px;
          }
        }

        @keyframes objectFloat {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-7px);
          }
        }

        @keyframes sweep {
          from {
            transform: translateY(-18%);
          }
          to {
            transform: translateY(24%);
          }
        }
      `}</style>
    </main>
  );
}
