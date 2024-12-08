#pragma once
#include <vector>
#include <memory>
#include <unordered_map>
#include "../Core/ThreadPool.h"
#include "EnvironmentalSystem.h"
#include "TechnologySystem.h"
#include "AdvancedTradeSystem.h"
#include "../AI/StorytellingSystem.h"

namespace Forge {

struct Village {
    std::string id;
    std::string name;
    sf::Vector2f position;
    size_t population;
    std::unordered_map<ResourceType, float> resources;
    std::vector<std::string> technologies;
    float prosperity;
    float influence;
    
    struct Relations {
        float trust;        // -1.0 to 1.0
        float trade;        // Trade volume
        float diplomacy;    // Diplomatic standing
    };
    std::unordered_map<std::string, Relations> villageRelations;
};

struct TradeRoute {
    std::string sourceVillageId;
    std::string targetVillageId;
    std::vector<ResourceType> tradedResources;
    float distance;
    float safety;          // 0.0 to 1.0
    bool active;
};

struct DiplomaticAgreement {
    enum class Type {
        Alliance,
        Trade,
        Defense,
        Cultural
    };
    
    Type type;
    std::string village1Id;
    std::string village2Id;
    std::vector<std::string> terms;
    float duration;        // In days
    bool active;
};

class MultiVillageSystem {
public:
    MultiVillageSystem(
        std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool,
        std::shared_ptr<EnvironmentalSystem> envSystem,
        std::shared_ptr<TechnologySystem> techSystem,
        std::shared_ptr<AdvancedTradeSystem> tradeSystem,
        std::shared_ptr<AI::StorytellingSystem> storySystem
    ) : m_threadPool(threadPool),
        m_environmentalSystem(envSystem),
        m_technologySystem(techSystem),
        m_tradeSystem(tradeSystem),
        m_storySystem(storySystem) {
        initializeVillages();
    }

    void update(float deltaTime) {
        PROFILE_SCOPE("MultiVillageSystem_Update");

        // Update each village
        for (auto& village : m_villages) {
            updateVillage(village, deltaTime);
        }

        // Update trade routes
        updateTradeRoutes(deltaTime);

        // Update diplomatic relations
        updateDiplomacy(deltaTime);

        // Update technology diffusion
        updateTechnologyDiffusion(deltaTime);

        // Generate inter-village events
        generateEvents();
    }

    void addVillage(const std::string& name, const sf::Vector2f& position) {
        Village village;
        village.id = generateUniqueId();
        village.name = name;
        village.position = position;
        village.population = 100;  // Starting population
        village.prosperity = 0.5f;
        village.influence = 0.0f;
        
        initializeVillageResources(village);
        m_villages.push_back(village);
    }

    bool createTradeRoute(const std::string& source, const std::string& target) {
        auto sourceVillage = findVillage(source);
        auto targetVillage = findVillage(target);
        
        if (!sourceVillage || !targetVillage) return false;

        TradeRoute route;
        route.sourceVillageId = source;
        route.targetVillageId = target;
        route.distance = calculateDistance(*sourceVillage, *targetVillage);
        route.safety = calculateRouteSafety(*sourceVillage, *targetVillage);
        route.active = true;

        m_tradeRoutes.push_back(route);
        return true;
    }

    bool createDiplomaticAgreement(
        const std::string& village1,
        const std::string& village2,
        DiplomaticAgreement::Type type
    ) {
        auto v1 = findVillage(village1);
        auto v2 = findVillage(village2);
        
        if (!v1 || !v2) return false;

        DiplomaticAgreement agreement;
        agreement.type = type;
        agreement.village1Id = village1;
        agreement.village2Id = village2;
        agreement.duration = 30.0f;  // 30 days by default
        agreement.active = true;

        m_diplomaticAgreements.push_back(agreement);
        return true;
    }

private:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> m_threadPool;
    std::shared_ptr<EnvironmentalSystem> m_environmentalSystem;
    std::shared_ptr<TechnologySystem> m_technologySystem;
    std::shared_ptr<AdvancedTradeSystem> m_tradeSystem;
    std::shared_ptr<AI::StorytellingSystem> m_storySystem;
    
    std::vector<Village> m_villages;
    std::vector<TradeRoute> m_tradeRoutes;
    std::vector<DiplomaticAgreement> m_diplomaticAgreements;

    void initializeVillages() {
        // Create initial villages
        addVillage("Rivertown", sf::Vector2f(0, 0));
        addVillage("Hillcrest", sf::Vector2f(500, -300));
        addVillage("Forestkeep", sf::Vector2f(-400, 200));
    }

    void initializeVillageResources(Village& village) {
        // Set initial resource quantities
        village.resources[ResourceType::Food] = 1000.0f;
        village.resources[ResourceType::Wood] = 500.0f;
        village.resources[ResourceType::Stone] = 300.0f;
        village.resources[ResourceType::Metal] = 100.0f;
        village.resources[ResourceType::Tools] = 50.0f;
    }

