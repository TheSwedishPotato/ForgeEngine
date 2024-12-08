#include "Window.h"

namespace Forge {

bool Window::Initialize(HINSTANCE hInstance, const char* title, int width, int height) {
    m_Instance = hInstance;
    m_Title = title;
    m_Width = width;
    m_Height = height;

    // Register window class
    WNDCLASSEX wc = {};
    wc.cbSize = sizeof(WNDCLASSEX);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.lpszClassName = "ForgeEngineWindow";
    
    RegisterClassEx(&wc);

    // Create window
    RECT rect = { 0, 0, width, height };
    AdjustWindowRect(&rect, WS_OVERLAPPEDWINDOW, FALSE);

    m_Handle = CreateWindow(
        wc.lpszClassName,
        title,
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT,
        rect.right - rect.left,
        rect.bottom - rect.top,
        nullptr,
        nullptr,
        hInstance,
        nullptr
    );

    if (!m_Handle) {
        return false;
    }

    ShowWindow(m_Handle, SW_SHOW);
    UpdateWindow(m_Handle);

    return true;
}

void Window::Shutdown() {
    if (m_Handle) {
        DestroyWindow(m_Handle);
        m_Handle = nullptr;
    }
}

LRESULT CALLBACK Window::WindowProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;

        case WM_KEYDOWN:
            if (wParam == VK_ESCAPE) {
                PostQuitMessage(0);
                return 0;
            }
            break;
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}
