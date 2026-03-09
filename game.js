const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const menus = {
    main: document.getElementById("main-menu"),
    over: document.getElementById("game-over-menu"),
    complete: document.getElementById("level-complete-menu"),
    hud: document.getElementById("hud")
};

const hudVars = {
    level: document.getElementById("hud-level"),
    bestLevel: document.getElementById("hud-best-level"),
    score: document.getElementById("hud-score"),
    combo: document.getElementById("hud-combo"),
    lit: document.getElementById("hud-lit"),
    progress: document.getElementById("hud-progress")
};

const menuStats = {
    bestLevel: document.getElementById("menu-best-level"),
    bestScore: document.getElementById("menu-best-score"),
    finalLevel: document.getElementById("final-level"),
    finalScore: document.getElementById("final-score"),
    finalCombo: document.getElementById("final-combo"),
    levelSummary: document.getElementById("level-summary")
};
const soundBtn = document.getElementById("sound-btn");

const STORAGE_KEYS = {
    bestLevel: "lightup_best_level",
    bestScore: "lightup_best_score",
    soundOn: "lightup_sound_on"
};

const colors = ["#00FFCC", "#CC00FF", "#FFFF00", "#00FF33", "#FF8A00", "#00A3FF"];

const PHYSICS = {
    gravity: 1600,
    terminalVelocity: 1250,
    jumpForceY: -760,
    jumpForceX: 430,
    groundDamping: 0.82,
    airDamping: 0.985
};

const TUNING = {
    coyoteTime: 0.11,
    jumpBuffer: 0.14,
    comboWindow: 2.2,
    bounceSfxCooldown: 0.07,
    boxHitSfxCooldown: 0.09,
    ambientStars: 64,
    ambientDust: 18
};

let gameState = "MENU";
let lastTime = 0;
let globalTime = 0;
let shakeTime = 0;
let shakeMagnitude = 0;
let animating = false;

let level = 1;
let litCount = 0;
let targetLitCount = 0;
let score = 0;
let combo = 0;
let comboTimer = 0;
let bestComboRun = 0;

let bestLevel = 1;
let bestScore = 0;

let player;
let platforms = [];
let particles = [];
let lightBursts = [];
let ambientStars = [];
let ambientDust = [];

let soundOn = true;
let audioContext = null;
let audioMaster = null;
const sfxTimers = {
    bounce: 0,
    boxHit: 0
};

function readStoredNumber(key, fallback = 0) {
    try {
        const value = Number(localStorage.getItem(key));
        if (Number.isFinite(value) && value >= 0) {
            return Math.floor(value);
        }
    } catch (err) {
        return fallback;
    }
    return fallback;
}

function writeStoredNumber(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch (err) {
        return;
    }
}

function readStoredBoolean(key, fallback = true) {
    try {
        const value = localStorage.getItem(key);
        if (value === "1") {
            return true;
        }
        if (value === "0") {
            return false;
        }
    } catch (err) {
        return fallback;
    }
    return fallback;
}

function writeStoredBoolean(key, value) {
    try {
        localStorage.setItem(key, value ? "1" : "0");
    } catch (err) {
        return;
    }
}

function updateSoundButtonLabel() {
    soundBtn.textContent = soundOn ? "Sound: On" : "Sound: Off";
}

function ensureAudioReady() {
    if (!soundOn) {
        return null;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        return null;
    }
    if (!audioContext) {
        audioContext = new AudioCtx();
        audioMaster = audioContext.createGain();
        audioMaster.gain.value = 0.72;
        audioMaster.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") {
        audioContext.resume();
    }
    return audioContext;
}

function playTone({
    frequency = 440,
    endFrequency = null,
    duration = 0.12,
    type = "sine",
    volume = 0.18,
    attack = 0.01
}) {
    const context = ensureAudioReady();
    if (!context || !audioMaster) {
        return;
    }

    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    filter.type = "lowpass";
    filter.frequency.value = 3000;

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (endFrequency !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioMaster);

    osc.start(now);
    osc.stop(now + duration + 0.02);
}

