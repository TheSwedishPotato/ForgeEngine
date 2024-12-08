#include "../GameSystems/PopulationDynamics.h"
#include <iostream>
#include <iomanip>
#include <thread>
#include <chrono>

class PopulationSimulation {
public:
    PopulationSimulation() : 
        m_populationManager(50),  // Start with 50 initial villagers
        m_storyEngine() {}

    void RunSimulation(int simulationYears = 10) {
        std::cout << "===== Medieval Village Population Simulation =====" << std::endl;
        std::cout << "Simulating " << simulationYears << " years of village life" << std::endl;
        std::cout << "================================================" << std::endl;

        for (float year = 0; year < simulationYears; year += 0.5f) {
            SimulateYear(year);
            std::this_thread::sleep_for(std::chrono::milliseconds(500)); // Slow down for readability
        }
    }

private:
    Forge::PopulationManager m_populationManager;
    Forge::StoryEngine m_storyEngine;

    void SimulateYear(float currentYear) {
        std::cout << "\n--- Year: " << std::fixed << std::setprecision(1) 
                  << currentYear << " ---" << std::endl;

        // Simulate population dynamics
        m_populationManager.SimulatePopulationCycle(0.5f);

        // Generate interesting stories
        GenerateStories();

        // Print population statistics
        PrintPopulationStats();
    }

    void GenerateStories() {
        // Select random NPCs for story generation
        std::vector<Forge::PopulationNPC*> npcs = GetRandomNPCs(2);
        
        if (!npcs.empty()) {
            std::string event = m_storyEngine.GenerateEvent(npcs);
            if (!event.empty()) {
                std::cout << "Story Event: " << event << std::endl;
            }

            // Generate a story arc for a random NPC
            if (!npcs.empty()) {
                std::string storyArc = m_storyEngine.CreateStoryArc(npcs[0]);
                std::cout << "Story Arc: " << storyArc << std::endl;
            }
        }
    }

    void PrintPopulationStats() {
        // This would be implemented in the actual PopulationManager
        std::cout << "Population Statistics:" << std::endl;
        
        // Placeholder for population tracking
        std::cout << "  Total Population: " << "Dynamic Population Size" << std::endl;
        std::cout << "  Births: " << "Dynamic Birth Count" << std::endl;
        std::cout << "  Deaths: " << "Dynamic Death Count" << std::endl;
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
        PopulationSimulation simulation;
        simulation.RunSimulation(50); // Simulate 50 years of village life
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "Simulation Error: " << e.what() << std::endl;
        return 1;
    }
}
