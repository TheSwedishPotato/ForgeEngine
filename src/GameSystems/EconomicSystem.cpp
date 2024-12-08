#include "EconomicSystem.h"
#include <algorithm>
#include <cmath>

namespace Forge {

EconomicAgent::EconomicAgent(const std::string& name) : 
    m_name(name), 
    m_profession(Profession::Farmer),
    m_skillProficiency(0.1f) {}

void EconomicAgent::AddResource(ResourceType type, float quantity) {
    auto& resource = m_resources[type];
    resource.type = type;
    resource.quantity += quantity;
    resource.quality = std::min(1.0f, resource.quality + 0.01f);
}

float EconomicAgent::GetResourceQuantity(ResourceType type) const {
    auto it = m_resources.find(type);
    return (it != m_resources.end()) ? it->second.quantity : 0.0f;
}

void EconomicAgent::ConsumeResource(ResourceType type, float amount) {
    auto it = m_resources.find(type);
    if (it != m_resources.end()) {
        it->second.quantity = std::max(0.0f, it->second.quantity - amount);
    }
}

void EconomicAgent::SetProfession(Profession prof) {
    m_profession = prof;
}

Profession EconomicAgent::GetProfession() const {
    return m_profession;
}

float EconomicAgent::GetProficiencyLevel() const {
    return m_skillProficiency;
}

void EconomicAgent::ImproveSkill(float amount) {
    m_skillProficiency = std::min(1.0f, m_skillProficiency + amount);
}

float EconomicAgent::CalculateProductionOutput() const {
    // Production based on profession and skill
    float baseProduction = 1.0f;
    float skillMultiplier = 1.0f + m_skillProficiency;

    switch (m_profession) {
        case Profession::Farmer:
            return baseProduction * skillMultiplier * 1.5f;
        case Profession::Blacksmith:
            return baseProduction * skillMultiplier * 1.2f;
        case Profession::Carpenter:
            return baseProduction * skillMultiplier * 1.1f;
        case Profession::Weaver:
            return baseProduction * skillMultiplier * 1.0f;
        case Profession::Miner:
            return baseProduction * skillMultiplier * 1.3f;
        case Profession::Merchant:
            return baseProduction * skillMultiplier * 0.8f;
        case Profession::Soldier:
            return baseProduction * skillMultiplier * 0.5f;
        default:
            return baseProduction;
    }
}

float EconomicAgent::CalculateConsumptionNeeds() const {
    // Consumption needs based on profession
    float baseConsumption = 1.0f;

    switch (m_profession) {
        case Profession::Farmer:
            return baseConsumption * 1.2f;
        case Profession::Blacksmith:
            return baseConsumption * 1.5f;
        case Profession::Carpenter:
            return baseConsumption * 1.3f;
        case Profession::Weaver:
            return baseConsumption * 1.0f;
        case Profession::Miner:
            return baseConsumption * 1.4f;
        case Profession::Merchant:
            return baseConsumption * 1.1f;
        case Profession::Soldier:
            return baseConsumption * 1.6f;
        default:
            return baseConsumption;
    }
}

VillageEconomy::VillageEconomy(int initialPopulation) : 
    m_randomGenerator(std::random_device{}()) {
    
    std::uniform_int_distribution<> profDist(0, 6);
    
    for (int i = 0; i < initialPopulation; ++i) {
        std::string name = "Agent_" + std::to_string(i);
        auto agent = std::make_unique<EconomicAgent>(name);
        
        // Randomly assign professions
        Profession prof = static_cast<Profession>(profDist(m_randomGenerator));
        agent->SetProfession(prof);
        
        m_economicAgents.push_back(std::move(agent));
    }
}

void VillageEconomy::SimulateEconomicCycle(float deltaTime) {
    ProduceResources();
    ConsumeResources();
    DistributeResources();
    HandleTradeAndExchange();
}

void VillageEconomy::ProduceResources() {
    for (auto& agent : m_economicAgents) {
        float production = agent->CalculateProductionOutput();
        
        // Produce resources based on profession
        switch (agent->GetProfession()) {
            case Profession::Farmer:
                agent->AddResource(ResourceType::Food, production);
                break;
            case Profession::Blacksmith:
                agent->AddResource(ResourceType::Metal, production * 0.5f);
                agent->AddResource(ResourceType::Tools, production * 0.3f);
                break;
            case Profession::Carpenter:
                agent->AddResource(ResourceType::Wood, production);
                break;
            case Profession::Weaver:
                agent->AddResource(ResourceType::Cloth, production);
                break;
            case Profession::Miner:
                agent->AddResource(ResourceType::Stone, production * 0.6f);
                agent->AddResource(ResourceType::Metal, production * 0.4f);
                break;
            default:
                break;
        }
    }
}

void VillageEconomy::ConsumeResources() {
    for (auto& agent : m_economicAgents) {
        float consumption = agent->CalculateConsumptionNeeds();
        
        // Consume essential resources
        agent->ConsumeResource(ResourceType::Food, consumption);
        agent->ConsumeResource(ResourceType::Wood, consumption * 0.2f);
    }
}

void VillageEconomy::DistributeResources() {
    // Simple resource distribution logic
    for (auto& agent : m_economicAgents) {
        // Check if agent needs resources
        if (agent->GetResourceQuantity(ResourceType::Food) < 0.5f) {
            // Distribute from communal resources
            float availableFood = m_communalResources[ResourceType::Food];
            float distributedFood = std::min(availableFood, 0.5f);
            
            agent->AddResource(ResourceType::Food, distributedFood);
            m_communalResources[ResourceType::Food] -= distributedFood;
        }
    }
}

void VillageEconomy::HandleTradeAndExchange() {
    // Basic trade simulation
    for (size_t i = 0; i < m_economicAgents.size(); ++i) {
        for (size_t j = i + 1; j < m_economicAgents.size(); ++j) {
            // Potential trade between agents
            // This would be expanded with more complex trade negotiation
        }
    }
}

float VillageEconomy::GetTotalResourceValue() const {
    float totalValue = 0.0f;
    for (const auto& agent : m_economicAgents) {
        // Simplified resource valuation
        totalValue += 
            agent->GetResourceQuantity(ResourceType::Food) * 1.0f +
            agent->GetResourceQuantity(ResourceType::Wood) * 0.5f +
            agent->GetResourceQuantity(ResourceType::Stone) * 0.7f +
            agent->GetResourceQuantity(ResourceType::Metal) * 1.2f +
            agent->GetResourceQuantity(ResourceType::Cloth) * 0.8f +
            agent->GetResourceQuantity(ResourceType::Tools) * 1.5f;
    }
    return totalValue;
}

float VillageEconomy::GetAverageWealthPerCapita() const {
    if (m_economicAgents.empty()) return 0.0f;
    return GetTotalResourceValue() / m_economicAgents.size();
}

bool TradeNegotiationSystem::NegotiateTrade(EconomicAgent* buyer, EconomicAgent* seller) {
    if (!buyer || !seller) return false;

    float tradeDesirability = CalculateTradeDesirability(buyer, seller);
    float tradeRisk = CalculateTradeRisk();

    // Trade success probability
    return tradeDesirability > tradeRisk;
}

float TradeNegotiationSystem::CalculateTradeDesirability(EconomicAgent* buyer, EconomicAgent* seller) {
    // Complex trade desirability calculation
    float buyerNeed = 1.0f - buyer->GetResourceQuantity(ResourceType::Food);
    float sellerSurplus = seller->GetResourceQuantity(ResourceType::Food);
    
    return (buyerNeed + sellerSurplus) / 2.0f;
}

float TradeNegotiationSystem::CalculateTradeRisk() {
    // Randomize trade risk
    static std::random_device rd;
    static std::mt19937 gen(rd());
    std::uniform_real_distribution<> dis(0.0, 1.0);
    
    return dis(gen);
}

} // namespace Forge
