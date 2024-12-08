cmake_minimum_required(VERSION 3.15)

# Find required packages
find_package(Catch2 CONFIG REQUIRED)
find_package(benchmark CONFIG REQUIRED)

# Create test executable
add_executable(ForgeEngineTests
    GameSystems/MultiVillageSystemTests.cpp
    AI/StorytellingSystemTests.cpp
)

# Create benchmark executable
add_executable(ForgeEngineBenchmarks
    Benchmarks/PerformanceBenchmarks.cpp
)

# Link test dependencies
target_link_libraries(ForgeEngineTests
    PRIVATE
    Catch2::Catch2
    ForgeEngine
    sfml-graphics
    sfml-window
    sfml-system
    TensorFlow::TensorFlow
    sol2
    nlohmann_json::nlohmann_json
    spdlog::spdlog
)

# Link benchmark dependencies
target_link_libraries(ForgeEngineBenchmarks
    PRIVATE
    benchmark::benchmark
    benchmark::benchmark_main
    ForgeEngine
    sfml-graphics
    sfml-window
    sfml-system
    TensorFlow::TensorFlow
    sol2
    nlohmann_json::nlohmann_json
    spdlog::spdlog
)

# Include directories
target_include_directories(ForgeEngineTests
    PRIVATE
    ${CMAKE_SOURCE_DIR}/src
)

target_include_directories(ForgeEngineBenchmarks
    PRIVATE
    ${CMAKE_SOURCE_DIR}/src
)

# Enable testing
include(CTest)
include(Catch)
catch_discover_tests(ForgeEngineTests)

# Add benchmark target
add_custom_target(run-benchmarks
    COMMAND ForgeEngineBenchmarks
    DEPENDS ForgeEngineBenchmarks
)
