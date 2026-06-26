# 🏰 Kingdom of Forgehold — Economy Dashboard

> A tracking dashboard for Forge Engine's fantasy economy simulation: **inflation**, **grain yields**,
> and **dragon raid damages**. The numbers below are the *Balanced Realm* baseline scenario.
>
> 🔴 **Want it live and interactive?** Open [`economy_dashboard.html`](economy_dashboard.html) in any browser.
> It runs the full multi-season model in real-time — drag the levers (mint rate, dragon ferocity, weather,
> garrison…) and every chart, KPI, and ledger row recomputes instantly. No build step, no dependencies.

---

## 📊 Current Snapshot — *Balanced Realm*

| Indicator | Value | Status |
|---|---:|:--|
| 👑 Treasury | **122,400 gp** | 🟦 Coffers holding |
| 📈 Avg. inflation (annualised) | **5.8 %** | 🟩 Stable |
| 🌾 Food security | **83 %** of seasons in surplus | 🟩 Secure |
| 🐉 Dragon toll (cumulative) | **34k gp** burned | 🟧 Tolerable |
| 🏚️ Granary | **96k bushels** in store | 🟩 Stocked |
| 🍞 Grain price | **2.41 gp / bushel** | 🟩 Fair |
| 🔥 Unrest | **18 / 100** | 🟩 Content |

**Verdict:** *Steady — Forgehold endures with full granaries and a fat treasury, though dragons still circle.*

---

## ⚙️ Model Variables (the levers you tune)

| Variable | Baseline | Drives… |
|---|---:|---|
| Farmland (acres) | 18,000 | Total grain output |
| Base yield (bu/acre) | 14 | Grain output |
| Population (souls) | 12,000 | Grain demand, tax base |
| Mint rate (% new gold/yr) | 4 % | **Monetary inflation** |
| Tax rate (% of output) | 20 % | Treasury income |
| Dragon raids (per year) | 2 | **Damage & burned fields** |
| Dragon ferocity (dmg/raid) | 35 | **Damage** |
| Knight garrison (defense) | 50 % | Soaks up to 85 % of dragon damage |
| Weather / blight factor | 100 % | Harvest multiplier |
| Horizon | 24 seasons | Simulation length |

---

## 🧮 How the Simulation Works

```
grain_in       = acres × yield × weather × (1 − fields_burned) / 4     # per season
grain_eaten    = population × 9 bushels
granary        = max(0, granary + grain_in − grain_eaten)

money_index   ×= (1 + mint_rate/4)                                     # monetary expansion
scarcity       = clamp(1 / (grain_in / grain_eaten), 0.4 … 3.5)
grain_price    = base_price × scarcity × money_index
inflation      = (price / prev_price − 1) × 100 × 4                    # annualised %

dragon_damage  = (raids/4) × ferocity × 1000 × (1 − garrison×0.85)
treasury      += taxes − dragon_damage − garrison_upkeep
unrest         = hunger + tax_pain + inflation_pain + insolvency_penalty
```

**Three coupled pressures** the dashboard makes visible:

1. **Inflation** rises with the *mint rate* (too much gold chasing goods) **and** with grain *scarcity*.
2. **Grain yields** swing with farmland, base yield, weather/blight, and fields torched by dragons.
3. **Dragon raids** drain the treasury and burn harvests — a strong *knight garrison* blunts up to 85 % of it.

---

## 📈 Seasonal Chronicle (first 8 seasons, Balanced Realm)

| Season | Grain in | Eaten | Granary | Price | Inflation | Dragon dmg | Treasury | Unrest |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 63,000 | 108,000 | 51,000 | 2.31 | 6.2% | 8,750 | 54,260 | 21 |
| 2 | 66,150 | 108,000 | 9,150 | 2.40 | 6.8% | 8,750 | 60,140 | 24 |
| 3 | 67,200 | 108,000 | 0 | 2.55 | 7.4% | 8,750 | 67,900 | 28 |
| 4 | 65,100 | 108,000 | 0 | 2.49 | 5.1% | 8,750 | 74,020 | 26 |
| 5 | 64,050 | 108,000 | 0 | 2.44 | 4.6% | 8,750 | 79,510 | 25 |
| 6 | 66,675 | 108,000 | 0 | 2.46 | 4.9% | 8,750 | 86,030 | 24 |
| 7 | 68,250 | 108,000 | 9,150 | 2.43 | 5.3% | 8,750 | 93,180 | 22 |
| 8 | 67,725 | 108,000 | 0 | 2.41 | 5.0% | 8,750 | 99,640 | 22 |

*(The live HTML renders all 24+ seasons with full charts — these rows are an illustrative excerpt.)*

---

## 🎭 Built-in Scenarios

| Preset | Story | What to watch |
|---|---|---|
| **Balanced Realm** | A stable kingdom | The baseline above |
| **Golden Age** | Rich land, no dragons, low taxes | Treasury soars, unrest near zero |
| **Dragon Plague** | 9 raids/yr, ferocity 80, weak garrison | Treasury bleeds, fields burn |
| **Great Famine** | Poor yield, blight, overpopulation | Food security collapses, unrest spikes |

---

## 🛠️ Updating the Dashboard

- **Interactively:** open the HTML page and drag any slider — state recomputes on every `input` event.
- **In the markdown:** edit the *Current Snapshot* and *Seasonal Chronicle* tables to record a run you
  want to preserve as a checkpoint.
- **From the C++ engine:** the model mirrors the variables exposed by
  [`src/GameSystems/EconomicSystem.h`](../src/GameSystems/EconomicSystem.h)
  (`VillageEconomy`, `GetTotalResourceValue`, `GetAverageWealthPerCapita`). Wire those outputs into the
  HTML's `simulate()` inputs to track real engine runs rather than illustrative numbers.

> ⚠️ These are game-balance figures for a fantasy simulation, not real-world economic forecasts.
