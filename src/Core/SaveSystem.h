#pragma once
#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>
#include "../GameSystems/MultiVillageSystem.h"
#include "../GameSystems/TechnologySystem.h"
#include "../GameSystems/EnvironmentalSystem.h"
#include "../AI/StorytellingSystem.h"

namespace Forge {
namespace Core {

class SaveSystem {
public:
    SaveSystem(
        std::shared_ptr<MultiVillageSystem> villageSystem,
        std::shared_ptr<TechnologySystem> techSystem,
        std::shared_ptr<EnvironmentalSystem> envSystem,
        std::shared_ptr<AI::StorytellingSystem> storySystem
    ) : m_villageSystem(villageSystem),
        m_technologySystem(techSystem),
        m_environmentalSystem(envSystem),
        m_storySystem(storySystem) {
        createSaveDirectory();
    }

    bool saveGame(const std::string& saveName) {
        PROFILE_SCOPE("SaveSystem_SaveGame");

        try {
            nlohmann::json saveData;
            
            // Save metadata
            saveData["metadata"] = {
                {"version", "1.0.0"},
                {"timestamp", std::time(nullptr)},
                {"saveName", saveName}
            };

            // Save game state
            saveData["villages"] = serializeVillages();
            saveData["technology"] = serializeTechnology();
            saveData["environment"] = serializeEnvironment();
            saveData["stories"] = serializeStories();

            // Write to file
            std::string filename = getSavePath(saveName);
            std::ofstream file(filename);
            file << saveData.dump(4);
            
            return true;
        }
        catch (const std::exception& e) {
            // Log error
            return false;
        }
    }

    bool loadGame(const std::string& saveName) {
        PROFILE_SCOPE("SaveSystem_LoadGame");

        try {
            // Read save file
            std::string filename = getSavePath(saveName);
            std::ifstream file(filename);
            nlohmann::json saveData;
            file >> saveData;

            // Verify version compatibility
            std::string version = saveData["metadata"]["version"];
            if (!isVersionCompatible(version)) {
                return false;
            }

            // Load game state
            deserializeVillages(saveData["villages"]);
            deserializeTechnology(saveData["technology"]);
            deserializeEnvironment(saveData["environment"]);
            deserializeStories(saveData["stories"]);

            return true;
        }
        catch (const std::exception& e) {
            // Log error
            return false;
        }
    }

    std::vector<std::string> listSaves() {
        std::vector<std::string> saves;
        for (const auto& entry : std::filesystem::directory_iterator(getSaveDirectory())) {
            if (entry.path().extension() == ".save") {
                saves.push_back(entry.path().stem().string());
            }
        }
        return saves;
    }

    bool deleteSave(const std::string& saveName) {
        try {
            std::filesystem::remove(getSavePath(saveName));
            return true;
        }
        catch (const std::exception& e) {
            // Log error
            return false;
        }
    }

private:
    std::shared_ptr<MultiVillageSystem> m_villageSystem;
    std::shared_ptr<TechnologySystem> m_technologySystem;
    std::shared_ptr<EnvironmentalSystem> m_environmentalSystem;
    std::shared_ptr<AI::StorytellingSystem> m_storySystem;

    void createSaveDirectory() {
        std::filesystem::create_directories(getSaveDirectory());
    }

    std::string getSaveDirectory() const {
        return "saves/";
    }

    std::string getSavePath(const std::string& saveName) const {
        return getSaveDirectory() + saveName + ".save";
    }

    bool isVersionCompatible(const std::string& version) {
        // TODO: Implement version compatibility check
        return true;
    }

    nlohmann::json serializeVillages() {
        nlohmann::json villagesData;
        
        // TODO: Implement village serialization
        // Example structure:
        /*
        villagesData = {
            "villages": [
                {
                    "id": "village_1",
                    "name": "Rivertown",
                    "position": {"x": 0, "y": 0},
                    "population": 100,
                    "resources": {
                        "food": 1000.0,
                        "wood": 500.0
                    },
                    "technologies": ["tech1", "tech2"],
                    "prosperity": 0.5,
                    "influence": 0.3,
                    "relations": {
                        "village_2": {
                            "trust": 0.7,
                            "trade": 100.0,
                            "diplomacy": 0.8
                        }
                    }
                }
            ]
        };
        */
        
        return villagesData;
    }

    nlohmann::json serializeTechnology() {
        nlohmann::json techData;
        
        // TODO: Implement technology serialization
        // Example structure:
        /*
        techData = {
            "technologies": [
                {
                    "name": "Three-Field Rotation",
                    "progress": 75.0,
                    "discovered": true,
                    "researchProjects": [
                        {
                            "name": "Advanced Farming",
                            "progress": 50.0,
                            "researchers": ["scholar1", "scholar2"]
                        }
                    ]
                }
            ]
        };
        */
        
        return techData;
    }

    nlohmann::json serializeEnvironment() {
        nlohmann::json envData;
        
        // TODO: Implement environment serialization
        // Example structure:
        /*
        envData = {
            "climate": {
                "season": "Summer",
                "weather": "Clear",
                "temperature": 25.0,
                "rainfall": 0.0
            },
            "events": [
                {
                    "type": "Drought",
                    "severity": 0.7,
                    "duration": 5.0
                }
            ]
        };
        */
        
        return envData;
    }

    nlohmann::json serializeStories() {
        nlohmann::json storyData;
        
        // TODO: Implement story serialization
        // Example structure:
        /*
        storyData = {
            "activeStories": [
                {
                    "type": "Trade",
                    "title": "Market Expansion",
                    "participants": ["village1", "village2"],
                    "progress": 0.5,
                    "events": [
                        {
                            "type": "TradeAgreement",
                            "description": "Villages agree to trade",
                            "completed": true
                        }
                    ]
                }
            ]
        };
        */
        
        return storyData;
    }

    void deserializeVillages(const nlohmann::json& data) {
        // TODO: Implement village deserialization
    }

    void deserializeTechnology(const nlohmann::json& data) {
        // TODO: Implement technology deserialization
    }

    void deserializeEnvironment(const nlohmann::json& data) {
        // TODO: Implement environment deserialization
    }

    void deserializeStories(const nlohmann::json& data) {
        // TODO: Implement story deserialization
    }
};

} // namespace Core
} // namespace Forge
