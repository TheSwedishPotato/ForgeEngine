import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface AnimalProps {
  position: [number, number, number]
  wanderRadius?: number
}

export function Chicken({ position, wanderRadius = 2 }: AnimalProps) {
  const groupRef = useRef<THREE.Group>(null)
  const timeOffset = useRef(Math.random() * 100)

  useFrame((state) => {
    if (!groupRef.current) return

    const time = state.clock.elapsedTime + timeOffset.current

    // Random wandering
    groupRef.current.position.x =
      position[0] + Math.sin(time * 0.5) * wanderRadius
    groupRef.current.position.z =
      position[2] + Math.cos(time * 0.3) * wanderRadius

    // Pecking animation
    groupRef.current.rotation.x = Math.sin(time * 4) * 0.3

    // Face movement direction
    groupRef.current.rotation.y = Math.atan2(
      Math.cos(time * 0.3),
      Math.sin(time * 0.5)
    )
  })

  return (
    <group ref={groupRef} position={[position[0], position[1], position[2]]}>
      {/* Body */}
      <mesh position={[0, 0.25, 0]} castShadow>
        <sphereGeometry args={[0.15, 8, 6]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* Head */}
      <mesh position={[0.1, 0.35, 0]} castShadow>
        <sphereGeometry args={[0.08, 6, 6]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* Beak */}
      <mesh position={[0.15, 0.35, 0]} castShadow>
        <coneGeometry args={[0.03, 0.1, 4]} />
        <meshStandardMaterial color="#ffaa00" />
      </mesh>
    </group>
  )
}

export function Horse({ position }: AnimalProps) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (!groupRef.current) return

    // Gentle head bobbing
    groupRef.current.children[1].position.y =
      0.8 + Math.sin(state.clock.elapsedTime * 2) * 0.05
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Body */}
      <mesh position={[0, 0.6, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.8, 0.6, 0.4]} />
        <meshStandardMaterial color="#6b4423" />
      </mesh>

      {/* Neck and head */}
      <mesh position={[0.4, 0.8, 0]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.3]} />
        <meshStandardMaterial color="#6b4423" />
      </mesh>

      {/* Legs */}
      {[
        [-0.25, 0.15, -0.15],
        [-0.25, 0.15, 0.15],
        [0.25, 0.15, -0.15],
        [0.25, 0.15, 0.15],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.3, 6]} />
          <meshStandardMaterial color="#5a3a1a" />
        </mesh>
      ))}
    </group>
  )
}

export function Sheep({ position, wanderRadius = 1.5 }: AnimalProps) {
  const groupRef = useRef<THREE.Group>(null)
  const timeOffset = useRef(Math.random() * 100)

  useFrame((state) => {
    if (!groupRef.current) return

    const time = state.clock.elapsedTime + timeOffset.current

    // Slow wandering
    groupRef.current.position.x =
      position[0] + Math.sin(time * 0.2) * wanderRadius
    groupRef.current.position.z =
      position[2] + Math.cos(time * 0.15) * wanderRadius

    groupRef.current.rotation.y = Math.atan2(
      Math.cos(time * 0.15),
      Math.sin(time * 0.2)
    )
  })

  return (
    <group ref={groupRef} position={[position[0], position[1], position[2]]}>
      {/* Woolly body */}
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <sphereGeometry args={[0.25, 8, 6]} />
        <meshStandardMaterial color="#f5f5dc" roughness={0.95} />
      </mesh>

      {/* Head */}
      <mesh position={[0.2, 0.35, 0]} castShadow>
        <sphereGeometry args={[0.12, 6, 6]} />
        <meshStandardMaterial color="#3a3a3a" />
      </mesh>

      {/* Legs */}
      {[
        [-0.1, 0.1, -0.1],
        [-0.1, 0.1, 0.1],
        [0.1, 0.1, -0.1],
        [0.1, 0.1, 0.1],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.2, 6]} />
          <meshStandardMaterial color="#3a3a3a" />
        </mesh>
      ))}
    </group>
  )
}

export function Seagull({ position, flyHeight = 5 }: { position: [number, number, number]; flyHeight?: number }) {
  const groupRef = useRef<THREE.Group>(null)
  const timeOffset = useRef(Math.random() * 100)

  useFrame((state) => {
    if (!groupRef.current) return

    const time = state.clock.elapsedTime + timeOffset.current

    // Flying in circles
    const radius = 15
    groupRef.current.position.x = position[0] + Math.sin(time * 0.3) * radius
    groupRef.current.position.z = position[2] + Math.cos(time * 0.3) * radius
    groupRef.current.position.y =
      flyHeight + Math.sin(time * 0.5) * 2

    // Face movement direction
    groupRef.current.rotation.y = Math.atan2(
      Math.cos(time * 0.3),
      Math.sin(time * 0.3)
    ) + Math.PI / 2

    // Wing flapping
    const wingAngle = Math.sin(time * 8) * 0.5
    if (groupRef.current.children[1]) {
      groupRef.current.children[1].rotation.z = wingAngle
    }
    if (groupRef.current.children[2]) {
      groupRef.current.children[2].rotation.z = -wingAngle
    }
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Body */}
      <mesh castShadow>
        <sphereGeometry args={[0.15, 8, 6]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>

      {/* Left wing */}
      <mesh position={[0, 0, -0.2]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.5, 0.05, 0.2]} />
        <meshStandardMaterial color="#e5e5e5" />
      </mesh>

      {/* Right wing */}
      <mesh position={[0, 0, 0.2]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.5, 0.05, 0.2]} />
        <meshStandardMaterial color="#e5e5e5" />
      </mesh>
    </group>
  )
}

// Collection of animals for the village
export function VillageAnimals() {
  return (
    <group>
      {/* Chickens around the village */}
      <Chicken position={[-5, 0.8, -3]} wanderRadius={1.5} />
      <Chicken position={[-7, 0.8, 2]} wanderRadius={2} />
      <Chicken position={[4, 0.8, -5]} wanderRadius={1} />
      <Chicken position={[6, 0.8, 6]} wanderRadius={1.5} />

      {/* Horses with carts */}
      <Horse position={[-3, 0.8, -6]} />
      <Horse position={[5, 0.8, 3]} />

      {/* Sheep near outskirts */}
      <Sheep position={[-8, 0.8, 7]} wanderRadius={2} />
      <Sheep position={[-9, 0.8, 8]} wanderRadius={1.5} />
      <Sheep position={[9, 0.8, 6]} wanderRadius={2} />

      {/* Seagulls flying over the water */}
      <Seagull position={[0, 0, 0]} flyHeight={8} />
      <Seagull position={[10, 0, 5]} flyHeight={6} />
      <Seagull position={[-8, 0, -8]} flyHeight={7} />
      <Seagull position={[5, 0, -10]} flyHeight={9} />
    </group>
  )
}
