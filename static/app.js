// TP1100 Respiratory Simulation & Benchtop Digital Twin
// Integrates Equation of Motion, Alveolar Gas Equation, Fick's Diffusion, and Oxyhemoglobin Dissociation

const mechanicsState = {
  history: [],
  particles: [],
  time: 0,
  lungVolume: 2.4,
  prevLungVolume: 2.4,
  displayFlow: 0,
  flowLps: 0,
  pressure: -5.0,
  tracerY: 0,
  prevDiaphragmDrop: null,
  prevCyclePos: null,
  co2SpawnAccumulator: 0,
  lastMetrics: null,
};

const exchangeState = {
  rbcs: [],
  particles: [],
  lastMetrics: null,
  releaseCounter: 0,
};

// DOM references for Model 1
const mechanicsConfig = {
  respRate: document.getElementById("respRate"),
  tidalVolume: document.getElementById("tidalVolume"),
  deadSpace: document.getElementById("deadSpace"),
  compliance: document.getElementById("compliance"),
  airwayResistance: document.getElementById("airwayResistance"),
  fio2: document.getElementById("fio2"),
};

// DOM references for Model 2
const exchangeConfig = {
  linkModel1: document.getElementById("linkModel1"),
  linkModel1Status: document.getElementById("linkModel1Status"),
  alveolarPO2: document.getElementById("alveolarPO2"),
  affinityShift: document.getElementById("affinityShift"),
  membraneThickness: document.getElementById("membraneThickness"),
  bloodFlow: document.getElementById("bloodFlow"),
  alveolarPO2Label: document.getElementById("alveolarPO2Label"),
  affinityShiftLabel: document.getElementById("affinityShiftLabel"),
};

// Formatters for sliders
function bindOutputs(config, formatter) {
  Object.entries(config).forEach(([key, input]) => {
    if (!input) return;
    const output = document.querySelector(`[data-output="${key}"]`);
    if (!output) return;
    const sync = () => {
      output.textContent = formatter(key, Number(input.value));
    };
    input.addEventListener("input", sync);
    sync();
  });
}

bindOutputs(mechanicsConfig, (key, value) => {
  if (key === "respRate") return `${value} breaths/min`;
  if (key === "tidalVolume") return `${value} mL`;
  if (key === "deadSpace") return `${value} mL`;
  if (key === "compliance") return `${value.toFixed(2)} L/cmH2O`;
  if (key === "airwayResistance") return `${value.toFixed(1)} cmH2O·s/L`;
  if (key === "fio2") return `${value}% O2`;
  return `${value}`;
});

bindOutputs(exchangeConfig, (key, value) => {
  if (key === "alveolarPO2") return `${Math.round(value)} mmHg`;
  if (key === "affinityShift") {
    if (Math.abs(value) < 0.1) return "Neutral (P50 ≈ 26.6)";
    return value > 0 ? `+${value.toFixed(1)} mmHg (Right / Acidosis)` : `${value.toFixed(1)} mmHg (Left / Alkalosis)`;
  }
  if (key === "membraneThickness") return `${value.toFixed(1)} µm`;
  if (key === "bloodFlow") return `${value} px/s`;
  return `${value}`;
});

function setMetrics(elementId, items) {
  const host = document.getElementById(elementId);
  if (!host) return;
  host.innerHTML = items
    .map(
      (item) => `
        <article class="metric">
          <span class="metric-label">${item.label}</span>
          <span class="metric-value">${item.value}</span>
        </article>
      `,
    )
    .join("");
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const proportion = (value - inMin) / (inMax - inMin);
  return outMin + proportion * (outMax - outMin);
}

function sigmoidSaturation(po2, p50, hill = 2.8) {
  if (po2 <= 0) return 0;
  const num = Math.pow(po2, hill);
  return num / (num + Math.pow(p50, hill));
}

// ----------------------------------------------------
// Presets Setup for Model 1
// ----------------------------------------------------
function initMechanicsPresets() {
  const container = document.getElementById("mechanics-presets");
  if (!container) return;

  const presets = {
    normal: {
      respRate: 12,
      tidalVolume: 500,
      deadSpace: 150,
      compliance: 0.20,
      airwayResistance: 2.0,
      fio2: 21,
    },
    shallow_rapid: {
      respRate: 30,
      tidalVolume: 200,
      deadSpace: 150,
      compliance: 0.20,
      airwayResistance: 2.0,
      fio2: 21,
    },
    asthma: {
      respRate: 16,
      tidalVolume: 550,
      deadSpace: 150,
      compliance: 0.20,
      airwayResistance: 14.0,
      fio2: 21,
    },
    fibrosis: {
      respRate: 20,
      tidalVolume: 350,
      deadSpace: 150,
      compliance: 0.06,
      airwayResistance: 2.0,
      fio2: 21,
    },
    emphysema: {
      respRate: 10,
      tidalVolume: 650,
      deadSpace: 180,
      compliance: 0.30,
      airwayResistance: 4.0,
      fio2: 21,
    },
    snorkel: {
      respRate: 12,
      tidalVolume: 500,
      deadSpace: 300,
      compliance: 0.20,
      airwayResistance: 3.5,
      fio2: 21,
    },
  };

  let isSettingPreset = false;
  const buttons = container.querySelectorAll(".preset-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetKey = btn.dataset.preset;
      const data = presets[presetKey];
      if (!data) return;

      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      isSettingPreset = true;
      mechanicsState.history = [];
      Object.entries(data).forEach(([key, val]) => {
        const input = mechanicsConfig[key];
        if (input) {
          input.value = val;
          input.dispatchEvent(new Event("input"));
        }
      });
      isSettingPreset = false;
    });
  });

  // Clear active preset button when user manually tweaks sliders
  Object.values(mechanicsConfig).forEach((input) => {
    if (!input) return;
    input.addEventListener("input", () => {
      if (!isSettingPreset) {
        buttons.forEach((b) => b.classList.remove("active"));
      }
    });
  });
}

initMechanicsPresets();

// ----------------------------------------------------
// Cross-Model State Synchronization
// ----------------------------------------------------
let inMemorySyncState = null;

function syncStateToStorage(stateData) {
  inMemorySyncState = stateData;
  try {
    sessionStorage.setItem("respiratory_sync_data", JSON.stringify(stateData));
  } catch (e) {
    // Ignore storage quota/security restrictions if in iframe
  }
}

function getStateFromStorage() {
  if (inMemorySyncState) {
    return inMemorySyncState;
  }
  try {
    const raw = sessionStorage.getItem("respiratory_sync_data");
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // fall back
  }
  return {
    rr: 12,
    vt: 500,
    vd: 150,
    cl: 0.20,
    raw: 2.0,
    fio2: 21,
    va: 4.2,
    ve: 6.0,
    efficiency: 70,
    pao2: 100,
    paco2: 41,
    shift: 0,
  };
}

