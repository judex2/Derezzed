import { HandLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

export class HandTracker {
  constructor(videoElement, canvasElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.handLandmarker = null;
    this.runningMode = "VIDEO";
    this.lastVideoTime = -1;
    this.results = undefined;
    this.isInitialized = false;

    // Gesture state
    this.fistPullHistory = [];
    this.calibrationAngle = null;
    this.currentSteeringAngle = null;
    this.activeControlScheme = null; // 'LAZY_GUN' or 'HANDLEBARS'
    this.calibrationSamples = [];
  }

  async initialize() {
    console.log("Initializing MediaPipe HandLandmarker...");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: this.runningMode,
      numHands: 2
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      this.video.srcObject = stream;
      this.video.addEventListener("loadeddata", () => {
        // Match canvas dimensions to video
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        this.drawingUtils = new DrawingUtils(this.ctx);
        this.isInitialized = true;
        this.predictWebcam();
        console.log("Webcam and HandLandmarker ready.");
      });
    } catch (err) {
      console.error("Error accessing webcam: ", err);
    }
  }

  predictWebcam() {
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      this.results = this.handLandmarker.detectForVideo(this.video, performance.now());
      this.processGestures();
    }
    
    this.drawResults();
    window.requestAnimationFrame(() => this.predictWebcam());
  }

  drawResults() {
    this.ctx.save();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    if (this.results && this.results.landmarks) {
      for (const landmarks of this.results.landmarks) {
        this.drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: "#ff8000",
          lineWidth: 2
        });
        this.drawingUtils.drawLandmarks(landmarks, {
          color: "#ff8000",
          lineWidth: 1,
          radius: 2
        });
      }

      // Draw digital tether for Handlebars
      if (this.activeControlScheme === 'HANDLEBARS' && this.results.landmarks.length >= 2) {
        const h1 = this.results.landmarks[0]; 
        const h2 = this.results.landmarks[1];
        
        const orange = "#ff8000";
        this.ctx.strokeStyle = orange;
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([15, 10]);

        // 1. Bottom Tether (Wrists)
        this.ctx.beginPath();
        this.ctx.moveTo(h1[0].x * this.canvas.width, h1[0].y * this.canvas.height);
        this.ctx.lineTo(h2[0].x * this.canvas.width, h2[0].y * this.canvas.height);
        this.ctx.stroke();

        // 2. Middle Tether (MCP Joints / Knuckles - Index 9 is Middle MCP)
        this.ctx.beginPath();
        this.ctx.moveTo(h1[9].x * this.canvas.width, h1[9].y * this.canvas.height);
        this.ctx.lineTo(h2[9].x * this.canvas.width, h2[9].y * this.canvas.height);
        this.ctx.stroke();

        // 3. Top Tether (Fingertips - Index 12 is Middle Tip)
        this.ctx.beginPath();
        this.ctx.moveTo(h1[12].x * this.canvas.width, h1[12].y * this.canvas.height);
        this.ctx.lineTo(h2[12].x * this.canvas.width, h2[12].y * this.canvas.height);
        this.ctx.stroke();

        this.ctx.setLineDash([]); // Reset dash
      }
    }
    this.ctx.restore();
  }

  // Helper to calculate 2D distance between landmarks
  getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  }

  isFist(landmarks) {
    const tipDist = this.getDistance(landmarks[8], landmarks[0]);
    const mcpDist = this.getDistance(landmarks[5], landmarks[0]);
    return tipDist <= mcpDist * 1.8; // Very relaxed grip allowance
  }

  // Phase 1 Gesture: Fist Pull Apart
  // Detects if two hands are present, both are closed, and their distance is increasing.
  checkFistPullApart() {
    if (!this.results || this.results.landmarks.length < 2) {
      this.fistPullHistory = [];
      return false;
    }

    let areBothFists = true;
    for (let i = 0; i < 2; i++) {
      if (!this.isFist(this.results.landmarks[i])) {
        areBothFists = false;
      }
    }

    if (!areBothFists) {
      this.fistPullHistory = [];
      return false;
    }

    // Measure distance between the two wrists
    const wristDist = this.getDistance(this.results.landmarks[0][0], this.results.landmarks[1][0]);
    this.fistPullHistory.push({ time: performance.now(), dist: wristDist });

    if (this.fistPullHistory.length > 10) {
      this.fistPullHistory.shift();
    }

    if (this.fistPullHistory.length >= 5) {
      const oldest = this.fistPullHistory[0];
      const newest = this.fistPullHistory[this.fistPullHistory.length - 1];
      
      // If distance increased significantly (e.g. 15% of screen width) over a short time
      const expansion = newest.dist - oldest.dist;
      if (expansion > 0.15 && (newest.time - oldest.time) < 1000) {
        return true;
      }
    }

    return false;
  }

  // Core update for Gameplay
  processGestures() {
    if (!this.results || this.results.landmarks.length === 0) {
      this.activeControlScheme = null;
      return;
    }

    this.activeControlScheme = null;

    // 1. Check for "Upturned Lazy Gun"
    const lm = this.results.landmarks[0];
    const idxDist = this.getDistance(lm[8], lm[0]);
    const pinkyDist = this.getDistance(lm[20], lm[0]);
    
    if ((idxDist / pinkyDist) > 1.8) {
      this.activeControlScheme = 'LAZY_GUN';
      let dx = lm[5].x - lm[0].x;
      let dy = lm[5].y - lm[0].y;
      
      let physicalDx = -dx; 
      this.currentSteeringAngle = Math.atan2(dy, physicalDx) * (180 / Math.PI);
      return;
    }

    // 2. Check for Motorcycle Handlebars (Two Fists)
    if (this.results.landmarks.length >= 2) {
      if (this.isFist(this.results.landmarks[0]) && this.isFist(this.results.landmarks[1])) {
        this.activeControlScheme = 'HANDLEBARS';
        
        let hand1 = this.results.landmarks[0][0]; // Wrist of hand 1
        let hand2 = this.results.landmarks[1][0]; // Wrist of hand 2
        
        // x=0 is left edge of camera (user's physical right). x=1 is right edge (user's physical left).
        let physicalRightHand = hand1.x < hand2.x ? hand1 : hand2;
        let physicalLeftHand = hand1.x < hand2.x ? hand2 : hand1;
        
        // Original invisible line math
        // We calculate the exact raw angle between the two fists.
        let dx = -(physicalRightHand.x - physicalLeftHand.x); // Inverted so left-to-right is positive
        let dy = physicalRightHand.y - physicalLeftHand.y;
        
        let rawAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        
        if (this.currentSteeringAngle === null || this.activeControlScheme !== 'HANDLEBARS') {
          this.currentSteeringAngle = rawAngle;
        } else {
          // 50% smoothing to shave off math jitters without feeling sluggish
          this.currentSteeringAngle += (rawAngle - this.currentSteeringAngle) * 0.5;
        }
        return;
      }
    }
  }

  startCalibration() {
    this.calibrationSamples = [];
  }

  sampleCalibration() {
    if (this.activeControlScheme && this.currentSteeringAngle !== null) {
      this.calibrationSamples.push(this.currentSteeringAngle);
    }
  }

  finishCalibration() {
    if (this.calibrationSamples.length > 0) {
      let sumSin = 0;
      let sumCos = 0;
      for (let a of this.calibrationSamples) {
        let rad = a * Math.PI / 180;
        sumSin += Math.sin(rad);
        sumCos += Math.cos(rad);
      }
      this.calibrationAngle = Math.atan2(sumSin, sumCos) * (180 / Math.PI);
      console.log("Calibrated Neutral Angle:", this.calibrationAngle, "from", this.calibrationSamples.length, "samples");
      return true;
    }
    return false;
  }

  // Returns "LEFT", "RIGHT", or null based on angle difference from calibration
  // Implementation of Tactical One-Shot lock will be handled by GameManager state
  getSteeringDirection() {
    if (!this.activeControlScheme || this.calibrationAngle === null || this.currentSteeringAngle === null) {
      return null;
    }

    // Calculate angle difference (handling wrapping at 180/-180)
    let diff = this.currentSteeringAngle - this.calibrationAngle;
    
    // Normalize diff to -180..180
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;

    // Handlebars get a wider deadzone to accommodate natural arm shake
    // 27 degrees creates a 54-degree 'invisible cone' threshold from the center
    const deadzone = this.activeControlScheme === 'HANDLEBARS' ? 27 : 15;
    
    if (diff > deadzone) {
      return "RIGHT";
    } else if (diff < -deadzone) {
      return "LEFT";
    }
    
    return "CENTER"; // Inside deadzone
  }
}
