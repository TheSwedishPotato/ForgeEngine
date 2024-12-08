#pragma once
#include <vector>
#include <memory>
#include <queue>
#include "../Core/ThreadPool.h"
#include "EconomicSystem.h"
#include "EnvironmentalSystem.h"
#include "../AI/PersonalitySystem.h"

namespace Forge {

struct TradeContract {
    ResourceType resource;
    float quantity;
    float pricePerUnit;
    std::string sellerId;
    std::string buyerId;
    float duration;        // Contract duration in days
    bool isRecurring;     // Whether the contract renews automatically
};

struct MarketDemand {
    ResourceType resource;
    float basePrice;
    float currentDemand;  // 0.0 to 2.0, 1.0 is normal
    float elasticity;     // How much price changes with demand
};

class AdvancedTradeSystem {
public:
    AdvancedTradeSystem(
        std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool,
        std::shared_ptr<EnvironmentalSystem> envSystem
    ) : m_threadPool(threadPool), m_environmentalSystem(envSystem) {
        initializeMarket();
    }

    void updateMarket(float deltaTime) {
        PROFILE_SCOPE("AdvancedTradeSystem_Update");

        // Update market demands
        updateDemands(deltaTime);

        // Process trade contracts
        processContracts(deltaTime);

        // Generate new trade opportunities
        generateTradeOpportunities();

        // Update prices based on supply and demand
        updatePrices();
    }

    float getCurrentPrice(ResourceType resource) const {
        auto it = marketDemands.find(resource);
        if (it != marketDemands.end()) {
            const auto& demand = it->second;
            float envModifier = m_environmentalSystem->getResourceProductionModifier(resource);
            return demand.basePrice * demand.currentDemand * (1.0f / envModifier);
        }
        return 0.0f;
    }

    bool createTradeContract(
        const std::string& sellerId,
        const std::string& buyerId,
        ResourceType resource,
        float quantity,
        float duration
    ) {
        float price = getCurrentPrice(resource);
        if (price <= 0.0f) return false;

        TradeContract contract{
            resource,
            quantity,
            price,
            sellerId,
            buyerId,
            duration,
            false
        };

        activeContracts.push_back(contract);
        return true;
    }

    std::vector<TradeContract> getActiveContracts() const {
        return activeContracts;
    }

    std::vector<MarketDemand> getMarketDemands() const {
        std::vector<MarketDemand> demands;
        for (const auto& [type, demand] : marketDemands) {
            demands.push_back(demand);
        }
        return demands;
    }

private:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> m_threadPool;
    std::shared_ptr<EnvironmentalSystem> m_environmentalSystem;
    std::unordered_map<ResourceType, MarketDemand> marketDemands;
    std::vector<TradeContract> activeContracts;
    std::queue<TradeContract> pendingContracts;

    void initializeMarket() {
        // Initialize base market demands for each resource
        marketDemands[ResourceType::Food] = {
            ResourceType::Food,
            10.0f,      // Base price
            1.0f,       // Normal demand
            0.5f        // Elasticity
        };

        marketDemands[ResourceType::Wood] = {
            ResourceType::Wood,
            5.0f,
            1.0f,
            0.3f
        };

        // Add more resources
    }

    void updateDemands(float deltaTime) {
        m_threadPool->enqueue([this, deltaTime]() {
            PROFILE_SCOPE("AdvancedTradeSystem_UpdateDemands");

            for (auto& [type, demand] : marketDemands) {
                // Environmental factors affect demand
                float envModifier = m_environmentalSystem->getResourceProductionModifier(type);
                
                // Seasonal variations
                const auto& climate = m_environmentalSystem->getCurrentClimate();
                float seasonalDemand = calculateSeasonalDemand(type, climate);

                // Update current demand
                demand.currentDemand = std::clamp(
                    demand.currentDemand * envModifier * seasonalDemand,
                    0.5f, 2.0f
                );
            }
        });
    }

    float calculateSeasonalDemand(ResourceType type, const Climate& climate) {
        switch (type) {
            case ResourceType::Food:
                // Higher food demand in winter
                return climate.currentSeason == Climate::Season::Winter ? 1.5f : 1.0f;
            
            case ResourceType::Wood:
                // Higher wood demand in winter for heating
                return climate.currentSeason == Climate::Season::Winter ? 1.8f : 0.8f;
            
            default:
                return 1.0f;
        }
    }

    void processContracts(float deltaTime) {
        for (auto it = activeContracts.begin(); it != activeContracts.end();) {
            it->duration -= deltaTime;
            if (it->duration <= 0.0f) {
                if (it->isRecurring) {
                    // Renew contract with updated price
                    it->pricePerUnit = getCurrentPrice(it->resource);
                    it->duration = 30.0f; // Renew for 30 days
                } else {
                    it = activeContracts.erase(it);
                    continue;
                }
            }
            ++it;
        }
    }

    void generateTradeOpportunities() {
        m_threadPool->enqueue([this]() {
            PROFILE_SCOPE("AdvancedTradeSystem_GenerateOpportunities");

            // Generate trade opportunities based on current market conditions
            for (const auto& [type, demand] : marketDemands) {
                if (demand.currentDemand > 1.5f) {
                    // High demand - generate more selling opportunities
                    generateSellingOpportunity(type);
                }
                else if (demand.currentDemand < 0.7f) {
                    // Low demand - generate buying opportunities
                    generateBuyingOpportunity(type);
                }
            }
        });
    }

    void generateSellingOpportunity(ResourceType type) {
        float currentPrice = getCurrentPrice(type);
        // Implementation details for generating selling opportunities
    }

    void generateBuyingOpportunity(ResourceType type) {
        float currentPrice = getCurrentPrice(type);
        // Implementation details for generating buying opportunities
    }

    void updatePrices() {
        for (auto& [type, demand] : marketDemands) {
            float envModifier = m_environmentalSystem->getResourceProductionModifier(type);
            float supplySurplus = calculateSupplySurplus(type);
            
            // Update price based on supply and demand
            demand.basePrice *= (1.0f + (demand.currentDemand - 1.0f) * demand.elasticity);
            demand.basePrice *= (1.0f / envModifier);
            
            // Adjust for supply surplus/shortage
            demand.basePrice *= (1.0f - supplySurplus * 0.1f);
            
            // Ensure price doesn't go too low or high
            demand.basePrice = std::clamp(demand.basePrice, 1.0f, 100.0f);
        }
    }

    float calculateSupplySurplus(ResourceType type) {
        // Calculate total supply vs demand from active contracts
        float totalSupply = 0.0f;
        float totalDemand = 0.0f;
        
        for (const auto& contract : activeContracts) {
            if (contract.resource == type) {
                totalSupply += contract.quantity;
            }
        }
        
        auto it = marketDemands.find(type);
        if (it != marketDemands.end()) {
            totalDemand = it->second.currentDemand * 100.0f; // Base demand value
        }
        
        return (totalSupply - totalDemand) / totalDemand;
    }
};

} // namespace Forge
