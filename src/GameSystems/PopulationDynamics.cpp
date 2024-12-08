#include "PopulationDynamics.h"
#include <algorithm>
#include <sstream>

namespace Forge {

// PopulationNPC Implementation
PopulationNPC::PopulationNPC(const std::string& name, const GeneticTraits& traits) :
    AdvancedNPC(name, NPCTraits{
        static_cast<int>(traits.intelligence * 10),
        static_cast<int>(traits.sociability * 10),
        static_cast<int>(traits.strength * 10),
        static_cast<int>(traits.creativity * 10)
    }),
    m_lifeStage(LifeStage::Infant),
    m_age(0.0f),
    m_geneticTraits(traits) {}

void PopulationNPC::UpdateLifeStage() {
    if (m_age < 2.0f) m_lifeStage = LifeStage::Infant;
    else if (m_age < 12.0f) m_lifeStage = LifeStage::Child;
    else if (m_age < 18.0f) m_lifeStage = LifeStage::Adolescent;
    else if (m_age < 60.0f) m_lifeStage = LifeStage::Adult;
    else m_lifeStage = LifeStage::Elder;
}

void PopulationNPC::ProgressAge(float deltaTime) {
    m_age += deltaTime;
    UpdateLifeStage();
}

bool PopulationNPC::CanReproduce() const {
    return m_lifeStage == LifeStage::Adult && 
           m_age >= 18.0f && 
           m_age <= 45.0f;
}

PopulationNPC* PopulationNPC::Reproduce(PopulationNPC* partner) {
    if (!CanReproduce() || !partner->CanReproduce()) {
        return nullptr;
    }

    // Generate child's genetic traits
    GeneticTraits childTraits = GeneticTraits::Inherit(m_geneticTraits, partner->m_geneticTraits);

    // Generate unique name (simplified)
    std::string childName = GetName() + "-" + partner->GetName() + 
                            std::to_string(std::rand() % 1000);

    auto* child = new PopulationNPC(childName, childTraits);
    return child;
}

void PopulationNPC::LearnSkill(const std::string& skillName, float learningRate) {
    m_skills[skillName] = std::min(1.0f, m_skills[skillName] + learningRate);
}

float PopulationNPC::GetSkillProficiency(const std::string& skillName) const {
    auto it = m_skills.find(skillName);
    return (it != m_skills.end()) ? it->second : 0.0f;
}

void PopulationNPC::TrainDecisionModel(const std::vector<std::pair<std::string, float>>& experiences) {
    for (const auto& [decision, outcome] : experiences) {
        m_decisionWeights[decision] += outcome;
    }
}

// PopulationManager Implementation
PopulationManager::PopulationManager(int initialPopulation) : 
    m_randomGenerator(std::random_device{}()) {
    
    // Generate initial population
    std::uniform_real_distribution<> traitDist(0.5, 1.0);
    for (int i = 0; i < initialPopulation; ++i) {
        GeneticTraits traits{
            traitDist(m_randomGenerator),
            traitDist(m_randomGenerator),
            traitDist(m_randomGenerator),
            traitDist(m_randomGenerator),
            traitDist(m_randomGenerator),
            traitDist(m_randomGenerator)
        };
        
        std::string name = "Villager_" + std::to_string(i);
        auto npc = std::make_unique<PopulationNPC>(name, traits);
        m_population.push_back(std::move(npc));
    }
}

void PopulationManager::SimulatePopulationCycle(float deltaTime) {
    // Update each NPC
    for (auto& npc : m_population) {
        npc->ProgressAge(deltaTime);
    }

    // Handle reproduction and population management
    HandleReproduction();
    ManagePopulationGrowth();
    UpdateDecisionModels();
}

void PopulationManager::HandleReproduction() {
    std::vector<PopulationNPC*> reproducibleNPCs;
    
    // Find NPCs capable of reproduction
    for (auto& npc : m_population) {
        if (npc->CanReproduce()) {
            reproducibleNPCs.push_back(npc.get());
        }
    }

    // Pair and reproduce
    while (reproducibleNPCs.size() >= 2) {
        auto partner1 = reproducibleNPCs.back();
        reproducibleNPCs.pop_back();
        
        auto partner2 = FindReproductivePartner(partner1);
        if (partner2) {
            auto* child = partner1->Reproduce(partner2);
            if (child) {
                m_population.push_back(std::unique_ptr<PopulationNPC>(child));
            }
        }
    }
}

PopulationNPC* PopulationManager::FindReproductivePartner(PopulationNPC* npc) {
    // Simple partner selection based on proximity and compatibility
    for (auto& potentialPartner : m_population) {
        if (potentialPartner.get() != npc && 
            potentialPartner->CanReproduce() && 
            potentialPartner->GetRelationshipStrength(npc->GetName()) > 0.5f) {
            return potentialPartner.get();
        }
    }
    return nullptr;
}

void PopulationManager::ManagePopulationGrowth() {
    // Remove elderly NPCs
    m_population.erase(
        std::remove_if(m_population.begin(), m_population.end(),
            [](const auto& npc) { 
                return npc->GetLifeStage() == LifeStage::Elder && 
                       npc->GetAge() > 75.0f; 
            }), 
        m_population.end()
    );
}

void PopulationManager::UpdateDecisionModels() {
    // Periodically update NPCs' decision-making models
    for (auto& npc : m_population) {
        std::vector<std::pair<std::string, float>> experiences;
        // Collect recent experiences and their outcomes
        // This is a placeholder - you'd implement more sophisticated experience tracking
        experiences.push_back({"work", npc->GetWorkMotivation()});
        experiences.push_back({"social", npc->GetSocialNeed()});
        
        npc->TrainDecisionModel(experiences);
    }
}

// StoryEngine Implementation
std::string StoryEngine::GenerateEvent(const std::vector<PopulationNPC*>& npcs) {
    if (npcs.size() < 2) return "";

    // Randomly select event type
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> dis(0, 2);

    switch (dis(gen)) {
        case 0: return GenerateRomance(npcs[0], npcs[1]);
        case 1: return GenerateConflict(npcs[0], npcs[1]);
        case 2: return GenerateAchievement(npcs[0]);
        default: return "";
    }
}

std::string StoryEngine::GenerateRomance(PopulationNPC* npc1, PopulationNPC* npc2) {
    std::stringstream story;
    story << npc1->GetName() << " and " << npc2->GetName() 
          << " develop a deep connection over shared interests. "
          << "Their relationship blossoms, highlighting the complex social dynamics of village life.";
    return story.str();
}

std::string StoryEngine::GenerateConflict(PopulationNPC* npc1, PopulationNPC* npc2) {
    std::stringstream story;
    story << "Tension rises between " << npc1->GetName() << " and " << npc2->GetName() 
          << " as their conflicting personalities create friction in the community.";
    return story.str();
}

std::string StoryEngine::CreateStoryArc(PopulationNPC* protagonist) {
    std::stringstream arc;
    arc << "The life of " << protagonist->GetName() << " unfolds: "
        << "From a young " << (protagonist->GetLifeStage() == LifeStage::Child ? "child" : "adult")
        << " to a skilled " << (protagonist->GetSkillProficiency("crafting") > 0.7f ? "master craftsman" : "villager")
        << ", their journey reflects the rich tapestry of medieval life.";
    return arc.str();
}

std::string StoryEngine::GenerateAchievement(PopulationNPC* npc) {
    std::stringstream story;
    story << npc->GetName() << " achieves a significant milestone, "
          << "demonstrating exceptional skill in " 
          << (npc->GetSkillProficiency("farming") > 0.8f ? "farming" : 
              npc->GetSkillProficiency("crafting") > 0.8f ? "crafting" : "survival");
    return story.str();
}

} // namespace Forge
