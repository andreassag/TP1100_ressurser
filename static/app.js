const mechanicsState = {
  history: [],
  particles: [],
  time: 0,
  displayFlow: 0,
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

const mechanicsConfig = {
  respRate: document.getElementById("respRate"),
  tidalVolume: document.getElementById("tidalVolume"),
  airwayResistance: document.getElementById("airwayResistance"),
  fio2: document.getElementById("fio2"),
};

const exchangeConfig = {
  affinityShift: document.getElementById("affinityShift"),
  alveolarPO2: document.getElementById("alveolarPO2"),
  bloodFlow: document.getElementById("bloodFlow"),
};

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
  if (key === "tidalVolume") return `${value} px diaphragm excursion`;
  if (key === "airwayResistance") return `${value}% narrowing`;
  return `${value}% O2`;
});

bindOutputs(exchangeConfig, (key, value) => {
  if (key === "affinityShift") {
    if (value === 0) return "Neutral curve";
    return value > 0 ? `${value} right shift` : `${Math.abs(value)} left shift`;
  }
  if (key === "alveolarPO2") return `${value} mmHg`;
  return `${value} px/s`;
});

function setMetrics(elementId, items) {
  const host = document.getElementById(elementId);
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
  const num = Math.pow(po2, hill);
  return num / (num + Math.pow(p50, hill));
}

function createMechanicsSketch(containerId) {
  return new p5((p) => {
    let bounds = { width: 900, height: 460 };
    let upperBodyImage;

    p.preload = () => {
      upperBodyImage = p.loadImage("/assets/upper_body.png");
    };

    const ensureParticles = () => {
      while (mechanicsState.particles.length < 110) {
        const fio2 = Number(mechanicsConfig.fio2.value) / 100;
        const o2Share = mapRange(fio2, 0.1, 1, 0.68, 0.95);
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
      bounds.width = container.clientWidth || 900;
      bounds.height = p.windowWidth < 720 ? 380 : 460;
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
      mechanicsState.time += p.deltaTime / 1000;

      const rate = Number(mechanicsConfig.respRate.value);
      const tidal = Number(mechanicsConfig.tidalVolume.value);
      const resistance = Number(mechanicsConfig.airwayResistance.value) / 100;
      const fio2 = Number(mechanicsConfig.fio2.value) / 100;

      const torsoWidth = bounds.width * 0.52;
      const cycle = mechanicsState.time * (rate / 60) * p.TWO_PI;
      const inhaleSignal = (Math.sin(cycle - p.HALF_PI) + 1) / 2;
      const cyclePos = ((mechanicsState.time * rate) / 60) % 1;
      const cycleEnded = mechanicsState.prevCyclePos !== null && cyclePos < mechanicsState.prevCyclePos;
      mechanicsState.prevCyclePos = cyclePos;
      const diaphragmDrop = 28 + inhaleSignal * tidal;
      const diaphragmVelocity = mechanicsState.prevDiaphragmDrop === null ? 0 : diaphragmDrop - mechanicsState.prevDiaphragmDrop;
      const lungVolume = 2.4 + mapRange(diaphragmDrop, 28, 123, 0.2, 1.85);
      const pressure = -1.2 - (lungVolume - 2.6) * 2.25;
      let targetFlow = 0;
      if (diaphragmVelocity > 0.08) {
        targetFlow = p.constrain(mapRange(diaphragmVelocity, 0.08, 1.4, 0.3, 1), 0.3, 1);
      } else if (diaphragmVelocity < -0.08) {
        targetFlow = -p.constrain(mapRange(Math.abs(diaphragmVelocity), 0.08, 1.4, 0.3, 1), 0.3, 1);
      }
      const lagFactor = mapRange(resistance, 0, 1, 0.22, 0.025);
      mechanicsState.displayFlow += (targetFlow - mechanicsState.displayFlow) * lagFactor;
      mechanicsState.prevDiaphragmDrop = diaphragmDrop;
      const torsoLayout = getTorsoLayout(torsoWidth, bounds.height);

      mechanicsState.history.push({ volume: lungVolume, pressure });
      if (mechanicsState.history.length > 180) {
        mechanicsState.history.shift();
      }

      drawTorso(p, torsoLayout, upperBodyImage, diaphragmDrop, inhaleSignal, resistance, tidal);
      drawParticles(
        p,
        torsoLayout,
        mechanicsState.displayFlow,
        resistance,
        fio2,
        rate,
        tidal,
        cyclePos,
        cycleEnded,
        mechanicsState.particles,
      );
      drawMechanicsGraph(p, torsoWidth, bounds.width - torsoWidth, bounds.height, mechanicsState.history);

      mechanicsState.lastMetrics = {
        lungVolume,
        pressure,
        flow: mechanicsState.displayFlow,
        tidal,
      };

      setMetrics("mechanics-metrics", [
        { label: "Lung Volume", value: `${lungVolume.toFixed(2)} L` },
        { label: "Intrapleural Pressure", value: `${pressure.toFixed(2)} cmH2O` },
        { label: "Airflow Response", value: `${(mechanicsState.displayFlow * 100).toFixed(0)}%` },
      ]);
    };
  });
}

function getTorsoLayout(width, height) {
  const imageSize = Math.min(height - 22, width - 12);
  const imageX = (width - imageSize) / 2;
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
    lungOffset: imageSize * 0.095,
    lungWidth: imageSize * 0.188,
    lungBaseHeight: imageSize * 0.3,
    lungMinHeight: imageSize * 0.2,
    lungMaxHeight: imageSize * 0.38,
    diaphragmBaseY: imageY + imageSize * 0.84,
    diaphragmEdgeOffset: imageSize * 0.19,
    mouthY: imageY + imageSize * 0.285,
    carinaY: imageY + imageSize * 0.41,
    branchY: imageY + imageSize * 0.48,
    hilumOffset: imageSize * 0.08,
    hilumYOffset: imageSize * 0.075,
    particleYMin: imageY + imageSize * 0.3,
    particleYMax: imageY + imageSize * 0.78,
  };
}

