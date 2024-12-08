#pragma once
#include <unordered_map>
#include <string>
#include <vector>
#include <memory>
#include <random>

namespace Forge {

// Economic Resource Types
enum class ResourceType {
    Food,
    Wood,
    Stone,
    Metal,
    Cloth,
    Tools
};

// Profession Specializations
enum class Profession {
    Farmer,
    Blacksmith,
    Carpenter,
    Weaver,
    Miner,
    Merchant,
    Soldier
};

// Economic Simulation Structures
struct Resource {
    ResourceType type;
    float quantity;
    float quality;
};

class EconomicAgent {
public:
    EconomicAgent(const std::string& name);

    // Resource Management
    void AddResource(ResourceType type, float quantity);
    float GetResourceQuantity(ResourceType type) const;
    void ConsumeResource(ResourceType type, float amount);

    // Profession and Skill
    void SetProfession(Profession prof);
    Profession GetProfession() const;
    float GetProficiencyLevel() const;
    void ImproveSkill(float amount);

    // Economic Interactions
    float CalculateProductionOutput() const;
    float CalculateConsumptionNeeds() const;

private:
    std::string m_name;
    std::unordered_map<ResourceType, Resource> m_resources;
    Profession m_profession;
    float m_skillProficiency;
};

class VillageEconomy {
public:
    VillageEconomy(int initialPopulation);

    // Economic Cycle Management
    void SimulateEconomicCycle(float deltaTime);

    // Trade and Resource Distribution
    void DistributeResources();
    void FacilitiateTrade();

    // Economic Metrics
    float GetTotalResourceValue() const;
    float GetAverageWealthPerCapita() const;

private:
    std::vector<std::unique_ptr<EconomicAgent>> m_economicAgents;
    std::unordered_map<ResourceType, float> m_communalResources;
    std::mt19937 m_randomGenerator;

    // Internal Economic Calculations
    void ProduceResources();
    void ConsumeResources();
    void HandleTradeAndExchange();
};

// Advanced Trade Negotiation System
class TradeNegotiationSystem {
public:
    // Simulate trade negotiations between economic agents
    bool NegotiateTrade(EconomicAgent* buyer, EconomicAgent* seller);

private:
    // Factors influencing trade success
    float CalculateTradeDesirability(EconomicAgent* buyer, EconomicAgent* seller);
    float CalculateTradeRisk();
};

} // namespace Forge
