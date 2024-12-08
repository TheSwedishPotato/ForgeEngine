-- NPC Interaction System

-- NPC Class
NPC = {}
NPC.__index = NPC

function NPC.new(name, role, dialogue)
    local self = setmetatable({}, NPC)
    self.name = name
    self.role = role
    self.dialogue = dialogue or {}
    self.reputation = 50  -- Neutral starting reputation
    self.mood = "neutral"
    return self
end

function NPC:speak(playerReputation)
    -- Select dialogue based on player's reputation
    local selectedDialogue = "Hello there."
    
    if playerReputation > 75 then
        selectedDialogue = self.dialogue.friendly or "You're a good friend!"
        self.mood = "friendly"
    elseif playerReputation < 25 then
        selectedDialogue = self.dialogue.hostile or "Stay away from me!"
        self.mood = "hostile"
    else
        selectedDialogue = self.dialogue.neutral or "What do you want?"
        self.mood = "neutral"
    end
    
    print(self.name .. " says: " .. selectedDialogue)
    return selectedDialogue
end

function NPC:modifyReputation(amount)
    self.reputation = math.max(0, math.min(100, self.reputation + amount))
    return self.reputation
end

-- NPC Manager
NPCManager = {
    npcs = {}
}

function NPCManager:createNPC(name, role, dialogue)
    local npc = NPC.new(name, role, dialogue)
    self.npcs[name] = npc
    return npc
end

function NPCManager:getNPC(name)
    return self.npcs[name]
end

-- Create some example NPCs
local blacksmith = NPCManager:createNPC("Hans", "Blacksmith", {
    friendly = "Ah, my trusted customer! What can I craft for you today?",
    neutral = "Looking for some tools?",
    hostile = "I don't serve troublemakers."
})

local farmer = NPCManager:createNPC("Erik", "Farmer", {
    friendly = "Welcome to my farm! Need some fresh produce?",
    neutral = "Another day of hard work...",
    hostile = "Get off my land!"
})

-- Interaction functions to be bound to C++
function InteractWithNPC(npcName, playerReputation)
    local npc = NPCManager:getNPC(npcName)
    if npc then
        return npc:speak(playerReputation)
    end
    return "NPC not found"
end

function ModifyNPCReputation(npcName, reputationChange)
    local npc = NPCManager:getNPC(npcName)
    if npc then
        return npc:modifyReputation(reputationChange)
    end
    return 50  -- Default reputation
end

-- Return the NPCManager for global access
return NPCManager
