import { useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'

interface BuildingProps {
  position: [number, number, number]
  rotation?: number
  type: 'merchant' | 'dwelling' | 'warehouse' | 'guild' | 'tavern'
  stories?: number
}

export function Building({ position, rotation = 0, type, stories = 2 }: BuildingProps) {
  const hour = useStore((state) => state.time.hour)

  // Determine if lights should be on
  const lightsOn = hour < 6 || hour > 18

  const colors = {
    merchant: '#8b7355',
    dwelling: '#a0826d',
    warehouse: '#6b5d52',
    guild: '#9b8169',
    tavern: '#7a5c4a',
  }

  const baseColor = colors[type]
  const width = type === 'warehouse' ? 4 : 3
  const depth = type === 'warehouse' ? 3 : 2.5
  const storyHeight = 2.5

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Building base/foundation */}
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.4, depth]} />
        <meshStandardMaterial color="#4a4a4a" roughness={0.9} />
      </mesh>

      {/* Main building structure - timber frame */}
      {Array.from({ length: stories }).map((_, i) => (
        <group key={i} position={[0, 0.4 + i * storyHeight, 0]}>
          {/* Main walls */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[width, storyHeight, depth]} />
            <meshStandardMaterial color={baseColor} roughness={0.85} />
          </mesh>

          {/* Timber frame details */}
          <TimberFrame width={width} height={storyHeight} depth={depth} />

          {/* Windows */}
          <Windows
            width={width}
            height={storyHeight}
            depth={depth}
            lightsOn={lightsOn && type === 'tavern' && i === 0}
          />
        </group>
      ))}

      {/* Roof - steep pitched Nordic style */}
      <Roof width={width} depth={depth} yOffset={0.4 + stories * storyHeight} />
    </group>
  )
}

function TimberFrame({
  width,
  height,
  depth,
}: {
  width: number
  height: number
  depth: number
}) {
  const timberColor = '#3a2a1a'

  return (
    <group>
      {/* Vertical beams on front */}
      {[-width / 3, 0, width / 3].map((x, i) => (
        <mesh key={`front-${i}`} position={[x, 0, depth / 2 + 0.01]} castShadow>
          <boxGeometry args={[0.15, height, 0.15]} />
          <meshStandardMaterial color={timberColor} roughness={0.9} />
        </mesh>
      ))}

      {/* Horizontal beams */}
      <mesh position={[0, height / 2, depth / 2 + 0.01]} castShadow>
        <boxGeometry args={[width, 0.15, 0.15]} />
        <meshStandardMaterial color={timberColor} roughness={0.9} />
      </mesh>
    </group>
  )
}

function Windows({
  width,
  height,
  depth,
  lightsOn,
}: {
  width: number
  height: number
  depth: number
  lightsOn: boolean
}) {
  const windowPositions = [
    [-width / 3, 0, depth / 2],
    [width / 3, 0, depth / 2],
  ]

  return (
    <>
      {windowPositions.map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <boxGeometry args={[0.6, 0.8, 0.05]} />
          <meshStandardMaterial
            color={lightsOn ? '#ffaa44' : '#2a2a2a'}
            emissive={lightsOn ? '#ff8822' : '#000000'}
            emissiveIntensity={lightsOn ? 0.5 : 0}
          />
        </mesh>
      ))}
    </>
  )
}

function Roof({
  width,
  depth,
  yOffset,
}: {
  width: number
  depth: number
  yOffset: number
}) {
  const roofHeight = 2
  const roofGeometry = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(-width / 2, 0)
    shape.lineTo(0, roofHeight)
    shape.lineTo(width / 2, 0)
    shape.lineTo(-width / 2, 0)

    return new THREE.ExtrudeGeometry(shape, {
      depth: depth,
      bevelEnabled: false,
    })
  }, [width, depth])

  return (
    <mesh
      geometry={roofGeometry}
      position={[0, yOffset, -depth / 2]}
      rotation={[Math.PI / 2, 0, 0]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color="#5a3a2a" roughness={0.95} />
    </mesh>
  )
}

// Large church - Storkyrkan
export function Church({ position }: { position: [number, number, number] }) {
  const hour = useStore((state) => state.time.hour)
  const lightsOn = hour < 6 || hour > 18

  return (
    <group position={position}>
      {/* Main church building */}
      <mesh position={[0, 4, 0]} castShadow receiveShadow>
        <boxGeometry args={[12, 8, 18]} />
        <meshStandardMaterial color="#8b6b5a" roughness={0.85} />
      </mesh>

      {/* Roof */}
      <mesh position={[0, 8.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[13, 1, 19]} />
        <meshStandardMaterial color="#4a3a2a" roughness={0.95} />
      </mesh>

      {/* Tower */}
      <mesh position={[0, 12, -7]} castShadow receiveShadow>
        <boxGeometry args={[4, 8, 4]} />
        <meshStandardMaterial color="#8b6b5a" roughness={0.85} />
      </mesh>

      {/* Spire */}
      <mesh position={[0, 16.5, -7]} castShadow>
        <coneGeometry args={[2.5, 5, 4]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>

      {/* Windows with stained glass effect */}
      {[-4, 0, 4].map((z, i) => (
        <mesh key={i} position={[6.1, 5, z]} castShadow>
          <boxGeometry args={[0.1, 3, 1.5]} />
          <meshStandardMaterial
            color={lightsOn ? '#ffcc66' : '#4a3a5a'}
            emissive={lightsOn ? '#ff8822' : '#000000'}
            emissiveIntensity={lightsOn ? 0.3 : 0}
          />
        </mesh>
      ))}
    </group>
  )
}

// Castle (Three Crowns)
export function Castle({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Main castle structure */}
      <mesh position={[0, 5, 0]} castShadow receiveShadow>
        <boxGeometry args={[20, 10, 15]} />
        <meshStandardMaterial color="#6b5b4a" roughness={0.8} />
      </mesh>

      {/* Towers at corners */}
      {[
        [-10, 0, -7.5],
        [10, 0, -7.5],
        [-10, 0, 7.5],
        [10, 0, 7.5],
      ].map((pos, i) => (
        <group key={i}>
          <mesh position={pos as [number, number, number]} castShadow receiveShadow>
            <cylinderGeometry args={[2, 2, 14, 8]} />
            <meshStandardMaterial color="#5a4a3a" roughness={0.85} />
          </mesh>
          <mesh
            position={[pos[0], pos[1] + 8, pos[2]] as [number, number, number]}
            castShadow
          >
            <coneGeometry args={[2.5, 3, 8]} />
            <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Main tower */}
      <mesh position={[0, 8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[3, 3, 6, 8]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.85} />
      </mesh>

      {/* Three crowns on top */}
      {[-2, 0, 2].map((x, i) => (
        <mesh key={i} position={[x, 12, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.4, 0.8, 6]} />
          <meshStandardMaterial color="#ffd700" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
    </group>
  )
}

// City wall segment
export function WallSegment({
  start,
  end,
  height = 4,
}: {
  start: [number, number, number]
  end: [number, number, number]
  height?: number
}) {
  const length = Math.sqrt(
    Math.pow(end[0] - start[0], 2) + Math.pow(end[2] - start[2], 2)
  )
  const angle = Math.atan2(end[2] - start[2], end[0] - start[0])
  const midpoint: [number, number, number] = [
    (start[0] + end[0]) / 2,
    height / 2,
    (start[2] + end[2]) / 2,
  ]

  return (
    <mesh position={midpoint} rotation={[0, angle, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, height, 1]} />
      <meshStandardMaterial color="#5a5a5a" roughness={0.95} />
    </mesh>
  )
}
