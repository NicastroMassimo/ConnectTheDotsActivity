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
            // globalCompletedAreas[0].color = currentenv.user.colorvalue.stroke

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
        //let globalHiddenPoints = new Set(); // Points hidden by filled areas

        // NEW: Global rendering queues for chronological drawing
        let globalCompletedAreas = [];
        let globalCompletedLines = [];
        // let globalTrailLines = [];

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

        function checkForEnclosedArea(entity) {
            if (entity.trailLines.length == 0) return; // Need at least a trail
            console.log("Enclosed")
            // Remove the last step so that I force the path to follow the long route
            var lastConnection = entity.trailLines.pop()



            var startNode = lastConnection.start; // Where the trail left the base
            var endNode = lastConnection.end; // Where it just connected


            // 1. Build the Adjacency Graph for this specific entity
            let graph = new Map();

            function addEdge(ptA, ptB) {


                let keyA = `${ptA.x},${ptA.y}`;
                let keyB = `${ptB.x},${ptB.y}`;

                if (!graph.has(keyA)) graph.set(keyA, new Set());
                if (!graph.has(keyB)) graph.set(keyB, new Set());

                graph.get(keyA).add(keyB);
                graph.get(keyB).add(keyA);
            }

            // A. Add the entity's dynamic borders to the graph
            let allBorders = getDynamicBorders();
            let myBorders = allBorders.filter(b => b.owner === entity.id);
            // console.log('myBorders: ',myBorders," ","trailLines: ",entity.trailLines)

            myBorders.forEach(line => addEdge(line.start, line.end));

            // B.2 Add the entity's active trail to the graph
            entity.trailLines.forEach(line => addEdge(line.start, line.end));

            // 2. Find the Cycle using Breadth-First Search (BFS)
            // We want to find the shortest path along the borders from the end node back to the start node
            // to close the loop formed by the trail.

            var startKey = `${startNode.x},${startNode.y}`;
            var endKey = `${endNode.x},${endNode.y}`;

            let queue = [[endKey]];
            let visited = new Set();
            visited.add(endKey);

            let cyclePathKeys = null;
            // console.log("Start and End Key: ",startKey,endKey)
            // console.log('GRAPH: ',graph)

            while (queue.length > 0) {
                let path = queue.shift();
                let currentKey = path[path.length - 1];
                // console.log(path)
                if (currentKey === startKey) {
                    cyclePathKeys = path; // We found the loop!
                    break;
                }

                let neighbors = graph.get(currentKey);
                if (neighbors) {
                    for (let neighbor of neighbors) {
                        // Prevent going backwards down the trail we just came from
                        // We want the algorithm to wrap around the base borders
                        let isImmediateBacktrack = (path.length > 1 && neighbor === path[path.length - 2]);

                        if (!visited.has(neighbor) && !isImmediateBacktrack) {
                            visited.add(neighbor);
                            queue.push([...path, neighbor]);
                        }
                    }
                }
            }


            // Re Add the last connection

            // cyclePathKeys.push(`${lastConnection.end.x},${lastConnection.end.y}`)

            // console.log(cyclePathKeys)

            // 3. Process the Captured Area
            if (cyclePathKeys) {
                // Convert the string keys back to physical coordinates for the point-in-polygon check
                let cyclePathCoords = cyclePathKeys.map(key => {
                    let parts = key.split(',');
                    //console.log("parti: ",parts)
                    return {x:parseInt(parts[0]), y:parseInt(parts[1])}
                });

                //console.log(cyclePathCoords)
                // Loop through all the "Yards" (cells) and assign ownership
                for (let c = 0; c < cols - 1; c++) {
                    for (let r = 0; r < rows - 1; r++) {
                        let cellCenterX = startX + (c + 0.5) * spacingX;
                        let cellCenterY = startY + (r + 0.5) * spacingY;

                        if (isPointInOrOnPolygon({ x: cellCenterX, y: cellCenterY }, cyclePathCoords)) {
                            cellOwnership[c][r] = entity.id;
                        }
                    }
                }

                // 4. Clean up and Update
                entity.trailLines = []; // Clear the trail
                updatePointSafety();    // Recalculate which fenceposts/vertices are safe

                // (Insert your engulfment death check here)
                // DEATH MECHANIC 3: ENGULFMENT
                // Check if any other entity's current head position is inside this new area
                for (let other of entities) {
                    if (other.id !== entity.id && !other.isDead) {
                        let otherPos = getPoint(other.col, other.row);
                        if (isPointInOrOnPolygon(otherPos, cyclePathCoords)) {
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

        function getPointReverse(x, y) {
            return { c: (startX + x) / spacingX, r: (startY + y) / spacingY };
        }

        function isPointSafe(entity, pt) {
            console.log(entity,pt)
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
            for (let c = 0; c < cols - 1; c++) {
                for (let r = 0; r < rows - 1; r++) {
                    let ownerId = cellOwnership[c][r];
                    if (entity.id == ownerId)
                        cellOwnership[c][r] = null
                }
            }
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

            cellOwnership[entity.col][entity.row] = entity.id

            checkForEnclosedArea(entity)//, p1, p4);
            //entity.completedLines.push({start: p4, end: p1});
            let allBorders = getDynamicBorders();
            let myBorders = allBorders.filter(b => b.owner === entity.id);
            //console.log("MY BORDERS: ",myBorders)
            var p1 = myBorders[0].end
            var p2 = myBorders[0].start
            var p3 = myBorders[1].end
            var p4 = myBorders[2].end
            //console.log("MY POINTS: ",[p1, p2, p3, p4])

            entity.drawnPoints.set(`${p1.x},${p1.y}`,true)
            entity.drawnPoints.set(`${p2.x},${p2.y}`,true)
            entity.drawnPoints.set(`${p3.x},${p3.y}`,true)
            entity.drawnPoints.set(`${p4.x},${p4.y}`,true)

            //console.log("MY POINTS: ",entity.drawnPoints)
            globalHiddenPoints.add(`${p1.x},${p1.y}`)
            globalHiddenPoints.add(`${p2.x},${p2.y}`)
            globalHiddenPoints.add(`${p3.x},${p3.y}`)
            globalHiddenPoints.add(`${p4.x},${p4.y}`)
        }

        function updatePointSafety() {
            // Clear all safety mappings
            entities.forEach(ent => ent.drawnPoints.clear());
            globalHiddenPoints.clear();

            for (let c = 0; c < cols - 1; c++) {
                for (let r = 0; r < rows - 1; r++) {
                    let ownerId = cellOwnership[c][r];
                    if (ownerId) {
                        let ent = entities.find(e => e.id === ownerId);
                        if (ent) {
                            // Mark all 4 fence posts (vertices) of this yard as safe
                            // USE GET POINT
                            let corners = [
                                [c,r], [c+1,r],
                                [c,r+1], [c+1,r+1]
                            ];
                            corners.forEach(ptKey => {
                                var p = getPoint(ptKey[0],ptKey[1])
                                ent.drawnPoints.set(`${p.x},${p.y}`, ent.colors.stroke);
                                globalHiddenPoints.add(`${p.x},${p.y}`); // Hide the dot visually
                            });
                        }
                    }
                }
            }
        }

        function getDynamicBorders() {
            let borders = [];

            for (let c = 0; c < cols - 1; c++) {
                for (let r = 0; r < rows - 1; r++) {
                    let owner = cellOwnership[c][r];
                    if (owner) {
                        let ent = entities.find(e => e.id === owner);
                        let color = ent ? ent.colors.stroke : '#000';

                        let pTL = getPoint(c, r);
                        let pTR = getPoint(c + 1, r);
                        let pBL = getPoint(c, r + 1);
                        let pBR = getPoint(c + 1, r + 1);

                        // Top edge: check if we are at the top wall, or if the cell above has a different owner
                        if (r === 0 || cellOwnership[c][r - 1] !== owner) borders.push({start: pTL, end: pTR, color: color, owner: owner});
                        // Bottom edge
                        if (r === rows - 2 || cellOwnership[c][r + 1] !== owner) borders.push({start: pBL, end: pBR, color: color, owner: owner});
                        // Left edge
                        if (c === 0 || cellOwnership[c - 1][r] !== owner) borders.push({start: pTL, end: pBL, color: color, owner: owner});
                        // Right edge
                        if (c === cols - 2 || cellOwnership[c + 1][r] !== owner) borders.push({start: pTR, end: pBR, color: color, owner: owner});
                    }
                }
            }
            return borders;
        }


        // --- GAME LOGIC ---
        // A matrix of the squares between the dots
        let cellOwnership = [];
        let globalTrailLines = [];
        let globalHiddenPoints = new Set();

        function initGame() {
            // There are (cols-1) x (rows-1) squares between the points
            cellOwnership = Array.from({length: cols - 1}, () => new Array(rows - 1).fill(null));
            globalHiddenPoints.clear();
            globalTrailLines = [];

            // Create Player and Enemy objects
            entities = [
                {
                    id: 'Player',
                    isDead: false,
                    col: 1, row: 1, // Top Left
                    dx: -1, dy: 0, nextDx: -1, nextDy: 0,
                    colors: { fill: usercolor, stroke: currcolor, trail: trailcolor },
                    completedLines: [], completedAreas: [], drawnPoints: new Map(), trailLines: []
                },
                {
                    id: 'Enemy',
                    isDead: false,
                    state: 'EXPAND',
                    col: cols - 4, row: rows - 4, // Bottom Right
                    dx: Math.random()>0.5?-1:1, dy: 0, nextDx: Math.random()>0.5?-1:1, nextDy: 0,
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
                    // console.log("LEAVING")
                }
                else if (isCurrentSafe && isNextSafe) {
                    // Jumping across base
                    // If the cell i'll jump over is not owned by me add the trail to globalTrailLine
                    let st = ent.currentPt
                    let end = ent.nextPt

                    // Cell associated with the start point
                    let cell_start = getPointReverse(st.x,st.y)
                    let cell_end = getPointReverse(end.x,end.y)

                    console.log(cell_start, cell_end)
                    // If I'm going over a cell that I don't own then traw the trail
                    // The trail wont be visible it is needed to that the checkForEnclosedArea starts its search
                    // DA SISTEMARE DEVI FARE CHE VEDANO LA CELL OWNERSHIP ANCHE ALLA LORO SX NON SOLO DX
                    let check_start = cell_start.c < (cols ) && cell_start.r < (rows ) && cellOwnership[cell_start.c - 1][cell_start.r - 1]!=ent.id
                    let check_end = cell_end.c < (cols ) && cell_end.r < (rows ) && cellOwnership[cell_end.c - 1][cell_end.r - 1]!=ent.id

                    // console.log("check_end: ",check_end)

                    // console.log("cella_start: ",cellOwnership[cell_start.c - 1][cell_start.r - 1])
                    // console.log("cella_end: ",cellOwnership[cell_end.c - 1][cell_end.r - 1])

                    // console.log("check_start: ",check_start)

                    if ( (check_start || check_end)  && (cell_start.c < cols && cell_end.c < cols) )
                    {
                        ent.trailLines.push(newTrail);
                    }
                    else if (cell_start.c == cols && cell_end.c == cols &&
                        (cellOwnership[cell_end.c - 2][cell_end.r - 1]!=ent.id || cellOwnership[cell_start.c - 2][cell_end.r - 1])){
                        // When we are at the edge we need to check for the cell at the left not the one on the right as we would usually do
                        ent.trailLines.push(newTrail);
                    }
                    else if (cell_start.r == rows && cell_start.r == rows &&
                        (cellOwnership[cell_end.c - 1][cell_end.r - 2]!=ent.id || cellOwnership[cell_start.c - 1][cell_end.r - 2])){
                        console.log("DOWN")
                        // DA SISTEMARE PERCHè non va
                        ent.trailLines.push(newTrail)
                    }

                    checkForEnclosedArea(ent)//, ent.currentPt, ent.nextPt);
                    //globalTrailLines.push(newTrail);
                    // console.log("JUMPING")
                }
                else if (!isCurrentSafe && !isNextSafe) {
                    // In the Wild
                    ent.trailLines.push(newTrail);
                    globalTrailLines.push(newTrail);
                    // console.log("WILD")
                }
                else if (!isCurrentSafe && isNextSafe) {
                    // console.log("RETURNING")
                    // Reconnecting to Base
                    let finalLine = { ownerId: ent.id, start: ent.currentPt, end: ent.nextPt, color: ent.colors.stroke };
                    ent.trailLines.push(finalLine);

                    checkForEnclosedArea(ent)//, ent.currentPt, ent.nextPt);




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

            // 0. Draw Grid Dots
            ctx.fillStyle = '#444';
            for (let pt of points) {
                if (!globalHiddenPoints.has(`${pt.x},${pt.y}`)) {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // 1. Draw ALL Areas (The "Yards")
            for (let c = 0; c < cols - 1; c++) {
                for (let r = 0; r < rows - 1; r++) {
                    let ownerId = cellOwnership[c][r];
                    if (ownerId) {
                        let ent = entities.find(e => e.id === ownerId);
                        if (ent) {
                            let pTL = getPoint(c, r);
                            ctx.fillStyle = ent.colors.stroke; // Or a slightly transparent version
                            // Fill the space between the vertices
                            ctx.fillRect(pTL.x, pTL.y, spacingX, spacingY);
                        }
                    }
                }
            }

            // 2. Draw ALL Dynamic Territory Borders
            let dynamicBorders = getDynamicBorders();
            ctx.lineWidth = 4;
            for (let line of dynamicBorders) {
                ctx.strokeStyle = 'pink'//line.color;
                ctx.beginPath();
                ctx.moveTo(line.start.x, line.start.y);
                ctx.lineTo(line.end.x, line.end.y);
                ctx.stroke();
            }

            // 3. Draw Active Trails
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

        // --- SHARING LOGIC ---
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
                network.createSharedActivity('org.sugarlabs.PaperIO', function(groupId) {
                    console.log("Activity shared");
                    isHost = true;
                });
                // Remove the Enemy
                killEntity(entities.filter(e => e.id == 'Enemy')[0])

                network.onDataReceived(onNetworkDataReceived);
                network.onSharedActivityUserChanged(onNetworkUserChanged);
            });
        });
        var cnt = 0
        var onNetworkDataReceived = function(msg) {
            if (presence.getUserInfo().networkId === msg.user.networkId) {
                return;
            }
            switch (msg.content.action) {
                case 'init':
                    console.log("YOUR WELCOME")
                    // GIVE THE STATUS OF THE BOARD TO THE PLAYER
                    cellOwnership = JSON.parse(msg.content.cellOwnership)

                    // GIVE GIVE THE ENTITIES ARRAY TO THE PLAYER
                    let temp = JSON.parse(msg.content.entities)
                    let curr = entities[0]
                    entities = [...temp,curr]

                    console.log("Curr: ",curr)
                    console.log("Cell Ownership: ",cellOwnership)
                    // GIVE ALL THE TRAIL LINES
                    globalTrailLines = JSON.parse(msg.content.globalTrailLines)

                    // Update the ID
                    curr.id = curr.id + cnt
                    cnt += 1

                    // CREATE A ZONE WHERE THE PLAYER SHOULD SPAWN
                    let possible_position = [ [1,1], [cols - 1, 1], [1, rows -  1], [cols - 1, rows -1 ]]


                    for (var pos of possible_position)
                        if (cellOwnership[pos[0],pos[1]]==null){
                            curr.col = pos[0]
                            curr.row = pos[1]
                        }

                    setupEntityBase(curr)


                    // THE PLAYER SHOULD GIVE ITS ENTITY SO THAT THE OTHER PLAYER CAN USE IT

                    // GIVE THE NEW BOARD SINCE IT GOT UPDATED WITH THE STARTING BOARD

                    // ADD A POP UP THAT GOES AWAY ONLY WHEN THE MAIN STARTS THE MATCH (STRETCH GOAL)

                    // START DRAWING
                    if (gameLoop) clearInterval(gameLoop);
                    gameLoop = setInterval(updateTick, 180 * 2);
                    drawScene();
                    break;
                case 'update':
                    // EVERY PLAYER SEND THIS TO EVERY OTHER TOGHETER WITH THE ID SO THAT EACH CAN DRAW THE STATUS
                    // OF THE TABLE AND CHECK FOR COLLISION
                    pawns.push(msg.content.data);
                    drawPawns();
                    document.getElementById("user").innerHTML = "<h1>"+l10n.get("Played", {name:msg.user.name})+"</h1>";
                    break;
                case 'die':
                    // I DONT THINK IT IS NECESSARY SINCE EVERYONE WILL UPDATE IT IN REAL TIME LOCALLY
                    // WHEN SOMEONE DIES
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
                        cellOwnership: JSON.stringify(cellOwnership),
                        entities: JSON.stringify(entities),
                        globalTrailLines: JSON.stringify(globalTrailLines)
                    }
                });
            }
            console.log("User "+msg.user.name+" "+(msg.move == 1 ? "join": "leave"));
        };




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