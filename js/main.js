import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Game {
    constructor() {
        // Escena, cámara y renderer
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.controls = null;

        // Tablero y tiles
        this.board = null;
        this.boardSize = { width: 8, height: 10 };
        this.tiles = [];   // Meshes de las casillas
        this.path = [];    // Coordenadas lógicas del camino (perímetro)

        // Jugadores / dado / estado
        this.players = []; // { group, positionIndex }
        this.playerOffsets = [[-0.22, 0], [0, 0], [0.22, 0]]; // separación en la misma casilla
        this.currentPlayerIndex = 0;
        this.dice = null;
        this.isRolling = false;

        // DOM
        this.diceButton = null;
        this.diceResultEl = null;

        // Casillas especiales (se llenan en createTiles)
        this.specialTilePositions = new Map(); // index -> { type:'benefit'|'penalty', key, effect, ... }
        this.specialDefinitions = {
            benefits: [
                { key: 'cacao-gold', effect: 'Avanza 3 casillas - ¡Encontraste cacao dorado!', spaces: 3 },
                { key: 'fermentation', effect: 'Avanza 2 casillas - ¡Fermentación perfecta!', spaces: 2 },
                { key: 'master-chocolatier', effect: 'Tira el dado otra vez - ¡Maestría chocolatera!', extraTurn: true }
            ],
            penalties: [
                { key: 'plague', effect: 'Retrocede 2 casillas - ¡Plaga en el cacao!', spaces: -2 },
                { key: 'failed-harvest', effect: 'Pierde un turno - ¡Cosecha fallida!', skipTurn: true },
                { key: 'rain', effect: 'Retrocede 1 casilla - ¡Lluvia excesiva!', spaces: -1 }
            ]
        };

        this.init();
    }

    init() {
        // Renderer y DOM
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0xF2E5D5); // tono arena/beige
        document.body.appendChild(this.renderer.domElement);

        // Cámara y controles
        this.camera.position.set(0, 12, 14);
        this.camera.lookAt(0, 0, 0);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2.1;
        this.controls.minDistance = 6;
        this.controls.maxDistance = 25;

        // Raycaster para click en el dado
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        window.addEventListener('click', (event) => this.onGlobalClick(event), false);

        // Luces
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const dir = new THREE.DirectionalLight(0xffffff, 1);
        dir.position.set(5, 10, 5);
        dir.castShadow = true;
        this.scene.add(dir);
        this.renderer.shadowMap.enabled = true;

        // Elementos UI (asume existen en index.html)
        this.diceButton = document.getElementById('diceButton');
        this.diceResultEl = document.getElementById('diceResult');
        if (this.diceButton) this.diceButton.addEventListener('click', () => this.rollDice());

        // Construcción del juego
        this.createBoard();
        this.createTiles();      // llena this.path y this.tiles
        this.createPlayers();    // usa this.tiles[0] como START
        this.createDice();

        // Resize y animación
        window.addEventListener('resize', () => this.onWindowResize(), false);
        this.animate();
    }

    onGlobalClick(event) {
        // Convierte coords a NDC y consulta intersecciones
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        if (!this.dice) return;
        const intersects = this.raycaster.intersectObject(this.dice, true);
        // Buscar si algún intersect corresponde al dado (o hijo de este)
        const hit = intersects.find(i => {
            let obj = i.object;
            while (obj) {
                if (obj === this.dice) return true;
                obj = obj.parent;
            }
            return false;
        });
        if (hit && !this.isRolling) {
            // Llamar al mismo handler del botón
            this.rollDice();
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // -------------------------
    // TABLERO y CASILLAS
    // -------------------------
    createBoard() {
        const boardGeometry = new THREE.BoxGeometry(this.boardSize.width + 0.5, 0.5, this.boardSize.height + 0.5);
        const boardMaterial = new THREE.MeshStandardMaterial({ color: 0xDDBB88, roughness: 0.9 });
        this.board = new THREE.Mesh(boardGeometry, boardMaterial);
        this.board.receiveShadow = true;
        this.scene.add(this.board);

        // Borde ornamental
        const borderGeometry = new THREE.BoxGeometry(this.boardSize.width + 1, 0.8, this.boardSize.height + 1);
        const borderMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const border = new THREE.Mesh(borderGeometry, borderMaterial);
        border.position.y = -0.15;
        border.receiveShadow = true;
        this.scene.add(border);
    }

    createTiles() {
        const tileSize = 1;
        const startX = -(this.boardSize.width / 2) + tileSize / 2;
        const startZ = -(this.boardSize.height / 2) + tileSize / 2;

        // Construir path perimetral en sentido horario (usado para mover fichas)
        this.path = [];
        for (let x = 0; x < this.boardSize.width; x++) this.path.push([x, 0]); // top row left->right
        for (let z = 1; z < this.boardSize.height; z++) this.path.push([this.boardSize.width - 1, z]); // right col top->bottom
        for (let x = this.boardSize.width - 2; x >= 0; x--) this.path.push([x, this.boardSize.height - 1]); // bottom row right->left
        for (let z = this.boardSize.height - 2; z > 0; z--) this.path.push([0, z]); // left col bottom->top

        // Crear tiles y guardarlos
        this.tiles = [];
        for (let i = 0; i < this.path.length; i++) {
            const [col, row] = this.path[i];
            const tileGeom = new THREE.BoxGeometry(0.95, 0.1, 0.95);
            const isStart = i === 0;
            const tileMat = new THREE.MeshStandardMaterial({ color: isStart ? 0xFFD700 : 0xF5F5DC, roughness: 0.8 });
            const tile = new THREE.Mesh(tileGeom, tileMat);
            tile.receiveShadow = true;
            tile.position.set(startX + col * tileSize, 0.25, startZ + row * tileSize);
            this.scene.add(tile);
            this.tiles.push(tile);
        }

        // Distribuir casillas especiales (beneficios y penalidades)
        this.assignSpecialTiles();

        // Después de crear tiles, añadir decoraciones (árboles de cacao en el centro, chocolates...)
        this.addDecorativeElements();
    }

    // decoraciones basadas en la imagen (esquinas + algunos a lo largo del path)
    addDecorativeElements() {
        // Centrar árboles de cacao (grupo en el centro)
        const centerRadius = 2.0;
        for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * Math.PI * 2;
            const x = Math.cos(ang) * centerRadius;
            const z = Math.sin(ang) * centerRadius;
            // reemplazamos palmeras por árboles de cacao
            this.createCacaoTree(x, z);
        }

        // añadir visuales en las casillas especiales alrededor del perímetro
        const startX = -(this.boardSize.width / 2) + 0.5;
        const startZ = -(this.boardSize.height / 2) + 0.5;
        this.path.forEach(([cx, cz], idx) => {
            const wx = startX + cx;
            const wz = startZ + cz;
            const special = this.specialTilePositions.get(idx);
            if (special) {
                if (special.kind === 'benefit') this._createVisualForBenefit(wx, wz, special.key);
                else this._createVisualForPenalty(wx, wz, special.key);
            } else {
                // decorativos neutrales
                if (idx % 6 === 0) this.createChocolate(wx, wz);
                else if (idx % 4 === 0) this.createCoffeeBean(wx, wz);
            }
        });
    }

    // Asignar posiciones aleatorias en el path para beneficios y penalidades
    assignSpecialTiles() {
        const len = this.path.length;
        const used = new Set([0]); // evitar la casilla inicial
        const place = (list, kind) => {
            list.forEach(def => {
                let pos;
                do { pos = Math.floor(Math.random() * len); } while (used.has(pos));
                used.add(pos);
                this.specialTilePositions.set(pos, { kind, key: def.key, effect: def.effect, ...def });
            });
        };
        place(this.specialDefinitions.benefits, 'benefit');
        place(this.specialDefinitions.penalties, 'penalty');
    }

    // Visuales temáticos para beneficios
    _createVisualForBenefit(x, z, key) {
        if (key === 'cacao-gold') {
            const geom = new THREE.CapsuleGeometry(0.12, 0.25, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.6, roughness: 0.2 });
            const m = new THREE.Mesh(geom, mat);
            m.position.set(x, 0.35, z);
            m.castShadow = true;
            this.scene.add(m);
        } else if (key === 'fermentation') {
            const geom = new THREE.BoxGeometry(0.36, 0.16, 0.36);
            const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
            const m = new THREE.Mesh(geom, mat);
            m.position.set(x, 0.3, z);
            this.scene.add(m);
        } else if (key === 'master-chocolatier') {
            const geom = new THREE.ConeGeometry(0.18, 0.36, 10);
            const mat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
            const m = new THREE.Mesh(geom, mat);
            m.position.set(x, 0.4, z);
            this.scene.add(m);
        }
    }

    // Visuales temáticos para penalidades
    _createVisualForPenalty(x, z, key) {
        if (key === 'plague') {
            const geom = new THREE.PlaneGeometry(0.28, 0.28);
            const mat = new THREE.MeshStandardMaterial({ color: 0x654321, side: THREE.DoubleSide });
            const m = new THREE.Mesh(geom, mat);
            m.rotation.x = -Math.PI / 2;
            m.position.set(x, 0.27, z);
            this.scene.add(m);
        } else if (key === 'failed-harvest') {
            const geom = new THREE.CapsuleGeometry(0.12, 0.22, 4, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0x463e3f });
            const m = new THREE.Mesh(geom, mat);
            m.position.set(x, 0.33, z);
            this.scene.add(m);
        } else if (key === 'rain') {
            const geom = new THREE.SphereGeometry(0.18, 8, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0x808080, transparent: true, opacity: 0.85 });
            const m = new THREE.Mesh(geom, mat);
            m.scale.y = 0.6;
            m.position.set(x, 0.4, z);
            this.scene.add(m);
        }
    }

    createPalmTree(x, z) {
        const trunkGeom = new THREE.CylinderGeometry(0.09, 0.12, 1, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.set(x, 0.55, z);
        trunk.castShadow = true;
        this.scene.add(trunk);

        const leavesGeom = new THREE.ConeGeometry(0.8, 0.8, 4);
        const leavesMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        const leaves = new THREE.Mesh(leavesGeom, leavesMat);
        leaves.position.set(x, 1.3, z);
        leaves.castShadow = true;
        this.scene.add(leaves);
    }

    // Árbol de cacao centrado (tronco + copa + frutos)
    createCacaoTree(x, z) {
        // Tronco
        const trunkGeom = new THREE.CylinderGeometry(0.12, 0.16, 1.4, 10);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.set(x, 0.7, z);
        trunk.castShadow = true;
        this.scene.add(trunk);

        // Copa (más ancha que una palmera)
        const crownGeom = new THREE.SphereGeometry(0.9, 12, 8);
        const crownMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.8 });
        const crown = new THREE.Mesh(crownGeom, crownMat);
        crown.position.set(x, 1.8, z);
        crown.scale.set(1, 0.8, 1);
        crown.castShadow = true;
        this.scene.add(crown);

        // Frutos de cacao colgando
        for (let i = 0; i < 3; i++) {
            const ang = (i / 3) * Math.PI * 2;
            const rx = Math.cos(ang) * 0.35;
            const rz = Math.sin(ang) * 0.35;
            const fruitGeom = new THREE.CapsuleGeometry(0.08, 0.18, 4, 6);
            const fruitMat = new THREE.MeshStandardMaterial({ color: 0xc65102, roughness: 0.5 });
            const fruit = new THREE.Mesh(fruitGeom, fruitMat);
            fruit.position.set(x + rx, 1.45, z + rz);
            fruit.rotation.set(0, ang, Math.PI / 6);
            fruit.castShadow = true;
            this.scene.add(fruit);
        }
    }

    createChocolate(x, z) {
        const boxGeom = new THREE.BoxGeometry(0.42, 0.12, 0.58);
        const boxMat = new THREE.MeshStandardMaterial({ color: 0x3C1C17, roughness: 0.4 });
        const box = new THREE.Mesh(boxGeom, boxMat);
        box.position.set(x, 0.31, z);
        box.castShadow = true;
        this.scene.add(box);
    }

    createCoffeeBean(x, z) {
        const beanGeom = new THREE.SphereGeometry(0.12, 8, 8);
        const beanMat = new THREE.MeshStandardMaterial({ color: 0x3C1C17 });
        const bean = new THREE.Mesh(beanGeom, beanMat);
        bean.scale.y = 0.5;
        bean.position.set(x, 0.28, z);
        bean.castShadow = true;
        this.scene.add(bean);
    }

    // -------------------------
    // JUGADORES (fichas)
    // -------------------------
    createPlayers() {
        if (!this.tiles || this.tiles.length === 0) return;
        const startPos = this.tiles[0].position;

        const colors = [0x228B22, 0x4169E1, 0xFF4500]; // verde, azul, naranja
        this.players = [];

        colors.forEach((color, idx) => {
            const group = new THREE.Group();

            const bodyGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.55, 12);
            const bodyMat = new THREE.MeshStandardMaterial({ color });
            const body = new THREE.Mesh(bodyGeom, bodyMat);
            body.position.y = 0.28;
            body.castShadow = true;
            group.add(body);

            const headGeom = new THREE.SphereGeometry(0.16, 12, 12);
            const headMat = new THREE.MeshStandardMaterial({ color: 0xFFE4C4 });
            const head = new THREE.Mesh(headGeom, headMat);
            head.position.y = 0.65;
            head.castShadow = true;
            group.add(head);

            const hatGeom = new THREE.ConeGeometry(0.16, 0.28, 8);
            const hatMat = new THREE.MeshStandardMaterial({ color });
            const hat = new THREE.Mesh(hatGeom, hatMat);
            hat.position.y = 0.9;
            hat.castShadow = true;
            group.add(hat);

            // posicion inicial (START tile) con un pequeño offset para que no se monten
            const offset = this.playerOffsets[idx] || [0, 0];
            group.position.set(startPos.x + offset[0], 0, startPos.z + offset[1]);

            this.scene.add(group);
            this.players.push({ group, positionIndex: 0 });
        });
    }

    // -------------------------
    // DADO (pips/dots) y lectura de cara superior
    // -------------------------
    createDice() {
        const diceGeom = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
        const diceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
        this.dice = new THREE.Mesh(diceGeom, diceMat);
        this.dice.castShadow = true;
        this.dice.position.set(this.boardSize.width / 2 + 2, 1.5, -2);
        this.scene.add(this.dice);
        this.dice.userData.clickable = true;

        // aristas para que se vea más definido
        const edges = new THREE.EdgesGeometry(diceGeom);
        const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xe0e0e0 }));
        this.dice.add(lines);

        // pips (puntos)
        this.addDiceDots();
    }

    addDiceDots() {
        const dotGeom = new THREE.SphereGeometry(0.07, 16, 16);
        const dotMat = new THREE.MeshStandardMaterial({ color: 0x000000 });

        // posiciones 2D en cada cara
        const P = 0.25;
        const dotSets2D = {
            1: [[0, 0]],
            2: [[-P, -P], [P, P]],
            3: [[-P, -P], [0, 0], [P, P]],
            4: [[-P, -P], [-P, P], [P, -P], [P, P]],
            5: [[-P, -P], [-P, P], [0, 0], [P, -P], [P, P]],
            6: [[-P, -P], [-P, 0], [-P, P], [P, -P], [P, 0], [P, P]]
        };

        // Mapear número -> cara del cubo (coherente: opuestas suman 7)
        const faceMap = {
            1: { axis: 'y', sign: 1, depth: 0.51 },  // 1 en +Y
            6: { axis: 'y', sign: -1, depth: 0.51 }, // 6 en -Y
            2: { axis: 'z', sign: 1, depth: 0.51 },  // 2 en +Z
            5: { axis: 'z', sign: -1, depth: 0.51 }, // 5 en -Z
            3: { axis: 'x', sign: 1, depth: 0.51 },  // 3 en +X
            4: { axis: 'x', sign: -1, depth: 0.51 }  // 4 en -X
        };

        Object.entries(dotSets2D).forEach(([numStr, pos2d]) => {
            const num = parseInt(numStr);
            const face = faceMap[num];
            pos2d.forEach(([u, v]) => {
                const dot = new THREE.Mesh(dotGeom, dotMat);
                const local = new THREE.Vector3();
                if (face.axis === 'x') local.set(face.sign * face.depth, v, u);
                else if (face.axis === 'y') local.set(u, face.sign * face.depth, v);
                else local.set(u, v, face.sign * face.depth);
                dot.position.copy(local);
                this.dice.add(dot);
            });
        });
    }

    // lee qué cara está apuntando hacia +Y (arriba en mundo)
    getTopFace() {
        const up = new THREE.Vector3(0, 1, 0);
        // Normales locales según faceMap usado arriba
        const faceNormals = {
            1: new THREE.Vector3(0, 1, 0),
            6: new THREE.Vector3(0, -1, 0),
            2: new THREE.Vector3(0, 0, 1),
            5: new THREE.Vector3(0, 0, -1),
            3: new THREE.Vector3(1, 0, 0),
            4: new THREE.Vector3(-1, 0, 0)
        };
        let best = { num: 1, dot: -Infinity };
        Object.entries(faceNormals).forEach(([num, vec]) => {
            const worldDir = vec.clone().applyQuaternion(this.dice.quaternion); // local -> mundo
            const dot = worldDir.dot(up);
            if (dot > best.dot) best = { num: parseInt(num), dot };
        });
        return best.num;
    }

    // -------------------------
    // TIRAR DADO y ANIMACIÓN
    // -------------------------
    rollDice() {
        if (this.isRolling) return;
        this.isRolling = true;
        if (this.diceButton) {
            this.diceButton.disabled = true;
            this.diceButton.style.opacity = '0.5';
        }
        if (this.diceResultEl) this.diceResultEl.style.opacity = '0';

        // número aleatorio que usaremos para orientar la rotación final (estética)
        const randomNumber = Math.floor(Math.random() * 6) + 1;

        // map número -> rotación final (para dejar la cara deseada apuntando hacia +Y)
        const finalRotations = {
            1: { x: 0, y: 0, z: 0 },                 // +Y
            6: { x: Math.PI, y: 0, z: 0 },           // -Y
            2: { x: -Math.PI / 2, y: 0, z: 0 },      // +Z -> arriba
            5: { x: Math.PI / 2, y: 0, z: 0 },       // -Z -> arriba
            3: { x: 0, y: 0, z: Math.PI / 2 },       // +X -> arriba
            4: { x: 0, y: 0, z: -Math.PI / 2 }       // -X -> arriba
        };

        const spins = {
            x: Math.PI * 4 * (1 + Math.random()),
            y: Math.PI * 4 * (1 + Math.random()),
            z: Math.PI * 2 * Math.random()
        };

        const targetRotation = {
            x: finalRotations[randomNumber].x + spins.x,
            y: finalRotations[randomNumber].y + spins.y,
            z: finalRotations[randomNumber].z + spins.z
        };

        const startRot = { x: this.dice.rotation.x, y: this.dice.rotation.y, z: this.dice.rotation.z };
        const duration = 1400;
        const startTime = performance.now();

        const animateRoll = (t) => {
            const elapsed = t - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 4);

            this.dice.rotation.x = startRot.x + (targetRotation.x - startRot.x) * ease;
            this.dice.rotation.y = startRot.y + (targetRotation.y - startRot.y) * ease;
            this.dice.rotation.z = startRot.z + (targetRotation.z - startRot.z) * ease;

            // leve salto
            const jump = Math.sin(progress * Math.PI) * 0.9;
            this.dice.position.y = 1.5 + jump;

            if (progress < 1) requestAnimationFrame(animateRoll);
            else {
                // fijar rotación final (sin spins)
                this.dice.rotation.set(finalRotations[randomNumber].x, finalRotations[randomNumber].y, finalRotations[randomNumber].z);
                this.dice.position.y = 1.5;

                // leer la cara superior real (no confiar en randomNumber visual)
                const top = this.getTopFace();
                if (this.diceResultEl) {
                    this.diceResultEl.textContent = `¡Sacaste un ${top}!`;
                    this.diceResultEl.style.opacity = '1';
                }

                // mover al jugador actual según 'top' y, cuando termine el movimiento, liberar el estado y el botón
                this.moveCurrentPlayer(top).then(() => {
                    this.isRolling = false;
                    if (this.diceButton) {
                        this.diceButton.disabled = false;
                        this.diceButton.style.opacity = '1';
                    }
                }).catch(() => {
                    // fallback: liberar estado
                    this.isRolling = false;
                    if (this.diceButton) {
                        this.diceButton.disabled = false;
                        this.diceButton.style.opacity = '1';
                    }
                });
            }
        };

        requestAnimationFrame(animateRoll);
    }

    // mueve al jugador actual "steps" casillas, animando paso a paso
    // devuelve una Promise que se resuelve cuando termina el movimiento
    moveCurrentPlayer(steps) {
        return new Promise((resolve) => {
            if (!this.players || this.players.length === 0) return resolve();

            const playerIndex = this.currentPlayerIndex;
            const player = this.players[playerIndex];
            if (!player) return resolve();

            // número de pasos a realizar
            let remaining = steps;

            const stepDuration = 200; // ms por casilla

            const doStep = () => {
                if (remaining <= 0) {
                    // terminado: avanzar el turno al siguiente jugador
                    // Después de llegar al destino, comprobar casilla especial
                    const landedIndex = player.positionIndex;
                    const special = this.specialTilePositions.get(landedIndex);
                    if (special) {
                        // mostrar efecto
                        if (this.diceResultEl) this.diceResultEl.textContent = special.effect;

                        // aplicar espacios (mover inmediatamente)
                        if (special.spaces) {
                            const finalPos = Math.max(0, Math.min(this.tiles.length - 1, landedIndex + special.spaces));
                            this._movePlayerInstant(player, finalPos);
                        }

                        // aplicar skipTurn/extraTurn flags
                        if (special.skipTurn) player.skipNextTurn = true;
                        if (special.extraTurn) player.extraTurn = true;
                    }

                    // decidir siguiente jugador según extraTurn/skipNextTurn
                    let next;
                    if (player.extraTurn) {
                        // darle otra tirada al mismo jugador
                        player.extraTurn = false; // consumir
                        next = playerIndex;
                    } else {
                        next = (playerIndex + 1) % this.players.length;
                        // si el siguiente tiene skipNextTurn, consumir y saltarlo
                        if (this.players[next] && this.players[next].skipNextTurn) {
                            this.players[next].skipNextTurn = false; // consumido
                            next = (next + 1) % this.players.length;
                        }
                    }
                    this.currentPlayerIndex = next;
                    return resolve();
                }

                // calcular siguiente índice y posiciones
                const nextIndex = (player.positionIndex + 1) % this.tiles.length;
                const fromPos = this.tiles[player.positionIndex].position.clone();
                const toPos = this.tiles[nextIndex].position.clone();

                // aplicar offset para ese jugador (para que no se superpongan)
                const offset = this.playerOffsets[playerIndex] || [0, 0];
                fromPos.x += offset[0]; fromPos.z += offset[1];
                toPos.x += offset[0];   toPos.z += offset[1];

                // animar desde fromPos -> toPos
                const startTime = performance.now();
                const animateTile = (t) => {
                    const elapsed = t - startTime;
                    const p = Math.min(elapsed / stepDuration, 1);
                    // ease-in-out
                    const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
                    const nx = fromPos.x + (toPos.x - fromPos.x) * ease;
                    const nz = fromPos.z + (toPos.z - fromPos.z) * ease;
                    player.group.position.set(nx, 0, nz);

                    if (p < 1) requestAnimationFrame(animateTile);
                    else {
                        // actualizar índice y continuar
                        player.positionIndex = nextIndex;
                        remaining--;
                        // pequeño delay entre pasos para que se vea el paso individual
                        setTimeout(doStep, 120);
                    }
                };
                requestAnimationFrame(animateTile);
            };

            // iniciar la cadena de pasos
            doStep();
        });
    }

    // Mueve instantáneamente (sin animación paso a paso) el jugador a una casilla index
    _movePlayerInstant(player, index) {
        if (!this.tiles[index]) return;
        const pos = this.tiles[index].position.clone();
        const playerIndex = this.players.indexOf(player);
        const offset = this.playerOffsets[playerIndex] || [0, 0];
        pos.x += offset[0]; pos.z += offset[1];
        player.group.position.set(pos.x, 0, pos.z);
        player.positionIndex = index;
    }

    // -------------------------
    // BUCLE PRINCIPAL
    // -------------------------
    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// iniciar
document.addEventListener('DOMContentLoaded', () => {
    new Game();
});
