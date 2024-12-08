#pragma once
#include <unordered_map>
#include <vector>
#include <memory>
#include <cmath>
#include "PersonalitySystem.h"
#include "../Core/Profiler.h"

namespace ForgeEngine {
namespace AI {

enum class EmotionType {
    Joy,
    Sadness,
    Anger,
    Fear,
    Trust,
    Disgust,
    Anticipation,
    Surprise
};

struct Emotion {
    EmotionType type;
    float intensity;       // 0.0 to 1.0
    float decayRate;      // How quickly the emotion fades
    float volatility;     // How easily the emotion changes
};

class EmotionalState {
public:
    EmotionalState() {
        // Initialize base emotions
        for (int i = 0; i < 8; ++i) {
            Emotion emotion{
                static_cast<EmotionType>(i),
                0.0f,   // Initial intensity
                0.1f,   // Default decay rate
                0.2f    // Default volatility
            };
            emotions[emotion.type] = emotion;
        }
    }

    void updateEmotions(float deltaTime, const std::vector<std::string>& events) {
        PROFILE_SCOPE("EmotionalState_Update");
        
        // Natural decay
        for (auto& [type, emotion] : emotions) {
            emotion.intensity *= std::pow(1.0f - emotion.decayRate, deltaTime);
        }

        // Process events
        for (const auto& event : events) {
            processEmotionalEvent(event);
        }

        // Normalize intensities
        normalizeEmotions();
    }

    float getEmotionIntensity(EmotionType type) const {
        auto it = emotions.find(type);
        return it != emotions.end() ? it->second.intensity : 0.0f;
    }

    std::vector<std::pair<EmotionType, float>> getDominantEmotions(size_t count = 3) const {
        std::vector<std::pair<EmotionType, float>> result;
        for (const auto& [type, emotion] : emotions) {
            result.emplace_back(type, emotion.intensity);
        }
        
        std::partial_sort(result.begin(), 
                         result.begin() + std::min(count, result.size()),
                         result.end(),
                         [](const auto& a, const auto& b) {
                             return a.second > b.second;
                         });
                         
        result.resize(std::min(count, result.size()));
        return result;
    }

private:
    std::unordered_map<EmotionType, Emotion> emotions;

    void processEmotionalEvent(const std::string& event) {
        // Example event processing
        if (event == "Positive_Social_Interaction") {
            emotions[EmotionType::Joy].intensity += 0.2f;
            emotions[EmotionType::Trust].intensity += 0.1f;
        }
        else if (event == "Threat_Detected") {
            emotions[EmotionType::Fear].intensity += 0.3f;
            emotions[EmotionType::Anticipation].intensity += 0.2f;
        }
        // Add more event types and their emotional impacts
    }

    void normalizeEmotions() {
        float totalIntensity = 0.0f;
        for (const auto& [type, emotion] : emotions) {
            totalIntensity += emotion.intensity;
        }
        
        if (totalIntensity > 1.0f) {
            float scale = 1.0f / totalIntensity;
            for (auto& [type, emotion] : emotions) {
                emotion.intensity *= scale;
            }
        }
    }
};

class EmotionalResponseSystem {
public:
    EmotionalResponseSystem() = default;

    void updateNPCEmotions(
        PersonalityProfile& personality,
        EmotionalState& emotionalState,
        const std::vector<std::string>& events,
        float deltaTime
    ) {
        PROFILE_SCOPE("EmotionalResponseSystem_Update");

        // Personality affects emotional responses
        std::vector<std::string> modifiedEvents;
        for (const auto& event : events) {
            modifyEventBasedOnPersonality(event, personality, modifiedEvents);
        }

        // Update emotional state
        emotionalState.updateEmotions(deltaTime, modifiedEvents);
    }

    std::vector<std::string> generateEmotionalResponses(
        const EmotionalState& emotionalState,
        const PersonalityProfile& personality
    ) {
        std::vector<std::string> responses;
        
        auto dominantEmotions = emotionalState.getDominantEmotions();
        for (const auto& [emotion, intensity] : dominantEmotions) {
            if (intensity > 0.5f) {
                responses.push_back(generateResponseForEmotion(emotion, intensity, personality));
            }
        }
        
        return responses;
    }

private:
    void modifyEventBasedOnPersonality(
        const std::string& event,
        const PersonalityProfile& personality,
        std::vector<std::string>& modifiedEvents
    ) {
        // Personality traits affect emotional response intensity
        float aggressionLevel = personality.getTraitValue(PersonalityTrait::Type::AGGRESSION);
        float diplomaticLevel = personality.getTraitValue(PersonalityTrait::Type::DIPLOMACY);

        if (event == "Conflict_Event" && aggressionLevel > 0.7f) {
            modifiedEvents.push_back("Intense_" + event);
        }
        else if (event == "Social_Event" && diplomaticLevel > 0.7f) {
            modifiedEvents.push_back("Enhanced_" + event);
        }
        else {
            modifiedEvents.push_back(event);
        }
    }

    std::string generateResponseForEmotion(
        EmotionType emotion,
        float intensity,
        const PersonalityProfile& personality
    ) {
        // Generate appropriate responses based on emotion and personality
        switch (emotion) {
            case EmotionType::Anger:
                return personality.getTraitValue(PersonalityTrait::Type::DIPLOMACY) > 0.7f ?
                    "Controlled_Anger" : "Aggressive_Response";
            case EmotionType::Joy:
                return personality.getTraitValue(PersonalityTrait::Type::EXTROVERSION) > 0.7f ?
                    "Expressive_Joy" : "Reserved_Joy";
            // Add more emotion-specific responses
            default:
                return "Neutral_Response";
        }
    }
};

} // namespace AI
} // namespace ForgeEngine
