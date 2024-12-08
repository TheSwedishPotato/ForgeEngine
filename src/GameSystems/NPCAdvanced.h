#pragma once
#include <string>
#include <vector>
#include <memory>
#include <unordered_map>
#include "NPCAISystem.h"

namespace Forge {

    // Expanded Emotion System
    enum class EmotionType {
        Neutral,
        Happy,
        Angry,
        Sad,
        Scared,
        Surprised
    };

    // Relationship Types
    enum class RelationshipType {
        Stranger,
        Acquaintance,
        Friend,
        Enemy,
        Family
    };

    // Advanced NPC Traits
    struct NPCTraits {
        int intelligence;
        int sociability;
        int strength;
        int creativity;
    };

    // Advanced Interaction System
    class Interaction {
    public:
        enum class Type {
            Dialogue,
            Trade,
            Threat,
            Help,
            Ignore
        };

        struct Result {
            bool success;
            EmotionType emotional_response;
            float relationship_change;
        };

        virtual Result Execute() = 0;
    };

    // Advanced NPC Class
    class AdvancedNPC {
    public:
        AdvancedNPC(const std::string& name, const NPCTraits& traits);

        // Core NPC Management
        std::string GetName() const { return m_name; }
        NPCTraits GetTraits() const { return m_traits; }

        // State and Personality Management
        void SetCurrentState(NPCState state) { m_currentState = state; }
        NPCState GetCurrentState() const { return m_currentState; }

        // Needs and Motivation Tracking
        float GetTimeOfDay() const { return m_timeOfDay; }
        float GetHunger() const { return m_hunger; }
        float GetEnergy() const { return m_energy; }
        float GetSocialNeed() const { return m_socialNeed; }
        float GetWorkMotivation() const { return m_workMotivation; }

        // AI Behavior Methods
        void Rest();
        void FindFood();
        void Eat();
        void FindWorkLocation();
        void PerformWork();
        void FindSocialPartner();
        void Interact();
        void Wander();

        // Memory and Learning System
        void RecordMemory(const std::string& event);
        std::vector<std::string> GetRecentMemories(int count = 5) const;

        // Relationship Management
        void UpdateRelationship(const std::string& npcName, float change);
        float GetRelationshipStrength(const std::string& npcName) const;

    private:
        // Core NPC Attributes
        std::string m_name;
        NPCTraits m_traits;
        NPCState m_currentState;

        // Needs and Motivation Variables
        float m_timeOfDay;
        float m_hunger;
        float m_energy;
        float m_socialNeed;
        float m_workMotivation;

        // Memory System
        std::vector<std::string> m_memories;
        static const int MAX_MEMORIES = 20;

        // Relationship Tracking
        std::unordered_map<std::string, float> m_relationships;

        // Internal Update Methods
        void UpdateNeeds(float deltaTime);
        void DecayRelationships(float deltaTime);
    };

    // World Interaction System
    class WorldInteractionManager {
    public:
        class InteractableObject {
        public:
            virtual bool Interact(AdvancedNPC& npc) = 0;
            virtual void UpdatePhysics(float deltaTime) = 0;
        };

        void RegisterObject(std::shared_ptr<InteractableObject> object);
        void UpdateWorldInteractions(float deltaTime);

    private:
        std::vector<std::shared_ptr<InteractableObject>> m_interactableObjects;
    };

    // Event System for Tracking Player Actions
    class EventTracker {
    public:
        struct PlayerAction {
            std::string actionType;
            DirectX::XMFLOAT3 location;
            float timestamp;
            std::string details;
        };

        void RecordAction(const PlayerAction& action);
        std::vector<PlayerAction> GetRecentActions(float timeWindow) const;
        void GenerateConsequences();

    private:
        std::vector<PlayerAction> m_actions;
    };

    class NPCManager {
    public:
        void AddNPC(std::unique_ptr<AdvancedNPC> npc);
        void RemoveNPC(const std::string& name);
        AdvancedNPC* GetNPC(const std::string& name);
        std::vector<AdvancedNPC*> GetAllNPCs();

    private:
        std::unordered_map<std::string, std::unique_ptr<AdvancedNPC>> m_npcs;
        NPCAISystem m_aiSystem;
    };

} // namespace Forge
