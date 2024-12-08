#include "NPCAISystem.h"
#include "NPCAdvanced.h"
#include <algorithm>
#include <cmath>

namespace Forge {

NPCAISystem::NPCAISystem() : 
    m_randomGenerator(std::chrono::system_clock::now().time_since_epoch().count()) {}

void NPCAISystem::UpdateNPCAI(AdvancedNPC* npc, float deltaTime) {
    if (!npc) return;

    // Create decision context
    DecisionContext context{
        npc->GetTimeOfDay(),
        npc->GetHunger(),
        npc->GetEnergy(),
        npc->GetSocialNeed(),
        npc->GetWorkMotivation(),
        GetPersonality(npc)
    };

    // Determine next state
    NPCState nextState = DetermineNextState(npc);
    npc->SetCurrentState(nextState);

    // Create and execute behavior tree
    auto behaviorTree = CreateBehaviorTree(npc);
    behaviorTree->Execute(npc);
}

void NPCAISystem::SetPersonality(AdvancedNPC* npc, NPCPersonality personality) {
    if (npc) {
        m_npcPersonalities[npc] = personality;
    }
}

NPCPersonality NPCAISystem::GetPersonality(AdvancedNPC* npc) const {
    auto it = m_npcPersonalities.find(npc);
    return (it != m_npcPersonalities.end()) ? 
        it->second : NPCPersonality::Passive;
}

float NPCAISystem::CalculateDecisionWeight(const DecisionContext& context) {
    float weight = 0.0f;

    // Time of day influence
    weight += std::abs(12.0f - context.timeOfDay) / 12.0f;

    // Hunger impact
    weight += context.hunger * 0.3f;

    // Energy consideration
    weight += (1.0f - context.energy) * 0.2f;

    // Social needs
    weight += context.socialNeed * 0.15f;

    // Personality modifiers
    switch (context.personality) {
        case NPCPersonality::Introvert:
            weight -= 0.1f;
            break;
        case NPCPersonality::Extrovert:
            weight += 0.1f;
            break;
        case NPCPersonality::Aggressive:
            weight += 0.2f;
            break;
        case NPCPersonality::Passive:
            weight -= 0.2f;
            break;
        case NPCPersonality::Curious:
            weight += 0.15f;
            break;
        case NPCPersonality::Cautious:
            weight -= 0.15f;
            break;
    }

    // Normalize weight
    return std::clamp(weight, 0.0f, 1.0f);
}

NPCState NPCAISystem::DetermineNextState(AdvancedNPC* npc) {
    if (!npc) return NPCState::Idle;

    DecisionContext context{
        npc->GetTimeOfDay(),
        npc->GetHunger(),
        npc->GetEnergy(),
        npc->GetSocialNeed(),
        npc->GetWorkMotivation(),
        GetPersonality(npc)
    };

    float decisionWeight = CalculateDecisionWeight(context);
    std::uniform_real_distribution<float> distribution(0.0f, 1.0f);

    // Complex state transition logic
    if (context.timeOfDay >= 22.0f || context.timeOfDay < 6.0f) {
        return NPCState::Sleeping;
    }

    if (context.hunger > 0.7f) {
        return NPCState::Eating;
    }

    if (context.energy < 0.3f) {
        return NPCState::Resting;
    }

    if (context.socialNeed > 0.6f) {
        return NPCState::Socializing;
    }

    if (decisionWeight > 0.7f) {
        return NPCState::Working;
    }

    if (distribution(m_randomGenerator) < 0.3f) {
        return NPCState::Traveling;
    }

    return NPCState::Idle;
}

std::unique_ptr<BehaviorTreeNode> NPCAISystem::CreateBehaviorTree(AdvancedNPC* npc) {
    auto rootSequence = std::make_unique<SequenceNode>();

    // Basic action nodes based on current state
    switch (npc->GetCurrentState()) {
        case NPCState::Sleeping:
            rootSequence->AddChild(std::make_unique<ActionNode>(
                [](AdvancedNPC* n) { 
                    n->Rest(); 
                    return true; 
                }
            ));
            break;

        case NPCState::Eating:
            rootSequence->AddChild(std::make_unique<ActionNode>(
                [](AdvancedNPC* n) { 
                    n->FindFood(); 
                    n->Eat(); 
                    return true; 
                }
            ));
            break;

        case NPCState::Working:
            rootSequence->AddChild(std::make_unique<ActionNode>(
                [](AdvancedNPC* n) { 
                    n->FindWorkLocation(); 
                    n->PerformWork(); 
                    return true; 
                }
            ));
            break;

        case NPCState::Socializing:
            rootSequence->AddChild(std::make_unique<ActionNode>(
                [](AdvancedNPC* n) { 
                    n->FindSocialPartner(); 
                    n->Interact(); 
                    return true; 
                }
            ));
            break;

        default:
            rootSequence->AddChild(std::make_unique<ActionNode>(
                [](AdvancedNPC* n) { 
                    n->Wander(); 
                    return true; 
                }
            ));
            break;
    }

    return rootSequence;
}

} // namespace Forge