// ----------------------------------------------------
// Model 1: Mechanics & Efficiency Sketch
// ----------------------------------------------------
function createMechanicsSketch(containerId) {
  return new p5((p) => {
    let bounds = { width: 900, height: 460 };
    let upperBodyImage;

    p.preload = () => {
      upperBodyImage = p.loadImage("/assets/upper_body.png");
    };

    const ensureParticles = () => {
      while (mechanicsState.particles.length < 130) {
        const fio2 = Number(mechanicsConfig.fio2 ? mechanicsConfig.fio2.value : 21) / 100;
        const o2Share = mapRange(fio2, 0.1, 1, 0.4, 0.95);
        mechanicsState.particles.push({
          x: p.random(24, bounds.width * 0.46),
          y: p.random(70, bounds.height - 40),
          type: p.random() < o2Share ? "o2" : "co2",
          phase: p.random(1000),
          mode: "floating",
          life: 0,
          branch: "left",
        });
      }
    };

    const resize = () => {
      const container = document.getElementById(containerId);
      if (!container) return;
      bounds.width = container.clientWidth || 900;
      bounds.height = p.windowWidth < 720 ? 380 : 470;
      p.resizeCanvas(bounds.width, bounds.height);
    };

    p.setup = () => {
      const container = document.getElementById(containerId);
      const canvas = p.createCanvas(bounds.width, bounds.height);
      canvas.parent(container);
      resize();
      ensureParticles();
      p.frameRate(60);
    };

    p.windowResized = resize;

    p.draw = () => {
      p.background(245, 250, 249);
      ensureParticles();
      const dt = Math.max(0.001, Math.min(p.deltaTime ? p.deltaTime / 1000 : 0.016, 0.1));
      mechanicsState.time += dt;

      // Read physical parameters from sliders
      const rr = Number(mechanicsConfig.respRate ? mechanicsConfig.respRate.value : 12);
      const vt = Number(mechanicsConfig.tidalVolume ? mechanicsConfig.tidalVolume.value : 500); // mL
      const vd = Number(mechanicsConfig.deadSpace ? mechanicsConfig.deadSpace.value : 150); // mL
      const cl = Number(mechanicsConfig.compliance ? mechanicsConfig.compliance.value : 0.20); // L/cmH2O
      const raw = Number(mechanicsConfig.airwayResistance ? mechanicsConfig.airwayResistance.value : 2.0); // cmH2O·s/L
      const fio2 = Number(mechanicsConfig.fio2 ? mechanicsConfig.fio2.value : 21); // %

      // Kinematics: cycle phase
      const cycleFreq = rr / 60; // Hz
      const omega = p.TWO_PI * cycleFreq;
      const cyclePos = (mechanicsState.time * cycleFreq) % 1;
      const cycleEnded = mechanicsState.prevCyclePos !== null && cyclePos < mechanicsState.prevCyclePos;
      mechanicsState.prevCyclePos = cyclePos;

      // Driving muscular / piston target volume (sinusoidal)
      const frc = 2.4; // FRC baseline in Liters
      const vtLiters = vt / 1000;
      const targetVolume = frc + (vtLiters / 2) * (1 - Math.cos(omega * mechanicsState.time));

      // RC low-pass filter for airway resistance & compliance time constant
      const tau = Math.max(0.04, raw * cl); // seconds
      const alpha = 1 - Math.exp(-dt / tau);
      mechanicsState.lungVolume += (targetVolume - mechanicsState.lungVolume) * alpha;

      // Actual airflow dV/dt (L/s)
      const flowLps = (mechanicsState.lungVolume - mechanicsState.prevLungVolume) / dt;
      mechanicsState.prevLungVolume = mechanicsState.lungVolume;
      mechanicsState.flowLps = flowLps;

      // Normalized display flow for particles
      const peakTheoreticalFlow = (vtLiters / 2) * omega; // L/s
      const normFlow = peakTheoreticalFlow > 0 ? flowLps / peakTheoreticalFlow : 0;
      mechanicsState.displayFlow = p.constrain(normFlow, -1.5, 1.5);

      // Equation of Motion: P_pl(t) = P_pl_FRC - [ (V(t) - FRC) / C_L + Raw * V_dot ]
      const P_pl_FRC = -5.0; // cmH2O
      const elasticDrop = (mechanicsState.lungVolume - frc) / cl; // cmH2O
      const resistiveDrop = raw * flowLps; // cmH2O
      const deltaP_pl = elasticDrop + resistiveDrop;
      const pressure = P_pl_FRC - deltaP_pl;
      mechanicsState.pressure = pressure;

      // Torso visual layout
      const torsoWidth = bounds.width * 0.54;
      const torsoLayout = getTorsoLayout(torsoWidth, bounds.height);

      // Inhale signal for diaphragm animation
      const inhaleFraction = (mechanicsState.lungVolume - frc) / vtLiters;
      const diaphragmDrop = 28 + p.constrain(inhaleFraction, 0, 1.3) * 60;

      // Tracer bead position inside vertical trachea (scaled by tidal volume vs dead space)
      // If VT < VD, the bead oscillates inside the tube without ever clearing the dead space!
      const deadSpaceFrac = p.constrain(vt / Math.max(1, vd), 0.1, 2.5);
      const beadExcursion = p.constrain(inhaleFraction * deadSpaceFrac, 0, 1.2);
      mechanicsState.tracerY = torsoLayout.mouthY + 12 + beadExcursion * (torsoLayout.carinaY - torsoLayout.mouthY - 20);

      // Record PV loop history - sized to exactly 1 complete breath cycle (60 / RR seconds)
      const cycleFrames = Math.max(40, Math.ceil((60 / Math.max(1, rr)) * 60) + 5);
      mechanicsState.history.push({ volume: mechanicsState.lungVolume, pressure, flow: flowLps });
      while (mechanicsState.history.length > cycleFrames) {
        mechanicsState.history.shift();
      }

      // Draw torso, dead space overlay, balloons, and manometer
      drawTorso(
        p,
        torsoLayout,
        upperBodyImage,
        diaphragmDrop,
        inhaleFraction,
        raw,
        vt,
        vd,
        pressure,
        mechanicsState.tracerY
      );

      // Draw particle flow
      drawParticles(
        p,
        torsoLayout,
        mechanicsState.displayFlow,
        raw,
        fio2 / 100,
        rr,
        vt,
        vd,
        cyclePos,
        cycleEnded,
        mechanicsState.particles
      );

      // Draw live Pressure-Volume hysteresis loop graph with static compliance line
      drawMechanicsGraph(
        p,
        torsoWidth,
        bounds.width - torsoWidth,
        bounds.height,
        mechanicsState.history,
        cl,
        frc,
        vtLiters
      );

      // Compute Quantitative Physiological Metrics
      const ve = vtLiters * rr; // L/min Minute Ventilation
      const effectiveVt = Math.max(0, vt - vd) / 1000;
      const va = effectiveVt * rr; // L/min Alveolar Ventilation
      const efficiency = ve > 0 ? (va / ve) * 100 : 0; // %

      // Work of Breathing (WOB):
      // Elastic work per breath: Wel = 0.5 * (Vt^2 / CL) in L·cmH2O
      // Resistive work per breath ~ (pi^2 / 4) * Raw * Flow_peak * Vt / 2
      const wElasticLcm = 0.5 * Math.pow(vtLiters, 2) / cl;
      const wResistiveLcm = raw * Math.pow(peakTheoreticalFlow, 2) * (30 / rr); // approx cycle integral
      const wTotalJoulesPerMin = (wElasticLcm + wResistiveLcm) * rr * 0.0980665;

      // Alveolar Gas Equation prediction
      const piO2 = (760 - 47) * (fio2 / 100); // mmHg
      const paco2 = Math.min(120, 172.6 / Math.max(0.4, va)); // mmHg
      const pao2 = Math.max(25, Math.min(650, piO2 - (paco2 / 0.8))); // mmHg
      const bohrShift = (paco2 - 40) * 0.25;

      // Synchronize with sessionStorage for Model 2
      syncStateToStorage({
        rr,
        vt,
        vd,
        cl,
        raw,
        fio2,
        va,
        ve,
        efficiency,
        pao2,
        paco2,
        shift: bohrShift,
      });

      // Update UI Metrics Strip with status badges
      let effBadgeClass = "badge-good";
      let effBadgeText = "Optimal";
      if (efficiency < 40) {
        effBadgeClass = "badge-danger";
        effBadgeText = "Dead Space Trap!";
      } else if (efficiency < 65) {
        effBadgeClass = "badge-warning";
        effBadgeText = "Compromised";
      }

      setMetrics("mechanics-metrics", [
        {
          label: "Minute Ventilation (V̇E)",
          value: `${ve.toFixed(2)} L/min`,
        },
        {
          label: "Alveolar Ventilation (V̇A)",
          value: `${va.toFixed(2)} L/min`,
        },
        {
          label: "Ventilation Efficiency",
          value: `${efficiency.toFixed(0)}% <span class="efficiency-badge ${effBadgeClass}">${effBadgeText}</span>`,
        },
        {
          label: "Pleural Pressure (Ppl)",
          value: `${pressure.toFixed(1)} cmH2O (Δ ${deltaP_pl.toFixed(1)})`,
        },
        {
          label: "Work of Breathing",
          value: `${wTotalJoulesPerMin.toFixed(2)} J/min`,
        },
      ]);
    };
  });
}

