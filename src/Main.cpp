#include "Core/Engine.h"
#include "Core/ScriptEngine.h"
#include "GameSystems/WorldGenerator.h"
#include "GameSystems/NPCAdvanced.h"
#include "GameSystems/PlayerSystem.h"
#include <iostream>
#include <memory>

class GameSimulation {
public:
    GameSimulation() {
        // Initialize core systems
        m_scriptEngine = std::make_unique<Forge::ScriptEngine>();
        m_worldGenerator = std::make_unique<Forge::WorldGenerator>(256, 256);
        m_npcManager = std::make_unique<Forge::NPCManager>();
        m_playerSkillSystem = std::make_unique<Forge::PlayerSkillSystem>();
        m_timeManager = std::make_unique<Forge::TimeManager>();
        m_weatherSystem = std::make_unique<Forge::WeatherSystem>();
    }

    void Initialize() {
        // Initialize script engine
        if (!m_scriptEngine->Initialize()) {
            std::cerr << "Failed to initialize script engine\n";
            return;
        }

        // Enable script hot-reloading
        m_scriptEngine->EnableHotReload("scripts/");

        // Load initial scripts
        LoadInitialScripts();

        // Generate world
        m_worldGenerator->GenerateWorld();

        // Create some NPCs
        CreateInitialNPCs();

        // Setup initial player skills
        SetupPlayerSkills();
    }

    void Update(float deltaTime) {
        // Check for script modifications
        m_scriptEngine->CheckScriptModifications();

        // Update core systems
        m_timeManager->Update(deltaTime);
        m_weatherSystem->Update(deltaTime);
        
        // Update world systems
        m_worldGenerator->Update(deltaTime);

        // Update NPCs
        UpdateNPCs(deltaTime);

        // Periodic game state logging
        m_updateTimer += deltaTime;
        if (m_updateTimer >= 3600.0f) {  // Log every game hour
            LogGameState();
            m_updateTimer = 0.0f;
        }
    }

    void LoadInitialScripts() {
        // Load core game scripts
        const std::vector<std::string> scriptFiles = {
            "scripts/quest_system.lua",
            "scripts/npc_interactions.lua"
        };

        for (const auto& script : scriptFiles) {
            if (!m_scriptEngine->LoadScript(script)) {
                std::cerr << "Failed to load script: " << script << "\n";
            }
        }

        // Execute initial game setup script
        m_scriptEngine->ExecuteString(R"(
            -- Initial game setup
            print("Forge Engine: Game Initialization Complete")
        )");
    }

private:
    void CreateInitialNPCs() {
        // Create sample NPCs
        auto blacksmith = std::make_unique<Forge::AdvancedNPC>("Hans", 
            Forge::NPCTraits{80, 70, 60, 90});
        auto farmer = std::make_unique<Forge::AdvancedNPC>("Erik", 
            Forge::NPCTraits{70, 50, 75, 85});
        
        m_npcManager->AddNPC(std::move(blacksmith));
        m_npcManager->AddNPC(std::move(farmer));

        // Notify script system about NPCs
        m_scriptEngine->ExecuteString(R"(
            local npcManager = require('npc_interactions')
            npcManager:createNPC('Hans', 'Blacksmith')
            npcManager:createNPC('Erik', 'Farmer')
        )");
    }

    void SetupPlayerSkills() {
        // Initialize basic skills
        m_playerSkillSystem->LearnSkill(Forge::SkillType::Farming);
        m_playerSkillSystem->LearnSkill(Forge::SkillType::Survival);
    }

    void UpdateNPCs(float deltaTime) {
        // Placeholder for NPC updates
        // In a real scenario, this would update each NPC's state
    }

    void LogGameState() {
        // Log game state to console and potentially to script
        m_scriptEngine->ExecuteString(R"(
            local questManager = require('quest_system')
            questManager.UpdateQuests()
        )");

        std::cout << "Game Time: " << m_timeManager->GetCurrentTime() 
                  << " Day: " << m_timeManager->GetCurrentDay()
                  << " Weather: ";
        
        switch (m_weatherSystem->GetCurrentWeather()) {
            case Forge::WeatherSystem::WeatherType::Sunny: 
                std::cout << "Sunny"; 
                break;
            case Forge::WeatherSystem::WeatherType::Rainy: 
                std::cout << "Rainy"; 
                break;
            case Forge::WeatherSystem::WeatherType::Stormy: 
                std::cout << "Stormy"; 
                break;
            default: 
                std::cout << "Unknown";
        }
        std::cout << std::endl;
    }

    // Core system pointers
    std::unique_ptr<Forge::ScriptEngine> m_scriptEngine;
    std::unique_ptr<Forge::WorldGenerator> m_worldGenerator;
    std::unique_ptr<Forge::NPCManager> m_npcManager;
    std::unique_ptr<Forge::PlayerSkillSystem> m_playerSkillSystem;
    std::unique_ptr<Forge::TimeManager> m_timeManager;
    std::unique_ptr<Forge::WeatherSystem> m_weatherSystem;

    float m_updateTimer = 0.0f;
};

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    // Initialize the Forge Engine
    Forge::Engine& engine = Forge::Engine::Get();
    
    // Create window and initialize rendering
    if (!engine.Initialize(hInstance, "Vasa Chronicles - Forge Engine", 1280, 720)) {
        return -1;
    }

    // Create game simulation
    GameSimulation gameSimulation;
    gameSimulation.Initialize();

    // Modify engine update to include game simulation
    engine.SetUpdateCallback([&gameSimulation](float deltaTime) {
        gameSimulation.Update(deltaTime);
    });

    // Run the game loop
    engine.Run();

    // Shutdown and cleanup
    engine.Shutdown();

    return 0;
}
