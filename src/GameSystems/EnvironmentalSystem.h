#pragma once
#include <vector>
#include <memory>
#include <random>
#include "../Core/ThreadPool.h"
#include "../Core/Profiler.h"
#include "EconomicSystem.h"

namespace Forge {

struct Climate {
    enum class Season { Spring, Summer, Autumn, Winter };
    enum class WeatherType { Clear, Rainy, Stormy, Snowy, Drought };

    Season currentSeason;
    WeatherType currentWeather;
    float temperature;     // Celsius
    float rainfall;        // mm per day
    float humidity;        // 0.0 to 1.0
    float windSpeed;       // km/h
};

struct EnvironmentalEvent {
    enum class Type {
        Flood,
        Drought,
        Plague,
        Famine,
        Storm,
        Fire,
        Earthquake
    };

    Type type;
    float severity;        // 0.0 to 1.0
    float duration;        // Days
    float radius;         // Affected area in km
    std::vector<std::string> affectedResources;
};

class EnvironmentalSystem {
public:
    EnvironmentalSystem(std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool)
        : m_threadPool(threadPool) {
        initializeClimate();
    }

    void updateEnvironment(float deltaTime) {
        PROFILE_SCOPE("EnvironmentalSystem_Update");

        // Update climate
        updateClimate(deltaTime);

        // Process active events
        processEnvironmentalEvents(deltaTime);

        // Generate new events
        generateRandomEvents(deltaTime);

        // Update resource impacts
        updateResourceImpacts();
    }

    float getResourceProductionModifier(ResourceType type) const {
        float modifier = 1.0f;

        // Climate effects
        modifier *= calculateClimateEffect(type);

        // Event effects
        for (const auto& event : activeEvents) {
            if (std::find(event.affectedResources.begin(),
                         event.affectedResources.end(),
                         getResourceTypeName(type)) != event.affectedResources.end()) {
                modifier *= (1.0f - event.severity * 0.5f);
            }
        }

        return modifier;
    }

    std::vector<EnvironmentalEvent> getActiveEvents() const {
        return activeEvents;
    }

    const Climate& getCurrentClimate() const {
        return currentClimate;
    }

private:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> m_threadPool;
    Climate currentClimate;
    std::vector<EnvironmentalEvent> activeEvents;
    std::mt19937 rng{std::random_device{}()};

    void initializeClimate() {
        currentClimate.currentSeason = Climate::Season::Spring;
        currentClimate.currentWeather = Climate::WeatherType::Clear;
        currentClimate.temperature = 15.0f;
        currentClimate.rainfall = 0.0f;
        currentClimate.humidity = 0.5f;
        currentClimate.windSpeed = 10.0f;
    }

    void updateClimate(float deltaTime) {
        // Season progression
        static float seasonTimer = 0.0f;
        seasonTimer += deltaTime;
        if (seasonTimer >= 90.0f) { // 90 days per season
            seasonTimer = 0.0f;
            currentClimate.currentSeason = static_cast<Climate::Season>(
                (static_cast<int>(currentClimate.currentSeason) + 1) % 4
            );
        }

        // Update temperature based on season
        float targetTemp = getSeasonalTemperature(currentClimate.currentSeason);
        currentClimate.temperature = std::lerp(
            currentClimate.temperature,
            targetTemp,
            deltaTime * 0.1f
        );

        // Weather changes
        updateWeather(deltaTime);
    }

    float getSeasonalTemperature(Climate::Season season) {
        switch (season) {
            case Climate::Season::Spring: return 15.0f;
            case Climate::Season::Summer: return 25.0f;
            case Climate::Season::Autumn: return 15.0f;
            case Climate::Season::Winter: return 0.0f;
            default: return 15.0f;
        }
    }