function playChord(frequencies, duration = 0.24, volume = 0.12, type = "triangle") {
    for (let i = 0; i < frequencies.length; i++) {
        playTone({
            frequency: frequencies[i],
            duration,
            type,
            volume
        });
    }
}

const SFX = {
    jump() {
        playTone({ frequency: 540, endFrequency: 710, duration: 0.11, type: "triangle", volume: 0.2 });
    },
    light(comboSize) {
        const base = 420 + Math.min(7, comboSize) * 26;
        playTone({ frequency: base, endFrequency: base * 1.18, duration: 0.13, type: "triangle", volume: 0.23 });
    },
    bounce() {
        playTone({ frequency: 430, endFrequency: 340, duration: 0.09, type: "triangle", volume: 0.17, attack: 0.004 });
    },
    boxHit() {
        playTone({ frequency: 255, endFrequency: 210, duration: 0.08, type: "sine", volume: 0.15, attack: 0.004 });
        setTimeout(() => playTone({ frequency: 480, endFrequency: 390, duration: 0.06, type: "triangle", volume: 0.08, attack: 0.003 }), 28);
    },
    fail() {
        playTone({ frequency: 300, endFrequency: 210, duration: 0.2, type: "triangle", volume: 0.12, attack: 0.01 });
        setTimeout(() => playTone({ frequency: 220, endFrequency: 155, duration: 0.24, type: "triangle", volume: 0.15, attack: 0.01 }), 70);
        setTimeout(() => playTone({ frequency: 170, endFrequency: 120, duration: 0.3, type: "sine", volume: 0.17, attack: 0.01 }), 150);
    },
    clear() {
        playTone({ frequency: 420, duration: 0.15, type: "triangle", volume: 0.23 });
        setTimeout(() => playTone({ frequency: 560, duration: 0.18, type: "triangle", volume: 0.23 }), 80);
        setTimeout(() => playTone({ frequency: 700, duration: 0.22, type: "triangle", volume: 0.25 }), 160);
        playChord([420, 525, 630], 0.18, 0.12, "sine");
    }
};

function tryPlaySfx(type, cooldown, playFn) {
    if (!soundOn) {
        return;
    }
    if ((sfxTimers[type] || 0) > 0) {
        return;
    }
    sfxTimers[type] = cooldown;
    playFn();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function rand(min, max) {
    return Math.random() * (max - min) + min;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, padding = 0) {
    return (
        ax < bx + bw + padding &&
        ax + aw + padding > bx &&
        ay < by + bh + padding &&
        ay + ah + padding > by
    );
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    createAmbientElements();
    if (gameState === "MENU") {
        draw();
    }
}
window.addEventListener("resize", resize);

function setScreenShake(duration, magnitude) {
    shakeTime = duration;
    shakeMagnitude = magnitude;
}

function spawnBurst(x, y, color, count, speedMultiplier = 3) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color, speedMultiplier));
    }
}

class Player {
    constructor() {
        this.size = 12;
        this.reset();
    }

    reset() {
        this.x = canvas.width / 2;
        this.y = 90;
        this.prevX = this.x;
        this.prevY = this.y;
        this.vx = 0;
        this.vy = 0;
        this.rotation = 0;
        this.trail = [];
        this.isGrounded = false;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.bufferDirection = 1;
        this.airJumpsLeft = 1;
    }

    queueJump(direction) {
        this.bufferDirection = direction;
        this.jumpBufferTimer = TUNING.jumpBuffer;
    }

    tryJump(direction = this.bufferDirection) {
        const canGroundJump = this.isGrounded || this.coyoteTimer > 0;
        if (canGroundJump) {
            this.coyoteTimer = 0;
            this.airJumpsLeft = 1;
        } else if (this.airJumpsLeft > 0) {
            this.airJumpsLeft--;
        } else {
            return false;
        }

        this.vy = PHYSICS.jumpForceY;
        this.vx = PHYSICS.jumpForceX * direction;
        this.isGrounded = false;
        this.jumpBufferTimer = 0;
        SFX.jump();
        lightBursts.push(new LightBurst(this.x, this.y, "#9cf7ff", 8));
        spawnBurst(this.x, this.y, "#ffffff", 8, 2.3);
        return true;
    }

