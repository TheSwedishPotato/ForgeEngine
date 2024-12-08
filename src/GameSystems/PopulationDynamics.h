#pragma once
#include "NPCAdvanced.h"
#include <random>
#include <functional>
#include <map>

namespace Forge {

// Genetic Trait Inheritance Model
struct GeneticTraits {
    // Physical Traits
    float height;
    float strength;
    float health;

    // Personality Traits
    float intelligence;
    float creativity;
    float sociability;

    // Genetic Inheritance Method
    static GeneticTraits Inherit(const GeneticTraits& parent1, const GeneticTraits& parent2) {
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_real_distribution<> dis(0.0, 1.0);

        GeneticTraits child;
        child.height = (parent1.height + parent2.height) / 2.0f + (dis(gen) - 0.5f) * 0.2f;
        child.strength = (parent1.strength + parent2.strength) / 2.0f + (dis(gen) - 0.5f) * 0.2f;
        child.health = (parent1.health + parent2.health) / 2.0f + (dis(gen) - 0.5f) * 0.2f;
        
        child.intelligence = (parent1.intelligence + parent2.intelligence) / 2.0f + (dis(gen) - 0.5f) * 0.2f;
        child.creativity = (parent1.creativity + parent2.creativity) / 2.0f + (dis(gen) - 0.5f) * 0.2f;
        child.sociability = (parent1.sociability + parent2.sociability) / 2.0f + (dis(gen) - 0.5f) * 0.2f;

        return child;
    }
};

// Life Stage Enum
enum class LifeStage {
    Infant,
    Child,
    Adolescent,
    Adult,
    Elder
};

// Advanced NPC with Lifecycle and Learning Capabilities
class PopulationNPC : public AdvancedNPC {
public:
    PopulationNPC(const std::string& name, const GeneticTraits& traits);

    // Lifecycle Management
    void UpdateLifeStage();
    LifeStage GetLifeStage() const { return m_lifeStage; }
    float GetAge() const { return m_age; }

    // Reproduction System
    bool CanReproduce() const;
    PopulationNPC* Reproduce(PopulationNPC* partner);

    // Skill Learning System
    void LearnSkill(const std::string& skillName, float learningRate);
    float GetSkillProficiency(const std::string& skillName) const;

    // Machine Learning Decision Making
    void TrainDecisionModel(const std::vector<std::pair<std::string, float>>& experiences);

private:
    // Lifecycle Attributes
    LifeStage m_lifeStage;
    float m_age;
    GeneticTraits m_geneticTraits;

    // Skill Proficiency Tracking
    std::map<std::string, float> m_skills;

    // Machine Learning Decision Model
    std::map<std::string, float> m_decisionWeights;

    // Internal Lifecycle Progression
    void ProgressAge(float deltaTime);
};

// Population Management System
class PopulationManager {
public:
    PopulationManager(int initialPopulation);

    // Population Dynamics
    void SimulatePopulationCycle(float deltaTime);
    void AddNPC(std::unique_ptr<PopulationNPC> npc);
    void RemoveNPC(const std::string& name);

    // Reproduction and Growth
    void HandleReproduction();
    void ManagePopulationGrowth();

    // Cultural and Historical Modeling
    void ApplySocialNorms(PopulationNPC* npc);
    void ModelEconomicConditions();

private:
    std::vector<std::unique_ptr<PopulationNPC>> m_population;
    std::mt19937 m_randomGenerator;

    // Reproduction Helpers
    PopulationNPC* FindReproductivePartner(PopulationNPC* npc);
    
    // Machine Learning Decision Support
    void UpdateDecisionModels();
};

// Emergent Storytelling System
class StoryEngine {
public:
    // Generate narrative events based on NPC interactions
    std::string GenerateEvent(const std::vector<PopulationNPC*>& npcs);

    // Create relationship-driven story arcs
    std::string CreateStoryArc(PopulationNPC* protagonist);

private:
    // Story generation algorithms
    std::string GenerateRomance(PopulationNPC* npc1, PopulationNPC* npc2);
    std::string GenerateConflict(PopulationNPC* npc1, PopulationNPC* npc2);
    std::string GenerateAchievement(PopulationNPC* npc);
};

} // namespace Forge
