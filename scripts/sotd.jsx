/**
 * sotd.jsx — builds the "symphony of the day" overlay in After Effects.
 *
 * Everything on both cards is bound by expression to one JSON file per work
 * (data/works/<slug>.json, written by scripts/prepare_work.py), so a card comp
 * can be duplicated by hand and repointed at another work by editing a single
 * layer. Nothing is baked in.
 *
 * Load and use from the MCP connector:
 *
 *     $.evalFile(new File("<repo>/scripts/sotd.jsx"));
 *     SOTD.buildWork("mozart-linz");
 *
 * The map is a separate, slower path because geolayers3.draw is asynchronous:
 *
 *     SOTD.mapDraw("mozart-linz");     // starts the draw, returns immediately
 *     SOTD.mapStatus();                // poll in a LATER call until called:true
 *     SOTD.mapFinish("mozart-linz");   // restyle + aim at the city
 *     SOTD.mapFinalize();              // full-resolution tiles, last of all
 *     SOTD.freezeMapRender("mozart-linz");   // bake the map to a still, and
 *     SOTD.freezeMapAttach("mozart-linz");   // ...attach it in a LATER call
 *
 * Verified against After Effects 26.0x67 / GEOlayers 3 1.18.1.
 */

var SOTD = (function () {

    // ---------------------------------------------------------------- config

    var CFG = {
        root: "C:/Users/mlorenzon/Desktop/random/symphony of the day",

        reel:   { w: 1080, h: 1920, fps: 25, dur: 30 },
        card:   { w: 440,  h: 616 },          // 5:7, standard collector-card ratio
        // Card chrome: a dark ring, and a cream hairline just inside it. The
        // hairline is what makes the thing read as a collector card rather than
        // a poster — it crosses the art, so the picture sits in a window.
        frame:  { edge: 7, round: 20, inner: 11, innerWeight: 1.5, pad: 14 },
        // Every work currently built. api.buildAll() walks this.
        works: ["mozart-linz", "brahms-no-4", "shostakovich-leningrad"],

        mapcomp: "Europe",
        mapcompContainer: "containing Europe",

        // GEOlayers' global tile cache. The only honest witness to whether a
        // finalize downloaded anything — see api.mapFinalizeStatus.
        // Matches preferences.json -> tilesPath.
        tilesPath: Folder.userData.fsName + "/aescripts/GEOlayers3/tiles",

        // Bands down each face, top to bottom, in card pixels. They tile the
        // interior exactly (588 px), so changing one height moves everything
        // below it and nothing has to be re-measured by hand.
        front: { strap: 78, portrait: 262, rule: 5, stats: 70, title: 124, life: 44 },
        back:  { strap: 76, region: 38, rule: 5, map: 214, slab: 250 },

        // The three stats under the portrait, top-trumps style. Columns are
        // weighted, not thirds: at a size anyone can read, "NATIONALITY" is
        // twice the word "ERA" is and an equal third clips it.
        stats: [
            // Widths measured off the real fonts, not estimated: the widest
            // value each column must hold ("Romantic", "1941", "Austrian") and
            // the widest label ("NATIONALITY"), plus headroom, because AE wraps
            // box text on advance width and sourceRectAtTime reports ink width.
            { label: "ERA",         w: 0.36 },
            { label: "YEAR",        w: 0.22 },
            { label: "NATIONALITY", w: 0.42 }
        ],

        // Type sizes in card pixels, all in one block because this is what gets
        // tuned. One card pixel is about 0.63 phone pixels at CFG.overlay.scale,
        // so nothing here goes below 18 and the lines that have to carry the
        // reel — surname, place, title — sit at 40+.
        type: {
            given:     20,   // given names, above the surname
            surname:   46,   // the loudest thing on card 1
            number:    84,
            numLabel:  22,
            statLabel: 18,
            statValue: 30,
            title:     40,
            life:      28,
            place:     46,   // the loudest thing on card 2
            region:    24,
            slabLabel: 18,
            body:      26    // occasion and listen-out-for
        },

        font: {
            serif:  "Cambria",
            bold:   "Cambria-Bold",
            italic: "Cambria-Italic",
            // Trajan Pro 3 ships Regular only. Asking for TrajanPro3-Bold does
            // not error — AE resolves it to a placeholder family called
            // "TrajanPro3" and quietly renders a mixed-case substitute, which
            // is obvious only in a render. The surname carries its weight with
            // a drop shadow instead.
            caps:   "TrajanPro3-Regular"
        },

        col: {
            cream:  [0.957, 0.925, 0.863],   // #F4ECDC — every mark on the card
            ink:    [0.078, 0.067, 0.059],   // #14110F — the ring and the occasion slab
            bg:     [0.055, 0.051, 0.047],
            // Used only when a work's period is missing from periods.json.
            // The real palette is the "color" field on each period there.
            period: [0.576, 0.157, 0.137]    // #932823
        },

        // Duotone strength. The map basemap is far lighter than any portrait,
        // so it needs less lifting or the panel goes chalky.
        duotone: { portraitLift: 16, mapLift: 10 },

        // The reveal, and the card-turn sound cued off it. These seed the CTRL
        // sliders AND place the two audio layers, so the sound stays with the
        // picture — but only at build time: AE cannot expression-drive a
        // layer's start time, so retiming a slider means rebuilding.
        //
        // backDelay is deliberately longer than the flip needs. The sound is
        // 550 ms, and at the old 0.14 s stagger the two turns smeared into one
        // noise; at 0.22 s the transients separate and you hear two cards.
        // One card at a time. Card 1 flips in at `start`; at `turnAt` the card
        // turns over and card 2 is on its back. `turnAt` is a placeholder — the
        // whole point is that it moves to fit a voiceover, which is one slider
        // in the reel comp.
        reveal: { start: 0.35, duration: 0.75, turnAt: 8, turnDuration: 0.6 },
        sfx:    { file: "data/audio/card-flip.wav", level: -9, lead: 0.04 },

        // The map move: hold a continent-wide view until the cards have
        // landed, then fall in on the city over `dur` seconds and settle.
        // Where the single card sits, and how big. One card instead of two
        // buys a lot of size, which is the point — everything on it has to be
        // legible on a phone.
        overlay: { y: 1112, scale: 175, videoBottom: 560 },

        map: {
            dur:        5,      // seconds of travel
            // How long after card 2 lands before the map starts moving. In the
            // CARD BACK comp's OWN time — see zoomStart().
            lead:       0.25,
            startSpan:  30,     // half-span in degrees at the continent end
            edgeMargin: 2,      // keep the widest view this far inside the clip
            // >1 spends the travel early and creeps the last of it, so the
            // move decelerates hard into the city rather than arriving at speed.
            easePower:  2.2,
            samples:    60,     // MapPivot keyframes written across the move
            tail:       0.4,    // extra baked frames, so the settle is not clipped
            pinFade:    1.2     // the pin fades up over the end of the move
        },

        folders: {
            root:   "SOTD",
            works:  "SOTD/Works",
            data:   "SOTD/Data",
            assets: "SOTD/Assets"
        }
    };

    // ---------------------------------------------------------------- layout

    /** Everything on a card lives inside the frame, never under it. */
    var I = { x: CFG.frame.pad, y: CFG.frame.pad,
              w: CFG.card.w - CFG.frame.pad * 2,
              h: CFG.card.h - CFG.frame.pad * 2 };

    /**
     * Stack named bands down the interior. Each gets {y, h, mid}. `_end` is
     * where the stack finished, which should be the bottom of the interior —
     * if it is not, the heights in CFG no longer tile and something will
     * silently hang off the card.
     */
    function bands(spec) {
        var out = {}, y = I.y;
        for (var i = 0; i < spec.length; i += 2) {
            out[spec[i]] = { y: y, h: spec[i + 1], mid: y + spec[i + 1] / 2 };
            y += spec[i + 1];
        }
        out._end = y;
        out._fits = (y === I.y + I.h);
        return out;
    }

    var FB = bands(["strap",    CFG.front.strap,
                    "portrait", CFG.front.portrait,
                    "ruleA",    CFG.front.rule,
                    "stats",    CFG.front.stats,
                    "ruleB",    CFG.front.rule,
                    "title",    CFG.front.title,
                    "life",     CFG.front.life]);

    var BB = bands(["strap",  CFG.back.strap,
                    "region", CFG.back.region,
                    "ruleA",  CFG.back.rule,
                    "map",    CFG.back.map,
                    "ruleB",  CFG.back.rule,
                    "slab",   CFG.back.slab]);

    // The two picture panels are bands like any other; the sub-comps are built
    // at exactly these sizes, so a band height change re-renders them to match.
    CFG.portraitPanel = { x: I.x, y: FB.portrait.y, w: I.w, h: FB.portrait.h };
    CFG.mapPanel      = { x: I.x, y: BB.map.y,      w: I.w, h: BB.map.h };

    // --------------------------------------------------------------- helpers

    function q(s) {                       // quote a string for embedding in an expression
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    function parseJSON(s) {
        if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(s);
        return eval("(" + s + ")");
    }

    function readJSONFile(path) {
        var f = new File(path);
        if (!f.exists) throw new Error("Missing file: " + path);
        f.encoding = "UTF-8";
        f.open("r");
        var s = f.read();
        f.close();
        return parseJSON(s);
    }

    function findItem(name, klass) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it.name === name && (!klass || it instanceof klass)) return it;
        }
        return null;
    }

    function removeItem(name) {
        var it = findItem(name);
        while (it) { it.remove(); it = findItem(name); }
    }

    /** Get or create a nested project folder, e.g. folder("SOTD/Works"). */
    function folder(path) {
        var parts = path.split("/");
        var parent = app.project.rootFolder;
        for (var i = 0; i < parts.length; i++) {
            var found = null;
            for (var k = 1; k <= parent.numItems; k++) {
                var it = parent.item(k);
                if (it instanceof FolderItem && it.name === parts[i]) { found = it; break; }
            }
            if (!found) {
                found = app.project.items.addFolder(parts[i]);
                found.parentFolder = parent;
            }
            parent = found;
        }
        return parent;
    }

    function importFileAs(path, name, intoFolder) {
        var f = new File(path);
        if (!f.exists) return null;
        var existing = findItem(name);
        if (existing && existing instanceof FootageItem) {
            // Same file already in the project: just pull fresh bytes off disk.
            try {
                if (existing.mainSource && existing.mainSource.reload) {
                    existing.mainSource.reload();
                    return existing;
                }
            } catch (e) {}
            existing.remove();
        }
        var item = app.project.importFile(new ImportOptions(f));
        item.name = name;
        if (intoFolder) item.parentFolder = intoFolder;
        return item;
    }

    function makeComp(name, w, h, dur, intoFolder) {
        removeItem(name);
        var c = app.project.items.addComp(name, w, h, 1, dur, CFG.reel.fps);
        if (intoFolder) c.parentFolder = intoFolder;
        return c;
    }

    function slider(layer, name, value) {
        var e = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        e.name = name;
        e.property("ADBE Slider Control-0001").setValue(value);
        return e;
    }

    /**
     * Box text. Positioned by its top-left corner: AE centres the text box on
     * the layer position, and boxTextPos is always [-w/2, -h/2], so the
     * conversion is exact rather than measured.
     */
    function addText(comp, o) {
        var w = o.box[0], h = o.box[1];
        var L = comp.layers.addBoxText([w, h], o.text || " ");
        L.name = o.name;
        var P = L.property("ADBE Text Properties").property("ADBE Text Document");
        var td = P.value;
        td.font = o.font;
        td.fontSize = o.size;
        td.applyFill = true;
        td.fillColor = o.color;
        td.applyStroke = false;
        td.tracking = (o.tracking === undefined) ? 0 : o.tracking;
        if (o.leading) { td.autoLeading = false; td.leading = o.leading; }
        td.justification = o.justify || ParagraphJustification.LEFT_JUSTIFY;
        td.boxTextSize = [w, h];
        P.setValue(td);
        L.position.setValue([o.topLeft[0] + w / 2, o.topLeft[1] + h / 2]);
        if (o.expr) P.expression = o.expr;
        // Box text is top-aligned, so a two-line title in a box sized for four
        // hangs high and leaves a hole. Re-centre on the measured text bounds
        // instead, which keeps any length optically centred in its band.
        if (o.centerY !== undefined) {
            L.property("ADBE Transform Group").property("ADBE Position").expression =
                'var r = thisLayer.sourceRectAtTime(time, false);\n' +
                '[' + (o.topLeft[0] + w / 2) + ', ' + o.centerY + ' - (r.top + r.height / 2)];';
        }
        return L;
    }

    /**
     * Rounded rectangle as a shape layer. Stroke is added BEFORE the fill:
     * addProperty appends to the bottom of the contents list, and lower items
     * paint first, so a stroke added after a fill would sit behind it.
     */
    function addRect(comp, o) {
        var L = comp.layers.addShape();
        L.name = o.name;
        var grp = L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        grp.name = "rect";
        var vs = grp.property("ADBE Vectors Group");
        var r = vs.addProperty("ADBE Vector Shape - Rect");
        r.property("ADBE Vector Rect Size").setValue(o.size);
        r.property("ADBE Vector Rect Position").setValue([0, 0]);
        if (o.round) r.property("ADBE Vector Rect Roundness").setValue(o.round);
        if (o.stroke) {
            var st = vs.addProperty("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(o.stroke.concat([1]).slice(0, 4));
            st.property("ADBE Vector Stroke Width").setValue(o.strokeWidth || 1);
            if (o.strokeOpacity !== undefined)
                st.property("ADBE Vector Stroke Opacity").setValue(o.strokeOpacity);
        }
        if (o.fill || o.fillExpr) {
            var fl = vs.addProperty("ADBE Vector Graphic - Fill");
            if (o.fill)
                fl.property("ADBE Vector Fill Color").setValue(o.fill.concat([1]).slice(0, 4));
            if (o.fillExpr)
                fl.property("ADBE Vector Fill Color").expression = o.fillExpr;
            if (o.fillOpacity !== undefined)
                fl.property("ADBE Vector Fill Opacity").setValue(o.fillOpacity);
        }
        L.position.setValue([o.topLeft[0] + o.size[0] / 2, o.topLeft[1] + o.size[1] / 2]);
        if (o.blend) L.blendingMode = o.blend;
        if (o.opacity !== undefined)
            L.property("ADBE Transform Group").property("ADBE Opacity").setValue(o.opacity);
        return L;
    }

    function addEllipse(comp, o) {
        var L = comp.layers.addShape();
        L.name = o.name;
        var grp = L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        var vs = grp.property("ADBE Vectors Group");
        var e = vs.addProperty("ADBE Vector Shape - Ellipse");
        e.property("ADBE Vector Ellipse Size").setValue(o.size);
        e.property("ADBE Vector Ellipse Position").setValue([0, 0]);
        if (o.stroke) {
            var st = vs.addProperty("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(o.stroke.concat([1]).slice(0, 4));
            st.property("ADBE Vector Stroke Width").setValue(o.strokeWidth || 1);
        }
        if (o.fill) {
            var fl = vs.addProperty("ADBE Vector Graphic - Fill");
            fl.property("ADBE Vector Fill Color").setValue(o.fill.concat([1]).slice(0, 4));
        }
        L.position.setValue(o.center);
        return L;
    }

    // ------------------------------------------------------ data expressions

    /**
     * Every card layer reaches its data the same way: read the JSON footage
     * NAME out of the card's own "DATA" layer, then read the parsed JSON off
     * that footage. Duplicating a card and editing that one layer repoints the
     * whole card at a different work.
     */
    function bindPrelude() {
        return 'var D = null;\n' +
               'try { D = footage(thisComp.layer("DATA").text.sourceText.toString()).sourceData; } catch (e) {}\n';
    }

    /** Expression returning a plain string from the work JSON. */
    function bindStr(body, fallback) {
        return bindPrelude() +
               'var r = ' + q(fallback || "") + ';\n' +
               'try { var v = (' + body + '); if (v !== null && v !== undefined && v !== "") r = v; } catch (e) {}\n' +
               'r.toString();';
    }

    /**
     * Expression returning text at a size that steps down as the text grows,
     * so long titles stay inside the box.
     *
     * Uses text.sourceText.style — mutating `value` (value.text = ...) is
     * silently ignored by AE and leaves the seed text in place.
     */
    function bindFitted(body, fallback, steps) {
        var s = bindPrelude() +
                'var t = ' + q(fallback || "") + ';\n' +
                'try { var v = (' + body + '); if (v !== null && v !== undefined) t = v; } catch (e) {}\n' +
                't = t.toString();\n' +
                // Glue "No. 36", "K. 425", "Op. 98" with a non-breaking space,
                // so a wrap never orphans the number from its abbreviation.
                't = t.replace(/\\. (\\d)/g, ".\\u00A0$1");\n' +
                'var size = ' + steps[0].size + ';\n';
        for (var i = 1; i < steps.length; i++) {
            s += 'if (t.length > ' + steps[i].over + ') size = ' + steps[i].size + ';\n';
        }
        // Leading has to follow the size down, or shrunk text keeps the loose
        // line spacing that was set for the largest step.
        return s +
            'var st = text.sourceText.style.setText(t).setFontSize(size);\n' +
            'if (st.setLeading) st = st.setLeading(size * ' + (steps[0].leading || 1.2) + ');\n' +
            'st;';
    }

    /**
     * Expression returning this work's period colour as [r, g, b, 1].
     *
     * The card IS its period colour on this design, so the colour is data like
     * everything else: periods.json carries a "color" hex per period and the
     * work JSON names one. Adding a fifth period is a JSON edit, not a code
     * edit. Any comp using this needs a DATA layer — the sub-comps have one
     * too, so their duotone follows the work.
     */
    function periodColorExpr() {
        return bindPrelude() +
               'var C = [' + CFG.col.period.join(", ") + '];\n' +
               'try {\n' +
               '  var T = footage("periods.json").sourceData.periods;\n' +
               '  var k = D.period.toString().toLowerCase();\n' +
               '  for (var i = 0; i < T.length; i++) {\n' +
               '    if (T[i].name.toString().toLowerCase() === k && T[i].color) {\n' +
               '      var x = T[i].color.replace("#", "");\n' +
               '      C = [parseInt(x.substr(0, 2), 16) / 255,\n' +
               '           parseInt(x.substr(2, 2), 16) / 255,\n' +
               '           parseInt(x.substr(4, 2), 16) / 255];\n' +
               '      break;\n' +
               '    }\n' +
               '  }\n' +
               '} catch (e) {}\n' +
               'C.concat([1]);';
    }

    // ------------------------------------------------------------- sub-comps

    /**
     * Strip the source to greyscale so the duotone below can recolour it.
     * Black & White is the right effect and is what the design specifies;
     * Hue/Saturation is the fallback if this install spells it differently.
     */
    function desaturate(L) {
        var fx = L.property("ADBE Effect Parade");
        var ok = false;
        try { fx.addProperty("ADBE Black&White"); ok = true; } catch (e) {}
        if (!ok) {
            try {
                fx.addProperty("ADBE HUE SATURATION")
                  .property("ADBE HUE SATURATION-0003").setValue(-100);
            } catch (e2) {}
        }
        try {
            var bc = fx.addProperty("ADBE Brightness & Contrast 2");
            bc.property("ADBE Brightness & Contrast 2-0001").setValue(6);
            bc.property("ADBE Brightness & Contrast 2-0002").setValue(10);
        } catch (e3) {}
    }

    /**
     * The duotone itself: the period colour multiplied over the greyscale, then
     * a cream screen to lift the blacks back off the floor. Two shape layers,
     * both cheap, and the colour is bound to the work rather than baked.
     */
    function duotone(c, lift) {
        addRect(c, {
            name: "DUOTONE colour", topLeft: [0, 0], size: [c.width, c.height],
            fillExpr: periodColorExpr(), blend: BlendingMode.MULTIPLY
        });
        addRect(c, {
            name: "DUOTONE lift", topLeft: [0, 0], size: [c.width, c.height],
            fill: CFG.col.cream, blend: BlendingMode.SCREEN, opacity: lift
        });
    }

    function buildPortraitComp(slug, work, assetsFolder) {
        var p = CFG.portraitPanel;
        var c = makeComp("PORTRAIT · " + slug, p.w, p.h, CFG.reel.dur, assetsFolder);

        var imgPath = work.composer.portrait
            ? CFG.root + "/" + work.composer.portrait
            : "";
        var img = imgPath ? importFileAs(imgPath, "portrait-" + slug, assetsFolder) : null;

        if (img) {
            var L = c.layers.add(img);
            L.name = "PORTRAIT";
            slider(L, "Framing Y", 0);
            L.property("ADBE Transform Group").property("ADBE Scale").expression =
                'var s = Math.max(thisComp.width / width, thisComp.height / height) * 100;\n[s, s];';
            // The panel is much wider than it is tall, so a centred crop cuts
            // foreheads off. Sit the crop window 20% down the source instead —
            // heads are near the top of a portrait — and keep the slider as a
            // nudge on top of that.
            L.property("ADBE Transform Group").property("ADBE Position").expression =
                'var s = Math.max(thisComp.width / width, thisComp.height / height);\n' +
                'var over = height * s - thisComp.height;\n' +
                '[thisComp.width / 2,\n' +
                ' thisComp.height / 2 + over * 0.3 + effect("Framing Y")("Slider")];';
            desaturate(L);
        } else {
            c.layers.addSolid(CFG.col.ink, "NO PORTRAIT", p.w, p.h, 1, CFG.reel.dur);
            addText(c, {
                name: "INITIALS", box: [p.w, 120], topLeft: [0, p.h / 2 - 60],
                font: CFG.font.caps, size: 84, color: CFG.col.cream, tracking: 60,
                justify: ParagraphJustification.CENTER_JUSTIFY, text: "?",
                centerY: p.h / 2,
                expr: bindStr('D.composer.name.split(" ").pop().substr(0,1)', "?")
            }).property("ADBE Transform Group").property("ADBE Opacity").setValue(35);
        }

        duotone(c, CFG.duotone.portraitLift);
        addDataLayer(c, slug);
        return c;
    }

    function buildMapComp(slug, work, assetsFolder) {
        var p = CFG.mapPanel;
        var c = makeComp("MAP · " + slug, p.w, p.h, CFG.reel.dur, assetsFolder);

        // A bake wins over the live mapcomp, so rebuilding a finished work does
        // not silently re-attach it to whatever the map shows today. An
        // animated sequence wins over a single still. Delete data/maps/<slug>/
        // and <slug>.png to go back to the live map.
        var seq = mapSeqFirst(slug);
        var still = new File(mapStillPath(slug));
        if (seq || still.exists) {
            var item = seq ? importSequence(slug)
                           : importFileAs(mapStillPath(slug), "map-" + slug + ".png",
                                          assetsFolder);
            if (item) {
                var fl = attachBakedMap(c, item, !!seq);
                desaturate(fl);
                duotone(c, CFG.duotone.mapLift);
                addMapPin(c, p);
                addDataLayer(c, slug);
                return c;
            }
        }

        var src = findItem(CFG.mapcompContainer, CompItem);
        if (src) {
            var L = c.layers.add(src);
            L.name = "MAP";
            L.property("ADBE Transform Group").property("ADBE Scale").expression =
                'var s = Math.max(thisComp.width / width, thisComp.height / height) * 100;\n[s, s];';
            L.property("ADBE Transform Group").property("ADBE Position")
                .setValue([p.w / 2, p.h / 2]);
            desaturate(L);
        } else {
            c.layers.addSolid(CFG.col.ink, "NO MAPCOMP FOUND", p.w, p.h, 1, CFG.reel.dur);
        }

        // Duotone first, then the pin: the pin sits on top of the tint so it
        // stays cream against whatever colour the period gives the map.
        duotone(c, CFG.duotone.mapLift);
        // The mapcomp is aimed at a bbox centred on the city, so the city is
        // exactly at the centre of the frame and the pin needs no maths.
        addMapPin(c, p);
        addDataLayer(c, slug);
        return c;
    }

    /**
     * The mapcomp is always aimed at a bbox centred on the city, so the city
     * lands exactly at the centre of frame and the pin needs no projection maths.
     * Built back to front: each new layer lands on top of the last.
     */
    function addMapPin(c, p) {
        // The map arrives moving, so the pin waits for it: it fades up over the
        // end of the zoom and is fully there as the view settles on the city.
        var fade = 'ease(time, ' + (zoomEnd() - CFG.map.pinFade) + ', ' +
                   zoomEnd() + ', 0, %d);';

        // Dark halo under a cream ring: the duotoned map runs light in places
        // and dark in others, so the pin carries its own contrast either way.
        var halo = addEllipse(c, {
            name: "PIN halo", center: [p.w / 2, p.h / 2], size: [34, 34],
            fill: CFG.col.ink
        });
        var ring = addEllipse(c, {
            name: "PIN ring", center: [p.w / 2, p.h / 2], size: [22, 22],
            stroke: CFG.col.cream, strokeWidth: 3
        });
        var dot = addEllipse(c, {
            name: "PIN dot", center: [p.w / 2, p.h / 2], size: [8, 8],
            fill: CFG.col.cream
        });
        var pins = [[halo, 50], [ring, 100], [dot, 100]];
        for (var i = 0; i < pins.length; i++)
            pins[i][0].property("ADBE Transform Group").property("ADBE Opacity")
                .expression = fade.replace("%d", pins[i][1]);
    }

    // ----------------------------------------------------------- card: front

    /**
     * The card's ground: the period colour, edge to edge. Everything else is
     * drawn on top of it, and the art bleeds right into the corners, so this is
     * the first layer on either face.
     */
    function cardGround(c) {
        addRect(c, {
            name: "CARD ground", topLeft: [0, 0],
            size: [CFG.card.w, CFG.card.h], round: CFG.frame.round,
            fillExpr: periodColorExpr()
        });
    }

    /**
     * The dark ring, drawn LAST so it clips the full-bleed art into the card
     * shape. Two layers, because AE rounds a rectangle but does not clip to one:
     *
     *  - a stroke centred on a path inset by half its width, which covers
     *    exactly the outer `edge` pixels and rounds the inner corners with it;
     *  - the four square nubs that rounded outline leaves in the comp's corners
     *    — one shape holding a plain rect and a rounded rect with an even-odd
     *    fill, so the overlap cancels and only the nubs are painted.
     */
    function cardChrome(c) {
        var w = CFG.card.w, h = CFG.card.h, E = CFG.frame.edge, R = CFG.frame.round;
        var N = CFG.frame.inner;

        // The hairline runs over the art, not around it, so the picture reads
        // as a window in the card rather than a panel stuck on top.
        addRect(c, {
            name: "CARD hairline", topLeft: [N, N], size: [w - N * 2, h - N * 2],
            round: R - N, stroke: CFG.col.cream, strokeWidth: CFG.frame.innerWeight,
            strokeOpacity: 55
        });

        addRect(c, {
            name: "CARD border", topLeft: [E / 2, E / 2],
            size: [w - E, h - E], round: R - E / 2,
            stroke: CFG.col.ink, strokeWidth: E
        });

        var L = c.layers.addShape();
        L.name = "CARD corners";
        L.position.setValue([w / 2, h / 2]);
        var vs = L.property("ADBE Root Vectors Group")
                  .addProperty("ADBE Vector Group")
                  .property("ADBE Vectors Group");
        vs.addProperty("ADBE Vector Shape - Rect")
          .property("ADBE Vector Rect Size").setValue([w, h]);
        var round = vs.addProperty("ADBE Vector Shape - Rect");
        round.property("ADBE Vector Rect Size").setValue([w, h]);
        round.property("ADBE Vector Rect Roundness").setValue(R);
        var fl = vs.addProperty("ADBE Vector Graphic - Fill");
        fl.property("ADBE Vector Fill Rule").setValue(2);          // even-odd
        fl.property("ADBE Vector Fill Color").setValue(CFG.col.ink.concat([1]));
    }

    /** Everything on this design is cream on the period colour. */
    function poster(o) {
        o.color = CFG.col.cream;
        return o;
    }

    /** Opacity as a flat percentage, for the secondary lines. */
    function fade(layer, pct) {
        layer.property("ADBE Transform Group").property("ADBE Opacity").setValue(pct);
        return layer;
    }

    /**
     * The strap across the top of a card, and the loudest thing on it.
     *
     * Card 1 needs two runs, not one: "WOLFGANG AMADEUS MOZART" on a single
     * line can only be about 25 px before it runs out of card, which is
     * invisible on a phone. Split off the given names small and the surname
     * gets to be 46 px — and the surname is what a viewer actually reads.
     */
    function cardStrap(c, band, runs) {
        addRect(c, {
            name: "STRAP plate", topLeft: [I.x, band.y],
            size: [I.w, band.h], fill: CFG.col.ink
        });
        for (var i = 0; i < runs.length; i++) {
            var r = runs[i];
            var L = addText(c, poster({
                name: r.name, box: [I.w - 20, r.size + 14],
                topLeft: [I.x + 10, r.centreY - (r.size + 14) / 2],
                font: CFG.font.caps, size: r.size, tracking: r.tracking,
                centerY: r.centreY,
                justify: ParagraphJustification.CENTER_JUSTIFY, text: r.text,
                expr: bindFitted(r.body, "", r.steps)
            }));
            if (r.opacity !== undefined) fade(L, r.opacity);
        }
    }

    /**
     * The stat row under the portrait.
     *
     * Columns are weighted rather than equal thirds — see CFG.stats. The label
     * and value are centred as one unit slightly above the band's geometric
     * middle, which is where a two-line block of mixed weight actually looks
     * centred; sitting them on the true middle reads as low.
     */
    function statRow(c, cells) {
        var B = FB.stats, T = CFG.type;
        var x = I.x;
        for (var i = 0; i < CFG.stats.length; i++) {
            var col = CFG.stats[i], w = I.w * col.w;

            // Hairlines between the cells, not boxes around them: three boxes
            // read as three buttons once the card is phone-sized.
            if (i > 0) {
                addRect(c, {
                    name: "STAT divider " + i, topLeft: [x - 1, B.y + 10],
                    size: [2, B.h - 20], fill: CFG.col.cream, fillOpacity: 45
                });
            }
            fade(addText(c, poster({
                name: "STAT " + col.label + " label", box: [w - 8, 24],
                topLeft: [x + 4, B.y + 7],
                font: CFG.font.caps, size: T.statLabel, tracking: 50,
                centerY: B.y + 19,
                justify: ParagraphJustification.CENTER_JUSTIFY, text: col.label
            })), 88);
            addText(c, poster({
                name: "STAT " + col.label, box: [w - 8, 40],
                topLeft: [x + 4, B.y + 23],
                font: CFG.font.bold, size: T.statValue, centerY: B.y + 43,
                justify: ParagraphJustification.CENTER_JUSTIFY, text: cells[i].text,
                expr: bindFitted(cells[i].body, "", cells[i].steps || [
                    { size: T.statValue }, { over: 11, size: 26 }, { over: 15, size: 22 }
                ])
            }));
            x += w;
        }
    }

    function buildCardFront(slug, portraitComp, worksFolder) {
        var c = makeComp("CARD FRONT · " + slug, CFG.card.w, CFG.card.h,
                         CFG.reel.dur, worksFolder);
        var p = CFG.portraitPanel, T = CFG.type;

        cardGround(c);

        var pl = c.layers.add(portraitComp);
        pl.name = "PORTRAIT";
        pl.property("ADBE Transform Group").property("ADBE Position")
            .setValue([p.x + p.w / 2, p.y + p.h / 2]);

        // The set number, stamped over the art where a card's HP would go. Two
        // runs, because one AE text layer is one style.
        var numRight = I.x + I.w - 14;
        var num = addText(c, poster({
            name: "NUMBER value", box: [230, 106], topLeft: [numRight - 230, p.y + 4],
            font: CFG.font.bold, size: T.number, leading: T.number * 0.9,
            centerY: p.y + 52,
            justify: ParagraphJustification.RIGHT_JUSTIFY, text: "36",
            expr: bindStr('D.number.toString().replace(/^\\s*(No|Nº|Nr)\\.?\\s*/i, "")', "")
        }));
        var lab = addText(c, poster({
            name: "NUMBER label", box: [90, 32], topLeft: [numRight - 320, p.y + 12],
            font: CFG.font.caps, size: T.numLabel, tracking: 60,
            justify: ParagraphJustification.RIGHT_JUSTIFY, text: "No."
        }));
        // Ride on the numeral's measured left edge, so "4" and "104" both sit
        // hard against the label with the pair right-aligned to the card.
        lab.property("ADBE Transform Group").property("ADBE Position").expression =
            'var v = thisComp.layer("NUMBER value");\n' +
            'var r = v.sourceRectAtTime(time, false);\n' +
            'var m = thisLayer.sourceRectAtTime(time, false);\n' +
            '[v.transform.position[0] + r.left - 10 - (m.left + m.width),\n' +
            ' ' + (p.y + 28) + ' - (m.top + m.height / 2)];';
        var shadow = [num, lab];
        for (var s = 0; s < shadow.length; s++) {
            var sh = shadow[s].property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sh.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
            sh.property("ADBE Drop Shadow-0002").setValue(150);   // opacity
            sh.property("ADBE Drop Shadow-0004").setValue(4);     // distance
            sh.property("ADBE Drop Shadow-0005").setValue(16);    // softness
        }
        // Both halves hide together when a work has no number at all.
        var hasNum = bindPrelude() +
                     'var v = ""; try { v = D.number; } catch (e) {}\n' +
                     '(v === null || v === undefined || v === "") ? 0 : ';
        num.property("ADBE Transform Group").property("ADBE Opacity").expression = hasNum + '92;';
        lab.property("ADBE Transform Group").property("ADBE Opacity").expression = hasNum + '92;';

        cardStrap(c, FB.strap, [
            { name: "GIVEN NAMES", size: T.given, tracking: 120, centreY: FB.strap.y + 18,
              opacity: 76, text: "GIVEN NAMES",
              body: 'D.composer.name.split(" ").slice(0, -1).join(" ")',
              steps: [{ size: T.given }, { over: 18, size: 17 }] },
            { name: "SURNAME", size: T.surname, tracking: 20, centreY: FB.strap.y + 52,
              text: "SURNAME",
              body: '(D.composer.surname || D.composer.name.split(" ").pop())',
              steps: [{ size: T.surname }, { over: 12, size: 40 },
                      { over: 15, size: 34 }, { over: 19, size: 26 }] }
        ]);

        addRect(c, { name: "RULE above stats", topLeft: [I.x, FB.ruleA.y],
                     size: [I.w, FB.ruleA.h], fill: CFG.col.cream });
        addRect(c, { name: "RULE below stats", topLeft: [I.x, FB.ruleB.y],
                     size: [I.w, FB.ruleB.h], fill: CFG.col.cream });

        statRow(c, [
            { text: "Classical", body: 'D.period' },
            { text: "1783",      body: 'D.composition.year' },
            { text: "Austrian",  body: 'D.composer.nationality',
              steps: [{ size: T.statValue }, { over: 10, size: 24 },
                      { over: 14, size: 20 }] }
        ]);

        addText(c, poster({
            name: "TITLE", box: [I.w - 20, FB.title.h - 12],
            topLeft: [I.x + 10, FB.title.y + 6],
            font: CFG.font.bold, size: T.title, leading: T.title * 1.1,
            centerY: FB.title.mid,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "Title",
            expr: bindFitted('D.title_full', "", [
                { size: T.title, leading: 1.1 }, { over: 34, size: 36 },
                { over: 52, size: 32 }
            ])
        }));
        fade(addText(c, poster({
            // Sits above the band's middle on purpose: centred, it reads as
            // stranded at the bottom edge of the card.
            name: "LIFE", box: [I.w, 38], topLeft: [I.x, FB.life.y - 6],
            font: CFG.font.italic, size: T.life, centerY: FB.life.y + 13,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "dates",
            // The YEAR stat says when; this says how old he was when he wrote
            // it, which is the detail that actually lands on a viewer.
            expr: bindStr('[D.composer.life,' +
                          ' (D.composition.age ? "aged " + D.composition.age : "")]' +
                          '.filter(function (s) { return s; }).join("   ·   ")', "")
        })), 88);

        cardChrome(c);
        addDataLayer(c, slug);
        return c;
    }

    // ------------------------------------------------------------ card: back

    function buildCardBack(slug, mapComp, work, worksFolder) {
        var c = makeComp("CARD BACK · " + slug, CFG.card.w, CFG.card.h,
                         CFG.reel.dur, worksFolder);
        var p = CFG.mapPanel, T = CFG.type;
        var here = !!work.map.has_place;

        cardGround(c);

        // Card 2 is the context card: where, why, and what to listen for. The
        // year and the composer are card 1's job, so the place gets the strap
        // at the same size the surname gets on card 1.
        cardStrap(c, BB.strap, [
            { name: "PLACE", size: T.place, tracking: 20, centreY: BB.strap.mid,
              text: "PLACE", body: 'D.composition.place',
              steps: [{ size: T.place }, { over: 11, size: 40 },
                      { over: 14, size: 34 }, { over: 19, size: 28 }] }
        ]);
        fade(addText(c, poster({
            name: "REGION", box: [I.w - 16, 32], topLeft: [I.x + 8, BB.region.y + 3],
            font: CFG.font.italic, size: T.region, centerY: BB.region.mid,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "region",
            expr: bindFitted('D.composition.country_then', "", [
                { size: T.region }, { over: 26, size: 21 }, { over: 34, size: 18 }
            ])
        })), 88);

        // Cream rules top and bottom rather than a frame: the map bleeds the
        // full interior width, so the only edges it needs are horizontal.
        var rules = [
            addRect(c, { name: "MAP rule top", topLeft: [I.x, BB.ruleA.y],
                         size: [I.w, BB.ruleA.h], fill: CFG.col.cream })
        ];
        var ml = c.layers.add(mapComp);
        ml.name = "MAP";
        ml.property("ADBE Transform Group").property("ADBE Position")
            .setValue([p.x + p.w / 2, p.y + p.h / 2]);
        rules.push(addRect(c, { name: "MAP rule bottom", topLeft: [I.x, BB.ruleB.y],
                                size: [I.w, BB.ruleB.h], fill: CFG.col.cream }));
        ml.enabled = here;
        for (var r = 0; r < rules.length; r++) rules[r].enabled = here;

        buildStorySlab(c);

        cardChrome(c);
        addDataLayer(c, slug);
        return c;
    }

    /**
     * The bottom of card 2: why it was written, and what to listen out for.
     *
     * Both fields are optional, which is four states, and the slab has to look
     * deliberate in all of them. AE cannot reflow a layout — so rather than two
     * stacked blocks that leave a hole when one is missing, the slab is pinned
     * to the bottom of the card and grows to fit what it holds, and each block
     * knows whether the other is there.
     *
     * These two are the only paragraphs on either card, and paragraphs are the
     * first thing to become unreadable when a reel is watched on a phone. They
     * step down to 18 px if they have to, but a string over ~90 characters has
     * already cost itself a size — keep them short.
     */
    function buildStorySlab(c) {
        var S = BB.slab, T = CFG.type;
        var textX = I.x + 14, textW = I.w - 28;
        var dividerY = S.y + 136;
        var hookY = S.y + 152;

        var bottom = S.y + S.h;
        var soloH = 150;
        var soloMid = bottom - soloH / 2;

        var flags = bindPrelude() +
            'function has(v) { return !(v === null || v === undefined || v === ""); }\n' +
            'var occ = false, hook = false;\n' +
            'try { occ = has(D.context); } catch (e) {}\n' +
            'try { hook = has(D.listen_for); } catch (e) {}\n' +
            'var both = occ && hook;\n' +
            'var slabH = both ? ' + S.h + ' : ((occ || hook) ? ' + soloH + ' : 0);\n';

        var slab = addRect(c, {
            name: "STORY slab", topLeft: [I.x, S.y], size: [I.w, S.h],
            fill: CFG.col.ink
        });
        var slabRect = slab.property("ADBE Root Vectors Group").property(1)
                           .property("ADBE Vectors Group").property(1);
        slabRect.property("ADBE Vector Rect Size").expression =
            flags + '[' + I.w + ', slabH];';
        slab.property("ADBE Transform Group").property("ADBE Position").expression =
            flags + '[' + (I.x + I.w / 2) + ', ' + bottom + ' - slabH / 2];';

        /** Centre on the measured text: in its own half if sharing, else in the lot. */
        function centreOn(layer, whenSharing, whenAlone) {
            layer.property("ADBE Transform Group").property("ADBE Position").expression =
                flags +
                'var target = both ? ' + whenSharing + ' : ' + whenAlone + ';\n' +
                'var r = thisLayer.sourceRectAtTime(time, false);\n' +
                '[' + (textX + textW / 2) + ', target - (r.top + r.height / 2)];';
            return layer;
        }
        function showIf(layer, cond, pct) {
            layer.property("ADBE Transform Group").property("ADBE Opacity")
                 .expression = flags + cond + ' ? ' + pct + ' : 0;';
            return layer;
        }

        showIf(centreOn(addText(c, poster({
            name: "OCCASION label", box: [textW, 24], topLeft: [textX, S.y + 6],
            font: CFG.font.caps, size: T.slabLabel, tracking: 200,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "OCCASION",
            expr: bindStr('(D.context ? D.context_label.toUpperCase() : "")', "")
        })), S.y + 18, soloMid - 42), 'occ', 78);

        showIf(centreOn(addText(c, poster({
            name: "OCCASION", box: [textW, 100], topLeft: [textX, S.y + 30],
            font: CFG.font.italic, size: T.body, leading: T.body * 1.24,
            justify: ParagraphJustification.LEFT_JUSTIFY, text: "occasion",
            expr: bindFitted('D.context', "", [
                { size: T.body, leading: 1.24 }, { over: 85, size: 23 },
                { over: 115, size: 20 }, { over: 135, size: 18 }
            ])
        })), S.y + 80, soloMid + 14), 'occ', 100);

        showIf(addRect(c, {
            name: "STORY divider", topLeft: [textX + 40, dividerY],
            size: [textW - 80, 1.5], fill: CFG.col.cream, fillOpacity: 40
        }), 'both', 100);

        // With no occasion above it the hook takes the slab, and its label
        // travels with it — parked at the top it would caption a gap.
        showIf(centreOn(addText(c, poster({
            name: "LISTEN label", box: [textW, 24], topLeft: [textX, hookY],
            font: CFG.font.caps, size: T.slabLabel, tracking: 200,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "LISTEN OUT FOR"
        })), hookY + 12, soloMid - 42), 'hook', 78);

        showIf(centreOn(addText(c, poster({
            name: "LISTEN", box: [textW, 78], topLeft: [textX, hookY + 26],
            font: CFG.font.italic, size: T.body, leading: T.body * 1.24,
            justify: ParagraphJustification.LEFT_JUSTIFY, text: "listen for",
            expr: bindFitted('D.listen_for', "", [
                { size: T.body, leading: 1.24 }, { over: 60, size: 23 },
                { over: 95, size: 20 }
            ])
        })), hookY + 62, soloMid + 14), 'hook', 100);
    }

    /**
     * The one layer that decides which work a comp shows. Both card faces and
     * both asset sub-comps carry one, because the duotone colour is bound to
     * the work too — so repointing a duplicated comp recolours it as well.
     */
    function addDataLayer(c, slug) {
        var L = addText(c, {
            name: "DATA", box: [300, 24], topLeft: [(c.width - 300) / 2, c.height - 20],
            font: CFG.font.serif, size: 12, color: CFG.col.cream,
            justify: ParagraphJustification.CENTER_JUSTIFY,
            text: slug + ".json"
        });
        L.enabled = false;
        L.guideLayer = true;
        L.comment = "Change this text to another work JSON to repoint the whole card.";
        L.moveToBeginning();
        return L;
    }

    // ------------------------------------------------------------- reel comp

    function buildReel(slug, frontComp, backComp, worksFolder) {
        var R = CFG.reel, V = CFG.overlay;
        var c = makeComp("SOTD Reel · " + slug, R.w, R.h, R.dur, worksFolder);
        c.bgColor = CFG.col.bg;

        var bg = c.layers.addSolid(CFG.col.bg, "BG", R.w, R.h, 1, R.dur);
        bg.locked = true;

        var stage = c.layers.addShape();
        stage.name = "STAGE — drop your video here";
        stage.guideLayer = true;
        var sg = stage.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        var svs = sg.property("ADBE Vectors Group");
        var sr = svs.addProperty("ADBE Vector Shape - Rect");
        sr.property("ADBE Vector Rect Size").setValue([R.w - 80, V.videoBottom]);
        var sst = svs.addProperty("ADBE Vector Graphic - Stroke");
        sst.property("ADBE Vector Stroke Color").setValue([0.35, 0.33, 0.30, 1]);
        sst.property("ADBE Vector Stroke Width").setValue(2);
        stage.position.setValue([R.w / 2, V.videoBottom / 2]);

        // A long lens: the card sits well below centre, and a wide default
        // camera shears it badly as it rotates. Position and point of interest
        // both have to be set — addCamera leaves the camera at the comp's
        // top-left corner, which skews everything off-axis.
        var Z = 4600;
        var cam = c.layers.addCamera("CAMERA", [R.w / 2, R.h / 2]);
        var camOpts = cam.property("ADBE Camera Options Group");
        var zoom = camOpts.property("ADBE Camera Zoom") || camOpts.property("Zoom");
        if (zoom) zoom.setValue(Z);
        var camT = cam.property("ADBE Transform Group");
        camT.property("ADBE Anchor Point").setValue([R.w / 2, R.h / 2, 0]);  // point of interest
        camT.property("ADBE Position").setValue([R.w / 2, R.h / 2, -Z]);

        var ctrl = c.layers.addNull(R.dur);
        ctrl.name = "CTRL";
        ctrl.guideLayer = true;
        slider(ctrl, "Reveal Start", CFG.reveal.start);
        slider(ctrl, "Reveal Duration", CFG.reveal.duration);
        slider(ctrl, "Turn At", CFG.reveal.turnAt);
        slider(ctrl, "Turn Duration", CFG.reveal.turnDuration);
        slider(ctrl, "Overlay Y", V.y);
        slider(ctrl, "Overlay Scale", V.scale);

        var rig = c.layers.addNull(R.dur);
        rig.name = "RIG";
        rig.threeDLayer = true;
        rig.guideLayer = true;
        rig.property("ADBE Transform Group").property("ADBE Position").expression =
            'var C = thisComp.layer("CTRL");\n' +
            '[thisComp.width / 2, C.effect("Overlay Y")("Slider"), 0];';
        rig.property("ADBE Transform Group").property("ADBE Scale").expression =
            'var s = thisComp.layer("CTRL").effect("Overlay Scale")("Slider");\n[s, s, s];';

        // Every timing decision in the reel comes out of these four sliders, so
        // matching the cut to a voiceover is dragging one value rather than
        // editing keyframes across two nested comps.
        var clock =
            'var C = thisComp.layer("CTRL");\n' +
            'var t0 = C.effect("Reveal Start")("Slider");\n' +
            'var d0 = Math.max(0.001, C.effect("Reveal Duration")("Slider"));\n' +
            'var tt = C.effect("Turn At")("Slider");\n' +
            'var dt = Math.max(0.001, C.effect("Turn Duration")("Slider"));\n' +
            'var half = tt + dt / 2;\n';

        function placeCard(comp, name) {
            var L = c.layers.add(comp);
            L.name = name;
            L.threeDLayer = true;
            L.parent = rig;
            // Assigning a parent makes AE bake a compensating scale into the
            // child so its world transform does not jump. RIG is already at
            // Overlay Scale by expression, so the card lands at 100/1.75 = 57%
            // and the slider appears to do nothing. Reset it after parenting.
            var CT = L.property("ADBE Transform Group");
            CT.property("ADBE Scale").setValue([100, 100, 100]);
            CT.property("ADBE Position").setValue([0, 0, 0]);
            var sh = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sh.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
            sh.property("ADBE Drop Shadow-0002").setValue(165);   // opacity
            sh.property("ADBE Drop Shadow-0004").setValue(16);    // distance
            sh.property("ADBE Drop Shadow-0005").setValue(32);    // softness
            return L;
        }

        // CARD 1 — the details. Flips in from edge-on, then turns away.
        var one = placeCard(frontComp, "CARD 1 · details");
        var T1 = one.property("ADBE Transform Group");
        T1.property("ADBE Position").expression = clock +
            'var a = ease(time, t0, t0 + d0, 1, 0);\n' +
            '[0, 0, 340 * a];';
        T1.property("ADBE Rotate Y").expression = clock +
            'time < tt ? ease(time, t0, t0 + d0, -84, 0)\n' +
            '          : ease(time, tt, half, 0, 90);';
        T1.property("ADBE Opacity").expression = clock +
            'time < half ? ease(time, t0, t0 + d0 * 0.5, 0, 100) : 0;';

        // CARD 2 — the context. Arrives edge-on exactly as card 1 leaves, so
        // the two read as one card being turned over rather than as a cut. This
        // is also why the flip sound means something.
        var two = placeCard(backComp, "CARD 2 · context");
        var T2 = two.property("ADBE Transform Group");
        T2.property("ADBE Rotate Y").expression = clock +
            'ease(time, half, tt + dt, -90, 0);';
        T2.property("ADBE Opacity").expression = clock +
            'time < half ? 0 : 100;';

        // The map inside card 2 is animated, so the card needs its own clock.
        // Time-remapping it to start at the turn means the map move follows the
        // Turn At slider live — nothing to re-bake, nothing to re-sync.
        two.timeRemapEnabled = true;
        var TR = two.property("ADBE Time Remapping");
        // Down to one key, not zero: time remap needs at least one keyframe
        // to stay switched on, and stripping the last one hides the property
        // so the expression cannot be set at all. The expression overrides
        // whatever the surviving key says.
        while (TR.numKeys > 1) TR.removeKey(TR.numKeys);
        TR.expression = clock +
            'var last = thisLayer.source.duration - thisComp.frameDuration;\n' +
            'Math.max(0, Math.min(last, time - (tt + dt)));';
        two.inPoint = 0;
        two.outPoint = c.duration;

        // Two card-turns: one as card 1 lands, one as it turns over. Placed on
        // the timeline rather than expression-driven, because a layer's start
        // time is not an expressible property — so when you drag Turn At, drag
        // the second sound with it.
        var sfx = importFileAs(CFG.root + "/" + CFG.sfx.file, "card-flip.wav",
                               folder(CFG.folders.assets));
        if (sfx) {
            var cues = [
                { name: "SFX · card 1 in", at: CFG.reveal.start },
                { name: "SFX · turn over", at: CFG.reveal.turnAt }
            ];
            for (var s = 0; s < cues.length; s++) {
                var A = c.layers.add(sfx);
                A.name = cues[s].name;
                // The clip's own attack sits a little way in, so nudge it early
                // to land the transient on the start of the movement.
                A.startTime = cues[s].at - CFG.sfx.lead;
                A.property("ADBE Audio Group").property("ADBE Audio Levels")
                 .setValue([CFG.sfx.level, CFG.sfx.level]);
                A.moveToEnd();
            }
        }

        return c;
    }

    // ------------------------------------------------------------------- api

    var api = {};
    api.CFG = CFG;

    api.workPath = function (slug) {
        return CFG.root + "/data/works/" + slug + ".json";
    };

    api.readWork = function (slug) {
        return readJSONFile(api.workPath(slug));
    };

    /**
     * Build every comp for one work. Safe to re-run: it replaces in place.
     *
     * Pass `quiet` when rebuilding several works in a loop. Opening the reel in
     * the viewer forces AE to render the whole nested chain — two duotoned
     * sub-comps and a time-remapped card — and doing that three times in one
     * scripted call is a lot of work nobody asked for. api.buildAll does it
     * quietly and opens nothing.
     */
    api.buildWork = function (slug, quiet) {
        var work = api.readWork(slug);
        var dataF   = folder(CFG.folders.data);
        var assetsF = folder(CFG.folders.assets);
        var worksF  = folder(CFG.folders.works);

        importFileAs(CFG.root + "/data/periods.json", "periods.json", dataF);
        importFileAs(api.workPath(slug), slug + ".json", dataF);

        var portrait = buildPortraitComp(slug, work, assetsF);
        var map      = buildMapComp(slug, work, assetsF);
        var front    = buildCardFront(slug, portrait, worksF);
        var back     = buildCardBack(slug, map, work, worksF);
        var reel     = buildReel(slug, front, back, worksF);
        if (!quiet) reel.openInViewer();

        return {
            slug: slug,
            reel: reel.name,
            cards: [front.name, back.name],
            hasPortrait: !!work.composer.portrait,
            hasPlace: !!work.map.has_place,
            note: work.map.has_place
                ? "Now aim the map: SOTD.mapDraw / mapStatus / mapFinish"
                : "No place known — map panel disabled on the back card"
        };
    };

    /** Rebuild several works without touching the viewer. */
    api.buildAll = function (slugs) {
        slugs = slugs || CFG.works;
        var out = [];
        for (var i = 0; i < slugs.length; i++) {
            try {
                api.buildWork(slugs[i], true);
                out.push(slugs[i] + " ok");
            } catch (e) {
                // ExtendScript will not coerce an Error in a concatenation —
                // "+ e" throws its own error and buries the real one.
                out.push(slugs[i] + " FAILED: " + String(e.message || e) +
                         (e.line ? " (line " + e.line + ")" : ""));
            }
        }
        return out;
    };

    // ------------------------------------------------------------------- map

    function mapcomp() {
        var c = findItem(CFG.mapcomp, CompItem);
        if (!c) throw new Error("Mapcomp '" + CFG.mapcomp + "' not found");
        return c;
    }

    function mercY(d) { return Math.log(Math.tan(Math.PI / 4 + d * Math.PI / 360)); }
    function invY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

    /**
     * A bbox for `lon ± H`, centred on the city.
     *
     * Deliberately shorter in Mercator than it is wide, so longitude is the
     * constraining dimension: `fitViewAtTime` fits the whole bbox inside the
     * square mapcomp, so a taller bbox would silently widen the view instead of
     * raising it. The card then crops the middle band, and the city lands at
     * frame centre with no projection maths needed for the pin.
     */
    function bboxFor(lon, lat, H) {
        var halfMerc = (H * Math.PI / 180) * 0.45;
        var cy = mercY(lat);
        return [lon - H, invY(cy - halfMerc), lon + H, invY(cy + halfMerc)];
    }

    /** The layers geolayers3.draw produced last time — everything else stays. */
    function drawnLayers(c) {
        var out = [];
        for (var i = 1; i <= c.numLayers; i++) {
            var L = c.layer(i);
            if (L.matchName !== "ADBE Vector Layer") continue;
            if (/^(City dot|Town dot)/.test(L.name)) continue;   // label furniture
            if (!L.enabled) continue;
            out.push(L);
        }
        return out;
    }

    /**
     * Replace the historical borders with the snapshot for this work's year.
     * geolayers3.draw is asynchronous and returns before anything changes, so
     * this only starts it — poll mapStatus() from a LATER call.
     */
    api.mapDraw = function (slug) {
        var work = api.readWork(slug);
        if (!work.map.geojson) throw new Error("Work has no clipped geojson; run prepare_work.py");
        var path = CFG.root + "/" + work.map.geojson;
        var f = new File(path);
        if (!f.exists) throw new Error("Missing " + path + " — run prepare_work.py");

        var c = mapcomp();
        var old = drawnLayers(c);
        var removed = [];
        for (var i = 0; i < old.length; i++) { removed.push(old[i].name); old[i].remove(); }

        $.global.__sotdDraw = { called: false, err: null, slug: slug };
        geolayers3.draw(CFG.mapcomp, f, function (err) {
            $.global.__sotdDraw = {
                called: true, err: err ? String(err) : null, slug: slug
            };
        }, { drawInsideMapcomp: true, namingProp: "NAME" });

        return { started: true, basemapYear: work.map.basemap_year,
                 removed: removed, poll: "SOTD.mapStatus()" };
    };

    api.mapStatus = function () {
        var s = $.global.__sotdDraw || { called: false, err: "no draw started" };
        var c = mapcomp();
        return { called: s.called, err: s.err, slug: s.slug,
                 drawnLayers: drawnLayers(c).length, layers: c.numLayers };
    };

    /** Restyle the drawn borders, then aim the view at the city. */
    api.mapFinish = function (slug) {
        var work = api.readWork(slug);
        var c = mapcomp();
        var layers = drawnLayers(c);
        var groups = 0;

        // fitViewAtTime zooms by rescaling the mapcomp's anchor layer, which
        // scales the border strokes with it. Scale the width the other way so
        // borders land at the same apparent weight whatever the zoom.
        var span = work.map.half_span_lon || 6;
        var strokeWidth = 2.0 * (span / 6);

        for (var n = 0; n < layers.length; n++) {
            var contents = layers[n].property("ADBE Root Vectors Group");
            for (var g = 1; g <= contents.numProperties; g++) {
                var vg = contents.property(g).property("ADBE Vectors Group");
                if (!vg) continue;
                var fill = null, stroke = null;
                for (var v = 1; v <= vg.numProperties; v++) {
                    var pr = vg.property(v);
                    if (pr.matchName === "ADBE Vector Graphic - Fill") fill = pr;
                    if (pr.matchName === "ADBE Vector Graphic - Stroke") stroke = pr;
                }
                // Drawn features default to opaque white, invisible on this
                // basemap. Parchment wash plus a dark warm border.
                if (fill) {
                    fill.property("ADBE Vector Fill Color").setValue([0.80, 0.76, 0.68, 1]);
                    fill.property("ADBE Vector Fill Opacity").setValue(14);
                }
                if (!stroke) stroke = vg.addProperty("ADBE Vector Graphic - Stroke");
                stroke.property("ADBE Vector Stroke Color").setValue([0.24, 0.21, 0.19, 1]);
                stroke.property("ADBE Vector Stroke Width").setValue(strokeWidth);
                stroke.property("ADBE Vector Stroke Opacity").setValue(88);
                groups++;
            }
        }

        var view = null;
        if (work.map.has_place) {
            view = bboxFor(work.composition.lon, work.composition.lat,
                           work.map.half_span_lon || 6);
            geolayers3.fitViewAtTime(CFG.mapcomp, view);
        }

        return { restyledGroups: groups, layers: layers.length, bbox: view,
                 next: "SOTD.mapFinalize() for full-resolution tiles" };
    };

    // ------------------------------------------------------------- map: move

    /**
     * When the map starts moving — in CARD BACK's OWN time, not the reel's.
     *
     * The reel time-remaps the card layer so its internal zero is the moment
     * the card finishes turning over. Everything inside the card is therefore
     * timed from the turn, which is what lets the whole sequence be dragged to
     * fit a voiceover with one slider and no re-baking.
     */
    function zoomStart() { return CFG.map.lead; }
    function zoomEnd() { return CFG.map.lead + CFG.map.dur; }

    /**
     * The travel curve, 0..1. Smoothstep first, so neither end jolts, then
     * biased towards the start: at the halfway mark roughly three quarters of
     * the zoom is already spent, and the rest creeps in. Zoom is interpolated
     * geometrically, not linearly — halving the span looks like the same amount
     * of movement whatever the scale, so a linear ramp would appear to
     * accelerate wildly at the end instead of settling.
     */
    function zoomEase(u) {
        var s = u * u * (3 - 2 * u);
        return 1 - Math.pow(1 - s, CFG.map.easePower);
    }

    /**
     * How wide to open on. Capped by the clipped geojson: Sutherland–Hodgman
     * leaves a dead-straight cut along the clip bbox, and pulling back past it
     * puts that cut on screen.
     */
    function startSpanFor(work, endH) {
        var want = CFG.map.startSpan;
        var clip = work.map.clip_bbox;
        if (clip && clip.length === 4) {
            var lon = work.composition.lon;
            var room = Math.min(lon - clip[0], clip[2] - lon) - CFG.map.edgeMargin;
            if (room > 0 && room < want) want = room;
        }
        return Math.max(endH * 1.5, want);
    }

    /**
     * Keyframe the move: continent to city, held wide until the cards land and
     * held on the city forever after.
     *
     * `fitViewAtTime` ignores both its `forceKeyframe` and `time` arguments —
     * it only ever sets the view statically. But it drives `MapPivot` inside
     * the mapcomp, and that is an ordinary AE transform, so the animation is
     * ours to write. One fit is enough to learn the projection: GEOlayers
     * scales by a constant over the half-span about a fixed world-pixel anchor,
     * so every intermediate frame is arithmetic rather than another round trip.
     *
     * Note what this does NOT buy you: `finalize` ignores these keyframes and
     * fetches tiles for the mapcomp's current static view only, so a wide move
     * needs baking in passes (finalize per zoom band, render that band's
     * frames). See docs/geolayers-3-via-mcp.md.
     */
    /**
     * The five GEOlayers view controls — and the only things that actually move
     * the map.
     *
     * They live on the mapcomp's LAYER in the containing comp, not on the
     * mapcomp itself. MapPivot's scale carries a GEOlayers expression that
     * computes itself from `effect("Zoom")`, so any keyframe written to
     * MapPivot is silently discarded. An earlier mapZoom keyframed exactly
     * that, which is why no card ever zoomed: every "5× move" was a static
     * view, and the tile-fetching mystery downstream was a mystery about an
     * animation that did not exist.
     */
    function viewControls() {
        var cont = findItem(CFG.mapcompContainer, CompItem);
        if (!cont) throw new Error("No '" + CFG.mapcompContainer + "' comp");
        var L = cont.layer(CFG.mapcomp);
        if (!L) throw new Error("No '" + CFG.mapcomp + "' layer in " + CFG.mapcompContainer);
        var fx = L.property("ADBE Effect Parade");
        function slider(name) {
            var E = fx.property(name);
            if (!E) throw new Error("Mapcomp layer has no '" + name + "' control");
            return E.property(1);
        }
        return { lat: slider("Latitude"), lon: slider("Longitude"),
                 zoom: slider("Zoom"), bearing: slider("Bearing"),
                 pitch: slider("Pitch") };
    }

    /**
     * Half-span in degrees -> GEOlayers zoom level.
     *
     * From the expression on MapPivot, scale% = 100·2^zoom / 512, and scale is
     * inversely proportional to the span. So halving the span is exactly +1
     * zoom, and the whole conversion is one log2 away from a known pair.
     * Checked against the live comp: span 6 ↔ zoom 5.6618 ↔ scale 9.8877%.
     *
     * The happy consequence: interpolating the span geometrically IS
     * interpolating zoom linearly, so the existing ease curve carries over
     * untouched.
     */
    function zoomForSpan(zEnd, endH, H) {
        return zEnd + Math.log(endH / H) / Math.LN2;
    }

    api.mapZoom = function (slug) {
        var work = api.readWork(slug);
        if (!work.map.has_place)
            return { zoomed: false, reason: "no place known for this work" };

        var lon = work.composition.lon, lat = work.composition.lat;
        var endH = work.map.half_span_lon || 6;
        var startH = startSpanFor(work, endH);

        var V = viewControls();

        // Clear every stale view key first. Without this an earlier work's move
        // survives re-aiming: the mapcomp was still animating Vienna→Linz from
        // mozart-linz while supposedly showing the Eroica.
        var props = [V.lat, V.lon, V.zoom, V.bearing, V.pitch];
        for (var p = 0; p < props.length; p++)
            while (props[p].numKeys) props[p].removeKey(1);

        // MapPivot keys are inert, but leaving them invites the same mistake
        // again — and freezeMapRender used to read them to decide whether the
        // map moved, which is how a static map passed as animated.
        var P = mapcomp().layer("MapPivot").property("ADBE Transform Group");
        var S = P.property("ADBE Scale"), A = P.property("ADBE Anchor Point");
        while (S.numKeys) S.removeKey(1);
        while (A.numKeys) A.removeKey(1);

        // Aim at the city, then read the zoom that lands on: that is the end of
        // the move, and every wider view is derived from it.
        geolayers3.fitViewAtTime(CFG.mapcomp, bboxFor(lon, lat, endH));
        var zEnd = V.zoom.value;
        var zStart = zoomForSpan(zEnd, endH, startH);

        // Centre stays on the city for the whole move — this falls in, it does
        // not pan.
        V.lat.setValue(lat);
        V.lon.setValue(lon);

        var t0 = zoomStart(), D = CFG.map.dur, N = CFG.map.samples;
        V.zoom.setValueAtTime(0, zStart);                    // hold wide until t0
        for (var i = 0; i <= N; i++) {
            var u = i / N;
            var H = startH * Math.pow(endH / startH, zoomEase(u));
            V.zoom.setValueAtTime(t0 + D * u, zoomForSpan(zEnd, endH, H));
        }
        // The samples ARE the curve. Left on bezier, AE would round its own
        // corners through them and overshoot on the way into the city.
        for (var k = 1; k <= V.zoom.numKeys; k++)
            V.zoom.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR,
                                                KeyframeInterpolationType.LINEAR);

        return { zoomed: true, spanFrom: startH, spanTo: endH,
                 zoomFrom: Math.round(zStart * 1000) / 1000,
                 zoomTo: Math.round(zEnd * 1000) / 1000,
                 start: t0, dur: D, keys: V.zoom.numKeys,
                 cappedByClip: startH < CFG.map.startSpan,
                 next: "SOTD.mapFinalize() — then poll SOTD.mapFinalizeStatus()" };
    };

    /** Every PNG currently in the GEOlayers tile cache. */
    function tileCount() {
        var d = new Folder(CFG.tilesPath);
        if (!d.exists) return -1;
        return d.getFiles("*.png").length;
    }

    /**
     * Slow: downloads the tile set for the whole move. Do this last, after the
     * style settles, and poll mapFinalizeStatus() from a LATER call.
     *
     * finalize DOES follow the keyframes. Its options default to
     * {onlyCurrentFrame:false, previewQuality:false, onlyWorkArea:false,
     * purgeImageryCache:false}, and it samples the animated view at
     * 2 × finalizationBaseSampleRate, deduping near-identical views. An earlier
     * version of this file claimed the opposite; the claim came from a run with
     * the panel shut and no callback, which is silent twice over.
     *
     * The callback is the ONLY place errors appear, and the one that matters
     * most is a real sentence: "Too many tiles. The imagery coverage is too
     * large for a single Mapcomp." — thrown when the sampled views need more
     * than `maxTilesForFinalization` (1000) tiles. A 5× zoom is exactly the
     * shape that trips it. Discarding the callback turns that diagnosis into
     * silence, which is what happened for as long as this function ignored it.
     *
     * onlyWorkArea is the lever on tile count: it samples the work area rather
     * than the whole 30s comp, so we set the work area to the move first.
     */
    api.mapFinalize = function (opts) {
        opts = opts || {};
        var c = mapcomp();

        // Scope sampling to the move, not the whole comp.
        var wa = null;
        if (opts.wholeComp !== true) {
            wa = { start: c.workAreaStart, dur: c.workAreaDuration };
            c.workAreaStart = 0;
            c.workAreaDuration = Math.min(c.duration,
                                          zoomStart() + CFG.map.dur + CFG.map.tail);
        }

        $.global.__sotdFin = {
            called: false, err: null,
            tilesBefore: tileCount(),
            workArea: wa ? [c.workAreaStart, c.workAreaDuration] : "whole comp",
            restore: wa ? [wa.start, wa.dur] : null
        };
        geolayers3.finalize(CFG.mapcomp, function (err) {
            var s = $.global.__sotdFin || {};
            s.called = true;
            s.err = err ? String(err) : null;
            s.tilesAfter = tileCount();
            $.global.__sotdFin = s;
            // Restore the work area HERE, not after the finalize call. finalize
            // is async: putting it back synchronously restored it before the
            // sampling had read it, so onlyWorkArea silently sampled the old
            // range. Same class of bug as polling for saveFrameToPng in-thread.
            if (s.restore) {
                try {
                    var k = mapcomp();
                    k.workAreaStart = s.restore[0];
                    k.workAreaDuration = s.restore[1];
                } catch (e) {}
            }
        }, {
            onlyCurrentFrame: false,
            previewQuality:   false,
            onlyWorkArea:     opts.wholeComp !== true,
            // Forces a real fetch instead of re-laying cache. Cache re-laying is
            // what made an earlier finalize look successful while downloading
            // nothing for three days.
            purgeImageryCache: opts.purge === true
        });

        return { started: true, tilesBefore: $.global.__sotdFin.tilesBefore,
                 sampledWorkArea: $.global.__sotdFin.workArea,
                 poll: "SOTD.mapFinalizeStatus()" };
    };

    /**
     * Did it actually fetch anything? The return value of finalize never knew;
     * only the callback and the cache do. `ok` is false unless the callback
     * fired clean AND the cache grew.
     */
    api.mapFinalizeStatus = function () {
        var s = $.global.__sotdFin;
        if (!s) return { called: false, err: "no finalize started" };
        var now = tileCount();
        var gained = s.tilesBefore >= 0 ? now - s.tilesBefore : null;
        return {
            called: s.called, err: s.err,
            tilesBefore: s.tilesBefore, tilesNow: now, tilesGained: gained,
            sampledWorkArea: s.workArea,
            ok: s.called && !s.err && gained > 0,
            note: !s.called ? "still working — poll again"
                : s.err ? "FAILED: " + s.err
                : gained > 0 ? "fetched " + gained + " new tiles"
                : "callback clean but cache did not grow — panel shut, or every "
                  + "tile was already cached. Re-run with {purge:true} to be sure."
        };
    };

    /**
     * Bake this work's map to a still and switch the card over to it.
     *
     * There is only ONE GEOlayers mapcomp, so every MAP comp in the project
     * points at the same live map: aiming it at the next work silently
     * rewrites the map on every earlier card. Freezing a finished work cuts
     * that link, so yesterday's reel still renders correctly tomorrow.
     *
     * Reproducible, so the PNG is not tracked: prepare_work.py, mapDraw,
     * mapFinish and the two freeze steps regenerate it exactly.
     */
    function mapStillPath(slug) {
        return CFG.root + "/data/maps/" + slug + ".png";
    }
    function mapSeqDir(slug) {
        return CFG.root + "/data/maps/" + slug;
    }
    function mapSeqFrame(slug, i) {
        var s = "0000" + i;
        return mapSeqDir(slug) + "/map_" + s.substr(s.length - 5) + ".png";
    }
    function mapSeqFrames() {
        return Math.round((CFG.map.dur + CFG.map.tail) * CFG.reel.fps) + 1;
    }
    /** The first frame of a baked sequence, or null if this work has none. */
    function mapSeqFirst(slug) {
        var f = new File(mapSeqFrame(slug, 0));
        return f.exists ? f : null;
    }

    /**
     * Step 1: bake the map.
     *
     * The move is baked rather than left live because there is only one
     * mapcomp: the frames have to be taken while it is aimed at this work, or
     * tomorrow's aim rewrites them. Frame 0 of the sequence is the moment the
     * move starts, so the card offsets it by `zoomStart` on the way back in.
     *
     * saveFrameToPng only lands its file once the script returns — the write
     * shares this thread, so sleeping or polling for the files inside the same
     * call starves the very work being waited on and nothing appears. Importing
     * therefore has to happen in a LATER call, exactly like the asynchronous
     * geolayers3.draw above. The writes queue happily; it is only the waiting
     * that deadlocks.
     */
    api.freezeMapRender = function (slug) {
        var comp = findItem("MAP · " + slug, CompItem);
        if (!comp) throw new Error("No MAP comp for '" + slug + "' — run buildWork first");

        var live = null, hide = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L.name === "MAP") live = L;
            // Pin and duotone stay live on top of the bake rather than being
            // burnt into it: the tint is bound to the work, and baking it in
            // would tint the frames twice on the next rebuild.
            else if (/^PIN |^DUOTONE /.test(L.name)) hide.push(L);
        }
        if (!live) return { rendered: false, reason: "already frozen" };

        for (var p = 0; p < hide.length; p++) hide[p].enabled = false;

        var maps = new Folder(CFG.root + "/data/maps");
        if (!maps.exists) maps.create();

        // Is the mapcomp actually moving? If not, one still is the whole job.
        // Read the Zoom control, NOT MapPivot: MapPivot's keys are overridden
        // by a GEOlayers expression, so a comp with 62 of them can be stone
        // still — which is how static maps were baked as though they moved.
        // And keys alone are not motion: compare the values.
        var Z = viewControls().zoom;
        var animated = false;
        if (Z.numKeys > 1) {
            var lo = Z.keyValue(1), hi = Z.keyValue(1);
            for (var z = 2; z <= Z.numKeys; z++) {
                var v = Z.keyValue(z);
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
            animated = (hi - lo) > 0.01;
        }

        var wrote;
        if (animated) {
            var dir = new Folder(mapSeqDir(slug));
            if (dir.exists) {
                var old = dir.getFiles("*.png");
                for (var o = 0; o < old.length; o++) old[o].remove();
            } else {
                dir.create();
            }
            var n = mapSeqFrames(), t0 = zoomStart();
            for (var f = 0; f < n; f++)
                comp.saveFrameToPng(t0 + f / CFG.reel.fps, new File(mapSeqFrame(slug, f)));
            wrote = { frames: n, dir: "data/maps/" + slug + "/" };
        } else {
            comp.saveFrameToPng(0, new File(mapStillPath(slug)));
            wrote = { frames: 1, png: "data/maps/" + slug + ".png" };
        }

        for (var q = 0; q < hide.length; q++) hide[q].enabled = true;

        return { rendered: true, animated: animated, wrote: wrote,
                 next: "SOTD.freezeMapAttach(\"" + slug + "\") in a LATER call" };
    };

    /** Step 2: swap the card over to the bake and release the live mapcomp. */
    api.freezeMapAttach = function (slug) {
        var comp = findItem("MAP · " + slug, CompItem);
        if (!comp) throw new Error("No MAP comp for '" + slug + "'");

        var seq = mapSeqFirst(slug);
        var still = new File(mapStillPath(slug));
        if (!seq && (!still.exists || still.length === 0))
            return { attached: false, reason: "bake not written yet — call again in a moment" };

        var live = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L.name === "MAP") live = L;
            else if (/^FROZEN/.test(L.name)) { L.remove(); i--; }
        }

        var item = seq ? importSequence(slug)
                       : importFileAs(mapStillPath(slug), "map-" + slug + ".png",
                                      folder(CFG.folders.assets));
        if (!item) return { attached: false, reason: "import failed — call again in a moment" };

        var sl = attachBakedMap(comp, item, !!seq);
        if (live) {
            live.enabled = false;
            live.name = "MAP (live — disabled by freeze)";
        }
        return { attached: true, animated: !!seq,
                 source: seq ? "data/maps/" + slug + "/" : "data/maps/" + slug + ".png",
                 note: "mapcomp is now free for the next work" };
    };

    function importSequence(slug) {
        var name = "map-" + slug + " [seq]";
        var existing = findItem(name);
        if (existing) existing.remove();
        var io = new ImportOptions(mapSeqFirst(slug));
        io.importAs = ImportAsType.FOOTAGE;
        io.sequence = true;
        var item = app.project.importFile(io);
        item.name = name;
        item.parentFolder = folder(CFG.folders.assets);
        try { item.mainSource.conformFrameRate = CFG.reel.fps; } catch (e) {}
        return item;
    }

    /**
     * Put a baked map under the duotone. A sequence is time-remapped rather
     * than simply placed: the expression holds the continent before the move
     * starts and the city after it ends, so one short bake covers a comp of any
     * length and stays re-timeable without re-rendering.
     */
    function attachBakedMap(comp, item, animated) {
        var sl = comp.layers.add(item);
        sl.name = "FROZEN MAP";
        // A bake taken before a panel-size change need not match the comp
        // exactly; scale-to-fill absorbs the few pixels.
        sl.property("ADBE Transform Group").property("ADBE Scale").expression =
            'var s = Math.max(thisComp.width / width, thisComp.height / height) * 100;\n[s, s];';
        if (animated) {
            sl.timeRemapEnabled = true;
            var TR = sl.property("ADBE Time Remapping");
            // Down to one key, not zero: time remap needs at least one keyframe
        // to stay switched on, and stripping the last one hides the property
        // so the expression cannot be set at all. The expression overrides
        // whatever the surviving key says.
        while (TR.numKeys > 1) TR.removeKey(TR.numKeys);
            TR.expression =
                'var t0 = ' + zoomStart() + ';\n' +
                'var last = thisLayer.source.duration - thisComp.frameDuration;\n' +
                'Math.max(0, Math.min(last, time - t0));';
            sl.inPoint = 0;
            sl.outPoint = comp.duration;
        }
        sl.moveToEnd();
        return sl;
    }

    return api;
})();

// $.evalFile evaluates in the caller's scope, so a plain `var` here would be
// local to whichever function loaded the file and would vanish before the next
// MCP call. The async map workflow spans several calls, so publish it properly.
$.global.SOTD = SOTD;
SOTD;
