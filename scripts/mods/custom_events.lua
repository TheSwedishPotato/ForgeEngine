-- Custom Events Mod
-- This mod adds custom events and modifies environmental behavior

local mod = {}

-- Custom resource: Spices (valuable trade good)
ModAPI.registerResource("Spices", 50.0, {
    tradeable = true,
    weight = 0.1,
    luxury = true,
    preservation = 360  -- Days until spoilage
})

-- Custom profession: Spice Merchant
ModAPI.registerProfession("SpiceMerchant", {
    required_skills = {
        trading = 0.6,
        negotiation = 0.5,
        geography = 0.3
    },
    tools = {"scales", "cart"},
    social_class = "Merchant"
})

-- Event handler for severe weather
ModAPI.registerEventHandler("WeatherChange", function(oldWeather, newWeather)
    if newWeather == WeatherType.Stormy then
        -- Modify trade prices during storms
        local tradingSystem = ModAPI.getTradingSystem()
        tradingSystem:adjustPrices("Spices", 1.5)  -- 50% price increase
    end
end)

-- Custom seasonal festival event
function mod.createSeasonalFestival(season)
    if season == Season.Spring then
        return {
            name = "Spring Fair",
            duration = 3,  -- days
            effects = {
                trade_bonus = 1.2,
                happiness = 1.3,
                productivity = 1.1
            }
        }
    end
end

-- Modify environmental conditions based on events
ModAPI.registerEventHandler("EnvironmentalUpdate", function(env)
    local climate = ModAPI.getClimate(env)
    
    -- Create more varied weather patterns
    if climate.season == Season.Summer and climate.temperature > 25 then
        -- Chance for summer storms
        if math.random() < 0.2 then
            return {
                weather = WeatherType.Stormy,
                duration = math.random(1, 3),
                intensity = math.random(0.6, 0.9)
            }
        end
    end
end)

-- Custom trade routes
function mod.setupTradeRoutes(tradingSystem)
    -- Establish spice trade route
    local route = {
        start = "LocalVillage",
        destinations = {"ForeignPort", "CapitalCity"},
        resources = {"Spices", "Cloth"},
        frequency = 30,  -- days between trades
        quantity_modifier = function(distance)
            return math.max(0.5, 1.0 - (distance * 0.1))
        end
    }
    
    tradingSystem:registerTradeRoute(route)
end

return mod
