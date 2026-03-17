import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Float, Sparkles, Stars, MeshDistortMaterial } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

export default function BackgroundScene({ isEntering }: { isEntering: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    
    if (groupRef.current) {
      if (isEntering) {
        // Zoom-in animation
        groupRef.current.position.z += delta * 15;
        groupRef.current.rotation.z += delta * 2;
      } else {
        // Normal idle animation
        groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, -5, 0.05);
      }
    }

    if (ring1Ref.current) {
      ring1Ref.current.rotation.x = t * 0.1;
      ring1Ref.current.rotation.y = t * 0.05;
    }
    
    if (ring2Ref.current) {
      ring2Ref.current.rotation.y = t * 0.15;
      ring2Ref.current.rotation.z = t * 0.2;
    }

    if (coreRef.current) {
      coreRef.current.rotation.y = t * 0.2;
      coreRef.current.rotation.z = t * 0.1;
    }
  });

  return (
    <>
      <color attach="background" args={['#060A10']} />
      <fog attach="fog" args={['#060A10', 5, 30]} />
      
      <ambientLight intensity={0.1} />
      <directionalLight position={[10, 10, 5]} intensity={0.5} color="#4ea8f6" />
      <directionalLight position={[-10, -10, -5]} intensity={0.5} color="#7c5cfc" />

      <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={0.5} />
      <Sparkles count={150} scale={20} size={1.5} speed={0.2} opacity={0.15} color="#4ea8f6" />

      <Float speed={1} rotationIntensity={0.2} floatIntensity={0.2}>
        <group ref={groupRef} position={[0, 0, -5]}>
          
          {/* Luminous Event Horizon Ring (Void Gate) */}
          <mesh ref={ring1Ref}>
            <torusGeometry args={[3.5, 0.05, 32, 100]} />
            <meshBasicMaterial color="#4ea8f6" toneMapped={false} />
          </mesh>
          
          <mesh ref={ring2Ref}>
            <torusGeometry args={[3.8, 0.02, 32, 100]} />
            <meshBasicMaterial color="#7c5cfc" toneMapped={false} />
          </mesh>

          {/* Thin Gold Wireframe Orbital */}
          <mesh rotation={[Math.PI / 3, 0, 0]}>
            <torusGeometry args={[4.5, 0.005, 16, 100]} />
            <meshBasicMaterial color="#e5a820" opacity={0.5} transparent toneMapped={false} />
          </mesh>

          {/* Morphing Liquid-Metal Sphere Core */}
          <mesh ref={coreRef} scale={1.8}>
            <icosahedronGeometry args={[1, 4]} />
            <MeshDistortMaterial 
              color="#0A0E14" 
              emissive="#131a24"
              emissiveIntensity={0.2}
              roughness={0.1} 
              metalness={1} 
              distort={0.4} 
              speed={1.5} 
            />
          </mesh>

          {/* Core Inner Glow */}
          <mesh scale={1.7}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshBasicMaterial color="#4ea8f6" transparent opacity={0.1} toneMapped={false} />
          </mesh>

        </group>
      </Float>

      <Environment preset="studio" />
      
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={0.2} mipmapBlur intensity={1.5} />
      </EffectComposer>
    </>
  );
}
