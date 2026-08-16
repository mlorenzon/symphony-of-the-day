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
        pad:    26,
        mapcomp: "Europe",
        mapcompContainer: "containing Europe",

        // Panels, in card coordinates. Top-left origin.
        portraitPanel: { x: 26, y: 52,  w: 388, h: 304 },
        mapPanel:      { x: 26, y: 206, w: 388, h: 220 },

        font: {
            serif:  "Cambria",
            bold:   "Cambria-Bold",
            italic: "Cambria-Italic",
            caps:   "TrajanPro3-Regular"
        },

        col: {
            paper:     [0.957, 0.925, 0.863],
            paperDeep: [0.894, 0.847, 0.753],
            ink:       [0.141, 0.110, 0.078],
            inkSoft:   [0.420, 0.365, 0.290],
            accent:    [0.549, 0.184, 0.165],
            gold:      [0.706, 0.537, 0.290],
            rule:      [0.788, 0.722, 0.588],
            bg:        [0.055, 0.051, 0.047]
        },

        // Timeline block on the back card.
        tl: { x: 26, w: 388, barY: 172, barH: 11, gap: 2, labelY: 184 },

        folders: {
            root:   "SOTD",
            works:  "SOTD/Works",
            data:   "SOTD/Data",
            assets: "SOTD/Assets"
        }
    };

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
        if (o.fill) {
            var fl = vs.addProperty("ADBE Vector Graphic - Fill");
            fl.property("ADBE Vector Fill Color").setValue(o.fill.concat([1]).slice(0, 4));
            if (o.fillOpacity !== undefined)
                fl.property("ADBE Vector Fill Opacity").setValue(o.fillOpacity);
        }
        L.position.setValue([o.topLeft[0] + o.size[0] / 2, o.topLeft[1] + o.size[1] / 2]);
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

    /** Shared prelude for the period timeline: both the work and the period table. */
    function tlPrelude() {
        return bindPrelude() +
               'var T = null;\n' +
               'try { T = footage("periods.json").sourceData; } catch (e) {}\n' +
               'var X0 = ' + CFG.tl.x + ', W = ' + CFG.tl.w + ';\n' +
               'function px(yr) { return X0 + W * (yr - T.span[0]) / (T.span[1] - T.span[0]); }\n';
    }

    // ------------------------------------------------------------- sub-comps

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
            L.property("ADBE Transform Group").property("ADBE Position").expression =
                '[thisComp.width / 2, thisComp.height / 2 + effect("Framing Y")("Slider")];';

            // A single warm wash keeps wildly different source paintings looking
            // like one series. Disable this layer if a portrait fights it.
            var tone = c.layers.addSolid(CFG.col.gold, "TONE (disable to taste)",
                                         p.w, p.h, 1, CFG.reel.dur);
            tone.blendingMode = BlendingMode.SOFT_LIGHT;
            tone.property("ADBE Transform Group").property("ADBE Opacity").setValue(16);
        } else {
            var bgp = c.layers.addSolid(CFG.col.paperDeep, "NO PORTRAIT", p.w, p.h, 1, CFG.reel.dur);
            addText(c, {
                name: "INITIALS", box: [p.w, 90], topLeft: [0, p.h / 2 - 45],
                font: CFG.font.caps, size: 64, color: CFG.col.inkSoft, tracking: 60,
                justify: ParagraphJustification.CENTER_JUSTIFY, text: "?",
                expr: bindStr('D.composer.name.split(" ").pop().substr(0,1)', "?")
            });
        }
        return c;
    }

    function buildMapComp(slug, work, assetsFolder) {
        var p = CFG.mapPanel;
        var c = makeComp("MAP · " + slug, p.w, p.h, CFG.reel.dur, assetsFolder);

        // A frozen still wins over the live mapcomp, so rebuilding a finished
        // work does not silently re-attach it to whatever the map shows today.
        // Delete data/maps/<slug>.png to go back to the live map.
        var frozen = new File(CFG.root + "/data/maps/" + slug + ".png");
        if (frozen.exists) {
            var still = importFileAs(CFG.root + "/data/maps/" + slug + ".png",
                                     "map-" + slug + ".png", assetsFolder);
            if (still) {
                var fl = c.layers.add(still);
                fl.name = "FROZEN MAP";
                addMapPin(c, p);
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
        } else {
            c.layers.addSolid(CFG.col.paperDeep, "NO MAPCOMP FOUND", p.w, p.h, 1, CFG.reel.dur);
        }

        // The mapcomp is aimed at a bbox centred on the city, so the city is
        // exactly at the centre of the frame and the pin needs no maths.
        addMapPin(c, p);
        return c;
    }

    /**
     * The mapcomp is always aimed at a bbox centred on the city, so the city
     * lands exactly at the centre of frame and the pin needs no projection maths.
     * Built back to front: each new layer lands on top of the last.
     */
    function addMapPin(c, p) {
        addEllipse(c, {
            name: "PIN halo", center: [p.w / 2, p.h / 2], size: [26, 26],
            fill: CFG.col.paper
        }).property("ADBE Transform Group").property("ADBE Opacity").setValue(55);
        addEllipse(c, {
            name: "PIN ring", center: [p.w / 2, p.h / 2], size: [19, 19],
            stroke: CFG.col.accent, strokeWidth: 2.5
        });
        addEllipse(c, {
            name: "PIN dot", center: [p.w / 2, p.h / 2], size: [7, 7],
            fill: CFG.col.accent
        });
    }

    // ----------------------------------------------------------- card: front

    function cardBase(c, title) {
        addRect(c, {
            name: "CARD paper", topLeft: [0, 0], size: [CFG.card.w, CFG.card.h],
            round: 16, fill: CFG.col.paper
        });
        addRect(c, {
            name: "CARD rule outer", topLeft: [8, 8],
            size: [CFG.card.w - 16, CFG.card.h - 16], round: 11,
            stroke: CFG.col.gold, strokeWidth: 1.4
        });
        addRect(c, {
            name: "CARD rule inner", topLeft: [13, 13],
            size: [CFG.card.w - 26, CFG.card.h - 26], round: 8,
            stroke: CFG.col.rule, strokeWidth: 0.8, strokeOpacity: 70
        });
        addText(c, {
            name: "STRIP", box: [CFG.card.w - 52, 22], topLeft: [26, 22],
            font: CFG.font.caps, size: 10.5, color: CFG.col.accent, tracking: 300,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: title
        });
    }

    function hairline(c, name, y, inset) {
        return addRect(c, {
            name: name, topLeft: [inset, y], size: [CFG.card.w - inset * 2, 1],
            fill: CFG.col.rule
        });
    }

    function buildCardFront(slug, portraitComp, worksFolder) {
        var c = makeComp("CARD FRONT · " + slug, CFG.card.w, CFG.card.h,
                         CFG.reel.dur, worksFolder);
        cardBase(c, "SYMPHONY OF THE DAY");

        var p = CFG.portraitPanel;
        var pl = c.layers.add(portraitComp);
        pl.name = "PORTRAIT";
        pl.property("ADBE Transform Group").property("ADBE Position")
            .setValue([p.x + p.w / 2, p.y + p.h / 2]);
        addRect(c, {
            name: "PORTRAIT rule", topLeft: [p.x, p.y], size: [p.w, p.h],
            stroke: CFG.col.gold, strokeWidth: 1.2, round: 3
        });

        addText(c, {
            name: "COMPOSER", box: [CFG.card.w - 52, 28], topLeft: [26, 366],
            font: CFG.font.caps, size: 19, color: CFG.col.ink, tracking: 30,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "COMPOSER",
            expr: bindFitted('D.composer.name', "", [
                { size: 19 }, { over: 22, size: 16 }, { over: 30, size: 13.5 }
            ])
        });

        addText(c, {
            name: "LIFE", box: [CFG.card.w - 52, 20], topLeft: [26, 396],
            font: CFG.font.italic, size: 13.5, color: CFG.col.inkSoft, tracking: 20,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "dates",
            expr: bindStr('[D.composer.life, D.composer.nationality]' +
                          '.filter(function (s) { return s; }).join("  ·  ")', "")
        });

        hairline(c, "RULE mid", 424, 150);

        addText(c, {
            name: "TITLE", box: [CFG.card.w - 52, 112], topLeft: [26, 436],
            font: CFG.font.bold, size: 25, color: CFG.col.ink, leading: 30,
            centerY: 492,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "Title",
            // Thresholds are tuned so a typical "Symphony No. N in X, Op. NN"
            // drops to one line rather than orphaning the opus number.
            expr: bindFitted('D.title_full', "", [
                { size: 25 }, { over: 30, size: 22 },
                { over: 50, size: 19 }, { over: 74, size: 16.5 }
            ])
        });

        addText(c, {
            name: "NUMBER", box: [160, 22], topLeft: [30, 560],
            font: CFG.font.serif, size: 13.5, color: CFG.col.inkSoft, tracking: 60,
            justify: ParagraphJustification.LEFT_JUSTIFY, text: "No.",
            expr: bindStr('D.number', "")
        });
        addText(c, {
            name: "CATALOGUE", box: [160, 22], topLeft: [CFG.card.w - 190, 560],
            font: CFG.font.serif, size: 13.5, color: CFG.col.inkSoft, tracking: 60,
            justify: ParagraphJustification.RIGHT_JUSTIFY, text: "K.",
            expr: bindStr('D.catalogue', "")
        });

        addDataLayer(c, slug);
        return c;
    }

    // ------------------------------------------------------------ card: back

    function buildTimeline(c) {
        var t = CFG.tl;

        // One shape layer holds every period segment. Its position is pinned to
        // [0,0] so shape coordinates equal card coordinates and the expressions
        // can work in the same numbers as the rest of the layout.
        var table = readJSONFile(CFG.root + "/data/periods.json");
        var seg = c.layers.addShape();
        seg.name = "TIMELINE bar";
        seg.position.setValue([0, 0]);
        seg.anchorPoint.setValue([0, 0]);

        var root = seg.property("ADBE Root Vectors Group");
        for (var i = 0; i < table.periods.length; i++) {
            var g = root.addProperty("ADBE Vector Group");
            g.name = table.periods[i].name;
            var vs = g.property("ADBE Vectors Group");
            var r = vs.addProperty("ADBE Vector Shape - Rect");
            r.property("ADBE Vector Rect Roundness").setValue(2);
            r.property("ADBE Vector Rect Size").expression = tlPrelude() +
                'var p = T.periods[' + i + '];\n' +
                '[Math.max(1, px(p.to) - px(p.from) - ' + t.gap + '), ' + t.barH + '];';
            r.property("ADBE Vector Rect Position").expression = tlPrelude() +
                'var p = T.periods[' + i + '];\n' +
                '[(px(p.from) + px(p.to)) / 2, ' + t.barY + '];';

            var fl = vs.addProperty("ADBE Vector Graphic - Fill");
            fl.property("ADBE Vector Fill Color").expression = tlPrelude() +
                'var p = T.periods[' + i + '];\n' +
                'var y = D.composition.year;\n' +
                'var on = (y >= p.from && y < p.to);\n' +
                'on ? [' + CFG.col.accent.join(",") + ', 1] : [' + CFG.col.rule.join(",") + ', 1];';
        }

        // Period names under the bar, the active one picked out in ink.
        for (var k = 0; k < table.periods.length; k++) {
            var lab = addText(c, {
                name: "TL " + table.periods[k].name,
                box: [130, 16], topLeft: [0, t.labelY],
                font: CFG.font.caps, size: 9, color: CFG.col.inkSoft, tracking: 40,
                justify: ParagraphJustification.CENTER_JUSTIFY,
                text: table.periods[k].name.toUpperCase(),
                expr: 'var t = "";\n' +
                      'try { t = footage("periods.json").sourceData.periods[' + k + '].name.toUpperCase(); } catch (e) {}\n' +
                      't;'
            });
            lab.property("ADBE Transform Group").property("ADBE Position").expression =
                tlPrelude() +
                'var p = T.periods[' + k + '];\n' +
                '[(px(p.from) + px(p.to)) / 2, ' + (t.labelY + 8) + '];';
            lab.property("ADBE Transform Group").property("ADBE Opacity").expression =
                tlPrelude() +
                'var p = T.periods[' + k + '];\n' +
                'var y = D.composition.year;\n' +
                '(y >= p.from && y < p.to) ? 100 : 45;';
        }

        // Span ends, so the bar is readable as dates and not just as colour.
        var ends = [
            { n: "TL span start", i: 0, x: t.x,         j: ParagraphJustification.LEFT_JUSTIFY },
            { n: "TL span end",   i: 1, x: t.x + t.w - 60, j: ParagraphJustification.RIGHT_JUSTIFY }
        ];
        for (var e = 0; e < ends.length; e++) {
            addText(c, {
                name: ends[e].n, box: [60, 14], topLeft: [ends[e].x, t.barY - 24],
                font: CFG.font.serif, size: 9, color: CFG.col.inkSoft, tracking: 40,
                justify: ends[e].j, text: "1600",
                expr: 'var v = "";\n' +
                      'try { v = footage("periods.json").sourceData.span[' + ends[e].i + ']; } catch (err) {}\n' +
                      'v.toString();'
            });
        }

        // Marker: stem plus a dot, sitting on the year of composition.
        var stem = c.layers.addShape();
        stem.name = "TIMELINE marker";
        stem.position.setValue([0, 0]);
        stem.anchorPoint.setValue([0, 0]);
        var sg = stem.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        var svs = sg.property("ADBE Vectors Group");
        var sr = svs.addProperty("ADBE Vector Shape - Rect");
        sr.property("ADBE Vector Rect Size").setValue([2, 30]);
        sr.property("ADBE Vector Rect Position").expression = tlPrelude() +
            'var x = px(D.composition.year);\n' +
            'x = Math.min(Math.max(x, X0), X0 + W);\n' +
            '[x, ' + (t.barY - 9) + '];';
        var sf = svs.addProperty("ADBE Vector Graphic - Fill");
        sf.property("ADBE Vector Fill Color").setValue(CFG.col.ink.concat([1]));

        var dot = svs.addProperty("ADBE Vector Shape - Ellipse");
        dot.property("ADBE Vector Ellipse Size").setValue([9, 9]);
        dot.property("ADBE Vector Ellipse Position").expression = tlPrelude() +
            'var x = px(D.composition.year);\n' +
            'x = Math.min(Math.max(x, X0), X0 + W);\n' +
            '[x, ' + (t.barY - 24) + '];';
    }

    function buildCardBack(slug, mapComp, work, worksFolder) {
        var c = makeComp("CARD BACK · " + slug, CFG.card.w, CFG.card.h,
                         CFG.reel.dur, worksFolder);
        cardBase(c, "COMPOSED");

        addText(c, {
            name: "YEAR", box: [CFG.card.w - 52, 62], topLeft: [26, 50],
            font: CFG.font.bold, size: 52, color: CFG.col.ink, tracking: 20,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "1783",
            expr: bindStr('D.composition.year', "")
        });
        addText(c, {
            name: "AGE", box: [CFG.card.w - 52, 22], topLeft: [26, 112],
            font: CFG.font.italic, size: 15.5, color: CFG.col.inkSoft,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "aged",
            expr: bindStr('D.composition.age_line', "")
        });

        buildTimeline(c);

        var p = CFG.mapPanel;
        var ml = c.layers.add(mapComp);
        ml.name = "MAP";
        ml.property("ADBE Transform Group").property("ADBE Position")
            .setValue([p.x + p.w / 2, p.y + p.h / 2]);
        ml.enabled = !!work.map.has_place;
        addRect(c, {
            name: "MAP rule", topLeft: [p.x, p.y], size: [p.w, p.h],
            stroke: CFG.col.gold, strokeWidth: 1.2, round: 3
        }).enabled = !!work.map.has_place;

        addText(c, {
            name: "PLACE", box: [CFG.card.w - 52, 24], topLeft: [26, 436],
            font: CFG.font.caps, size: 16, color: CFG.col.ink, tracking: 120,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "PLACE",
            expr: bindFitted('D.composition.place', "", [
                { size: 16 }, { over: 16, size: 13 }, { over: 26, size: 11 }
            ])
        });
        addText(c, {
            name: "COUNTRY THEN", box: [CFG.card.w - 52, 20], topLeft: [26, 460],
            font: CFG.font.italic, size: 13, color: CFG.col.inkSoft,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "country",
            expr: bindStr('D.composition.country_then', "")
        });

        // Hide the rule too when there is no context, or it reads as a heading
        // for nothing.
        hairline(c, "RULE lower", 490, 150)
            .property("ADBE Transform Group").property("ADBE Opacity").expression =
                bindPrelude() + '(D && D.context) ? 100 : 0;';

        // The brief says leave this blank when nothing is known, so the label
        // hides itself rather than captioning an empty box.
        addText(c, {
            name: "CONTEXT LABEL", box: [CFG.card.w - 52, 16], topLeft: [26, 500],
            font: CFG.font.caps, size: 9.5, color: CFG.col.accent, tracking: 200,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "OCCASION",
            expr: bindStr('(D.context ? D.context_label.toUpperCase() : "")', "")
        });
        addText(c, {
            name: "CONTEXT", box: [CFG.card.w - 52, 76], topLeft: [26, 516],
            font: CFG.font.italic, size: 14, color: CFG.col.ink, leading: 18,
            centerY: 554,
            justify: ParagraphJustification.CENTER_JUSTIFY, text: "context",
            expr: bindFitted('D.context', "", [
                { size: 14 }, { over: 120, size: 12.5 }, { over: 190, size: 11 }
            ])
        });

        addDataLayer(c, slug);
        return c;
    }

    /** The one layer that decides which work a card shows. */
    function addDataLayer(c, slug) {
        var L = addText(c, {
            name: "DATA", box: [300, 24], topLeft: [70, 596],
            font: CFG.font.serif, size: 12, color: CFG.col.accent,
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
        var R = CFG.reel;
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
        sr.property("ADBE Vector Rect Size").setValue([R.w - 80, 1120]);
        var sst = svs.addProperty("ADBE Vector Graphic - Stroke");
        sst.property("ADBE Vector Stroke Color").setValue([0.35, 0.33, 0.30, 1]);
        sst.property("ADBE Vector Stroke Width").setValue(2);
        stage.position.setValue([R.w / 2, 640]);

        // A long lens: the cards sit well below centre, and a wide default
        // camera shears them badly as they rotate. Position and point of
        // interest both have to be set — addCamera leaves the camera at the
        // comp's top-left corner, which skews everything off-axis.
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
        slider(ctrl, "Reveal Start", 0.35);
        slider(ctrl, "Reveal Duration", 0.75);
        slider(ctrl, "Card Gap", 56);
        slider(ctrl, "Overlay Y", 1560);
        slider(ctrl, "Overlay Scale", 100);

        var rig = c.layers.addNull(R.dur);
        rig.name = "RIG";
        rig.threeDLayer = true;
        rig.guideLayer = true;
        rig.property("ADBE Transform Group").property("ADBE Position").expression =
            'var C = thisComp.layer("CTRL");\n' +
            '[thisComp.width / 2, C.effect("Overlay Y")("Slider"), 0];';
        rig.property("ADBE Transform Group").property("ADBE Scale").expression =
            'var s = thisComp.layer("CTRL").effect("Overlay Scale")("Slider");\n[s, s, s];';

        function placeCard(comp, name, side, delay) {
            var L = c.layers.add(comp);
            L.name = name;
            L.threeDLayer = true;
            L.parent = rig;
            slider(L, "Side", side);
            slider(L, "Reveal Delay", delay);

            var reveal =
                'var C = thisComp.layer("CTRL");\n' +
                'var t0 = C.effect("Reveal Start")("Slider") + effect("Reveal Delay")("Slider");\n' +
                'var d  = Math.max(0.001, C.effect("Reveal Duration")("Slider"));\n' +
                'var a  = ease(time, t0, t0 + d, 1, 0);\n';

            var T = L.property("ADBE Transform Group");
            T.property("ADBE Position").expression = reveal +
                'var g = C.effect("Card Gap")("Slider");\n' +
                'var side = effect("Side")("Slider");\n' +
                '[side * (' + CFG.card.w + ' + g) / 2, 0, 340 * a];';
            T.property("ADBE Rotate Y").expression = reveal + '-84 * a;';
            T.property("ADBE Opacity").expression = reveal +
                'ease(time, t0, t0 + d * 0.5, 0, 100);';

            var sh = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sh.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
            sh.property("ADBE Drop Shadow-0002").setValue(140);   // opacity
            sh.property("ADBE Drop Shadow-0004").setValue(14);    // distance
            sh.property("ADBE Drop Shadow-0005").setValue(28);    // softness
            return L;
        }

        placeCard(backComp,  "CARD BACK",  1,  0.14);
        placeCard(frontComp, "CARD FRONT", -1, 0.00);

        c.openInViewer();
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

    /** Build every comp for one work. Safe to re-run: it replaces in place. */
    api.buildWork = function (slug) {
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

    // ------------------------------------------------------------------- map

    function mapcomp() {
        var c = findItem(CFG.mapcomp, CompItem);
        if (!c) throw new Error("Mapcomp '" + CFG.mapcomp + "' not found");
        return c;
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
            var lon = work.composition.lon, lat = work.composition.lat;
            var H = work.map.half_span_lon || 6;

            function mercY(d) { return Math.log(Math.tan(Math.PI / 4 + d * Math.PI / 360)); }
            function invY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

            // Keep longitude the constraining dimension, so the square mapcomp
            // shows exactly lon ± H and the card crops the middle band of it.
            // A taller bbox would silently widen the view instead.
            var halfMerc = (H * Math.PI / 180) * 0.45;
            var cy = mercY(lat);
            view = [lon - H, invY(cy - halfMerc), lon + H, invY(cy + halfMerc)];
            geolayers3.fitViewAtTime(CFG.mapcomp, view);
        }

        return { restyledGroups: groups, layers: layers.length, bbox: view,
                 next: "SOTD.mapFinalize() for full-resolution tiles" };
    };

    /** Slow: downloads a full tile set. Do this last, after the style settles. */
    api.mapFinalize = function () {
        geolayers3.finalize(CFG.mapcomp);
        return { started: true, note: "tiles download on the panel side; give it a moment" };
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

    /**
     * Step 1: write the still.
     *
     * saveFrameToPng only lands the file once the script returns — the write
     * shares this thread, so sleeping or polling for the file inside the same
     * call starves the very work being waited on and the file never appears.
     * Attaching it therefore has to happen in a LATER call, exactly like the
     * asynchronous geolayers3.draw above.
     */
    api.freezeMapRender = function (slug) {
        var comp = findItem("MAP · " + slug, CompItem);
        if (!comp) throw new Error("No MAP comp for '" + slug + "' — run buildWork first");

        var live = null, pins = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L.name === "MAP") live = L;
            else if (/^PIN /.test(L.name)) pins.push(L);
        }
        if (!live) return { rendered: false, reason: "already frozen" };

        // The pin stays a live layer on top of the still rather than being
        // burnt into it, so it can still be nudged after freezing.
        for (var p = 0; p < pins.length; p++) pins[p].enabled = false;
        var dir = new Folder(CFG.root + "/data/maps");
        if (!dir.exists) dir.create();
        comp.saveFrameToPng(0, new File(mapStillPath(slug)));
        for (var q = 0; q < pins.length; q++) pins[q].enabled = true;

        return { rendered: true, png: "data/maps/" + slug + ".png",
                 next: "SOTD.freezeMapAttach(\"" + slug + "\") in a LATER call" };
    };

    /** Step 2: swap the card over to the still and release the live mapcomp. */
    api.freezeMapAttach = function (slug) {
        var comp = findItem("MAP · " + slug, CompItem);
        if (!comp) throw new Error("No MAP comp for '" + slug + "'");
        var out = new File(mapStillPath(slug));
        if (!out.exists || out.length === 0)
            return { attached: false, reason: "still not written yet — call again in a moment" };

        var live = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (L.name === "MAP") live = L;
            else if (/^FROZEN/.test(L.name)) { L.remove(); i--; }
        }

        var still = importFileAs(mapStillPath(slug), "map-" + slug + ".png",
                                 folder(CFG.folders.assets));
        if (!still) return { attached: false, reason: "import failed — call again in a moment" };

        var sl = comp.layers.add(still);
        sl.name = "FROZEN MAP";
        sl.moveToEnd();
        if (live) {
            live.enabled = false;
            live.name = "MAP (live — disabled by freeze)";
        }
        return { attached: true, png: "data/maps/" + slug + ".png",
                 note: "mapcomp is now free for the next work" };
    };

    return api;
})();

// $.evalFile evaluates in the caller's scope, so a plain `var` here would be
// local to whichever function loaded the file and would vanish before the next
// MCP call. The async map workflow spans several calls, so publish it properly.
$.global.SOTD = SOTD;
SOTD;