function drawTorso(p, layout, upperBodyImage, diaphragmDrop, inhaleSignal, resistance, tidalVolume) {
  p.push();
  if (upperBodyImage) {
    p.image(upperBodyImage, layout.imageX, layout.imageY, layout.imageSize, layout.imageSize);
  }

  const tidalNorm = mapRange(tidalVolume, 25, 95, 0, 1);

  // Keep diaphragm edges fixed and the dome always above the edge anchors.
  const diaphragmEdgeY = layout.diaphragmBaseY + 24;
  const diaphragmRestRise = 34;
  const diaphragmExcursion = mapRange(tidalNorm, 0, 1, 10, 36);
  const diaphragmCenterY = diaphragmEdgeY - diaphragmRestRise + inhaleSignal * diaphragmExcursion;
  const diaphragmInnerRestRise = 22;
  const diaphragmInnerExcursion = mapRange(tidalNorm, 0, 1, 6, 23);
  const diaphragmInnerY = diaphragmEdgeY - diaphragmInnerRestRise + inhaleSignal * diaphragmInnerExcursion;

  // Lungs follow the diaphragm movement more closely to feel linked.
  const currentLungWidth = layout.lungWidth * mapRange(inhaleSignal, 0, 1, 0.98, 1.15);

  const innerXOffset = layout.lungOffset - currentLungWidth * 0.1;
  const outerXOffset = layout.lungOffset + currentLungWidth * 0.3;

  let innerBottomY = mapRange(innerXOffset, 0, layout.lungOffset * 0.9, diaphragmCenterY, diaphragmInnerY);
  let outerBottomY = mapRange(outerXOffset, layout.lungOffset * 0.9, layout.diaphragmEdgeOffset, diaphragmInnerY, diaphragmEdgeY);

  innerBottomY -= 2.5;
  outerBottomY -= 2.5;

  p.noStroke();
  p.fill(208, 89, 108, 196);
  drawLungBlob(p, layout.centerX - layout.lungOffset, layout.lungTopY, currentLungWidth, false, innerBottomY, outerBottomY);
  drawLungBlob(p, layout.centerX + layout.lungOffset, layout.lungTopY, currentLungWidth, true, innerBottomY, outerBottomY);

  const leftHilumX = layout.centerX - layout.lungOffset + currentLungWidth * 0.24;
  const rightHilumX = layout.centerX + layout.lungOffset - currentLungWidth * 0.24;
  const hilumY = layout.lungTopY + layout.hilumYOffset;

  const tracheaWidth = mapRange(resistance, 0, 1, 16, 6);
  p.stroke(11, 103, 117, 200);
  p.strokeWeight(tracheaWidth);
  p.line(layout.centerX, layout.mouthY, layout.centerX, layout.carinaY);
  p.line(layout.centerX, layout.carinaY, leftHilumX, hilumY);
  p.line(layout.centerX, layout.carinaY, rightHilumX, hilumY);

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

  p.noStroke();
  p.fill(22, 49, 58, 176);
  p.textSize(14);
  p.text("Torso cross-section", 16, 20);
  p.text("Trachea", layout.centerX - 24, layout.mouthY - 8);
  p.pop();
}

