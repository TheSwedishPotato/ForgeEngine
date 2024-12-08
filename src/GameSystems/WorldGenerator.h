#pragma once
#include <vector>
#include <memory>
#include <DirectXMath.h>
#include <random>

namespace Forge {
    // Terrain Types
    enum class TerrainType {
        Grassland,
        Forest,
        Rocky,
        Swamp,
        River
    };

    // Biome Information
    struct BiomeData {
        TerrainType type;
        float elevation;
        float moisture;
        std::vector<std::string> possibleVegetation;
        std::vector<std::string> possibleResources;
    };

    // Terrain Tile
    struct TerrainTile {
        DirectX::XMFLOAT3 position;
        TerrainType type;
        float height;
        float fertility;
        bool isWalkable;
    };

    // Building Types
    enum class BuildingType {
        House,
        Blacksmith,
        Tavern,
        Church,
        Farm,
        Mill
    };

    // Building Structure
    struct Building {
        BuildingType type;
        DirectX::XMFLOAT3 position;
        float width;
        float length;
        int inhabitants;
        bool isOccupied;
    };

    class WorldGenerator {
    public:
        WorldGenerator(int worldSizeX, int worldSizeZ);

        void GenerateWorld();
        void GenerateTerrain();
        void GenerateBuildings();
        void PopulateBiomes();

        const std::vector<TerrainTile>& GetTerrain() const { return m_terrain; }
        const std::vector<Building>& GetBuildings() const { return m_buildings; }

    private:
        int m_worldSizeX;
        int m_worldSizeZ;
        std::vector<TerrainTile> m_terrain;
        std::vector<Building> m_buildings;
        std::vector<BiomeData> m_biomes;

        // Noise generation for terrain
        float GeneratePerlinNoise(float x, float y, int octaves);
        
        // Procedural generation helpers
        TerrainType DetermineTerrainType(float height, float moisture);
        DirectX::XMFLOAT3 GenerateBuildingLocation(TerrainType preferredTerrain);
    };

    // Resource Management
    class ResourceManager {
    public:
        struct Resource {
            std::string name;
            int quantity;
            float baseValue;
        };

        void AddResource(const std::string& name, int quantity, float baseValue);
        void ModifyResourceQuantity(const std::string& name, int delta);
        float CalculateResourceValue(const std::string& name);

    private:
        std::vector<Resource> m_resources;
    };

    // Weather System
    class WeatherSystem {
    public:
        enum class WeatherType {
            Sunny,
            Cloudy,
            Rainy,
            Stormy,
            Snowy
        };

        void Update(float deltaTime);
        WeatherType GetCurrentWeather() const { return m_currentWeather; }
        float GetTemperature() const { return m_temperature; }

    private:
        WeatherType m_currentWeather;
        float m_temperature;
        float m_weatherTransitionTimer;

        void TransitionWeather();
    };

    // Time Progression System
    class TimeManager {
    public:
        void Update(float deltaTime);
        
        float GetCurrentTime() const { return m_currentTime; }
        int GetCurrentDay() const { return m_currentDay; }
        int GetCurrentMonth() const { return m_currentMonth; }
        int GetCurrentYear() const { return m_currentYear; }

    private:
        float m_currentTime = 0.0f;  // Hours
        int m_currentDay = 1;
        int m_currentMonth = 1;
        int m_currentYear = 1523;  // Start of Gustav Vasa's reign
    };
}
