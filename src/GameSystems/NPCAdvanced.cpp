#include "NPCAdvanced.h"
#include <algorithm>
#include <cmath>
#include <random>
#include <chrono>

namespace Forge {

// Memory Implementation
void AdvancedNPC::Memory::RecordEvent(const Event& event) {
    m_events.push_back(event);
    
    // Limit memory size
    if (m_events.size() > 100) {
        m_events.erase(m_events.begin());
    }
}

std::vector<AdvancedNPC::Memory::Event> 
AdvancedNPC::Memory::GetRecentEvents(float timeWindow) const {
    float currentTime = 0.0f; // TODO: Replace with actual game time
    std::vector<Event> recentEvents;
    
    for (const auto& event : m_events) {
        if (currentTime - event.timestamp <= timeWindow) {
            recentEvents.push_back(event);
        }
    }
    
    return recentEvents;
}

bool AdvancedNPC::Memory::HasTraumaticEvent() const {
    return std::any_of(m_events.begin(), m_events.end(), 
        [](const Event& event) { return event.isTraumatic; });
}

// Relationship Graph Implementation
void AdvancedNPC::RelationshipGraph::ModifyRelationship(
    const std::string& npcId, 
    RelationshipType type, 
    float value
) {
    auto& relationship = m_relationships[npcId];
    relationship.first = type;
    relationship.second += value;
    
    // Clamp relationship strength
    relationship.second = std::max(-100.0f, std::min(relationship.second, 100.0f));
}

RelationshipType AdvancedNPC::RelationshipGraph::GetRelationship(
    const std::string& npcId
) const {
    auto it = m_relationships.find(npcId);
    return it != m_relationships.end() ? it->second.first : RelationshipType::Stranger;
}

float AdvancedNPC::RelationshipGraph::GetRelationshipStrength(
    const std::string& npcId
) const {
    auto it = m_relationships.find(npcId);
    return it != m_relationships.end() ? it->second.second : 0.0f;
}

// Advanced NPC Implementation
AdvancedNPC::AdvancedNPC(const std::string& name, const NPCTraits& traits) :
    m_name(name),
    m_traits(traits),
    m_currentState(NPCState::Idle),
    m_timeOfDay(12.0f),
    m_hunger(0.0f),
    m_energy(1.0f),
    m_socialNeed(0.0f),
    m_workMotivation(0.5f) {}

void AdvancedNPC::Rest() {
    // Increase energy, decrease hunger
    m_energy = std::min(1.0f, m_energy + 0.1f);
    m_hunger = std::max(0.0f, m_hunger - 0.05f);
}

void AdvancedNPC::FindFood() {
    // Simulate food finding behavior
    RecordMemory("Searching for food");
}

void AdvancedNPC::Eat() {
    // Reduce hunger, slightly decrease energy
    m_hunger = 0.0f;
    m_energy = std::max(0.5f, m_energy - 0.1f);
    RecordMemory("Ate a meal");
}

void AdvancedNPC::FindWorkLocation() {
    // Simulate work location finding
    RecordMemory("Looking for work");
}

void AdvancedNPC::PerformWork() {
    // Decrease energy, increase work motivation
    m_energy = std::max(0.0f, m_energy - 0.2f);
    m_workMotivation = std::min(1.0f, m_workMotivation + 0.1f);
    RecordMemory("Completed work task");
}

void AdvancedNPC::FindSocialPartner() {
    // Simulate social interaction search
    RecordMemory("Seeking social interaction");
}

void AdvancedNPC::Interact() {
    // Reduce social need, slightly decrease energy
    m_socialNeed = std::max(0.0f, m_socialNeed - 0.2f);
    m_energy = std::max(0.5f, m_energy - 0.1f);
    RecordMemory("Engaged in social interaction");
}

void AdvancedNPC::Wander() {
    // Random wandering behavior
    RecordMemory("Wandering around");
}

void AdvancedNPC::RecordMemory(const std::string& event) {
    m_memories.push_back(event);
    
    // Limit memory size
    if (m_memories.size() > MAX_MEMORIES) {
        m_memories.erase(m_memories.begin());
    }
}

std::vector<std::string> AdvancedNPC::GetRecentMemories(int count) const {
    int start = std::max(0, static_cast<int>(m_memories.size()) - count);
    return std::vector<std::string>(
        m_memories.begin() + start, 
        m_memories.end()
    );
}

void AdvancedNPC::UpdateRelationship(const std::string& npcName, float change) {
    m_relationships[npcName] += change;
    
    // Clamp relationship strength
    m_relationships[npcName] = std::clamp(m_relationships[npcName], -1.0f, 1.0f);
}

float AdvancedNPC::GetRelationshipStrength(const std::string& npcName) const {
    auto it = m_relationships.find(npcName);
    return (it != m_relationships.end()) ? it->second : 0.0f;
}

void AdvancedNPC::UpdateNeeds(float deltaTime) {
    // Gradually increase needs
    m_hunger += 0.01f * deltaTime;
    m_socialNeed += 0.005f * deltaTime;
    m_workMotivation -= 0.002f * deltaTime;

    // Decrease energy over time
    m_energy -= 0.005f * deltaTime;

    // Clamp values
    m_hunger = std::clamp(m_hunger, 0.0f, 1.0f);
    m_energy = std::clamp(m_energy, 0.0f, 1.0f);
    m_socialNeed = std::clamp(m_socialNeed, 0.0f, 1.0f);
    m_workMotivation = std::clamp(m_workMotivation, 0.0f, 1.0f);
}

void AdvancedNPC::DecayRelationships(float deltaTime) {
    // Gradually decay relationship strengths
    for (auto& relationship : m_relationships) {
        relationship.second *= std::pow(0.99f, deltaTime);
    }
}

void AdvancedNPC::Update(float deltaTime) {
    UpdateNeeds(deltaTime);
    DecayRelationships(deltaTime);
}

void AdvancedNPC::ProcessInteraction(std::shared_ptr<Interaction> interaction) {
    auto result = interaction->Execute();
    
    // Modify emotional state based on interaction
    if (result.success) {
        // ModifyEmotion(result.emotional_response, result.relationship_change);
    }
}

EmotionType AdvancedNPC::DetermineEmotionalResponse(const Interaction& interaction) {
    // Complex emotion determination logic
    // This would consider NPC traits, current state, and interaction type
    return EmotionType::Neutral; // Placeholder
}

void AdvancedNPC::ModifyEmotion(EmotionType emotion, float intensity) {
    // Smooth transition between emotions
    // m_currentEmotion = emotion;
    // m_emotionalIntensity += intensity;
    
    // Clamp emotional intensity
    // m_emotionalIntensity = std::max(0.0f, std::min(m_emotionalIntensity, 1.0f));
}

void AdvancedNPC::SetBehaviorTree(std::function<void(AdvancedNPC&)> behaviorLogic) {
    // m_behaviorTree = behaviorLogic;
}

void AdvancedNPC::ExecuteBehaviorTree() {
    // if (m_behaviorTree) {
    //     m_behaviorTree(*this);
    // }
}

// World Interaction Manager Implementation
void WorldInteractionManager::RegisterObject(std::shared_ptr<InteractableObject> object) {
    m_interactableObjects.push_back(object);
}

void WorldInteractionManager::UpdateWorldInteractions(float deltaTime) {
    for (auto& object : m_interactableObjects) {
        object->UpdatePhysics(deltaTime);
    }
}

// Event Tracker Implementation
void EventTracker::RecordAction(const PlayerAction& action) {
    m_actions.push_back(action);
    
    // Limit action history
    if (m_actions.size() > 200) {
        m_actions.erase(m_actions.begin());
    }
}

std::vector<EventTracker::PlayerAction> 
EventTracker::GetRecentActions(float timeWindow) const {
    float currentTime = 0.0f; // TODO: Replace with actual game time
    std::vector<PlayerAction> recentActions;
    
    for (const auto& action : m_actions) {
        if (currentTime - action.timestamp <= timeWindow) {
            recentActions.push_back(action);
        }
    }
    
    return recentActions;
}

void EventTracker::GenerateConsequences() {
    // Analyze recent actions and generate world responses
    auto recentActions = GetRecentActions(24.0f); // 24-hour window
    
    // Example consequence generation logic
    for (const auto& action : recentActions) {
        // Placeholder for complex consequence generation
        if (action.actionType == "Violence") {
            // Trigger guard response, NPC fear, etc.
        }
    }
}

void NPCManager::AddNPC(std::unique_ptr<AdvancedNPC> npc) {
    if (npc) {
        m_npcs[npc->GetName()] = std::move(npc);
    }
}

void NPCManager::RemoveNPC(const std::string& name) {
    m_npcs.erase(name);
}

AdvancedNPC* NPCManager::GetNPC(const std::string& name) {
    auto it = m_npcs.find(name);
    return (it != m_npcs.end()) ? it->second.get() : nullptr;
}

std::vector<AdvancedNPC*> NPCManager::GetAllNPCs() {
    std::vector<AdvancedNPC*> npcs;
    for (auto& pair : m_npcs) {
        npcs.push_back(pair.second.get());
    }
    return npcs;
}

} // namespace Forge
