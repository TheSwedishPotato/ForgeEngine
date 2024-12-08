#pragma once
#include <vector>
#include <memory>
#include <unordered_map>
#include <string>
#include "../Core/ThreadPool.h"
#include "EconomicSystem.h"
#include "ProfessionSystem.h"

namespace Forge {

struct Technology {
    std::string name;
    std::string description;
    float progressPoints;      // Current progress towards discovery
    float requiredPoints;      // Points needed for discovery
    bool discovered;
    std::vector<std::string> prerequisites;
    std::unordered_map<ResourceType, float> resourceRequirements;
    std::vector<std::string> enabledProfessions;
    float productivityBonus;   // Bonus to related activities
};

struct ResearchProject {
    Technology* targetTechnology;
    float currentFunding;
    std::vector<std::string> assignedScholars;
    float progressRate;
};

class TechnologySystem {
public:
    TechnologySystem(
        std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool,
        std::shared_ptr<EconomicSystem> economicSystem
    ) : m_threadPool(threadPool), m_economicSystem(economicSystem) {
        initializeTechnologyTree();
    }

    void updateTechnology(float deltaTime) {
        PROFILE_SCOPE("TechnologySystem_Update");

        // Update research projects
        for (auto& project : activeProjects) {
            updateResearch(project, deltaTime);
        }

        // Check for technology breakthroughs
        checkBreakthroughs();

        // Update technology diffusion
        updateTechnologyDiffusion(deltaTime);
    }

    bool startResearch(const std::string& techName) {
        auto tech = findTechnology(techName);
        if (!tech || tech->discovered) return false;

        // Check prerequisites
        for (const auto& prereq : tech->prerequisites) {
            auto prereqTech = findTechnology(prereq);
            if (!prereqTech || !prereqTech->discovered) return false;
        }

        // Create new research project
        ResearchProject project;
        project.targetTechnology = tech;
        project.progressRate = calculateBaseProgressRate(tech);
        activeProjects.push_back(project);
        return true;
    }

    float getTechnologyLevel(const std::string& techName) const {
        auto tech = findTechnology(techName);
        if (!tech) return 0.0f;
        return tech->discovered ? 1.0f : (tech->progressPoints / tech->requiredPoints);
    }

    std::vector<Technology*> getAvailableTechnologies() const {
        std::vector<Technology*> available;
        for (auto& tech : technologies) {
            if (!tech.discovered && arePrerequisitesMet(tech)) {
                available.push_back(const_cast<Technology*>(&tech));
            }
        }
        return available;
    }

private:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> m_threadPool;
    std::shared_ptr<EconomicSystem> m_economicSystem;
    std::vector<Technology> technologies;
    std::vector<ResearchProject> activeProjects;
    
    void initializeTechnologyTree() {
        // Medieval Technologies
        technologies.push_back({
            "Three-Field Rotation",
            "Advanced farming technique that improves crop yield",
            0.0f, 100.0f, false,
            {},  // No prerequisites
            {{ResourceType::Food, 50.0f}},
            {"Farmer"},
            0.2f
        });

        technologies.push_back({
            "Water Mill",
            "Mechanical power from water flow",
            0.0f, 150.0f, false,
            {},
            {{ResourceType::Wood, 100.0f}, {ResourceType::Stone, 50.0f}},
            {"Miller"},
            0.3f
        });

        technologies.push_back({
            "Steel Forging",
            "Advanced metalworking techniques",
            0.0f, 200.0f, false,
            {"Basic Metallurgy"},
            {{ResourceType::Metal, 100.0f}, {ResourceType::Tools, 50.0f}},
            {"Blacksmith"},
            0.4f
        });

        // Add more medieval technologies
    }

    Technology* findTechnology(const std::string& name) {
        for (auto& tech : technologies) {
            if (tech.name == name) return &tech;
        }
        return nullptr;
    }

    bool arePrerequisitesMet(const Technology& tech) const {
        for (const auto& prereq : tech.prerequisites) {
            auto prereqTech = std::find_if(
                technologies.begin(),
                technologies.end(),
                [&prereq](const Technology& t) { return t.name == prereq; }
            );
            if (prereqTech == technologies.end() || !prereqTech->discovered) {
                return false;
            }
        }
        return true;
    }

    void updateResearch(ResearchProject& project, float deltaTime) {
        // Calculate progress based on assigned scholars and resources
        float progress = project.progressRate * deltaTime;
        
        // Apply modifiers based on available resources
        for (const auto& [resource, amount] : project.targetTechnology->resourceRequirements) {
            float available = m_economicSystem->getResourceQuantity(resource);
            if (available < amount) {
                progress *= (available / amount);
            }
        }

        project.targetTechnology->progressPoints += progress;
    }

    void checkBreakthroughs() {
        for (auto& tech : technologies) {
            if (!tech.discovered && tech.progressPoints >= tech.requiredPoints) {
                tech.discovered = true;
                onTechnologyDiscovered(tech);
            }
        }
    }

    void updateTechnologyDiffusion(float deltaTime) {
        // Simulate technology spreading between regions and villages
        m_threadPool->enqueue([this, deltaTime]() {
            PROFILE_SCOPE("TechnologySystem_Diffusion");
            
            for (auto& tech : technologies) {
                if (tech.discovered) {
                    // Simulate knowledge sharing between regions
                    spreadKnowledge(tech);
                }
            }
        });
    }

    float calculateBaseProgressRate(Technology* tech) {
        // Base rate modified by complexity and available resources
        float baseRate = 1.0f;
        
        // Adjust for technology complexity
        baseRate *= (1.0f / tech->requiredPoints);
        
        // Adjust for available resources
        float resourceModifier = 1.0f;
        for (const auto& [resource, amount] : tech->resourceRequirements) {
            float available = m_economicSystem->getResourceQuantity(resource);
            resourceModifier *= std::min(1.0f, available / amount);
        }
        
        return baseRate * resourceModifier;
    }

    void onTechnologyDiscovered(const Technology& tech) {
        // Apply effects of new technology
        for (const auto& profession : tech.enabledProfessions) {
            // Enable new professions
        }

        // Apply productivity bonuses
        if (tech.productivityBonus > 0.0f) {
            applyProductivityBonus(tech);
        }
    }

    void spreadKnowledge(const Technology& tech) {
        // Simulate knowledge spreading through trade routes and social interactions
        // Implementation depends on your trade route and social systems
    }

    void applyProductivityBonus(const Technology& tech) {
        // Apply productivity bonuses to relevant professions and activities
        // Implementation depends on your profession and production systems
    }
};

} // namespace Forge