function drawLungBlob(p, x, topY, width, isRight, innerBottomY, outerBottomY) {
  // Use a base height for the upper structure based on an average bottom Y
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
  // Create a more organic, lung-like silhouette
  p.curveVertex(0, 0); 
  p.curveVertex(0, 0);
  p.curveVertex(width * 0.5, height * 0.3);   // Upper outer lobe
  p.curveVertex(width * 0.6, height * 0.7);   // Lower outer lobe
  p.curveVertex(width * 0.3, hOuter);         // Bottom outer corner touches diaphragm
  p.curveVertex(-width * 0.1, hInner);        // Bottom inner curve touches diaphragm
  p.curveVertex(-width * 0.45, height * 0.7); // Lower inner
  p.curveVertex(-width * 0.3, height * 0.2);  // Upper inner (near hilum)
  p.curveVertex(0, 0);
  p.curveVertex(0, 0);
  p.endShape(p.CLOSE);
  p.pop();
}

function drawParticles(p, layout, flow, resistance, fio2, respRate, tidalVolume, cyclePos, cycleEnded, particles) {
  const airwayX = layout.centerX;
  const airwayTopY = layout.mouthY;
  const carinaY = layout.carinaY;
  const leftLungCenterX = layout.centerX - layout.lungOffset + layout.lungWidth * 0.08;
  const rightLungCenterX = layout.centerX + layout.lungOffset - layout.lungWidth * 0.08;
  const inhaleSignal = (Math.sin(cyclePos * p.TWO_PI - p.HALF_PI) + 1) / 2;
  const diaphragmEdgeY = layout.diaphragmBaseY + 24;
  const diaphragmInnerRestRise = 22;
  const tidalNorm = mapRange(tidalVolume, 25, 95, 0, 1);
  const diaphragmInnerExcursion = mapRange(tidalNorm, 0, 1, 6, 23);
  const diaphragmInnerY = diaphragmEdgeY - diaphragmInnerRestRise + inhaleSignal * diaphragmInnerExcursion;
  const lungBottomY = diaphragmInnerY - 3;
  const currentLungCenterY = (layout.lungTopY + lungBottomY) * 0.5;
  const lungHeight = lungBottomY - layout.lungTopY;

  const flowMagnitude = Math.abs(flow);
  const inhaling = flow > 0.02;
  const exhaling = flow < -0.02;
  const inhaleStrength = flowMagnitude;
  const o2CaptureFactor = 1.0;
  const co2ClearanceFactor = 1.0;
  const lungCenterY = currentLungCenterY;
  
  const currentLungWidth = layout.lungWidth * mapRange(inhaleSignal, 0, 1, 0.98, 1.15);
  const leftHilumX = layout.centerX - layout.lungOffset + currentLungWidth * 0.24;
  const rightHilumX = layout.centerX + layout.lungOffset - currentLungWidth * 0.24;
  const hilumY = layout.lungTopY + layout.hilumYOffset;

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
    particle.y = currentLungCenterY + p.random(-lungHeight * 0.15, lungHeight * 0.15);
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
    particle.y = currentLungCenterY + p.random(-lungHeight * 0.12, lungHeight * 0.12);
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

  // FiO2 controls ambient O2 availability and therefore inspiratory supply.
  const desiredO2Share = p.constrain(mapRange(fio2, 0.1, 1, 0.18, 0.95), 0.18, 0.95);
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

  const leftStoredO2 = particles.filter((particle) => particle.type === "o2" && particle.mode === "alveolar_store" && particle.branch === "left").length;
  const rightStoredO2 = particles.filter((particle) => particle.type === "o2" && particle.mode === "alveolar_store" && particle.branch === "right").length;
  let leftStoreCount = leftStoredO2;
  let rightStoreCount = rightStoredO2;

  for (const particle of particles) {
    if (!particle.mode || particle.mode === "floating") {
      if (particle.type === "o2") {
        resetAmbientO2(particle);
      } else {
        reserveCO2(particle);
      }
    }

    const speed = mapRange(flowMagnitude, 0, 1, 0.35, 3.4) * (1 - resistance * 0.5);

    if (particle.type === "o2") {
      if (particle.mode === "ambient") {
        // Outside-body O2 disperses in ambient air with slight upward drift.
        particle.x += Math.sin(p.frameCount * 0.025 + particle.phase) * 0.9;
        particle.y -= 0.2 + Math.cos(p.frameCount * 0.02 + particle.phase) * 0.12;
        if (inhaling) {
          const dx = airwayX - particle.x;
          const dy = airwayTopY - particle.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 150) {
            const suction = mapRange(dist, 0, 150, 0.16, 0.02) * (0.25 + flowMagnitude * 0.7) * (0.25 + inhaleStrength * 0.75);
            particle.x += dx * suction;
            particle.y += dy * suction;
          }
          const nearMouth = dist < 28;
          if (nearMouth && p.random() < (0.02 + flowMagnitude * 0.06) * o2CaptureFactor * (0.35 + inhaleStrength * 0.65)) {
            particle.mode = "in_trachea";
            particle.x = airwayX + p.random(-2, 2);
            particle.y = airwayTopY - 14;
            particle.branch = p.random() < 0.5 ? "left" : "right";
          }
        }
        if (particle.y < layout.imageY - 28 || particle.x < layout.imageX - 120 || particle.x > layout.imageX + layout.imageSize + 120) {
          resetAmbientO2(particle);
        }
      } else if (particle.mode === "in_trachea") {
        particle.x += (airwayX - particle.x) * 0.35;
        particle.y += speed * 2.6;
        if (particle.y >= carinaY) {
          particle.mode = particle.branch === "left" ? "left_branch_in" : "right_branch_in";
        }
      } else if (particle.mode === "left_branch_in") {
        if (moveToward(particle, leftHilumX, hilumY, speed * 2.1) < 5) {
          if (leftStoreCount < 10) {
            particle.mode = "alveolar_store";
            particle.branch = "left";
            particle.life = p.random(180, 360);
            particle.tx = leftLungCenterX + p.random(-24, 14);
            particle.ty = lungCenterY + p.random(-30, 24);
            leftStoreCount += 1;
          } else {
            expelO2ToAir(particle);
          }
        }
      } else if (particle.mode === "right_branch_in") {
        if (moveToward(particle, rightHilumX, hilumY, speed * 2.1) < 5) {
          if (rightStoreCount < 10) {
            particle.mode = "alveolar_store";
            particle.branch = "right";
            particle.life = p.random(180, 360);
            particle.tx = rightLungCenterX + p.random(-14, 24);
            particle.ty = lungCenterY + p.random(-30, 24);
            rightStoreCount += 1;
          } else {
            expelO2ToAir(particle);
          }
        }
      } else if (particle.mode === "alveolar_store") {
        moveToward(particle, particle.tx, particle.ty, 0.45 + speed * 0.16);
        particle.life -= 0.6;
        particle.x += Math.sin(p.frameCount * 0.02 + particle.phase) * 0.08;
        particle.y += Math.cos(p.frameCount * 0.02 + particle.phase) * 0.08;
        if (particle.life <= 0) {
          resetAmbientO2(particle);
        }
      } else if (particle.mode === "expelled") {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= 1;
        particle.vx *= 0.985;
        particle.vy *= 0.985;
        if (particle.life <= 0 || particle.y < layout.imageY - 40 || particle.x < layout.imageX - 140 || particle.x > layout.imageX + layout.imageSize + 140) {
          resetAmbientO2(particle);
        }
      }
    } else {
      if (particle.mode === "reserve") {
        continue;
      }

      if (particle.mode === "alveolar") {
        const targetX = particle.branch === "left" ? leftLungCenterX : rightLungCenterX;
        particle.x += (targetX - particle.x) * 0.06 + Math.sin(p.frameCount * 0.02 + particle.phase) * 0.18;
        particle.y += (currentLungCenterY - particle.y) * 0.04 + Math.cos(p.frameCount * 0.025 + particle.phase) * 0.18;
        if (exhaling && p.random() < (0.012 + flowMagnitude * 0.04) * co2ClearanceFactor) {
          particle.mode = particle.branch === "left" ? "left_branch_out" : "right_branch_out";
        }
      } else if (particle.mode === "left_branch_out") {
        if (moveToward(particle, airwayX, carinaY, speed * 2.0) < 5) {
          particle.mode = "up_trachea";
        }
      } else if (particle.mode === "right_branch_out") {
        if (moveToward(particle, airwayX, carinaY, speed * 2.0) < 5) {
          particle.mode = "up_trachea";
        }
      } else if (particle.mode === "up_trachea") {
        particle.x += (airwayX - particle.x) * 0.35;
        particle.y -= speed * 2.8;
        if (particle.y <= airwayTopY - 18) {
          particle.mode = "dissipate";
          particle.life = p.random(40, 95);
          particle.vx = p.random(-1.8, 1.8);
          particle.vy = p.random(-1.6, -0.3);
        }
      } else if (particle.mode === "dissipate") {
        // Exhaled CO2 disperses away from mouth and leaves the scene.
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= 1;
        particle.vx *= 0.985;
        particle.vy *= 0.985;
        if (particle.life <= 0 || particle.y < layout.imageY - 40 || particle.x < layout.imageX - 140 || particle.x > layout.imageX + layout.imageSize + 140) {
          reserveCO2(particle);
        }
      }
    }

    // At respiratory cycle end, any O2 still in airway path is expelled back out.
    if (
      cycleEnded
      && particle.type === "o2"
      && (particle.mode === "in_trachea" || particle.mode === "left_branch_in" || particle.mode === "right_branch_in")
    ) {
      expelO2ToAir(particle);
    }

    // Keep trachea transport tightly within airway path for pedagogy.
    if (particle.mode === "in_trachea" || particle.mode === "up_trachea") {
      particle.x = p.constrain(particle.x, airwayX - 5, airwayX + 5);
    }

    // Draw only active particles.
    if (particle.mode === "reserve") {
      continue;
    }

    p.noStroke();
    if (particle.type === "o2" && particle.mode === "alveolar_store") {
      p.fill(42, 157, 244, mapRange(particle.life, 0, 360, 0, 210));
    } else {
      p.fill(particle.type === "o2" ? "#2a9df4" : "#49a078");
    }
    p.circle(particle.x, particle.y, particle.type === "o2" ? 5.4 : 5.4);
  }

  // CO2 appears in alveoli at a fixed gradual rate.
  mechanicsState.co2SpawnAccumulator += 0.055;
  if (mechanicsState.co2SpawnAccumulator >= 1) {
    const reserveParticle = particles.find((particle) => particle.type === "co2" && particle.mode === "reserve");
    if (reserveParticle) {
      activateAlveolarCO2(reserveParticle);
      mechanicsState.co2SpawnAccumulator -= 1;
    } else {
      mechanicsState.co2SpawnAccumulator = 0.95;
    }
  }
}

