import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'

export function DayNightCycle() {
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const moonRef = useRef<THREE.DirectionalLight>(null)
  const ambientRef = useRef<THREE.AmbientLight>(null)
  const hemisphereRef = useRef<THREE.HemisphereLight>(null)

  const { hour, updateTime } = useStore((state) => ({
    hour: state.time.hour,
    updateTime: state.updateTime,
  }))

  // Update time every frame
  useFrame((state, delta) => {
    updateTime(delta)
  })

  // Calculate sun/moon position and lighting based on hour
  const lighting = useMemo(() => {
    // Hour ranges:
    // 0-6: Night
    // 6-8: Dawn
    // 8-18: Day
    // 18-20: Dusk
    // 20-24: Night

    const dayProgress = hour / 24
    const sunAngle = dayProgress * Math.PI * 2 - Math.PI / 2

    // Sun position (opposite of angle)
    const sunX = Math.cos(sunAngle) * 50
    const sunY = Math.sin(sunAngle) * 50
    const sunZ = 20

    // Moon position (12 hours offset)
    const moonAngle = sunAngle + Math.PI
    const moonX = Math.cos(moonAngle) * 50
    const moonY = Math.sin(moonAngle) * 50
    const moonZ = 20

    // Calculate lighting intensity based on time
    let sunIntensity = 0
    let moonIntensity = 0
    let ambientIntensity = 0.3
    let skyColor = new THREE.Color(0x87ceeb) // Default day sky

    if (hour >= 6 && hour < 8) {
      // Dawn
      const dawnProgress = (hour - 6) / 2
      sunIntensity = dawnProgress * 2.0
      ambientIntensity = 0.3 + dawnProgress * 0.2
      skyColor = new THREE.Color().lerpColors(
        new THREE.Color(0x1a1a2e),
        new THREE.Color(0xff8c42),
        dawnProgress
      )
    } else if (hour >= 8 && hour < 18) {
      // Day
      sunIntensity = 2.0
      ambientIntensity = 0.5
      skyColor = new THREE.Color(0x87ceeb)
    } else if (hour >= 18 && hour < 20) {
      // Dusk
      const duskProgress = (hour - 18) / 2
      sunIntensity = (1 - duskProgress) * 2.0
      moonIntensity = duskProgress * 0.5
      ambientIntensity = 0.5 - duskProgress * 0.3
      skyColor = new THREE.Color().lerpColors(
        new THREE.Color(0xff8c42),
        new THREE.Color(0x1a1a2e),
        duskProgress
      )
    } else {
      // Night
      sunIntensity = 0
      moonIntensity = 0.5
      ambientIntensity = 0.2
      skyColor = new THREE.Color(0x1a1a2e)
    }

    return {
      sunPosition: new THREE.Vector3(sunX, sunY, sunZ),
      moonPosition: new THREE.Vector3(moonX, moonY, moonZ),
      sunIntensity,
      moonIntensity,
      ambientIntensity,
      sunColor: new THREE.Color(0xfff5e6),
      moonColor: new THREE.Color(0xb0c4de),
      skyColor,
    }
  }, [hour])

  // Update background color
  useFrame(({ scene }) => {
    scene.background = lighting.skyColor
  })

  return (
    <>
      {/* Sun - Directional light */}
      <directionalLight
        ref={sunRef}
        position={lighting.sunPosition}
        intensity={lighting.sunIntensity}
        color={lighting.sunColor}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />

      {/* Moon - Directional light */}
      <directionalLight
        ref={moonRef}
        position={lighting.moonPosition}
        intensity={lighting.moonIntensity}
        color={lighting.moonColor}
      />

      {/* Ambient light for overall illumination */}
      <ambientLight ref={ambientRef} intensity={lighting.ambientIntensity} />

      {/* Hemisphere light for sky/ground gradient */}
      <hemisphereLight
        ref={hemisphereRef}
        args={[lighting.skyColor, new THREE.Color(0x4a4a4a), 0.3]}
      />

      {/* Fog for atmosphere */}
      <fog attach="fog" args={[lighting.skyColor, 50, 200]} />
    </>
  )
}
