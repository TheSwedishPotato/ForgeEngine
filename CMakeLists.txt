cmake_minimum_required(VERSION 3.20)
project(ForgeEngine VERSION 0.1.0 LANGUAGES CXX)

# C++ Standard
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Compiler Flags
if(MSVC)
    add_compile_options(/W4 /WX)
else()
    add_compile_options(-Wall -Wextra -Werror)
endif()

# Lua Setup
set(LUA_DIR "C:/Program Files/Lua/5.4")
set(LUA_INCLUDE_DIR "${LUA_DIR}/include")
set(LUA_LIBRARY_DIR "${LUA_DIR}/lib")

# DirectX 11 Setup
set(DIRECTX_INCLUDE_DIR "C:/Program Files (x86)/Microsoft DirectX SDK (June 2010)/Include")
set(DIRECTX_LIBRARY_DIR "C:/Program Files (x86)/Microsoft DirectX SDK (June 2010)/Lib/x64")

# Find package configuration
find_package(TensorFlow CONFIG REQUIRED)
find_package(sol2 CONFIG REQUIRED)
find_package(SFML COMPONENTS system window graphics CONFIG REQUIRED)
find_package(SDL2 CONFIG REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(Catch2 CONFIG REQUIRED)

# Source Files
set(CORE_SOURCES
    src/Core/Engine.cpp
    src/Core/Window.cpp
    src/Core/Renderer.cpp
    src/Core/Input.cpp
    src/Core/Camera.cpp
    src/Core/ScriptEngine.cpp
    src/Core/SimulationManager.cpp
    src/Core/SimulationManager.h
    src/GameSystems/PopulationDynamics.cpp
    src/GameSystems/PopulationDynamics.h
    src/GameSystems/EconomicSystem.cpp
    src/GameSystems/EconomicSystem.h
)

set(GAME_SYSTEM_SOURCES
    src/GameSystems/WorldGenerator.cpp
    src/GameSystems/NPC.cpp
    src/GameSystems/NPCAdvanced.cpp
    src/GameSystems/PlayerSystem.cpp
    src/GameSystems/NPCAISystem.cpp
    src/GameSystems/NPCAISystem.h
)

set(DEMO_SOURCES
    src/Demos/NPCSimulation.cpp
)

# Add executable
add_executable(ForgeEngine 
    src/Main.cpp
    ${CORE_SOURCES}
    ${GAME_SYSTEM_SOURCES}
)

add_executable(NPCSimulationDemo 
    ${DEMO_SOURCES} 
    ${CORE_SOURCES}
    ${GAME_SYSTEM_SOURCES}
)

# Link libraries
target_link_libraries(ForgeEngine 
    PRIVATE 
    tensorflow::tensorflow
    sol2::sol2
    sfml-system sfml-window sfml-graphics
    SDL2::SDL2
    spdlog::spdlog
    Catch2::Catch2
    d3d11.lib
    d3dcompiler.lib
    dxgi.lib
    dxguid.lib
    lua54.lib
)

target_link_libraries(NPCSimulationDemo
    PRIVATE 
    tensorflow::tensorflow
    sol2::sol2
    sfml-system sfml-window sfml-graphics
    SDL2::SDL2
    spdlog::spdlog
    Catch2::Catch2
    d3d11.lib
    d3dcompiler.lib
    dxgi.lib
    dxguid.lib
    lua54.lib
)

# Include directories
target_include_directories(ForgeEngine 
    PRIVATE 
    src
    ${DIRECTX_INCLUDE_DIR}
    ${LUA_INCLUDE_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

target_include_directories(NPCSimulationDemo 
    PRIVATE 
    src
    ${DIRECTX_INCLUDE_DIR}
    ${LUA_INCLUDE_DIR}
    ${CMAKE_SOURCE_DIR}/src
)

# Link Directories
target_link_directories(ForgeEngine PRIVATE 
    ${DIRECTX_LIBRARY_DIR}
    ${LUA_LIBRARY_DIR}
)

target_link_directories(NPCSimulationDemo PRIVATE 
    ${DIRECTX_LIBRARY_DIR}
    ${LUA_LIBRARY_DIR}
)

# Windows-specific settings
if(WIN32)
    set_target_properties(ForgeEngine PROPERTIES 
        WIN32_EXECUTABLE TRUE
        LINK_FLAGS "/SUBSYSTEM:WINDOWS"
    )
    set_target_properties(NPCSimulationDemo PROPERTIES 
        WIN32_EXECUTABLE TRUE
        LINK_FLAGS "/SUBSYSTEM:WINDOWS"
    )
endif()

# Copy scripts to build directory
file(COPY scripts DESTINATION ${CMAKE_BINARY_DIR})

# Testing
enable_testing()
add_executable(ForgeEngineTests 
    tests/core_tests.cpp
    tests/ai_tests.cpp
    tests/simulation_tests.cpp
)
target_link_libraries(ForgeEngineTests 
    PRIVATE 
    Catch2::Catch2WithMain
    ForgeEngine
)
add_test(NAME ForgeEngineTests COMMAND ForgeEngineTests)
