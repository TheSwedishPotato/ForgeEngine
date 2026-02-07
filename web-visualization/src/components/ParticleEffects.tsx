import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface SmokeProps {
  position: [number, number, number]
  intensity?: number
}

export function ChimneySmoke({ position, intensity = 1 }: SmokeProps) {
  const particlesRef = useRef<THREE.Points>(null)
  const particleCount = 50

  const { positions, velocities, lifetimes } = useMemo(() => {
    const positions = new Float32Array(particleCount * 3)
    const velocities = new Float32Array(particleCount * 3)
    const lifetimes = new Float32Array(particleCount)

    for (let i = 0; i < particleCount; i++) {
      // Start at chimney position
      positions[i * 3] = (Math.random() - 0.5) * 0.2
      positions[i * 3 + 1] = Math.random() * 2
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2

      // Upward velocity with some randomness
      velocities[i * 3] = (Math.random() - 0.5) * 0.1
      velocities[i * 3 + 1] = 0.3 + Math.random() * 0.2
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.1

      lifetimes[i] = Math.random() * 3
    }

    return { positions, velocities, lifetimes }
  }, [])

  useFrame((state, delta) => {
    if (!particlesRef.current) return

    const posArray = particlesRef.current.geometry.attributes.position
      .array as Float32Array

    for (let i = 0; i < particleCount; i++) {
      // Update position based on velocity
      posArray[i * 3] += velocities[i * 3] * delta
      posArray[i * 3 + 1] += velocities[i * 3 + 1] * delta * intensity
      posArray[i * 3 + 2] += velocities[i * 3 + 2] * delta

      // Update lifetime
      lifetimes[i] -= delta

      // Reset particle when lifetime expires
      if (lifetimes[i] <= 0) {
        posArray[i * 3] = (Math.random() - 0.5) * 0.2
        posArray[i * 3 + 1] = 0
        posArray[i * 3 + 2] = (Math.random() - 0.5) * 0.2
        lifetimes[i] = 3
      }

      // Fade out as particles rise
      const opacity = Math.max(0, 1 - posArray[i * 3 + 1] / 8)
      posArray[i * 3 + 1] = Math.min(posArray[i * 3 + 1], 8)
    }

    particlesRef.current.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={particlesRef} position={position}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.3}
        color="#aaaaaa"
        transparent
        opacity={0.4}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}

export function Torch({ position }: { position: [number, number, number] }) {
  const lightRef = useRef<THREE.PointLight>(null)

  useFrame((state) => {
    if (!lightRef.current) return

    // Flickering effect
    lightRef.current.intensity =
      1.5 + Math.sin(state.clock.elapsedTime * 10) * 0.3 +
      Math.random() * 0.2
  })

  return (
    <group position={position}>
      {/* Torch post */}
      <mesh castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2, 8]} />
        <meshStandardMaterial color="#3a2a1a" />
      </mesh>

      {/* Torch holder */}
      <mesh position={[0, 1, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.08, 0.3, 8]} />
        <meshStandardMaterial color="#4a4a4a" />
      </mesh>

      {/* Flame */}
      <mesh position={[0, 1.2, 0]}>
        <coneGeometry args={[0.1, 0.3, 6]} />
        <meshStandardMaterial
          color="#ff6600"
          emissive="#ff4400"
          emissiveIntensity={1}
        />
      </mesh>

      {/* Point light */}
      <pointLight
        ref={lightRef}
        position={[0, 1.2, 0]}
        color="#ff8844"
        intensity={1.5}
        distance={6}
        castShadow
      />
    </group>
  )
}

export function ForgeGlow({ position }: { position: [number, number, number] }) {
  const lightRef = useRef<THREE.PointLight>(null)

  useFrame((state) => {
    if (!lightRef.current) return

    // Pulsing forge glow
    lightRef.current.intensity =
      2.0 + Math.sin(state.clock.elapsedTime * 2) * 0.5
  })

  return (
    <group position={position}>
      <pointLight
        ref={lightRef}
        color="#ff4400"
        intensity={2}
        distance={4}
      />
      {/* Glow mesh */}
      <mesh>
        <sphereGeometry args={[0.2, 8, 8]} />
        <meshStandardMaterial
          color="#ff4400"
          emissive="#ff2200"
          emissiveIntensity={1.5}
        />
      </mesh>
    </group>
  )
}

// Collection of smoke and fire effects
export function VillageEffects() {
  return (
    <group>
      {/* Chimney smoke from various buildings */}
      <ChimneySmoke position={[-5, 5, -3]} intensity={1} />
      <ChimneySmoke position={[4, 6, 2]} intensity={0.8} />
      <ChimneySmoke position={[-7, 5, 5]} intensity={0.9} />
      <ChimneySmoke position={[6, 7, -5]} intensity={1.1} />

      {/* Torches mounted on buildings (visible at night) */}
      <Torch position={[-2, 0.8, -2]} />
      <Torch position={[2, 0.8, -2]} />
      <Torch position={[-2, 0.8, 2]} />
      <Torch position={[2, 0.8, 2]} />

      {/* Blacksmith forge glow */}
      <ForgeGlow position={[-8, 1.5, -4]} />
    </group>
  )
}
