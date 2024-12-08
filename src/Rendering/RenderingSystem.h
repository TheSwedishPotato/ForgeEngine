#pragma once
#include <SFML/Graphics.hpp>
#include <memory>
#include <unordered_map>
#include "../Core/ThreadPool.h"
#include "../GameSystems/EnvironmentalSystem.h"

namespace Forge {
namespace Rendering {

class RenderingSystem {
public:
    RenderingSystem(
        std::shared_ptr<ForgeEngine::Core::ThreadPool> threadPool,
        std::shared_ptr<Forge::EnvironmentalSystem> envSystem
    ) : m_threadPool(threadPool), m_environmentalSystem(envSystem) {
        initializeWindow();
        loadAssets();
    }

    void update(float deltaTime) {
        PROFILE_SCOPE("RenderingSystem_Update");
        
        if (!m_window.isOpen()) return;

        handleEvents();
        updateCamera(deltaTime);
        render();
    }

    bool isWindowOpen() const {
        return m_window.isOpen();
    }

    void setViewCenter(const sf::Vector2f& center) {
        m_view.setCenter(center);
        m_window.setView(m_view);
    }

    void zoom(float factor) {
        m_view.zoom(factor);
        m_window.setView(m_view);
    }

private:
    std::shared_ptr<ForgeEngine::Core::ThreadPool> m_threadPool;
    std::shared_ptr<Forge::EnvironmentalSystem> m_environmentalSystem;
    
    sf::RenderWindow m_window;
    sf::View m_view;
    
    // Asset management
    std::unordered_map<std::string, sf::Texture> m_textures;
    std::unordered_map<std::string, sf::Font> m_fonts;
    
    // UI elements
    sf::RectangleShape m_minimapBorder;
    sf::View m_minimapView;
    
    // Camera controls
    sf::Vector2f m_cameraVelocity;
    float m_zoomLevel = 1.0f;
    
    void initializeWindow() {
        sf::VideoMode desktop = sf::VideoMode::getDesktopMode();
        m_window.create(
            sf::VideoMode(1920, 1080),
            "Forge Engine - Medieval Village Simulation",
            sf::Style::Default
        );
        m_window.setVerticalSyncEnabled(true);
        
        // Initialize views
        m_view = m_window.getDefaultView();
        setupMinimap();
    }

    void loadAssets() {
        // Load textures
        const std::string textureDir = "assets/textures/";
        std::vector<std::string> textureNames = {
            "terrain", "buildings", "villagers", "resources",
            "weather", "ui_elements"
        };

        for (const auto& name : textureNames) {
            sf::Texture texture;
            if (texture.loadFromFile(textureDir + name + ".png")) {
                m_textures[name] = texture;
            }
        }

        // Load fonts
        sf::Font medievalFont;
        if (medievalFont.loadFromFile("assets/fonts/medieval.ttf")) {
            m_fonts["medieval"] = medievalFont;
        }
    }

    void handleEvents() {
        sf::Event event;
        while (m_window.pollEvent(event)) {
            switch (event.type) {
                case sf::Event::Closed:
                    m_window.close();
                    break;

                case sf::Event::KeyPressed:
                    handleKeyPress(event.key.code);
                    break;

                case sf::Event::MouseWheelScrolled:
                    handleZoom(event.mouseWheelScroll.delta);
                    break;

                case sf::Event::MouseButtonPressed:
                    handleMouseClick(event.mouseButton);
                    break;
            }
        }
    }

    void handleKeyPress(sf::Keyboard::Key key) {
        switch (key) {
            case sf::Keyboard::W:
                m_cameraVelocity.y = -500.0f;
                break;
            case sf::Keyboard::S:
                m_cameraVelocity.y = 500.0f;
                break;
            case sf::Keyboard::A:
                m_cameraVelocity.x = -500.0f;
                break;
            case sf::Keyboard::D:
                m_cameraVelocity.x = 500.0f;
                break;
            case sf::Keyboard::Escape:
                m_window.close();
                break;
        }
    }

