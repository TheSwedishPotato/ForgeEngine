#include "PlayerSystem.h"
#include <algorithm>
#include <stdexcept>

namespace Forge {

void Inventory::AddItem(const Item& item) {
    if (GetTotalWeight() + item.weight <= m_maxWeight) {
        m_items.push_back(item);
    } else {
        throw std::runtime_error("Inventory is full. Cannot add item.");
    }
}

void Inventory::RemoveItem(const std::string& itemName) {
    auto it = std::remove_if(m_items.begin(), m_items.end(), 
        [&itemName](const Item& item) { return item.name == itemName; });
    
    m_items.erase(it, m_items.end());
}

bool Inventory::HasItem(const std::string& itemName) const {
    return std::any_of(m_items.begin(), m_items.end(), 
        [&itemName](const Item& item) { return item.name == itemName; });
}

std::vector<Item> Inventory::GetItemsByType(ItemType type) const {
    std::vector<Item> filteredItems;
    std::copy_if(m_items.begin(), m_items.end(), std::back_inserter(filteredItems),
        [type](const Item& item) { return item.type == type; });
    
    return filteredItems;
}

float Inventory::GetTotalWeight() const {
    return std::accumulate(m_items.begin(), m_items.end(), 0.0f,
        [](float total, const Item& item) { return total + item.weight; });
}

void PlayerSkillSystem::LearnSkill(SkillType skill) {
    if (m_skills.find(skill) == m_skills.end()) {
        m_skills[skill] = {skill, 0.0f, 1};
    }
}

void PlayerSkillSystem::ImproveSkill(SkillType skill, float experience) {
    auto it = m_skills.find(skill);
    if (it != m_skills.end()) {
        it->second.AddExperience(experience);
    } else {
        LearnSkill(skill);
        m_skills[skill].AddExperience(experience);
    }
}

int PlayerSkillSystem::GetSkillLevel(SkillType skill) const {
    auto it = m_skills.find(skill);
    return it != m_skills.end() ? it->second.level : 0;
}

float PlayerSkillSystem::GetSkillExperience(SkillType skill) const {
    auto it = m_skills.find(skill);
    return it != m_skills.end() ? it->second.experience : 0.0f;
}

void CraftingSystem::AddRecipe(const Recipe& recipe) {
    m_recipes.push_back(recipe);
}

bool CraftingSystem::CanCraft(const Recipe& recipe, const Inventory& playerInventory, int playerSkillLevel) {
    // Check skill requirement
    if (playerSkillLevel < recipe.skillLevelRequired) {
        return false;
    }

    // Check required items
    for (const auto& requiredItem : recipe.requiredItems) {
        int count = std::count_if(playerInventory.GetItemsByType(ItemType::Miscellaneous).begin(), 
                                  playerInventory.GetItemsByType(ItemType::Miscellaneous).end(),
                                  [&requiredItem](const Item& item) { 
                                      return item.name == requiredItem.first; 
                                  });
        
        if (count < requiredItem.second) {
            return false;
        }
    }

    return true;
}

Item CraftingSystem::CraftItem(const Recipe& recipe) {
    return recipe.resultItem;
}

void DialogueSystem::InitiateDialogue(const std::string& npcName) {
    auto it = m_dialogueDatabase.find(npcName);
    if (it != m_dialogueDatabase.end()) {
        m_currentDialogue = it->second;
    } else {
        throw std::runtime_error("No dialogue found for NPC: " + npcName);
    }
}

void DialogueSystem::AddDialogueOption(const DialogueOption& option) {
    m_currentDialogue.options.push_back(option);
}

void DialogueSystem::SelectDialogueOption(int optionIndex) {
    if (optionIndex >= 0 && optionIndex < m_currentDialogue.options.size()) {
        auto& selectedOption = m_currentDialogue.options[optionIndex];
        
        // Execute the consequence of the dialogue option
        if (selectedOption.consequence) {
            selectedOption.consequence();
        }
    }
}

void PlayerProgressionSystem::SetProfession(Profession profession) {
    m_currentProfession = profession;
}

void PlayerProgressionSystem::AddReputation(float amount) {
    m_reputation += amount;
    
    // Clamp reputation
    m_reputation = std::max(-100.0f, std::min(m_reputation, 100.0f));
}

void PlayerInteractionManager::InteractWithNPC(const std::string& npcName) {
    // Placeholder for NPC interaction logic
}

void PlayerInteractionManager::InteractWithObject(const std::string& objectName) {
    // Placeholder for object interaction logic
}

bool PlayerInteractionManager::CanInteract(const std::string& target) const {
    // Placeholder for interaction restrictions
    return true;
}

} // namespace Forge