    landOn(platform) {
        this.y = platform.y - this.size / 2;
        this.vy = 0;
        this.isGrounded = true;
        this.coyoteTimer = TUNING.coyoteTime;
        this.airJumpsLeft = 1;
        this.x += platform.dx;
        this.y += platform.dy;

        if (this.jumpBufferTimer > 0) {
            this.tryJump(this.bufferDirection);
        }
    }

    update(dt) {
        this.prevX = this.x;
        this.prevY = this.y;

        if (this.isGrounded) {
            this.coyoteTimer = TUNING.coyoteTime;
        } else {
            this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
        }

        if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer -= dt;
            this.tryJump(this.bufferDirection);
        }

        this.vy += PHYSICS.gravity * dt;
        if (this.vy > PHYSICS.terminalVelocity) {
            this.vy = PHYSICS.terminalVelocity;
        }

        const damping = this.isGrounded ? PHYSICS.groundDamping : PHYSICS.airDamping;
        this.vx *= damping;
        if (Math.abs(this.vx) < 5) {
            this.vx = 0;
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.isGrounded = false;

        if (this.x < this.size / 2) {
            this.x = this.size / 2;
            this.vx = Math.abs(this.vx) * 0.82;
            tryPlaySfx("bounce", TUNING.bounceSfxCooldown, SFX.bounce);
            setScreenShake(0.08, 2);
        } else if (this.x > canvas.width - this.size / 2) {
            this.x = canvas.width - this.size / 2;
            this.vx = -Math.abs(this.vx) * 0.82;
            tryPlaySfx("bounce", TUNING.bounceSfxCooldown, SFX.bounce);
            setScreenShake(0.08, 2);
        }

        if (this.y > canvas.height + 70) {
            setGameOver();
        }

        this.rotation += this.vx * dt * 0.02;
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 16) {
            this.trail.shift();
        }
    }

    draw(drawCtx) {
        if (this.trail.length > 1) {
            drawCtx.beginPath();
            drawCtx.moveTo(this.trail[0].x, this.trail[0].y);
            for (let i = 1; i < this.trail.length; i++) {
                drawCtx.lineTo(this.trail[i].x, this.trail[i].y);
            }
            drawCtx.strokeStyle = "rgba(255, 255, 255, 0.26)";
            drawCtx.lineWidth = this.size;
            drawCtx.lineCap = "round";
            drawCtx.shadowBlur = 10;
            drawCtx.shadowColor = "#ffffff";
            drawCtx.stroke();
        }

        drawCtx.save();
        drawCtx.translate(this.x, this.y);
        drawCtx.rotate(this.rotation);
        const aura = drawCtx.createRadialGradient(0, -this.size * 0.6, 1, 0, -this.size * 0.6, this.size * 3.4);
        aura.addColorStop(0, "rgba(204, 255, 240, 0.35)");
        aura.addColorStop(1, "rgba(0, 0, 0, 0)");
        drawCtx.fillStyle = aura;
        drawCtx.beginPath();
        drawCtx.arc(0, -this.size * 0.6, this.size * 2.6, 0, Math.PI * 2);
        drawCtx.fill();

        drawCtx.shadowBlur = 18;
        drawCtx.shadowColor = "#ffffff";
        drawCtx.fillStyle = "#ffffff";
        drawCtx.beginPath();
        drawCtx.arc(0, -this.size, this.size / 2, 0, Math.PI * 2);
        drawCtx.fill();
        drawCtx.fillRect(-this.size / 4, -this.size / 2, this.size / 2, this.size);
        drawCtx.restore();
    }
}

