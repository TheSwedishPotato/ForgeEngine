#pragma once
#include <chrono>
#include <string>
#include <unordered_map>
#include <spdlog/spdlog.h>

namespace ForgeEngine {
namespace Core {

class Profiler {
public:
    static Profiler& getInstance() {
        static Profiler instance;
        return instance;
    }

    void beginProfile(const std::string& name) {
        auto& profile = profiles[name];
        profile.startTime = std::chrono::high_resolution_clock::now();
        profile.isRunning = true;
    }

    void endProfile(const std::string& name) {
        auto& profile = profiles[name];
        if (profile.isRunning) {
            auto endTime = std::chrono::high_resolution_clock::now();
            auto duration = std::chrono::duration_cast<std::chrono::microseconds>(
                endTime - profile.startTime
            ).count();

            profile.totalTime += duration;
            profile.callCount++;
            profile.isRunning = false;

            if (duration > profile.maxTime) {
                profile.maxTime = duration;
                spdlog::debug("New max time for {}: {} microseconds", name, duration);
            }
        }
    }

    void reset() {
        profiles.clear();
    }

    void printStats() {
        for (const auto& [name, profile] : profiles) {
            if (profile.callCount > 0) {
                double avgTime = static_cast<double>(profile.totalTime) / profile.callCount;
                spdlog::info(
                    "{} Stats:\n  Calls: {}\n  Avg Time: {:.2f}us\n  Max Time: {}us",
                    name, profile.callCount, avgTime, profile.maxTime
                );
            }
        }
    }

private:
    struct ProfileData {
        std::chrono::high_resolution_clock::time_point startTime;
        int64_t totalTime = 0;
        int64_t maxTime = 0;
        size_t callCount = 0;
        bool isRunning = false;
    };

    std::unordered_map<std::string, ProfileData> profiles;

    Profiler() = default;
    ~Profiler() = default;
};

// Scope-based profiler helper
class ScopedProfiler {
public:
    explicit ScopedProfiler(const std::string& name) : name(name) {
        Profiler::getInstance().beginProfile(name);
    }

    ~ScopedProfiler() {
        Profiler::getInstance().endProfile(name);
    }

private:
    std::string name;
};

} // namespace Core
} // namespace ForgeEngine

// Macro for easy profiling
#define PROFILE_SCOPE(name) ForgeEngine::Core::ScopedProfiler profiler##__LINE__(name)
