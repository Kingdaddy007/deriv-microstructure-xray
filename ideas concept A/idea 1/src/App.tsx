/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Canvas } from '@react-three/fiber';
import BackgroundScene from './components/BackgroundScene';
import PortalUI from './components/PortalUI';

export default function App() {
  return (
    <main className="relative w-full h-screen bg-cipher-bg overflow-hidden text-white font-sans">
      <Canvas
        camera={{ position: [0, 0, 15], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <BackgroundScene />
      </Canvas>
      <PortalUI />
    </main>
  );
}
