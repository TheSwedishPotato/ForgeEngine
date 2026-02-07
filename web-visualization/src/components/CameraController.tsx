import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useStore } from '../store'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'

export function CameraController() {
  const controlsRef = useRef<OrbitControlsType>(null)
  const { camera } = useThree()
  const { autoRotate, rotationSpeed, zoom } = useStore((state) => state.camera)

  // Set initial camera position
  useEffect(() => {
    camera.position.set(30, 30, 30)
    camera.lookAt(0, 0, 0)
  }, [camera])

  // Handle zoom changes
  useFrame(() => {
    if (controlsRef.current) {
      // Adjust distance based on zoom level
      const targetDistance = 40 / zoom
      const currentDistance = controlsRef.current.getDistance()

      if (Math.abs(currentDistance - targetDistance) > 0.1) {
        const newDistance = currentDistance + (targetDistance - currentDistance) * 0.1
        const direction = camera.position.clone().normalize()
        camera.position.copy(direction.multiplyScalar(newDistance))
      }
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      autoRotate={autoRotate}
      autoRotateSpeed={rotationSpeed}
      enableDamping
      dampingFactor={0.05}
      minDistance={20}
      maxDistance={80}
      maxPolarAngle={Math.PI / 2.5} // Limit how low camera can go
      minPolarAngle={Math.PI / 6} // Limit how high camera can go
      target={[0, 0, 0]}
      enablePan={true}
      panSpeed={0.5}
    />
  )
}
