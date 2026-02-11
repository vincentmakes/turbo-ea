/**
 * DrawIO PreConfig.js — loaded automatically by the self-hosted DrawIO editor.
 *
 * Two responsibilities:
 * 1. Adds "Insert Fact Sheet…" to the right-click context menu.
 *    Clicking it posts a message to the parent so it can open a picker dialog.
 *
 * 2. Listens for "insertFactSheetCell" messages from the parent and uses the
 *    mxGraph API directly to insert a vertex.  This avoids the XML merge
 *    action which has issues with root-cell conflicts (duplicate id="0"/"1"
 *    replaces the graph, missing them drops the cell).
 */

/* global Draw, mxEvent, mxCell, mxGeometry */

Draw.loadPlugin(function (ui) {
  var graph = ui.editor.graph;

  // ── 1. Right-click context menu item ──────────────────────────────────
  var origFactory = ui.menus.createPopupMenu;
  ui.menus.createPopupMenu = function (menu, cell, evt) {
    origFactory.apply(this, arguments);

    menu.addSeparator();

    // Convert screen coordinates → graph-space coordinates
    var offset = graph.container.getBoundingClientRect();
    var s = graph.view.scale;
    var tr = graph.view.translate;
    var graphX = Math.round(
      (mxEvent.getClientX(evt) - offset.left) / s - tr.x
    );
    var graphY = Math.round(
      (mxEvent.getClientY(evt) - offset.top) / s - tr.y
    );

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

  // ── 2. Handle "insertFactSheetCell" from the parent ───────────────────
  window.addEventListener("message", function (evt) {
    if (typeof evt.data !== "string") return;

    var msg;
    try {
      msg = JSON.parse(evt.data);
    } catch (_) {
      return;
    }
    if (msg.action !== "insertFactSheetCell") return;

    var model = graph.getModel();
    var parent = graph.getDefaultParent();

    // Build an <object> element to hold custom attributes (factSheetId etc.)
    var doc = graph.domNode
      ? graph.domNode.ownerDocument
      : document;
    var obj = doc.createElement("object");
    obj.setAttribute("label", msg.label || "");
    obj.setAttribute("factSheetId", msg.factSheetId || "");
    obj.setAttribute("factSheetType", msg.factSheetType || "");

    model.beginUpdate();
    try {
      graph.insertVertex(
        parent,
        msg.cellId || null,
        obj,
        msg.x || 0,
        msg.y || 0,
        msg.width || 180,
        msg.height || 60,
        msg.style || ""
      );
    } finally {
      model.endUpdate();
    }
  });
});
