/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import Terminal from './Terminal';

// Pre-calculate streams so they are identical for both halves of the split slab
const STREAMS = Array.from({ length: 45 }).map((_, i) => ({
  id: i,
  left: `${(i * 2.2) + (Math.random() * 2)}%`,
  delay: Math.random() * 5,
  duration: 1.5 + Math.random() * 3,
  color: Math.random() > 0.85 ? '#ffd700' : '#00e5ff',
  height: 15 + Math.random() * 40
}));

export default function App() {
  const [accountMode, setAccountMode] = useState<'REAL' | 'DEMO'>('REAL');
  const [isEntering, setIsEntering] = useState(false);
  const [inTerminal, setInTerminal] = useState(false);

  const handleEnter = () => {
    setIsEntering(true);
    setTimeout(() => {
      setInTerminal(true);
    }, 3500);
  };

  if (inTerminal) {
    return <Terminal />;
  }

  return (
    <div className="relative min-h-screen w-full bg-black overflow-hidden font-sans text-white flex items-center justify-center perspective-[1000px]">
      
      {/* Cinematic Volumetric Lighting / Fog */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[120vw] h-[80vh] bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.04)_0%,_transparent_60%)] pointer-events-none z-0" />

      {/* Dark Water Floor (Liquidity Pool) */}
      <motion.div 
        className="absolute bottom-0 left-[-50vw] w-[200vw] h-[50vh] water-floor z-0"
        animate={isEntering ? { 
          scaleY: [1, 1.05, 0.95, 1.02, 0.98, 1],
          filter: ['blur(0px)', 'blur(8px)', 'blur(0px)']
        } : {}}
        transition={{ duration: 2, ease: "easeInOut" }}
      >
        {/* Caustics reflection on water base */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60vw] h-[100px] bg-[radial-gradient(ellipse_at_top,_rgba(0,229,255,0.1)_0%,_transparent_70%)] blur-[10px]" />
      </motion.div>

      {/* Mechanical Thud Shake Container */}
      <motion.div 
        className="relative z-10 w-[90vw] max-w-[1600px] h-[65vh] md:h-[75vh]"
        animate={isEntering ? { y: [0, 8, -6, 4, -2, 0] } : {}}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {/* Top Half of the Obsidian Slab */}
        <SlabHalf 
          side="top" 
          isEntering={isEntering} 
          accountMode={accountMode} 
          setAccountMode={setAccountMode} 
          handleEnter={handleEnter} 
        />
        
        {/* Bottom Half of the Obsidian Slab */}
        <SlabHalf 
          side="bottom" 
          isEntering={isEntering} 
          accountMode={accountMode} 
          setAccountMode={setAccountMode} 
          handleEnter={handleEnter} 
        />
      </motion.div>

      {/* Terminal Entry Flash */}
      <motion.div 
        className="absolute inset-0 bg-white z-50 pointer-events-none"
        initial={{ opacity: 0 }}
        animate={isEntering ? { opacity: [0, 0, 1] } : { opacity: 0 }}
        transition={{ duration: 3.5, times: [0, 0.9, 1] }}
      />
    </div>
  );
}

function SlabHalf({ 
  side, 
  isEntering, 
  accountMode, 
  setAccountMode, 
  handleEnter 
}: { 
  side: 'top' | 'bottom', 
  isEntering: boolean, 
  accountMode: 'REAL' | 'DEMO', 
  setAccountMode: (mode: 'REAL' | 'DEMO') => void,
  handleEnter: () => void
}) {
  const isTop = side === 'top';
  const clipPath = isTop ? 'inset(0 0 50% 0)' : 'inset(50% 0 0 0)';
  const yAnimation = isEntering ? (isTop ? '-60vh' : '60vh') : '0vh';

  return (
    <motion.div 
      className="absolute inset-0 obsidian-glass flex flex-col items-center justify-center overflow-hidden"
      style={{ clipPath }}
      animate={{ y: yAnimation }}
      transition={{ duration: 2.5, delay: 0.4, ease: [0.76, 0, 0.24, 1] }}
    >
      {/* Data Rain (Behind frosted glass) */}
      <div className="absolute inset-0 opacity-40 pointer-events-none z-0">
        <DataRain />
      </div>

      {/* Etched UI Layer */}
      <div className="relative z-10 flex flex-col items-center w-full h-full justify-center">
        
        {/* Logo */}
        <h1 className="font-sans font-light text-6xl md:text-[120px] tracking-[0.4em] md:tracking-[0.6em] ml-[0.4em] md:ml-[0.6em] laser-etched mb-16 md:mb-24 select-none">
          CIPHER
        </h1>

        {/* Selectors */}
        <div className="flex gap-6 md:gap-12 mb-16 md:mb-20">
          <button 
            onClick={() => setAccountMode('REAL')}
            className={`slot-selector px-10 md:px-16 py-4 font-mono text-xs md:text-sm tracking-[0.3em] ${accountMode === 'REAL' ? 'slot-active' : 'text-white/30 hover:text-white/60'}`}
          >
            [ REAL ]
          </button>
          <button 
            onClick={() => setAccountMode('DEMO')}
            className={`slot-selector px-10 md:px-16 py-4 font-mono text-xs md:text-sm tracking-[0.3em] ${accountMode === 'DEMO' ? 'slot-active' : 'text-white/30 hover:text-white/60'}`}
          >
            [ DEMO ]
          </button>
        </div>

        {/* Command Prompt */}
        <button 
          onClick={handleEnter}
          className="font-mono text-sm md:text-lg tracking-[0.2em] text-white/70 hover:text-white laser-etched transition-colors group cursor-pointer"
        >
          <span className="text-[#00e5ff] mr-4 group-hover:text-white transition-colors">&gt;</span>
          AWAITING INITIALIZATION<span className="cursor-pulse">_</span>
        </button>

        {/* Anchor Text */}
        <div className="absolute bottom-6 right-8 md:bottom-8 md:right-12">
          <p className="font-sans text-[8px] md:text-[10px] tracking-[0.4em] text-white/30 laser-etched">
            TIME AND PRICE. NOTHING ELSE.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function DataRain() {
  return (
    <>
      {STREAMS.map(stream => (
        <motion.div
          key={stream.id}
          className="absolute top-0 data-stream"
          style={{
            left: stream.left,
            height: `${stream.height}%`,
            '--stream-color': stream.color
          } as any}
          animate={{ y: ['-100vh', '100vh'] }}
          transition={{
            duration: stream.duration,
            delay: stream.delay,
            repeat: Infinity,
            ease: "linear"
          }}
        />
      ))}
    </>
  );
}
