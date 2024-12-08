# Forge Engine API Documentation

## Core Systems

### ObjectPool
Memory management system for efficient object allocation and reuse.

```cpp
template<typename T>
class ObjectPool {
    ObjectPool(size_t initialSize);
    T* acquire();
    void release(T* obj);
};
```

### ThreadPool
Multi-threaded task execution system.

```cpp
class ThreadPool {
    ThreadPool(size_t threadCount);
    void enqueue(std::function<void()> task);
};
```

## Game Systems

### MultiVillageSystem
Manages multiple villages and their interactions.

```cpp
class MultiVillageSystem {
    void addVillage(const std::string& name, sf::Vector2f position);
    void createTradeRoute(const std::string& village1, const std::string& village2);
    void update(float deltaTime);
};
```

### EnvironmentalSystem
Simulates climate and environmental effects.

```cpp
class EnvironmentalSystem {
    void setWeather(Climate::WeatherType type);
    void update(float deltaTime);
};
```

### TechnologySystem
Manages technological progression and research.

```cpp
class TechnologySystem {
    void startResearch(const std::string& technology);
    void updateTechnology(float deltaTime);
};
```

## AI Systems

### StorytellingSystem
Generates dynamic narratives and events.

```cpp
class StorytellingSystem {
    void addEvent(const StoryEvent& event);
    void createStoryArc(const std::string& name, const std::vector<StoryEvent>& events);
    void update(float deltaTime);
};
```

### PersonalitySystem
Manages NPC personalities and traits.

```cpp
class PersonalitySystem {
    void addTrait(const std::string& trait);
    float getTraitValue(const std::string& trait);
};
```

## Historical Systems

### CulturalSystem
Manages cultural norms and constraints.

```cpp
class CulturalSystem {
    void addCulturalNorm(const std::string& norm);
    bool checkNormCompliance(const Action& action);
};
```

### EconomicSystem
Handles economic simulation and trade.

```cpp
class EconomicSystem {
    void addResource(const std::string& resource, float amount);
    void simulateMarket(float deltaTime);
};
```

## Best Practices

1. Memory Management
   - Use ObjectPool for frequently created/destroyed objects
   - Prefer smart pointers over raw pointers
   - Clean up resources in destructors

2. Threading
   - Use ThreadPool for parallel tasks
   - Ensure thread safety in shared resources
   - Avoid data races and deadlocks

3. Performance
   - Profile critical code paths
   - Use appropriate data structures
   - Minimize memory allocations

4. Historical Accuracy
   - Validate against historical sources
   - Document historical assumptions
   - Consider regional variations

## Examples

### Creating a New Village
```cpp
auto villageSystem = std::make_shared<MultiVillageSystem>(
    threadPool, envSystem, techSystem, tradeSystem, storySystem
);
villageSystem->addVillage("Medieval Town", sf::Vector2f(100, 100));
```

### Generating Stories
```cpp
auto storySystem = std::make_shared<StorytellingSystem>(
    threadPool, envSystem, techSystem
);
StoryEvent event{
    StoryEvent::Type::Social,
    "Market Day",
    "A bustling market attracts traders",
    0.7f,
    0.4f,
    {"Village1"},
    {"Economic Impact"},
    true
};
storySystem->addEvent(event);
```

## Error Handling
- Use exceptions for exceptional cases
- Return status codes for expected failures
- Log errors with appropriate severity

## Thread Safety
- Document thread safety guarantees
- Use appropriate synchronization primitives
- Avoid global state

## Performance Considerations
- Profile before optimizing
- Use benchmarks to measure improvements
- Consider memory usage patterns

## Version Compatibility
- Document breaking changes
- Maintain backward compatibility when possible
- Use semantic versioning