function getTorsoLayout(width, height) {
  const imageSize = Math.min(height - 20, width - 60);
  const imageX = (width - imageSize - 60) / 2 + 10;
  const imageY = (height - imageSize) / 2;
  const centerX = imageX + imageSize * 0.5;
  return {
    width,
    height,
    imageX,
    imageY,
    imageSize,
    centerX,
    lungTopY: imageY + imageSize * 0.515,
    lungOffset: imageSize * 0.1,
    lungWidth: imageSize * 0.188,
    diaphragmBaseY: imageY + imageSize * 0.84,
    diaphragmEdgeOffset: imageSize * 0.19,
    mouthY: imageY + imageSize * 0.285,
    carinaY: imageY + imageSize * 0.41,
    hilumYOffset: imageSize * 0.075,
    manometerX: width - 55,
  };
}

function drawTorso(p, layout, upperBodyImage, diaphragmDrop, inhaleFraction, raw, vt, vd, pressure, tracerY) {
  p.push();
  if (upperBodyImage) {
    p.image(upperBodyImage, layout.imageX, layout.imageY, layout.imageSize, layout.imageSize);
  }

  const tidalNorm = mapRange(vt, 150, 1000, 0, 1);
  const diaphragmEdgeY = layout.diaphragmBaseY + 24;
  const diaphragmRestRise = 34;
  const diaphragmExcursion = mapRange(tidalNorm, 0, 1, 12, 38);
  const diaphragmCenterY = diaphragmEdgeY - diaphragmRestRise + inhaleFraction * diaphragmExcursion;
  const diaphragmInnerRestRise = 22;
  const diaphragmInnerExcursion = mapRange(tidalNorm, 0, 1, 8, 25);
  const diaphragmInnerY = diaphragmEdgeY - diaphragmInnerRestRise + inhaleFraction * diaphragmInnerExcursion;

  const currentLungWidth = layout.lungWidth * mapRange(inhaleFraction, 0, 1, 0.96, 1.18);
  const innerXOffset = layout.lungOffset - currentLungWidth * 0.1;
  const outerXOffset = layout.lungOffset + currentLungWidth * 0.3;

  let innerBottomY = mapRange(innerXOffset, 0, layout.lungOffset * 0.9, diaphragmCenterY, diaphragmInnerY) - 2.5;
  let outerBottomY = mapRange(outerXOffset, layout.lungOffset * 0.9, layout.diaphragmEdgeOffset, diaphragmInnerY, diaphragmEdgeY) - 2.5;

  // Lungs
  p.noStroke();
  p.fill(208, 89, 108, 205);
  drawLungBlob(p, layout.centerX - layout.lungOffset, layout.lungTopY, currentLungWidth, false, innerBottomY, outerBottomY);
  drawLungBlob(p, layout.centerX + layout.lungOffset, layout.lungTopY, currentLungWidth, true, innerBottomY, outerBottomY);

  const leftHilumX = layout.centerX - layout.lungOffset + currentLungWidth * 0.24;
  const rightHilumX = layout.centerX + layout.lungOffset - currentLungWidth * 0.24;
  const hilumY = layout.lungTopY + layout.hilumYOffset;

  // Trachea & Airway Tubes
  const tracheaWidth = mapRange(raw, 1, 20, 16, 5);
  p.stroke(11, 103, 117, 210);
  p.strokeWeight(tracheaWidth);
  p.line(layout.centerX, layout.mouthY, layout.centerX, layout.carinaY);
  p.line(layout.centerX, layout.carinaY, leftHilumX, hilumY);
  p.line(layout.centerX, layout.carinaY, rightHilumX, hilumY);

  // Anatomical Dead Space zone indicator (shaded region in trachea)
  p.noStroke();
  p.fill(42, 157, 244, 45);
  const deadSpaceHeight = mapRange(vd, 50, 350, 20, layout.carinaY - layout.mouthY + 12);
  p.rect(layout.centerX - 10, layout.mouthY - 4, 20, deadSpaceHeight, 6);

  // Dead Space label
  p.fill(13, 124, 134);
  p.textSize(10);
  p.text(`Dead Space (${vd} mL)`, layout.centerX + 16, layout.mouthY + 14);

  // Oscillating foam tracer bead (shows if fresh air reaches alveoli!)
  p.stroke("#b07d12");
  p.strokeWeight(1.5);
  p.fill("#e9c46a");
  const tracerPos = p.constrain(tracerY, layout.mouthY + 4, layout.carinaY + 6);
  p.circle(layout.centerX, tracerPos, 8);

  // Diaphragm line
  p.stroke(11, 103, 117);
  p.strokeWeight(5);
  p.noFill();
  p.beginShape();
  p.curveVertex(layout.centerX - layout.diaphragmEdgeOffset, diaphragmEdgeY);
  p.curveVertex(layout.centerX - layout.diaphragmEdgeOffset, diaphragmEdgeY);
  p.curveVertex(layout.centerX - layout.lungOffset * 0.9, diaphragmInnerY);
  p.curveVertex(layout.centerX, diaphragmCenterY);
  p.curveVertex(layout.centerX + layout.lungOffset * 0.9, diaphragmInnerY);
  p.curveVertex(layout.centerX + layout.diaphragmEdgeOffset, diaphragmEdgeY);
  p.curveVertex(layout.centerX + layout.diaphragmEdgeOffset, diaphragmEdgeY);
  p.endShape();

  // ----------------------------------------------------
  // On-Canvas U-Tube Water Manometer (Physical Lab Rig Analog)
  // ----------------------------------------------------
  const mx = layout.manometerX;
  const my = layout.imageY + 30;
  const mH = layout.imageSize - 60;
  const mW = 44;

  const tubeLeftX = mx + 14;
  const tubeRightX = mx + 28;
  const tubeBottomY = my + mH - 12;

  // Pleural tubing connection from thoracic chamber to manometer left limb
  p.noFill();
  p.stroke("rgba(13, 124, 134, 0.45)");
  p.strokeWeight(2.5);
  const thoraxWallX = layout.centerX + layout.lungOffset + layout.lungWidth * 0.42;
  const thoraxWallY = layout.lungTopY + layout.hilumYOffset + 24;
  p.beginShape();
  p.vertex(thoraxWallX, thoraxWallY);
  p.vertex(mx - 8, thoraxWallY);
  p.vertex(mx - 8, my + 10);
  p.vertex(tubeLeftX, my + 10);
  p.vertex(tubeLeftX, my + 24);
  p.endShape();
  p.fill("#0d7c86");
  p.noStroke();
  p.circle(thoraxWallX, thoraxWallY, 4.5);

  // Background mount board
  p.noStroke();
  p.fill(238, 244, 243);
  p.rect(mx - 6, my, mW + 16, mH, 8);
  p.stroke(200, 215, 212);
  p.strokeWeight(1);
  p.rect(mx - 6, my, mW + 16, mH, 8);

  // Ruler ticks and numbers (0, -5, -10, -15, -20, -25 cmH2O)
  p.fill(91, 113, 120);
  p.textSize(8);
  p.noStroke();
  p.text("Manometer", mx - 4, my - 8);
  p.text("(cmH2O)", mx, my + 8);

  const zeroY = my + mH * 0.28;
  const cmScale = (mH * 0.58) / 25; // px per cmH2O

  for (let cm = 0; cm >= -25; cm -= 5) {
    const tickY = zeroY - cm * (cmScale * 0.5);
    p.stroke(180, 195, 192);
    p.strokeWeight(cm === 0 ? 1.5 : 1);
    p.line(tubeRightX + 6, tickY, tubeRightX + 13, tickY);
    p.noStroke();
    p.fill(cm === 0 ? "#c93b27" : "#5b7178");
    p.text(`${cm}`, tubeRightX + 15, tickY + 3);
  }

  // U-Tube clear outer glass
  p.noFill();
  p.stroke(180, 205, 202);
  p.strokeWeight(6);
  p.beginShape();
  p.vertex(tubeLeftX, my + 22);
  p.vertex(tubeLeftX, tubeBottomY);
  p.vertex(tubeRightX, tubeBottomY);
  p.vertex(tubeRightX, my + 22);
  p.endShape();

  // Water column with dynamic displacement proportional to intrapleural pressure:
  // Subatmospheric Ppl pulls suction (left) side UP and depresses open (right) side DOWN against ruler
  const halfDisp = -pressure * (cmScale * 0.5);
  const leftLevelY = p.constrain(zeroY - halfDisp, my + 24, tubeBottomY - 4);
  const rightLevelY = p.constrain(zeroY + halfDisp, my + 24, tubeBottomY - 4);

  p.stroke("#0d7c86");
  p.strokeWeight(4);
  p.beginShape();
  p.vertex(tubeLeftX, leftLevelY);
  p.vertex(tubeLeftX, tubeBottomY);
  p.vertex(tubeRightX, tubeBottomY);
  p.vertex(tubeRightX, rightLevelY);
  p.endShape();

  // Manometer current reading readout
  p.noStroke();
  p.fill("#0d7c86");
  p.textSize(9);
  p.text(`${pressure.toFixed(1)}`, mx - 4, rightLevelY + 3);

  p.pop();
}

