#pragma once
#include <sol/sol.hpp>
#include <filesystem>
#include <unordered_map>
#include <chrono>
#include "../Core/Profiler.h"
#include "../GameSystems/EnvironmentalSystem.h"
#include "../GameSystems/AdvancedTradeSystem.h"

namespace Forge {
namespace Scripting {

class LuaScriptSystem {
public:
    LuaScriptSystem() {
        PROFILE_SCOPE("LuaScriptSystem_Initialize");
        
        lua.open_libraries(
            sol::lib::base,
            sol::lib::math,
            sol::lib::string,
            sol::lib::table,
            sol::lib::coroutine
        );

        registerTypes();
        setupModAPI();
    }

    void loadScript(const std::string& scriptPath) {
        PROFILE_SCOPE("LuaScriptSystem_LoadScript");

        try {
            auto lastModified = std::filesystem::last_write_time(scriptPath);
            lua.script_file(scriptPath);
            loadedScripts[scriptPath] = {lastModified, true};
        }
        catch (const sol::error& e) {
            // Log error and mark script as failed
            loadedScripts[scriptPath] = {std::filesystem::file_time_type::min(), false};
            throw std::runtime_error("Failed to load script: " + std::string(e.what()));
        }
    }

    void reloadModifiedScripts() {
        PROFILE_SCOPE("LuaScriptSystem_HotReload");

        for (auto& [path, info] : loadedScripts) {
            try {
                auto currentModified = std::filesystem::last_write_time(path);
                if (currentModified > info.lastModified) {
                    lua.script_file(path);
                    info.lastModified = currentModified;
                    info.loaded = true;
                }
            }
            catch (const sol::error& e) {
                info.loaded = false;
                // Log error but continue with other scripts
            }
        }
    }

    template<typename... Args>
    sol::protected_function_result callModFunction(
        const std::string& modName,
        const std::string& functionName,
        Args&&... args
    ) {
        PROFILE_SCOPE("LuaScriptSystem_CallModFunction");

        sol::protected_function func = lua[modName][functionName];
        if (!func.valid()) {
            throw std::runtime_error("Invalid mod function: " + modName + "." + functionName);
        }

        return func(std::forward<Args>(args)...);
    }

private:
    sol::state lua;
    
    struct ScriptInfo {
        std::filesystem::file_time_type lastModified;
        bool loaded;
    };
    
    std::unordered_map<std::string, ScriptInfo> loadedScripts;

    void registerTypes() {
        // Register game types with Lua
        
        // Climate type
        lua.new_enum<Climate::Season>(
            "Season",
            {
                {"Spring", Climate::Season::Spring},
                {"Summer", Climate::Season::Summer},
                {"Autumn", Climate::Season::Autumn},
                {"Winter", Climate::Season::Winter}
            }
        );

        lua.new_enum<Climate::WeatherType>(
            "WeatherType",
            {
                {"Clear", Climate::WeatherType::Clear},
                {"Rainy", Climate::WeatherType::Rainy},
                {"Stormy", Climate::WeatherType::Stormy},
                {"Snowy", Climate::WeatherType::Snowy},
                {"Drought", Climate::WeatherType::Drought}
            }
        );

        // Resource type
        lua.new_enum<ResourceType>(
            "ResourceType",
            {
                {"Food", ResourceType::Food},
                {"Wood", ResourceType::Wood},
                {"Stone", ResourceType::Stone},
                {"Metal", ResourceType::Metal},
                {"Cloth", ResourceType::Cloth},
                {"Tools", ResourceType::Tools}
            }
        );
    }

    void setupModAPI() {
        // Create the mod API namespace
        auto modAPI = lua.create_named_table("ModAPI");

        // Environment API
        modAPI.set_function("getClimate", [](EnvironmentalSystem* env) {
            const auto& climate = env->getCurrentClimate();
            return std::make_tuple(
                climate.currentSeason,
                climate.currentWeather,
                climate.temperature,
                climate.rainfall
            );
        });

        // Trade API
        modAPI.set_function("createTrade", [](AdvancedTradeSystem* trade,
                                            const std::string& seller,
                                            const std::string& buyer,
                                            ResourceType resource,
                                            float quantity) {
            return trade->createTradeContract(seller, buyer, resource, quantity, 30.0f);
        });

        // Event API
        modAPI.set_function("registerEventHandler", [this](const std::string& eventType,
                                                         sol::protected_function handler) {
            eventHandlers[eventType].push_back(handler);
        });

        // Custom content API
        modAPI.set_function("registerResource", [](const std::string& name,
                                                 float baseValue,
                                                 const sol::table& properties) {
            // Implementation for registering custom resources
        });

        modAPI.set_function("registerProfession", [](const std::string& name,
                                                   const sol::table& requirements) {
            // Implementation for registering custom professions
        });
    }

    std::unordered_map<std::string, std::vector<sol::protected_function>> eventHandlers;
};

} // namespace Scripting
} // namespace Forge
