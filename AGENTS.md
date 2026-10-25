# Antigravity Agent Instructions — TP1100 Respiratory Teaching Rig & Digital Twin

## 1. Project Purpose & Pedagogical Philosophy

This repository powers an interactive physiology teaching suite for **TP1100** students, pairing a **low-cost mechanical benchtop lung apparatus** with a **biophysical digital twin web application**.

- **Simple Yet Mechanistically Accurate**: Keep interfaces approachable and visual for students, while grounding all animations, metrics, and graphs in real physiological and physical equations rather than arbitrary visual heuristics.
- **1-to-1 Hardware & Digital Twin Alignment**: Every adjustable element on the physical benchtop rig (syringe tidal volume, breathing rate, swappable dead-space tubing, bronchial roller clamps, balloon compliance sets, and U-tube water manometer) must map directly to its corresponding control and readout in the web simulation.
- **Language**: Maintain all UI labels, code comments, documentation, and student lab protocols in clear academic **English**.

---

## 2. Architecture & Tech Stack

- **Backend**: Python (`>=3.11`) with **FastAPI** ([`app.py`](file:///home/andreassag/repo/TP1100_ressurser/app.py)) served via **Uvicorn**.
  - Routes:
    - `/` $\rightarrow$ redirects to `/mechanics`
    - `/mechanics` $\rightarrow$ [`static/mechanics.html`](file:///home/andreassag/repo/TP1100_ressurser/static/mechanics.html) (Model 1: Respiratory Mechanics & Efficiency)
    - `/exchange` $\rightarrow$ [`static/exchange.html`](file:///home/andreassag/repo/TP1100_ressurser/static/exchange.html) (Model 2: Alveolar Gas Exchange & Hemoglobin)
    - `/lab-model` $\rightarrow$ [`static/lab_model.html`](file:///home/andreassag/repo/TP1100_ressurser/static/lab_model.html) (Model 3: Physical Benchtop Blueprint, BOM & Student Lab Protocols)
    - `/static/index.html` $\rightarrow$ [`static/index.html`](file:///home/andreassag/repo/TP1100_ressurser/static/index.html) (Combined dual-model overview)
- **Frontend**: Vanilla HTML5, CSS3 ([`static/styles.css`](file:///home/andreassag/repo/TP1100_ressurser/static/styles.css)), and JavaScript ([`static/app.js`](file:///home/andreassag/repo/TP1100_ressurser/static/app.js)) using **p5.js** (`1.11.3`). Do not introduce heavy frontend build toolchains or bundlers.
- **Environment & Task Runner**: Managed via `uv` / `.venv` and automated through the root [`Makefile`](file:///home/andreassag/repo/TP1100_ressurser/Makefile).

---

## 3. Biophysical & Physiological Modeling Standards

When modifying or extending the simulations in [`static/app.js`](file:///home/andreassag/repo/TP1100_ressurser/static/app.js), preserve the following physiological invariants:

### Model 1: Respiratory Mechanics (`/mechanics`)
1. **Equation of Motion**:
   $$\Delta P_{pl}(t) = \frac{V(t) - \text{FRC}}{C_L} + R_{aw}\dot{V}(t)$$
   - Incorporate the RC time constant ($\tau = R_{aw} \cdot C_L$) so elevated airway resistance or compliance produces realistic expiratory flow lag and dynamic hyperinflation (auto-PEEP) at high respiratory rates.
2. **Dead Space & Ventilation Efficiency**:
   - **Minute Ventilation**: $\dot{V}_E = V_T \times RR$
   - **Alveolar Ventilation**: $\dot{V}_A = \max(0, V_T - V_D) \times RR$
   - **Ventilation Efficiency**: $\eta = \frac{\dot{V}_A}{\dot{V}_E}$
   - Particle transport across the carina must scale proportionally with the fresh-air fraction $\max(0, V_T - V_D) / V_T$, visually trapping particles in the tracheal dead-space zone when $V_T \le V_D$.
3. **Textbook P–V Loop Orientation**:
   - Plot **Intrapleural Pressure ($P_{pl}$, $\text{cmH}_2\text{O}$) on the horizontal X-axis** and **Lung Volume ($V$, $\text{L}$) on the vertical Y-axis**, so that the static line slope is mathematically equal to **Lung Compliance ($C_L = \Delta V / \Delta P$)** and loop area represents resistive **Work of Breathing ($\text{J/min}$)**.
   - Dynamically size the P–V history buffer to cover one full respiratory cycle ($\lceil 3600 / RR \rceil + 5$ frames at 60 fps) so the loop remains closed at all breathing rates.
4. **On-Canvas U-Tube Water Manometer**:
   - Resting baseline meniscus must align with the FRC pressure tick ($-5\text{ cmH}_2\text{O}$), and inspiratory negative pressure swings must deflect the meniscus downward toward negative ticks on the graduated scale ($\Delta h = |P_{pl}|$).

### Model 2: Alveolar Gas Exchange (`/exchange`)
1. **Cross-Model Coupling (Alveolar Gas Equation)**:
   - Sync state from Model 1 via `sessionStorage` (`tp1100_mechanics_state`, with in-memory fallback) to compute steady-state alveolar partial pressures from $\dot{V}_A$ and $FiO_2$:
     $$P_A\text{CO}_2 \approx \frac{\dot{V}_{\text{CO}_2} \times 863}{\dot{V}_A}, \quad P_A\text{O}_2 = Fi\text{O}_2 \cdot (P_{\text{atm}} - P_{\text{H}_2\text{O}}) - \frac{P_A\text{CO}_2}{R}$$
   - Automatically apply a $P_A\text{CO}_2$-driven **Bohr shift** to $P_{50}$ when hypercapnia/hypocapnia occurs.
2. **Fick's Law & End-Capillary Arterial Saturation ($Sp\text{O}_2$)**:
   - Model capillary $\text{O}_2$ equilibration as a function of membrane thickness ($T \in [0.5, 3.0]\ \mu\text{m}$) and capillary transit time (blood flow speed).
   - Report **Arterial Saturation ($Sp\text{O}_2$)** from **end-capillary equilibrated blood** leaving the alveolus (normally $\sim 98\%$ at rest), never by averaging mixed venous entry cells with arterial exit cells.

---

## 4. UI, Styling & Code Conventions

- **Design System**:
  - Headings: `'Fraunces', serif`
  - Body, controls, and canvas labels: `'IBM Plex Sans', sans-serif`
  - Color tokens (defined in `:root` of [`static/styles.css`](file:///home/andreassag/repo/TP1100_ressurser/static/styles.css)): `--bg` (`#eef6f5`), `--ink` (`#16313a`), `--muted` (`#5b7178`), `--teal` (`#0d7c86`), `--salmon` (`#e07a5f`), `--gold` (`#e9c46a`).
- **Canvas Text Rendering**:
  - In `p5.js` canvas `p.text(...)` calls, always use literal Unicode symbols (`→`, `←`, `V̇A`, `cmH₂O`, `µm`) — never HTML entities (`&rarr;`, `&bull;`), which render as raw text on HTML5 canvas.
- **Template Synchronization**:
  - Keep navigation bars, slider IDs, `min`/`max`/`step` attributes, and metric containers synchronized across [`static/mechanics.html`](file:///home/andreassag/repo/TP1100_ressurser/static/mechanics.html), [`static/exchange.html`](file:///home/andreassag/repo/TP1100_ressurser/static/exchange.html), [`static/lab_model.html`](file:///home/andreassag/repo/TP1100_ressurser/static/lab_model.html), and [`static/index.html`](file:///home/andreassag/repo/TP1100_ressurser/static/index.html).
- **Interactive Polish**:
  - When a user manually moves any slider, automatically clear the `.active` state on preset buttons.
  - When sliders are locked by the "Link to Model 1 Ventilation" toggle, ensure `:disabled` styling is applied.

---

## 5. Development & Verification Workflow

Always use the [`Makefile`](file:///home/andreassag/repo/TP1100_ressurser/Makefile) targets for running and verifying the project:

```bash
make launch        # Start FastAPI server with hot-reload (http://127.0.0.1:8000)
make launch-open   # Start server and open browser
make test          # Run automated verification checks
make clean         # Remove temporary cache files
```

### Mandatory Pre-Completion Checks
Before finishing any task that modifies Python, JavaScript, HTML, or CSS:
1. Run `make test` and confirm all verification checks pass with zero errors:
   - Python syntax validation (`app.py`).
   - JavaScript syntax validation (`static/app.js`, `check.js`).
   - HTML template structure and asset link verification across all routes ([`check.js`](file:///home/andreassag/repo/TP1100_ressurser/check.js)).
