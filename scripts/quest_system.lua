-- Quest System for Forge Engine

-- Quest Class
Quest = {}
Quest.__index = Quest

function Quest.new(id, title, description, rewards)
    local self = setmetatable({}, Quest)
    self.id = id
    self.title = title
    self.description = description
    self.rewards = rewards or {}
    self.status = "inactive"
    self.objectives = {}
    return self
end

function Quest:addObjective(description, condition)
    table.insert(self.objectives, {
        description = description,
        condition = condition,
        completed = false
    })
end

function Quest:start()
    self.status = "active"
    print("Quest started: " .. self.title)
end

function Quest:complete()
    if self.status == "active" then
        self.status = "completed"
        print("Quest completed: " .. self.title)
        self:giveRewards()
    end
end

function Quest:giveRewards()
    for _, reward in ipairs(self.rewards) do
        -- Simulate reward distribution
        print("Reward received: " .. reward)
    end
end

-- Quest Manager
QuestManager = {
    activeQuests = {},
    completedQuests = {}
}

function QuestManager:createQuest(id, title, description, rewards)
    local quest = Quest.new(id, title, description, rewards)
    self.activeQuests[id] = quest
    return quest
end

function QuestManager:startQuest(id)
    local quest = self.activeQuests[id]
    if quest then
        quest:start()
    end
end

function QuestManager:completeQuest(id)
    local quest = self.activeQuests[id]
    if quest then
        quest:complete()
        self.completedQuests[id] = quest
        self.activeQuests[id] = nil
    end
end

-- Example Quest Creation
local huntQuest = QuestManager:createQuest(
    "hunt_wolves", 
    "Wolf Hunting", 
    "Hunt 5 wolves in the forest", 
    {"Gold", "Hunter's Bow"}
)

huntQuest:addObjective(
    "Kill 5 wolves", 
    function() 
        return GetPlayerWolfKills() >= 5 
    end
)

-- Simulate quest progression
function UpdateQuests()
    for id, quest in pairs(QuestManager.activeQuests) do
        for _, objective in ipairs(quest.objectives) do
            if objective.condition() and not objective.completed then
                objective.completed = true
                print("Objective completed: " .. objective.description)
            end
        end
        
        -- Check if all objectives are completed
        local allCompleted = true
        for _, objective in ipairs(quest.objectives) do
            if not objective.completed then
                allCompleted = false
                break
            end
        end
        
        if allCompleted then
            QuestManager:completeQuest(id)
        end
    end
end

-- Placeholder function to be implemented in C++
function GetPlayerWolfKills()
    -- This would be bound to a C++ function in the actual game
    return 5
end

-- Return the QuestManager for global access
return QuestManager
