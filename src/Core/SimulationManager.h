#pragma once
#include "../GameSystems/NPCAdvanced.h"
#include "../GameSystems/PopulationDynamics.h"
#include "../GameSystems/EconomicSystem.h"
#include "../Core/ScriptEngine.h"
#include <memory>
#include <vector>
#include <functional>

namespace Forge {

class SimulationManager {
public:
    // Singleton access
    static SimulationManager& GetInstance();

    // Simulation Control
    void StartSimulation();
    void PauseSimulation();
    void ResumeSimulation();
    void StopSimulation();

    // System Coordination
    void UpdateSimulationSystems(float deltaTime);

    // Event and Callback Management
    void RegisterSimulationEventHandler(std::function<void(const std::string&)> handler);
    void TriggerSimulationEvent(const std::string& eventName);

    // Scripting Integration
    void InitializeScriptingEnvironment();
    void LoadSimulationScripts(const std::string& scriptPath);

private:
    SimulationManager();
    ~SimulationManager();

    // Prevent copying
    SimulationManager(const SimulationManager&) = delete;
    SimulationManager& operator=(const SimulationManager&) = delete;

    // Simulation Systems
    std::unique_ptr<PopulationManager> m_populationManager;
    std::unique_ptr<VillageEconomy> m_economicSystem;
    std::unique_ptr<ScriptEngine> m_scriptEngine;
    std::unique_ptr<StoryEngine> m_storyEngine;

    // Simulation State
    enum class SimulationState {
        Stopped,
        Running,
        Paused
    };
    SimulationState m_currentState;

    // Event Handlers
    std::vector<std::function<void(const std::string&)>> m_eventHandlers;

    // Internal Update Methods
    void UpdatePopulation(float deltaTime);
    void UpdateEconomy(float deltaTime);
    void UpdateStoryGeneration(float deltaTime);
};

} // namespace Forge
