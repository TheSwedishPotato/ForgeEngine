#pragma once
#include <vector>
#include <string>
#include <memory>
#include <random>
#include "../Core/ObjectPool.h"

namespace ForgeEngine {
namespace AI {

struct PersonalityTrait {
    enum class Type {
        AGGRESSION,
        DIPLOMACY,
        AMBITION,
        PIETY,
        GREED,
        LOYALTY,
        INTELLIGENCE,
        BRAVERY
    };

    Type type;
    float value;  // 0.0 to 1.0
    float volatility;  // How much this trait can change over time
};

class PersonalityProfile {
public:
    PersonalityProfile() {
        traits.reserve(8);  // Reserve space for all trait types
        initializeTraits();
    }

    void initializeTraits() {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::uniform_real_distribution<float> dis(0.0f, 1.0f);

        for (int i = 0; i < 8; ++i) {
            PersonalityTrait trait;
            trait.type = static_cast<PersonalityTrait::Type>(i);
            trait.value = dis(gen);
            trait.volatility = dis(gen) * 0.2f;  // Max 20% volatility
            traits.push_back(trait);
        }
    }

    float getTraitValue(PersonalityTrait::Type type) const {
        for (const auto& trait : traits) {
            if (trait.type == type) return trait.value;
        }
        return 0.0f;
    }

    void evolveTraits(float timeDelta) {
        static std::random_device rd;
        static std::mt19937 gen(rd());
        static std::normal_distribution<float> dis(0.0f, 1.0f);

        for (auto& trait : traits) {
            float change = dis(gen) * trait.volatility * timeDelta;
            trait.value = std::clamp(trait.value + change, 0.0f, 1.0f);
        }
    }

    float calculateCompatibility(const PersonalityProfile& other) const {
        float compatibility = 0.0f;
        for (size_t i = 0; i < traits.size(); ++i) {
            float diff = std::abs(traits[i].value - other.traits[i].value);
            compatibility += 1.0f - diff;
        }
        return compatibility / traits.size();
    }

private:
    std::vector<PersonalityTrait> traits;
};

} // namespace AI
} // namespace ForgeEngine