function drawMechanicsGraph(p, startX, width, height, history) {
  p.push();
  p.translate(startX + 10, 18);
  const graphWidth = width - 26;
  const graphHeight = height - 36;

  p.noStroke();
  p.fill(250, 252, 252);
  p.rect(0, 0, graphWidth, graphHeight, 20);

  p.stroke(210, 220, 220);
  p.strokeWeight(1);
  for (let i = 0; i <= 4; i += 1) {
    const y = mapRange(i, 0, 4, 20, graphHeight - 30);
    p.line(46, y, graphWidth - 14, y);
  }
  for (let i = 0; i <= 4; i += 1) {
    const x = mapRange(i, 0, 4, 46, graphWidth - 14);
    p.line(x, 20, x, graphHeight - 30);
  }

  p.fill(22, 49, 58);
  p.noStroke();
  p.textSize(14);
  p.text("Intrapleural Pressure vs Lung Volume", 16, 18);
  p.textSize(12);
  p.text("Volume (L)", graphWidth * 0.44, graphHeight - 8);
  p.push();
  p.translate(12, graphHeight * 0.62);
  p.rotate(-p.HALF_PI);
  p.text("Pressure (cmH2O)", 0, 0);
  p.pop();

  p.noFill();
  p.stroke("#0d7c86");
  p.strokeWeight(3);
  p.beginShape();
  history.forEach((point) => {
    const x = mapRange(point.volume, 2.2, 4.6, 46, graphWidth - 14);
    const y = mapRange(point.pressure, -6.4, 1.5, graphHeight - 30, 20);
    p.vertex(x, y);
  });
  p.endShape();

  if (history.length) {
    const last = history[history.length - 1];
    p.noStroke();
    p.fill("#e07a5f");
    p.circle(mapRange(last.volume, 2.2, 4.6, 46, graphWidth - 14), mapRange(last.pressure, -6.4, 1.5, graphHeight - 30, 20), 10);
  }
  p.pop();
}

