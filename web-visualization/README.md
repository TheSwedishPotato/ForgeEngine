# Medieval Stockholm 1554 - 3D Visual Showcase

A stunning bird's eye view 3D recreation of Stockholm in 1554, featuring historically accurate architecture set on Stadsholmen island with living, animated elements and a beautiful day/night cycle.

## Features

### Historical Setting
- **Location**: Stadsholmen island (now Gamla Stan/Old Town), Stockholm
- **Era**: 1554 - Early Vasa dynasty period under King Gustav I
- **Style**: North-Germanic medieval architecture with Hanseatic influences

### Core Elements
- Stadsholmen Island surrounded by animated water
- The Great Church (Storkyrkan) - prominent brick church as centerpiece
- Stortorget - main market square with surrounding buildings
- City wall with defensive towers
- The Royal Castle (Three Crowns) on the northern tip
- Timber-framed merchant houses and dwellings
- Wooden docks with moored boats

### Living Village
- **Animated Characters**: Peasants, merchants, guards, fishermen, and vendors walking on paths
- **Animals**: Chickens, horses, sheep, and seagulls with realistic behaviors
- **Environmental Effects**: Chimney smoke, forge glow, torches lit at night
- **Water**: Animated water with realistic waves around the island

### Day/Night Cycle
- Full 24-hour cycle with smooth transitions
- Dynamic lighting that changes throughout the day
- Daytime, golden hour, and nighttime atmospheres
- Buildings and torches light up at night
- Adjustable time speed and manual time control

### Camera System
- Bird's eye perspective looking down at the island
- Auto-rotation around the scene
- Manual camera controls (rotate, pan, zoom)
- Adjustable rotation speed and zoom level

## Installation

```bash
cd web-visualization
npm install
```

## Running the Application

```bash
npm run dev
```

Then open your browser to `http://localhost:3000`

## Controls

### Mouse Controls
- **Left Click + Drag**: Rotate camera
- **Right Click + Drag**: Pan camera
- **Scroll**: Zoom in/out

### UI Controls
- **Time Slider**: Manually set time of day (0-24 hours)
- **Speed Control**: Adjust time passage speed (0.1x - 10x)
- **Play/Pause**: Control time progression
- **Auto Rotate**: Toggle automatic camera rotation
- **Rotation Speed**: Adjust auto-rotation speed
- **Zoom**: Control camera distance

## Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Technology Stack

- **React** - UI framework
- **Three.js** - 3D rendering engine
- **React Three Fiber** - React renderer for Three.js
- **@react-three/drei** - Useful helpers for R3F
- **Zustand** - State management
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server

## Project Structure

```
src/
├── components/         # React 3D components
│   ├── Animals.tsx    # Animal models and animations
│   ├── CameraController.tsx  # Camera control system
│   ├── Island.tsx     # Island terrain and streets
│   ├── NPCs.tsx       # Villager animations
│   ├── ParticleEffects.tsx  # Smoke, fire, torches
│   ├── Scene.tsx      # Main scene composition
│   ├── UI.tsx         # 2D UI overlay
│   └── Water.tsx      # Water shader and animation
├── models/            # 3D models
│   └── Buildings.tsx  # Building models and landmarks
├── systems/           # Game systems
│   └── DayNightCycle.tsx  # Day/night lighting system
├── shaders/           # Custom shaders
│   └── waterShader.ts # Water animation shader
├── types/             # TypeScript types
│   └── index.ts
├── store.ts           # Zustand state management
├── main.tsx           # App entry point
└── App.tsx            # Main App component
```

## Historical Accuracy

This visualization aims to represent Stockholm's Stadsholmen island as it appeared in 1554:

- **Architecture**: Timber-framed buildings with steep pitched roofs typical of Nordic medieval construction
- **Layout**: Narrow cobblestone streets and the central Stortorget square
- **Landmarks**: Storkyrkan (Great Church) and the Three Crowns Castle in their approximate historical locations
- **Activities**: Period-appropriate activities including market trade, fishing, and guard patrols
- **Defenses**: City walls and towers that protected the medieval settlement

## Future Enhancements

Potential additions:
- More detailed building interiors
- Seasonal variations (snow in winter, etc.)
- Weather effects (rain, fog)
- Sound effects and ambient audio
- Historical events playback
- More NPC types and behaviors
- Ship traffic in the harbor
- Integration with ForgeEngine C++ simulation backend

## License

MIT License - See LICENSE file for details

## Credits

Built with React Three Fiber for the ForgeEngine medieval simulation project.
