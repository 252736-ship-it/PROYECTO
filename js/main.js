import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.controls = null;
        this.board = null;
        this.boardSize = { width: 8, height: 10 }; // Tamaño del tablero
        this.tiles = [];
        this.dice = null;
        this.isRolling = false;
        this.decorativeElements = [];
        this.players = [];
        this.path = [];
        this.init();
    }

    init() {
        // Configurar renderer
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x87CEEB); // Color de cielo
        document.body.appendChild(this.renderer.domElement);

        // Configurar cámara
        this.camera.position.set(0, 10, 12);
        this.camera.lookAt(0, 0, 0);

        // Agregar controles
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2.1;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 15;

        // Configurar el Raycaster para detectar clicks en el dado
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Agregar eventos para el click en el dado
        document.addEventListener('click', (event) => {
            // Convertir coordenadas del mouse a coordenadas normalizadas (-1 a +1)
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Actualizar el raycaster
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // Verificar intersección con el dado
            const intersects = this.raycaster.intersectObject(this.dice, true);

            if (intersects.length > 0 && intersects[0].object.userData.clickable) {
                this.rollDice();
            }
        });

        // Agregar evento para el botón de lanzar dado
        const diceButton = document.getElementById('diceButton');
        diceButton.addEventListener('click', () => this.rollDice());

        // Agregar luces
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 8, 5);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        // Habilitar sombras
        this.renderer.shadowMap.enabled = true;

        // Crear el tablero y elementos del juego
        this.createBoard();
        this.createTiles();
        this.createDice();
        this.createPlayers();

        // Manejar el redimensionamiento de la ventana
        window.addEventListener('resize', () => this.onWindowResize(), false);

        // Iniciar el bucle de renderizado
        this.animate();
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    createDice() {
        const diceGeometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
        const diceMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,  // Color blanco
            roughness: 0.2,
            metalness: 0.1
        });

        // Agregar bisel suave a los bordes
        const edges = new THREE.EdgesGeometry(diceGeometry);
        const edgesMaterial = new THREE.LineBasicMaterial({ color: 0xe0e0e0 });
        const edgesLines = new THREE.LineSegments(edges, edgesMaterial);

        this.dice = new THREE.Mesh(diceGeometry, diceMaterial);
        this.dice.add(edgesLines);

        // Posicionar el dado en una mejor ubicación
        this.dice.position.set(this.boardSize.width / 2 + 2, 1.5, -2);
        this.dice.rotation.set(0, 0, 0); // Comenzar en posición recta
        this.dice.castShadow = true;
        this.scene.add(this.dice);

        // Hacer el dado clickeable
        this.dice.userData = { clickable: true };

        // Agregar solo los puntos al dado
        this.addDiceDots();
    }

    addDiceDots() {
        const dotGeometry = new THREE.SphereGeometry(0.07, 32, 32);
        const dotMaterial = new THREE.MeshStandardMaterial({
            color: 0x000000,
            roughness: 0.3,
            metalness: 0.1
        });

        // posiciones 2D (x,y) relativas al centro de la cara (unidades en el plano de la cara)
        const P = 0.25;
        const dotSets2D = {
            1: [[0, 0]], // centro
            2: [[-P, -P], [P, P]],
            3: [[-P, -P], [0, 0], [P, P]],
            4: [[-P, -P], [-P, P], [P, -P], [P, P]],
            5: [[-P, -P], [-P, P], [0, 0], [P, -P], [P, P]],
            6: [[-P, -P], [-P, 0], [-P, P], [P, -P], [P, 0], [P, P]]
        };

        // Mapeo de número -> cara del cubo (normal) y el offset en la dirección normal
        // Usamos la convención para que las caras opuestas sumen 7:
        // 1 <-> 6, 2 <-> 5, 3 <-> 4
        // Asignamos:
        // 1 -> +Y (cara superior), 6 -> -Y (inferior)
        // 2 -> +Z (frente), 5 -> -Z (atrás)
        // 3 -> +X (derecha), 4 -> -X (izquierda)
        const faceMap = {
            1: { axis: 'y', sign: 1, depth: 0.51 },
            6: { axis: 'y', sign: -1, depth: 0.51 },
            2: { axis: 'z', sign: 1, depth: 0.51 },
            5: { axis: 'z', sign: -1, depth: 0.51 },
            3: { axis: 'x', sign: 1, depth: 0.51 },
            4: { axis: 'x', sign: -1, depth: 0.51 }
        };

        // Para cada cara, crear los dots en la posición correcta del cubo
        Object.entries(dotSets2D).forEach(([numStr, positions2D]) => {
            const num = parseInt(numStr);
            const face = faceMap[num];

            positions2D.forEach(([u, v]) => {
                const dot = new THREE.Mesh(dotGeometry, dotMaterial);

                // coordenadas locales (x,y,z) relativas al centro del cubo
                let local = new THREE.Vector3(0, 0, 0);

                // según el eje de la cara, interpretamos (u,v) como:
                // si axis === 'x' => (depth*sign, v, u)  (cara perpendicular a X; plano Y-Z)
                // si axis === 'y' => (u, depth*sign, v)  (cara perpendicular a Y; plano X-Z)
                // si axis === 'z' => (u, v, depth*sign)  (cara perpendicular a Z; plano X-Y)
                if (face.axis === 'x') {
                    local.set(face.sign * face.depth, v, u);
                } else if (face.axis === 'y') {
                    local.set(u, face.sign * face.depth, v);
                } else { // 'z'
                    local.set(u, v, face.sign * face.depth);
                }

                dot.position.copy(local);
                this.dice.add(dot);
            });
        });
    }

    addDiceNumbers() {
        const numberGeometry = new THREE.PlaneGeometry(0.3, 0.3);
        const numberMaterial = new THREE.MeshStandardMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });

        const numbers = [
            { value: "1", position: [0, 0, 0.501], rotation: [0, 0, 0] },
            { value: "2", position: [0, 0, -0.501], rotation: [0, Math.PI, 0] },
            { value: "3", position: [0.501, 0, 0], rotation: [0, Math.PI / 2, 0] },
            { value: "4", position: [-0.501, 0, 0], rotation: [0, -Math.PI / 2, 0] },
            { value: "5", position: [0, 0.501, 0], rotation: [-Math.PI / 2, 0, 0] },
            { value: "6", position: [0, -0.501, 0], rotation: [Math.PI / 2, 0, 0] }
        ];

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        numbers.forEach(({ value, position, rotation }) => {
            ctx.clearRect(0, 0, 128, 128);
            ctx.fillStyle = 'black';
            ctx.font = 'bold 80px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(value, 64, 64);

            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.MeshStandardMaterial({
                map: texture,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide
            });

            const numberPlane = new THREE.Mesh(numberGeometry, material);
            numberPlane.position.set(...position);
            numberPlane.rotation.set(...rotation);
            this.dice.add(numberPlane);
        });
    }

    rollDice() {
        if (this.isRolling) return;
        this.isRolling = true;

        // Obtener elementos del DOM
        const diceResultElement = document.getElementById('diceResult');
        const diceButton = document.getElementById('diceButton');

        // Deshabilitar el botón mientras el dado gira
        diceButton.disabled = true;
        diceButton.style.opacity = '0.5';
        diceResultElement.style.opacity = '0';

        // Generar un número aleatorio (1-6)
        const randomNumber = Math.floor(Math.random() * 6) + 1;

        // Configurar las rotaciones finales para que la cara correspondiente quede hacia arriba (+Y)
        const finalRotations = {
            1: { x: 0, y: 0, z: 0 },                // +Y -> cara superior
            6: { x: Math.PI, y: 0, z: 0 },                // -Y -> boca abajo
            2: { x: -Math.PI / 2, y: 0, z: 0 },                // +Z -> rotar -90° en X para poner +Z arriba
            5: { x: Math.PI / 2, y: 0, z: 0 },                // -Z -> rotar +90° en X
            3: { x: 0, y: 0, z: Math.PI / 2 },       // +X -> rotar +90° en Z
            4: { x: 0, y: 0, z: -Math.PI / 2 }       // -X -> rotar -90° en Z
        };


        const spins = {
            x: Math.PI * 4 * (1 + Math.random()),
            y: Math.PI * 4 * (1 + Math.random()),
            z: Math.PI * 2 * Math.random()  // permitir giros en Z también
        };


        const targetRotation = {
            x: finalRotations[randomNumber].x + spins.x,
            y: finalRotations[randomNumber].y + spins.y,
            z: 0
        };

        // Animación de lanzamiento
        const duration = 2000; // 2 segundos
        const startRotation = {
            x: this.dice.rotation.x,
            y: this.dice.rotation.y,
            z: 0
        };
        const startTime = Date.now();
        const startHeight = this.dice.position.y;
        const jumpHeight = 3; // Altura del salto

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Función de ease-out personalizada para un movimiento más natural
            const easeProgress = 1 - Math.pow(1 - progress, 4);

            // Animación de rotación
            this.dice.rotation.x = startRotation.x + (targetRotation.x - startRotation.x) * easeProgress;
            this.dice.rotation.y = startRotation.y + (targetRotation.y - startRotation.y) * easeProgress;

            // Animación de salto parabólico
            const jumpProgress = Math.sin(progress * Math.PI);
            this.dice.position.y = startHeight + jumpHeight * jumpProgress;

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Asegurar la posición final correcta
                this.dice.rotation.set(
                    finalRotations[randomNumber].x,
                    finalRotations[randomNumber].y,
                    0
                );
                this.dice.position.y = startHeight;
                this.isRolling = false;

                // Mostrar el resultado
                diceResultElement.textContent = `¡Sacaste un ${randomNumber}!`;
                diceResultElement.style.opacity = '1';
                diceButton.disabled = false;
                diceButton.style.opacity = '1';
            }
        };

        animate();
    }

    createBoard() {
        // Crear el tablero base
        const boardGeometry = new THREE.BoxGeometry(
            this.boardSize.width + 0.5,
            0.5,
            this.boardSize.height + 0.5
        );
        const boardMaterial = new THREE.MeshStandardMaterial({
            color: 0xd4a367, // Color marrón claro
            roughness: 0.8
        });
        this.board = new THREE.Mesh(boardGeometry, boardMaterial);
        this.board.receiveShadow = true;
        this.scene.add(this.board);

        // Agregar borde al tablero
        const borderGeometry = new THREE.BoxGeometry(
            this.boardSize.width + 1,
            0.7,
            this.boardSize.height + 1
        );
        const borderMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B4513 // Marrón oscuro
        });
        const border = new THREE.Mesh(borderGeometry, borderMaterial);
        border.position.y = -0.1;
        border.receiveShadow = true;
        this.scene.add(border);
    }

    createTiles() {
        const tileSize = 1;
        const startX = -(this.boardSize.width / 2) + tileSize / 2;
        const startZ = -(this.boardSize.height / 2) + tileSize / 2;

        // Definir el camino del juego (solo el perímetro)
        this.path = [];

        // Añadir borde superior
        for (let x = 0; x < this.boardSize.width; x++) {
            this.path.push([x, 0]);
        }
        // Añadir borde derecho
        for (let z = 1; z < this.boardSize.height; z++) {
            this.path.push([this.boardSize.width - 1, z]);
        }
        // Añadir borde inferior (de derecha a izquierda)
        for (let x = this.boardSize.width - 2; x >= 0; x--) {
            this.path.push([x, this.boardSize.height - 1]);
        }
        // Añadir borde izquierdo (de abajo hacia arriba)
        for (let z = this.boardSize.height - 2; z > 0; z--) {
            this.path.push([0, z]);
        }

        // Crear las casillas del tablero
        for (let row = 0; row < this.boardSize.height; row++) {
            for (let col = 0; col < this.boardSize.width; col++) {
                const isPathTile = this.path.some(([x, z]) => x === col && z === row);
                const tileGeometry = new THREE.BoxGeometry(0.95, 0.1, 0.95);
                const tileMaterial = new THREE.MeshStandardMaterial({
                    color: isPathTile ? 0xf5f5dc : 0xe8d0aa,
                    roughness: 0.7
                });

                const tile = new THREE.Mesh(tileGeometry, tileMaterial);
                tile.position.set(
                    startX + col * tileSize,
                    0.25,
                    startZ + row * tileSize
                );
                tile.receiveShadow = true;
                this.scene.add(tile);
                this.tiles.push(tile);

                // Agregar marca de pisadas en las casillas del camino
                if (isPathTile) {
                    this.addFootprint(startX + col * tileSize, startZ + row * tileSize);
                }
            }
        }

        // Agregar elementos decorativos
        this.addDecorativeElements();
    }

    addFootprint(x, z) {
        const footprintGeometry = new THREE.PlaneGeometry(0.3, 0.3);
        const footprintMaterial = new THREE.MeshStandardMaterial({
            color: 0x8B4513,
            transparent: true,
            opacity: 0.3
        });
        const footprint = new THREE.Mesh(footprintGeometry, footprintMaterial);
        footprint.rotation.x = -Math.PI / 2;
        footprint.position.set(x, 0.26, z);
        footprint.receiveShadow = true;
        this.scene.add(footprint);
    }

    createPalmTree(x, z) {
        // Tronco
        const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.15, 1, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.set(x, 0.5, z);
        trunk.castShadow = true;
        this.scene.add(trunk);

        // Hojas
        const leavesGeometry = new THREE.ConeGeometry(0.8, 0.8, 4);
        const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
        const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
        leaves.position.set(x, 1.3, z);
        leaves.castShadow = true;
        this.scene.add(leaves);
    }

    createChocolate(x, z) {
        const chocolateGeometry = new THREE.BoxGeometry(0.4, 0.1, 0.6);
        const chocolateMaterial = new THREE.MeshStandardMaterial({
            color: 0x3C1C17,
            roughness: 0.3
        });
        const chocolate = new THREE.Mesh(chocolateGeometry, chocolateMaterial);
        chocolate.position.set(x, 0.3, z);
        chocolate.castShadow = true;
        this.scene.add(chocolate);

        // Agregar líneas para simular divisiones en el chocolate
        const lineGeometry = new THREE.BoxGeometry(0.38, 0.11, 0.02);
        const lineMaterial = new THREE.MeshStandardMaterial({ color: 0x2A1410 });
        const line1 = new THREE.Mesh(lineGeometry, lineMaterial);
        line1.position.set(x, 0.31, z - 0.15);
        this.scene.add(line1);

        const line2 = new THREE.Mesh(lineGeometry, lineMaterial);
        line2.position.set(x, 0.31, z + 0.15);
        this.scene.add(line2);
    }

    createCoffeeBean(x, z) {
        const beanGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        const beanMaterial = new THREE.MeshStandardMaterial({
            color: 0x3C1C17,
            roughness: 0.7
        });
        const bean = new THREE.Mesh(beanGeometry, beanMaterial);
        bean.scale.y = 0.5;
        bean.position.set(x, 0.3, z);
        bean.castShadow = true;
        this.scene.add(bean);

        // Agregar línea central del grano
        const lineGeometry = new THREE.BoxGeometry(0.02, 0.1, 0.2);
        const lineMaterial = new THREE.MeshStandardMaterial({ color: 0x2A1410 });
        const line = new THREE.Mesh(lineGeometry, lineMaterial);
        line.position.set(x, 0.31, z);
        this.scene.add(line);
    }

    addDecorativeElements() {
        // Solo colocar elementos en las casillas del camino (perímetro)
        const startX = -(this.boardSize.width / 2) + 0.5;
        const startZ = -(this.boardSize.height / 2) + 0.5;

        // Agregar palmeras en las esquinas del camino
        const palmTrees = [
            [0, 0], [this.boardSize.width - 1, 0],
            [0, this.boardSize.height - 1], [this.boardSize.width - 1, this.boardSize.height - 1]
        ];
        palmTrees.forEach(([x, z]) => {
            const worldX = startX + x;
            const worldZ = startZ + z;
            this.createPalmTree(worldX, worldZ);
        });

        // Distribuir chocolates y granos de café a lo largo del camino
        this.path.forEach(([x, z], index) => {
            if (index % 4 === 0) { // Cada 4 casillas
                const worldX = startX + x;
                const worldZ = startZ + z;
                this.createChocolate(worldX, worldZ);
            } else if (index % 3 === 0) { // Cada 3 casillas
                const worldX = startX + x;
                const worldZ = startZ + z;
                this.createCoffeeBean(worldX, worldZ);
            }
        });
    }


    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    createPlayers() {
        // Crear los personajes
        const playerGeometries = [
            { color: 0x4169E1, position: [-3, 0.5, -3] },  // Azul
            { color: 0x228B22, position: [3, 0.5, -3] },   // Verde
            { color: 0xFF4500, position: [-3, 0.5, 3] }    // Naranja
        ];

        playerGeometries.forEach(({ color, position }) => {
            // Cuerpo
            const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.6, 8);
            const bodyMaterial = new THREE.MeshStandardMaterial({ color: color });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.position.set(...position);
            body.castShadow = true;

            // Cabeza
            const headGeometry = new THREE.SphereGeometry(0.2, 16, 16);
            const headMaterial = new THREE.MeshStandardMaterial({ color: 0xFFE4C4 });
            const head = new THREE.Mesh(headGeometry, headMaterial);
            head.position.set(position[0], position[1] + 0.4, position[2]);
            head.castShadow = true;

            // Sombrero
            const hatGeometry = new THREE.ConeGeometry(0.2, 0.3, 8);
            const hatMaterial = new THREE.MeshStandardMaterial({ color: color });
            const hat = new THREE.Mesh(hatGeometry, hatMaterial);
            hat.position.set(position[0], position[1] + 0.7, position[2]);
            hat.castShadow = true;

            this.scene.add(body);
            this.scene.add(head);
            this.scene.add(hat);
            this.players.push({ body, head, hat });
        });
    }
}

// Iniciar el juego cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new Game();
});