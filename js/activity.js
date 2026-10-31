define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/datastore", "l10n",
"./connectTheDots", "./connectTheNumbers", "./paperIO", "sugar-web/graphics/presencepalette"],
function (activity, env, datastore, l10n, connectTheDotsMode, connectTheNumbersMode,
paperIOMode, presencepalette) {

    requirejs(['domReady!'], function (doc) {

        var currentenv;
        var globalLoadedData = null;
        var activeGameMode = null;
        var isShared = false;
        var presence = null;

        // Initialize the activity exactly ONCE per page load
        activity.setup();


        var currentenv;
        var globalLoadedData = null;
        var activeGameMode = null;

        var isShared = false;
        var presence = null;
        var temp = ""
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

        // 2. UPDATED ROUTER
        function setupNetworkAndRoute() {
            var currentPage = window.location.pathname.split('/').pop();

            // SCENARIO A: We are on the Main Menu (index.html)
            if (currentPage === 'index.html' || currentPage === '') {

                // Bind your menu buttons
                document.getElementById('connect-dots-button').addEventListener('click', function() {
                    window.location.href = "connectTheDots.html" + window.location.search;
                });
                document.getElementById('number-mode-button').addEventListener('click', function() {
                    window.location.href = "connectTheNumbers.html" + window.location.search;
                });
                document.getElementById('paperio-button').addEventListener('click', function() {
                    window.location.href = "paperIO.html" + window.location.search;
                });

                // If joining, listen for the Host to tell us which game they are in!
                if (isShared) {
                    presence = activity.getPresenceObject(function(error, network) {
                        network.onDataReceived(function(msg) {
                            if (msg.content.action === 'init_connectTheDots') {
                                window.location.href = "connectTheDots.html" + window.location.search;
                            }
                            else if (msg.content.action === 'init_connectTheNumbers') {
                                window.location.href = "connectTheNumbers.html" + window.location.search;
                            }
                            else if (msg.content.action === 'init_paperIO') {
                                window.location.href = "paperIO.html" + window.location.search;
                            }
                        });
                    });
                }
            }

            // SCENARIO B: We are inside a Game Page
            else if (document.getElementById('drawCanvas')) {

                // Check the URL to assign the correct game mode
                if (currentPage.includes('connectTheDots')) {
                    activeGameMode = connectTheDotsMode;
                    temp = "connectTheDots"
                }
                else if (currentPage.includes('connectTheNumbers')){
                    activeGameMode = connectTheNumbersMode;
                    temp = "connectTheNumbers"
                }
                else if (currentPage.includes('paperIO')) {
                    activeGameMode = paperIOMode;
                    temp = "paperIO"
                }

                var networkButton = document.getElementById("network-button");

                if (isShared) {
                    presence = activity.getPresenceObject(function(error, network) {
                        var palette = new presencepalette.PresencePalette(networkButton, network);
                        activeGameMode.init(activity, currentenv, datastore, network, globalLoadedData, false);
                    });
                } else {
                    // Starting locally, but might share later
                    var palette = new presencepalette.PresencePalette(networkButton, undefined);
                    activeGameMode.init(activity, currentenv, datastore, null, globalLoadedData, true);

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

                                // Turn multiplayer on
                                activeGameMode.setupNetwork(network, true);
                            });
                        });
                    });
                }
            }
        }

        // --- 3. GLOBAL SAVE ON STOP ---
        // Because BOTH HTML files have a button with id="stop-button", this code
        // will naturally override/handle the stop button for whichever page is open
        document.getElementById("stop-button").addEventListener('click', function (event) {
            console.log("Stop clicked, saving...");

            // Only save if we are actually inside a game mode (connectTheDots.html)
            if (activeGameMode && temp=='connectTheDots') {

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