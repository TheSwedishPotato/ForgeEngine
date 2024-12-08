#pragma once
#include "CulturalConstraintsSystem.h"
#include "EconomicSystem.h"
#include "../AI/PersonalitySystem.h"
#include <unordered_map>
#include <set>
#include <memory>

namespace Forge {

struct SocialStatus {
    SocialClass baseClass;
    float prestige;        // 0.0 to 1.0
    float influence;       // 0.0 to 1.0
    float reputation;      // -1.0 to 1.0
    std::set<std::string> titles;
};

class SocialHierarchySystem {
public:
    SocialHierarchySystem(
        std::shared_ptr<CulturalConstraintsSystem> culturalSystem,
        std::shared_ptr<EconomicSystem> economicSystem
    ) : m_culturalSystem(culturalSystem), m_economicSystem(economicSystem) {}

    // Social Status Management
    void UpdateSocialStatus(PopulationNPC* npc, float deltaTime) {
        auto& status = GetOrCreateStatus(npc);
        
        // Update based on economic factors
        EconomicAgent* agent = npc->GetEconomicAgent();
        if (agent) {
            float wealth = agent->GetTotalResourceValue();
            status.prestige = CalculatePrestigeFromWealth(wealth);
        }

        // Update based on cultural factors
        std::vector<std::string> culturalEvents = m_culturalSystem->GenerateCulturalEvents(npc);
        for (const auto& event : culturalEvents) {
            ApplyCulturalEventImpact(status, event);
        }

        // Update influence based on relationships and actions
        UpdateInfluence(npc, status);
    }

    // Social Interaction
    bool CanInteract(PopulationNPC* npc1, PopulationNPC* npc2) {
        auto& status1 = GetOrCreateStatus(npc1);
        auto& status2 = GetOrCreateStatus(npc2);

        // Check cultural constraints
        if (!m_culturalSystem->CanPerformAction(npc1, CulturalNorm::MobilityRestriction)) {
            return false;
        }

        // Check class compatibility
        return IsClassInteractionAllowed(status1.baseClass, status2.baseClass);
    }

    // Title Management
    void GrantTitle(PopulationNPC* npc, const std::string& title) {
        auto& status = GetOrCreateStatus(npc);
        status.titles.insert(title);
        status.prestige += 0.1f;  // Prestige boost from new title
        UpdateClassBasedOnTitles(status);
    }

    // Influence Calculation
    float CalculateInfluence(PopulationNPC* npc) const {
        auto it = m_socialStatuses.find(npc->GetID());
        if (it != m_socialStatuses.end()) {
            return it->second.influence;
        }
        return 0.0f;
    }

private:
    std::shared_ptr<CulturalConstraintsSystem> m_culturalSystem;
    std::shared_ptr<EconomicSystem> m_economicSystem;
    std::unordered_map<int, SocialStatus> m_socialStatuses;  // NPC ID to status mapping

    SocialStatus& GetOrCreateStatus(PopulationNPC* npc) {
        auto it = m_socialStatuses.find(npc->GetID());
        if (it == m_socialStatuses.end()) {
            SocialStatus newStatus{
                SocialClass::Peasant,  // Default class
                0.0f,                  // Initial prestige
                0.0f,                  // Initial influence
                0.0f                   // Initial reputation
            };
            auto [inserted_it, success] = m_socialStatuses.insert({npc->GetID(), newStatus});
            return inserted_it->second;
        }
        return it->second;
    }

    float CalculatePrestigeFromWealth(float wealth) {
        // Logarithmic scaling to prevent excessive wealth from dominating prestige
        return std::min(1.0f, 0.2f * std::log(1.0f + wealth));
    }

    void ApplyCulturalEventImpact(SocialStatus& status, const std::string& event) {
        // Example event impacts
        if (event == "Marriage_HigherClass") {
            status.prestige += 0.15f;
        } else if (event == "Criminal_Activity") {
            status.reputation -= 0.2f;
        }
        // Clamp values
        status.prestige = std::clamp(status.prestige, 0.0f, 1.0f);
        status.reputation = std::clamp(status.reputation, -1.0f, 1.0f);
    }

    void UpdateInfluence(PopulationNPC* npc, SocialStatus& status) {
        // Base influence from status
        float baseInfluence = 0.3f * status.prestige + 0.3f * std::max(0.0f, status.reputation);
        
        // Additional influence from relationships
        float relationshipInfluence = CalculateRelationshipInfluence(npc);
        
        status.influence = std::clamp(baseInfluence + relationshipInfluence, 0.0f, 1.0f);
    }

    float CalculateRelationshipInfluence(PopulationNPC* npc) {
        // TODO: Implement based on NPC's relationships
        return 0.0f;
    }

    bool IsClassInteractionAllowed(SocialClass class1, SocialClass class2) {
        // Define allowed class interactions based on historical accuracy
        if (class1 == SocialClass::Nobility && class2 == SocialClass::Slave) return false;
        if (class1 == SocialClass::Slave && class2 == SocialClass::Nobility) return false;
        
        // Allow most other interactions with restrictions
        return true;
    }

    void UpdateClassBasedOnTitles(SocialStatus& status) {
        // Update social class based on accumulated titles
        if (status.titles.find("Lord") != status.titles.end() ||
            status.titles.find("Lady") != status.titles.end()) {
            status.baseClass = SocialClass::Nobility;
        }
        else if (status.titles.find("Bishop") != status.titles.end() ||
                 status.titles.find("Priest") != status.titles.end()) {
            status.baseClass = SocialClass::Clergy;
        }
    }
};

} // namespace Forge
