import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Noise } from '@react-three/postprocessing';
import * as THREE from 'three';

function Particles() {
  const count = 1000;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { mouse, viewport } = useThree();
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      temp.push({
        x: (Math.random() - 0.5) * 40,
        y: (Math.random() - 0.5) * 40,
        z: (Math.random() - 0.5) * 40,
        speed: 0.01 + Math.random() * 0.02,
        factor: Math.random(),
      });
    }
    return temp;
  }, [count]);

  useFrame((state) => {
    if (!meshRef.current) return;
    particles.forEach((particle, i) => {
      let t = state.clock.elapsedTime;
      // Drift
      particle.y += Math.sin(t * particle.speed + particle.factor) * 0.01;
      particle.x += Math.cos(t * particle.speed + particle.factor) * 0.01;
      
      // React to mouse subtly
      const targetX = particle.x + (mouse.x * viewport.width) * 0.05;
      const targetY = particle.y + (mouse.y * viewport.height) * 0.05;

      dummy.position.set(targetX, targetY, particle.z);
      dummy.scale.setScalar(0.05);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#4EA8F6" transparent opacity={0.3} />
    </instancedMesh>
  );
}

function WireframeStructures() {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.02;
      groupRef.current.rotation.z = state.clock.elapsedTime * 0.01;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <icosahedronGeometry args={[25, 2]} />
        <meshStandardMaterial color="#4EA8F6" wireframe transparent opacity={0.3} roughness={0.2} metalness={0.8} />
      </mesh>
      <mesh>
        <octahedronGeometry args={[10, 1]} />
        <meshStandardMaterial color="#7C5CFC" wireframe transparent opacity={0.5} roughness={0.2} metalness={0.8} />
      </mesh>
      
      {/* Floor Grid */}
      <mesh position={[0, -15, 0]} rotation={[-Math.PI/2, 0, 0]}>
        <planeGeometry args={[100, 100, 20, 20]} />
        <meshStandardMaterial color="#4EA8F6" wireframe transparent opacity={0.2} roughness={0.5} metalness={0.5} />
      </mesh>
      {/* Ceiling Grid */}
      <mesh position={[0, 15, 0]} rotation={[Math.PI/2, 0, 0]}>
        <planeGeometry args={[100, 100, 20, 20]} />
        <meshStandardMaterial color="#4EA8F6" wireframe transparent opacity={0.2} roughness={0.5} metalness={0.5} />
      </mesh>
    </group>
  );
}

export default function BackgroundScene({ isEntering }: { isEntering: boolean }) {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    
    if (lightRef.current) {
      if (t < 1) {
        lightRef.current.intensity = 0;
      } else if (t < 3) {
        // Heartbeat pulses between 1s and 3s
        const beat = Math.sin((t - 1) * Math.PI * 3); // 1.5 beats per second
        const intensity = Math.max(0, beat) * 500; // High intensity for standard material
        lightRef.current.intensity = intensity;
        lightRef.current.distance = 40;
      } else {
        // Stabilize
        lightRef.current.intensity = THREE.MathUtils.lerp(lightRef.current.intensity, 100, delta * 2);
        lightRef.current.distance = THREE.MathUtils.lerp(lightRef.current.distance, 60, delta * 2);
      }
    }

    if (isEntering) {
      state.camera.position.z = THREE.MathUtils.lerp(state.camera.position.z, -20, delta * 2);
    } else {
      state.camera.position.x = Math.sin(t * 0.1) * 0.5;
      state.camera.position.y = Math.cos(t * 0.1) * 0.5;
      state.camera.lookAt(0, 0, 0);
    }
  });

  return (
    <>
      <color attach="background" args={['#050810']} />
      <fog attach="fog" args={['#050810', 10, 40]} />

      <ambientLight intensity={0.02} />
      <pointLight ref={lightRef} position={[0, 0, 0]} color="#4EA8F6" intensity={0} distance={0} />
      
      <WireframeStructures />
      <Particles />

      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.1} mipmapBlur intensity={2} />
        <Noise opacity={0.08} />
      </EffectComposer>
    </>
  );
}