function drawLungBlob(p, x, topY, width, isRight, innerBottomY, outerBottomY) {
  const avgBottomY = (innerBottomY + outerBottomY) / 2;
  const height = Math.max(avgBottomY - topY, 8);

  p.push();
  p.translate(x, topY);
  if (!isRight) {
    p.scale(-1, 1);
  }

  const hInner = innerBottomY - topY;
  const hOuter = outerBottomY - topY;

  p.beginShape();
  p.curveVertex(0, 0);
  p.curveVertex(0, 0);
  p.curveVertex(width * 0.5, height * 0.3);
  p.curveVertex(width * 0.6, height * 0.7);
  p.curveVertex(width * 0.3, hOuter);
  p.curveVertex(-width * 0.1, hInner);
  p.curveVertex(-width * 0.45, height * 0.7);
  p.curveVertex(-width * 0.3, height * 0.2);
  p.curveVertex(0, 0);
  p.curveVertex(0, 0);
  p.endShape(p.CLOSE);
  p.pop();
}

function drawParticles(p, layout, flow, raw, fio2, respRate, tidalVolume, deadSpace, cyclePos, cycleEnded, particles) {
  const airwayX = layout.centerX;
  const airwayTopY = layout.mouthY;
  const carinaY = layout.carinaY;
  const leftLungCenterX = layout.centerX - layout.lungOffset + layout.lungWidth * 0.08;
  const rightLungCenterX = layout.centerX + layout.lungOffset - layout.lungWidth * 0.08;
  const lungCenterY = (layout.lungTopY + layout.diaphragmBaseY) * 0.5;

  const flowMagnitude = Math.abs(flow);
  const inhaling = flow > 0.02;
  const exhaling = flow < -0.02;

  // Dead space trapping factor: if VT <= VD, fresh O2 cannot cross carina
  const canPenetrateCarina = tidalVolume > deadSpace * 0.95;

  const resetAmbientO2 = (particle) => {
    particle.type = "o2";
    particle.mode = "ambient";
    const side = p.random() < 0.5 ? -1 : 1;
    particle.x = airwayX + side * p.random(layout.imageSize * 0.08, layout.imageSize * 0.34);
    particle.y = p.random(layout.imageY + 18, airwayTopY + 18);
    particle.life = p.random(50, 140);
  };

  const reserveCO2 = (particle) => {
    particle.type = "co2";
    particle.mode = "reserve";
    particle.branch = p.random() < 0.5 ? "left" : "right";
    const centerX = particle.branch === "left" ? leftLungCenterX : rightLungCenterX;
    particle.x = centerX + p.random(-14, 14);
    particle.y = lungCenterY + p.random(-25, 25);
    particle.life = 0;
  };

  const expelO2ToAir = (particle) => {
    particle.type = "o2";
    particle.mode = "expelled";
    particle.x = airwayX + p.random(-5, 5);
    particle.y = airwayTopY - 12;
    particle.vx = p.random(-2.2, 2.2);
    particle.vy = p.random(-1.8, -0.4);
    particle.life = p.random(35, 80);
  };

  const activateAlveolarCO2 = (particle) => {
    particle.type = "co2";
    particle.mode = "alveolar";
    particle.branch = p.random() < 0.5 ? "left" : "right";
    const centerX = particle.branch === "left" ? leftLungCenterX : rightLungCenterX;
    particle.x = centerX + p.random(-10, 10);
    particle.y = lungCenterY + p.random(-20, 20);
    particle.life = p.random(50, 110);
  };

  const moveToward = (particle, tx, ty, speed) => {
    const dx = tx - particle.x;
    const dy = ty - particle.y;
    const dist = Math.hypot(dx, dy) || 1;
    particle.x += (dx / dist) * speed;
    particle.y += (dy / dist) * speed;
    return dist;
  };

  const desiredO2Share = p.constrain(mapRange(fio2, 0.1, 1, 0.2, 0.95), 0.2, 0.95);
  const desiredO2Count = Math.round(particles.length * desiredO2Share);
  const currentO2Count = particles.filter((particle) => particle.type === "o2").length;
  if (currentO2Count > desiredO2Count) {
    let excess = currentO2Count - desiredO2Count;
    for (const particle of particles) {
      if (excess <= 0) break;
      if (particle.type === "o2" && (particle.mode === "ambient" || particle.mode === "expelled")) {
        reserveCO2(particle);
        excess -= 1;
      }
    }
  } else if (currentO2Count < desiredO2Count) {
    let deficit = desiredO2Count - currentO2Count;
    for (const particle of particles) {
      if (deficit <= 0) break;
      if (particle.type === "co2" && particle.mode === "reserve") {
        resetAmbientO2(particle);
        deficit -= 1;
      }
    }
  }

  for (const particle of particles) {
    if (!particle.mode || particle.mode === "floating") {
      if (particle.type === "o2") resetAmbientO2(particle);
      else reserveCO2(particle);
    }

    const speed = mapRange(flowMagnitude, 0, 1, 0.4, 3.5) * (1 - (raw / 20) * 0.45);

    if (particle.type === "o2") {
      if (particle.mode === "ambient") {
        particle.x += Math.sin(p.frameCount * 0.025 + particle.phase) * 0.9;
        particle.y -= 0.2;
        if (inhaling) {
          const dx = airwayX - particle.x;
          const dy = airwayTopY - particle.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 140) {
            const suction = mapRange(dist, 0, 140, 0.16, 0.02) * flowMagnitude;
            particle.x += dx * suction;
            particle.y += dy * suction;
          }
          if (dist < 26 && p.random() < 0.06 * flowMagnitude) {
            particle.mode = "in_trachea";
            particle.x = airwayX;
            particle.y = airwayTopY;
            particle.branch = p.random() < 0.5 ? "left" : "right";
          }
        }
        if (particle.y < layout.imageY - 20) resetAmbientO2(particle);
      } else if (particle.mode === "in_trachea") {
        particle.x += (airwayX - particle.x) * 0.35;
        if (exhaling) {
          // Exhaling: airflow is upwards towards the mouth
          particle.y -= speed * 2.5;
          if (particle.y <= airwayTopY) {
            expelO2ToAir(particle);
          }
        } else {
          // Inhaling: airflow is downwards towards the carina
          particle.y += speed * 2.5;
          const freshFraction = Math.max(0, tidalVolume - deadSpace) / Math.max(1, tidalVolume);
          if (particle.y >= carinaY - 12) {
            if (freshFraction > 0.05 && (particle.penetrates !== undefined ? particle.penetrates : (particle.penetrates = p.random() < freshFraction))) {
              if (particle.y >= carinaY) {
                particle.mode = particle.branch === "left" ? "left_branch_in" : "right_branch_in";
                delete particle.penetrates;
              }
            } else {
              // Dead space trapped: cannot penetrate carina into alveolar gas
              particle.y = carinaY - 12;
            }
          }
        }
      } else if (particle.mode === "left_branch_in") {
        const leftHilumX = layout.centerX - layout.lungOffset + layout.lungWidth * 0.24;
        const hilumY = layout.lungTopY + layout.hilumYOffset;
        if (moveToward(particle, leftHilumX, hilumY, speed * 2.1) < 5) {
          particle.mode = "alveolar_store";
          particle.life = p.random(150, 300);
          particle.tx = leftLungCenterX + p.random(-20, 12);
          particle.ty = lungCenterY + p.random(-25, 20);
        }
      } else if (particle.mode === "right_branch_in") {
        const rightHilumX = layout.centerX + layout.lungOffset - layout.lungWidth * 0.24;
        const hilumY = layout.lungTopY + layout.hilumYOffset;
        if (moveToward(particle, rightHilumX, hilumY, speed * 2.1) < 5) {
          particle.mode = "alveolar_store";
          particle.life = p.random(150, 300);
          particle.tx = rightLungCenterX + p.random(-12, 20);
          particle.ty = lungCenterY + p.random(-25, 20);
        }
      } else if (particle.mode === "alveolar_store") {
        moveToward(particle, particle.tx, particle.ty, 0.45);
        particle.life -= 0.6;
        if (particle.life <= 0) resetAmbientO2(particle);
      } else if (particle.mode === "expelled") {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= 1;
        if (particle.life <= 0) resetAmbientO2(particle);
      }
    } else {
      // CO2 particle logic
      if (particle.mode === "reserve") continue;
      if (particle.mode === "alveolar") {
        const targetX = particle.branch === "left" ? leftLungCenterX : rightLungCenterX;
        particle.x += (targetX - particle.x) * 0.05 + Math.sin(p.frameCount * 0.02 + particle.phase) * 0.18;
        particle.y += (lungCenterY - particle.y) * 0.04 + Math.cos(p.frameCount * 0.025 + particle.phase) * 0.18;
        if (exhaling && p.random() < 0.025 * flowMagnitude) {
          particle.mode = particle.branch === "left" ? "left_branch_out" : "right_branch_out";
        }
      } else if (particle.mode === "left_branch_out" || particle.mode === "right_branch_out") {
        if (moveToward(particle, airwayX, carinaY, speed * 2.0) < 5) {
          particle.mode = "up_trachea";
        }
      } else if (particle.mode === "up_trachea") {
        particle.x += (airwayX - particle.x) * 0.35;
        particle.y -= speed * 2.8;
        if (particle.y <= airwayTopY - 14) {
          particle.mode = "dissipate";
          particle.life = p.random(35, 80);
          particle.vx = p.random(-1.8, 1.8);
          particle.vy = p.random(-1.5, -0.3);
        }
      } else if (particle.mode === "dissipate") {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= 1;
        if (particle.life <= 0) reserveCO2(particle);
      }
    }

    if (cycleEnded && particle.type === "o2" && (particle.mode === "in_trachea" || particle.mode === "left_branch_in" || particle.mode === "right_branch_in")) {
      expelO2ToAir(particle);
    }

    if (particle.mode === "reserve") continue;

    p.noStroke();
    if (particle.type === "o2") {
      p.fill("#2a9df4");
    } else {
      p.fill("#49a078");
    }
    p.circle(particle.x, particle.y, 5.2);
  }

  // Gradual CO2 generation in alveoli
  mechanicsState.co2SpawnAccumulator += 0.05;
  if (mechanicsState.co2SpawnAccumulator >= 1) {
    const reserveParticle = particles.find((particle) => particle.type === "co2" && particle.mode === "reserve");
    if (reserveParticle) {
      activateAlveolarCO2(reserveParticle);
      mechanicsState.co2SpawnAccumulator -= 1;
    }
  }
}

