define(["sugar-web/graphics/presencepalette","humane","l10n"],
function (presencepalette, humane, l10n) {
    var mode = {};
    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');

    const snapRadius = 15; // Snap distance
    const points = [];
    const cols = 28;
    const rows = 13;
    const spacingX = 60;
    const spacingY = 60;
    const startX = 30;
    const startY = 30;

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        points.push({
          x: startX + (j * spacingX),
          y: startY + (i * spacingY)
        });
      }
    }

    var completedLines = [];
    let completedAreas = [];
    let isDrawing = false;
    let startPoint = null;
    let currentMouse = { x: null, y: null };

    var drawnPoints = new Map();
    let hiddenPoints = new Set(); // NEW: Tracks which points to stop drawing

    // Select the color logic
    var currcolor = 'red'
    var basecolor = '#373937'
    var presence = null
    var isHost = false

    // Util function
    // Setup your canvas listeners and drawScene here
    function drawForExport(){
      canvas.width = 1200;
      canvas.height = 600;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = 'white'
      ctx.fillRect(0,0,canvas.width, canvas.height)
      // 0. Draw filled areas FIRST (so they stay behind lines)
      // NEW: Sort areas from largest to smallest
      // We copy the array with [...] so we don't permanently mutate the original
      let sortedAreas = [...completedAreas].sort((a, b) => b.size - a.size);

      for (let area of sortedAreas) {
          ctx.beginPath();
          ctx.moveTo(area.path[0].x, area.path[0].y);
          for (let i = 1; i < area.path.length; i++) {
              ctx.lineTo(area.path[i].x, area.path[i].y);
          }
          ctx.closePath();
          ctx.fillStyle = area.color;
          ctx.fill();
      }

      // 1. Draw all saved lines
      ctx.lineWidth = 4;
      for (let line of completedLines) {
        ctx.strokeStyle = basecolor;
        ctx.beginPath();
        ctx.moveTo(line.start.x, line.start.y);
        ctx.lineTo(line.end.x, line.end.y);
        ctx.stroke();
      }
    }

    // Helper: Find the closest point to the mouse
    function getClosestPoint(mouseX, mouseY) {
      for (let point of points) {
        const distance = Math.hypot(point.x - mouseX, point.y - mouseY);
        if (distance <= snapRadius) {
          drawnPoints.set(`${point.x},${point.y}`, currcolor);
          return point;
        }
      }
      return null;
    }

    // Helper to calculate the mathematical size of a polygon
    function calculatePolygonArea(polygon) {
        let area = 0;
        let j = polygon.length - 1;
        for (let i = 0; i < polygon.length; i++) {
            area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
            j = i;
        }
        return Math.abs(area / 2);
    }

    // Math helper to determine if a point is inside or exactly on the border of a polygon
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
                if (dotProduct >= 0 && dotProduct <= squaredLengthBA) {
                    return true;
                }
            }

            let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // Graph Algorithm to detect cycles
    function checkForEnclosedArea(startPt, endPt) {
        let adj = {};
        for (let pt of points) adj[`${pt.x},${pt.y}`] = [];

        for (let line of completedLines) {
            let sKey = `${line.start.x},${line.start.y}`;
            let eKey = `${line.end.x},${line.end.y}`;
            adj[sKey].push(line.end);
            adj[eKey].push(line.start);
        }

        let startKey = `${startPt.x},${startPt.y}`;
        let endKey = `${endPt.x},${endPt.y}`;

        let queue = [ [startPt] ];
        let visited = new Set();
        visited.add(startKey);

        let cyclePath = null;

        while (queue.length > 0) {
            let path = queue.shift();
            let currentPt = path[path.length - 1];
            let currentKey = `${currentPt.x},${currentPt.y}`;

            if (currentKey === endKey) {
                cyclePath = path;
                break;
            }

            for (let neighbor of adj[currentKey]) {
                let nKey = `${neighbor.x},${neighbor.y}`;
                if (!visited.has(nKey)) {
                    visited.add(nKey);
                    queue.push([...path, neighbor]);
                }
            }
        }

        if (cyclePath) {
            completedAreas.push({
                path: cyclePath,
                color: currcolor,
                size: calculatePolygonArea(cyclePath) // NEW: Save the size of the area
            });

            // Color dots AND hide them
            for (let pt of points) {
                if (isPointInOrOnPolygon(pt, cyclePath)) {
                    let ptKey = `${pt.x},${pt.y}`;
                    drawnPoints.set(ptKey, currcolor);
                    hiddenPoints.add(ptKey);
                }
            }
        }

    }

    // Handle dragging and continuous snapping
    const baseRadius = 5;         // Default dot size
    const maxExtraRadius = 7;     // How much bigger it gets (5 + 7 = max 12 radius)
    const effectDistance = 80;    // Pixel distance at which the dot starts growing

    // Draws points with a dynamic scaling effect based on mouse distance
    function drawPointsScaled(mouseX, mouseY, isMouseOut) {

        for (let point of points) {
            let el = `${point.x},${point.y}`;

            // Skip drawing if the dot has been hidden by a filled area
            if (hiddenPoints.has(el)) {
                continue;
            }

            let radius = baseRadius;

            // Calculate scaling only if the mouse is on the canvas
            if (!isMouseOut && mouseX != null && mouseY != null) {

                let distance = Math.hypot(point.x - mouseX, point.y - mouseY);

                // If the mouse is within range, scale the radius up
                if (distance < effectDistance) {
                    // Creates a multiplier from 0.0 (far) to 1.0 (exact center)
                    let scaleFactor = 1 - (distance / effectDistance);
                    radius += maxExtraRadius * scaleFactor;
                }
            }

            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = drawnPoints.has(el) ? drawnPoints.get(el) : '#6e6e6e';
            ctx.fill();
        }
    }

    // Render function
    function drawScene(received = false, othermousex = null, othermousey = null,
    stp = null, mouseout=false, otherUserName=false) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      canvas.width = 1200;
      canvas.height = 600;

      // 0. Draw filled areas FIRST (so they stay behind lines)
      // NEW: Sort areas from largest to smallest
      // We copy the array with [...] so we don't permanently mutate the original
      let sortedAreas = [...completedAreas].sort((a, b) => b.size - a.size);

      for (let area of sortedAreas) {
          ctx.beginPath();
          ctx.moveTo(area.path[0].x, area.path[0].y);
          for (let i = 1; i < area.path.length; i++) {
              ctx.lineTo(area.path[i].x, area.path[i].y);
          }
          ctx.closePath();
          ctx.fillStyle = area.color;
          ctx.fill();
      }

      // 1. Draw all saved lines
      ctx.lineWidth = 4;
      for (let line of completedLines) {
        ctx.strokeStyle = basecolor;
        ctx.beginPath();
        ctx.moveTo(line.start.x, line.start.y);
        ctx.lineTo(line.end.x, line.end.y);
        ctx.stroke();
      }

      // 2. Draw the active drag line
      if ((isDrawing && startPoint) || stp != null) {
        ctx.beginPath();
        ctx.moveTo(stp == null ? startPoint.x : stp.x, stp == null ? startPoint.y : stp.y);
        ctx.lineTo(
          othermousex == null ? currentMouse.x : othermousex,
          othermousey == null ? currentMouse.y : othermousey
        );
        ctx.strokeStyle = basecolor;
        ctx.stroke();
      }

      // 3. Draw the dots
      //drawPointsScaled(mouseout)
      // Determine the active mouse position (local vs network)


      drawPointsScaled(currentMouse.x, currentMouse.y, mouseout);

      //  4. Draw the Username
      if (otherUserName && othermousex !== null && othermousey !== null) {
        ctx.font = "bold 14px sans-serif";
        ctx.fillStyle = '#000000'; // You can change this to match the other user's specific color

        // We add +15 to X and Y so the text floats slightly below and to the right of the actual cursor
        ctx.fillText(otherUserName, othermousex + 15, othermousey + 15);
      }

      // Send the live drawing
      if (presence && !(received)) {

          presence.sendMessage(presence.getSharedInfo().id, {
              user: presence.getUserInfo(),
              content: {
                  action: 'draw',
                  lines: completedLines,
                  drawn: [...drawnPoints.entries()],
                  hidden: [...hiddenPoints.keys()], // NEW: sync hidden points
                  areas: completedAreas,
                  mouse: {x: currentMouse.x, y: currentMouse.y},
                  stp: startPoint
              }
          });
      }

    }


    // Called by activity.js when connectTheDots.html loads
    mode.init = function(activity, currentenv, datastore, presence, loadedData, hostStatus) {

        // Manipulate the DOM only when it is ready.
	    requirejs(['domReady!'], function (doc) {


            document.getElementById('red').addEventListener('click',e => colorChosen(e.target.id) )
            document.getElementById('blue').addEventListener('click',e => colorChosen(e.target.id) )
            document.getElementById('yellow').addEventListener('click',e => colorChosen(e.target.id) )
            document.getElementById('green').addEventListener('click',e => colorChosen(e.target.id) )
            document.getElementById('orange').addEventListener('click',e => colorChosen(e.target.id) )
            document.getElementById('cyan').addEventListener('click',e => colorChosen(e.target.id) )

            function colorChosen(id){
                console.log(id)
                var sp = document.getElementById('colors')
                var colors = sp.querySelectorAll('button')

                for (var el of colors){
                    if (el.id == id)
                    {
                        el.style.border = '4px solid rgba(0,0,0,0.5)'
                        currcolor = id

                    }
                    else
                        el.style.border = 'none'
                }
            }

            //Start to draw only when DOM is ready
            drawScene();
        })



        // Restore previous save if it exists
        if (loadedData) {
            completedLines = loadedData.lines || [];
            completedLines = loadedData.lines;
            completedAreas = loadedData.areas
            drawnPoints = new Map()

            //console.log(loadedData.drawn)
            for (var el of loadedData.drawn){
                drawnPoints.set(el[0],el[1])

            }

            for (var el of loadedData.hidden){
                hiddenPoints.add(el)
            }

        }

        // If we JOINED a game, the network is already ready, so setup immediately
        if (presence) {
            mode.setupNetwork(presence, hostStatus);
        }

        // Mouse EVENT
        canvas.addEventListener('mousedown', (e) => {
          const closest = getClosestPoint(e.offsetX, e.offsetY);
          if (closest) {
            isDrawing = true;
            startPoint = closest;
            currentMouse = { x: e.offsetX, y: e.offsetY };
            drawScene();
          }
        });

        canvas.addEventListener('mousemove', (e) => {
          currentMouse = { x: e.offsetX, y: e.offsetY };

          // We only check for line connections if we are actively drawing
          if (isDrawing) {
            const closest = getClosestPoint(e.offsetX, e.offsetY);

            if (closest && closest !== startPoint) {
              const lineExists = completedLines.some(l =>
                (l.start.x === startPoint.x && l.start.y === startPoint.y && l.end.x === closest.x && l.end.y === closest.y) ||
                (l.start.x === closest.x && l.start.y === closest.y && l.end.x === startPoint.x && l.end.y === startPoint.y)
              );

              if (!lineExists) {
                  checkForEnclosedArea(startPoint, closest);
                  completedLines.push({ start: startPoint, end: closest, color: currcolor });
              }

              startPoint = closest;
            }
          }

          // NEW: We call drawScene unconditionally on EVERY mouse move.
          // This ensures the canvas clears and the dots shrink back down when hovered off.
          // drawScene() already calls drawPointsScaled inside of it!
          drawScene();
        });

        // Stop drawing when mouse is released
        canvas.addEventListener('mouseup', () => {
          isDrawing = false;
          startPoint = null;
          drawScene();
        });

        // Stop drawing if the mouse leaves the canvas area entirely
        canvas.addEventListener('mouseout', () => {
          isDrawing = false;
          startPoint = null;
          currentMouse = {x:null,y:null}
          // NEW: You must pass the arguments in the exact order the function expects them.
          // drawScene(received, othermousex, othermousey, stp, mouseout)
          drawScene(false, null, null, null, true);
        });

        document.getElementById('clear-all-button').addEventListener('click',function (){
            completedLines = [];
            completedAreas = []
            hiddenPoints = new Set()
            drawnPoints = new Map()
            drawScene()
            if (presence){
              console.log("send")
              presence.sendMessage(presence.getSharedInfo().id, {
                  user: presence.getUserInfo(),
                  content: {
                      action: 'clear',
                      lines: completedLines,
                      areas: completedAreas,
                      drawn: [...drawnPoints.entries()]

                  }
              });
            }
        })

        document.getElementById('save-image').addEventListener('click',function saveImage() {
            /*
                Read canvas data as base64 string and
                store image in datastore
            */
            // Draw for export
            drawForExport()

            var mimetype = 'image/jpeg';
            var inputData = canvas.toDataURL(mimetype, 1);
            var metadata = {
                mimetype: mimetype,
                title: "SavedPokPok",
                activity: "org.olpcfrance.MediaViewerActivity",
                timestamp: new Date().getTime(),
                creation_time: new Date().getTime(),
                file_size: 0
            };
            datastore.create(metadata, function() {
                humane.log(l10n.get('SavedPokPok'));
                console.log("export done.")
            }, inputData);

            // Redraw normally
            drawScene()
        })

    };

    mode.setupNetwork = function (networkObj, hostStatus){
        presence = networkObj
        isHost = hostStatus;
        // --- MULTIPLAYER LOGIC ---


        // 1. Listen for incoming network messages
        presence.onDataReceived(function(msg) {
            // Ignore our own messages
            if (presence.getUserInfo().networkId === msg.user.networkId) return;

            switch(msg.content.action) {
                case 'init':
                    // A late-joiner receives the current board state from the host
                    if (!isHost) {
                        completedLines = msg.content.lines;
                        completedAreas = msg.content.areas;

                        drawnPoints = new Map();
                        for (var el of msg.content.drawn) drawnPoints.set(el[0], el[1]);

                        hiddenPoints = new Set();
                        for (var el of msg.content.hidden) hiddenPoints.add(el);

                        drawScene(true); // Update the canvas!
                    }
                    break;
                case 'draw':
                    completedLines = msg.content.lines;

                    drawnPoints = new Map()
                    for (var el of msg.content.drawn){
                        drawnPoints.set(el[0],el[1])
                        //console.log(el)
                    }
                    //console.log("MESSAGGIO",JSON.stringify(msg.content.mouse))
                    completedAreas = msg.content.areas
                    hiddenPoints = new Set()
                    for (var el of msg.content.hidden){
                        hiddenPoints.add(el)
                    }
                    drawScene(true,msg.content.mouse.x,msg.content.mouse.y,
                    msg.content.stp,false,msg.user.name);
                    break;

                case 'clear':
                    case 'clear':
                    completedLines = []
                    drawnPoints = new Map()
                    drawScene(true);
                    break
            }
        });

        // 2. Host sends the 'init' state when a new player joins
        presence.onSharedActivityUserChanged(function(msg) {
            if (isHost && msg.move === 1) { // move 1 means "joined"
                presence.sendMessage(presence.getSharedInfo().id, {
                    user: presence.getUserInfo(),
                    content: {
                        action: 'init_connectTheDots',
                        lines: completedLines,
                        areas: completedAreas,
                        drawn: [...drawnPoints.entries()],
                        hidden: [...hiddenPoints.keys()]
                    }
                });
            }
            console.log("User "+msg.user.name+" "+(msg.move == 1 ? "join": "leave"));
        });

    }

    // Called by activity.js when the Stop button is clicked
    mode.getState = function() {

        console.log(completedLines)
        var to_save = {
            lines: completedLines,
            drawn:[...drawnPoints.entries()],
            areas: completedAreas,
            hidden: [...hiddenPoints.keys()]
        }
        return to_save
    };



	console.log("connectDOTS: ", mode)
    return mode;

});
