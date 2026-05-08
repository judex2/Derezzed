import * as THREE from 'three';

export class ParticleSystem {
  constructor(containerElement) {
    this.container = containerElement;
    this.particleCount = 12000;
    this.state = 'AMBIENT'; // AMBIENT, MAGNETIC_PULL, STRUCTURAL, EXPLOSION
    
    // Arrays for physics and rendering
    this.positions = new Float32Array(this.particleCount * 3);
    this.ambientTargets = new Float32Array(this.particleCount * 3);
    this.structuralTargets = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.baseColors = new Float32Array(this.particleCount * 3);
    this.themeColor = new THREE.Color("#00ffff");

    this.transitionProgress = 0;
    this.time = 0;

    this.gridWidth = 100;
    this.gridHeight = 100;
    this.arenaSize = 80;

    this.initThree();
    this.initParticles();
  }

  initThree() {
    this.scene = new THREE.Scene();
    
    // Orthographic for Brutalist flat schematic look
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 100;
    this.camera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2, 
      frustumSize * aspect / 2, 
      frustumSize / 2, 
      frustumSize / -2, 
      1, 1000
    );
    this.camera.position.z = 100;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x050505, 1); // Brutalist dark bg
    this.container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => this.onWindowResize(), false);
  }

  onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = 100;
    this.camera.left = -frustumSize * aspect / 2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  initParticles() {
    this.geometry = new THREE.BufferGeometry();

    const colorBlue = new THREE.Color("#00ffff");

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      
      // Ambient distribution (wide spread)
      this.ambientTargets[i3] = (Math.random() - 0.5) * 200;
      this.ambientTargets[i3 + 1] = (Math.random() - 0.5) * 200;
      this.ambientTargets[i3 + 2] = (Math.random() - 0.5) * 50;

      // Current positions start at ambient
      this.positions[i3] = this.ambientTargets[i3];
      this.positions[i3 + 1] = this.ambientTargets[i3 + 1];
      this.positions[i3 + 2] = this.ambientTargets[i3 + 2];

      // Default Structural (random within the arena boundary for now, updated dynamically later)
      this.structuralTargets[i3] = (Math.random() - 0.5) * this.arenaSize;
      this.structuralTargets[i3 + 1] = (Math.random() - 0.5) * this.arenaSize;
      this.structuralTargets[i3 + 2] = 0;

      // Velocities
      this.velocities[i3] = 0;
      this.velocities[i3 + 1] = 0;
      this.velocities[i3 + 2] = 0;

      // Colors
      colorBlue.toArray(this.colors, i3);
      colorBlue.toArray(this.baseColors, i3);
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    // Simple PointMaterial, no glows, sharp pixels
    const material = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      transparent: false,
      depthWrite: false
    });

    this.particleMesh = new THREE.Points(this.geometry, material);
    this.scene.add(this.particleMesh);

    // Initialize LineSegments for solid trails
    this.trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 });
    this.trailGeometry = new THREE.BufferGeometry();
    this.maxTrailVertices = 2000;
    this.trailPositions = new Float32Array(this.maxTrailVertices * 3);
    this.trailColors = new Float32Array(this.maxTrailVertices * 3);
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    this.trailGeometry.setDrawRange(0, 0); // start empty
    this.trailMesh = new THREE.LineSegments(this.trailGeometry, this.trailMaterial);
    this.scene.add(this.trailMesh);
  }

  // Trigger the pull into the structural grid
  triggerMagneticPull() {
    if (this.state !== 'MAGNETIC_PULL' && this.state !== 'STRUCTURAL') {
      this.state = 'MAGNETIC_PULL';
      this.transitionProgress = 0;
      this.mapStructuralTargets(); // Assign precise coordinates for Arena and Cycles
    }
  }

  // Define exactly where particles go to form the Arena
  mapStructuralTargets() {
    // 0-4000: Arena boundaries
    // 4000-6000: Entities
    // 6000+: Sparks (handled separately)
    const halfSize = this.arenaSize / 2;
    let idx = 0;
    
    // Top & Bottom walls
    for (let x = -halfSize; x <= halfSize; x += 0.5) {
      if (idx >= this.particleCount) break;
      this.setStructural(idx++, x, halfSize);
      this.setStructural(idx++, x, -halfSize);
    }
    // Left & Right walls
    for (let y = -halfSize; y <= halfSize; y += 0.5) {
      if (idx >= this.particleCount) break;
      this.setStructural(idx++, -halfSize, y);
      this.setStructural(idx++, halfSize, y);
    }
    
    // We completely remove any scattered noise on the inside or outside
    // to keep the arena perfectly clean. Unused structural targets will stay at 0,0
    // but we can just push them far away so they don't show up.
    while (idx < 6000) {
      this.setStructural(idx++, 9999, 9999);
    }
  }

  setStructural(idx, x, y) {
    if (idx >= this.particleCount) return;
    const i3 = idx * 3;
    this.structuralTargets[i3] = x;
    this.structuralTargets[i3 + 1] = y;
    this.structuralTargets[i3 + 2] = 0;
  }

  // Called to map live entities (cycles, trails) to structural targets
  updateLiveEntities(playerPos, npcPos, trails) {
    if (this.state !== 'STRUCTURAL') return;
    
    let idx = 4000;
    // Player cluster
    for (let i = 0; i < 50; i++) {
      this.setStructural(idx++, playerPos.x + (Math.random()-0.5)*2, playerPos.y + (Math.random()-0.5)*2);
      // Paint orange
      this.colors[(idx-1)*3] = 1.0;
      this.colors[(idx-1)*3 + 1] = 0.5;
      this.colors[(idx-1)*3 + 2] = 0.0;
    }

    // NPC cluster
    for (let i = 0; i < 50; i++) {
      this.setStructural(idx++, npcPos.x + (Math.random()-0.5)*2, npcPos.y + (Math.random()-0.5)*2);
      // Paint with theme color
      this.colors[(idx-1)*3] = this.themeColor.r;
      this.colors[(idx-1)*3 + 1] = this.themeColor.g;
      this.colors[(idx-1)*3 + 2] = this.themeColor.b;
    }

    // Trails (Solid Lines)
    let vertexCount = 0;
    for (const trail of trails) {
      if (vertexCount >= this.maxTrailVertices) break;
      
      this.trailPositions[vertexCount*3] = trail.startX;
      this.trailPositions[vertexCount*3+1] = trail.startY;
      this.trailPositions[vertexCount*3+2] = 0;
      
      this.trailPositions[vertexCount*3+3] = trail.endX;
      this.trailPositions[vertexCount*3+4] = trail.endY;
      this.trailPositions[vertexCount*3+5] = 0;
      
      let r, g, b;
      if (trail.owner === 'player') { r=1.0; g=0.5; b=0.0; }
      else { r=this.themeColor.r; g=this.themeColor.g; b=this.themeColor.b; }
      
      this.trailColors[vertexCount*3] = r;
      this.trailColors[vertexCount*3+1] = g;
      this.trailColors[vertexCount*3+2] = b;
      
      this.trailColors[vertexCount*3+3] = r;
      this.trailColors[vertexCount*3+4] = g;
      this.trailColors[vertexCount*3+5] = b;
      
      vertexCount += 2;
    }
    
    this.trailGeometry.setDrawRange(0, vertexCount);
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.attributes.color.needsUpdate = true;
    
    // Emit bike sparks randomly
    if (Math.random() > 0.5) {
      this.emitSpark(playerPos, {r:1,g:0.5,b:0});
      this.emitSpark(npcPos, {r:this.themeColor.r, g:this.themeColor.g, b:this.themeColor.b});
    }

    this.geometry.attributes.color.needsUpdate = true;
  }

  emitSpark(pos, color) {
    if (!this.sparkIndex) this.sparkIndex = 6000;
    const idx = this.sparkIndex;
    const i3 = idx * 3;
    
    // Position slightly scattered from bike
    this.positions[i3] = pos.x + (Math.random()-0.5)*1.5;
    this.positions[i3+1] = pos.y + (Math.random()-0.5)*1.5;
    this.positions[i3+2] = 0;
    
    // Fly randomly
    this.velocities[i3] = (Math.random()-0.5)*2;
    this.velocities[i3+1] = (Math.random()-0.5)*2;
    this.velocities[i3+2] = (Math.random()-0.5)*2;

    this.colors[i3] = color.r;
    this.colors[i3+1] = color.g;
    this.colors[i3+2] = color.b;
    
    this.sparkIndex++;
    if (this.sparkIndex >= this.particleCount) {
      this.sparkIndex = 6000;
    }
  }

  triggerExplosion(impactPoint) {
    this.state = 'EXPLOSION';
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      const dx = this.positions[i3] - impactPoint.x;
      const dy = this.positions[i3 + 1] - impactPoint.y;
      const dist = Math.sqrt(dx*dx + dy*dy) + 0.1;
      
      // Radial explosion force, stronger closer to impact
      const force = 50 / dist;
      this.velocities[i3] = (dx / dist) * force * (Math.random() * 0.5 + 0.5);
      this.velocities[i3 + 1] = (dy / dist) * force * (Math.random() * 0.5 + 0.5);
      this.velocities[i3 + 2] = (Math.random() - 0.5) * force;
    }
    
    // Reset to blue after explosion
    this.shiftColors("#00ffff");
  }

  shiftColors(hexColorStr) {
    const color = new THREE.Color(hexColorStr);
    this.themeColor.copy(color); // Update the theme color used by entities
    for (let i = 0; i < this.particleCount; i++) {
      color.toArray(this.baseColors, i * 3);
      color.toArray(this.colors, i * 3);
    }
    this.geometry.attributes.color.needsUpdate = true;
  }

  easeOutExpo(x) {
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  }

  update(steeringAngle = 0) {
    this.time += 0.016;
    
    // Dynamic Parallax Tilt based on steering input
    if (steeringAngle !== null && steeringAngle !== undefined) {
      // Rotate around Y axis for left/right perspective tilt
      let targetRotY = (steeringAngle / 45) * 0.15;
      targetRotY = Math.max(-0.2, Math.min(0.2, targetRotY));
      this.scene.rotation.y += (targetRotY - this.scene.rotation.y) * 0.1;
      
      // Rotate around Z axis for a slight banking effect
      let targetRotZ = -(steeringAngle / 45) * 0.05;
      targetRotZ = Math.max(-0.1, Math.min(0.1, targetRotZ));
      this.scene.rotation.z += (targetRotZ - this.scene.rotation.z) * 0.1;
    } else {
      // Smoothly return to center if no angle
      this.scene.rotation.y += (0 - this.scene.rotation.y) * 0.05;
      this.scene.rotation.z += (0 - this.scene.rotation.z) * 0.05;
    }
    
    if (this.state === 'MAGNETIC_PULL') {
      this.transitionProgress += 0.01; // Smooth 1-2 sec transition
      if (this.transitionProgress > 1) this.transitionProgress = 1;
    }

    const pos = this.geometry.attributes.position.array;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Handle sparks first
      if (i >= 6000) {
        if (Math.abs(this.velocities[i3]) > 0.01 || Math.abs(this.velocities[i3+1]) > 0.01) {
          pos[i3] += this.velocities[i3];
          pos[i3+1] += this.velocities[i3+1];
          pos[i3+2] += this.velocities[i3+2];
          
          this.velocities[i3] *= 0.9;
          this.velocities[i3+1] *= 0.9;
          this.velocities[i3+2] *= 0.9;

          this.colors[i3] *= 0.9;
          this.colors[i3+1] *= 0.9;
          this.colors[i3+2] *= 0.9;
        } else {
          pos[i3] = 9999; // hide dissipated spark
        }
        continue;
      }

      if (this.state === 'AMBIENT') {
        // Slow dreamy orbit using sine/cosine waves based on base targets
        pos[i3] = this.ambientTargets[i3] + Math.sin(this.time + i) * 5;
        pos[i3 + 1] = this.ambientTargets[i3 + 1] + Math.cos(this.time + i) * 5;
        pos[i3 + 2] = this.ambientTargets[i3 + 2] + Math.sin(this.time * 0.5 + i) * 5;
      } 
      else if (this.state === 'MAGNETIC_PULL') {
        // Easing for heavy, structural snap
        const ease = this.easeOutExpo(this.transitionProgress);

        pos[i3] += (this.structuralTargets[i3] - pos[i3]) * ease * 0.05;
        pos[i3 + 1] += (this.structuralTargets[i3 + 1] - pos[i3 + 1]) * ease * 0.05;
        pos[i3 + 2] += (this.structuralTargets[i3 + 2] - pos[i3 + 2]) * ease * 0.05;

        // Vibrate slightly as they snap
        pos[i3] += (Math.random() - 0.5) * (1 - ease) * 2;
        pos[i3 + 1] += (Math.random() - 0.5) * (1 - ease) * 2;

        if (i === 5999 && this.transitionProgress === 1) {
          this.state = 'STRUCTURAL';
        }
      }
      else if (this.state === 'STRUCTURAL') {
        // Lock rigidly, but allow "vibration" noise
        pos[i3] = this.structuralTargets[i3] + (Math.random() - 0.5) * 0.2;
        pos[i3 + 1] = this.structuralTargets[i3 + 1] + (Math.random() - 0.5) * 0.2;
        pos[i3 + 2] = this.structuralTargets[i3 + 2];
      }
      else if (this.state === 'EXPLOSION') {
        // Apply velocity
        pos[i3] += this.velocities[i3];
        pos[i3 + 1] += this.velocities[i3 + 1];
        pos[i3 + 2] += this.velocities[i3 + 2];

        // Dampening (drag)
        this.velocities[i3] *= 0.95;
        this.velocities[i3 + 1] *= 0.95;
        this.velocities[i3 + 2] *= 0.95;

        // Slowly pull back to ambient
        pos[i3] += (this.ambientTargets[i3] - pos[i3]) * 0.01;
        pos[i3 + 1] += (this.ambientTargets[i3 + 1] - pos[i3 + 1]) * 0.01;
        
        // If nearly stopped, return to ambient
        if (i === 0 && Math.abs(this.velocities[0]) < 0.1) {
           // Transition handled by GameManager usually, but auto-revert after explosion settles
           if (this.time > 10) { // Just a rough delay
              // this.state = 'AMBIENT';
           }
        }
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
