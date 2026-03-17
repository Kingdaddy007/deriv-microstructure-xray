import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Float, MeshDistortMaterial, Sparkles, Stars } from '@react-three/drei';
import * as THREE from 'three';

export default function BackgroundScene() {
  const coreRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const ring3Ref = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    
    if (coreRef.current) {
      coreRef.current.rotation.y = t * 0.1;
      coreRef.current.rotation.z = t * 0.05;
    }
    
    if (ring1Ref.current) {
      ring1Ref.current.rotation.x = t * 0.2;
      ring1Ref.current.rotation.y = t * 0.1;
    }
    
    if (ring2Ref.current) {
      ring2Ref.current.rotation.y = t * 0.15;
      ring2Ref.current.rotation.z = t * 0.25;
    }
    
    if (ring3Ref.current) {
      ring3Ref.current.rotation.x = t * 0.1;
      ring3Ref.current.rotation.z = t * 0.15;
    }
  });

  return (
    <>
      <color attach="background" args={['#05070a']} />
      <fog attach="fog" args={['#05070a', 10, 40]} />
      
      <ambientLight intensity={0.2} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} color="#4ea8f6" />
      <directionalLight position={[-10, -10, -5]} intensity={1} color="#7c5cfc" />
      <pointLight position={[0, 0, 0]} intensity={2} color="#4ea8f6" distance={10} />

      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Sparkles count={200} scale={20} size={2} speed={0.4} opacity={0.2} color="#4ea8f6" />

      <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
        <group position={[0, 0, -5]}>
          {/* Central Core */}
          <mesh ref={coreRef} scale={1.5}>
            <icosahedronGeometry args={[1, 2]} />
            <MeshDistortMaterial 
              color="#0a0e14" 
              emissive="#131a24"
              emissiveIntensity={0.5}
              roughness={0.1} 
              metalness={0.9} 
              distort={0.3} 
              speed={2} 
              wireframe={false}
            />
          </mesh>
          
          {/* Wireframe Overlay for Core */}
          <mesh scale={1.52}>
            <icosahedronGeometry args={[1, 2]} />
            <meshBasicMaterial color="#4ea8f6" wireframe transparent opacity={0.15} />
          </mesh>

          {/* Orbital Rings */}
          <mesh ref={ring1Ref}>
            <torusGeometry args={[3, 0.02, 16, 100]} />
            <meshStandardMaterial color="#7c5cfc" emissive="#7c5cfc" emissiveIntensity={2} toneMapped={false} />
          </mesh>
          
          <mesh ref={ring2Ref}>
            <torusGeometry args={[4, 0.01, 16, 100]} />
            <meshStandardMaterial color="#4ea8f6" emissive="#4ea8f6" emissiveIntensity={1.5} toneMapped={false} />
          </mesh>
          
          <mesh ref={ring3Ref}>
            <torusGeometry args={[5, 0.03, 16, 100]} />
            <meshStandardMaterial color="#131a24" roughness={0.2} metalness={0.8} />
          </mesh>
        </group>
      </Float>

      <Environment preset="studio" />
    </>
  );
}
