# Roadmap (what the prototype does NOT do yet)

Ordered by how much each would improve the result.

1. **Active-speaker detection for lip-sync.** Today Wav2Lip/MuseTalk re-render the *largest* face in a window,
   which is wrong in two-shots and reaction shots. Add an active-speaker model (TalkNet / LR-ASD style) and pick the
   face whose mouth matches the *original* audio, using the diarized speaker.
2. **Evaluation harness.** Re-transcribe each dub (WER vs the translation), speaker-embedding similarity to the
   original actor, lip-sync confidence (LSE-C/LSE-D), loudness. Put numbers in `report.json`.
3. **Adaptation, not just translation.** Syllable/duration-aware rewriting with a local LLM (the `ollama` backend does a
   first version: it gets a character budget from the actor's mouth time). Add a glossary (character names, places) so
   "Gandalf" never becomes a common noun; consistent forms of address across a whole film.
4. **Sharper mouths.** Wav2Lip renders 96×96 px. Add face restoration (CodeFormer/GFPGAN-class) on the patch, or make
   MuseTalk/LatentSync-class models first-class and batch them (they currently start a process per window).
5. **Per-character voice library.** Cast management: pick the best reference clips once per character, reuse across
   episodes, let a user pin a reference by hand.
6. **Cross-lingual accent leakage.** Cloning from English audio into Swedish keeps some English accent. Options: a
   short native-language reference per speaker, or a voice-conversion pass.
7. **5.1 / multi-channel.** The dub is mixed to stereo today; keep the centre-channel dialogue slot and re-mix into 5.1.
8. **GPT-SoVITS adapter** (`TTS` interface; it exposes a local HTTP API) as a third voice engine.
9. **Live mode video:** only possible for sources you can legally capture; protected streaming video is blank in screen
   capture and this project does not attempt to bypass that.