// ----------------------------------------------------
// P–V Loop & Static Compliance Graph
// ----------------------------------------------------
function drawMechanicsGraph(p, startX, width, height, history, compliance, frc, vt) {
  p.push();
  p.translate(startX + 8, 16);
  const graphWidth = width - 24;
  const graphHeight = height - 32;

  // Background
  p.noStroke();
  p.fill(250, 252, 252);
  p.rect(0, 0, graphWidth, graphHeight, 18);

  // Pressure on X-axis (-26 to 0 cmH2O), Volume on Y-axis (2.0 to 3.6 L)
  const pMin = -26.0;
  const pMax = 0.0;
  const volMin = 2.0;
  const volMax = 3.6;
  const plotLeft = 48;
  const plotRight = graphWidth - 16;
  const plotBottom = graphHeight - 34;
  const plotTop = 26;

  // Grid lines
  p.stroke(220, 230, 228);
  p.strokeWeight(1);
  for (let i = 0; i <= 5; i += 1) {
    const gy = mapRange(i, 0, 5, plotBottom, plotTop);
    p.line(plotLeft, gy, plotRight, gy);
  }
  for (let i = 0; i <= 5; i += 1) {
    const gx = mapRange(i, 0, 5, plotLeft, plotRight);
    p.line(gx, plotTop, gx, plotBottom);
  }

  // Labels & Title
  p.fill(22, 49, 58);
  p.noStroke();
  p.textSize(13);
  p.text("Dynamic Pressure–Volume (P–V) Loop", 16, 18);
  p.textSize(10);
  p.text("Intrapleural Pressure Ppl (cmH2O)", graphWidth * 0.32, graphHeight - 8);

  p.push();
  p.translate(14, graphHeight * 0.65);
  p.rotate(-p.HALF_PI);
  p.text("Lung Volume (L)", 0, 0);
  p.pop();

  // X-axis pressure labels (-25, -20, -15, -10, -5, 0)
  p.textSize(9);
  p.fill(91, 113, 120);
  [-25, -20, -15, -10, -5, 0].forEach((pval) => {
    const px = mapRange(pval, pMin, pMax, plotLeft, plotRight);
    p.text(`${pval}`, px - (pval === 0 ? 3 : 8), graphHeight - 18);
  });

  // Y-axis volume labels (2.0, 2.4, 2.8, 3.2, 3.6)
  [2.0, 2.4, 2.8, 3.2, 3.6].forEach((vval) => {
    const py = mapRange(vval, volMin, volMax, plotBottom, plotTop);
    p.text(`${vval.toFixed(1)}`, 22, py + 3);
  });

  // Draw Static Compliance Line: connects (P_FRC, FRC) to (P_endInsp, FRC + VT)
  // Slope ΔY / ΔX = ΔV / ΔP = CL (Compliance)
  const pStartStat = -5.0;
  const vStartStat = frc;
  const pEndStat = Math.max(pMin, -5.0 - vt / compliance);
  const vEndStat = frc + vt;

  const xStart = mapRange(pStartStat, pMin, pMax, plotLeft, plotRight);
  const yStart = mapRange(vStartStat, volMin, volMax, plotBottom, plotTop);
  const xEnd = mapRange(pEndStat, pMin, pMax, plotLeft, plotRight);
  const yEnd = mapRange(vEndStat, volMin, volMax, plotBottom, plotTop);

  p.stroke("#e9c46a");
  p.strokeWeight(2);
  p.drawingContext.setLineDash([5, 4]);
  p.line(xStart, yStart, xEnd, yEnd);
  p.drawingContext.setLineDash([]);

  p.noStroke();
  p.fill("#b07d12");
  p.textSize(10);
  p.text(`Static Compliance Slope (CL = ${compliance.toFixed(2)})`, Math.max(plotLeft + 6, xEnd - 40), yEnd - 8);

  // Draw Shaded Dynamic P-V Loop from history
  if (history.length > 10) {
    p.noStroke();
    p.fill(13, 124, 134, 25);
    p.beginShape();
    history.forEach((point) => {
      const x = mapRange(point.pressure, pMin, pMax, plotLeft, plotRight);
      const y = mapRange(point.volume, volMin, volMax, plotBottom, plotTop);
      p.vertex(x, y);
    });
    p.endShape(p.CLOSE);

    // Loop outline
    p.noFill();
    p.stroke("#0d7c86");
    p.strokeWeight(2.5);
    p.beginShape();
    history.forEach((point) => {
      const x = mapRange(point.pressure, pMin, pMax, plotLeft, plotRight);
      const y = mapRange(point.volume, volMin, volMax, plotBottom, plotTop);
      p.vertex(x, y);
    });
    p.endShape();

    // Current Operating Point Dot
    const latest = history[history.length - 1];
    const dotX = mapRange(latest.pressure, pMin, pMax, plotLeft, plotRight);
    const dotY = mapRange(latest.volume, volMin, volMax, plotBottom, plotTop);

    p.noStroke();
    p.fill("#e07a5f");
    p.circle(dotX, dotY, 11);
    p.fill(224, 122, 95, 80);
    p.circle(dotX, dotY, 20);
  }

  p.pop();
}

