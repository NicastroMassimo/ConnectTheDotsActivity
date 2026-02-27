define(["sugar-web/activity/activity", "sugar-web/env", "sugar-web/graphics/icon", "l10n",
"sugar-web/graphics/presencepalette", "sugar-web/datastore","sugar-web/graphics/journalchooser","pawnpalette",
"tutorial"],
function (activity, env, icon, l10n, presencepalette, datastore, journalchooser, pawnpalette, tutorial) {

	// Manipulate the DOM only when it is ready.
	requirejs(['domReady!'], function (doc) {

		// Initialize the activity.
		activity.setup();

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
