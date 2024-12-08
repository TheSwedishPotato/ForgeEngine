#include "ScriptEngine.h"
#include <iostream>
#include <chrono>
#include <filesystem>
#include <unordered_map>

namespace Forge {

ScriptEngine::ScriptEngine() : m_luaState(nullptr), m_scriptDirectory("") {}

ScriptEngine::~ScriptEngine() {
    if (m_luaState) {
        lua_close(m_luaState);
    }
}

bool ScriptEngine::Initialize() {
    m_luaState = luaL_newstate();
    if (!m_luaState) {
        std::cerr << "Failed to create Lua state\n";
        return false;
    }

    luaL_openlibs(m_luaState);
    ScriptBindings::RegisterGameSystems(*this);
    return true;
}

bool ScriptEngine::LoadScript(const std::string& filename) {
    if (!std::filesystem::exists(filename)) {
        std::cerr << "Script file not found: " << filename << "\n";
        return false;
    }

    int result = luaL_dofile(m_luaState, filename.c_str());
    if (result != LUA_OK) {
        HandleError(result);
        return false;
    }

    // Track script modification time for hot-reloading
    if (!m_scriptDirectory.empty()) {
        m_scriptModificationTimes[filename] = 
            std::filesystem::last_write_time(filename);
    }

    return true;
}

bool ScriptEngine::ReloadScript(const std::string& filename) {
    // Clear previous script state
    lua_settop(m_luaState, 0);
    return LoadScript(filename);
}

bool ScriptEngine::ExecuteString(const std::string& luaCode) {
    int result = luaL_dostring(m_luaState, luaCode.c_str());
    if (result != LUA_OK) {
        HandleError(result);
        return false;
    }
    return true;
}

void ScriptEngine::HandleError(int result) {
    if (result != LUA_OK) {
        std::string errorMsg = lua_tostring(m_luaState, -1);
        std::cerr << "Lua error: " << errorMsg << "\n";
        lua_pop(m_luaState, 1);
    }
}

void ScriptEngine::EnableHotReload(const std::string& scriptDir) {
    m_scriptDirectory = scriptDir;
}

void ScriptEngine::CheckScriptModifications() {
    if (m_scriptDirectory.empty()) return;

    for (const auto& entry : std::filesystem::directory_iterator(m_scriptDirectory)) {
        if (entry.is_regular_file() && entry.path().extension() == ".lua") {
            auto currentModTime = std::filesystem::last_write_time(entry);
            auto filename = entry.path().string();

            auto it = m_scriptModificationTimes.find(filename);
            if (it == m_scriptModificationTimes.end() || 
                currentModTime > it->second) {
                
                std::cout << "Reloading modified script: " << filename << "\n";
                ReloadScript(filename);
                m_scriptModificationTimes[filename] = currentModTime;
            }
        }
    }
}

// Binding implementations for game systems
void ScriptBindings::RegisterGameSystems(ScriptEngine& engine) {
    BindNPCSystem(engine);
    BindWorldSystem(engine);
    BindPlayerSystem(engine);
}

void ScriptBindings::BindNPCSystem(ScriptEngine& engine) {
    // Example NPC binding
    engine.RegisterFunction("CreateNPC", [](const std::string& name) {
        // Placeholder for NPC creation logic
        std::cout << "Creating NPC: " << name << std::endl;
    });
}

void ScriptBindings::BindWorldSystem(ScriptEngine& engine) {
    // Example World binding
    engine.RegisterFunction("SpawnItem", [](const std::string& itemName, float x, float y, float z) {
        // Placeholder for item spawning logic
        std::cout << "Spawning item: " << itemName 
                  << " at (" << x << "," << y << "," << z << ")" << std::endl;
    });
}

void ScriptBindings::BindPlayerSystem(ScriptEngine& engine) {
    // Example Player binding
    engine.RegisterFunction("GivePlayerItem", [](const std::string& itemName, int quantity) {
        // Placeholder for player inventory logic
        std::cout << "Giving player " << quantity 
                  << " of " << itemName << std::endl;
    });
}

} // namespace Forge
