import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect } from 'react';

export default function BootSequence({ onEnter }: { onEnter: () => void }) {
  const [accountType, setAccountType] = useState<'REAL' | 'DEMO'>('DEMO');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIsReady(true), 4500);
    return () => clearTimeout(t);
  }, []);

  // Sequence timing:
  // 0.0s - 1.0s: Total dark
  // 1.0s - 2.0s: Pulse & Ripples
  // 2.0s - 3.5s: Hexagon trace
  // 3.5s - 4.5s: CIPHER text
  // 4.5s+: UI fades in

  return (
    <div className="relative w-full h-screen flex flex-col items-center justify-center bg-[#050810] overflow-hidden font-sans selection:bg-[#4EA8F6]/30">
      
      {/* Background Wireframes - Revealed by ripples */}
      <motion.div 
        className="absolute inset-0 z-0 wireframe-bg hex-grid"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.5, 0.2] }}
        transition={{ duration: 2, delay: 1.2, times: [0, 0.5, 1] }}
      />

      {/* Particles (only after ready) */}
      <AnimatePresence>
        {isReady && <Particles />}
      </AnimatePresence>

      <div className="relative z-10 flex flex-col items-center">
        {/* Central Pulse & Logo */}
        <div className="relative w-40 h-40 flex items-center justify-center">
          
          {/* Initial Pulse Light */}
          <motion.div
            className="absolute w-1.5 h-1.5 bg-[#4EA8F6] rounded-full shadow-[0_0_20px_#4EA8F6,0_0_40px_#7C5CFC]"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0, 2, 0] }}
            transition={{ duration: 1, delay: 1, times: [0, 0.5, 1] }}
          />
          
          {/* Sonar Ripples */}
          <motion.div
            className="absolute w-2 h-2 rounded-full border border-[#4EA8F6]"
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: [0, 0.8, 0], scale: [1, 50] }}
            transition={{ duration: 1.5, delay: 1, ease: "easeOut" }}
          />
          <motion.div
            className="absolute w-2 h-2 rounded-full border border-[#4EA8F6]"
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: [0, 0.5, 0], scale: [1, 70] }}
            transition={{ duration: 2, delay: 1.3, ease: "easeOut" }}
          />

          {/* Hexagon Logo Tracing */}
          <motion.svg width="120" height="120" viewBox="0 0 120 120" className="absolute">
            <motion.polygon
              points="60,10 105,35 105,85 60,110 15,85 15,35"
              fill="none"
              stroke="#4EA8F6"
              strokeWidth="2"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.5, delay: 2, ease: "easeInOut" }}
              style={{ filter: 'drop-shadow(0 0 8px rgba(78,168,246,0.8)) drop-shadow(0 0 16px rgba(124,92,252,0.5))' }}
            />
            {/* Inner geometric details */}
            <motion.polygon
              points="60,30 85,45 85,75 60,90 35,75 35,45"
              fill="none"
              stroke="#4EA8F6"
              strokeWidth="1"
              strokeDasharray="4 4"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 0.4, scale: 1 }}
              transition={{ duration: 1, delay: 3 }}
            />
            <motion.circle
              cx="60" cy="60" r="4"
              fill="#4EA8F6"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 3.5 }}
              style={{ filter: 'drop-shadow(0 0 10px #4EA8F6)' }}
            />
            
            {/* Breathing glow after boot */}
            {isReady && (
              <motion.polygon
                points="60,10 105,35 105,85 60,110 15,85 15,35"
                fill="rgba(78,168,246,0.05)"
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </motion.svg>
        </div>

        {/* Wordmark */}
        <div className="mt-12 h-20 overflow-hidden flex items-center justify-center">
          <div className="flex space-x-2">
            {"CIPHER".split('').map((letter, index) => (
              <motion.span
                key={index}
                className="text-5xl md:text-7xl font-black tracking-[0.2em] shimmer-text"
                initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.5, delay: 3.5 + index * 0.1, ease: "easeOut" }}
              >
                {letter}
              </motion.span>
            ))}
          </div>
        </div>
        
        <motion.p
          className="mt-6 text-[#5A6577] italic tracking-[0.3em] text-xs md:text-sm uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 4.5 }}
        >
          Discipline is the Edge
        </motion.p>
      </div>

      {/* Bottom UI */}
      <motion.div
        className="absolute bottom-16 flex flex-col items-center gap-10 z-20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 4.5 }}
      >
        {/* Account Toggle */}
        <div className="flex items-center gap-2 bg-[#0A0E14]/80 backdrop-blur-sm p-1.5 rounded-full border border-white/5 shadow-2xl">
          <button
            onClick={() => setAccountType('REAL')}
            className={`relative px-8 py-2.5 rounded-full text-xs font-bold tracking-[0.2em] transition-all duration-500 overflow-hidden ${
              accountType === 'REAL'
                ? 'text-black shadow-[0_0_20px_rgba(229,168,32,0.3)]'
                : 'text-[#5A6577] border border-[#E5A820]/20 hover:border-[#E5A820]/50'
            }`}
          >
            {accountType === 'REAL' && (
              <motion.div 
                layoutId="activeTab"
                className="absolute inset-0 bg-gradient-to-r from-[#E5A820] to-[#F6C85B]"
                initial={false}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
            <span className="relative z-10">REAL</span>
          </button>
          <button
            onClick={() => setAccountType('DEMO')}
            className={`relative px-8 py-2.5 rounded-full text-xs font-bold tracking-[0.2em] transition-all duration-500 overflow-hidden ${
              accountType === 'DEMO'
                ? 'text-white shadow-[0_0_20px_rgba(78,168,246,0.3)]'
                : 'text-[#5A6577] border border-[#4EA8F6]/20 hover:border-[#4EA8F6]/50'
            }`}
          >
            {accountType === 'DEMO' && (
              <motion.div 
                layoutId="activeTab"
                className="absolute inset-0 bg-gradient-to-r from-[#4EA8F6] to-[#7C5CFC]"
                initial={false}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
            <span className="relative z-10">DEMO</span>
          </button>
        </div>

        {/* Enter Button */}
        <button
          onClick={onEnter}
          className="group relative px-10 py-4 bg-transparent overflow-hidden rounded-sm border border-[#4EA8F6]/30 hover:border-[#4EA8F6] transition-all duration-500"
        >
          <div className="absolute inset-0 bg-[#4EA8F6]/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#4EA8F6]/20 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite]" />
          <span className="relative text-[#4EA8F6] text-sm font-bold tracking-[0.3em] group-hover:text-white transition-colors duration-300 drop-shadow-[0_0_8px_rgba(78,168,246,0.8)]">
            ENTER TERMINAL
          </span>
          {/* Reactor ignition switch glow */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 shadow-[0_0_30px_rgba(78,168,246,0.4)_inset] transition-opacity duration-500" />
        </button>
      </motion.div>
    </div>
  );
}

function Particles() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 overflow-hidden pointer-events-none z-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 2 }}
    >
      {Array.from({ length: 40 }).map((_, i) => {
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const size = Math.random() * 2 + 1;
        const duration = Math.random() * 20 + 10;
        
        // Parallax effect
        const offsetX = (mousePos.x / (typeof window !== 'undefined' ? window.innerWidth : 1000) - 0.5) * 30 * (size / 2);
        const offsetY = (mousePos.y / (typeof window !== 'undefined' ? window.innerHeight : 1000) - 0.5) * 30 * (size / 2);

        return (
          <motion.div
            key={i}
            className="absolute rounded-full bg-[#4EA8F6]/30"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              x: offsetX,
              y: offsetY,
              filter: 'blur(1px)'
            }}
            animate={{
              y: [`${y}%`, `${y - 5}%`, `${y}%`],
              x: [`${x}%`, `${x + 2}%`, `${x}%`],
              opacity: [0.1, 0.6, 0.1],
            }}
            transition={{
              duration,
              repeat: Infinity,
              ease: "linear"
            }}
          />
        );
      })}
    </motion.div>
  );
}