    void handleZoom(float delta) {
        float zoomFactor = (delta > 0) ? 0.9f : 1.1f;
        m_zoomLevel *= zoomFactor;
        m_zoomLevel = std::clamp(m_zoomLevel, 0.25f, 4.0f);
        m_view.zoom(zoomFactor);
        m_window.setView(m_view);
    }

    void handleMouseClick(const sf::Event::MouseButtonEvent& mouseButton) {
        sf::Vector2i mousePos(mouseButton.x, mouseButton.y);
        sf::Vector2f worldPos = m_window.mapPixelToCoords(mousePos);

        // Handle UI interactions
        if (isUIElement(worldPos)) {
            handleUIClick(worldPos);
        }
        // Handle world interactions
        else {
            handleWorldClick(worldPos);
        }
    }

    void updateCamera(float deltaTime) {
        sf::Vector2f movement = m_cameraVelocity * deltaTime;
        m_view.move(movement);
        m_window.setView(m_view);
        
        // Decay camera velocity
        m_cameraVelocity *= 0.9f;
    }

    void render() {
        m_window.clear(sf::Color(48, 48, 48));

        // Render world
        renderTerrain();
        renderVillages();
        renderWeather();
        
        // Render UI
        renderUI();
        
        m_window.display();
    }

    void renderTerrain() {
        // TODO: Implement terrain rendering based on environmental system
    }

    void renderVillages() {
        // TODO: Implement village rendering
    }

    void renderWeather() {
        const auto& climate = m_environmentalSystem->getCurrentClimate();
        
        // Render weather effects based on current climate
        switch (climate.currentWeather) {
            case Climate::WeatherType::Rainy:
                renderRain();
                break;
            case Climate::WeatherType::Snowy:
                renderSnow();
                break;
            case Climate::WeatherType::Stormy:
                renderStorm();
                break;
        }
    }

    void renderUI() {
        // Save current view
        sf::View currentView = m_window.getView();
        
        // Switch to UI view
        m_window.setView(m_window.getDefaultView());
        
        // Render minimap
        renderMinimap();
        
        // Render UI elements
        renderResourceUI();
        renderTimeUI();
        renderControlPanel();
        
        // Restore previous view
        m_window.setView(currentView);
    }

    void setupMinimap() {
        float minimapSize = 200.f;
        sf::Vector2f windowSize = m_window.getDefaultView().getSize();
        
        m_minimapView.setViewport(sf::FloatRect(
            0.99f - minimapSize/windowSize.x,  // Right aligned
            0.01f,                            // Top aligned
            minimapSize/windowSize.x,
            minimapSize/windowSize.y
        ));
        
        m_minimapBorder.setSize(sf::Vector2f(minimapSize + 4, minimapSize + 4));
        m_minimapBorder.setPosition(windowSize.x - minimapSize - 12, 8);
        m_minimapBorder.setFillColor(sf::Color::Transparent);
        m_minimapBorder.setOutlineThickness(2.f);
        m_minimapBorder.setOutlineColor(sf::Color(200, 200, 200));
    }

    void renderMinimap() {
        // Save main view
        sf::View mainView = m_window.getView();
        
        // Set minimap view
        m_window.setView(m_minimapView);
        
        // Draw minimap border
        m_window.draw(m_minimapBorder);
        
        // TODO: Draw minimap contents
        
        // Restore main view
        m_window.setView(mainView);
    }

    void renderResourceUI() {
        // TODO: Implement resource UI
    }

    void renderTimeUI() {
        // TODO: Implement time UI
    }

    void renderControlPanel() {
        // TODO: Implement control panel
    }

    void renderRain() {
        // TODO: Implement rain particle system
    }

    void renderSnow() {
        // TODO: Implement snow particle system
    }

    void renderStorm() {
        // TODO: Implement storm effects
    }

    bool isUIElement(const sf::Vector2f& position) {
        // TODO: Implement UI element detection
        return false;
    }

    void handleUIClick(const sf::Vector2f& position) {
        // TODO: Implement UI click handling
    }

    void handleWorldClick(const sf::Vector2f& position) {
        // TODO: Implement world interaction
    }
};

} // namespace Rendering
} // namespace Forge
