# SK1415 simulator — working notes

- The owner wants everything to match real life. Before adding or changing any real-world
  detail (aircraft figures, procedures, SAS service, airports, weather, accident data), confirm
  it with a web search and record the source in the README's Sources section.
- Keep physics changes honest: tune against published figures (FCOM/FCTM-style limits, ICAO
  turbulence categories, investigation reports), not by feel.
- Check flight-model changes with `node tools/flight-test.mjs <weather> 6000 [--sc=<scenario>]`
  for every weather and scenario before committing.
