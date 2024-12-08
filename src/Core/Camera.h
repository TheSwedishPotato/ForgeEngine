#pragma once
#include <DirectXMath.h>

namespace Forge {

class Camera {
public:
    Camera();

    void Update(float deltaTime);
    
    // Camera control
    void SetPosition(const DirectX::XMFLOAT3& position) { m_Position = position; }
    void SetRotation(const DirectX::XMFLOAT3& rotation) { m_Rotation = rotation; }
    void SetMovementSpeed(float speed) { m_MovementSpeed = speed; }
    void SetRotationSpeed(float speed) { m_RotationSpeed = speed; }

    // Camera properties
    const DirectX::XMFLOAT3& GetPosition() const { return m_Position; }
    const DirectX::XMFLOAT3& GetRotation() const { return m_Rotation; }
    DirectX::XMMATRIX GetViewMatrix() const;
    DirectX::XMMATRIX GetProjectionMatrix() const;

    // First person control
    void ProcessInput(float deltaTime);
    void ProcessMouseLook(float deltaX, float deltaY);

private:
    DirectX::XMFLOAT3 m_Position;
    DirectX::XMFLOAT3 m_Rotation;
    DirectX::XMFLOAT3 m_Forward;
    DirectX::XMFLOAT3 m_Right;
    DirectX::XMFLOAT3 m_Up;

    float m_MovementSpeed;
    float m_RotationSpeed;
    float m_Pitch;
    float m_Yaw;

    // Projection parameters
    float m_FovY;
    float m_AspectRatio;
    float m_NearZ;
    float m_FarZ;

    void UpdateVectors();
};
