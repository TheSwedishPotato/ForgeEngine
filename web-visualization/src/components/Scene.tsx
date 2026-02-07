import { Island } from './Island'
import { Water } from './Water'
import { Building, Church, Castle, WallSegment } from '../models/Buildings'
import { VillageNPCs } from './NPCs'
import { VillageAnimals } from './Animals'
import { VillageEffects } from './ParticleEffects'
import { DayNightCycle } from '../systems/DayNightCycle'
import { CameraController } from './CameraController'

export function Scene() {
  return (
    <>
      {/* Camera and Lighting */}
      <CameraController />
      <DayNightCycle />

      {/* Environment */}
      <Water />
      <Island />

      {/* Historical Landmarks */}

      {/* Storkyrkan - The Great Church (centerpiece) */}
      <Church position={[0, 0, -5]} />

      {/* Three Crowns Castle - Northern tip */}
      <Castle position={[0, 0, -12]} />

      {/* City Wall segments around the island */}
      <CityWall />

      {/* Merchant Buildings around Stortorget square */}
      <Building position={[-4, 0, 0]} rotation={0} type="merchant" stories={3} />
      <Building position={[4, 0, 0]} rotation={Math.PI} type="merchant" stories={3} />
      <Building position={[0, 0, 4]} rotation={-Math.PI / 2} type="merchant" stories={2} />
      <Building position={[-6, 0, 3]} rotation={Math.PI / 4} type="guild" stories={2} />

      {/* Regular dwellings scattered around */}
      <Building position={[-7, 0, -3]} rotation={0.5} type="dwelling" stories={2} />
      <Building position={[6, 0, -4]} rotation={-0.3} type="dwelling" stories={2} />
      <Building position={[-5, 0, 7]} rotation={1.2} type="dwelling" stories={2} />
      <Building position={[7, 0, 6]} rotation={-1.5} type="dwelling" stories={2} />
      <Building position={[-8, 0, -7]} rotation={0.8} type="dwelling" stories={2} />
      <Building position={[5, 0, 8]} rotation={-0.6} type="dwelling" stories={2} />

      {/* Warehouses near waterfront */}
      <Building position={[-10, 0, -2]} rotation={Math.PI / 2} type="warehouse" stories={2} />
      <Building position={[10, 0, -1]} rotation={-Math.PI / 2} type="warehouse" stories={2} />
      <Building position={[-9, 0, 5]} rotation={Math.PI / 3} type="warehouse" stories={1} />

      {/* Taverns */}
      <Building position={[-3, 0, -7]} rotation={0.2} type="tavern" stories={2} />
      <Building position={[8, 0, 2]} rotation={-0.9} type="tavern" stories={2} />

      {/* More residential buildings */}
      <Building position={[3, 0, -8]} rotation={0.4} type="dwelling" stories={2} />
      <Building position={[-2, 0, 9]} rotation={-1.1} type="dwelling" stories={2} />
      <Building position={[9, 0, -6]} rotation={0.7} type="dwelling" stories={2} />
      <Building position={[-6, 0, -9]} rotation={-0.4} type="dwelling" stories={2} />

      {/* Wooden docks */}
      <Docks />

      {/* Living elements */}
      <VillageNPCs />
      <VillageAnimals />
      <VillageEffects />
    </>
  )
}

function CityWall() {
  // Create wall segments around the island perimeter
  const wallPoints: [number, number, number][] = [
    [-12, 0, -10],
    [-10, 0, -12],
    [0, 0, -14],
    [10, 0, -12],
    [12, 0, -8],
    [13, 0, 0],
    [12, 0, 8],
    [8, 0, 11],
    [0, 0, 12],
    [-8, 0, 11],
    [-12, 0, 8],
    [-13, 0, 0],
    [-12, 0, -10],
  ]

  return (
    <group>
      {wallPoints.slice(0, -1).map((point, i) => (
        <WallSegment
          key={i}
          start={point}
          end={wallPoints[i + 1]}
          height={3.5}
        />
      ))}

      {/* Wall towers at key points */}
      {[
        [-10, 0, -12],
        [10, 0, -12],
        [13, 0, 0],
        [8, 0, 11],
        [-8, 0, 11],
        [-13, 0, 0],
      ].map((pos, i) => (
        <mesh
          key={i}
          position={[pos[0], 2.5, pos[2]] as [number, number, number]}
          castShadow
          receiveShadow
        >
          <cylinderGeometry args={[1.2, 1.2, 5, 8]} />
          <meshStandardMaterial color="#4a4a4a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

function Docks() {
  return (
    <group>
      {/* Wooden pier extending into water - East side */}
      <mesh position={[14, -0.3, 0]} rotation={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[4, 0.3, 3]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.95} />
      </mesh>

      {/* Wooden pier - West side */}
      <mesh position={[-14, -0.3, 2]} rotation={[0, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[4, 0.3, 2.5]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.95} />
      </mesh>

      {/* Support posts for docks */}
      {[
        [13, -1, -1],
        [13, -1, 1],
        [15, -1, -1],
        [15, -1, 1],
        [-13, -1, 1.5],
        [-13, -1, 2.5],
        [-15, -1, 1.5],
        [-15, -1, 2.5],
      ].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} receiveShadow>
          <cylinderGeometry args={[0.15, 0.15, 2, 8]} />
          <meshStandardMaterial color="#3a2a1a" roughness={0.95} />
        </mesh>
      ))}

      {/* Small boats moored at docks */}
      <Boat position={[15, -0.4, 0.5]} rotation={0.2} />
      <Boat position={[14.5, -0.4, -1]} rotation={-0.3} />
      <Boat position={[-15, -0.4, 2]} rotation={1.5} />
    </group>
  )
}

function Boat({
  position,
  rotation,
}: {
  position: [number, number, number]
  rotation: number
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Boat hull */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.5, 1]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>

      {/* Boat ends */}
      <mesh position={[1.3, 0.2, 0]} rotation={[0, 0, Math.PI / 6]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.9]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>
      <mesh position={[-1.3, 0.2, 0]} rotation={[0, 0, -Math.PI / 6]} castShadow>
        <boxGeometry args={[0.3, 0.4, 0.9]} />
        <meshStandardMaterial color="#5a4a3a" />
      </mesh>
    </group>
  )
}