function initializeRBCs(p, width, height) {
  exchangeState.rbcs = [];
  for (let i = 0; i < 7; i += 1) {
    const stagedX = mapRange(i, 0, 6, -40, width * 0.56);
    exchangeState.rbcs.push({
      x: stagedX,
      y: height * 0.68 + (i % 2 === 0 ? -16 : 14),
      boundSlots: i < 4 ? 3 : 2,
    });
  }
}

function createExchangeSketch(containerId) {
  return new p5((p) => {
    let bounds = { width: 900, height: 460 };

    const resize = () => {
      const container = document.getElementById(containerId);
      bounds.width = container.clientWidth || 900;
      bounds.height = p.windowWidth < 720 ? 390 : 460;
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
      const shift = Number(exchangeConfig.affinityShift.value);
      const alveolarPO2 = Number(exchangeConfig.alveolarPO2.value);
      const bloodSpeed = Number(exchangeConfig.bloodFlow.value);
      const p50 = 26 + shift * 0.55;
      const membraneY = bounds.height * 0.5;
      const graphStart = bounds.width * 0.66;
      const graphWidth = bounds.width * 0.31;

      drawExchangeScene(p, bounds.width, bounds.height, membraneY);

      const dt = p.deltaTime / 1000;
      while (exchangeState.particles.length < 90) {
        exchangeState.particles.push({
          x: p.random(20, graphStart - 24),
          y: p.random(28, bounds.height - 26),
          type: p.random() < 0.7 ? "o2" : "co2",
          direction: p.random() < 0.7 ? 1 : -1,
          phase: p.random(1000),
        });
      }

      const tissuePO2 = 40;
      let averageSaturation = 0;
      let displayedRelease = 0;
      exchangeState.releaseCounter = Math.max(exchangeState.releaseCounter - dt * 3.2, 0);
      for (const rbc of exchangeState.rbcs) {
        rbc.x += bloodSpeed * dt;
        if (rbc.x > graphStart - 18) {
          rbc.x = -100;
          rbc.boundSlots = 2;
        }

        const underAlveolus = rbc.x > 40 && rbc.x < graphStart - 170;
        const localPO2 = underAlveolus ? alveolarPO2 : tissuePO2;
        const targetSat = sigmoidSaturation(localPO2, p50);
        const targetSlots = Math.round(targetSat * 4);
        if (targetSlots > rbc.boundSlots && p.random() < 0.08) {
          rbc.boundSlots += 1;
        }
        if (targetSlots < rbc.boundSlots && p.random() < 0.06 + Math.max(shift, 0) * 0.0025) {
          rbc.boundSlots -= 1;
          displayedRelease += 1;
          exchangeState.releaseCounter += 1;
        }

        averageSaturation += rbc.boundSlots / 4;
        drawRBC(p, rbc.x, rbc.y, rbc.boundSlots);
      }
      averageSaturation /= exchangeState.rbcs.length;

      const gradientO2 = Math.max(alveolarPO2 - tissuePO2, 0) / 80;
      const gradientCO2 = mapRange(shift, -20, 20, 0.2, 1);
      for (const particle of exchangeState.particles) {
        if (particle.type === "o2") {
          particle.y += particle.direction * gradientO2 * 1.5 + Math.sin(p.frameCount * 0.03 + particle.phase) * 0.18;
          if (particle.y > membraneY + 90) {
            particle.y = p.random(30, membraneY - 20);
            particle.x = p.random(24, graphStart - 40);
          }
        } else {
          particle.y -= gradientCO2 * 0.9 + Math.cos(p.frameCount * 0.025 + particle.phase) * 0.14;
          if (particle.y < membraneY - 94) {
            particle.y = p.random(membraneY + 24, bounds.height - 26);
            particle.x = p.random(24, graphStart - 40);
          }
        }

        p.noStroke();
        p.fill(particle.type === "o2" ? "#2a9df4" : "#49a078");
        p.circle(particle.x, particle.y, 5.5);
      }

      drawDissociationCurve(p, graphStart, 16, graphWidth, bounds.height - 32, p50, alveolarPO2, tissuePO2);

      exchangeState.lastMetrics = {
        saturation: averageSaturation,
        p50,
        release: exchangeState.releaseCounter,
      };

      setMetrics("exchange-metrics", [
        { label: "Mean Hb Saturation", value: `${(averageSaturation * 100).toFixed(0)}%` },
        { label: "P50", value: `${p50.toFixed(1)} mmHg` },
        { label: "O2 Release Events", value: `${Math.round(exchangeState.releaseCounter)}` },
      ]);
    };
  });
}

