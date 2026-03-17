/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import BootSequence from './components/BootSequence';
import Terminal from './components/Terminal';

export default function App() {
  const [inTerminal, setInTerminal] = useState(false);

  return (
    <div className="min-h-screen bg-[#050810] text-white overflow-hidden font-sans">
      {!inTerminal ? (
        <BootSequence onEnter={() => setInTerminal(true)} />
      ) : (
        <Terminal />
      )}
    </div>
  );
}
