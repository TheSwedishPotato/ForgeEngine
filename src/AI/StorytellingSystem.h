#pragma once
#include <vector>
#include <memory>
#include <queue>
#include <random>
#include "../Core/ThreadPool.h"
#include "../GameSystems/EnvironmentalSystem.h"
#include "../GameSystems/TechnologySystem.h"
#include "PersonalitySystem.h"
#include "EmotionalSystem.h"

namespace ForgeEngine {
namespace AI {

struct StoryEvent {
    enum class Type {
        Personal,       // Individual NPC events
        Social,         // Inter-NPC events
        Environmental,  // Weather and natural events
        Economic,       // Trade and resource events
        Political,      // Power and governance events
        Technological,  // Discovery and innovation events
        Cultural        // Festivals and traditions
    };

    Type type;
    std::string title;
    std::string description;
    float importance;      // 0.0 to 1.0
    float tension;         // 0.0 to 1.0
    std::vector<std::string> involvedNPCs;
    std::vector<std::string> consequences;
    bool requiresResolution;
};

struct StoryArc {
    std::string name;
    std::vector<StoryEvent> events;
    float progression;     // 0.0 to 1.0
    bool isComplete;
    float tension;         // Overall arc tension
    std::vector<std::string> mainCharacters;
};

class StorytellingSystem {
public:
    StorytellingSystem(
        std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool,
        std::shared_ptr<Forge::EnvironmentalSystem> envSystem,
        std::shared_ptr<Forge::TechnologySystem> techSystem
    ) : m_threadPool(threadPool), 
        m_environmentalSystem(envSystem),
        m_technologySystem(techSystem) {
        initializeStoryPatterns();
    }

    void updateStories(float deltaTime) {
        PROFILE_SCOPE("StorytellingSystem_Update");

        // Update ongoing story arcs
        updateStoryArcs(deltaTime);

        // Generate new events based on world state
        generateNewEvents();

        // Resolve pending events
        resolvePendingEvents();

        // Update narrative tension
        updateNarrativeTension(deltaTime);
    }

    std::vector<StoryEvent> getCurrentEvents() const {
        std::vector<StoryEvent> current;
        for (const auto& arc : activeStoryArcs) {
            for (const auto& event : arc.events) {
                if (!event.requiresResolution) {
                    current.push_back(event);
                }
            }
        }
        return current;
    }

    void addCharacterToStory(const std::string& npcId, const std::string& arcName) {
        auto it = std::find_if(
            activeStoryArcs.begin(),
            activeStoryArcs.end(),
            [&arcName](const StoryArc& arc) { return arc.name == arcName; }
        );

        if (it != activeStoryArcs.end()) {
            it->mainCharacters.push_back(npcId);
        }
    }

private:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> m_threadPool;
    std::shared_ptr<Forge::EnvironmentalSystem> m_environmentalSystem;
    std::shared_ptr<Forge::TechnologySystem> m_technologySystem;
    
    std::vector<StoryArc> activeStoryArcs;
    std::queue<StoryEvent> pendingEvents;
    float globalTension = 0.0f;
    
    struct StoryPattern {
        std::string name;
        std::vector<StoryEvent::Type> eventSequence;
        std::function<bool(const StoryEvent&)> validationFunc;
        float minDuration;
        float maxDuration;
    };
    
    std::vector<StoryPattern> storyPatterns;

    void initializeStoryPatterns() {
        // Romance Pattern
        storyPatterns.push_back({
            "Romance",
            {
                StoryEvent::Type::Personal,
                StoryEvent::Type::Social,
                StoryEvent::Type::Cultural
            },
            [](const StoryEvent& e) { return true; },
            30.0f,  // Min 30 days
            90.0f   // Max 90 days
        });

        // Trade Conflict Pattern
        storyPatterns.push_back({
            "Trade Dispute",
            {
                StoryEvent::Type::Economic,
                StoryEvent::Type::Social,
                StoryEvent::Type::Political
            },
            [](const StoryEvent& e) { return true; },
            15.0f,
            45.0f
        });

        // Technological Innovation Pattern
        storyPatterns.push_back({
            "Innovation",
            {
                StoryEvent::Type::Technological,
                StoryEvent::Type::Economic,
                StoryEvent::Type::Cultural
            },
            [](const StoryEvent& e) { return true; },
            60.0f,
            180.0f
        });

        // Add more patterns
    }

    void updateStoryArcs(float deltaTime) {
        for (auto& arc : activeStoryArcs) {
            // Progress the story arc
            arc.progression += deltaTime / calculateArcDuration(arc);
            
            // Check for event triggers
            checkEventTriggers(arc);
            
            // Update tension
            updateArcTension(arc, deltaTime);
            
            // Mark completed arcs
            if (arc.progression >= 1.0f && 
                std::all_of(arc.events.begin(), arc.events.end(),
                           [](const StoryEvent& e) { return !e.requiresResolution; })) {
                arc.isComplete = true;
            }
        }

        // Remove completed arcs
        activeStoryArcs.erase(
            std::remove_if(
                activeStoryArcs.begin(),
                activeStoryArcs.end(),
                [](const StoryArc& arc) { return arc.isComplete; }
            ),
            activeStoryArcs.end()
        );
    }

    void generateNewEvents() {
        PROFILE_SCOPE("StorytellingSystem_GenerateEvents");

        // Check environmental triggers
        generateEnvironmentalEvents();

        // Check social triggers
        generateSocialEvents();

        // Check technological triggers
        generateTechnologicalEvents();
    }

