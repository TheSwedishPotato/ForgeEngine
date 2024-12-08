#include "SimulationManager.h"
#include <stdexcept>
#include <chrono>

namespace Forge {

SimulationManager& SimulationManager::GetInstance() {
    static SimulationManager instance;
    return instance;
}

SimulationManager::SimulationManager() : 
    m_populationManager(std::make_unique<PopulationManager>(100)),
    m_economicSystem(std::make_unique<VillageEconomy>(100)),
    m_scriptEngine(std::make_unique<ScriptEngine>()),
    m_storyEngine(std::make_unique<StoryEngine>()),
    m_currentState(SimulationState::Stopped) {}

SimulationManager::~SimulationManager() = default;

void SimulationManager::StartSimulation() {
    if (m_currentState != SimulationState::Running) {
        m_currentState = SimulationState::Running;
        InitializeScriptingEnvironment();
        TriggerSimulationEvent("SimulationStarted");
    }
}

void SimulationManager::PauseSimulation() {
    if (m_currentState == SimulationState::Running) {
        m_currentState = SimulationState::Paused;
        TriggerSimulationEvent("SimulationPaused");
    }
}

void SimulationManager::ResumeSimulation() {
    if (m_currentState == SimulationState::Paused) {
        m_currentState = SimulationState::Running;
        TriggerSimulationEvent("SimulationResumed");
    }
}

void SimulationManager::StopSimulation() {
    if (m_currentState != SimulationState::Stopped) {
        m_currentState = SimulationState::Stopped;
        TriggerSimulationEvent("SimulationStopped");
    }
}

void SimulationManager::UpdateSimulationSystems(float deltaTime) {
    if (m_currentState != SimulationState::Running) return;

    try {
        UpdatePopulation(deltaTime);
        UpdateEconomy(deltaTime);
        UpdateStoryGeneration(deltaTime);
    } catch (const std::exception& e) {
        // Log error and potentially trigger error event
        TriggerSimulationEvent("SimulationError: " + std::string(e.what()));
    }
}

void SimulationManager::RegisterSimulationEventHandler(
    std::function<void(const std::string&)> handler) {
    m_eventHandlers.push_back(handler);
}

void SimulationManager::TriggerSimulationEvent(const std::string& eventName) {
    for (auto& handler : m_eventHandlers) {
        handler(eventName);
    }
}

void SimulationManager::InitializeScriptingEnvironment() {
    // Initialize Lua scripting environment
    m_scriptEngine->Initialize();
    
    // Load core simulation scripts
    LoadSimulationScripts("scripts/core_simulation.lua");
}

void SimulationManager::LoadSimulationScripts(const std::string& scriptPath) {
    try {
        m_scriptEngine->LoadScript(scriptPath);
    } catch (const std::exception& e) {
        TriggerSimulationEvent("ScriptLoadError: " + std::string(e.what()));
    }
}

void SimulationManager::UpdatePopulation(float deltaTime) {
    m_populationManager->SimulatePopulationCycle(deltaTime);
}

void SimulationManager::UpdateEconomy(float deltaTime) {
    m_economicSystem->SimulateEconomicCycle(deltaTime);
}

void SimulationManager::UpdateStoryGeneration(float deltaTime) {
    // Placeholder for story generation update
    // In future, this might involve generating events based on population and economic state
}

} // namespace Forge