    void updateVillage(Village& village, float deltaTime) {
        // Update population
        updatePopulation(village, deltaTime);
        
        // Update resources
        updateResources(village, deltaTime);
        
        // Update prosperity
        updateProsperity(village);
        
        // Update influence
        updateInfluence(village);
    }

    void updatePopulation(Village& village, float deltaTime) {
        float growthRate = calculateGrowthRate(village);
        village.population += static_cast<size_t>(growthRate * deltaTime);
    }

    void updateResources(Village& village, float deltaTime) {
        for (auto& [type, quantity] : village.resources) {
            float production = calculateResourceProduction(village, type);
            float consumption = calculateResourceConsumption(village, type);
            
            quantity += (production - consumption) * deltaTime;
            quantity = std::max(0.0f, quantity);
        }
    }

    void updateProsperity(Village& village) {
        float resourceScore = calculateResourceScore(village);
        float populationScore = static_cast<float>(village.population) / 1000.0f;
        float techScore = calculateTechnologyScore(village);
        
        village.prosperity = (resourceScore + populationScore + techScore) / 3.0f;
    }

    void updateInfluence(Village& village) {
        float prosperityFactor = village.prosperity;
        float relationsFactor = calculateRelationsFactor(village);
        float tradeFactor = calculateTradeFactor(village);
        
        village.influence = (prosperityFactor + relationsFactor + tradeFactor) / 3.0f;
    }

    void updateTradeRoutes(float deltaTime) {
        for (auto& route : m_tradeRoutes) {
            if (!route.active) continue;

            auto source = findVillage(route.sourceVillageId);
            auto target = findVillage(route.targetVillageId);
            
            if (source && target) {
                processTradeRoute(route, *source, *target, deltaTime);
            }
        }
    }

    void updateDiplomacy(float deltaTime) {
        for (auto& agreement : m_diplomaticAgreements) {
            if (!agreement.active) continue;

            agreement.duration -= deltaTime;
            if (agreement.duration <= 0) {
                handleExpiredAgreement(agreement);
            }
        }
    }

    void updateTechnologyDiffusion(float deltaTime) {
        for (auto& village : m_villages) {
            for (const auto& tech : village.technologies) {
                spreadTechnology(village, tech, deltaTime);
            }
        }
    }

    void generateEvents() {
        // Generate trade events
        generateTradeEvents();
        
        // Generate diplomatic events
        generateDiplomaticEvents();
        
        // Generate cultural events
        generateCulturalEvents();
    }

    float calculateDistance(const Village& v1, const Village& v2) {
        sf::Vector2f diff = v1.position - v2.position;
        return std::sqrt(diff.x * diff.x + diff.y * diff.y);
    }

    float calculateRouteSafety(const Village& v1, const Village& v2) {
        float distance = calculateDistance(v1, v2);
        float baseSafety = 1.0f - (distance / 1000.0f);
        
        // Adjust for environmental factors
        const auto& climate = m_environmentalSystem->getCurrentClimate();
        if (climate.currentWeather == Climate::WeatherType::Stormy) {
            baseSafety *= 0.7f;
        }
        
        return std::clamp(baseSafety, 0.1f, 1.0f);
    }

    float calculateGrowthRate(const Village& village) {
        float baseRate = 0.1f;  // 0.1 people per day
        
        // Modify based on resources
        float foodFactor = village.resources[ResourceType::Food] / village.population;
        float toolsFactor = village.resources[ResourceType::Tools] / village.population;
        
        return baseRate * foodFactor * toolsFactor;
    }

    float calculateResourceProduction(const Village& village, ResourceType type) {
        float baseProduction = 10.0f;  // Base units per day
        
        // Modify based on population and technology
        float populationFactor = std::sqrt(static_cast<float>(village.population) / 100.0f);
        float techFactor = 1.0f + (village.technologies.size() * 0.1f);
        
        return baseProduction * populationFactor * techFactor;
    }

    float calculateResourceConsumption(const Village& village, ResourceType type) {
        float baseConsumption = 1.0f;  // Base units per person per day
        
        return baseConsumption * static_cast<float>(village.population);
    }

    float calculateResourceScore(const Village& village) {
        float totalValue = 0.0f;
        for (const auto& [type, quantity] : village.resources) {
            totalValue += quantity * getResourceValue(type);
        }
        
        return std::min(1.0f, totalValue / 10000.0f);
    }

    float calculateTechnologyScore(const Village& village) {
        return std::min(1.0f, village.technologies.size() * 0.1f);
    }

    float calculateRelationsFactor(const Village& village) {
        float totalTrust = 0.0f;
        for (const auto& [_, relations] : village.villageRelations) {
            totalTrust += relations.trust;
        }
        
        return std::clamp(totalTrust / m_villages.size(), 0.0f, 1.0f);
    }

