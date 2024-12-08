#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <DirectXMath.h>

namespace Forge {
    // Skill Types
    enum class SkillType {
        Farming,
        Blacksmithing,
        Hunting,
        Diplomacy,
        Combat,
        Crafting,
        Survival
    };

    // Profession Types
    enum class Profession {
        Peasant,
        Blacksmith,
        Merchant,
        Soldier,
        Craftsman,
        Noble
    };

    // Item Rarity
    enum class ItemRarity {
        Common,
        Uncommon,
        Rare,
        Epic,
        Legendary
    };

    // Item Types
    enum class ItemType {
        Weapon,
        Armor,
        Tool,
        Consumable,
        Quest,
        Miscellaneous
    };

    // Skill Representation
    struct Skill {
        SkillType type;
        float experience;
        int level;
        
        void AddExperience(float exp) {
            experience += exp;
            // Simple leveling system
            if (experience >= 100 * level) {
                level++;
                experience = 0;
            }
        }
    };

    // Item Structure
    struct Item {
        std::string name;
        std::string description;
        ItemType type;
        ItemRarity rarity;
        float weight;
        int value;
        
        // Optional item-specific properties
        struct Properties {
            float damage;
            float defense;
            std::vector<std::string> effects;
        } properties;
    };

    class Inventory {
    public:
        void AddItem(const Item& item);
        void RemoveItem(const std::string& itemName);
        bool HasItem(const std::string& itemName) const;
        std::vector<Item> GetItemsByType(ItemType type) const;
        float GetTotalWeight() const;

    private:
        std::vector<Item> m_items;
        float m_maxWeight = 50.0f;
    };

    class PlayerSkillSystem {
    public:
        void LearnSkill(SkillType skill);
        void ImproveSkill(SkillType skill, float experience);
        int GetSkillLevel(SkillType skill) const;
        float GetSkillExperience(SkillType skill) const;

    private:
        std::unordered_map<SkillType, Skill> m_skills;
    };

    class CraftingSystem {
    public:
        struct Recipe {
            std::string name;
            std::vector<std::pair<std::string, int>> requiredItems;
            Item resultItem;
            SkillType requiredSkill;
            int skillLevelRequired;
        };

        void AddRecipe(const Recipe& recipe);
        bool CanCraft(const Recipe& recipe, const Inventory& playerInventory, int playerSkillLevel);
        Item CraftItem(const Recipe& recipe);

    private:
        std::vector<Recipe> m_recipes;
    };

    class DialogueSystem {
    public:
        struct DialogueOption {
            std::string text;
            std::function<void()> consequence;
            int diplomacyRequirement;
        };

        struct Dialogue {
            std::string npcName;
            std::string initialGreeting;
            std::vector<DialogueOption> options;
        };

        void InitiateDialogue(const std::string& npcName);
        void AddDialogueOption(const DialogueOption& option);
        void SelectDialogueOption(int optionIndex);

    private:
        Dialogue m_currentDialogue;
        std::unordered_map<std::string, Dialogue> m_dialogueDatabase;
    };

    class PlayerProgressionSystem {
    public:
        void SetProfession(Profession profession);
        Profession GetCurrentProfession() const { return m_currentProfession; }
        
        void AddReputation(float amount);
        float GetReputation() const { return m_reputation; }

    private:
        Profession m_currentProfession = Profession::Peasant;
        float m_reputation = 0.0f;
    };

    class PlayerInteractionManager {
    public:
        void InteractWithNPC(const std::string& npcName);
        void InteractWithObject(const std::string& objectName);
        
        bool CanInteract(const std::string& target) const;

    private:
        // Interaction logic and restrictions
    };
}
