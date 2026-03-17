import { useState } from 'react';
import { motion } from 'motion/react';
import { Hexagon, ChevronRight } from 'lucide-react';

export default function PortalUI() {
  const [accountType, setAccountType] = useState<'REAL' | 'DEMO'>('REAL');

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-between pointer-events-none p-12">
      
      {/* Top Header / Logo */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.5 }}
        className="flex flex-col items-center gap-6 mt-12"
      >
        <Hexagon className="w-10 h-10 text-cipher-blue opacity-80" strokeWidth={1} />
        <h1 className="text-6xl md:text-8xl font-sans font-light tracking-[0.4em] text-white opacity-90 uppercase mix-blend-screen ml-[0.4em]">
          CIPHER
        </h1>
        <div className="h-px w-48 bg-gradient-to-r from-transparent via-cipher-blue/50 to-transparent mt-2" />
      </motion.div>

      {/* Center Controls */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, delay: 1 }}
        className="flex flex-col items-center gap-12 pointer-events-auto"
      >
        {/* Toggle Switch */}
        <div className="relative flex items-center p-1 bg-cipher-panel/40 backdrop-blur-xl rounded-full border border-white/5 shadow-2xl">
          <div 
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] bg-cipher-bg rounded-full shadow-lg border border-white/10 transition-transform duration-500 ease-out"
            style={{ transform: `translateX(${accountType === 'DEMO' ? '100%' : '0'})` }}
          />
          
          <button 
            onClick={() => setAccountType('REAL')}
            className={`relative z-10 px-8 py-3 text-xs font-mono tracking-widest transition-colors duration-300 ${
              accountType === 'REAL' ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            REAL ACCOUNT
          </button>
          
          <button 
            onClick={() => setAccountType('DEMO')}
            className={`relative z-10 px-8 py-3 text-xs font-mono tracking-widest transition-colors duration-300 ${
              accountType === 'DEMO' ? 'text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            DEMO ACCOUNT
          </button>
        </div>

        {/* CTA Button */}
        <button className="group relative flex items-center gap-4 px-12 py-5 bg-transparent overflow-hidden">
          {/* Glowing border effect */}
          <div className="absolute inset-0 border border-cipher-blue/30 group-hover:border-cipher-blue/80 transition-colors duration-500" />
          
          {/* Background glow */}
          <div className="absolute inset-0 bg-cipher-blue/0 group-hover:bg-cipher-blue/10 transition-colors duration-500" />
          
          {/* Scanline effect */}
          <div className="absolute inset-0 bg-[linear-gradient(transparent_0%,rgba(78,168,246,0.1)_50%,transparent_100%)] bg-[length:100%_4px] opacity-0 group-hover:opacity-100 animate-scan" />

          <span className="relative z-10 text-sm font-mono tracking-[0.2em] text-cipher-blue group-hover:text-white transition-colors duration-500">
            INITIATE TERMINAL
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
        <p className="text-[10px] font-mono tracking-[0.3em] text-white/30 uppercase">
          Remember: Time and price. Nothing else.
        </p>
        <p className="text-[9px] font-mono tracking-[0.4em] text-cipher-blue/40 uppercase">
          Discipline is the edge
        </p>
      </motion.div>

      {/* Ambient overlay grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_80%)] pointer-events-none" />
    </div>
  );
}
