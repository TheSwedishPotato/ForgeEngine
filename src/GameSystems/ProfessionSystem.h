#pragma once
#include <unordered_map>
#include <vector>
#include <string>
#include <memory>
#include "../Core/Profiler.h"
#include "CulturalConstraintsSystem.h"
#include "EconomicSystem.h"

namespace Forge {

struct Skill {
    std::string name;
    float level;          // 0.0 to 1.0
    float experience;     // Progress to next level
    float aptitude;       // Natural learning rate
    std::vector<std::string> prerequisites;
};

struct ProfessionRequirement {
    std::string skillName;
    float minimumLevel;
    bool isMandatory;
};

class ProfessionDefinition {
public:
    ProfessionDefinition(
        const std::string& name,
        SocialClass minClass,
        const std::vector<ProfessionRequirement>& reqs
    ) : name(name), minimumSocialClass(minClass), requirements(reqs) {}

    bool meetsRequirements(const std::unordered_map<std::string, Skill>& skills) const {
        for (const auto& req : requirements) {
            auto it = skills.find(req.skillName);
            if (req.isMandatory && (it == skills.end() || it->second.level < req.minimumLevel)) {
                return false;
            }
        }
        return true;
    }

    const std::string& getName() const { return name; }
    SocialClass getMinimumSocialClass() const { return minimumSocialClass; }
    const std::vector<ProfessionRequirement>& getRequirements() const { return requirements; }

private:
    std::string name;
    SocialClass minimumSocialClass;
    std::vector<ProfessionRequirement> requirements;
};

class ProfessionSystem {
public:
    ProfessionSystem() {
        initializeProfessions();
    }

    void updateSkills(
        std::unordered_map<std::string, Skill>& skills,
        const std::string& activity,
        float duration,
        float quality
    ) {
        PROFILE_SCOPE("ProfessionSystem_UpdateSkills");

        auto relevantSkills = getRelevantSkills(activity);
        for (const auto& skillName : relevantSkills) {
            auto it = skills.find(skillName);
            if (it != skills.end()) {
                updateSkill(it->second, duration, quality);
            }
        }
    }

    bool canProgressToProfession(
        const std::string& professionName,
        const std::unordered_map<std::string, Skill>& skills,
        SocialClass socialClass
    ) {
        auto it = professionDefinitions.find(professionName);
        if (it == professionDefinitions.end()) return false;

        const auto& profession = it->second;
        if (socialClass < profession.getMinimumSocialClass()) return false;

        return profession.meetsRequirements(skills);
    }

    std::vector<std::string> getAvailableProfessions(
        const std::unordered_map<std::string, Skill>& skills,
        SocialClass socialClass
    ) {
        std::vector<std::string> available;
        for (const auto& [name, profession] : professionDefinitions) {
            if (canProgressToProfession(name, skills, socialClass)) {
                available.push_back(name);
            }
        }
        return available;
    }

    float calculateProfessionEfficiency(
        const std::string& professionName,
        const std::unordered_map<std::string, Skill>& skills
    ) {
        auto it = professionDefinitions.find(professionName);
        if (it == professionDefinitions.end()) return 0.0f;

        float efficiency = 0.0f;
        const auto& requirements = it->second.getRequirements();
        for (const auto& req : requirements) {
            auto skillIt = skills.find(req.skillName);
            if (skillIt != skills.end()) {
                efficiency += skillIt->second.level;
            }
        }
        return requirements.empty() ? 0.0f : efficiency / requirements.size();
    }

private:
    std::unordered_map<std::string, ProfessionDefinition> professionDefinitions;

    void initializeProfessions() {
        // Initialize medieval professions with historical accuracy
        professionDefinitions.emplace(
            "Blacksmith",
            ProfessionDefinition(
                "Blacksmith",
                SocialClass::Merchant,
                {
                    {"Metalworking", 0.5f, true},
                    {"Physical_Strength", 0.3f, true},
                    {"Tool_Knowledge", 0.4f, true}
                }
            )
        );

        professionDefinitions.emplace(
            "Merchant",
            ProfessionDefinition(
                "Merchant",
                SocialClass::Merchant,
                {
                    {"Negotiation", 0.6f, true},
                    {"Mathematics", 0.4f, true},
                    {"Language", 0.3f, true}
                }
            )
        );

        professionDefinitions.emplace(
            "Scribe",
            ProfessionDefinition(
                "Scribe",
                SocialClass::Clergy,
                {
                    {"Writing", 0.7f, true},
                    {"Reading", 0.7f, true},
                    {"Latin", 0.5f, true}
                }
            )
        );

        // Add more historical professions
    }

    std::vector<std::string> getRelevantSkills(const std::string& activity) {
        // Map activities to relevant skills
        static const std::unordered_map<std::string, std::vector<std::string>> activitySkillMap = {
            {"Forge_Item", {"Metalworking", "Tool_Knowledge"}},
            {"Trade_Goods", {"Negotiation", "Mathematics"}},
            {"Write_Document", {"Writing", "Reading", "Latin"}}
            // Add more mappings
        };

        auto it = activitySkillMap.find(activity);
        return it != activitySkillMap.end() ? it->second : std::vector<std::string>();
    }

    void updateSkill(Skill& skill, float duration, float quality) {
        float experienceGain = duration * quality * skill.aptitude;
        skill.experience += experienceGain;

        // Level up if enough experience gained
        while (skill.experience >= 1.0f) {
            skill.experience -= 1.0f;
            skill.level = std::min(1.0f, skill.level + 0.1f);
        }
    }
};

} // namespace Forge
