#pragma once
#include <vector>
#include <memory>
#include <functional>
#include <mutex>
#include <spdlog/spdlog.h>

namespace ForgeEngine {
namespace Core {

template<typename T>
class ObjectPool {
public:
    ObjectPool(size_t initialSize = 100) {
        objects.reserve(initialSize);
        for (size_t i = 0; i < initialSize; ++i) {
            objects.push_back(std::make_unique<T>());
            available.push_back(objects.back().get());
        }
    }

    T* acquire() {
        std::lock_guard<std::mutex> lock(poolMutex);
        if (available.empty()) {
            spdlog::debug("Object pool expanding: creating new object");
            objects.push_back(std::make_unique<T>());
            available.push_back(objects.back().get());
        }

        T* object = available.back();
        available.pop_back();
        return object;
    }

    void release(T* object) {
        std::lock_guard<std::mutex> lock(poolMutex);
        if (object) {
            object->reset();  // Reset object state
            available.push_back(object);
        }
    }

    size_t availableCount() const {
        return available.size();
    }

    size_t totalCount() const {
        return objects.size();
    }

private:
    std::vector<std::unique_ptr<T>> objects;
    std::vector<T*> available;
    std::mutex poolMutex;
};

} // namespace Core
} // namespace ForgeEngine
