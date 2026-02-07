import * as THREE from 'three'

export function Island() {
  // Create an island shape - roughly oval for Stadsholmen
  const islandShape = new THREE.Shape()

  // Approximate shape of Stadsholmen island
  const points = []
  const numPoints = 32
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2
    const radiusX = 15 + Math.sin(angle * 3) * 2 // Irregular coastline
    const radiusZ = 10 + Math.cos(angle * 4) * 1.5
    const x = Math.cos(angle) * radiusX
    const z = Math.sin(angle) * radiusZ

    if (i === 0) {
      islandShape.moveTo(x, z)
    } else {
      islandShape.lineTo(x, z)
    }
    points.push(new THREE.Vector3(x, 0, z))
  }
  islandShape.closePath()

  return (
    <group>
      {/* Main island terrain */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <extrudeGeometry
          args={[
            islandShape,
            {
              depth: 0.8,
              bevelEnabled: true,
              bevelThickness: 0.2,
              bevelSize: 0.3,
              bevelSegments: 5,
            },
          ]}
        />
        <meshStandardMaterial
          color="#5a4a3a"
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>

      {/* Grass/earth on top */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.81, 0]} receiveShadow>
        <extrudeGeometry
          args={[
            islandShape,
            {
              depth: 0.01,
              bevelEnabled: false,
            },
          ]}
        />
        <meshStandardMaterial
          color="#4a6b3a"
          roughness={0.95}
          metalness={0}
        />
      </mesh>

      {/* Cobblestone streets - main paths */}
      <StreetsOverlay />
    </group>
  )
}

function StreetsOverlay() {
  return (
    <group position={[0, 0.82, 0]}>
      {/* Main street running north-south */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2, 20]} />
        <meshStandardMaterial color="#6b6b5a" roughness={0.95} />
      </mesh>

      {/* East-West street */}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} receiveShadow>
        <planeGeometry args={[2, 25]} />
        <meshStandardMaterial color="#6b6b5a" roughness={0.95} />
      </mesh>

      {/* Stortorget square */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#7a7a68" roughness={0.9} />
      </mesh>

      {/* Smaller alley streets */}
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[-8 + i * 3, 0, -5 + (i % 2) * 10]}
          receiveShadow
        >
          <planeGeometry args={[1, 8]} />
          <meshStandardMaterial color="#6b6b5a" roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}
