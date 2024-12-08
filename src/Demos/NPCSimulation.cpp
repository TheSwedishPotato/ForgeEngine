#include "../GameSystems/NPCAdvanced.h"
#include "../GameSystems/NPCAISystem.h"
#include <iostream>
#include <iomanip>
#include <thread>
#include <chrono>

// Simulation to demonstrate NPC AI system capabilities
class NPCSimulation {
public:
    NPCSimulation() {
        InitializeTownPopulation();
    }

    void RunSimulation(int simulationHours = 24) {
        std::cout << "===== Medieval Town NPC Simulation =====" << std::endl;
        std::cout << "Simulating " << simulationHours << " hours of NPC life" << std::endl;
        std::cout << "=======================================" << std::endl;

        for (float hour = 0; hour < simulationHours; hour += 0.5f) {
            SimulateHalfHour(hour);
            std::this_thread::sleep_for(std::chrono::milliseconds(500)); // Slow down for readability
        }
    }

private:
    Forge::NPCManager m_npcManager;

    void InitializeTownPopulation() {
        // Create diverse NPCs with different traits and personalities
        auto blacksmith = std::make_unique<Forge::AdvancedNPC>("Erik", 
            Forge::NPCTraits{8, 5, 9, 6});
        blacksmith->SetCurrentState(Forge::NPCState::Working);

        auto baker = std::make_unique<Forge::AdvancedNPC>("Ingrid", 
            Forge::NPCTraits{7, 8, 6, 7});
        baker->SetCurrentState(Forge::NPCState::Working);

        auto farmer = std::make_unique<Forge::AdvancedNPC>("Olaf", 
            Forge::NPCTraits{6, 4, 8, 5});
        farmer->SetCurrentState(Forge::NPCState::Working);

        m_npcManager.AddNPC(std::move(blacksmith));
        m_npcManager.AddNPC(std::move(baker));
        m_npcManager.AddNPC(std::move(farmer));
    }

    void SimulateHalfHour(float currentTime) {
        std::cout << "\n--- Time: " << std::fixed << std::setprecision(1) 
                  << currentTime << " hours ---" << std::endl;

        for (auto* npc : m_npcManager.GetAllNPCs()) {
            SimulateNPC(npc, currentTime);
        }
    }

    void SimulateNPC(Forge::AdvancedNPC* npc, float currentTime) {
        // Simulate NPC behavior based on time and needs
        std::cout << "NPC: " << npc->GetName() << std::endl;
        
        // Print current state and needs
        std::cout << "  State: " << GetStateName(npc->GetCurrentState()) 
                  << std::endl;
        std::cout << "  Hunger: " << std::fixed << std::setprecision(2) 
                  << npc->GetHunger() << std::endl;
        std::cout << "  Energy: " << npc->GetEnergy() << std::endl;
        std::cout << "  Social Need: " << npc->GetSocialNeed() << std::endl;

        // Perform NPC-specific actions
        switch (npc->GetCurrentState()) {
            case Forge::NPCState::Working:
                npc->PerformWork();
                break;
            case Forge::NPCState::Eating:
                npc->Eat();
                break;
            case Forge::NPCState::Resting:
                npc->Rest();
                break;
            case Forge::NPCState::Socializing:
                npc->Interact();
                break;
            default:
                npc->Wander();
                break;
        }

        // Print recent memories
        auto memories = npc->GetRecentMemories(2);
        std::cout << "  Recent Memories:" << std::endl;
        for (const auto& memory : memories) {
            std::cout << "    - " << memory << std::endl;
        }
    }

    std::string GetStateName(Forge::NPCState state) {
        switch (state) {
            case Forge::NPCState::Idle: return "Idle";
            case Forge::NPCState::Working: return "Working";
            case Forge::NPCState::Eating: return "Eating";
            case Forge::NPCState::Resting: return "Resting";
            case Forge::NPCState::Socializing: return "Socializing";
            case Forge::NPCState::Traveling: return "Traveling";
            case Forge::NPCState::Sleeping: return "Sleeping";
            default: return "Unknown";
        }
    }
};

int main() {
    try {
        NPCSimulation simulation;
        simulation.RunSimulation(12); // Simulate 12 hours
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "Simulation Error: " << e.what() << std::endl;
        return 1;
    }
}
