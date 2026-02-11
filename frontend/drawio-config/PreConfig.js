/**
 * DrawIO PreConfig.js — loaded automatically by the self-hosted DrawIO editor.
 *
 * Adds an "Insert Fact Sheet" item to the right-click context menu.
 * When clicked it posts a message to the parent window (our React app)
 * which opens a picker dialog and merges the selected shape back.
 */

/* global Draw, mxResources, mxEvent, mxPopupMenu */

Draw.loadPlugin(function (ui) {
  // Wait until the editor is fully initialised
  var graph = ui.editor.graph;

  // Patch the popup-menu factory so we can append our custom item
  var origFactory = ui.menus.createPopupMenu;
  ui.menus.createPopupMenu = function (menu, cell, evt) {
    // Call the original factory first so all default items are added
    origFactory.apply(this, arguments);

    menu.addSeparator();

    // Compute the graph-space coordinates of the click so we can position
    // the inserted shape exactly where the user right-clicked.
    var pt = mxEvent.getClientXY
      ? new (graph.container.ownerDocument.defaultView || window).DOMPoint(
          mxEvent.getClientX(evt),
          mxEvent.getClientY(evt)
        )
      : { x: mxEvent.getClientX(evt), y: mxEvent.getClientY(evt) };

    var offset = graph.container.getBoundingClientRect();
    var s = graph.view.scale;
    var tr = graph.view.translate;

    var graphX = Math.round((pt.x - offset.left) / s - tr.x);
    var graphY = Math.round((pt.y - offset.top) / s - tr.y);

    menu.addItem("Insert Fact Sheet\u2026", null, function () {
      window.parent.postMessage(
        JSON.stringify({
          event: "insertFactSheet",
          x: graphX,
          y: graphY,
        }),
        "*"
      );
    });
  };
});
