# SAS 80 — fan film

A 38-second commercial for SAS's 80th year, made entirely in code: the footage is
rendered by the SK1415 simulator, the film is a canvas animation (`film.html`), and the
soundtrack is synthesised (`music.py`). The finished film is `SAS-80-fan-film.mp4`.

This is an unofficial fan film. It is not made, endorsed or approved by SAS, and it
does not use SAS's official logo artwork.

## Rebuild

```bash
python3 promo/music.py        # writes promo/out/music.wav
node promo/render.mjs         # renders film.html frame by frame to promo/out/SAS-80-fan-film.mp4
```

`render.mjs` needs Playwright with Chromium and `ffmpeg` (or set `FFMPEG=/path/to/ffmpeg`).
Open `film.html` through a local web server to preview the film live in a browser.

## Facts used and where they come from

| In the film | Source |
| --- | --- |
| Founded 1 August 1946 from DDL (Denmark), DNL (Norway) and SILA (Sweden) | [Wikipedia: Scandinavian Airlines](https://en.wikipedia.org/wiki/Scandinavian_Airlines) |
| First intercontinental flight 17 September 1946, Stockholm to New York, DC-4 *Dan Viking*, 28 passengers, about 25 hours via Copenhagen, Prestwick and Gander | [SAS press release, 2026](https://www.sasgroup.net/newsroom/press-releases/2026/sas-celebrates-80-years-with-anniversary-flights-to-new-york-where-the-journey-began/) |
| Hubs Copenhagen, Stockholm and Oslo; network across Europe, North America and Asia | [SkyTeam press release](https://www.skyteam.com/en/about/press-releases/press-releases-2024/sas-officially-joins-skyteam) · [SAS press release](https://www.sasgroup.net/newsroom/press-releases/2026/sas-celebrates-80-years-with-anniversary-flights-to-new-york-where-the-journey-began/) |
| SkyTeam member since 1 September 2024 | [SAS press release, 2024](https://www.sasgroup.net/newsroom/press-releases/2024/sas-officially-joins-skyteam-global-airline-alliance/) |
| 80th anniversary in 2026, with an all-blue A330-300 carrying a Scandinavian flag band | [SAS press release, 2026](https://www.sasgroup.net/newsroom/press-releases/2026/sas-marks-80-years-with-anniversary-aircraft/) |
