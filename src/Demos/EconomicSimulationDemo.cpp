#include "../GameSystems/EconomicSystem.h"
#include <iostream>
#include <iomanip>
#include <thread>
#include <chrono>

class EconomicSimulation {
public:
    EconomicSimulation() : 
        m_villageEconomy(100),  // Start with 100 economic agents
        m_tradeNegotiationSystem() {}

    void RunSimulation(int simulationYears = 10) {
        std::cout << "===== Medieval Village Economic Simulation =====" << std::endl;
        std::cout << "Simulating " << simulationYears << " years of economic activity" << std::endl;
        std::cout << "================================================" << std::endl;

        for (int year = 0; year < simulationYears; ++year) {
            SimulateYear(year);
            std::this_thread::sleep_for(std::chrono::milliseconds(500)); // Slow down for readability
        }
    }

private:
    Forge::VillageEconomy m_villageEconomy;
    Forge::TradeNegotiationSystem m_tradeNegotiationSystem;

    void SimulateYear(int currentYear) {
        std::cout << "\n--- Year: " << currentYear << " ---" << std::endl;

        // Simulate economic cycle
        m_villageEconomy.SimulateEconomicCycle(1.0f);

        // Print economic metrics
        PrintEconomicMetrics();
    }

    void PrintEconomicMetrics() {
        std::cout << "Economic Metrics:" << std::endl;
        
        // Total resource value
        float totalResourceValue = m_villageEconomy.GetTotalResourceValue();
        std::cout << "  Total Resource Value: " 
                  << std::fixed << std::setprecision(2) 
                  << totalResourceValue << std::endl;

        // Average wealth per capita
        float averageWealth = m_villageEconomy.GetAverageWealthPerCapita();
        std::cout << "  Average Wealth per Capita: " 
                  << std::fixed << std::setprecision(2) 
                  << averageWealth << std::endl;
    }
};

int main() {
    try {
        EconomicSimulation simulation;
        simulation.RunSimulation(50); // Simulate 50 years of economic activity
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "Simulation Error: " << e.what() << std::endl;
        return 1;
    }
}
