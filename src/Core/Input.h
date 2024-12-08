#pragma once
#include <windows.h>
#include <DirectXMath.h>
#include <array>

namespace Forge {

class Input {
public:
    static Input& Get() {
        static Input instance;
        return instance;
    }

    void Update();
    
    bool IsKeyDown(int keyCode) const { return m_KeyStates[keyCode]; }
    bool IsKeyPressed(int keyCode) const { return m_KeyStates[keyCode] && !m_PrevKeyStates[keyCode]; }
    bool IsKeyReleased(int keyCode) const { return !m_KeyStates[keyCode] && m_PrevKeyStates[keyCode]; }
    
    bool IsMouseButtonDown(int button) const { return m_MouseButtons[button]; }
    DirectX::XMFLOAT2 GetMousePosition() const { return m_MousePosition; }
    DirectX::XMFLOAT2 GetMouseDelta() const { return m_MouseDelta; }
    
    void SetMousePosition(const DirectX::XMFLOAT2& pos);
    void SetCursorVisible(bool visible);
    void SetCursorLocked(bool locked);

private:
    Input() = default;
    ~Input() = default;
    Input(const Input&) = delete;
    Input& operator=(const Input&) = delete;

    std::array<bool, 256> m_KeyStates{};
    std::array<bool, 256> m_PrevKeyStates{};
    std::array<bool, 3> m_MouseButtons{};
    DirectX::XMFLOAT2 m_MousePosition{};
    DirectX::XMFLOAT2 m_MouseDelta{};
    DirectX::XMFLOAT2 m_LastMousePosition{};
    bool m_CursorLocked = false;
};
