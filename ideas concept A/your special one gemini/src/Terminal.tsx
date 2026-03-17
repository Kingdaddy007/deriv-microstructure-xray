import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';

export default function Terminal() {
  const [time, setTime] = useState(new Date().toISOString());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toISOString());
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div 
      className="min-h-screen w-full bg-black text-white font-mono overflow-hidden flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      {/* Top Bar */}
      <header className="border-b border-white/10 p-2 flex justify-between items-center text-xs">
        <div className="flex items-center gap-4">
          <span className="font-bold tracking-widest text-[#00e5ff]">CIPHER v1.2.0</span>
          <span className="text-white/50">SYSTEM: ONLINE</span>
          <span className="text-white/50">LATENCY: 4ms</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[#ffd700]">BTC/USD</span>
          <span className="text-white/50">{time}</span>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-12 grid-rows-12 gap-[1px] bg-white/10 p-[1px]">
        
        {/* Chart Area */}
        <div className="col-span-7 row-span-8 bg-black relative p-4 flex flex-col">
          <div className="flex justify-between items-center mb-4 text-xs text-white/50 border-b border-white/10 pb-2">
            <div className="flex gap-4">
              <span className="text-white">BTC/USD</span>
              <span>1H</span>
              <span>INDEX: 64,230.50</span>
            </div>
            <div className="flex gap-4">
              <span className="text-[#00e5ff]">O: 64,100.00</span>
              <span className="text-[#00e5ff]">H: 64,500.00</span>
              <span className="text-[#ff4444]">L: 63,900.00</span>
              <span className="text-white">C: 64,230.50</span>
            </div>
          </div>
          <div className="flex-1 relative border border-white/5 overflow-hidden">
            {/* Placeholder for Chart */}
            <div className="absolute inset-0 flex items-center justify-center text-white/10 text-4xl tracking-widest select-none z-10">
              CHART DATA STREAM
            </div>
            {/* Grid lines */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:40px_40px]" />
            {/* Simulated Candlesticks */}
            <div className="absolute bottom-10 left-10 right-10 top-10 flex items-end gap-2 opacity-50">
               {Array.from({length: 40}).map((_, i) => {
                 const isUp = Math.random() > 0.5;
                 const height = 20 + Math.random() * 60;
                 return (
                   <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                     <div className={`w-[1px] h-[${height + 20}%] ${isUp ? 'bg-[#00e5ff]' : 'bg-[#ff4444]'} opacity-50 absolute`} style={{ height: `${height + 20}%` }} />
                     <div className={`w-full ${isUp ? 'bg-[#00e5ff]' : 'bg-[#ff4444]'}`} style={{ height: `${height}%` }} />
                   </div>
                 )
               })}
            </div>
          </div>
        </div>

        {/* Order Book */}
        <div className="col-span-3 row-span-8 bg-black p-4 flex flex-col text-xs">
          <div className="border-b border-white/10 pb-2 mb-4 flex justify-between text-white/50">
            <span>PRICE (USD)</span>
            <span>SIZE (BTC)</span>
            <span>TOTAL</span>
          </div>
          
          <div className="flex-1 flex flex-col justify-between">
            {/* Asks */}
            <div className="flex flex-col gap-1 text-[#ff4444]">
              {Array.from({length: 18}).map((_, i) => (
                <div key={`ask-${i}`} className="flex justify-between relative group cursor-pointer hover:bg-white/5">
                  <div className="absolute right-0 top-0 bottom-0 bg-[#ff4444]/10" style={{ width: `${Math.random() * 100}%` }} />
                  <span className="relative z-10">{(64230.50 + (18-i) * 10.5).toFixed(2)}</span>
                  <span className="relative z-10 text-white/70">{(Math.random() * 2).toFixed(4)}</span>
                  <span className="relative z-10 text-white/50">{(Math.random() * 10).toFixed(4)}</span>
                </div>
              ))}
            </div>

            {/* Spread */}
            <div className="py-2 my-2 border-y border-white/10 flex justify-between items-center text-[#00e5ff] text-sm">
              <span>64,230.50</span>
              <span className="text-white/50 text-xs">SPREAD: 0.50</span>
            </div>

            {/* Bids */}
            <div className="flex flex-col gap-1 text-[#00e5ff]">
              {Array.from({length: 18}).map((_, i) => (
                <div key={`bid-${i}`} className="flex justify-between relative group cursor-pointer hover:bg-white/5">
                  <div className="absolute right-0 top-0 bottom-0 bg-[#00e5ff]/10" style={{ width: `${Math.random() * 100}%` }} />
                  <span className="relative z-10">{(64230.00 - i * 10.5).toFixed(2)}</span>
                  <span className="relative z-10 text-white/70">{(Math.random() * 2).toFixed(4)}</span>
                  <span className="relative z-10 text-white/50">{(Math.random() * 10).toFixed(4)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Trades */}
        <div className="col-span-2 row-span-8 bg-black p-4 flex flex-col text-xs">
          <div className="border-b border-white/10 pb-2 mb-4 flex justify-between text-white/50">
            <span>PRICE</span>
            <span>SIZE</span>
            <span>TIME</span>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col gap-1">
            {Array.from({length: 40}).map((_, i) => {
              const isBuy = Math.random() > 0.5;
              return (
                <div key={`trade-${i}`} className={`flex justify-between ${isBuy ? 'text-[#00e5ff]' : 'text-[#ff4444]'}`}>
                  <span>{(64230 + (Math.random() * 20 - 10)).toFixed(2)}</span>
                  <span className="text-white/70">{(Math.random() * 1.5).toFixed(4)}</span>
                  <span className="text-white/40">{new Date(Date.now() - i * 5000).toLocaleTimeString([], {hour12: false})}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Order Entry */}
        <div className="col-span-3 row-span-4 bg-black p-4 flex flex-col text-xs">
          <div className="border-b border-white/10 pb-2 mb-4 text-white/50">ORDER ENTRY</div>
          <div className="flex gap-2 mb-4">
            <button className="flex-1 bg-white/10 hover:bg-white/20 py-2 text-white transition-colors">LIMIT</button>
            <button className="flex-1 bg-transparent border border-white/10 hover:bg-white/5 py-2 text-white/50 transition-colors">MARKET</button>
            <button className="flex-1 bg-transparent border border-white/10 hover:bg-white/5 py-2 text-white/50 transition-colors">STOP</button>
          </div>
          <div className="space-y-4 flex-1">
            <div>
              <div className="flex justify-between text-white/50 mb-1"><span>PRICE</span><span>USD</span></div>
              <input type="text" defaultValue="64230.50" className="w-full bg-transparent border border-white/20 p-2 text-right text-[#00e5ff] outline-none focus:border-[#00e5ff]" />
            </div>
            <div>
              <div className="flex justify-between text-white/50 mb-1"><span>SIZE</span><span>BTC</span></div>
              <input type="text" defaultValue="1.0000" className="w-full bg-transparent border border-white/20 p-2 text-right text-white outline-none focus:border-white" />
            </div>
            <div className="flex justify-between text-white/50 pt-2 border-t border-white/10">
              <span>VALUE</span>
              <span className="text-white">64,230.50 USD</span>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="flex-1 bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/50 hover:bg-[#00e5ff]/30 py-3 font-bold tracking-widest transition-colors">BUY</button>
            <button className="flex-1 bg-[#ff4444]/20 text-[#ff4444] border border-[#ff4444]/50 hover:bg-[#ff4444]/30 py-3 font-bold tracking-widest transition-colors">SELL</button>
          </div>
        </div>

        {/* Positions / Portfolio */}
        <div className="col-span-9 row-span-4 bg-black p-4 flex flex-col text-xs">
          <div className="border-b border-white/10 pb-2 mb-4 flex gap-6 text-white/50">
            <span className="text-white border-b border-white pb-2 -mb-[9px]">POSITIONS (1)</span>
            <span className="hover:text-white cursor-pointer transition-colors">OPEN ORDERS (0)</span>
            <span className="hover:text-white cursor-pointer transition-colors">HISTORY</span>
            <span className="hover:text-white cursor-pointer transition-colors">BALANCES</span>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left">
              <thead className="text-white/50 border-b border-white/10">
                <tr>
                  <th className="pb-2 font-normal">MARKET</th>
                  <th className="pb-2 font-normal">SIDE</th>
                  <th className="pb-2 font-normal text-right">SIZE</th>
                  <th className="pb-2 font-normal text-right">ENTRY PRICE</th>
                  <th className="pb-2 font-normal text-right">MARK PRICE</th>
                  <th className="pb-2 font-normal text-right">LIQ. PRICE</th>
                  <th className="pb-2 font-normal text-right">MARGIN</th>
                  <th className="pb-2 font-normal text-right">PNL (ROE%)</th>
                  <th className="pb-2 font-normal text-right">ACTION</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="py-3">BTC/USD</td>
                  <td className="py-3 text-[#00e5ff]">LONG</td>
                  <td className="py-3 text-right">2.5000</td>
                  <td className="py-3 text-right">62,100.00</td>
                  <td className="py-3 text-right">64,230.50</td>
                  <td className="py-3 text-right text-[#ff4444]">58,400.00</td>
                  <td className="py-3 text-right">15,525.00</td>
                  <td className="py-3 text-right text-[#00e5ff]">+5,326.25 (34.3%)</td>
                  <td className="py-3 text-right text-white/50 hover:text-white cursor-pointer">CLOSE</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </motion.div>
  );
}
