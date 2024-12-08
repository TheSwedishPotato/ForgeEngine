#pragma once
#include <windows.h>
#include <string>

namespace Forge {

class Window {
public:
    Window() = default;
    ~Window() = default;

    bool Initialize(HINSTANCE hInstance, const char* title, int width, int height);
    void Shutdown();

    HWND GetHandle() const { return m_Handle; }
    int GetWidth() const { return m_Width; }
    int GetHeight() const { return m_Height; }

private:
    static LRESULT CALLBACK WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);

    HWND m_Handle = nullptr;
    HINSTANCE m_Instance = nullptr;
    std::string m_Title;
    int m_Width = 0;
    int m_Height = 0;
};
