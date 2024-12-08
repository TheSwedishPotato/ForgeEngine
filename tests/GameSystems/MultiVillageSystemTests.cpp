#include <catch2/catch.hpp>
#include "../../src/GameSystems/MultiVillageSystem.h"
#include "../../src/GameSystems/EnvironmentalSystem.h"
#include "../../src/GameSystems/TechnologySystem.h"
#include "../../src/AI/StorytellingSystem.h"

using namespace Forge;

class TestEnvironment {
public:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool;
    std::shared_ptr<EnvironmentalSystem> envSystem;
    std::shared_ptr<TechnologySystem> techSystem;
    std::shared_ptr<AdvancedTradeSystem> tradeSystem;
    std::shared_ptr<AI::StorytellingSystem> storySystem;
    std::shared_ptr<MultiVillageSystem> villageSystem;

    TestEnvironment() {
        threadPool = std::make_shared<ForgeEngine::Core::ThreadPool>(4);
        envSystem = std::make_shared<EnvironmentalSystem>(threadPool);
        techSystem = std::make_shared<TechnologySystem>(threadPool, nullptr);
        tradeSystem = std::make_shared<AdvancedTradeSystem>();
        storySystem = std::make_shared<AI::StorytellingSystem>(threadPool, envSystem, techSystem);
        villageSystem = std::make_shared<MultiVillageSystem>(
            threadPool, envSystem, techSystem, tradeSystem, storySystem
        );
    }
};

TEST_CASE("MultiVillageSystem Basic Operations", "[MultiVillageSystem]") {
    TestEnvironment env;

    SECTION("Village Creation") {
        env.villageSystem->addVillage("TestVillage", sf::Vector2f(100, 100));
        auto villages = env.villageSystem->getVillages();
        REQUIRE(villages.size() == 1);
        REQUIRE(villages[0].name == "TestVillage");
    }

    SECTION("Trade Route Creation") {
        env.villageSystem->addVillage("Village1", sf::Vector2f(0, 0));
        env.villageSystem->addVillage("Village2", sf::Vector2f(100, 100));
        
        bool success = env.villageSystem->createTradeRoute("Village1", "Village2");
        REQUIRE(success);
        
        auto routes = env.villageSystem->getTradeRoutes();
        REQUIRE(routes.size() == 1);
    }

    SECTION("Diplomatic Relations") {
        env.villageSystem->addVillage("Village1", sf::Vector2f(0, 0));
        env.villageSystem->addVillage("Village2", sf::Vector2f(100, 100));
        
        bool success = env.villageSystem->createDiplomaticAgreement(
            "Village1",
            "Village2",
            DiplomaticAgreement::Type::Alliance
        );
        REQUIRE(success);
        
        auto agreements = env.villageSystem->getDiplomaticAgreements();
        REQUIRE(agreements.size() == 1);
        REQUIRE(agreements[0].type == DiplomaticAgreement::Type::Alliance);
    }
}

TEST_CASE("MultiVillageSystem Resource Management", "[MultiVillageSystem]") {
    TestEnvironment env;

    SECTION("Resource Transfer") {
        env.villageSystem->addVillage("Village1", sf::Vector2f(0, 0));
        env.villageSystem->addVillage("Village2", sf::Vector2f(100, 100));
        
        // Set initial resources
        auto v1 = env.villageSystem->findVillage("Village1");
        v1->resources[ResourceType::Food] = 1000.0f;
        
        // Create trade route
        env.villageSystem->createTradeRoute("Village1", "Village2");
        
        // Simulate for some time
        env.villageSystem->update(1.0f);
        
        // Check resource transfer
        auto v2 = env.villageSystem->findVillage("Village2");
        REQUIRE(v2->resources[ResourceType::Food] > 0.0f);
        REQUIRE(v1->resources[ResourceType::Food] < 1000.0f);
    }
}

TEST_CASE("MultiVillageSystem Technology Diffusion", "[MultiVillageSystem]") {
    TestEnvironment env;

    SECTION("Technology Spread") {
        env.villageSystem->addVillage("Village1", sf::Vector2f(0, 0));
        env.villageSystem->addVillage("Village2", sf::Vector2f(100, 100));
        
        // Give technology to first village
        auto v1 = env.villageSystem->findVillage("Village1");
        v1->technologies.push_back("WaterMill");
        
        // Create good relations
        env.villageSystem->createDiplomaticAgreement(
            "Village1",
            "Village2",
            DiplomaticAgreement::Type::Alliance
        );
        
        // Simulate for some time
        for(int i = 0; i < 30; i++) {
            env.villageSystem->update(1.0f);
        }
        
        // Check technology spread
        auto v2 = env.villageSystem->findVillage("Village2");
        bool hasTechnology = std::find(
            v2->technologies.begin(),
            v2->technologies.end(),
            "WaterMill"
        ) != v2->technologies.end();
        
        REQUIRE(hasTechnology);
    }
}

TEST_CASE("MultiVillageSystem Environmental Effects", "[MultiVillageSystem]") {
    TestEnvironment env;

    SECTION("Weather Impact on Trade") {
        env.villageSystem->addVillage("Village1", sf::Vector2f(0, 0));
        env.villageSystem->addVillage("Village2", sf::Vector2f(100, 100));
        
        // Set up trade
        env.villageSystem->createTradeRoute("Village1", "Village2");
        auto v1 = env.villageSystem->findVillage("Village1");
        v1->resources[ResourceType::Food] = 1000.0f;
        
        // Record normal trade volume
        env.villageSystem->update(1.0f);
        auto normalTradeVolume = env.villageSystem->findVillage("Village2")->resources[ResourceType::Food];
        
        // Set stormy weather
        env.envSystem->setWeather(Climate::WeatherType::Stormy);
        
        // Reset and check reduced trade
        v1->resources[ResourceType::Food] = 1000.0f;
        auto v2 = env.villageSystem->findVillage("Village2");
        v2->resources[ResourceType::Food] = 0.0f;
        
        env.villageSystem->update(1.0f);
        auto stormyTradeVolume = v2->resources[ResourceType::Food];
        
        REQUIRE(stormyTradeVolume < normalTradeVolume);
    }
}