    void generateEnvironmentalEvents() {
        const auto& climate = m_environmentalSystem->getCurrentClimate();
        
        // Generate weather-related events
        if (climate.currentWeather == Climate::WeatherType::Stormy) {
            StoryEvent event{
                StoryEvent::Type::Environmental,
                "Fierce Storm",
                "A powerful storm threatens the village",
                0.7f,
                0.8f,
                {},
                {"Damaged crops", "Flooding risk"},
                true
            };
            pendingEvents.push(event);
        }
    }

    void generateSocialEvents() {
        // Generate events based on NPC interactions
        // Implementation depends on your social interaction system
    }

    void generateTechnologicalEvents() {
        // Check for technology breakthroughs
        auto availableTechs = m_technologySystem->getAvailableTechnologies();
        for (const auto& tech : availableTechs) {
            if (m_technologySystem->getTechnologyLevel(tech->name) > 0.9f) {
                StoryEvent event{
                    StoryEvent::Type::Technological,
                    "Technology Breakthrough",
                    "New discovery: " + tech->name,
                    0.8f,
                    0.6f,
                    {},
                    {"Improved efficiency", "New opportunities"},
                    false
                };
                pendingEvents.push(event);
            }
        }
    }

    void resolvePendingEvents() {
        while (!pendingEvents.empty()) {
            auto event = pendingEvents.front();
            pendingEvents.pop();

            // Find appropriate story arc or create new one
            bool added = false;
            for (auto& arc : activeStoryArcs) {
                if (canAddEventToArc(event, arc)) {
                    arc.events.push_back(event);
                    added = true;
                    break;
                }
            }

            if (!added) {
                createNewStoryArc(event);
            }
        }
    }

    void updateNarrativeTension(float deltaTime) {
        // Calculate global tension based on active arcs
        float totalTension = 0.0f;
        int activeArcs = 0;

        for (const auto& arc : activeStoryArcs) {
            totalTension += arc.tension;
            activeArcs++;
        }

        if (activeArcs > 0) {
            globalTension = totalTension / activeArcs;
        }
        else {
            // Gradually reduce tension when no active arcs
            globalTension = std::max(0.0f, globalTension - deltaTime * 0.1f);
        }
    }

    float calculateArcDuration(const StoryArc& arc) {
        // Find matching pattern
        auto it = std::find_if(
            storyPatterns.begin(),
            storyPatterns.end(),
            [&arc](const StoryPattern& pattern) { return pattern.name == arc.name; }
        );

        if (it != storyPatterns.end()) {
            return (it->minDuration + it->maxDuration) * 0.5f;
        }

        return 30.0f; // Default duration
    }

    void checkEventTriggers(StoryArc& arc) {
        float progression = arc.progression;
        
        // Check for pattern-specific triggers
        auto pattern = std::find_if(
            storyPatterns.begin(),
            storyPatterns.end(),
            [&arc](const StoryPattern& p) { return p.name == arc.name; }
        );

        if (pattern != storyPatterns.end()) {
            size_t expectedEvents = std::ceil(progression * pattern->eventSequence.size());
            if (arc.events.size() < expectedEvents) {
                generatePatternEvent(arc, *pattern);
            }
        }
    }

    void generatePatternEvent(StoryArc& arc, const StoryPattern& pattern) {
        StoryEvent::Type nextType = pattern.eventSequence[arc.events.size()];
        
        // Generate event based on type
        StoryEvent event{
            nextType,
            "Generated Event",
            "Description based on context",
            0.5f + arc.tension * 0.3f,
            arc.tension,
            arc.mainCharacters,
            {},
            true
        };

        if (pattern.validationFunc(event)) {
            arc.events.push_back(event);
        }
    }

    void updateArcTension(StoryArc& arc, float deltaTime) {
        // Calculate tension based on events and progression
        float eventTension = 0.0f;
        for (const auto& event : arc.events) {
            eventTension += event.tension;
        }

        if (!arc.events.empty()) {
            eventTension /= arc.events.size();
        }

        // Apply dramatic arc (rising and falling action)
        float progressionTension = std::sin(arc.progression * 3.14159f);
        arc.tension = (eventTension * 0.7f + progressionTension * 0.3f);
    }

    bool canAddEventToArc(const StoryEvent& event, const StoryArc& arc) {
        // Check if event fits thematically and dramatically
        if (arc.isComplete) return false;

        // Check for character overlap
        bool hasCommonCharacters = std::any_of(
            event.involvedNPCs.begin(),
            event.involvedNPCs.end(),
            [&arc](const std::string& npc) {
                return std::find(arc.mainCharacters.begin(),
                               arc.mainCharacters.end(),
                               npc) != arc.mainCharacters.end();
            }
        );

        return hasCommonCharacters;
    }

    void createNewStoryArc(const StoryEvent& initialEvent) {
        // Find appropriate pattern for new arc
        auto pattern = findPatternForEvent(initialEvent);
        
        if (pattern != storyPatterns.end()) {
            StoryArc newArc{
                pattern->name,
                {initialEvent},
                0.0f,
                false,
                initialEvent.tension,
                initialEvent.involvedNPCs
            };
            
            activeStoryArcs.push_back(newArc);
        }
    }

    std::vector<StoryPattern>::iterator findPatternForEvent(const StoryEvent& event) {
        return std::find_if(
            storyPatterns.begin(),
            storyPatterns.end(),
            [&event](const StoryPattern& pattern) {
                return pattern.eventSequence[0] == event.type;
            }
        );
    }
};

} // namespace AI
} // namespace ForgeEngine