class Platform {
    constructor(x, y, w, h, color, type = "static", hazard = false) {
        this.startX = x;
        this.startY = y;
        this.x = x;
        this.y = y;
        this.prevX = x;
        this.prevY = y;
        this.dx = 0;
        this.dy = 0;
        this.w = w;
        this.h = h;
        this.color = hazard ? "#FF2A45" : color;
        this.type = type;
        this.isHazard = hazard;
        this.isLit = false;
        this.targetGlow = 0;
        this.currentGlow = 0;
        this.offset = Math.random() * Math.PI * 2;
        this.speed = 1.2 + Math.random() * 1.3;
        this.range = 36 + Math.random() * 34;
    }

    lightUp() {
        if (this.isLit || this.isHazard) {
            return;
        }
        this.isLit = true;
        this.targetGlow = 30;
        litCount++;

        if (comboTimer > 0) {
            combo++;
        } else {
            combo = 1;
        }
        comboTimer = TUNING.comboWindow;
        bestComboRun = Math.max(bestComboRun, combo);
        SFX.light(combo);
        lightBursts.push(new LightBurst(this.x + this.w / 2, this.y + this.h / 2, this.color, 14));

        const gained = 100 + (combo - 1) * 45 + level * 20;
        score += gained;

        setScreenShake(0.14, 4);
        spawnBurst(this.x + this.w / 2, this.y, this.color, 24, 4);
        updateHUD();

        if (litCount >= targetLitCount) {
            setTimeout(() => {
                if (gameState === "PLAYING" && litCount >= targetLitCount) {
                    setLevelComplete();
                }
            }, 320);
        }
    }

    update(dt, time) {
        this.prevX = this.x;
        this.prevY = this.y;
        if (this.type === "horizontal") {
            this.x = this.startX + Math.sin(time * this.speed + this.offset) * this.range;
        } else if (this.type === "vertical") {
            this.y = this.startY + Math.sin(time * this.speed + this.offset) * this.range;
        }
        this.dx = this.x - this.prevX;
        this.dy = this.y - this.prevY;
        this.currentGlow += (this.targetGlow - this.currentGlow) * Math.min(1, dt * 10);
    }

    draw(drawCtx) {
        drawCtx.save();
        drawCtx.translate(this.x, this.y);

        if (this.isHazard) {
            const pulse = 11 + Math.sin(globalTime * 7) * 8;
            drawCtx.shadowBlur = pulse;
            drawCtx.shadowColor = "rgba(255, 42, 69, 0.95)";
            drawCtx.strokeStyle = "#FF2A45";
            drawCtx.fillStyle = "rgba(255, 42, 69, 0.28)";
            drawCtx.lineWidth = 3;
            drawCtx.beginPath();
            drawCtx.rect(0, 0, this.w, this.h);
            drawCtx.fill();
            drawCtx.stroke();

            drawCtx.beginPath();
            drawCtx.moveTo(0, this.h);
            for (let i = 8; i < this.w; i += 9) {
                drawCtx.lineTo(i - 4, 0);
                drawCtx.lineTo(i, this.h);
            }
            drawCtx.stroke();
        } else if (this.isLit) {
            drawCtx.shadowBlur = this.currentGlow;
            drawCtx.shadowColor = this.color;
            drawCtx.strokeStyle = this.color;
            drawCtx.fillStyle = this.color + "33";
            drawCtx.lineWidth = 3;
            drawCtx.beginPath();
            drawCtx.rect(0, 0, this.w, this.h);
            drawCtx.fill();
            drawCtx.stroke();
        } else {
            drawCtx.shadowBlur = 0;
            drawCtx.strokeStyle = "rgba(255, 255, 255, 0.32)";
            drawCtx.fillStyle = "rgba(255, 245, 225, 0.05)";
            drawCtx.lineWidth = 2;
            drawCtx.beginPath();
            drawCtx.rect(0, 0, this.w, this.h);
            drawCtx.fill();
            drawCtx.stroke();
        }
        drawCtx.restore();
    }
}

