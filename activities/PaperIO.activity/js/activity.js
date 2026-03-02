define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/icon", "l10n",
"sugar-web/graphics/presencepalette", "sugar-web/datastore","sugar-web/graphics/journalchooser","pawnpalette",
"tutorial"],
function (activity, env, icon, l10n, presencepalette, datastore, journalchooser, pawnpalette, tutorial) {

	// Manipulate the DOM only when it is ready.
	requirejs(['domReady!'], function (doc) {

		// Initialize the activity.
		activity.setup();

        // Welcome user
        var currentenv;
        env.getEnvironment(function(err, environment) {
            currentenv = environment
		    console.log('COLOR: ',currentenv.user.colorvalue)

            currcolor = currentenv.user.colorvalue.stroke
            var temp = hexToRgbArray(currentenv.user.colorvalue.stroke)
            trailcolor = `rgba(${temp[0]},${temp[1]},${temp[2]},0.5)`
            usercolor = currentenv.user.colorvalue.fill

            // Force the new colors
            entities[0].colors = { fill: usercolor, stroke: currcolor, trail: trailcolor }
            // Set the starting base color
            globalCompletedAreas[0].color = currentenv.user.colorvalue.stroke

            // Set current language to Sugarizer
            var defaultLanguage = (typeof chrome != 'undefined' && chrome.app && chrome.app.runtime)
            ? chrome.i18n.getUILanguage() : navigator.language;
            var language = environment.user ? environment.user.language : defaultLanguage;
            l10n.init(language);

		    // Load from datastore
            if (!environment.objectId) {
                console.log("New instance");
            } else {

                console.log("Not instance");
                activity.getDatastoreObject().loadAsText(function(error, metadata, data) {
                    if (error==null && data!=null) {
                        //Load from Journal
                    }
                });
            }

            // Shared instances
            if (environment.sharedId) {
                console.log("Shared instance");
                presence = activity.getPresenceObject(function(error, network) {
                    network.onDataReceived(onNetworkDataReceived);
                    network.onSharedActivityUserChanged(onNetworkUserChanged);
                });
            }
            // Boot up!

        });

        // Colors
        var currcolor //= 'red'; // PlayerColor
        var trailcolor //= 'rgba(255,0,0,0.5)'; // Transparent trail
        var usercolor
        const canvas = document.getElementById('drawCanvas');
        const ctx = canvas.getContext('2d');

        // Grid parameters
        const cols = 13; // 0 to 27
        const rows = 8; // 0 to 12
        const spacingX = 60;
        const spacingY = 60;
        const startX = 30;
        const startY = 30;

        let points = [];
        // Generate grid
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                points.push(getPoint(j, i));
            }
        }

        // Game State Variables
        let completedLines = [];
        let completedAreas = [];
        let drawnPoints = new Map();
        let hiddenPoints = new Set();

        // Player Entity
        let playerCol, playerRow;
        let dx, dy; // Current movement direction
        let nextDx, nextDy; // Queued movement direction (prevents instant reverse suicide)
        let trailLines = [];
        let trailStartPt = null;


        // --- GAME STATE & ENTITIES ---
        let gameLoop;
        let entities = [];
        let globalHiddenPoints = new Set(); // Points hidden by filled areas

        // NEW: Global rendering queues for chronological drawing
        let globalCompletedAreas = [];
        let globalCompletedLines = [];
        let globalTrailLines = [];

        // --- MATH HELPERS (Keep your existing helpers, modified slightly to handle entity scope) ---
        function hexToRgbArray(hex) {
            let cleanHex = hex.replace(/^#/, '');
            if (cleanHex.length === 3) cleanHex = cleanHex.split('').map(char => char + char).join('');
            if (cleanHex.length !== 6) throw new Error('Invalid hex color format');
            const r = parseInt(cleanHex.substring(0, 2), 16);
            const g = parseInt(cleanHex.substring(2, 4), 16);
            const b = parseInt(cleanHex.substring(4, 6), 16);
            return [r, g, b];
        }

        function calculatePolygonArea(polygon) {
            let area = 0;
            let j = polygon.length - 1;
            for (let i = 0; i < polygon.length; i++) {
                area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
                j = i;
            }
            return Math.abs(area / 2);
        }

        function isPointInOrOnPolygon(point, polygon) {
            let x = point.x, y = point.y;
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                let xi = polygon[i].x, yi = polygon[i].y;
                let xj = polygon[j].x, yj = polygon[j].y;
                let crossProduct = (y - yi) * (xj - xi) - (x - xi) * (yj - yi);
                if (Math.abs(crossProduct) < 0.1) {
                    let dotProduct = (x - xi) * (xj - xi) + (y - yi) * (yj - yi);
                    let squaredLengthBA = (xj - xi) * (xj - xi) + (yj - yi) * (yj - yi);
                    if (dotProduct >= 0 && dotProduct <= squaredLengthBA) return true;
                }
                let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        function checkForEnclosedArea(entity, startPt, endPt) {
            let adj = {};
            for (let pt of points) adj[`${pt.x},${pt.y}`] = [];

            for (let line of entity.completedLines) {
                let sKey = `${line.start.x},${line.start.y}`;
                let eKey = `${line.end.x},${line.end.y}`;
                adj[sKey].push(line.end);
                adj[eKey].push(line.start);
            }

            let endKey = `${endPt.x},${endPt.y}`;
            let queue = [ [startPt] ];
            let visited = new Set();
            visited.add(`${startPt.x},${startPt.y}`);

            let cyclePath = null;

            while (queue.length > 0) {
                let path = queue.shift();
                let currentPt = path[path.length - 1];
                let currentKey = `${currentPt.x},${currentPt.y}`;

                if (currentKey === endKey && path.length > 2) {
                    cyclePath = path;
                    break;
                }

                for (let neighbor of adj[currentKey]) {
                    let nKey = `${neighbor.x},${neighbor.y}`;
                    if (path.length >= 2 && nKey === `${path[path.length-2].x},${path[path.length-2].y}`) continue;
                    if (!visited.has(nKey)) {
                        visited.add(nKey);
                        queue.push([...path, neighbor]);
                    }
                }
            }

            if (cyclePath) {
                entity.completedAreas.push({
                    path: cyclePath,
                    color: entity.colors.stroke,
                    size: calculatePolygonArea(cyclePath)
                });

                // Add the area globally
                globalCompletedAreas.push({
                    path: cyclePath,
                    color: entity.colors.stroke,
                    size: calculatePolygonArea(cyclePath),
                    ownerId: entity.id
                })

                for (let pt of points) {
                    if (isPointInOrOnPolygon(pt, cyclePath)) {
                        let ptKey = `${pt.x},${pt.y}`;
                        entity.drawnPoints.set(ptKey, entity.colors.stroke);
                        globalHiddenPoints.add(ptKey);
                    }
                }

                // DEATH MECHANIC 3: ENGULFMENT
                // Check if any other entity's current head position is inside this new area
                for (let other of entities) {
                    if (other.id !== entity.id && !other.isDead) {
                        let otherPos = getPoint(other.col, other.row);
                        if (isPointInOrOnPolygon(otherPos, cyclePath)) {
                            console.log(`${other.id} was engulfed by ${entity.id}!`);
                            killEntity(other);
                        }
                    }
                }
            }
        }

        // --- UTILS ---
        function getPoint(c, r) {
            return { x: startX + (c * spacingX), y: startY + (r * spacingY) };
        }

        function isPointSafe(entity, pt) {
            return entity.drawnPoints.has(`${pt.x},${pt.y}`);
        }

        function killEntity(entity) {
            entity.isDead = true;
            // Free up the hidden dots they were covering so the grid shows again
            // TO FIX: only if the point isn't into any other area else keep it hidden

            entity.drawnPoints.forEach((val, key) => {
                globalHiddenPoints.delete(key);
            });

            //Remove their areas from the global Areas Array
            globalCompletedAreas = globalCompletedAreas.filter(area => area.ownerId != entity.id)

            //Remove their areas from the global Lines Array
            globalCompletedLines = globalCompletedLines.filter(line => line.ownerId != entity.id)

            //Remove their trails from the global Trail Array
            globalTrailLines = globalTrailLines.filter(trail => trail.ownerId != entity.id)

            // Wipe their arrays so they don't render anymore
            entity.completedLines = [];
            entity.completedAreas = [];
            entity.trailLines = [];
            entity.drawnPoints.clear();
        }

        function setupEntityBase(entity) {
            let p1 = getPoint(entity.col, entity.row);
            let p2 = getPoint(entity.col, entity.row + 1);
            let p3 = getPoint(entity.col + 1, entity.row + 1);
            let p4 = getPoint(entity.col + 1, entity.row);

            entity.completedLines.push({start: p1, end: p2});
            entity.completedLines.push({start: p2, end: p3});
            entity.completedLines.push({start: p3, end: p4});
            checkForEnclosedArea(entity, p1, p4);
            entity.completedLines.push({start: p4, end: p1});

            [p1, p2, p3, p4].forEach(p => entity.drawnPoints.set(`${p.x},${p.y}`, entity.colors.stroke));
        }

        // --- GAME LOGIC ---
        function initGame() {
            globalHiddenPoints.clear();

            // Create Player and Enemy objects
            entities = [
                {
                    id: 'Player',
                    isDead: false,
                    col: 2, row: 2, // Top Left
                    dx: -1, dy: 0, nextDx: -1, nextDy: 0,
                    colors: { fill: usercolor, stroke: currcolor, trail: trailcolor },
                    completedLines: [], completedAreas: [], drawnPoints: new Map(), trailLines: []
                },
                {
                    id: 'Enemy',
                    isDead: false,
                    state: 'EXPAND',
                    col: cols - 4, row: rows - 4, // Bottom Right
                    dx: -1, dy: 0, nextDx: -1, nextDy: 0,
                    colors: { fill: '#ff0000', stroke: '#111111', trail: 'rgba(255,0,0,0.5)' },
                    completedLines: [], completedAreas: [], drawnPoints: new Map(), trailLines: []
                }
            ];

            // Initialize both bases
            entities.forEach(ent => setupEntityBase(ent));

            if (gameLoop) clearInterval(gameLoop);
            gameLoop = setInterval(updateTick, 180 * 2);
            drawScene();
        }
        // -- AI LOGIC --
        // Checks if a proposed move will kill the entity (walls or own trail)
        function isMoveSafe(ent, testDx, testDy) {
            let nCol = ent.col + testDx;
            let nRow = ent.row + testDy;

            // 1. Check Wall collisions
            if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) return false;

            // 2. Prevent instant 180-degree suicide
            if (testDx !== 0 && ent.dx === -testDx) return false;
            if (testDy !== 0 && ent.dy === -testDy) return false;

            // 3. Check Own Trail collisions
            let nPt = getPoint(nCol, nRow);
            let hittingSelf = ent.trailLines.some(line =>
                (line.end.x === nPt.x && line.end.y === nPt.y) ||
                (line.start.x === nPt.x && line.start.y === nPt.y)
            );

            return !hittingSelf;
        }

        // Attempts to move toward a specific grid coordinate safely
        function moveTowards(ent, targetCol, targetRow) {
            let diffX = targetCol - ent.col;
            let diffY = targetRow - ent.row;

            let preferredMoves = [];
            if (diffX > 0) preferredMoves.push({dx: 1, dy: 0});
            else if (diffX < 0) preferredMoves.push({dx: -1, dy: 0});

            if (diffY > 0) preferredMoves.push({dx: 0, dy: 1});
            else if (diffY < 0) preferredMoves.push({dx: 0, dy: -1});

            // Fallback moves if preferred routes are blocked
            let allMoves = [{dx: 1, dy: 0}, {dx: -1, dy: 0}, {dx: 0, dy: 1}, {dx: 0, dy: -1}];

            // Sort so preferred moves are evaluated first
            allMoves.sort((a, b) => {
                let aPref = preferredMoves.some(m => m.dx === a.dx && m.dy === a.dy) ? -1 : 1;
                let bPref = preferredMoves.some(m => m.dx === b.dx && m.dy === b.dy) ? -1 : 1;
                return aPref - bPref;
            });

            for (let move of allMoves) {
                if (isMoveSafe(ent, move.dx, move.dy)) {
                    ent.nextDx = move.dx;
                    ent.nextDy = move.dy;
                    return;
                }
            }
        }

        // The core AI logic executed every tick
        function runEnemyAI(enemy, player) {
            if (enemy.isDead) return;

            let closestTrailPt = null;
            let minDist = Infinity;

            // 1. Scan for Player Trail (Radius 2)
            if (player && !player.isDead) {
                let trailPts = new Set();
                player.trailLines.forEach(line => {
                    trailPts.add(`${line.start.x},${line.start.y}`);
                    trailPts.add(`${line.end.x},${line.end.y}`);
                });

                trailPts.forEach(ptStr => {
                    let [px, py] = ptStr.split(',').map(Number);
                    // Convert physical pixels back to grid coordinates
                    let pCol = Math.round((px - startX) / spacingX);
                    let pRow = Math.round((py - startY) / spacingY);

                    // Manhattan distance
                    let dist = Math.abs(pCol - enemy.col) + Math.abs(pRow - enemy.row);
                    if (dist <= 2 && dist < minDist) {
                        minDist = dist;
                        closestTrailPt = { col: pCol, row: pRow };
                    }
                });
            }

            // 2. STATE LOGIC
            if (closestTrailPt) {
                // --- HUNT STATE ---
                enemy.state = 'HUNT';
                moveTowards(enemy, closestTrailPt.col, closestTrailPt.row);
            } else {
                // --- EXPAND STATE ---
                enemy.state = 'EXPAND';

                let forwardSafe = isMoveSafe(enemy, enemy.dx, enemy.dy);
                let randomTurn = Math.random() < 0.2; // 20% chance to turn unpredictably

                if (!forwardSafe || randomTurn) {
                    let turns = enemy.dx !== 0 ? [{dx: 0, dy: 1}, {dx: 0, dy: -1}] : [{dx: 1, dy: 0}, {dx: -1, dy: 0}];
                    turns.sort(() => Math.random() - 0.5); // Shuffle turns

                    let madeTurn = false;
                    for (let turn of turns) {
                        if (isMoveSafe(enemy, turn.dx, turn.dy)) {
                            enemy.nextDx = turn.dx;
                            enemy.nextDy = turn.dy;
                            madeTurn = true;
                            break;
                        }
                    }

                    // If we randomly tried to turn but couldn't, keep going straight if safe
                    if (!madeTurn && forwardSafe) {
                        enemy.nextDx = enemy.dx;
                        enemy.nextDy = enemy.dy;
                    }
                    // Panic mode: just find any safe direction
                    else if (!madeTurn) {
                        moveTowards(enemy, cols/2, rows/2); // Desperately try to move toward center
                    }
                }
            }
        }
        function updateTick() {

            // 0. Run enemy AI to chose its state and the next step to do
            let playerEnt = entities.find(e => e.id === 'Player');
            entities.forEach(ent => {
                if (ent.id === 'Enemy' && !ent.isDead) {
                    runEnemyAI(ent, playerEnt);
                }
            });

            // 1. Move all alive entities
            entities.forEach(ent => {
                if (ent.isDead) return;
                ent.dx = ent.nextDx;
                ent.dy = ent.nextDy;
                ent.nextCol = ent.col + ent.dx;
                ent.nextRow = ent.row + ent.dy;
                ent.currentPt = getPoint(ent.col, ent.row);
                ent.nextPt = getPoint(ent.nextCol, ent.nextRow);
            });

            // 2. Resolve Collisions and Deaths
            for (let i = 0; i < entities.length; i++) {
                let a = entities[i];
                if (a.isDead) continue;

                if (a.nextCol < 0 || a.nextCol >= cols || a.nextRow < 0 || a.nextRow >= rows) {
                    killEntity(a); continue;
                }

                let hittingSelf = a.trailLines.some(line =>
                    (line.end.x === a.nextPt.x && line.end.y === a.nextPt.y) ||
                    (line.start.x === a.nextPt.x && line.start.y === a.nextPt.y)
                );
                if (hittingSelf) killEntity(a);

                for (let j = 0; j < entities.length; j++) {
                    let b = entities[j];
                    if (a.id === b.id || b.isDead || a.isDead) continue;

                    if (a.nextCol === b.nextCol && a.nextRow === b.nextRow) {
                        console.log("Head to Head Collision!");
                        killEntity(a); killEntity(b); continue;
                    }

                    let touchingBTrail = b.trailLines.some(line =>
                        (line.end.x === a.nextPt.x && line.end.y === a.nextPt.y) ||
                        (line.start.x === a.nextPt.x && line.start.y === a.nextPt.y)
                    );
                    if (touchingBTrail) {
                        console.log(`${a.id} touched ${b.id}'s trail. ${b.id} dies!`);
                        killEntity(b);
                    }
                }
            }

            // 3. Process Trail and Area Logic
            entities.forEach(ent => {
                if (ent.isDead) return;

                let isCurrentSafe = isPointSafe(ent, ent.currentPt);
                let isNextSafe = isPointSafe(ent, ent.nextPt);

                let newTrail = { ownerId: ent.id, start: ent.currentPt, end: ent.nextPt, color: ent.colors.trail };

                if (isCurrentSafe && !isNextSafe) {
                    // Leaving Base
                    ent.trailLines.push(newTrail);
                    globalTrailLines.push(newTrail);
                }
                else if (isCurrentSafe && isNextSafe) {
                    // Jumping across base
                    checkForEnclosedArea(ent, ent.currentPt, ent.nextPt);
                }
                else if (!isCurrentSafe && !isNextSafe) {
                    // In the Wild
                    ent.trailLines.push(newTrail);
                    globalTrailLines.push(newTrail);
                }
                else if (!isCurrentSafe && isNextSafe) {
                    // Reconnecting to Base
                    for (let tl of ent.trailLines) {
                        let compLine = { ownerId: ent.id, start: tl.start, end: tl.end, color: ent.colors.stroke };
                        ent.completedLines.push(compLine);
                        globalCompletedLines.push(compLine);
                        ent.drawnPoints.set(`${tl.start.x},${tl.start.y}`, ent.colors.stroke);
                        ent.drawnPoints.set(`${tl.end.x},${tl.end.y}`, ent.colors.stroke);
                    }
                    checkForEnclosedArea(ent, ent.currentPt, ent.nextPt);

                    let finalLine = { ownerId: ent.id, start: ent.currentPt, end: ent.nextPt, color: ent.colors.stroke };
                    ent.completedLines.push(finalLine);
                    globalCompletedLines.push(finalLine);

                    // Clear active trail locally AND globally
                    ent.trailLines = [];
                    globalTrailLines = globalTrailLines.filter(t => t.ownerId !== ent.id);
                }

                // Update physical coordinates
                ent.col = ent.nextCol;
                ent.row = ent.nextRow;
            });

            drawScene();
        }

        // --- RENDERING ---
        function drawScene() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // 0. Draw Grid Dots (Background)
            ctx.fillStyle = '#444';
            for (let pt of points) {
                if (!globalHiddenPoints.has(`${pt.x},${pt.y}`)) {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // 1. Draw ALL Filled Areas chronologically
            for (let area of globalCompletedAreas) {
                ctx.beginPath();
                ctx.moveTo(area.path[0].x, area.path[0].y);
                for (let i = 1; i < area.path.length; i++) {
                    ctx.lineTo(area.path[i].x, area.path[i].y);
                }
                ctx.closePath();
                ctx.fillStyle = area.color;
                ctx.fill();
            }

            // 2. Draw ALL Permanent Territory Lines chronologically
            ctx.lineWidth = 4;
            for (let line of globalCompletedLines) {
                ctx.strokeStyle = line.color;
                ctx.beginPath();
                ctx.moveTo(line.start.x, line.start.y);
                ctx.lineTo(line.end.x, line.end.y);
                ctx.stroke();
            }

            // 3. Draw ALL Active Trails chronologically
            ctx.lineWidth = 4;
            for (let trail of globalTrailLines) {
                ctx.strokeStyle = trail.color;
                ctx.beginPath();
                ctx.moveTo(trail.start.x, trail.start.y);
                ctx.lineTo(trail.end.x, trail.end.y);
                ctx.stroke();
            }

            // 4. Draw Entity Cubes (Always strictly on top of everything)
            entities.forEach(ent => {
                if (ent.isDead) return;
                let pX = startX + ent.col * spacingX;
                let pY = startY + ent.row * spacingY;
                ctx.fillStyle = ent.colors.fill;
                ctx.fillRect(pX - 10, pY - 10, 20, 20);
            });
        }

        initGame();

        // --- INPUT: MOUSE STEERING (Only controls the Player) ---
        canvas.addEventListener('mousemove', (e) => {
            let player = entities.find(ent => ent.id === 'Player');
            if (!player || player.isDead) return;

            let px = startX + player.col * spacingX;
            let py = startY + player.row * spacingY;
            let diffX = e.offsetX - px;
            let diffY = e.offsetY - py;

            if (Math.abs(diffX) > Math.abs(diffY)) {
                if (diffX > 0 && player.dx !== -1) { player.nextDx = 1; player.nextDy = 0; }
                else if (diffX < 0 && player.dx !== 1) { player.nextDx = -1; player.nextDy = 0; }
            } else {
                if (diffY > 0 && player.dy !== -1) { player.nextDx = 0; player.nextDy = 1; }
                else if (diffY < 0 && player.dy !== 1) { player.nextDx = 0; player.nextDy = -1; }
            }
        });


        /*
        var onNetworkDataReceived = function(msg) {
            if (presence.getUserInfo().networkId === msg.user.networkId) {
                return;
            }
            switch (msg.content.action) {
                case 'init':
                    pawns = msg.content.data;
                    document.getElementById("canvas").style.backgroundImage = msg.content.url
                    drawPawns();
                    break;
                case 'update':
                    pawns.push(msg.content.data);
                    drawPawns();
                    document.getElementById("user").innerHTML = "<h1>"+l10n.get("Played", {name:msg.user.name})+"</h1>";
                    break;
                case 'update-img':
                    document.getElementById("canvas").style.backgroundImage = msg.content.url;
                    break;
            }
        };

        var onNetworkUserChanged = function(msg) {
            if (isHost) {
                presence.sendMessage(presence.getSharedInfo().id, {
                    user: presence.getUserInfo(),
                    content: {
                        action: 'init',
                        url: document.getElementById("canvas").style.backgroundImage,
                        data: pawns
                    }
                });
            }
            console.log("User "+msg.user.name+" "+(msg.move == 1 ? "join": "leave"));
        };
        */
        // Boot Up


        /*
        // Draw pawns
        var pawns = [];
        var drawPawns = function() {
            document.getElementById("pawns").innerHTML = '';
            for (var i = 0 ; i < pawns.length ; i++) {
                var pawn = document.createElement("div");
                pawn.className = "pawn";

                document.getElementById("pawns").appendChild(pawn);
                icon.colorize(pawn, pawns[i]);
            }
        }

        // Handle click on add
        var addpalette = new pawnpalette.PawnPalette(document.getElementById("add-button"), "Add pawn");
        addpalette.addEventListener('pawnClick', function (event) {
            for (var i = 0 ; i < event.count ; i++) {
                pawns.push(currentenv.user.colorvalue);
                drawPawns();

                document.getElementById("user").innerHTML = "<h1>"+l10n.get("Played", {name:currentenv.user.name})+"</h1>";

                if (presence) {
                    presence.sendMessage(presence.getSharedInfo().id, {
                        user: presence.getUserInfo(),
                        content: {
                            action: 'update',
                            url: document.getElementById("canvas").style.backgroundImage,
                            data: currentenv.user.colorvalue

                        }
                    });
                }
            }
        });

        // Save in Journal on Stop
        document.getElementById("help-button").addEventListener('click', function (event) {

            console.log("saving...");
            var url = document.getElementById("canvas").style.backgroundImage

            var jsonData = JSON.stringify({"image":url,"pawns":pawns})

            activity.getDatastoreObject().setDataAsText(jsonData);
            activity.getDatastoreObject().save(function (error) {
                if (error === null) {
                    console.log("write done.");
                } else {
                    console.log("write failed.");
                }
            });

        });

        window.addEventListener("localized", function() {
	        document.getElementById("user").innerHTML = "<h1>"+l10n.get("Hello", {name:currentenv.user.name})+"</h1>";
	        document.getElementById("add-button").title = l10n.get("AddPawn");
        });

        // Add Palette
        // Link presence palette
        // Link presence palette
        var presence = null;
        var palette = new presencepalette.PresencePalette(document.getElementById("network-button"), undefined);
        var isHost = false;
        palette.addEventListener('shared', function() {
            palette.popDown();
            console.log("Want to share");
            presence = activity.getPresenceObject(function(error, network) {
                if (error) {
                    console.log("Sharing error");
                    return;
                }
                network.createSharedActivity('org.sugarlabs.Pawn', function(groupId) {
                    console.log("Activity shared");
                    isHost = true;
                });
                network.onDataReceived(onNetworkDataReceived);
                network.onSharedActivityUserChanged(onNetworkUserChanged);
            });
        });

        // Picture Button
        document.getElementById("picture-button").addEventListener('click', function (e) {
            journalchooser.show(function (entry) {
                // No selection
                if (!entry) {
                    return;
                }
                // Get object content
                var dataentry = new datastore.DatastoreObject(entry.objectId);
                dataentry.loadAsText(function (err, metadata, data) {
                    document.getElementById("canvas").style.backgroundImage = "url('"+data+"')";
                    if (presence) {
                        presence.sendMessage(presence.getSharedInfo().id, {
                            user: presence.getUserInfo(),
                            content: {
                                action: 'update-img',
                                url: document.getElementById("canvas").style.backgroundImage,
                            }
                        });
                    }
                });
            }, { mimetype: 'image/png' }, { mimetype: 'image/jpeg' });
        });

        // Launch tutorial
        /*
        document.getElementById("help-button").addEventListener('click', function(e) {
            tutorial.start();
        });*/
	});

});
