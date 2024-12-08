#include <catch2/catch.hpp>
#include "../../src/AI/StorytellingSystem.h"
#include "../../src/GameSystems/EnvironmentalSystem.h"
#include "../../src/GameSystems/TechnologySystem.h"

using namespace ForgeEngine::AI;

class StoryTestEnvironment {
public:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool;
    std::shared_ptr<Forge::EnvironmentalSystem> envSystem;
    std::shared_ptr<Forge::TechnologySystem> techSystem;
    std::shared_ptr<StorytellingSystem> storySystem;

    StoryTestEnvironment() {
        threadPool = std::make_shared<ForgeEngine::Core::ThreadPool>(4);
        envSystem = std::make_shared<Forge::EnvironmentalSystem>(threadPool);
        techSystem = std::make_shared<Forge::TechnologySystem>(threadPool, nullptr);
        storySystem = std::make_shared<StorytellingSystem>(threadPool, envSystem, techSystem);
    }
};

TEST_CASE("StorytellingSystem Basic Operations", "[StorytellingSystem]") {
    StoryTestEnvironment env;

    SECTION("Story Event Creation") {
        StoryEvent event{
            StoryEvent::Type::Personal,
            "Test Event",
            "A test event description",
            0.5f,
            0.3f,
            {"NPC1"},
            {"Consequence1"},
            true
        };

        env.storySystem->addEvent(event);
        auto events = env.storySystem->getCurrentEvents();
        REQUIRE(events.size() == 1);
        REQUIRE(events[0].title == "Test Event");
    }

    SECTION("Story Arc Creation") {
        StoryEvent event1{
            StoryEvent::Type::Social,
            "Arc Event 1",
            "First event in arc",
            0.7f,
            0.4f,
            {"NPC1", "NPC2"},
            {"Consequence1"},
            true
        };

        StoryEvent event2{
            StoryEvent::Type::Social,
            "Arc Event 2",
            "Second event in arc",
            0.6f,
            0.5f,
            {"NPC1", "NPC2"},
            {"Consequence2"},
            false
        };

        env.storySystem->createStoryArc("Test Arc", {event1, event2});
        auto arcs = env.storySystem->getActiveStoryArcs();
        REQUIRE(arcs.size() == 1);
        REQUIRE(arcs[0].events.size() == 2);
    }
}

TEST_CASE("StorytellingSystem Environmental Integration", "[StorytellingSystem]") {
    StoryTestEnvironment env;

    SECTION("Weather Event Generation") {
        // Set stormy weather
        env.envSystem->setWeather(Climate::WeatherType::Stormy);
        
        // Update story system
        env.storySystem->update(1.0f);
        
        // Check for weather-related events
        auto events = env.storySystem->getCurrentEvents();
        auto hasWeatherEvent = std::any_of(
            events.begin(),
            events.end(),
            [](const StoryEvent& e) {
                return e.type == StoryEvent::Type::Environmental;
            }
        );
        
        REQUIRE(hasWeatherEvent);
    }
}

TEST_CASE("StorytellingSystem Technology Integration", "[StorytellingSystem]") {
    StoryTestEnvironment env;

    SECTION("Technology Discovery Event") {
        // Simulate technology discovery
        env.techSystem->startResearch("WaterMill");
        
        // Fast forward research
        for(int i = 0; i < 10; i++) {
            env.techSystem->updateTechnology(1.0f);
        }
        
        // Update story system
        env.storySystem->update(1.0f);
        
        // Check for technology-related events
        auto events = env.storySystem->getCurrentEvents();
        auto hasTechEvent = std::any_of(
            events.begin(),
            events.end(),
            [](const StoryEvent& e) {
                return e.type == StoryEvent::Type::Technological;
            }
        );
        
        REQUIRE(hasTechEvent);
    }
}

TEST_CASE("StorytellingSystem Narrative Generation", "[StorytellingSystem]") {
    StoryTestEnvironment env;

    SECTION("Story Pattern Generation") {
        // Add characters
        env.storySystem->addCharacterToStory("NPC1", "Romance");
        env.storySystem->addCharacterToStory("NPC2", "Romance");
        
        // Update system multiple times to generate story
        for(int i = 0; i < 30; i++) {
            env.storySystem->update(1.0f);
        }
        
        // Check story progression
        auto arcs = env.storySystem->getActiveStoryArcs();
        bool hasRomanceArc = std::any_of(
            arcs.begin(),
            arcs.end(),
            [](const StoryArc& arc) {
                return arc.name == "Romance" && arc.progression > 0.0f;
            }
        );
        
        REQUIRE(hasRomanceArc);
    }

    SECTION("Story Tension Management") {
        // Create high-tension event
        StoryEvent event{
            StoryEvent::Type::Political,
            "Conflict Event",
            "A major conflict erupts",
            0.9f,
            0.8f,
            {"NPC1", "NPC2"},
            {"War", "Economic Impact"},
            true
        };

        env.storySystem->addEvent(event);
        
        // Update system
        env.storySystem->update(1.0f);
        
        // Check tension levels
        float tension = env.storySystem->getCurrentTension();
        REQUIRE(tension > 0.5f);
        
        // Update system to resolve tension
        for(int i = 0; i < 50; i++) {
            env.storySystem->update(1.0f);
        }
        
        // Check tension reduction
        float newTension = env.storySystem->getCurrentTension();
        REQUIRE(newTension < tension);
    }
}

TEST_CASE("StorytellingSystem Event Chain Generation", "[StorytellingSystem]") {
    StoryTestEnvironment env;

    SECTION("Causal Event Chain") {
        // Create initial event
        StoryEvent cause{
            StoryEvent::Type::Economic,
            "Trade Disruption",
            "A major trade route is blocked",
            0.7f,
            0.6f,
            {"Village1"},
            {"Economic Impact"},
            true
        };

        env.storySystem->addEvent(cause);
        
        // Update system to generate consequences
        for(int i = 0; i < 20; i++) {
            env.storySystem->update(1.0f);
        }
        
        // Check for related events
        auto events = env.storySystem->getCurrentEvents();
        auto hasConsequence = std::any_of(
            events.begin(),
            events.end(),
            [](const StoryEvent& e) {
                return e.type == StoryEvent::Type::Social || 
                       e.type == StoryEvent::Type::Political;
            }
        );
        
        REQUIRE(hasConsequence);
    }
}
