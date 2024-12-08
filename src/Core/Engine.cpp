#include "Engine.h"
#include <chrono>

namespace Forge {

bool Engine::Initialize(HINSTANCE hInstance, const char* title, int width, int height) {
    // Create window
    m_Window = std::make_unique<Window>();
    if (!m_Window->Initialize(hInstance, title, width, height)) {
        return false;
    }

    // Initialize renderer
    m_Renderer = std::make_unique<Renderer>();
    if (!m_Renderer->Initialize(m_Window->GetHandle(), width, height)) {
        return false;
    }

    m_IsRunning = true;
    return true;
}

void Engine::Run() {
    auto lastTime = std::chrono::high_resolution_clock::now();

    while (m_IsRunning) {
        auto currentTime = std::chrono::high_resolution_clock::now();
        float deltaTime = std::chrono::duration<float>(currentTime - lastTime).count();
        lastTime = currentTime;

        // Process Windows messages
        MSG msg = {};
        while (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT) {
                m_IsRunning = false;
                break;
            }
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        Update(deltaTime);
        Render();
    }
}

void Engine::Update(float deltaTime) {
    // Update game logic here
}

void Engine::Render() {
    m_Renderer->BeginFrame();
    // Render game objects here
    m_Renderer->EndFrame();
}

void Engine::Shutdown() {
    if (m_Renderer) {
        m_Renderer->Shutdown();
    }
    if (m_Window) {
        m_Window->Shutdown();
    }
}
