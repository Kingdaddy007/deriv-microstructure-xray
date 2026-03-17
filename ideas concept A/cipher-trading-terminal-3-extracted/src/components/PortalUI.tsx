import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight } from 'lucide-react';

export default function PortalUI({ isEntering, onEnter }: { isEntering: boolean, onEnter: () => void }) {
  const [accountType, setAccountType] = useState<'REAL' | 'DEMO'>('REAL');

  return (
    <AnimatePresence>
      {!isEntering && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
          className="absolute inset-0 z-10 flex flex-col items-center justify-between pointer-events-none p-12 overflow-hidden"
        >
          
          {/* Top Header / Logo */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="flex flex-col items-center mt-12"
          >
            <h1 className="text-[100px] md:text-[160px] leading-none font-sans font-bold tracking-[0.2em] text-white uppercase ml-[0.2em] drop-shadow-[0_0_40px_rgba(255,255,255,0.3)]">
              CIPHER
            </h1>
          </motion.div>

          {/* Center Mindset */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <p className="text-xl md:text-2xl font-sans font-light tracking-[0.5em] text-white/90 uppercase whitespace-nowrap drop-shadow-[0_0_15px_rgba(78,168,246,0.8)]">
              Time & Price
            </p>
          </motion.div>

          {/* Bottom Controls (3D Perspective) */}
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 1.5 }}
            className="pointer-events-auto mb-12"
          >
            <div 
              className="flex flex-col items-center gap-10"
              style={{ 
                transform: 'perspective(1000px) rotateX(50deg)',
                transformStyle: 'preserve-3d',
                transformOrigin: 'bottom'
              }}
            >
              {/* Toggle Switch */}
              <div 
                className="flex items-center gap-6 bg-black/60 p-3 rounded-full border border-cipher-blue/40 backdrop-blur-xl shadow-[0_20px_50px_rgba(78,168,246,0.15)]" 
                style={{ transform: 'translateZ(20px)' }}
              >
                <button 
                  onClick={() => setAccountType('REAL')}
                  className={`relative px-14 py-4 rounded-full text-sm font-mono tracking-widest transition-all duration-500 overflow-hidden ${
                    accountType === 'REAL' 
                      ? 'text-white bg-cipher-blue/20 border border-cipher-blue shadow-[inset_0_0_20px_rgba(78,168,246,0.6)]' 
                      : 'text-white/40 border border-transparent hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  <span className="relative z-10">REAL</span>
                </button>
                
                <button 
                  onClick={() => setAccountType('DEMO')}
                  className={`relative px-14 py-4 rounded-full text-sm font-mono tracking-widest transition-all duration-500 overflow-hidden ${
                    accountType === 'DEMO' 
                      ? 'text-white bg-cipher-blue/20 border border-cipher-blue shadow-[inset_0_0_20px_rgba(78,168,246,0.6)]' 
                      : 'text-white/40 border border-transparent hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  <span className="relative z-10">DEMO</span>
                </button>
              </div>

              {/* CTA Button */}
              <button 
                onClick={onEnter}
                className="group relative flex items-center gap-6 px-20 py-6 bg-black/40 border border-cipher-blue/50 hover:border-cipher-blue hover:bg-cipher-blue/20 backdrop-blur-xl transition-all duration-500 shadow-[0_20px_50px_rgba(78,168,246,0.2)] hover:shadow-[0_20px_60px_rgba(78,168,246,0.5)]"
                style={{ transform: 'translateZ(40px)' }}
              >
                <span className="relative z-10 text-xl font-sans font-semibold tracking-[0.25em] text-white uppercase drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
                  Enter Terminal
                </span>
                <ChevronRight className="relative z-10 w-6 h-6 text-white transition-transform duration-500 group-hover:translate-x-2 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                
                {/* Grid intersection markers */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cipher-blue" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cipher-blue" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cipher-blue" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cipher-blue" />
              </button>
            </div>
          </motion.div>

          {/* Scanline overlay */}
          <div className="absolute inset-0 bg-[linear-gradient(transparent_0%,rgba(78,168,246,0.05)_50%,transparent_100%)] bg-[length:100%_4px] pointer-events-none animate-scan" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
