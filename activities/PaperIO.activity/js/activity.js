define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/icon", "l10n",
"sugar-web/graphics/presencepalette", "sugar-web/datastore","sugar-web/graphics/journalchooser","pawnpalette",
"tutorial"],
function (activity, env, icon, l10n, presencepalette, datastore, journalchooser, pawnpalette, tutorial) {

	// Manipulate the DOM only when it is ready.
	requirejs(['domReady!'], function (doc) {

		// Initialize the activity.
		activity.setup();

        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');

        const tCanvas = document.createElement('canvas');
        const tCtx = tCanvas.getContext('2d', { willReadFrequently: true });

        let cols, rows;
        let grid;

        // Player State
        const player = { size: 20, speed: 3, angle: 0, x: 0, y: 0 };
        let mouse = { x: 0, y: 0 };
        let trail = [];
        let isOutside = false;

        // Call this to start OR respawn the player
        function init() {
            cols = window.innerWidth;
            rows = window.innerHeight;
            canvas.width = cols; canvas.height = rows;
            tCanvas.width = cols; tCanvas.height = rows;

            // Reset player state
            player.x = cols / 2;
            player.y = rows / 2;
            player.angle = 0;
            mouse.x = player.x;
            mouse.y = player.y;

            // Reset trail arrays
            trail = [];
            isOutside = false;

            // Wipe the master territory canvas clean for respawn
            tCtx.clearRect(0, 0, cols, rows);

            grid = new Uint8Array(cols * rows);

            // Draw the initial home base on the hidden canvas
            tCtx.fillStyle = '#3498db';
            tCtx.beginPath();
            tCtx.arc(player.x, player.y, 80, 0, Math.PI * 2);
            tCtx.fill();

            // Sync the logic grid with the starting base
            const imgData = tCtx.getImageData(0, 0, cols, rows);
            for(let i = 0; i < cols * rows; i++) {
                if (imgData.data[i * 4 + 3] > 0) grid[i] = 1;
            }
        }

        // Tracking mouse
        window.addEventListener('mousemove', (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        });

        // Window resize handling
        window.addEventListener('resize', init);

        // Flood-filling the outside to find enclosed gaps
        function processCapture() {
            tCtx.beginPath();
            tCtx.moveTo(trail[0].x, trail[0].y);
            for (let i = 1; i < trail.length; i++) {
                tCtx.lineTo(trail[i].x, trail[i].y);
            }
            tCtx.strokeStyle = '#3498db';
            tCtx.lineWidth = player.size;
            tCtx.lineCap = 'round';
            tCtx.lineJoin = 'round';
            tCtx.stroke();

            const imgData = tCtx.getImageData(0, 0, cols, rows);
            const data = imgData.data;

            const visited = new Uint8Array(cols * rows);
            const q = new Int32Array(cols * rows);
            let head = 0, tail = 0;

            for (let x = 0; x < cols; x++) {
                let top = x, bottom = (rows - 1) * cols + x;
                if (data[top * 4 + 3] === 0) { q[tail++] = top; visited[top] = 1; }
                if (data[bottom * 4 + 3] === 0) { q[tail++] = bottom; visited[bottom] = 1; }
            }
            for (let y = 0; y < rows; y++) {
                let left = y * cols, right = y * cols + (cols - 1);
                if (data[left * 4 + 3] === 0 && !visited[left]) { q[tail++] = left; visited[left] = 1; }
                if (data[right * 4 + 3] === 0 && !visited[right]) { q[tail++] = right; visited[right] = 1; }
            }

            const dirs = [-1, 1, -cols, cols];

            while (head < tail) {
                let idx = q[head++];
                let cx = idx % cols;

                for (let i = 0; i < 4; i++) {
                    let nIdx = idx + dirs[i];
                    if (i === 0 && cx === 0) continue;
                    if (i === 1 && cx === cols - 1) continue;
                    if (nIdx < 0 || nIdx >= cols * rows) continue;

                    if (data[nIdx * 4 + 3] === 0 && visited[nIdx] === 0) {
                        visited[nIdx] = 1;
                        q[tail++] = nIdx;
                    }
                }
            }

            for (let i = 0; i < cols * rows; i++) {
                if (visited[i] === 0) {
                    data[i * 4] = 52;
                    data[i * 4 + 1] = 152;
                    data[i * 4 + 2] = 219;
                    data[i * 4 + 3] = 255;
                    grid[i] = 1;
                } else if (data[i * 4 + 3] > 0) {
                    grid[i] = 1;
                }
            }

            tCtx.putImageData(imgData, 0, 0);
        }

        function update() {
            let dx = mouse.x - player.x;
            let dy = mouse.y - player.y;
            let targetAngle = Math.atan2(dy, dx);

            let diff = targetAngle - player.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            const maxTurn = player.speed / (player.size * 1);
            if (Math.abs(diff) < maxTurn) player.angle = targetAngle;
            else player.angle += Math.sign(diff) * maxTurn;

            player.x += Math.cos(player.angle) * player.speed;
            player.y += Math.sin(player.angle) * player.speed;

            player.x = Math.max(0, Math.min(cols - 1, player.x));
            player.y = Math.max(0, Math.min(rows - 1, player.y));

            let px = Math.floor(player.x);
            let py = Math.floor(player.y);
            let inTerritory = grid[py * cols + px] === 1;

            // NEW: Check if the player collides with their own trail
            if (isOutside && trail.length > 20) {
                // Ignore the last 20 frames so they don't collide with the line they are actively making
                for (let i = 0; i < trail.length - 20; i++) {
                    let dist = Math.hypot(trail[i].x - player.x, trail[i].y - player.y);

                    // Trail line has a thickness of 20, player is 20.
                    // 0.8 adds a slight bit of forgiveness before instantly killing the player
                    if (dist < player.size * 0.8) {
                        init(); // Respawn!
                        return; // Skip the rest of the logic this frame
                    }
                }
            }

            if (inTerritory) {
                if (isOutside) {
                    if (trail.length > 2) {
                        trail.push({ x: player.x, y: player.y });
                        processCapture();
                    }
                    trail = [];
                    isOutside = false;
                }
            } else {
                if (!isOutside) {
                    isOutside = true;
                    let backX = player.x - Math.cos(player.angle) * (player.speed * 2);
                    let backY = player.y - Math.sin(player.angle) * (player.speed * 2);
                    trail.push({ x: backX, y: backY });
                }
                trail.push({ x: player.x, y: player.y });
            }
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            ctx.drawImage(tCanvas, 0, 0);

            if (isOutside && trail.length > 1) {
                ctx.beginPath();
                ctx.moveTo(trail[0].x, trail[0].y);
                for (let i = 1; i < trail.length; i++) {
                    ctx.lineTo(trail[i].x, trail[i].y);
                }
                ctx.strokeStyle = 'rgba(52, 152, 219, 0.4)';
                ctx.lineWidth = player.size;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }

            ctx.save();
            ctx.translate(player.x, player.y);
            ctx.rotate(player.angle);
            ctx.fillStyle = '#1f618d';
            ctx.fillRect(-player.size / 2, -player.size / 2, player.size, player.size);
            ctx.restore();
        }

        function loop() {
            update();
            draw();
            requestAnimationFrame(loop);
        }

        init();
        loop();
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

        // Welcome user
        var currentenv;
        env.getEnvironment(function(err, environment) {
            currentenv = environment
		    document.getElementById("user").innerHTML = "<h1>"+l10n.get("Hello", {name:currentenv.user.name})+"</h1>";

            // Set current language to Sugarizer
            var defaultLanguage = (typeof chrome != 'undefined' && chrome.app && chrome.app.runtime) ? chrome.i18n.getUILanguage() : navigator.language;
            var language = environment.user ? environment.user.language : defaultLanguage;
            l10n.init(language);

		    // Load from datastore
            if (!environment.objectId) {
                console.log("New instance");
            } else {

                console.log("Not instance");
                activity.getDatastoreObject().loadAsText(function(error, metadata, data) {
                    if (error==null && data!=null) {
                        dt = JSON.parse(data);

                        pawns = dt.pawns

                        document.getElementById("canvas").style.backgroundImage = dt.image

                        drawPawns();
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


        });

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
