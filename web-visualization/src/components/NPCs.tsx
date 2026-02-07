import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface NPCProps {
  path: [number, number, number][]
  speed?: number
  type: 'peasant' | 'merchant' | 'guard' | 'fisherman' | 'vendor'
  color?: string
}

export function NPC({ path, speed = 1, type, color }: NPCProps) {
  const groupRef = useRef<THREE.Group>(null)
  const progressRef = useRef(0)

  const npcColor = color || getColorForType(type)

  useFrame((state, delta) => {
    if (!groupRef.current || path.length < 2) return

    // Update position along path
    progressRef.current += (delta * speed) / 20
    if (progressRef.current >= 1) {
      progressRef.current = 0
    }

    const totalSegments = path.length - 1
    const currentProgress = progressRef.current * totalSegments
    const currentSegment = Math.floor(currentProgress)
    const segmentProgress = currentProgress - currentSegment

    const nextSegment = (currentSegment + 1) % path.length
    const start = path[currentSegment]
    const end = path[nextSegment]

    // Interpolate position
    groupRef.current.position.x = THREE.MathUtils.lerp(
      start[0],
      end[0],
      segmentProgress
    )
    groupRef.current.position.y = THREE.MathUtils.lerp(
      start[1],
      end[1],
      segmentProgress
    )
    groupRef.current.position.z = THREE.MathUtils.lerp(
      start[2],
      end[2],
      segmentProgress
    )

    // Rotate to face movement direction
    const direction = new THREE.Vector3(
      end[0] - start[0],
      0,
      end[2] - start[2]
    ).normalize()
    const angle = Math.atan2(direction.x, direction.z)
    groupRef.current.rotation.y = angle

    // Simple walking animation - bob up and down
    groupRef.current.position.y += Math.sin(state.clock.elapsedTime * 8) * 0.05
  })

  return (
    <group ref={groupRef}>
      {/* Simple character representation */}
      {/* Body */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.8, 4, 8]} />
        <meshStandardMaterial color={npcColor} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 2.0, 0]} castShadow>
        <sphereGeometry args={[0.25, 8, 8]} />
        <meshStandardMaterial color="#ffdbac" />
      </mesh>

      {/* Hat/hood for some types */}
      {(type === 'merchant' || type === 'guard') && (
        <mesh position={[0, 2.25, 0]} castShadow>
          <coneGeometry args={[0.3, 0.4, 8]} />
          <meshStandardMaterial color="#3a2a1a" />
        </mesh>
      )}
    </group>
  )
}

function getColorForType(type: string): string {
  const colors = {
    peasant: '#8b7355',
    merchant: '#6a4a3a',
    guard: '#4a4a5a',
    fisherman: '#5a6a7a',
    vendor: '#7a5a4a',
  }
  return colors[type as keyof typeof colors] || '#8b7355'
}

// Collection of NPCs for the village
export function VillageNPCs() {
  // Define various paths around the village
  const paths = useMemo(() => ({
    marketPath: [
      [-8, 0.8, -8] as [number, number, number],
      [-3, 0.8, -8] as [number, number, number],
      [-3, 0.8, 0] as [number, number, number],
      [3, 0.8, 0] as [number, number, number],
      [3, 0.8, 8] as [number, number, number],
      [-3, 0.8, 8] as [number, number, number],
      [-8, 0.8, 0] as [number, number, number],
    ],
    guardPath: [
      [-10, 0.8, -10] as [number, number, number],
      [10, 0.8, -10] as [number, number, number],
      [10, 0.8, 10] as [number, number, number],
      [-10, 0.8, 10] as [number, number, number],
    ],
    fishermanPath: [
      [-12, 0.8, 0] as [number, number, number],
      [-12, 0.8, 5] as [number, number, number],
      [-10, 0.8, 5] as [number, number, number],
      [-10, 0.8, 0] as [number, number, number],
    ],
    merchantPath1: [
      [0, 0.8, -10] as [number, number, number],
      [0, 0.8, 0] as [number, number, number],
      [5, 0.8, 0] as [number, number, number],
      [5, 0.8, 10] as [number, number, number],
      [0, 0.8, 10] as [number, number, number],
      [0, 0.8, -10] as [number, number, number],
    ],
    merchantPath2: [
      [-5, 0.8, -5] as [number, number, number],
      [5, 0.8, -5] as [number, number, number],
      [5, 0.8, 5] as [number, number, number],
      [-5, 0.8, 5] as [number, number, number],
    ],
  }), [])

  return (
    <group>
      {/* Peasants walking around market */}
      <NPC path={paths.marketPath} speed={0.8} type="peasant" />
      <NPC path={paths.marketPath} speed={0.6} type="peasant" color="#9a8365" />

      {/* Guards patrolling */}
      <NPC path={paths.guardPath} speed={0.5} type="guard" />
      <NPC path={paths.guardPath} speed={0.5} type="guard" />

      {/* Fisherman by the docks */}
      <NPC path={paths.fishermanPath} speed={0.4} type="fisherman" />

      {/* Merchants */}
      <NPC path={paths.merchantPath1} speed={0.7} type="merchant" />
      <NPC path={paths.merchantPath2} speed={0.6} type="merchant" color="#7a5a4a" />

      {/* Vendors at square (mostly stationary) */}
      <NPC
        path={[
          [0, 0.8, 0] as [number, number, number],
          [0.5, 0.8, 0] as [number, number, number],
        ]}
        speed={0.1}
        type="vendor"
      />
    </group>
  )
}
