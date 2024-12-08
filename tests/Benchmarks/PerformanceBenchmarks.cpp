#include <benchmark/benchmark.h>
#include "../../src/Core/ObjectPool.h"
#include "../../src/GameSystems/MultiVillageSystem.h"
#include "../../src/AI/StorytellingSystem.h"

// Memory Management Benchmarks
static void BM_ObjectPoolAllocation(benchmark::State& state) {
    ForgeEngine::Core::ObjectPool<int> pool(1000);
    for (auto _ : state) {
        auto* obj = pool.acquire();
        pool.release(obj);
    }
}
BENCHMARK(BM_ObjectPoolAllocation);

// Village System Benchmarks
static void BM_VillageInteraction(benchmark::State& state) {
    auto threadPool = std::make_shared<ForgeEngine::Core::ThreadPool>(4);
    auto envSystem = std::make_shared<Forge::EnvironmentalSystem>(threadPool);
    auto techSystem = std::make_shared<Forge::TechnologySystem>(threadPool, nullptr);
    auto tradeSystem = std::make_shared<Forge::AdvancedTradeSystem>();
    auto storySystem = std::make_shared<ForgeEngine::AI::StorytellingSystem>(threadPool, envSystem, techSystem);
    auto villageSystem = std::make_shared<Forge::MultiVillageSystem>(
        threadPool, envSystem, techSystem, tradeSystem, storySystem
    );

    villageSystem->addVillage("Village1", sf::Vector2f(0, 0));
    villageSystem->addVillage("Village2", sf::Vector2f(100, 100));

    for (auto _ : state) {
        villageSystem->update(1.0f);
    }
}
BENCHMARK(BM_VillageInteraction);

// AI System Benchmarks
static void BM_StoryGeneration(benchmark::State& state) {
    auto threadPool = std::make_shared<ForgeEngine::Core::ThreadPool>(4);
    auto envSystem = std::make_shared<Forge::EnvironmentalSystem>(threadPool);
    auto techSystem = std::make_shared<Forge::TechnologySystem>(threadPool, nullptr);
    auto storySystem = std::make_shared<ForgeEngine::AI::StorytellingSystem>(threadPool, envSystem, techSystem);

    for (auto _ : state) {
        storySystem->update(1.0f);
    }
}
BENCHMARK(BM_StoryGeneration);

// Environmental System Benchmarks
static void BM_EnvironmentalUpdate(benchmark::State& state) {
    auto threadPool = std::make_shared<ForgeEngine::Core::ThreadPool>(4);
    auto envSystem = std::make_shared<Forge::EnvironmentalSystem>(threadPool);

    for (auto _ : state) {
        envSystem->update(1.0f);
    }
}
BENCHMARK(BM_EnvironmentalUpdate);

BENCHMARK_MAIN();