    void updateWeather(float deltaTime) {
        static float weatherTimer = 0.0f;
        weatherTimer += deltaTime;

        if (weatherTimer >= 3.0f) { // Weather changes every 3 days
            weatherTimer = 0.0f;
            
            std::uniform_real_distribution<float> dist(0.0f, 1.0f);
            float random = dist(rng);

            // Weather probability based on season
            switch (currentClimate.currentSeason) {
                case Climate::Season::Summer:
                    if (random < 0.6f) currentClimate.currentWeather = Climate::WeatherType::Clear;
                    else if (random < 0.8f) currentClimate.currentWeather = Climate::WeatherType::Rainy;
                    else currentClimate.currentWeather = Climate::WeatherType::Stormy;
                    break;
                case Climate::Season::Winter:
                    if (random < 0.4f) currentClimate.currentWeather = Climate::WeatherType::Snowy;
                    else if (random < 0.7f) currentClimate.currentWeather = Climate::WeatherType::Clear;
                    else currentClimate.currentWeather = Climate::WeatherType::Stormy;
                    break;
                default:
                    if (random < 0.4f) currentClimate.currentWeather = Climate::WeatherType::Clear;
                    else if (random < 0.8f) currentClimate.currentWeather = Climate::WeatherType::Rainy;
                    else currentClimate.currentWeather = Climate::WeatherType::Stormy;
            }
        }
    }

    void processEnvironmentalEvents(float deltaTime) {
        for (auto it = activeEvents.begin(); it != activeEvents.end();) {
            it->duration -= deltaTime;
            if (it->duration <= 0.0f) {
                it = activeEvents.erase(it);
            } else {
                ++it;
            }
        }
    }

    void generateRandomEvents(float deltaTime) {
        static float eventTimer = 0.0f;
        eventTimer += deltaTime;

        if (eventTimer >= 30.0f) { // Check for new events every 30 days
            eventTimer = 0.0f;

            std::uniform_real_distribution<float> dist(0.0f, 1.0f);
            if (dist(rng) < 0.1f) { // 10% chance of event
                generateRandomEvent();
            }
        }
    }

    void generateRandomEvent() {
        std::uniform_int_distribution<int> typeDist(0, 6);
        std::uniform_real_distribution<float> severityDist(0.3f, 1.0f);
        std::uniform_real_distribution<float> durationDist(3.0f, 30.0f);

        EnvironmentalEvent event;
        event.type = static_cast<EnvironmentalEvent::Type>(typeDist(rng));
        event.severity = severityDist(rng);
        event.duration = durationDist(rng);
        event.radius = 10.0f + event.severity * 20.0f;

        // Set affected resources based on event type
        switch (event.type) {
            case EnvironmentalEvent::Type::Flood:
                event.affectedResources = {"Food", "Wood"};
                break;
            case EnvironmentalEvent::Type::Drought:
                event.affectedResources = {"Food"};
                break;
            case EnvironmentalEvent::Type::Plague:
                event.affectedResources = {"Food", "Labor"};
                break;
            // Add more event types
        }

        activeEvents.push_back(event);
    }

    float calculateClimateEffect(ResourceType type) const {
        float modifier = 1.0f;

        // Temperature effects
        switch (type) {
            case ResourceType::Food:
                if (currentClimate.temperature < 5.0f || currentClimate.temperature > 35.0f)
                    modifier *= 0.5f;
                break;
            case ResourceType::Wood:
                if (currentClimate.currentWeather == Climate::WeatherType::Stormy)
                    modifier *= 0.7f;
                break;
            // Add more resource types
        }

        // Weather effects
        switch (currentClimate.currentWeather) {
            case Climate::WeatherType::Stormy:
                modifier *= 0.7f;
                break;
            case Climate::WeatherType::Drought:
                if (type == ResourceType::Food)
                    modifier *= 0.3f;
                break;
            // Add more weather effects
        }

        return modifier;
    }

    void updateResourceImpacts() {
        // Update resource production modifiers based on current environmental conditions
        m_threadPool->enqueue([this]() {
            PROFILE_SCOPE("EnvironmentalSystem_ResourceImpacts");
            // Implement resource impact calculations
        });
    }

    std::string getResourceTypeName(ResourceType type) const {
        switch (type) {
            case ResourceType::Food: return "Food";
            case ResourceType::Wood: return "Wood";
            case ResourceType::Stone: return "Stone";
            case ResourceType::Metal: return "Metal";
            case ResourceType::Cloth: return "Cloth";
            case ResourceType::Tools: return "Tools";
            default: return "Unknown";
        }
    }
};

} // namespace Forge