// ----------------------------------------------------
// Model 2: Alveolar Gas Exchange & Hemoglobin Sketch
// ----------------------------------------------------
function initializeRBCs(p, width, height) {
  exchangeState.rbcs = [];
  const count = 8;
  for (let i = 0; i < count; i += 1) {
    const stagedX = mapRange(i, 0, count - 1, -60, width * 0.62);
    exchangeState.rbcs.push({
      x: stagedX,
      y: height * 0.68 + (i % 2 === 0 ? -14 : 14),
      boundSlots: 2,
    });
  }
}

function createExchangeSketch(containerId) {
  return new p5((p) => {
    let bounds = { width: 900, height: 460 };

    const resize = () => {
      const container = document.getElementById(containerId);
      if (!container) return;
      bounds.width = container.clientWidth || 900;
      bounds.height = p.windowWidth < 720 ? 390 : 470;
      p.resizeCanvas(bounds.width, bounds.height);
      initializeRBCs(p, bounds.width, bounds.height);
    };

    p.setup = () => {
      const container = document.getElementById(containerId);
      const canvas = p.createCanvas(bounds.width, bounds.height);
      canvas.parent(container);
      resize();
      p.frameRate(60);
    };

    p.windowResized = resize;

    p.draw = () => {
      p.background(246, 249, 252);
      const dt = Math.max(0.001, Math.min(p.deltaTime ? p.deltaTime / 1000 : 0.016, 0.1));

      // Check if linked to Model 1
      const isLinked = exchangeConfig.linkModel1 ? exchangeConfig.linkModel1.checked : false;
      const model1Data = getStateFromStorage();

      let alveolarPO2 = 100;
      let affinityShift = 0;
      let alveolarPCO2 = 40;

      if (isLinked) {
        // Derive from Model 1's effective alveolar ventilation
        alveolarPO2 = model1Data.pao2 !== undefined ? model1Data.pao2 : 100;
        alveolarPCO2 = model1Data.paco2 !== undefined ? model1Data.paco2 : 40;
        affinityShift = model1Data.shift !== undefined ? model1Data.shift : 0;

        // Sync slider display values without triggering recursive loops
        if (exchangeConfig.alveolarPO2) {
          exchangeConfig.alveolarPO2.max = Math.max(150, Math.ceil(alveolarPO2));
          exchangeConfig.alveolarPO2.min = 20;
          exchangeConfig.alveolarPO2.value = Math.round(alveolarPO2);
          const out = document.querySelector('[data-output="alveolarPO2"]');
          if (out) out.textContent = `${Math.round(alveolarPO2)} mmHg`;
          exchangeConfig.alveolarPO2.disabled = true;
        }
        if (exchangeConfig.affinityShift) {
          exchangeConfig.affinityShift.value = affinityShift.toFixed(1);
          const out = document.querySelector('[data-output="affinityShift"]');
          if (out) {
            if (Math.abs(affinityShift) < 0.1) out.textContent = "Neutral (P50 ≈ 26.6)";
            else out.textContent = affinityShift > 0 ? `+${affinityShift.toFixed(1)} mmHg (Right / Acidosis)` : `${affinityShift.toFixed(1)} mmHg (Left / Alkalosis)`;
          }
          exchangeConfig.affinityShift.disabled = true;
        }
        if (exchangeConfig.linkModel1Status) {
          exchangeConfig.linkModel1Status.className = "efficiency-badge badge-good";
          exchangeConfig.linkModel1Status.textContent = `Linked (V̇A = ${model1Data.va !== undefined ? model1Data.va.toFixed(1) : "4.2"} L/min)`;
        }
      } else {
        if (exchangeConfig.alveolarPO2) {
          alveolarPO2 = Number(exchangeConfig.alveolarPO2.value);
          exchangeConfig.alveolarPO2.disabled = false;
        }
        if (exchangeConfig.affinityShift) {
          affinityShift = Number(exchangeConfig.affinityShift.value);
          exchangeConfig.affinityShift.disabled = false;
        }
        if (exchangeConfig.linkModel1Status) {
          exchangeConfig.linkModel1Status.className = "efficiency-badge badge-warning";
          exchangeConfig.linkModel1Status.textContent = "Manual Override";
        }
      }

      const membraneThickness = Number(exchangeConfig.membraneThickness ? exchangeConfig.membraneThickness.value : 0.5);
      const bloodSpeed = Number(exchangeConfig.bloodFlow ? exchangeConfig.bloodFlow.value : 72);

      // P50 calculation with Bohr effect
      const baseP50 = 26.6;
      const p50 = Math.max(10, baseP50 + affinityShift);

      const membraneY = bounds.height * 0.5;
      const graphStart = bounds.width * 0.65;
      const graphWidth = bounds.width * 0.32;

      // Draw Alveolus, semi-permeable membrane, and Capillary Scene
      drawExchangeScene(p, bounds.width, bounds.height, membraneY, membraneThickness, alveolarPO2, alveolarPCO2);

      // Particles: O2 (blue) and CO2 (green)
      while (exchangeState.particles.length < 95) {
        exchangeState.particles.push({
          x: p.random(20, graphStart - 24),
          y: p.random(28, bounds.height - 26),
          type: p.random() < 0.72 ? "o2" : "co2",
          phase: p.random(1000),
        });
      }

      // Capillary Transit & Oxyhemoglobin Saturation along capillary
      // Fick's Law diffusion factor: rate ~ (Area * deltaP) / Thickness
      const diffusionConductance = 0.5 / membraneThickness; // normal = 1.0; thick = 0.17
      const tissuePO2 = 40; // mmHg venous baseline entering capillary

      // Exponential oxygenation equilibration along capillary length:
      // Thickened membrane or rapid blood transit impairs full equilibration (Fick diffusion limitation)
      const equilibrationRate = (4.0 * diffusionConductance) / (bloodSpeed / 72);
      const endCapillaryPO2 = tissuePO2 + (alveolarPO2 - tissuePO2) * (1 - Math.exp(-equilibrationRate));
      const arterialSat = sigmoidSaturation(endCapillaryPO2, p50);
      const spO2 = Math.round(arterialSat * 100);

      exchangeState.releaseCounter = Math.max(exchangeState.releaseCounter - dt * 2.5, 0);

      const capillaryStart = 35;
      const capillaryEnd = graphStart - 30;
      const capillaryLength = capillaryEnd - capillaryStart;

      for (const rbc of exchangeState.rbcs) {
        rbc.x += bloodSpeed * dt;
        if (rbc.x > capillaryEnd) {
          rbc.x = -80;
          rbc.boundSlots = 2; // mixed venous entry (approx 70% sat)
        }

        // Fractional progress across capillary bed [0, 1]
        const fracAcross = p.constrain((rbc.x - capillaryStart) / capillaryLength, 0, 1);
        const localCapillaryPO2 = tissuePO2 + (alveolarPO2 - tissuePO2) * (1 - Math.exp(-equilibrationRate * fracAcross));
        const targetSat = sigmoidSaturation(localCapillaryPO2, p50);
        const targetSlots = p.constrain(Math.round(targetSat * 4), 0, 4);

        if (targetSlots > rbc.boundSlots && p.random() < 0.16 * Math.max(0.3, diffusionConductance)) {
          rbc.boundSlots += 1;
        } else if (targetSlots < rbc.boundSlots && p.random() < 0.1) {
          rbc.boundSlots -= 1;
          exchangeState.releaseCounter += 1;
        }

        drawRBC(p, rbc.x, rbc.y, rbc.boundSlots);
      }

      // Gas diffusion particle animation
      const gradientO2 = Math.max(alveolarPO2 - tissuePO2, 0) / 75;
      const gradientCO2 = mapRange(affinityShift, -20, 20, 0.4, 1.3);

      for (const particle of exchangeState.particles) {
        if (particle.type === "o2") {
          // O2 diffuses downward across membrane into capillary blood
          particle.y += gradientO2 * 1.5 * Math.max(0.25, diffusionConductance) + Math.sin(p.frameCount * 0.03 + particle.phase) * 0.35;
          particle.x += Math.cos(p.frameCount * 0.02 + particle.phase) * 0.25;
          if (particle.y > membraneY + 80) {
            particle.y = p.random(30, membraneY - 20);
            particle.x = p.random(24, graphStart - 40);
          }
        } else {
          // CO2 diffuses upward out of blood into alveolus
          particle.y -= gradientCO2 * 0.95 + Math.cos(p.frameCount * 0.025 + particle.phase) * 0.35;
          particle.x += Math.sin(p.frameCount * 0.02 + particle.phase) * 0.25;
          if (particle.y < membraneY - 80) {
            particle.y = p.random(membraneY + 24, bounds.height - 26);
            particle.x = p.random(24, graphStart - 40);
          }
        }

        p.noStroke();
        p.fill(particle.type === "o2" ? "#2a9df4" : "#49a078");
        p.circle(particle.x, particle.y, 5.2);
      }

      // Draw Oxyhemoglobin Dissociation Curve Graph
      drawDissociationCurve(p, graphStart, 16, graphWidth, bounds.height - 32, p50, alveolarPO2, tissuePO2, endCapillaryPO2);

      // Derived Metrics
      let spO2Badge = "badge-good";
      let spO2Status = "Normal";
      if (spO2 < 88) {
        spO2Badge = "badge-danger";
        spO2Status = "Severe Hypoxemia!";
      } else if (spO2 < 95) {
        spO2Badge = "badge-warning";
        spO2Status = "Mild Hypoxia";
      }

      const o2DeliveryIndex = (spO2 * (bloodSpeed / 72)).toFixed(0);

      setMetrics("exchange-metrics", [
        {
          label: "Arterial Saturation (SpO2)",
          value: `${spO2}% <span class="efficiency-badge ${spO2Badge}">${spO2Status}</span>`,
        },
        {
          label: "Alveolar Gas Pressures",
          value: `PO2: ${Math.round(alveolarPO2)} &bull; PCO2: ${Math.round(alveolarPCO2)} mmHg`,
        },
        {
          label: "P50 (Affinity)",
          value: `${p50.toFixed(1)} mmHg`,
        },
        {
          label: "Diffusion Conductance",
          value: `${(diffusionConductance * 100).toFixed(0)}% (T = ${membraneThickness.toFixed(1)} µm)`,
        },
        {
          label: "Net O2 Delivery Index",
          value: `${o2DeliveryIndex} units`,
        },
      ]);
    };
  });
}

