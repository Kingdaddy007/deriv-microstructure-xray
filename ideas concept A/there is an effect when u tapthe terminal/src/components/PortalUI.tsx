import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export default function PortalUI({ isEntering, onEnter }: { isEntering: boolean, onEnter: () => void }) {
  const [accountType, setAccountType] = useState<'REAL' | 'DEMO'>('REAL');
  const [bootStage, setBootStage] = useState(0);

  useEffect(() => {
    // Stage 0: Darkness (0s - 1s)
    // Stage 1: Pulses (1s - 2.5s)
    // Stage 2: Tracing Logo (2.5s - 4s)
    // Stage 3: CIPHER text (4s - 5s)
    // Stage 4: UI ready (5s+)
    
    const t1 = setTimeout(() => setBootStage(1), 1000);
    const t2 = setTimeout(() => setBootStage(2), 2500);
    const t3 = setTimeout(() => setBootStage(3), 4000);
    const t4 = setTimeout(() => setBootStage(4), 5000);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  const cipherText = "CIPHER".split("");

  return (
    <AnimatePresence>
      {!isEntering && (
        <motion.div 
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none p-12 overflow-hidden"
        >
          
          <div className="flex flex-col items-center justify-center gap-12 w-full max-w-4xl pointer-events-auto relative z-10">
            
            {/* Hexagon Logo */}
            <div className="relative w-32 h-32 flex items-center justify-center">
              {bootStage >= 2 && (
                <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full overflow-visible">
                  <motion.polygon
                    points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5"
                    fill="none"
                    stroke="#4EA8F6"
                    strokeWidth="1.5"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    transition={{ duration: 1.5, ease: "easeInOut" }}
                  />
                  {bootStage >= 4 && (
                    <motion.polygon
                      points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5"
                      fill="none"
                      stroke="#4EA8F6"
                      strokeWidth="3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0.2, 0.8, 0.2] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      style={{ filter: 'blur(8px)' }}
                    />
                  )}
                </svg>
              )}
            </div>

            {/* Wordmark */}
            <div className="flex space-x-4 h-24 items-center">
              {bootStage >= 3 && cipherText.map((letter, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 10, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="text-6xl md:text-8xl font-sans font-bold tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-b from-white to-[#4EA8F6]/70 drop-shadow-[0_0_15px_rgba(78,168,246,0.5)]"
                >
                  {letter}
                </motion.span>
              ))}
            </div>

            {/* UI Elements */}
            {bootStage >= 4 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1 }}
                className="flex flex-col items-center gap-12 mt-8 w-full"
              >
                {/* Account Toggle */}
                <div className="flex items-center gap-6">
                  <button 
                    onClick={() => setAccountType('REAL')}
                    className={`relative px-12 py-3 rounded-full text-sm font-mono tracking-[0.2em] transition-all duration-500 overflow-hidden border ${
                      accountType === 'REAL' 
                        ? 'text-black border-[#E5A820] shadow-[0_0_20px_rgba(229,168,32,0.4)]' 
                        : 'text-[#E5A820]/50 border-[#E5A820]/30 hover:border-[#E5A820]/60'
                    }`}
                  >
                    {accountType === 'REAL' && (
                      <motion.div 
                        layoutId="active-bg"
                        className="absolute inset-0 bg-gradient-to-r from-[#E5A820] to-[#ffc844]"
                      />
                    )}
                    <span className="relative z-10 font-bold">REAL</span>
                  </button>

                  <button 
                    onClick={() => setAccountType('DEMO')}
                    className={`relative px-12 py-3 rounded-full text-sm font-mono tracking-[0.2em] transition-all duration-500 overflow-hidden border ${
                      accountType === 'DEMO' 
                        ? 'text-black border-[#4EA8F6] shadow-[0_0_20px_rgba(78,168,246,0.4)]' 
                        : 'text-[#4EA8F6]/50 border-[#4EA8F6]/30 hover:border-[#4EA8F6]/60'
                    }`}
                  >
                    {accountType === 'DEMO' && (
                      <motion.div 
                        layoutId="active-bg"
                        className="absolute inset-0 bg-gradient-to-r from-[#4EA8F6] to-[#7C5CFC]"
                      />
                    )}
                    <span className="relative z-10 font-bold">DEMO</span>
                  </button>
                </div>

                {/* Enter Button */}
                <button 
                  onClick={onEnter}
                  className="group relative px-16 py-5 bg-transparent border border-[#4EA8F6]/30 hover:border-[#4EA8F6] transition-all duration-500 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-[#4EA8F6]/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="absolute inset-0 shadow-[inset_0_0_20px_rgba(78,168,246,0)] group-hover:shadow-[inset_0_0_20px_rgba(78,168,246,0.5)] transition-shadow duration-500" />
                  <span className="relative z-10 text-sm font-sans font-bold tracking-[0.3em] text-[#4EA8F6] group-hover:text-white transition-colors duration-300 group-hover:drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">
                    ENTER TERMINAL
                  </span>
                </button>

                {/* Subtitle */}
                <p className="text-sm font-serif italic text-[#5A6577] tracking-widest mt-4">
                  Discipline is the Edge
                </p>
              </motion.div>
            )}

          </div>

        </motion.div>
      )}
    </AnimatePresence>
  );
}