function drawExchangeScene(p, width, height, membraneY) {
  p.noStroke();
  p.fill(224, 242, 250);
  p.rect(0, 0, width * 0.66, membraneY, 20, 20, 0, 0);
  p.fill(255, 232, 232);
  p.rect(0, membraneY, width * 0.66, height - membraneY, 0, 0, 20, 20);

  p.fill(215, 233, 227);
  p.rect(0, membraneY - 10, width * 0.66, 20);

  p.fill(22, 49, 58, 180);
  p.textSize(15);
  p.text("Alveolus", 18, 24);
  p.text("Semi-permeable membrane", 18, membraneY - 16);
  p.text("Capillary", 18, membraneY + 28);
}

function drawRBC(p, x, y, boundSlots) {
  p.push();
  p.translate(x, y);
  p.noStroke();
  p.fill(197, 58, 67, 230);
  p.ellipse(0, 0, 72, 44);
  p.fill(235, 126, 130, 220);
  p.ellipse(0, 0, 38, 20);

  const slotPositions = [-18, -6, 6, 18];
  slotPositions.forEach((slotX, index) => {
    p.stroke(255, 255, 255, 160);
    p.strokeWeight(1.5);
    p.fill(index < boundSlots ? "#2a9df4" : "rgba(255,255,255,0.18)");
    p.circle(slotX, 0, 10);
  });
  p.pop();
}

