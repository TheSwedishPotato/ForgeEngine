#pragma once
#include <memory>
#include <vector>
#include <unordered_map>
#include <functional>
#include <random>
#include <chrono>

namespace Forge {

// Forward declarations
class AdvancedNPC;

// Enum for NPC states
enum class NPCState {
    Idle,
    Working,
    Socializing,
    Traveling,
    Resting,
    Eating,
    Sleeping
};

// Enum for NPC personalities
enum class NPCPersonality {
    Introvert,
    Extrovert,
    Aggressive,
    Passive,
    Curious,
    Cautious
};

// Behavior Tree Node Types
enum class BehaviorNodeType {
    Sequence,
    Selector,
    Condition,
    Action,
    Parallel
};

// Decision Weights and Probabilities
struct DecisionContext {
    float timeOfDay;
    float hunger;
    float energy;
    float socialNeed;
    float workMotivation;
    NPCPersonality personality;
};

class BehaviorTreeNode {
public:
    virtual bool Execute(AdvancedNPC* npc) = 0;
    virtual BehaviorNodeType GetType() const = 0;
    virtual ~BehaviorTreeNode() = default;
};

class ActionNode : public BehaviorTreeNode {
public:
    using ActionFunction = std::function<bool(AdvancedNPC*)>;
    
    ActionNode(ActionFunction action) : m_action(action) {}
    
    bool Execute(AdvancedNPC* npc) override {
        return m_action(npc);
    }
    
    BehaviorNodeType GetType() const override { 
        return BehaviorNodeType::Action; 
    }

private:
    ActionFunction m_action;
};

class SequenceNode : public BehaviorTreeNode {
public:
    void AddChild(std::unique_ptr<BehaviorTreeNode> child) {
        m_children.push_back(std::move(child));
    }

    bool Execute(AdvancedNPC* npc) override {
        for (auto& child : m_children) {
            if (!child->Execute(npc)) {
                return false;
            }
        }
        return true;
    }

    BehaviorNodeType GetType() const override { 
        return BehaviorNodeType::Sequence; 
    }

private:
    std::vector<std::unique_ptr<BehaviorTreeNode>> m_children;
};

class NPCAISystem {
public:
    NPCAISystem();

    // Core AI Decision Making
    void UpdateNPCAI(AdvancedNPC* npc, float deltaTime);

    // Personality and Trait Management
    void SetPersonality(AdvancedNPC* npc, NPCPersonality personality);
    NPCPersonality GetPersonality(AdvancedNPC* npc) const;

    // Decision Making Utilities
    float CalculateDecisionWeight(const DecisionContext& context);

private:
    std::mt19937 m_randomGenerator;
    std::unordered_map<AdvancedNPC*, NPCPersonality> m_npcPersonalities;

    // AI Decision Making Helpers
    NPCState DetermineNextState(AdvancedNPC* npc);
    std::unique_ptr<BehaviorTreeNode> CreateBehaviorTree(AdvancedNPC* npc);
};

} // namespace Forge
