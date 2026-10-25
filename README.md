# TP1100 Respiratory Teaching Rig & Digital Twin

This project serves an interactive biophysical respiratory teaching suite paired with a low-cost physical benchtop lung model for students:

1. **Model 1: Respiratory Mechanics & Efficiency (`/mechanics`)**:
   - Equation of motion of the respiratory system: $\Delta P_{pl} = \frac{\Delta V}{C_L} + R_{aw} \dot{V}$.
   - Anatomical dead space ($V_D$) vs. alveolar ventilation ($\dot{V}_A$), demonstrating why shallow breathing causes acute ventilation inefficiency despite high respiratory rate.
   - Live U-tube water manometer displaying intrapleural pressure swings ($\text{cmH}_2\text{O}$).
   - Dynamic Pressure–Volume (P–V) hysteresis loop measuring elastic and resistive Work of Breathing (WOB).
   - Clinical & benchtop presets (Normal, Shallow Rapid Dead Space Trap, Asthma, Pulmonary Fibrosis, Emphysema, Added Snorkel Dead Space).

2. **Model 2: Alveolar Gas Exchange & Hemoglobin (`/exchange`)**:
   - Linked directly to Model 1's effective alveolar ventilation ($\dot{V}_A$) and $FiO_2$ via the Alveolar Gas Equation.
   - Fick's Law of diffusion with adjustable membrane thickness / pulmonary edema ($T = 0.5 - 3.0\ \mu\text{m}$).
   - Bohr effect: $CO_2$ accumulation shifts the oxyhemoglobin dissociation curve and alters end-capillary arterial saturation ($SpO_2$).

3. **Model 3: Physical Benchtop Lung Model Blueprint & Lab Guide (`/lab-model`)**:
   - Complete Bill of Materials (< $35) for a purely mechanical, low-cost classroom benchtop rig (PET/acrylic thoracic chamber, 100 mL syringe piston, carina Y-connector, swappable dead space tubing, bronchial pinch clamps, compliance balloon set, U-tube water manometer, and pneumothorax stopcock).
   - Component-by-component anatomical mapping.
   - 4 hands-on student lab protocols with experimental data tables to compare physical measurements against the digital twin.

## Quick Start & Makefile Commands

A [Makefile](file:///home/andreassag/repo/TP1100_ressurser/Makefile) is provided for quick launching and testing:

```bash
make launch        # Start development server at http://127.0.0.1:8000
make launch-open   # Start server and automatically open your default browser
make test          # Run all test suites (backend, physics, DOM, and HTML)
make clean         # Clean temporary cache files
make help          # List all available targets
```

You can customize the host or port at launch:
```bash
make launch PORT=8001 HOST=0.0.0.0
```

### Direct CLI Commands

```bash
uv sync
uv run uvicorn app:app --reload
```

Or using an existing environment:
```bash
.venv/bin/uvicorn app:app --reload --port 8000
```

Then open `http://127.0.0.1:8000`.

## Verification

```bash
make test
```
Or run the validation script directly:
```bash
node check.js
```