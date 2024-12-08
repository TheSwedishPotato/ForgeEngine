#include "Camera.h"
#include "Input.h"
#include <algorithm>

namespace Forge {

Camera::Camera()
    : m_Position(0.0f, 0.0f, 0.0f)
    , m_Rotation(0.0f, 0.0f, 0.0f)
    , m_Forward(0.0f, 0.0f, 1.0f)
    , m_Right(1.0f, 0.0f, 0.0f)
    , m_Up(0.0f, 1.0f, 0.0f)
    , m_MovementSpeed(5.0f)
    , m_RotationSpeed(0.1f)
    , m_Pitch(0.0f)
    , m_Yaw(0.0f)
    , m_FovY(DirectX::XM_PIDIV4)
    , m_AspectRatio(16.0f/9.0f)
    , m_NearZ(0.1f)
    , m_FarZ(1000.0f)
{
    UpdateVectors();
}

void Camera::Update(float deltaTime) {
    ProcessInput(deltaTime);
    
    auto& input = Input::Get();
    DirectX::XMFLOAT2 mouseDelta = input.GetMouseDelta();
    ProcessMouseLook(mouseDelta.x, mouseDelta.y);
    
    UpdateVectors();
}

void Camera::ProcessInput(float deltaTime) {
    auto& input = Input::Get();
    float moveSpeed = m_MovementSpeed * deltaTime;

    // Forward/Backward
    if (input.IsKeyDown('W')) {
        m_Position.x += m_Forward.x * moveSpeed;
        m_Position.y += m_Forward.y * moveSpeed;
        m_Position.z += m_Forward.z * moveSpeed;
    }
    if (input.IsKeyDown('S')) {
        m_Position.x -= m_Forward.x * moveSpeed;
        m_Position.y -= m_Forward.y * moveSpeed;
        m_Position.z -= m_Forward.z * moveSpeed;
    }

    // Strafe Left/Right
    if (input.IsKeyDown('A')) {
        m_Position.x -= m_Right.x * moveSpeed;
        m_Position.y -= m_Right.y * moveSpeed;
        m_Position.z -= m_Right.z * moveSpeed;
    }
    if (input.IsKeyDown('D')) {
        m_Position.x += m_Right.x * moveSpeed;
        m_Position.y += m_Right.y * moveSpeed;
        m_Position.z += m_Right.z * moveSpeed;
    }
}

void Camera::ProcessMouseLook(float deltaX, float deltaY) {
    m_Yaw += deltaX * m_RotationSpeed;
    m_Pitch += deltaY * m_RotationSpeed;

    // Clamp pitch to avoid camera flipping
    m_Pitch = std::clamp(m_Pitch, -DirectX::XM_PIDIV2 + 0.1f, DirectX::XM_PIDIV2 - 0.1f);

    UpdateVectors();
}

void Camera::UpdateVectors() {
    // Calculate new forward vector
    DirectX::XMMATRIX rotationMatrix = DirectX::XMMatrixRotationRollPitchYaw(m_Pitch, m_Yaw, 0.0f);
    DirectX::XMVECTOR forwardVec = DirectX::XMVector3TransformCoord(DirectX::XMVectorSet(0.0f, 0.0f, 1.0f, 0.0f), rotationMatrix);
    DirectX::XMVECTOR rightVec = DirectX::XMVector3Cross(DirectX::XMVectorSet(0.0f, 1.0f, 0.0f, 0.0f), forwardVec);
    DirectX::XMVECTOR upVec = DirectX::XMVector3Cross(forwardVec, rightVec);

    // Store normalized vectors
    XMStoreFloat3(&m_Forward, DirectX::XMVector3Normalize(forwardVec));
    XMStoreFloat3(&m_Right, DirectX::XMVector3Normalize(rightVec));
    XMStoreFloat3(&m_Up, DirectX::XMVector3Normalize(upVec));
}

DirectX::XMMATRIX Camera::GetViewMatrix() const {
    DirectX::XMVECTOR pos = DirectX::XMLoadFloat3(&m_Position);
    DirectX::XMVECTOR forward = DirectX::XMLoadFloat3(&m_Forward);
    DirectX::XMVECTOR up = DirectX::XMLoadFloat3(&m_Up);
    
    return DirectX::XMMatrixLookToLH(pos, forward, up);
}

DirectX::XMMATRIX Camera::GetProjectionMatrix() const {
    return DirectX::XMMatrixPerspectiveFovLH(m_FovY, m_AspectRatio, m_NearZ, m_FarZ);
}