class Particle {
    constructor(x, y, color, speedMultiplier = 3) {
        this.x = x;
        this.y = y;
        this.color = color;
        const angle = Math.random() * Math.PI * 2;
        const speed = rand(55, 250) * speedMultiplier;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.life = 1;
        this.decay = rand(0.55, 1.95);
        this.size = rand(1.8, 5);
    }

    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= this.decay * dt;
    }

    draw(drawCtx) {
        if (this.life <= 0) {
            return;
        }
        drawCtx.save();
        drawCtx.globalAlpha = this.life;
        drawCtx.fillStyle = this.color;
        drawCtx.shadowBlur = 14;
        drawCtx.shadowColor = this.color;
        drawCtx.beginPath();
        drawCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        drawCtx.fill();
        drawCtx.restore();
    }
}

class LightBurst {
    constructor(x, y, color, baseRadius = 12) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.radius = baseRadius;
        this.life = 1;
        this.growth = rand(130, 210);
    }

    update(dt) {
        this.radius += this.growth * dt;
        this.life -= 1.8 * dt;
    }

    draw(drawCtx) {
        if (this.life <= 0) {
            return;
        }

        drawCtx.save();
        drawCtx.globalAlpha = this.life * 0.7;
        drawCtx.strokeStyle = this.color;
        drawCtx.lineWidth = 3;
        drawCtx.shadowBlur = 20;
        drawCtx.shadowColor = this.color;
        drawCtx.beginPath();
        drawCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        drawCtx.stroke();

        const radial = drawCtx.createRadialGradient(this.x, this.y, 1, this.x, this.y, this.radius * 1.8);
        radial.addColorStop(0, this.color + "55");
        radial.addColorStop(1, "rgba(0,0,0,0)");
        drawCtx.fillStyle = radial;
        drawCtx.beginPath();
        drawCtx.arc(this.x, this.y, this.radius * 1.4, 0, Math.PI * 2);
        drawCtx.fill();
        drawCtx.restore();
    }
}

function createAmbientElements() {
    ambientStars = [];
    ambientDust = [];

    const starCount = Math.max(30, Math.floor((canvas.width * canvas.height) / 18000));
    const cappedStarCount = Math.min(110, Math.max(TUNING.ambientStars, starCount));
    for (let i = 0; i < cappedStarCount; i++) {
        ambientStars.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: rand(0.7, 2.2),
            pulse: rand(0.2, 1),
            speed: rand(0.4, 1.6)
        });
    }

    const dustCount = Math.max(TUNING.ambientDust, Math.floor(canvas.width / 60));
    for (let i = 0; i < dustCount; i++) {
        ambientDust.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            radius: rand(14, 42),
            alpha: rand(0.03, 0.09),
            drift: rand(6, 18)
        });
    }
}

function updateRecordLabels() {
    hudVars.bestLevel.textContent = String(bestLevel);
    menuStats.bestLevel.textContent = String(bestLevel);
    menuStats.bestScore.textContent = String(bestScore);
}

function updateHUD() {
    hudVars.level.textContent = String(level);
    hudVars.score.textContent = String(score);
    hudVars.lit.textContent = `${litCount}/${targetLitCount}`;
    hudVars.combo.textContent = combo > 1 ? `Combo x${combo}` : "Combo x0";
    if (combo > 1) {
        hudVars.combo.classList.remove("opacity-60");
    } else {
        hudVars.combo.classList.add("opacity-60");
    }
    const progress = targetLitCount > 0 ? (litCount / targetLitCount) * 100 : 0;
    hudVars.progress.style.width = `${progress.toFixed(1)}%`;
    hudVars.bestLevel.textContent = String(bestLevel);
}

function setMenuState({ main = false, over = false, complete = false, hud = false }) {
    menus.main.classList.toggle("hidden", !main);
    menus.over.classList.toggle("hidden", !over);
    menus.complete.classList.toggle("hidden", !complete);
    menus.hud.classList.toggle("hidden", !hud);
}

