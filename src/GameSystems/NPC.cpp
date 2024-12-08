#include "NPC.h"
#include <algorithm>
#include <cmath>

namespace Forge {

NPC::NPC(const std::string& name, NPCProfession profession)
    : m_Name(name)
    , m_Profession(profession)
    , m_CurrentState(NPCState::Idle)
    , m_Position{0.0f, 0.0f, 0.0f}
{
    // Default schedule (can be customized later)
    m_Schedule = {
        6.0f,   // Wake up at 6 AM
        22.0f,  // Sleep at 10 PM
        {
            {6.0f, NPCState::Eating},     // Breakfast
            {8.0f, NPCState::Working},    // Work starts
            {12.0f, NPCState::Eating},    // Lunch
            {13.0f, NPCState::Working},   // Work continues
            {18.0f, NPCState::Idle}       // Free time
        }
    };
}

void NPC::Update(float gameTime) {
    UpdateState(gameTime);
}

void NPC::SetPosition(const DirectX::XMFLOAT3& position) {
    m_Position = position;
}

void NPC::SetSchedule(const DailySchedule& schedule) {
    m_Schedule = schedule;
}

void NPC::UpdateState(float gameTime) {
    // Normalize game time to 24-hour cycle
    float normalizedTime = std::fmod(gameTime, 24.0f);

    // Check if it's time to sleep or wake up
    if (normalizedTime >= m_Schedule.sleepTime || normalizedTime < m_Schedule.wakeUpTime) {
        m_CurrentState = NPCState::Sleeping;
        return;
    }

    // Find current activity based on schedule
    for (const auto& activity : m_Schedule.activities) {
        if (normalizedTime >= activity.first) {
            m_CurrentState = activity.second;
        }
    }

    PerformActivity(m_CurrentState);
}

void NPC::PerformActivity(NPCState activity) {
    // Placeholder for activity-specific behaviors
    switch (activity) {
        case NPCState::Working:
            // Profession-specific work logic
            break;
        case NPCState::Walking:
            // Movement logic
            break;
        case NPCState::Eating:
            // Eating animation or logic
            break;
        default:
            break;
    }
}

void NPCManager::AddNPC(std::unique_ptr<NPC> npc) {
    m_NPCs.push_back(std::move(npc));
}

void NPCManager::UpdateAllNPCs(float gameTime) {
    for (auto& npc : m_NPCs) {
        npc->Update(gameTime);
    }
}

NPC* NPCManager::GetNPCByName(const std::string& name) {
    auto it = std::find_if(m_NPCs.begin(), m_NPCs.end(), 
        [&name](const std::unique_ptr<NPC>& npc) { 
            return npc->GetName() == name; 
        });
    
    return it != m_NPCs.end() ? it->get() : nullptr;
}

}