    float calculateTradeFactor(const Village& village) {
        float totalTrade = 0.0f;
        for (const auto& [_, relations] : village.villageRelations) {
            totalTrade += relations.trade;
        }
        
        return std::min(1.0f, totalTrade / 1000.0f);
    }

    void processTradeRoute(TradeRoute& route, Village& source, Village& target, float deltaTime) {
        float tradeVolume = calculateTradeVolume(route, source, target);
        
        // Transfer resources
        for (const auto& resource : route.tradedResources) {
            float amount = tradeVolume * deltaTime;
            if (source.resources[resource] >= amount) {
                source.resources[resource] -= amount;
                target.resources[resource] += amount;
                
                // Update relations
                updateTradeRelations(source, target, amount);
            }
        }
    }

    void updateTradeRelations(Village& v1, Village& v2, float tradeAmount) {
        float trustIncrease = tradeAmount * 0.001f;  // Small trust increase per trade
        v1.villageRelations[v2.id].trust += trustIncrease;
        v2.villageRelations[v1.id].trust += trustIncrease;
        
        v1.villageRelations[v2.id].trade += tradeAmount;
        v2.villageRelations[v1.id].trade += tradeAmount;
    }

    void handleExpiredAgreement(DiplomaticAgreement& agreement) {
        agreement.active = false;
        
        // Generate story event
        ForgeEngine::AI::StoryEvent event{
            ForgeEngine::AI::StoryEvent::Type::Political,
            "Diplomatic Agreement Expired",
            "The agreement between " + agreement.village1Id + " and " + 
            agreement.village2Id + " has expired",
            0.5f,
            0.3f,
            {agreement.village1Id, agreement.village2Id},
            {"Diplomatic relations may change"},
            false
        };
        
        // Add to story system
        m_storySystem->addEvent(event);
    }

    void spreadTechnology(const Village& source, const std::string& tech, float deltaTime) {
        for (auto& target : m_villages) {
            if (&target == &source) continue;
            
            // Check if target doesn't have the technology
            if (std::find(target.technologies.begin(),
                         target.technologies.end(),
                         tech) == target.technologies.end()) {
                // Calculate spread chance based on relations and distance
                float spreadChance = calculateTechSpreadChance(source, target);
                
                if (std::rand() / static_cast<float>(RAND_MAX) < spreadChance * deltaTime) {
                    target.technologies.push_back(tech);
                    generateTechnologySpreadEvent(source, target, tech);
                }
            }
        }
    }

    float calculateTechSpreadChance(const Village& source, const Village& target) {
        float distance = calculateDistance(source, target);
        float relationsFactor = source.villageRelations[target.id].trust;
        float tradeFactor = source.villageRelations[target.id].trade / 1000.0f;
        
        return std::clamp(
            (relationsFactor + tradeFactor) * (1.0f - distance/1000.0f),
            0.0f,
            1.0f
        ) * 0.1f;  // Base 10% chance per day at optimal conditions
    }

    void generateTechnologySpreadEvent(const Village& source,
                                     const Village& target,
                                     const std::string& tech) {
        ForgeEngine::AI::StoryEvent event{
            ForgeEngine::AI::StoryEvent::Type::Technological,
            "Technology Spreads",
            target.name + " learns " + tech + " from " + source.name,
            0.6f,
            0.2f,
            {source.id, target.id},
            {"Improved relations", "Economic growth"},
            false
        };
        
        m_storySystem->addEvent(event);
    }

    void generateTradeEvents() {
        // TODO: Implement trade event generation
    }

    void generateDiplomaticEvents() {
        // TODO: Implement diplomatic event generation
    }

    void generateCulturalEvents() {
        // TODO: Implement cultural event generation
    }

    Village* findVillage(const std::string& id) {
        auto it = std::find_if(
            m_villages.begin(),
            m_villages.end(),
            [&id](const Village& v) { return v.id == id; }
        );
        return it != m_villages.end() ? &(*it) : nullptr;
    }

    float getResourceValue(ResourceType type) {
        switch (type) {
            case ResourceType::Food: return 1.0f;
            case ResourceType::Wood: return 2.0f;
            case ResourceType::Stone: return 3.0f;
            case ResourceType::Metal: return 5.0f;
            case ResourceType::Tools: return 8.0f;
            default: return 1.0f;
        }
    }

    std::string generateUniqueId() {
        static size_t counter = 0;
        return "village_" + std::to_string(++counter);
    }

    float calculateTradeVolume(const TradeRoute& route,
                             const Village& source,
                             const Village& target) {
        float baseVolume = 10.0f;  // Base units per day
        float distanceFactor = 1.0f - (route.distance / 1000.0f);
        float safetyFactor = route.safety;
        
        return baseVolume * distanceFactor * safetyFactor;
    }
};

} // namespace Forge
