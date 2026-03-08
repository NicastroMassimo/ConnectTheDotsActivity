define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/datastore", "l10n",
"./connectTheDots","sugar-web/graphics/presencepalette"],
function (activity, env, datastore, l10n, connectTheDotsMode,presencepalette) {

    requirejs(['domReady!'], function (doc) {

        // Initialize the activity exactly ONCE per page load
        activity.setup();


        var currentenv;
        var globalLoadedData = null;
        var activeGameMode = null;

        var isShared = false;
        var presence = null;

        env.getEnvironment(function(err, environment) {
            currentenv = environment;
            var defaultLanguage = (typeof chrome != 'undefined' && chrome.app && chrome.app.runtime) ? chrome.i18n.getUILanguage() : navigator.language;
            l10n.init(environment.user ? environment.user.language : defaultLanguage);

            isShared = !!environment.sharedId;

            // --- 1. LOAD DATA ---
            if (!environment.objectId) {
                console.log("New instance");
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

        // --- 2. NETWORK SETUP & PAGE ROUTER ---
        function setupNetworkAndRoute() {

            // CHECK: Are we on the Main Menu?
            if (document.getElementById('connect-dots-button')) {
                if (isShared) {
                    // Auto-redirect joiners directly to the game!
                    console.log("REdirected")
                    window.location.href = "connectTheDots.html" + window.location.search;
                } else {
                    document.getElementById('connect-dots-button').addEventListener('click', function() {
                        window.location.href = "connectTheDots.html" + window.location.search;
                    });
                }
            }
            // CHECK: Are we on the Game Page?
            else if (document.getElementById('drawCanvas')) {
                activeGameMode = connectTheDotsMode;
                var networkButton = document.getElementById("network-button");

                if (isShared) {
                    // SCENARIO A: WE ARE JOINING A GAME
                    presence = activity.getPresenceObject(function(error, network) {
                        var palette = new presencepalette.PresencePalette(networkButton, network);

                        // Pass the network object to the game, and tell it we are NOT the host (false)
                        activeGameMode.init(activity, currentenv, datastore, network, globalLoadedData, false);
                    });
                } else {
                    // SCENARIO B: WE ARE LOCAL (But might share later)
                    var palette = new presencepalette.PresencePalette(networkButton, undefined);
                    console.log('Locally: ',globalLoadedData)
                    // Start the game locally with no network (null)
                    activeGameMode.init(activity, currentenv, datastore, null, globalLoadedData, true);

                    // --- YOUR HOST SHARING LOGIC ---
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

                                // TELL THE GAME MODE TO TURN MULTIPLAYER ON!
                                activeGameMode.setupNetwork(network, true);
                            });
                        });
                    });
                }
            }
        }



        // --- 3. GLOBAL SAVE ON STOP ---
        // Because BOTH HTML files have a button with id="stop-button", this code
        // will naturally override/handle the stop button for whichever page is open!
        document.getElementById("stop-button").addEventListener('click', function (event) {
            console.log("Stop clicked, saving...");

            // Only save if we are actually inside a game mode (connectTheDots.html)
            if (activeGameMode) {

                var to_save = activeGameMode.getState();
                var jsonData = JSON.stringify(to_save);

                activity.getDatastoreObject().setDataAsText(jsonData);
                activity.getDatastoreObject().save(function (error) {
                    if (error === null) {
                        console.log("write done.");
                    }
                });
            }
            // Note: activity.setup() already binds the stop-button to close the activity automatically
        });

    });
});