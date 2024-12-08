#pragma once
#include <windows.h>
#include <d3d11.h>
#include <memory>
#include "Window.h"
#include "Renderer.h"

namespace Forge {

class Engine {
public:
    static Engine& Get() {
        static Engine instance;
        return instance;
    }

    bool Initialize(HINSTANCE hInstance, const char* title, int width, int height);
    void Run();
    void Shutdown();

    Window& GetWindow() { return *m_Window; }
    Renderer& GetRenderer() { return *m_Renderer; }

private:
    Engine() = default;
    ~Engine() = default;
    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;

    void Update(float deltaTime);
    void Render();

    std::unique_ptr<Window> m_Window;
    std::unique_ptr<Renderer> m_Renderer;
    bool m_IsRunning = false;
};