function generateLevelData(currentLevel) {
    platforms = [];
    litCount = 0;
    targetLitCount = 0;
    combo = 0;
    comboTimer = 0;

    const w = canvas.width;
    const h = canvas.height;
    const margin = 24;
    const maxY = h - 84;

    const startW = 94;
    const startH = 20;
    const startX = w / 2 - startW / 2;
    const startY = 150;

    platforms.push(new Platform(startX, startY, startW, startH, colors[0], "static", false));
    targetLitCount++;

    let cursorX = startX;
    let cursorY = startY;
    const targetPlatformCount = clamp(6 + currentLevel, 7, 15);
    const horizontalReach = clamp(120 + currentLevel * 8, 120, 210);

    for (let i = 1; i < targetPlatformCount; i++) {
        const pw = rand(54, 96);
        const ph = rand(18, 28);
        const nextY = clamp(cursorY + rand(68, 116 + Math.min(24, currentLevel * 2)), startY + 56, maxY);

        let px = clamp(cursorX + rand(-horizontalReach, horizontalReach), margin, w - pw - margin);
        let py = nextY;

        let attempts = 0;
        while (attempts < 36 && platforms.some((p) => rectsOverlap(px, py, pw, ph, p.x, p.y, p.w, p.h, 22))) {
            px = clamp(px + rand(-52, 52), margin, w - pw - margin);
            py = clamp(py + rand(-24, 24), startY + 54, maxY);
            attempts++;
        }
        if (attempts >= 36) {
            continue;
        }

        let type = "static";
        const moveChance = clamp(0.14 + currentLevel * 0.03, 0.14, 0.5);
        if (currentLevel >= 2 && Math.random() < moveChance) {
            type = Math.random() < 0.56 ? "horizontal" : "vertical";
        }

        const hazardChance = clamp((currentLevel - 3) * 0.04, 0, 0.22);
        const isHazard = currentLevel >= 4 && i > 2 && Math.random() < hazardChance && type === "static";

        const color = colors[Math.floor(Math.random() * colors.length)];
        platforms.push(new Platform(px, py, pw, ph, color, type, isHazard));

        if (!isHazard) {
            targetLitCount++;
            cursorX = px;
            cursorY = py;
        }
    }
}

function startGame() {
    level = 1;
    resetRunStats();
    startLevel();
}

function resetRunStats() {
    score = 0;
    combo = 0;
    comboTimer = 0;
    bestComboRun = 0;
}

function startLevel() {
    generateLevelData(level);
    player.reset();
    particles = [];
    lightBursts = [];
    globalTime = 0;
    gameState = "PLAYING";
    updateHUD();
    setMenuState({ main: false, over: false, complete: false, hud: true });
    lastTime = performance.now();
    beginLoop();
}

function persistRecords() {
    if (level > bestLevel) {
        bestLevel = level;
        writeStoredNumber(STORAGE_KEYS.bestLevel, bestLevel);
    }
    if (score > bestScore) {
        bestScore = score;
        writeStoredNumber(STORAGE_KEYS.bestScore, bestScore);
    }
    updateRecordLabels();
}

function setGameOver() {
    if (gameState !== "PLAYING") {
        return;
    }
    gameState = "GAMEOVER";
    setScreenShake(0.45, 10);
    SFX.fail();
    lightBursts.push(new LightBurst(player.x, player.y, "#ff4f74", 24));
    spawnBurst(player.x, player.y, "#ff2a45", 38, 4.6);
    persistRecords();
    menuStats.finalLevel.textContent = `Reached Level: ${level}`;
    menuStats.finalScore.textContent = `Score: ${score}`;
    menuStats.finalCombo.textContent = `Best Combo: x${bestComboRun}`;
    setMenuState({ main: false, over: true, complete: false, hud: false });
}

function setLevelComplete() {
    if (gameState !== "PLAYING") {
        return;
    }
    gameState = "LEVEL_COMPLETE";
    SFX.clear();
    lightBursts.push(new LightBurst(player.x, player.y, "#89ff9e", 26));
    persistRecords();
    menuStats.levelSummary.textContent = `+${targetLitCount} lit | Score ${score} | Combo x${bestComboRun}`;
    setMenuState({ main: false, over: false, complete: true, hud: false });
}

