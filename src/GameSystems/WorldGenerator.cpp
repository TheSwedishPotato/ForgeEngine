#include "WorldGenerator.h"
#include <cmath>
#include <algorithm>
#include <random>

namespace Forge {

WorldGenerator::WorldGenerator(int worldSizeX, int worldSizeZ)
    : m_worldSizeX(worldSizeX), m_worldSizeZ(worldSizeZ) {
    // Initialize biomes
    m_biomes = {
        {TerrainType::Grassland, 0.3f, 0.5f, 
            {"grass", "wildflowers"}, 
            {"clay", "stone"}},
        {TerrainType::Forest, 0.5f, 0.7f, 
            {"oak", "pine", "birch"}, 
            {"wood", "berries"}},
        {TerrainType::Rocky, 0.7f, 0.2f, 
            {"moss", "lichen"}, 
            {"iron", "copper"}}
    };
}

void WorldGenerator::GenerateWorld() {
    GenerateTerrain();
    GenerateBuildings();
    PopulateBiomes();
}

void WorldGenerator::GenerateTerrain() {
    m_terrain.resize(m_worldSizeX * m_worldSizeZ);

    for (int x = 0; x < m_worldSizeX; ++x) {
        for (int z = 0; z < m_worldSizeZ; ++z) {
            int index = x + z * m_worldSizeX;
            
            // Generate height using Perlin noise
            float height = GeneratePerlinNoise(x * 0.1f, z * 0.1f, 4);
            
            // Generate moisture
            float moisture = GeneratePerlinNoise(x * 0.2f, z * 0.2f, 2);
            
            // Determine terrain type
            TerrainType type = DetermineTerrainType(height, moisture);

            m_terrain[index] = {
                {static_cast<float>(x), height, static_cast<float>(z)},  // Position
                type,  // Terrain Type
                height,  // Height
                moisture,  // Fertility
                type != TerrainType::Rocky  // Walkability
            };
        }
    }
}

void WorldGenerator::GenerateBuildings() {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_real_distribution<> dis(0, 1);

    // Generate different types of buildings
    std::vector<BuildingType> buildingTypes = {
        BuildingType::House, 
        BuildingType::Blacksmith, 
        BuildingType::Tavern, 
        BuildingType::Church, 
        BuildingType::Farm
    };

    for (auto buildingType : buildingTypes) {
        int numBuildings = static_cast<int>(m_worldSizeX * m_worldSizeZ * 0.01);  // 1% of world tiles
        
        for (int i = 0; i < numBuildings; ++i) {
            // Find a suitable location based on terrain
            TerrainType preferredTerrain = (buildingType == BuildingType::Farm) 
                ? TerrainType::Grassland 
                : TerrainType::Grassland;
            
            DirectX::XMFLOAT3 location = GenerateBuildingLocation(preferredTerrain);

            m_buildings.push_back({
                buildingType,
                location,
                10.0f,  // Width
                10.0f,  // Length
                buildingType == BuildingType::House ? static_cast<int>(dis(gen) * 5) : 0,  // Inhabitants
                true  // Occupied
            });
        }
    }
}

void WorldGenerator::PopulateBiomes() {
    // Additional biome population logic can be added here
    // For example, spawning specific resources or vegetation
}

float WorldGenerator::GeneratePerlinNoise(float x, float y, int octaves) {
    float noise = 0.0f;
    float amplitude = 1.0f;
    float frequency = 1.0f;
    float maxValue = 0.0f;

    for (int i = 0; i < octaves; ++i) {
        float sampleX = x * frequency;
        float sampleY = y * frequency;

        // Simple noise generation (replace with more sophisticated noise)
        float perlinValue = std::sin(sampleX) * std::cos(sampleY);
        
        noise += perlinValue * amplitude;
        
        maxValue += amplitude;
        amplitude *= 0.5f;
        frequency *= 2.0f;
    }

    // Normalize noise
    return noise / maxValue;
}

TerrainType WorldGenerator::DetermineTerrainType(float height, float moisture) {
    if (height < 0.3f) return TerrainType::River;
    if (height > 0.7f) return TerrainType::Rocky;
    if (moisture > 0.6f) return TerrainType::Forest;
    if (moisture < 0.4f) return TerrainType::Rocky;
    return TerrainType::Grassland;
}

DirectX::XMFLOAT3 WorldGenerator::GenerateBuildingLocation(TerrainType preferredTerrain) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> disX(0, m_worldSizeX - 1);
    std::uniform_int_distribution<> disZ(0, m_worldSizeZ - 1);

    while (true) {
        int x = disX(gen);
        int z = disZ(gen);
        int index = x + z * m_worldSizeX;

        if (m_terrain[index].type == preferredTerrain && m_terrain[index].isWalkable) {
            return {static_cast<float>(x), m_terrain[index].height, static_cast<float>(z)};
        }
    }
}

// Resource Manager Implementation
void ResourceManager::AddResource(const std::string& name, int quantity, float baseValue) {
    m_resources.push_back({name, quantity, baseValue});
}

void ResourceManager::ModifyResourceQuantity(const std::string& name, int delta) {
    auto it = std::find_if(m_resources.begin(), m_resources.end(), 
        [&name](const Resource& r) { return r.name == name; });
    
    if (it != m_resources.end()) {
        it->quantity += delta;
    }
}

float ResourceManager::CalculateResourceValue(const std::string& name) {
    auto it = std::find_if(m_resources.begin(), m_resources.end(), 
        [&name](const Resource& r) { return r.name == name; });
    
    if (it != m_resources.end()) {
        // Simple supply and demand calculation
        return it->baseValue * (1.0f + (it->quantity / 1000.0f));
    }
    return 0.0f;
}

// Weather System Implementation
void WeatherSystem::Update(float deltaTime) {
    m_weatherTransitionTimer += deltaTime;

    // Change weather periodically
    if (m_weatherTransitionTimer >= 3600.0f) {  // 1 hour
        TransitionWeather();
        m_weatherTransitionTimer = 0.0f;
    }

    // Temperature variations based on weather
    switch (m_currentWeather) {
        case WeatherType::Sunny:
            m_temperature = 20.0f;
            break;
        case WeatherType::Rainy:
            m_temperature = 15.0f;
            break;
        case WeatherType::Stormy:
            m_temperature = 10.0f;
            break;
        case WeatherType::Snowy:
            m_temperature = 0.0f;
            break;
        default:
            m_temperature = 18.0f;
    }
}

void WeatherSystem::TransitionWeather() {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> dis(0, 4);

    m_currentWeather = static_cast<WeatherType>(dis(gen));
}

// Time Manager Implementation
void TimeManager::Update(float deltaTime) {
    m_currentTime += deltaTime / 3600.0f;  // Convert seconds to hours

    if (m_currentTime >= 24.0f) {
        m_currentTime -= 24.0f;
        m_currentDay++;

        if (m_currentDay > 30) {  // Simplified month length
            m_currentDay = 1;
            m_currentMonth++;

            if (m_currentMonth > 12) {
                m_currentMonth = 1;
                m_currentYear++;
            }
        }
    }
}

} // namespace Forge