function drawExchangeScene(p, width, height, membraneY, membraneThickness, pao2, paco2) {
  const sceneWidth = width * 0.65;

  p.noStroke();
  // Alveolus upper chamber
  p.fill(224, 242, 250);
  p.rect(0, 0, sceneWidth, membraneY, 18, 18, 0, 0);

  // Capillary lower chamber
  p.fill(255, 232, 232);
  p.rect(0, membraneY, sceneWidth, height - membraneY, 0, 0, 18, 18);

  // Semi-permeable blood-gas barrier membrane
  // Thickness visually scales with membraneThickness slider
  const memH = mapRange(membraneThickness, 0.5, 3.0, 14, 34);
  p.fill(205, 228, 222);
  p.stroke(170, 205, 195);
  p.strokeWeight(1.5);
  p.rect(0, membraneY - memH / 2, sceneWidth, memH);

  // Labels
  p.noStroke();
  p.fill(22, 49, 58, 200);
  p.textSize(14);
  p.text("Alveolus (Gas Phase)", 18, 26);
  p.textSize(11);
  p.text(`PAO2 = ${Math.round(pao2)} mmHg  |  PACO2 = ${Math.round(paco2)} mmHg`, 18, 44);

  p.textSize(12);
  p.text(`Alveolar-Capillary Membrane (${membraneThickness.toFixed(1)} µm)`, 18, membraneY - memH / 2 - 8);

  p.textSize(14);
  p.text("Pulmonary Capillary (Perfusion)", 18, membraneY + memH / 2 + 22);
  p.textSize(10);
  p.fill(197, 58, 67);
  p.text("Mixed Venous Entry (PO2 ≈ 40 mmHg)", 18, height - 16);
  p.text("Oxygenated Arterial Exit →", sceneWidth - 180, height - 16);
}

