#include "../GameSystems/NPCAdvanced.h"
#include "../GameSystems/PopulationDynamics.h"
#include "../GameSystems/EconomicSystem.h"
#include <iostream>
#include <iomanip>
#include <thread>
#include <chrono>

class MedievalVillageSimulation {
public:
    MedievalVillageSimulation() : 
        m_populationManager(50),
        m_villageEconomy(50),
        m_storyEngine() {}

    void RunSimulation(int simulationYears = 50) {
        std::cout << "===== Comprehensive Medieval Village Simulation =====" << std::endl;
        std::cout << "Simulating " << simulationYears << " years of village life" << std::endl;
        std::cout << "===================================================" << std::endl;

        for (int year = 0; year < simulationYears; ++year) {
            SimulateYear(year);
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
    }

private:
    Forge::PopulationManager m_populationManager;
    Forge::VillageEconomy m_villageEconomy;
    Forge::StoryEngine m_storyEngine;

    void SimulateYear(int currentYear) {
        std::cout << "\n--- Year: " << currentYear << " ---" << std::endl;

        // Simulate population dynamics
        m_populationManager.SimulatePopulationCycle(1.0f);

        // Simulate economic cycle
        m_villageEconomy.SimulateEconomicCycle(1.0f);

        // Generate interesting stories
        GenerateStories();

        // Print village statistics
        PrintVillageStatistics();
    }

    void GenerateStories() {
        // Select random NPCs for story generation
        auto npcs = GetRandomNPCs(2);
        
        if (!npcs.empty()) {
            std::string event = m_storyEngine.GenerateEvent(npcs);
            if (!event.empty()) {
                std::cout << "Story Event: " << event << std::endl;
            }

            if (!npcs.empty()) {
                std::string storyArc = m_storyEngine.CreateStoryArc(npcs[0]);
                std::cout << "Story Arc: " << storyArc << std::endl;
            }
        }
    }

    void PrintVillageStatistics() {
        std::cout << "Village Statistics:" << std::endl;
        
        // Economic Metrics
        float totalResourceValue = m_villageEconomy.GetTotalResourceValue();
        float averageWealth = m_villageEconomy.GetAverageWealthPerCapita();
        
        std::cout << "  Economic Metrics:" << std::endl;
        std::cout << "    Total Resource Value: " 
                  << std::fixed << std::setprecision(2) 
                  << totalResourceValue << std::endl;
        std::cout << "    Average Wealth per Capita: " 
                  << std::fixed << std::setprecision(2) 
                  << averageWealth << std::endl;
    }

    std::vector<Forge::PopulationNPC*> GetRandomNPCs(int count) {
        // Placeholder method to get random NPCs
        std::vector<Forge::PopulationNPC*> randomNPCs;
        // Implement actual random NPC selection
        return randomNPCs;
    }
};

int main() {
    try {
        MedievalVillageSimulation simulation;
        simulation.RunSimulation(100); // Simulate 100 years of village life
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "Simulation Error: " << e.what() << std::endl;
        return 1;
    }
}
