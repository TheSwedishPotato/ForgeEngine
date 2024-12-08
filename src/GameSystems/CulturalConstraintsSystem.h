#pragma once
#include "../GameSystems/NPCAdvanced.h"
#include <unordered_map>
#include <vector>
#include <string>
#include <functional>

namespace Forge {

enum class SocialClass {
    Nobility,
    Clergy,
    Merchant,
    Peasant,
    Slave
};

enum class CulturalNorm {
    MarriageRestriction,
    OccupationConstraint,
    MobilityRestriction,
    InheritanceRule,
    ReligiousPractice
};

struct CulturalContext {
    std::string region;
    int historicalPeriod;  // e.g., Early Medieval, High Medieval
    SocialClass dominantClass;
};

class CulturalConstraintsSystem {
public:
    CulturalConstraintsSystem(const CulturalContext& context);

    // Check if an NPC can perform a specific action based on cultural norms
    bool CanPerformAction(PopulationNPC* npc, CulturalNorm norm);

    // Apply cultural constraints to NPC behavior
    void ApplyConstraints(PopulationNPC* npc);

    // Generate culturally appropriate life events
    std::vector<std::string> GenerateCulturalEvents(PopulationNPC* npc);

private:
    CulturalContext m_currentContext;

    // Mapping of social classes to allowed actions
    std::unordered_map<SocialClass, std::vector<CulturalNorm>> m_classNormRestrictions;

    // Cultural norm validation functions
    bool ValidateMarriage(PopulationNPC* npc);
    bool ValidateOccupation(PopulationNPC* npc);
    bool ValidateMobility(PopulationNPC* npc);
    bool ValidateInheritance(PopulationNPC* npc);
    bool ValidateReligiousPractice(PopulationNPC* npc);

    // Event generation based on cultural context
    std::string GenerateMarriageEvent(PopulationNPC* npc);
    std::string GenerateOccupationEvent(PopulationNPC* npc);
    std::string GenerateMobilityEvent(PopulationNPC* npc);
};

} // namespace Forge
