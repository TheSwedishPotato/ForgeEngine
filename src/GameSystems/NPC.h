#pragma once
#include <string>
#include <vector>
#include <memory>
#include <DirectXMath.h>

namespace Forge {
    enum class NPCProfession {
        Blacksmith,
        Farmer,
        Baker,
        Merchant,
        Priest,
        Noble
    };

    enum class NPCState {
        Idle,
        Working,
        Walking,
        Sleeping,
        Eating
    };

    struct DailySchedule {
        float wakeUpTime;
        float sleepTime;
        std::vector<std::pair<float, NPCState>> activities;
    };

    class NPC {
    public:
        NPC(const std::string& name, NPCProfession profession);

        void Update(float gameTime);
        void SetPosition(const DirectX::XMFLOAT3& position);
        void SetSchedule(const DailySchedule& schedule);

        std::string GetName() const { return m_Name; }
        NPCProfession GetProfession() const { return m_Profession; }
        NPCState GetCurrentState() const { return m_CurrentState; }
        DirectX::XMFLOAT3 GetPosition() const { return m_Position; }

    private:
        std::string m_Name;
        NPCProfession m_Profession;
        NPCState m_CurrentState;
        DirectX::XMFLOAT3 m_Position;
        DailySchedule m_Schedule;

        void UpdateState(float gameTime);
        void PerformActivity(NPCState activity);
    };

    class NPCManager {
    public:
        void AddNPC(std::unique_ptr<NPC> npc);
        void UpdateAllNPCs(float gameTime);
        NPC* GetNPCByName(const std::string& name);

    private:
        std::vector<std::unique_ptr<NPC>> m_NPCs;
    };
}
