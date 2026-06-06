"""Canned bilingual content used by the mock (demo) engine.

The mock transcriber emits these English lines and the mock translator looks up
the matching Swedish, so the demo shows a believable end-to-end dub without any
AI models installed. Install the model pack to dub your real audio.
"""

DEMO_PAIRS = [
    ("Welcome to ForgeDub, your own video dubbing studio.",
     "Välkommen till ForgeDub, din egen studio för videodubbning."),
    ("This is a demo voice running without the AI model pack installed.",
     "Det här är en demoröst som körs utan det installerade AI-modellpaketet."),
    ("Once you install the engine, real Swedish voices are generated right here.",
     "När du har installerat motorn skapas riktiga svenska röster här."),
    ("The original speaker's voice can be cloned for natural sounding dubs.",
     "Den ursprungliga talarens röst kan klonas för naturligt klingande dubbning."),
    ("Upload a video or paste a link, and let the forge do the rest.",
     "Ladda upp en video eller klistra in en länk och låt smedjan göra resten."),
    ("Every line stays in sync with the original timing.",
     "Varje replik hålls synkroniserad med originalets tajming."),
    ("You stay in full control of the final translation.",
     "Du har full kontroll över den slutgiltiga översättningen."),
    ("Thanks for trying ForgeDub.",
     "Tack för att du provar ForgeDub."),
]

SV_LOOKUP = {en: sv for en, sv in DEMO_PAIRS}