function checkCollisions() {
    const pBottom = player.y + player.size / 2;
    const pTop = player.y - player.size;
    const pLeft = player.x - player.size / 2;
    const pRight = player.x + player.size / 2;
    const prevTop = player.prevY - player.size;
    const prevBottom = player.prevY + player.size / 2;
    const prevLeft = player.prevX - player.size / 2;
    const prevRight = player.prevX + player.size / 2;

    for (let i = 0; i < platforms.length; i++) {
        const plat = platforms[i];
        const overlapX = pRight > plat.x && pLeft < plat.x + plat.w;
        const overlapY = pBottom > plat.y && pTop < plat.y + plat.h;
        if (!overlapX || !overlapY) {
            continue;
        }
        if (plat.isHazard) {
            setGameOver();
            return;
        }
        if (player.vy >= 0) {
            const crossedTop = prevBottom <= plat.y + 2 && pBottom >= plat.y;
            const topSnapBand = pBottom <= plat.y + Math.max(12, Math.abs(player.vy) * 0.03);
            if (crossedTop || topSnapBand) {
                player.landOn(plat);
                plat.lightUp();
                break;
            }
        }

        // Play hit SFX only for fresh side collision, not for standing/landing on top.
        const wasOverlapping =
            prevRight > plat.x &&
            prevLeft < plat.x + plat.w &&
            prevBottom > plat.y &&
            prevTop < plat.y + plat.h;
        const sideImpact = !wasOverlapping && Math.abs(player.vx) > 120;
        if (sideImpact) {
            tryPlaySfx("boxHit", TUNING.boxHitSfxCooldown, SFX.boxHit);
        }
    }
}

function beginLoop() {
    if (animating) {
        return;
    }
    animating = true;
    requestAnimationFrame(gameLoop);
}

function gameLoop(timestamp) {
    if (!animating) {
        return;
    }
    let dt = (timestamp - lastTime) / 1000;
    dt = Math.min(0.1, Math.max(0, dt));
    lastTime = timestamp;
    globalTime += dt;

    update(dt);
    draw();

    const shouldContinue = gameState === "PLAYING" || particles.length > 0 || shakeTime > 0;
    if (shouldContinue) {
        requestAnimationFrame(gameLoop);
    } else {
        animating = false;
        draw();
    }
}

function update(dt) {
    sfxTimers.bounce = Math.max(0, sfxTimers.bounce - dt);
    sfxTimers.boxHit = Math.max(0, sfxTimers.boxHit - dt);

    platforms.forEach((platform) => platform.update(dt, globalTime));
    if (gameState === "PLAYING") {
        player.update(dt);
        checkCollisions();
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(dt);
        if (particles[i].life <= 0) {
            particles.splice(i, 1);
        }
    }
    for (let i = lightBursts.length - 1; i >= 0; i--) {
        lightBursts[i].update(dt);
        if (lightBursts[i].life <= 0) {
            lightBursts.splice(i, 1);
        }
    }
    if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0 && combo !== 0) {
            combo = 0;
            updateHUD();
        }
    }
    if (shakeTime > 0) {
        shakeTime = Math.max(0, shakeTime - dt);
    }
}

