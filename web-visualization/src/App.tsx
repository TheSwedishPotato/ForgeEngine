import { Canvas } from '@react-three/fiber'
import { Scene } from './components/Scene'
import { UI } from './components/UI'

function App() {
  return (
    <>
      <Canvas
        shadows
        camera={{
          position: [30, 30, 30],
          fov: 50,
        }}
        gl={{
          antialias: true,
          alpha: false,
        }}
      >
        <Scene />
      </Canvas>
      <UI />
    </>
  )
}

export default App
