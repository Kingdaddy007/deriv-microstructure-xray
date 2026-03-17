import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Grid } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

export default function BackgroundScene({ isEntering }: { isEntering: boolean }) {
  const gridRef = useRef<THREE.Group>(null);

  // Generate random data pillars for the cityscape horizon
  const pillars = useMemo(() => {
    return Array.from({ length: 50 }).map(() => ({
      position: [
        (Math.random() - 0.5) * 160,
        -3 + Math.random() * 2,
        -30 - Math.random() * 60
      ] as [number, number, number],
      scale: [
        1 + Math.random() * 2,
        2 + Math.random() * 15,
        1 + Math.random() * 2
      ] as [number, number, number],
    }));
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    
    if (gridRef.current) {
      // Infinite scroll effect (sectionSize is 5)
      gridRef.current.position.z = (t * 10) % 5;
    }

    if (isEntering) {
      // Fly into the horizon
      state.camera.position.z -= delta * 40;
      state.camera.position.y -= delta * 2;
    } else {
      // Reset camera if not entering (in case of re-renders)
      state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, 15, 0.05);
      state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, 0, 0.05);
    }
  });

  return (
    <>
      <color attach="background" args={['#020408']} />
      <fog attach="fog" args={['#020408', 20, 90]} />
      
      {/* The Grid Floor */}
      <group ref={gridRef}>
        <Grid
          position={[0, -3, 0]}
          args={[200, 200]}
          cellSize={1}
          cellThickness={1}
          cellColor="#1a4b77"
          sectionSize={5}
          sectionThickness={1.5}
          sectionColor="#4ea8f6"
          fadeDistance={80}
          fadeStrength={1}
        />
      </group>

      {/* Glowing Horizon Line (Data Sunrise) */}
      <mesh position={[0, -3, -80]}>
        <boxGeometry args={[300, 0.2, 2]} />
        <meshBasicMaterial color="#4ea8f6" toneMapped={false} />
      </mesh>
      
      {/* Horizon Core Glow */}
      <mesh position={[0, -2, -81]}>
        <boxGeometry args={[200, 4, 2]} />
        <meshBasicMaterial color="#4ea8f6" transparent opacity={0.15} toneMapped={false} />
      </mesh>

      {/* Distant Data Pillars (Tron Cityscape) */}
      {pillars.map((props, i) => (
        <mesh key={i} position={props.position} scale={props.scale}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#020408" />
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
            <lineBasicMaterial color="#4ea8f6" transparent opacity={0.4} toneMapped={false} />
          </lineSegments>
        </mesh>
      ))}

      <Environment preset="city" />
      
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.1} mipmapBlur intensity={2.5} />
      </EffectComposer>
    </>
  );
}
