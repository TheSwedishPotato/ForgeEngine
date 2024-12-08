#pragma once
#include <d3d11.h>
#include <wrl/client.h>
#include <DirectXMath.h>

namespace Forge {

class Renderer {
public:
    Renderer() = default;
    ~Renderer() = default;

    bool Initialize(HWND hwnd, int width, int height);
    void Shutdown();
    
    void BeginFrame();
    void EndFrame();

private:
    bool CreateDeviceAndSwapChain(HWND hwnd, int width, int height);
    bool CreateRenderTargetView();
    bool CreateDepthStencilView(int width, int height);

    Microsoft::WRL::ComPtr<ID3D11Device> m_Device;
    Microsoft::WRL::ComPtr<ID3D11DeviceContext> m_DeviceContext;
    Microsoft::WRL::ComPtr<IDXGISwapChain> m_SwapChain;
    Microsoft::WRL::ComPtr<ID3D11RenderTargetView> m_RenderTargetView;
    Microsoft::WRL::ComPtr<ID3D11DepthStencilView> m_DepthStencilView;
    Microsoft::WRL::ComPtr<ID3D11Texture2D> m_DepthStencilBuffer;

    D3D11_VIEWPORT m_Viewport;
};