function drawRBC(p, x, y, boundSlots) {
  p.push();
  p.translate(x, y);
  p.noStroke();

  // Biconcave erythrocyte
  p.fill(197, 58, 67, 235);
  p.ellipse(0, 0, 70, 42);
  p.fill(235, 126, 130, 220);
  p.ellipse(0, 0, 36, 18);

  // 4 Hemoglobin Heme binding sites
  const slotPositions = [-18, -6, 6, 18];
  slotPositions.forEach((slotX, index) => {
    p.stroke(255, 255, 255, 180);
    p.strokeWeight(1.5);
    p.fill(index < boundSlots ? "#2a9df4" : "rgba(255,255,255,0.2)");
    p.circle(slotX, 0, 9);
  });
  p.pop();
}

function drawDissociationCurve(p, x, y, width, height, p50, alveolarPO2, tissuePO2, arterialPO2) {
  p.push();
  p.translate(x, y);

  p.noStroke();
  p.fill(250, 252, 252);
  p.rect(0, 0, width, height, 18);

  // Grid
  p.stroke(215, 225, 225);
  p.strokeWeight(1);
  for (let i = 0; i <= 5; i += 1) {
    const gy = mapRange(i, 0, 5, height - 32, 24);
    p.line(42, gy, width - 16, gy);
  }
  for (let i = 0; i <= 5; i += 1) {
    const gx = mapRange(i, 0, 5, 42, width - 16);
    p.line(gx, 24, gx, height - 32);
  }

  // Sigmoidal Dissociation Curve
  const maxPO2 = 140;
  p.noFill();
  p.stroke("#0d7c86");
  p.strokeWeight(3);
  p.beginShape();
  for (let po2 = 0; po2 <= maxPO2; po2 += 2) {
    const sat = sigmoidSaturation(po2, p50);
    p.vertex(mapRange(po2, 0, maxPO2, 42, width - 16), mapRange(sat, 0, 1, height - 32, 24));
  }
  p.endShape();

  // Operating Points: Alveolar, Arterial (if A-a gradient exists), and Tissue
  const alveolarSat = sigmoidSaturation(alveolarPO2, p50);
  const tissueSat = sigmoidSaturation(tissuePO2, p50);
  const artPO2 = arterialPO2 !== undefined ? arterialPO2 : alveolarPO2;
  const arterialSat = sigmoidSaturation(artPO2, p50);

  // Alveolar point
  const alvX = mapRange(p.constrain(alveolarPO2, 0, maxPO2), 0, maxPO2, 42, width - 16);
  const alvY = mapRange(alveolarSat, 0, 1, height - 32, 24);
  p.noStroke();
  p.fill("#e07a5f");
  p.circle(alvX, alvY, 11);

  // Tissue point
  const tisX = mapRange(tissuePO2, 0, maxPO2, 42, width - 16);
  const tisY = mapRange(tissueSat, 0, 1, height - 32, 24);
  p.fill("#e9c46a");
  p.circle(tisX, tisY, 10);

  // Arterial point (visualize A-a gradient when diffusion limitation exists)
  if (Math.abs(artPO2 - alveolarPO2) > 2) {
    const artX = mapRange(p.constrain(artPO2, 0, maxPO2), 0, maxPO2, 42, width - 16);
    const artY = mapRange(arterialSat, 0, 1, height - 32, 24);
    p.fill("#2a9df4");
    p.circle(artX, artY, 9);
  }

  // Labels & Axes
  p.fill(22, 49, 58);
  p.textSize(13);
  p.text("Oxyhemoglobin Dissociation", 14, 18);
  p.textSize(11);
  p.text("PO2 (mmHg)", width * 0.42, height - 8);

  p.push();
  p.translate(12, height * 0.58);
  p.rotate(-p.HALF_PI);
  p.text("SaO2 Saturation", 0, 0);
  p.pop();

  p.textSize(10);
  p.fill("#e07a5f");
  p.text(`Alveolar (PAO2): ${Math.round(alveolarSat * 100)}% (${Math.round(alveolarPO2)} mmHg)`, 44, 36);
  if (Math.abs(artPO2 - alveolarPO2) > 2) {
    p.fill("#2a9df4");
    p.text(`Arterial (PaO2): ${Math.round(arterialSat * 100)}% (${Math.round(artPO2)} mmHg)`, 44, 49);
    p.fill("#b07d12");
    p.text(`Venous (PvO2): ${Math.round(tissueSat * 100)}% (${tissuePO2} mmHg)`, 44, 62);
  } else {
    p.fill("#b07d12");
    p.text(`Venous (PvO2): ${Math.round(tissueSat * 100)}% (${tissuePO2} mmHg)`, 44, 49);
  }
  p.pop();
}

// ----------------------------------------------------
// Initialization
// ----------------------------------------------------
if (document.getElementById("mechanics-canvas")) {
  createMechanicsSketch("mechanics-canvas");
}
if (document.getElementById("exchange-canvas")) {
  createExchangeSketch("exchange-canvas");
}