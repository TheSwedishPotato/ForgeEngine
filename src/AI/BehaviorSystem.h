#pragma once
#include <vector>
#include <memory>
#include <string>
#include <tensorflow/core/public/session.h>
#include "PersonalitySystem.h"

namespace ForgeEngine {
namespace AI {

enum class ActionType {
    TRADE,
    SOCIALIZE,
    WORK,
    REST,
    PRAY,
    STUDY,
    FIGHT,
    NEGOTIATE
};

struct BehaviorContext {
    float timeOfDay;        // 0.0 to 24.0
    float energy;           // 0.0 to 1.0
    float health;           // 0.0 to 1.0
    float wealth;           // 0.0 to 1.0
    float socialStatus;     // 0.0 to 1.0
    std::vector<float> relationships;  // Relationship values with other NPCs
};

class BehaviorSystem {
public:
    BehaviorSystem() {
        tensorflow::SessionOptions options;
        session = std::unique_ptr<tensorflow::Session>(tensorflow::NewSession(options));
        loadModel();
    }

    ActionType predictAction(const PersonalityProfile& personality, const BehaviorContext& context) {
        // Convert personality and context to tensor input
        std::vector<float> input = prepareInput(personality, context);
        
        // Run prediction
        std::vector<tensorflow::Tensor> outputs;
        tensorflow::Status status = session->Run(
            {{"input", tensorFromVector(input)}},
            {"output"},
            {},
            &outputs
        );

        if (!status.ok()) {
            return ActionType::REST;  // Default action if prediction fails
        }

        // Process output tensor to get predicted action
        auto output = outputs[0].tensor<float, 2>();
        int actionIndex = 0;
        float maxProb = output(0, 0);
        
        for (int i = 1; i < 8; ++i) {
            if (output(0, i) > maxProb) {
                maxProb = output(0, i);
                actionIndex = i;
            }
        }

        return static_cast<ActionType>(actionIndex);
    }

private:
    std::unique_ptr<tensorflow::Session> session;

    void loadModel() {
        // Load pre-trained model
        tensorflow::GraphDef graph_def;
        tensorflow::Status status = tensorflow::ReadBinaryProto(
            tensorflow::Env::Default(),
            "models/behavior_model.pb",
            &graph_def
        );

        if (!status.ok()) {
            throw std::runtime_error("Failed to load behavior model");
        }

        status = session->Create(graph_def);
        if (!status.ok()) {
            throw std::runtime_error("Failed to create TensorFlow session");
        }
    }

    std::vector<float> prepareInput(const PersonalityProfile& personality, const BehaviorContext& context) {
        std::vector<float> input;
        // Add personality traits
        for (int i = 0; i < 8; ++i) {
            input.push_back(personality.getTraitValue(static_cast<PersonalityTrait::Type>(i)));
        }
        // Add context features
        input.push_back(context.timeOfDay / 24.0f);
        input.push_back(context.energy);
        input.push_back(context.health);
        input.push_back(context.wealth);
        input.push_back(context.socialStatus);
        // Add relationships
        input.insert(input.end(), context.relationships.begin(), context.relationships.end());
        return input;
    }

    tensorflow::Tensor tensorFromVector(const std::vector<float>& vec) {
        tensorflow::Tensor tensor(tensorflow::DT_FLOAT, tensorflow::TensorShape({1, static_cast<int>(vec.size())}));
        auto matrix = tensor.matrix<float>();
        for (size_t i = 0; i < vec.size(); ++i) {
            matrix(0, i) = vec[i];
        }
        return tensor;
    }
};

} // namespace AI
} // namespace ForgeEngine
