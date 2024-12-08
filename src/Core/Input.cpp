#include "Input.h"

namespace Forge {

void Input::Update() {
    // Store previous key states
    m_PrevKeyStates = m_KeyStates;

    // Update keyboard states
    for (int i = 0; i < 256; i++) {
        m_KeyStates[i] = (GetAsyncKeyState(i) & 0x8000) != 0;
    }

    // Update mouse buttons
    m_MouseButtons[0] = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
    m_MouseButtons[1] = (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
    m_MouseButtons[2] = (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;

    // Update mouse position
    POINT mousePos;
    GetCursorPos(&mousePos);

    m_LastMousePosition = m_MousePosition;
    m_MousePosition = DirectX::XMFLOAT2(static_cast<float>(mousePos.x), static_cast<float>(mousePos.y));
    
    // Calculate mouse delta
    if (m_CursorLocked) {
        m_MouseDelta.x = m_MousePosition.x - m_LastMousePosition.x;
        m_MouseDelta.y = m_MousePosition.y - m_LastMousePosition.y;
    } else {
        m_MouseDelta = DirectX::XMFLOAT2(0.0f, 0.0f);
    }
}

void Input::SetMousePosition(const DirectX::XMFLOAT2& pos) {
    SetCursorPos(static_cast<int>(pos.x), static_cast<int>(pos.y));
    m_MousePosition = pos;
    m_LastMousePosition = pos;
    m_MouseDelta = DirectX::XMFLOAT2(0.0f, 0.0f);
}

void Input::SetCursorVisible(bool visible) {
    ShowCursor(visible);
}

void Input::SetCursorLocked(bool locked) {
    m_CursorLocked = locked;
    if (locked) {
        RECT clipRect;
        GetWindowRect(GetActiveWindow(), &clipRect);
        ClipCursor(&clipRect);
    } else {
        ClipCursor(nullptr);
    }
}
