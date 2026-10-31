define(["sugar-web/graphics/presencepalette","humane", "l10n", "shapepalette"],
function (presencepalette, humane, l10n, shapepalette) {

    var mode = {};

    // 0. Global game variables
    var currcolor = 'red';

    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');

    const snapRadius = 25; // Snap distance
    const points = [];
    const cols = 28;
    const rows = 13;
    const spacingX = 60;
    const spacingY = 60;
    const startX = 30;
    const startY = 30;

    // Generate background grid
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        points.push({ x: startX + (j * spacingX), y: startY + (i * spacingY) });
      }
    }

    // --- SHAPE COORDINATES ---
    const shapesGrid = {
        apple: [
            {c:14, r:3}, {c:16, r:2}, {c:18, r:4}, {c:17, r:7},
            {c:15, r:9}, {c:14, r:9}, {c:13, r:9}, {c:11, r:7},
            {c:10, r:4}, {c:12, r:2}, {c:13, r:3}, {c:14, r:1}, {c:16, r:0}
        ],
        house: [ // Simple house outline
            {c:10, r:9}, {c:18, r:9}, {c:18, r:5},
            {c:14, r:2}, {c:10, r:5}
        ],
        star: [
            {c: 14, r: 2},  // 1. Top point
            {c: 15, r: 4},  // 2. Inner top-right
            {c: 18, r: 4},  // 3. Right point
            {c: 16, r: 6},  // 4. Inner bottom-right
            {c: 17, r: 9},  // 5. Bottom right point (Max row 9)
            {c: 14, r: 7},  // 6. Inner bottom center
            {c: 11, r: 9},  // 7. Bottom left point (Max row 9)
            {c: 12, r: 6},  // 8. Inner bottom-left
            {c: 10, r: 4},  // 9. Left point
            {c: 13, r: 4}   // 10. Inner top-left
        ]
    };

    let currentShape = 'apple';
    let targetSequence = []; // Will be populated dynamically


    // Game State
    let currentStep = 0;
    let completedLines = [];
    let isDrawing = false;
    let currentMouse = { x: null, y: null };
    let hasWon = false;

    // --- RENDER LOGIC ---
    function drawScene() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1200;
      canvas.height = 600;

      // 1. Draw Faint Background Grid
      ctx.fillStyle = '#cccccc';
      for (let pt of points) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
          ctx.fill();
      }

      // 2. Draw Apple Target Sequence Dots and Numbers
      ctx.font = "bold 16px sans-serif";
      for (let i = 0; i < targetSequence.length; i++) {
          let pt = targetSequence[i];

          // Draw larger dot
          ctx.fillStyle = '#333333';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
          ctx.fill();

          // Draw Number (Offset slightly)
          // console.log("NUM: ",i + 1)
          ctx.fillStyle = '#000000';
          ctx.fillText(i + 1, pt.x + 10, pt.y - 10);
      }

      // 2.5 Fill Shape if Won
      if (hasWon && completedLines.length > 0) {
          ctx.beginPath();

          // Start at the first point
          ctx.moveTo(completedLines[0].start.x, completedLines[0].start.y);

          // Trace through all completed segments
          for (let line of completedLines) {
              ctx.lineTo(line.end.x, line.end.y);
          }
          ctx.closePath();

          // Temporarily set transparency to 50%
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = currcolor;
          ctx.fill();

          // Reset transparency back to 100% for the rest of the drawing
          ctx.globalAlpha = 1.0;
      }

      // 3. Draw Completed Lines
      ctx.lineWidth = 4;
      for (let line of completedLines) {
        ctx.strokeStyle = line.color;
        ctx.beginPath();
        ctx.moveTo(line.start.x, line.start.y);
        ctx.lineTo(line.end.x, line.end.y);
        ctx.stroke();
      }

      // 4. Draw Active Dragging Line
      if (isDrawing && currentMouse.x != null && !hasWon) {
        let activeStart = targetSequence[currentStep];
        ctx.strokeStyle = currcolor;
        ctx.beginPath();
        ctx.moveTo(activeStart.x, activeStart.y);
        ctx.lineTo(currentMouse.x, currentMouse.y);
        ctx.stroke();
      }
    }

    // --- GAME CONTROL LOGIC ---
    function triggerWin() {
        hasWon = true;
        document.getElementById('win-message').innerText = "Completed! You won!";
        document.getElementById('win-popup').classList.remove('hidden');
        console.log("I WIN")
        // If Multiplayer, tell everyone else you won!
        if (presence) {
            presence.sendMessage(presence.getSharedInfo().id, {
                user: presence.getUserInfo(),
                content: { action: 'win' }
            });
        }
    }

    function resetGame(broadcast = false) {
        currentStep = 0;
        completedLines = [];
        hasWon = false;
        document.getElementById('win-popup').classList.add('hidden');
        drawScene();

        if (broadcast && presence) {
            presence.sendMessage(presence.getSharedInfo().id, {
                user: presence.getUserInfo(),
                content: { action: 'restart' }
            });
        }
    }


    function loadShape(shapeName, broadcast = false) {
        currentShape = shapeName;

        // Map the new shape's grid coordinates to actual pixels
        targetSequence = shapesGrid[shapeName].map(pt => ({
            x: startX + pt.c * spacingX,
            y: startY + pt.r * spacingY
        }));

        // Reset game progress automatically when a new shape is loaded
        resetGame(false);

        // Tell the network we changed the shape
        if (broadcast && presence) {
            console.log("Changed Shape")
            presence.sendMessage(presence.getSharedInfo().id, {
                user: presence.getUserInfo(),
                content: { action: 'change_shape', shape: shapeName }
            });
        }
    }


    //MAIN INIT FUNCTION
    mode.init = function(activity, currentenv, datastore, presence, loadedData, hostStatus) {


        var defaultLanguage = (typeof chrome != 'undefined' && chrome.app && chrome.app.runtime) ? chrome.i18n.getUILanguage() : navigator.language;
        var language = currentenv.user ? currentenv.user.language : defaultLanguage;
        l10n.init(language);

        // Set up network
        if (presence)
            mode.setupNetwork(presence,hostStatus)

        // Load the default shape immediately
        loadShape('apple')

        // Add listener
        var scenePalette = new shapepalette.ShapePalette(document.getElementById("load-scene"), "Choose Shape");

        // Listen for the custom event we created
        scenePalette.addEventListener('shapeClick', function (event) {
            // Load the new shape and broadcast the change to other players
            loadShape(event.shape, true);
        });

        canvas.addEventListener('mousedown', (e) => {
          if (hasWon) return;
          // Must click close to the CURRENT step's point to start dragging
          let activePt = targetSequence[currentStep];
          let dist = Math.hypot(activePt.x - e.offsetX, activePt.y - e.offsetY);

          if (dist <= snapRadius) {
            isDrawing = true;
            currentMouse = { x: e.offsetX, y: e.offsetY };
            drawScene();
          }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing || hasWon) return;
            currentMouse = { x: e.offsetX, y: e.offsetY };

            if (currentStep < targetSequence.length) {

                // Determine the next point to snap to.
                // If we are on the very last dot, the next point is the FIRST dot (index 0).
                let isLastDot = (currentStep === targetSequence.length - 1);
                let nextPt = isLastDot ? targetSequence[0] : targetSequence[currentStep + 1];

                let dist = Math.hypot(nextPt.x - e.offsetX, nextPt.y - e.offsetY);

                if (dist <= snapRadius) {
                    // Success, Snap and lock the line
                    completedLines.push({
                        start: targetSequence[currentStep],
                        end: nextPt,
                        color: currcolor
                    });

                    currentStep++;

                    // Check for Win Condition
                    if (currentStep === targetSequence.length) {
                        isDrawing = false;
                        ctx.beginPath();

                        triggerWin();
                    }
                }
            }
            drawScene();
        });

        canvas.addEventListener('mouseup', () => {
          isDrawing = false;
          drawScene();
        });

        canvas.addEventListener('mouseout', () => {
          isDrawing = false;
          currentMouse = {x: null, y: null};
          drawScene();
        });

        // Restart button on the Win popup
        document.getElementById('restart-button').addEventListener('click', () => {
            resetGame(true); // Reset locally and broadcast
        });

        // Clear all button (local reset only to fix mistakes)
        document.getElementById('clear-all-button').addEventListener('click', () => {
            resetGame(false);
        });

        // Save progress on Stop
        document.getElementById("stop-button").addEventListener('click', function () {
            var to_save = {
                lines: completedLines,
                currentStep: currentStep
            };
            activity.getDatastoreObject().setDataAsText(JSON.stringify(to_save));
            activity.getDatastoreObject().save(function (error) { });
        });

        document.getElementById('save-image').addEventListener('click', function saveImage() {
            var mimetype = 'image/jpeg';
            // Draw background as white to fix transparent JPEG issue
            ctx.globalCompositeOperation = "destination-over";
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0,0,canvas.width,canvas.height);

            var inputData = canvas.toDataURL(mimetype, 1);
            var metadata = {
                mimetype: mimetype,
                title: "SavedDots",
                activity: "org.olpcfrance.MediaViewerActivity",
                timestamp: new Date().getTime(),
                creation_time: new Date().getTime(),
                file_size: 0
            };
            datastore.create(metadata, function() {
                humane.log(l10n.get('SavedPokPok'));
            }, inputData);

            // Reset composite mode
            ctx.globalCompositeOperation = "source-over";
            drawScene();
        });

        // Manipulate the DOM only when it is ready.
        requirejs(['domReady!'], function (doc) {
            drawScene()
        })
    }


    mode.setupNetwork = function(networkObj, hostStatus) {
        presence = networkObj;
        isHost = hostStatus;

        presence.onDataReceived(function(msg) {
            // Ignore our own messages
            if (presence.getUserInfo().networkId === msg.user.networkId) return;

            switch (msg.content.action) {
                case 'change_shape':
                    // The host (or another player) changed the shape
                    loadShape(msg.content.shape, false);
                    break;
                case 'init_connectTheNumbers':
                    if (!isHost) {
                        // Ensure late-joiners load whatever shape the Host is currently using
                        if (msg.content.shape) {
                            loadShape(msg.content.shape, false);
                        }
                    }
                    break;
                case 'joined':
                    var j = document.getElementById('Joined');
                    j.innerText = `${msg.user.name} Joined!`;
                    j.style.opacity = '100%';
                    j.classList.remove('fade-out');
                    void j.offsetWidth; // Trigger reflow for animation restart
                    j.classList.add('fade-out');
                    break;
                case 'win':
                    // Someone else won the race!
                    hasWon = true;
                    isDrawing = false;
                    document.getElementById('win-message').innerText = msg.user.name + " Won!";
                    document.getElementById('win-popup').classList.remove('hidden');
                    break;
                case 'restart':
                    // The winner clicked restart, reset board for everyone
                    resetGame(false);
                    break;
            }
        })

        presence.onSharedActivityUserChanged(function(msg) {
            if (isHost && msg.move === 1) { // 1 means joined
                // Just welcome them, no need to send our private drawing progress
                presence.sendMessage(presence.getSharedInfo().id, {
                    user: presence.getUserInfo(),
                    content: { action: 'init_connectTheNumbers', shape: currentShape }
                });
            }
            console.log("User "+msg.user.name+" "+(msg.move == 1 ? "join": "leave"));
        })
    }

    mode.getState = function() {
        // Nothing is saved
        var to_save = {}
        return to_save
    };

    return mode;
});