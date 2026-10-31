## Setup
This project won't run on its own, it'll need the support of the sugarizer enviroment, or to be put on a XO Operating System.
The first option is the most portable, as it doesn't require to download a new Operating System.
To know how do to the first, follow this link to the official documentation on how to start the sugarizer enviroment [sugarizer-server documentation](https://github.com/llaske/sugarizer/blob/master/docs/tutorial/VanillaJS/step0.md).

## Project Details
The projects implements this 3 modes inside it, showed in the video below, in this same order:

**Draw mode**: A very basic mode for young users. Let users create freely like in the Gridpaint activity, inspired by Pok Pok. In shared mode, all users draw together on the same board like in the Paint activity.

**Number mode**: The user chooses a template with numbered dots and has to connect them in the correct order, inspired by the connect-the-dots activity. In shared mode, all users compete to finish the template first like in the Maze activity. It should also be possible to create and share new templates like in the Calligra or Tangram activities.

**Game mode**: A strategic mode to conquer territory, where each user should fill a maximum part of the screen starting from a little square on the border, inspired by Paper.io. If the user is alone, an AI opponent will try to beat them. In shared mode, all users compete to conquer the most territory.


The technologies used are:

**Native Javascript** for the scripting
**CSS** and **HTML** for the paging and styling
**JSON** to implement the translation of the activity 

## Structure of the activity

```text
├── activity
│   The usual
├── connectTheDots.html (html for the Draw Mode)
├── connectTheNumbers.html (html for the Number Mode)
├── css
│   ├── activity.css (css for both the Draw Mode and Number Mode, will be Fixed)
│   ├── introjs.css
│   └── paperIO.css  (css for the Game Mode)
├── icons
│  
├── index.html  (html of the starting point, so the central hub)
├── js
│   ├── activity.js (Javascript that handles the hub logic, and loading into a new game mode)
│   ├── connectTheDots.js (Javascript that handles the Draw Mode logic)
│   ├── connectTheNumbers.js (Javascript that handles the Numbers Mode logic)
│   ├── loader.js
│   └── paperIO.js (Javascript that handles the Game Mode logic)
├── lib
│   
├── LICENSE
├── locales
│   
├── NOTICE
├── package.json
├── paperIO.html (html for the Game Mode)
└── setup.py
```

Every `.html` loads `activity.js` independently of what game mode's html they are:
```html
<script data-main="js/loader" src="lib/require.js"></script>
```

At the start, `activity.js` loads all the game modes:
```javascript
define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/datastore", "l10n",
"./connectTheDots", "./connectTheNumbers", "./paperIO", "sugar-web/graphics/presencepalette"],
function (activity, env, datastore, l10n, connectTheDotsMode, connectTheNumbersMode,
paperIOMode, presencepalette) {

    requirejs(['domReady!'], function (doc) {
       ...
       activity.setup(); // <--- only activity.setup() in all the game modes js  
```

Then it loads data from the datastore and calls the `setupNetworkAndRoute()` function:
```javascript
env.getEnvironment(function(err, environment) {
            ...

            // --- 1. LOAD DATA ---
            if (!environment.objectId) {
                console.log("New instance");
                // In both cases we call the function to check where we are on the page and so what we need to load
                setupNetworkAndRoute(); 
            } else {
                console.log("Loading instance...");
                activity.getDatastoreObject().loadAsText(function(error, metadata, data) {
                    if (error == null && data != null) {
                        globalLoadedData = JSON.parse(data);
                    }
                    setupNetworkAndRoute();
                });
            }
        });
```

The `setupNetworkAndRoute` function, as the name suggests, decides which page we are on based on our URL. It is the function we use to load the correct HTML when a button is pressed or to join the correct game when we connect using the network.
```javascript
        // 2. UPDATED ROUTER
        function setupNetworkAndRoute() {
            var currentPage = window.location.pathname.split('/').pop();

            // SCENARIO A: We are on the Main Menu (index.html)
            if (currentPage == 'index.html' || currentPage == '') {

                // Bind Each button of the hub to the html of that activity
                document.getElementById('connect-dots-button').addEventListener('click', function() {
                    window.location.href = "connectTheDots.html" + window.location.search;
                });

                ...

                // If joining, listen for the Host to tell us which game they are in
                if (isShared) {
                    presence = activity.getPresenceObject(function(error, network) {
                        network.onDataReceived(function(msg) {
                            if (msg.content.action == 'init_connectTheDots') {
                                window.location.href = "connectTheDots.html" + window.location.search;
                            }
                            else if ...
                        });
                    });
                }
            }

            // SCENARIO B: We are inside a Game Page
            else if (document.getElementById('drawCanvas')) {

                // Check the URL to assign the correct game mode to activeGameMode
                ...

                
                var networkButton = document.getElementById("network-button");

                if (isShared) {
                    presence = activity.getPresenceObject(function(error, network) {
                        var palette = new presencepalette.PresencePalette(networkButton, network);

                        // Whether we are sharing or not we always start the activeGameMode.init
                        // However, if we are sharing the network object is passed (and we set isHost to false)
                        // else we give null and set isHost to true
                        activeGameMode.init(activity, currentenv, datastore, network, globalLoadedData, false);
                    });
                } else {
                    // Starting locally, but might share later
                    var palette = new presencepalette.PresencePalette(networkButton, undefined);
                    activeGameMode.init(activity, currentenv, datastore, null, globalLoadedData, true);

                    // --- HOST SHARING LOGIC ---
                    palette.addEventListener('shared', function() {
                        palette.popDown();
                        console.log("Want to share");

                        presence = activity.getPresenceObject(function(error, network) {
                            if (error) {
                                console.log("Sharing error");
                                return;
                            }
                            network.createSharedActivity('org.sugarlabs.ConnectTheDots', function(groupId) {
                                console.log("Activity shared");

                                // We turn multiplayer and initialize the function used to share and receive data from it
                                activeGameMode.setupNetwork(network, true);
                            });
                        });
                    });
                }
            }
        }

```

To store the data on the datastore, we use an event listener on the stop button, which will then call the `getState` method of the activity we are in. This retrieves the data that needs to be saved.
```javascript
        // --- 3. GLOBAL SAVE ON STOP ---
        document.getElementById("stop-button").addEventListener('click', function (event) {

                ...

                //  Call the getState method of the game mode
                var to_save = activeGameMode.getState();
                var jsonData = JSON.stringify(to_save);

                
                activity.getDatastoreObject().setDataAsText(jsonData);
                activity.getDatastoreObject().save(function (error) {
                    if (error === null) {
                        console.log("write done.");
                    }
                });
            }
           
        });
```

To support this modularization, each activity js follows this format:
```javascript
define([...], function(...){
    // Define global variables and functions, so code that needs to be accessible everywhere
    // Most of the code to do all the logic and implementation is found here

    ...


    var mode = {} // <-- the object containing all the methods of the mode called by activity.js

    mode.init = function(activity, currentenv, datastore, presence, loadedData, hostStatus){
        // Loading the language 

        // if loadedData use them

        // Adding addEventListener to the HTML

        // if presence do mode.setupNetwork(presence,hostStatus)

        requirejs(['domReady!'], function (doc) {
            // draw the playing field
            draw()
        }
    }

    mode.setupNetwork = function(networkObj, hostStatus){
        presence = networkObj
        isHost = hostStatus;

        presence.onDataReceived(...)
        presence.onSharedActivityUserChanged(...)
    }

    mode.getState = function(){
        // Object containing the data to save
    }

    return mode
})
```

# Video demo

https://github.com/user-attachments/assets/13e34498-d6e4-4007-b5d7-bf55126d4038

You can find the video inside the video folder.
In the video you'll see me playing the 3 gamemodes, together or against another player of color yellow.