function drawDissociationCurve(p, x, y, width, height, p50, alveolarPO2, tissuePO2) {
  p.push();
  p.translate(x, y);

  p.noStroke();
  p.fill(250, 252, 252);
  p.rect(0, 0, width, height, 20);

  p.stroke(210, 220, 220);
  p.strokeWeight(1);
  for (let i = 0; i <= 5; i += 1) {
    const gy = mapRange(i, 0, 5, height - 30, 24);
    p.line(42, gy, width - 16, gy);
  }
  for (let i = 0; i <= 5; i += 1) {
    const gx = mapRange(i, 0, 5, 42, width - 16);
    p.line(gx, 24, gx, height - 30);
  }

  p.noFill();
  p.stroke("#0d7c86");
  p.strokeWeight(3);
  p.beginShape();
  for (let po2 = 0; po2 <= 110; po2 += 2) {
    const sat = sigmoidSaturation(po2, p50);
    p.vertex(mapRange(po2, 0, 110, 42, width - 16), mapRange(sat, 0, 1, height - 30, 24));
  }
  p.endShape();

  const alveolarSat = sigmoidSaturation(alveolarPO2, p50);
  const tissueSat = sigmoidSaturation(tissuePO2, p50);
  p.noStroke();
  p.fill("#e07a5f");
  p.circle(mapRange(alveolarPO2, 0, 110, 42, width - 16), mapRange(alveolarSat, 0, 1, height - 30, 24), 10);
  p.fill("#e9c46a");
  p.circle(mapRange(tissuePO2, 0, 110, 42, width - 16), mapRange(tissueSat, 0, 1, height - 30, 24), 10);

  p.fill(22, 49, 58);
  p.textSize(14);
  p.text("Oxygen-Hemoglobin Dissociation Curve", 14, 18);
  p.textSize(12);
  p.text("PO2 (mmHg)", width * 0.44, height - 8);
  p.push();
  p.translate(12, height * 0.58);
  p.rotate(-p.HALF_PI);
  p.text("Saturation", 0, 0);
  p.pop();
  p.text(`Alveolus ${Math.round(alveolarSat * 100)}%`, 44, 38);
  p.text(`Tissue ${Math.round(tissueSat * 100)}%`, 44, 54);
  p.pop();
}

if (document.getElementById("mechanics-canvas")) {
  createMechanicsSketch("mechanics-canvas");
}
if (document.getElementById("exchange-canvas")) {
  createExchangeSketch("exchange-canvas");
}