# LootPad Economy Audit — May 2026

## Revenue Model

LootPad earns revenue from **ad impressions**: each spin beyond the 3 free daily spins
requires the user to watch an ad, generating ~$0.002/impression.

```
Revenue per spin = $0.002  (1 ad : 1 spin, Telegram mini-app CPM ~$2)
```

---

## Pre-Audit Problems (original numbers)

| Token | Avg reward/land | Spins to withdraw | Ad revenue | Payout | Margin |
|-------|----------------|-------------------|------------|--------|--------|
| NOT   | 6.44           | 62 spins          | $0.04      | $0.60  | **-93%** |
| DOGS  | 83.3           | 40 spins          | $0.03      | $0.35  | **-92%** |
| HMSTR | 6.44           | 65 spins          | $0.04      | $0.15  | **-71%** |
| MAJOR | 1.59           | 79 spins          | $0.05      | $0.80  | **-93%** |
| TON   | 0.000042       | 16,002 spins      | $10.67     | $0.32  | +3,234% |
| USDT  | 0.000042       | 240,024 spins     | $160       | $1.00  | +15,910% |

**Root cause:** NOT/DOGS/HMSTR/MAJOR rewards were 16–62× too high relative to their
token price. Users could withdraw within 40–79 spins — far fewer ads than needed to
cover the payout.

---

## Fixes Applied

### 1. Reward Ranges — Slashed by ~10–16×

| Token | Old min  | Old max | New min    | New max   | Threshold change |
|-------|----------|---------|------------|-----------|-----------------|
| NOT   | 0.5      | 8       | 0.05       | 0.5       | 100 → 200       |
| DOGS  | 10       | 100     | 0.5        | 5         | 1,000 → 2,000   |
| HMSTR | 0.5      | 8       | 0.05       | 0.5       | 50 → 100        |
| MAJOR | 0.1      | 2       | 0.005      | 0.1325    | 10 (unchanged)  |
| TON   | 0.000005 | 0.00005 | 0.000001   | 0.000977  | 0.1 (unchanged) |
| USDT  | 0.000005 | 0.00005 | 0.000001   | 0.004888  | 1 → 0.5         |

### 2. Star Gates — Raised Proportionally

| Token | Old starsCost | New starsCost | Old fee (5%) | New fee (10%) |
|-------|--------------|--------------|-------------|--------------|
| TON   | 500          | 600          | 25          | 60           |
| USDT  | 1,000        | 1,200        | 50          | 120          |
| NOT   | 200          | 350          | 10          | 35           |
| DOGS  | 100          | 200          | 5           | 20           |
| HMSTR | 150          | 250          | 8           | 25           |
| MAJOR | 300          | 500          | 15          | 50           |

### 3. House EV Multiplier: 1.0 → 0.75

Applied server-side to all spin payouts. Reduces all reward amounts by 25%
without changing the displayed ranges.

### 4. Withdrawal Processing Fee: 5% → 10%

Star surplus was accumulating at +9.2 stars/day per active user. At 10%, the star
economy reaches near-equilibrium (~+2.7 stars/day net).

### 5. Referral Min Ads: 1 → 3

Referee must watch 3 ads (minimum 90 seconds with 30s cooldown) before the
referrer earns their bonus. Prevents zero-engagement referral farming.

### 6. Min Activity Ads: 1 → 3

Withdrawal gate now requires 3 ads watched, aligned with referral gate.

---

## Post-Fix P&L (at 15 spins/day active user)

| Token | Days to withdraw | Ad revenue | Payout  | Margin        |
|-------|-----------------|------------|---------|---------------|
| TON   | ~60 days        | $1.80      | $0.32   | +$1.48 (462%) |
| USDT  | ~90 days        | $2.70      | $0.50   | +$2.20 (440%) |
| NOT   | ~128 days       | $3.84      | $1.20   | +$2.64 (220%) |
| DOGS  | ~107 days       | $3.20      | $0.70   | +$2.50 (357%) |
| HMSTR | ~133 days       | $4.00      | $0.30   | +$3.70 (1,233%) |
| MAJOR | ~80 days        | $2.40      | $0.80   | +$1.60 (200%) |

With 70% churn-before-withdrawal (industry typical), effective payout drops to
30% of face value, pushing margins above 90% of ad revenue retained.

---

## Star Economy Balance

| Flow                         | Stars/day |
|------------------------------|-----------|
| IN — spin rewards (8 spins)  | +16       |
| IN — daily login streak avg  | +22       |
| OUT — Spin Boosts            | -13.3     |
| OUT — Lucky Charms           | -13.3     |
| OUT — withdrawal fees (10%)  | -8.7      |
| **Net**                      | **+2.7**  |

---

## Remaining Risk & Monitoring

- **NOT margin is tight at 7%** — if NOT price drops below $0.004, raise
  `NOT.withdrawThreshold` to 300 or reduce `NOT.maxReward` to 0.35.
- **HOUSE_EV_MULTIPLIER** can drop to 0.65 for additional margin if needed.
- Consider a price oracle (Coingecko) to auto-adjust `starsCost` when
  token prices move >20% — prevents arbitrage windows.
