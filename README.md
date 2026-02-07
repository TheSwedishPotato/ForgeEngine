# Forge Engine - Medieval Life Simulation

## Overview
Forge Engine is an advanced medieval life simulation system that models complex social, economic, and environmental interactions in a historically accurate setting. The engine uses cutting-edge AI and machine learning techniques to create emergent behaviors and narratives.

## Features

### Core Systems
- Multi-threaded simulation engine
- Advanced memory management with object pooling
- Comprehensive profiling and logging
- Save/load functionality

### AI and Behavior
- Personality-driven NPC behavior
- Emotional response system
- Machine learning for decision making
- Adaptive storytelling

### Historical Simulation
- Era-specific social norms
- Complex economic systems
- Professional progression
- Cultural constraints

### Environmental Systems
- Dynamic climate simulation
- Seasonal changes
- Natural disasters
- Resource management

### Multi-Village Mechanics
- Inter-village trade
- Diplomatic relations
- Technology diffusion
- Cultural exchange

### Visualization
- SFML-based rendering (C++ engine)
- Interactive UI
- Camera controls
- Minimap system
- Web-based 3D visualization (Medieval Stockholm 1554)
  - React Three Fiber for stunning 3D graphics
  - Day/night cycle with dynamic lighting
  - Animated NPCs and environmental effects
  - See [web-visualization/README.md](web-visualization/README.md)

## Getting Started

### Prerequisites
- C++20 compatible compiler
- CMake 3.15+
- vcpkg package manager
- SFML 2.5+
- TensorFlow
- Sol2 (Lua binding)
- nlohmann/json
- spdlog

### Building
```bash
mkdir build
cd build
cmake ..
cmake --build .
```

### Running Tests
```bash
cd build
ctest
```

### Web Visualization (Stockholm 1554)
```bash
cd web-visualization
npm install
npm run dev
```
Then open http://localhost:3000 in your browser to see the stunning 3D visualization!

## Documentation
- [User Guide](docs/user_guide.md)
- [Technical Documentation](docs/technical/README.md)
- [API Reference](docs/api/README.md)
- [Contributing Guidelines](CONTRIBUTING.md)

## Academic Research
This project serves as a platform for academic research in:
- Agent-based social simulation
- Historical behavior modeling
- Emergent narrative generation
- Computational sociology

## Contributing
We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments
- Medieval historians and sociologists who provided domain expertise
- Open-source community for various dependencies
- Research institutions collaborating on the project

## Publications
- [List of academic publications using Forge Engine]
- [Research papers and findings]

## Contact
- Project Website: [URL]
- Academic Inquiries: [Email]
- Technical Support: [Email]