function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#050510");
    gradient.addColorStop(0.45, "#0f162f");
    gradient.addColorStop(1, "#24113e");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const auroraX = canvas.width * 0.22 + Math.sin(globalTime * 0.22) * 80;
    const auroraY = canvas.height * 0.24;
    const aurora = ctx.createRadialGradient(auroraX, auroraY, 30, auroraX, auroraY, canvas.height * 0.85);
    aurora.addColorStop(0, "rgba(107, 196, 255, 0.14)");
    aurora.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = aurora;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const warmX = canvas.width * 0.78 + Math.cos(globalTime * 0.2) * 55;
    const warmY = canvas.height * 0.6;
    const warmGlow = ctx.createRadialGradient(warmX, warmY, 20, warmX, warmY, canvas.height * 0.55);
    warmGlow.addColorStop(0, "rgba(255, 192, 120, 0.11)");
    warmGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < ambientDust.length; i++) {
        const dust = ambientDust[i];
        const drift = Math.sin(globalTime * 0.3 + i) * dust.drift;
        const radial = ctx.createRadialGradient(dust.x + drift, dust.y, 1, dust.x + drift, dust.y, dust.radius);
        radial.addColorStop(0, `rgba(255, 228, 188, ${dust.alpha})`);
        radial.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = radial;
        ctx.fillRect(dust.x + drift - dust.radius, dust.y - dust.radius, dust.radius * 2, dust.radius * 2);
    }

    for (let i = 0; i < ambientStars.length; i++) {
        const star = ambientStars[i];
        const twinkle = 0.25 + Math.abs(Math.sin(globalTime * star.speed + star.pulse)) * 0.65;
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = i % 3 === 0 ? "#ffeccc" : "#d2f6ff";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    const focusX = gameState === "PLAYING" ? player.x : canvas.width * 0.5;
    const focusY = gameState === "PLAYING" ? player.y : canvas.height * 0.35;
    const spot = ctx.createRadialGradient(focusX, focusY - 10, 20, focusX, focusY, 260);
    spot.addColorStop(0, "rgba(185, 255, 242, 0.18)");
    spot.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    const gridSize = 62;
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    const vignette = ctx.createRadialGradient(
        canvas.width * 0.5,
        canvas.height * 0.5,
        Math.min(canvas.width, canvas.height) * 0.25,
        canvas.width * 0.5,
        canvas.height * 0.5,
        Math.max(canvas.width, canvas.height) * 0.7
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.32)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function draw() {
    ctx.save();
    if (shakeTime > 0) {
        const dx = (Math.random() - 0.5) * shakeMagnitude;
        const dy = (Math.random() - 0.5) * shakeMagnitude;
        ctx.translate(dx, dy);
    }
    drawBackground();
    platforms.forEach((platform) => platform.draw(ctx));
    lightBursts.forEach((burst) => burst.draw(ctx));
    particles.forEach((particle) => particle.draw(ctx));
    if (gameState === "PLAYING") {
        player.draw(ctx);
    }
    ctx.restore();
}

function handleInput(clientX) {
    if (gameState !== "PLAYING") {
        return;
    }
    ensureAudioReady();
    const direction = clientX < canvas.width / 2 ? -1 : 1;
    player.queueJump(direction);
}

window.addEventListener("touchstart", (event) => {
    if (event.target.closest("button")) {
        return;
    }
    event.preventDefault();
    for (let i = 0; i < event.changedTouches.length; i++) {
        handleInput(event.changedTouches[i].clientX);
    }
}, { passive: false });

window.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) {
        return;
    }
    handleInput(event.clientX);
});

window.addEventListener("keydown", (event) => {
    if (gameState !== "PLAYING") {
        return;
    }
    ensureAudioReady();
    if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        player.queueJump(-1);
    } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        player.queueJump(1);
    } else if (event.key === " " || event.key === "ArrowUp") {
        player.queueJump(player.x < canvas.width / 2 ? 1 : -1);
    }
});

document.getElementById("start-btn").addEventListener("click", () => {
    ensureAudioReady();
    startGame();
});
document.getElementById("restart-btn").addEventListener("click", () => {
    ensureAudioReady();
    resetRunStats();
    startLevel();
});
document.getElementById("next-level-btn").addEventListener("click", () => {
    ensureAudioReady();
    level++;
    startLevel();
});
soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    updateSoundButtonLabel();
    writeStoredBoolean(STORAGE_KEYS.soundOn, soundOn);
    if (soundOn) {
        ensureAudioReady();
        playTone({ frequency: 520, duration: 0.09, volume: 0.08, type: "triangle" });
    }
});

resize();
bestLevel = Math.max(1, readStoredNumber(STORAGE_KEYS.bestLevel, 1));
bestScore = Math.max(0, readStoredNumber(STORAGE_KEYS.bestScore, 0));
soundOn = readStoredBoolean(STORAGE_KEYS.soundOn, true);
updateSoundButtonLabel();
updateRecordLabels();
player = new Player();
setMenuState({ main: true, over: false, complete: false, hud: false });
draw();
