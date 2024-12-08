#pragma once
#include <lua.hpp>
#include <string>
#include <memory>
#include <functional>
#include <unordered_map>
#include <vector>
#include <filesystem>

namespace Forge {

class ScriptContext {
public:
    ScriptContext(lua_State* L) : m_state(L) {}
    
    // Push various types to Lua stack
    template<typename T>
    void Push(T value);

    // Get values from Lua stack
    template<typename T>
    T Get(int index);

private:
    lua_State* m_state;
};

class ScriptEngine {
public:
    ScriptEngine();
    ~ScriptEngine();

    // Initialize Lua state and core libraries
    bool Initialize();

    // Load and execute script files
    bool LoadScript(const std::string& filename);
    bool ReloadScript(const std::string& filename);

    // Direct script execution
    bool ExecuteString(const std::string& luaCode);

    // Function registration with type-safe templated methods
    template<typename Func>
    void RegisterFunction(const std::string& name, Func func);

    // Global variable management
    template<typename T>
    void SetGlobal(const std::string& name, T value);

    template<typename T>
    T GetGlobal(const std::string& name);

    // Advanced script function calling
    template<typename... Args>
    void CallFunction(const std::string& funcName, Args... args);

    // Script hot-reloading
    void EnableHotReload(const std::string& scriptDir);

private:
    lua_State* m_luaState;
    std::string m_scriptDirectory;
    std::unordered_map<std::string, std::filesystem::file_time_type> m_scriptModificationTimes;

    // Internal error handling
    void HandleError(int result);

    // Check for script modifications
    void CheckScriptModifications();
};

// Script binding utilities
class ScriptBindings {
public:
    // Register core game systems to Lua
    static void RegisterGameSystems(ScriptEngine& engine);

private:
    // Bind specific subsystems
    static void BindNPCSystem(ScriptEngine& engine);
    static void BindWorldSystem(ScriptEngine& engine);
    static void BindPlayerSystem(ScriptEngine& engine);
};

} // namespace Forge
