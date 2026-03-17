import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Hexagon, ChevronRight } from 'lucide-react';

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
          className="absolute inset-0 z-10 flex flex-col items-center justify-between pointer-events-none p-12"
        >
          
          {/* Top Header / Logo */}
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="flex flex-col items-center gap-6 mt-12"
          >
            <Hexagon className="w-10 h-10 text-cipher-blue opacity-80" strokeWidth={1} />
            <h1 className="text-[100px] md:text-[140px] leading-none font-sans font-light tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-b from-white via-white/90 to-white/20 uppercase mix-blend-screen ml-[0.2em] animate-shimmer bg-[length:200%_auto]">
              CIPHER
            </h1>
            <div className="h-px w-64 bg-gradient-to-r from-transparent via-cipher-blue/30 to-transparent mt-4" />
          </motion.div>

          {/* Center Controls */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 1 }}
            className="flex flex-col items-center gap-12 pointer-events-auto"
          >
            {/* Toggle Switch */}
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setAccountType('REAL')}
                className={`relative px-10 py-3 rounded-full text-xs font-mono tracking-widest transition-all duration-500 overflow-hidden border ${
                  accountType === 'REAL' 
                    ? 'text-white border-transparent shadow-[0_0_30px_-5px_rgba(124,92,252,0.5)]' 
                    : 'text-white/40 border-cipher-red/20 hover:border-cipher-red/40 hover:text-white/70'
                }`}
              >
                {accountType === 'REAL' && (
                  <div className="absolute inset-0 bg-gradient-to-r from-cipher-blue to-cipher-purple opacity-80" />
                )}
                <span className="relative z-10">REAL</span>
              </button>
              
              <button 
                onClick={() => setAccountType('DEMO')}
                className={`relative px-10 py-3 rounded-full text-xs font-mono tracking-widest transition-all duration-500 overflow-hidden border ${
                  accountType === 'DEMO' 
                    ? 'text-white border-transparent shadow-[0_0_30px_-5px_rgba(78,168,246,0.5)]' 
                    : 'text-white/40 border-cipher-blue/20 hover:border-cipher-blue/40 hover:text-white/70'
                }`}
              >
                {accountType === 'DEMO' && (
                  <div className="absolute inset-0 bg-gradient-to-r from-cipher-blue to-cipher-purple opacity-80" />
                )}
                <span className="relative z-10">DEMO</span>
              </button>
            </div>

            {/* CTA Button */}
            <button 
              onClick={onEnter}
              className="group relative flex items-center gap-4 px-12 py-5 bg-transparent overflow-hidden"
            >
              {/* Glowing border effect */}
              <div className="absolute inset-0 border border-cipher-blue/30 group-hover:border-cipher-blue transition-colors duration-500 shadow-[0_0_0_0_rgba(78,168,246,0)] group-hover:shadow-[0_0_30px_0_rgba(78,168,246,0.4)]" />
              
              {/* Background glow */}
              <div className="absolute inset-0 bg-cipher-blue/0 group-hover:bg-cipher-blue/10 transition-colors duration-500" />
              
              {/* Scanline effect */}
              <div className="absolute inset-0 bg-[linear-gradient(transparent_0%,rgba(78,168,246,0.2)_50%,transparent_100%)] bg-[length:100%_4px] opacity-0 group-hover:opacity-100 animate-scan" />

              <span className="relative z-10 text-sm font-sans font-medium tracking-[0.15em] text-cipher-blue group-hover:text-white transition-colors duration-500 uppercase">
                Enter Terminal
              </span>
              <ChevronRight className="relative z-10 w-4 h-4 text-cipher-blue group-hover:text-white transition-colors duration-500 group-hover:translate-x-1" />
              
              {/* Corner accents */}
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-cipher-blue" />
              <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-cipher-blue" />
              <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-cipher-blue" />
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-cipher-blue" />
            </button>
          </motion.div>

          {/* Bottom Mindset Reminders */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.5 }}
            className="flex flex-col items-center gap-2 mb-8"
          >
            <p className="text-sm font-sans italic tracking-widest text-cipher-muted">
              Discipline is the Edge
            </p>
          </motion.div>

          {/* Ambient overlay grid */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_80%)] pointer-events-none" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
