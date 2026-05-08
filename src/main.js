import './style.css';
import { HandTracker } from './HandTracker.js';
import { ParticleSystem } from './ParticleSystem.js';
import { GameManager } from './GameManager.js';

console.log("DEREZZED Initializing...");

const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('pip-canvas');
const gameContainer = document.getElementById('game-container');

async function main() {
  // 1. Initialize Particles
  const particleSystem = new ParticleSystem(gameContainer);
  
  // 2. Initialize Hand Tracker
  const handTracker = new HandTracker(videoElement, canvasElement);
  await handTracker.initialize();
  
  // 3. Start Game Logic Loop
  const gameManager = new GameManager(handTracker, particleSystem);
  
  console.log("DEREZZED Systems Online.");
}

main().catch(console.error);
