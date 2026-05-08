export class GameManager {
  constructor(handTracker, particleSystem) {
    this.handTracker = handTracker;
    this.particleSystem = particleSystem;
    
    this.state = 'INIT'; // INIT, WAITING_FOR_FISTS, CALIBRATING, COUNTDOWN, PLAYING, GAME_OVER
    
    // UI elements
    this.statusText = document.getElementById('status-text');
    
    this.wins = 0;
    
    // Game Entities
    this.arenaHalfSize = 40; // Total 80
    this.player = { x: 0, y: -30, dir: { x: 0, y: 1 }, dead: false };
    this.npc = { x: 0, y: 30, dir: { x: 0, y: -1 }, dead: false };
    this.trails = [];
    
    this.playerSpeed = 0.5; // Grid units per frame
    this.npcSpeed = 0.5 * 0.95; // 95% of player speed
    this.turnLock = false; // Tactical One-Shot Lock

    this.countdownValue = 3;
    this.lastTime = performance.now();
    this.accumulator = 0;
    
    // Start loop
    this.changeState('WAITING_FOR_FISTS');
    this.update();
  }

  changeState(newState) {
    this.state = newState;
    console.log("State changed to:", newState);

    if (newState === 'WAITING_FOR_FISTS') {
      this.statusText.innerText = "WAITING FOR SIGNAL...";
      this.statusText.style.display = 'block';
    } 
    else if (newState === 'CALIBRATING') {
      this.statusText.innerText = "CALIBRATING... HOLD POSE";
      this.handTracker.startCalibration();
      this.calibrationStartTime = performance.now();
      // Calibration finishes dynamically in the update loop once enough samples are collected!
    }
    else if (newState === 'COUNTDOWN') {
      this.particleSystem.triggerMagneticPull();
      this.countdownValue = 3;
      this.statusText.innerText = "3";
      
      let interval = setInterval(() => {
        this.countdownValue--;
        if (this.countdownValue > 0) {
          this.statusText.innerText = this.countdownValue.toString();
        } else {
          clearInterval(interval);
          this.changeState('PLAYING');
        }
      }, 1000);
    } 
    else if (newState === 'PLAYING') {
      this.statusText.style.display = 'none';
      this.resetEntities();
    }
    else if (newState === 'GAME_OVER') {
      this.statusText.style.display = 'block';
    }
  }

  resetEntities() {
    this.player = { x: 0, y: -30, dir: { x: 0, y: 1 }, dead: false };
    this.npc = { x: 0, y: 30, dir: { x: 0, y: -1 }, dead: false };
    
    this.trails = [];
    this.playerCurrentTrail = { startX: this.player.x, startY: this.player.y, endX: this.player.x, endY: this.player.y, owner: 'player' };
    this.npcCurrentTrail = { startX: this.npc.x, startY: this.npc.y, endX: this.npc.x, endY: this.npc.y, owner: 'npc' };
    this.trails.push(this.playerCurrentTrail);
    this.trails.push(this.npcCurrentTrail);
    
    this.turnLock = false;
    this.frameCount = 0;
    this.npcTurnCooldown = 0;
  }

  update() {
    const now = performance.now();
    let dt = now - this.lastTime;
    
    // Cap dt to prevent massive jumps when tab is inactive
    if (dt > 250) {
      dt = 16.666;
    }
    
    this.lastTime = now;
    this.accumulator += dt;
    
    const fixedDelta = 1000 / 60; // 60 updates per second
    
    // Fixed timestep loop
    while (this.accumulator >= fixedDelta) {
      this.fixedUpdate();
      this.accumulator -= fixedDelta;
    }
    
    // Always update particle system based on latest state
    if (this.state === 'PLAYING') {
      this.particleSystem.updateLiveEntities(this.player, this.npc, this.trails);
    }
    this.particleSystem.update(this.handTracker.currentSteeringAngle);

    requestAnimationFrame(() => this.update());
  }

  fixedUpdate() {
    if (this.state === 'WAITING_FOR_FISTS') {
      if (this.handTracker.checkFistPullApart()) {
        this.changeState('CALIBRATING');
      }
    } 
    else if (this.state === 'CALIBRATING') {
      // 1.5 second invisible grace period to allow user to pick their pose
      if (performance.now() - this.calibrationStartTime > 1500) {
        this.handTracker.sampleCalibration();
        // If we've collected 30 frames of solid data, finish!
        if (this.handTracker.calibrationSamples.length >= 30) {
          if (this.handTracker.finishCalibration()) {
            this.changeState('COUNTDOWN');
          } else {
            this.handTracker.startCalibration(); // Reset and retry if failed
          }
        }
      }
    }
    else if (this.state === 'PLAYING') {
      this.updatePlayingState();
    }
  }

  updatePlayingState() {
    this.processInput();
    this.updateNPC();
    this.moveEntities();
    this.checkCollisions();
  }

  processInput() {
    const direction = this.handTracker.getSteeringDirection();
    
    if (direction === "CENTER") {
      this.turnLock = false; // Reset lock when in deadzone
    } 
    else if (direction !== null && !this.turnLock) {
      // Execute 90-degree turn
      this.turnLock = true;
      if (direction === "RIGHT") {
        this.player.dir = { x: this.player.dir.y, y: -this.player.dir.x };
        this.playerCurrentTrail = { startX: this.player.x, startY: this.player.y, endX: this.player.x, endY: this.player.y, owner: 'player' };
        this.trails.push(this.playerCurrentTrail);
      } else if (direction === "LEFT") {
        this.player.dir = { x: -this.player.dir.y, y: this.player.dir.x };
        this.playerCurrentTrail = { startX: this.player.x, startY: this.player.y, endX: this.player.x, endY: this.player.y, owner: 'player' };
        this.trails.push(this.playerCurrentTrail);
      }
    }
  }

  updateNPC() {
    if (this.npcTurnCooldown > 0) {
      this.npcTurnCooldown--;
      return;
    }

    // Look ahead 5 units
    const lookAheadDist = 5;
    const lookX = this.npc.x + this.npc.dir.x * lookAheadDist;
    const lookY = this.npc.y + this.npc.dir.y * lookAheadDist;
    
    let obstacleAhead = this.isObstacleAt(lookX, lookY, 'npc');

    if (obstacleAhead) {
      // Check left and right distances
      const rightDir = { x: this.npc.dir.y, y: -this.npc.dir.x };
      const leftDir = { x: -this.npc.dir.y, y: this.npc.dir.x };
      
      const rightDist = this.getClearDistance(this.npc.x, this.npc.y, rightDir);
      const leftDist = this.getClearDistance(this.npc.x, this.npc.y, leftDir);

      let chosenDir = null;
      if (rightDist > leftDist) {
        chosenDir = rightDir;
      } else if (leftDist > rightDist) {
        chosenDir = leftDir;
      } else {
        // Tie, turn towards center
        const toCenterX = -this.npc.x;
        const toCenterY = -this.npc.y;
        
        const dotRight = rightDir.x * toCenterX + rightDir.y * toCenterY;
        const dotLeft = leftDir.x * toCenterX + leftDir.y * toCenterY;
        
        chosenDir = (dotRight > dotLeft) ? rightDir : leftDir;
      }
      
      this.npc.dir = chosenDir;
      this.npcCurrentTrail = { startX: this.npc.x, startY: this.npc.y, endX: this.npc.x, endY: this.npc.y, owner: 'npc' };
      this.trails.push(this.npcCurrentTrail);
      
      // Cooldown to prevent infinite panic-spinning in boxes
      this.npcTurnCooldown = 10;
    }
  }

  getClearDistance(startX, startY, dir) {
    let dist = 0;
    let maxCheck = 40;
    while (dist < maxCheck) {
      let nx = startX + dir.x * dist;
      let ny = startY + dir.y * dist;
      if (this.isObstacleAt(nx, ny, 'npc')) break;
      dist++;
    }
    return dist;
  }

  distToSegment(px, py, x1, y1, x2, y2) {
    let l2 = (x1 - x2)*(x1 - x2) + (y1 - y2)*(y1 - y2);
    if (l2 === 0) return Math.sqrt((px - x1)*(px - x1) + (py - y1)*(py - y1));
    let t = ((px - x1)*(x2 - x1) + (py - y1)*(y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    let projX = x1 + t * (x2 - x1);
    let projY = y1 + t * (y2 - y1);
    return Math.sqrt((px - projX)*(px - projX) + (py - projY)*(py - projY));
  }

  isObstacleAt(x, y, entityOwner) {
    // Walls
    if (x <= -this.arenaHalfSize || x >= this.arenaHalfSize || 
        y <= -this.arenaHalfSize || y >= this.arenaHalfSize) {
      return true;
    }
    
    for (let t of this.trails) {
      // Ignore the active drawing segment of the checking entity
      if (entityOwner === 'player' && t === this.playerCurrentTrail) continue;
      if (entityOwner === 'npc' && t === this.npcCurrentTrail) continue;
      
      let dist = this.distToSegment(x, y, t.startX, t.startY, t.endX, t.endY);
      
      if (dist < 1.0) {
        if (t.owner === entityOwner) {
          // Ignore collision near the corner we just made to prevent self-colliding at turns
          let distToEnd = Math.sqrt((x - t.endX)**2 + (y - t.endY)**2);
          if (distToEnd < 2.0) continue;
        }
        return true;
      }
    }
    return false;
  }

  moveEntities() {
    this.frameCount++;

    this.player.x += this.player.dir.x * this.playerSpeed;
    this.player.y += this.player.dir.y * this.playerSpeed;
    this.playerCurrentTrail.endX = this.player.x;
    this.playerCurrentTrail.endY = this.player.y;
    
    this.npc.x += this.npc.dir.x * this.npcSpeed;
    this.npc.y += this.npc.dir.y * this.npcSpeed;
    this.npcCurrentTrail.endX = this.npc.x;
    this.npcCurrentTrail.endY = this.npc.y;
  }

  checkCollisions() {
    let pCrash = this.isObstacleAt(this.player.x, this.player.y, 'player');
    let nCrash = this.isObstacleAt(this.npc.x, this.npc.y, 'npc');
    
    // Head on collision
    if (!pCrash && !nCrash) {
      if (Math.abs(this.player.x - this.npc.x) < 1.5 && Math.abs(this.player.y - this.npc.y) < 1.5) {
        pCrash = true;
        nCrash = true;
      }
    }

    if (pCrash || nCrash) {
      this.handleGameOver(pCrash, nCrash);
    }
  }

  handleGameOver(pCrash, nCrash) {
    this.changeState('GAME_OVER');
    
    let impactPoint = { x: 0, y: 0 };

    if (pCrash && nCrash) {
      this.statusText.innerText = "DRAW. RESETTING...";
      // Average point
      impactPoint.x = (this.player.x + this.npc.x) / 2;
      impactPoint.y = (this.player.y + this.npc.y) / 2;
    } else if (pCrash) {
      this.statusText.innerText = "SYSTEM FAILURE.";
      impactPoint = { x: this.player.x, y: this.player.y };
      // Reset wins
      this.wins = 0;
    } else if (nCrash) {
      this.statusText.innerText = "ENEMY DEREZZED.";
      impactPoint = { x: this.npc.x, y: this.npc.y };
      this.wins++;
    }

    this.particleSystem.triggerExplosion(impactPoint);

    // Handle Win colors
    if (this.wins === 1) {
      this.particleSystem.shiftColors("#ff00ff"); // Purple
    } else if (this.wins >= 2) {
      this.particleSystem.shiftColors("#ff0000"); // Red
    }

    // Reset after explosion
    setTimeout(() => {
      this.changeState('WAITING_FOR_FISTS');
      this.particleSystem.state = 'AMBIENT';
    }, 4000);
  }
}
