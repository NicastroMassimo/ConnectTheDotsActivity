define(["sugar-web/graphics/palette", "text!shapepalette.html"], function(palette, template) {
    var shapepalette = {};

    shapepalette.ShapePalette = function(invoker, primaryText) {
        palette.Palette.call(this, invoker, primaryText);

        var containerElem = document.createElement('div');
        containerElem.innerHTML = template;
        this.setContent([containerElem]);

        // Create our custom event
        this.shapeClickEvent = document.createEvent('CustomEvent');
        this.shapeClickEvent.initCustomEvent('shapeClick', true, true, { shape: 'apple' });

        var that = this;

        // Bind clicks to each item in the HTML template
        containerElem.querySelector("#item-apple").addEventListener('click', function() {
            that.shapeClickEvent.shape = 'apple';
            that.getPalette().dispatchEvent(that.shapeClickEvent);
            that.popDown(); // Close the menu
        });

        containerElem.querySelector("#item-house").addEventListener('click', function() {
            that.shapeClickEvent.shape = 'house';
            that.getPalette().dispatchEvent(that.shapeClickEvent);
            that.popDown();
        });

        containerElem.querySelector("#item-star").addEventListener('click', function() {
            that.shapeClickEvent.shape = 'star';
            that.getPalette().dispatchEvent(that.shapeClickEvent);
            that.popDown();
        });
    };

    var addEventListener = function(type, listener, useCapture) {
        return this.getPalette().addEventListener(type, listener, useCapture);
    };

    shapepalette.ShapePalette.prototype = Object.create(palette.Palette.prototype, {
        addEventListener: {
            value: addEventListener,
            enumerable: true,
            configurable: true,
            writable: true
        }
    });

    return shapepalette;
});