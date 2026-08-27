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
        works: ["mozart-linz", "brahms-no-4", "shostakovich-leningrad",
                "beethoven-no-1", "beethoven-no-2", "beethoven-no-3",
                "beethoven-no-4", "beethoven-no-5", "beethoven-no-6",
                "beethoven-no-7", "beethoven-no-8", "beethoven-no-9"],

        mapcomp: "Europe",
        mapcompContainer: "containing Europe",

        // GEOlayers' global tile cache. The only honest witness to whether a
        // finalize downloaded anything — see api.mapFinalizeStatus.
        // Matches preferences.json -> tilesPath.
        tilesPath: Folder.userData.fsName + "/aescripts/GEOlayers3/tiles",

        // Bands down each face, top to bottom, in card pixels. They tile the
        // interior exactly (588 px), so changing one height moves everything
        // below it and nothing has to be re-measured by hand.
        // `front.rule` matches the 2 px hairlines that divide the stat columns,
        // so the band reads as one ruled table rather than a heavy sandwich.
        // The 6 px that came off the two rules went to the portrait, which
        // keeps everything from the stats down at the y it was already at.
        front: { strap: 78, portrait: 268, rule: 2, stats: 70, title: 124, life: 44 },
        // Card 2 is the fact card. Its strap carries a "PLACE OF COMPOSITION"
        // heading and the place itself on up to two lines; everything below the
        // map is a list of labelled facts — see buildFactList.
        //
        // The strap came down from 120 to 96 (place 40 px → 24 px) and the 24 px
        // went to the slab, because four facts need the room and the address
        // does not. 24 px is also where the set stops fighting the type: at 40
        // every one of the twelve stepped down to fit, at 24 ten of them need no
        // step at all and only the two "Heiligenstadt, and Vienna" works come
        // down a size. Measured, not guessed — SOTD.measurePlaces().
        //
        // `map` must stay 214: it is the height the frozen sequence in
        // data/maps/<slug>/ was baked at, so changing it turns a rebuild into a
        // re-bake of every frozen work. Moving the map DOWN the card is free —
        // the still is placed in card space — which is why the strap could
        // shrink without touching a single bake.
        //
        // `strapGap` is the gap between the measured ink of the heading and the
        // measured ink of the place line. Card 2's strap is STACKED — the pair
        // is centred on the plate as one block instead of each line being
        // pinned to a fixed y — so this is the only vertical number the strap
        // has, and it means the same thing whether the place wraps or not.
        // See strapStackExpr.
        back:  { strap: 96, rule: 2, map: 214, slab: 274, strapGap: 13 },

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
            place:     24,   // the loudest thing on card 2 — see CFG.back
            placeLabel: 15,  // the "PLACE OF COMPOSITION" heading over it
            // The fact list. Label and body share a line, so they are one text
            // layer with two styled ranges (see buildFactList) — which is why
            // the label can sit at 16 while the body sits at 19. Trajan at 200
            // tracking is wide: at 19 the labels alone eat two thirds of a line
            // and the list overflows the slab, so the label stays behind at 16.
            // The body went 18 → 19 on 25 Aug 2026: the card lost 14% of its
            // size when the reel went full-bleed, and 18 was the reel's floor,
            // not a comfortable reading size. It costs a line of the slab's
            // budget — see "Keep the facts short" in docs/reel-cards.md.
            factLabel: 16,
            factBody:  19,
            mapLabel:  20    // the focus country, printed on the map
        },

        // Card 2's four facts, in the order they are stacked. `key` is the field
        // in the work JSON's `facts` object; `label` is the run-in heading, and
        // for three of the four it is card structure rather than data — a work
        // does not get to rename one, it only gets to leave the value out, and
        // an empty fact closes up rather than leaving a hole.
        //
        // The first fact is the exception, and `labelKey` is how. Its number can
        // come from three different places — what the composer specified, who
        // actually played the premiere, or what the score's parts add up to —
        // and those are not the same claim. "SCORED FOR 69 players" says the
        // composer asked for 69; "PREMIERE ORCHESTRA 69 players" says only that
        // 69 turned up. So the label travels with the value, chosen upstream by
        // SCORING_PRIORITY in research_to_work.py. `label` here is the fallback
        // when a work has no override.
        facts: [
            { key: "scored_for",        label: "SCORED FOR",
              labelKey: "scored_for_label" },
            { key: "first_performance", label: "FIRST PERFORMANCE" },
            { key: "occasion",          label: "OCCASION" },
            { key: "listen_for",        label: "LISTEN OUT FOR" }
        ],
        fact: { gap: 9, padTop: 14, pad: 14 },

        // Cambria for text, Trajan Pro 3 for caps.
        //
        // Trajan is an Adobe Fonts activation, not a Windows font, and it went
        // missing once: AE substituted a placeholder sans and said nothing, and
        // a week of cards shipped with the wrong face on the loudest line of
        // both. api.fontCheck() now asks AE outright whether each of these is
        // real, and buildWork refuses to run if any is not — so if the
        // activation lapses again the build stops instead of quietly changing
        // the typeface.
        //
        // `capsBold` is Trajan Regular deliberately, not a mistake: Trajan Pro
        // 3 ships Regular ALONE. There is no TrajanPro3-Bold to ask for, and
        // asking is worse than useless — AE would substitute for it silently.
        // The runs that want extra weight get it from size and tracking.
        //
        // The `upper` flag on a cardStrap run is redundant under Trajan, which
        // has no lowercase to draw, and load-bearing under anything else. It
        // stays either way.
        font: {
            serif:    "Cambria",
            bold:     "Cambria-Bold",
            italic:   "Cambria-Italic",
            caps:     "TrajanPro3-Regular",
            capsBold: "TrajanPro3-Regular"
        },

        col: {
            cream:  [0.957, 0.925, 0.863],   // #F4ECDC — every mark on the card
            ink:    [0.078, 0.067, 0.059],   // #14110F — the ring and the fact slab
            // Cream at 78% over ink, worked out rather than faded: the fact
            // labels are a styled RANGE inside a text layer, and the range API
            // can set a fill colour but has no opacity. Every other 78% label
            // on the cards is its own layer and gets there with fade().
            dimLabel: [0.764, 0.736, 0.686],
            bg:     [0.055, 0.051, 0.047],
            // Used only when a work's period is missing from periods.json.
            // The real palette is the "color" field on each period there.
            //
            // Deliberately graphite and not one of the four: it used to be
            // crimson, which was safe while no period WAS crimson, and became
            // a silent lie the day Romantic went red — an unfiled work would
            // have painted itself Romantic and looked entirely correct. A
            // colour that belongs to no period is the only one that shows.
            period: [0.227, 0.227, 0.243]    // #3A3A3E
        },

        // Duotone strength. The map basemap is far lighter than any portrait,
        // so it needs less lifting or the panel goes chalky.
        duotone: { portraitLift: 16, mapLift: 10 },

        // How the historical borders are inked, and how the one country that
        // matters is picked out of them. api.mapFinish paints both.
        //
        // **Contrast here has to be tonal, not chromatic.** The MAP sub-comp
        // desaturates the map and then multiplies the period colour over it, so
        // every hue set on the geometry is thrown away before a viewer sees a
        // frame — a focus colour that differs from its neighbours only in hue
        // arrives on the card identical to them. The two differ in *value*
        // instead, which survives any period colour the card is painted in.
        //
        // **And the focus country is the one that gets left alone.** The
        // obvious way round — a strong wash on the focus, neighbours untouched
        // — was built first and is wrong, for a reason only a render shows: the
        // move ends at a 6° half-span, and at that width the focus country
        // usually fills the whole frame. A wash heavy enough to read at the
        // continental end then flattens every trace of terrain out of the final
        // frame, which is the frame the viewer actually dwells on. Dimming the
        // neighbours instead gives the same separation while the map is wide,
        // and costs nothing at the end, when there are no neighbours in shot.
        mapInk: {
            // The context: pushed back with a dark wash.
            fill: [0.16, 0.13, 0.11], fillOpacity: 34,
            stroke: [0.24, 0.21, 0.19], strokeOpacity: 88,
            // Border weight at the reference half-span of 6°. fitViewAtTime
            // zooms by rescaling the anchor layer, which scales strokes with
            // it, so mapFinish scales this the other way.
            strokeWidth: 2.0,
            focus: {
                // A lift barely heavier than nothing — enough to separate it
                // from the dimmed neighbours, light enough that the shaded
                // relief still reads through it at full zoom.
                fill: [0.98, 0.96, 0.91], fillOpacity: 16,
                stroke: [0.10, 0.09, 0.08], strokeOpacity: 100,
                strokeScale: 1.8          // × the ordinary border weight
            }
        },

        // The focus country's name, printed ON the map — a GEOlayers label,
        // pinned to a point inside the territory and scaling with the zoom, so
        // it reads as cartography rather than as a caption laid over the top.
        //
        // This is a deliberate reversal of an earlier design that put the label
        // in the MAP sub-comp at a constant size. Two consequences follow from
        // it being inside the mapcomp, and both are the price of the effect:
        // the label is **baked** into a frozen map, so re-wording one means
        // re-baking that work; and it moves with the territory rather than
        // staying put, so where it sits is a computed anchor, not a corner.
        mapLabel: {
            template: "05 Region",   // GEOlayers label template comp
            // The one place the caps face is NOT Trajan, and it is measured,
            // not a preference. "HABSBURG MONARCHY" is 281 px of the panel's
            // 412 in Trajan and 217 px in Cambria, and the room between the
            // territory's western border and the card edge is about 300 px.
            // In Trajan the name spills over the border and prints across a
            // neighbour the highlight has deliberately dimmed; only shrinking
            // it to the point of illegibility fits, and this label already
            // renders at about 11 phone px.
            //
            // It reads as cartography rather than as part of the card's own
            // typography anyway — black on the land, the only mark on the
            // design that is not cream. Set this to CFG.font.caps to unify
            // them, then look at a render before believing it fits.
            font:     "Cambria",
            // Type size in the template's own 1000×600 comp, shrunk to fit if
            // the polity's name is long. Measured, not guessed — see fitLabel.
            size:     60,
            minSize:  30,
            fitMargin: 60,           // px of the template comp to keep clear
            // One line, always. The stock template's plate is cut from a
            // Minimax-dilated copy of the text, and it only bridges a single
            // line: a wrapped name comes out with its second line unplated and
            // floating. A country name printed right across its territory is
            // the atlas look anyway.
            wrapOver: 999,
            leading:  1.15,          // × size; the template's own is set for 35 pt
            tracking: 30,
            // How big the label is, in percent, at the END of the move.
            //
            // The layer's own scale is solved backwards from this, because
            // GEOlayers' "Scale with Map" expression multiplies by the map's
            // scale using a `scaleFactor` it bakes in when the label is created
            // — from whatever view the comp was sitting on at the time. So the
            // raw number on the property is not meaningful and is never set by
            // hand; mapLabel probes the expression and solves for it.
            //
            // The label is then locked to the land: over a 30° → 6° move it is
            // exactly a fifth of this at the continental opening, and nothing
            // can change that ratio without breaking the lock. If the opening
            // needs a bigger label, shorten the move with CFG.map.startSpan.
            // The label has to fit *inside the bright country*, not merely
            // inside the frame: spilling past a border prints the name over a
            // neighbour the highlight has deliberately dimmed. At 92,
            // "HABSBURG MONARCHY" measures 221 of the panel's 412 px, which
            // leaves room on both sides once the anchor is nudged off the pin.
            // It was 281 px in Trajan — the caps are Cambria now, ~15%
            // narrower, so this got easier when the type changed.
            endScale: 92,
            // Black type straight onto the land, no plate. The focus country is
            // the brightest thing in frame by construction, so the name reads
            // against it without a box — and the template's box is cut from a
            // Minimax dilation of the text that does not keep pace with type
            // this large, so it came out narrower than the word it was behind.
            // This is the one mark on the design that is not cream, because
            // here the map is the light ground.
            color:  [0.078, 0.067, 0.059],
            plate:  false
        },

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
        // Instagram's own furniture, in reel pixels: the header at the top,
        // the like/comment/share rail down the right, and the username, caption
        // and audio ticker along the bottom. Nothing that has to be read may
        // sit outside this box.
        //
        // These are conservative approximations, not published numbers — Meta
        // does not give exact figures and the UI moves between app versions. So
        // they are here, in one place, and `buildReel` draws them as a guide
        // layer: post one test reel, screenshot it on the phone, and correct
        // these four values rather than nudging any layer.
        // `bottom` was 380 and is 310 because the caption band was placed by
        // eye at y 1562, which puts the widest plate's lower edge at 1603 — so
        // 380 was a guess the layout had already overruled. 310 contains it
        // with room, and sits inside the 300–320 the platform is usually said
        // to take. Still a guess until a phone says otherwise.
        safe: { top: 220, bottom: 310, left: 60, right: 200 },

        // Where the single card sits, and how big. The video is full-bleed
        // behind it now, which changes both numbers: the card came down from
        // 175% and moved left of centre, because the right-hand 200 px belongs
        // to Instagram's button rail and a centred card ran under it.
        //
        // Sitting low is deliberate. The card's bottom edge stops just above
        // the caption band, which leaves the top third of the frame — where a
        // face actually is — uncovered.
        // `anchor` is the point of the card that sits on the rig, in card
        // pixels — [220, 78] is centred horizontally and near the top edge, so
        // the card HANGS from a point high in the frame rather than being
        // centred on one. That is what keeps the top third clear for a face
        // while the card still reaches down to the caption band.
        //
        // Set by hand in the comp and read back rather than calculated: 120%
        // and this anchor are where the framing looked right, and the numbers
        // are a record of that judgement.
        overlay: { x: 470, y: 838, scale: 120, anchor: [220, 78] },

        // The subtitles. Cream on a translucent ink plate, because they are
        // over a moving picture rather than over the card's flat colour, and
        // cream alone will not survive a light frame.
        //
        // `centerY` is the middle of the band; the plate is measured to the
        // text, so a one-word line does not get a full-width slab.
        // Sized and placed to match the comp, then flattened: the band was set
        // by scaling the caption layer to 111%, and a pre-comp scaled up is a
        // pre-comp resampled — soft type for no reason. The same look, with the
        // size set on the type itself, is sharp.
        caption: {
            size: 51, leading: 62, box: [910, 211], centerY: 1562,
            plateOpacity: 66, platePad: [33, 18], plateRound: 13
        },

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
                // Size on the LONGEST line, not the whole string. A field that
                // sets its own break — the place line breaks itself at the
                // comma — is as wide as its widest line, and measuring the
                // total instead shrinks it for length it never puts on a line.
                // Fields with no break in them split to one element, so this is
                // the character count it always was.
                'var ln = t.split("\\r"), n = 0;\n' +
                'for (var i = 0; i < ln.length; i++) if (ln[i].length > n) n = ln[i].length;\n' +
                'var size = ' + steps[0].size + ';\n';
        for (var i = 1; i < steps.length; i++) {
            s += 'if (n > ' + steps[i].over + ') size = ' + steps[i].size + ';\n';
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

    /**
     * Is this font really installed, or will AE quietly substitute for it?
     * The FontObject's own `isSubstitute` — see api.fontCheck for why the two
     * more obvious tests both pass for a font that does not exist.
     */
    function fontResolves(postScriptName) {
        try {
            var hits = app.fonts.getFontsByPostScriptName(postScriptName);
            return !!(hits && hits.length && !hits[0].isSubstitute);
        } catch (e) {
            return false;
        }
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
     *
     * Per run: `bold` picks the heavy face, `boxH` buys room for a second
     * line, and `upper` uppercases the string. `upper` is not decoration —
     * the caps face is Cambria now, which has a lowercase and will happily
     * draw it, so a run that must read as capitals has to say so.
     */
    function cardStrap(c, band, runs, stackGap) {
        addRect(c, {
            name: "STRAP plate", topLeft: [I.x, band.y],
            size: [I.w, band.h], fill: CFG.col.ink
        });
        var names = [];
        for (var n = 0; n < runs.length; n++) names.push(runs[n].name);
        for (var i = 0; i < runs.length; i++) {
            var r = runs[i];
            var bh = r.boxH || (r.size + 14);
            var body = r.upper ? '(' + r.body + ').toUpperCase()' : r.body;
            var L = addText(c, poster({
                name: r.name, box: [I.w - 20, bh],
                topLeft: [I.x + 10, (r.centreY || band.mid) - bh / 2],
                font: r.bold ? CFG.font.capsBold : CFG.font.caps,
                size: r.size, tracking: r.tracking,
                centerY: stackGap === undefined ? r.centreY : undefined,
                justify: ParagraphJustification.CENTER_JUSTIFY,
                text: r.upper ? String(r.text).toUpperCase() : r.text,
                expr: r.body ? bindFitted(body, "", r.steps) : null
            }));
            if (stackGap !== undefined)
                L.property("ADBE Transform Group").property("ADBE Position")
                    .expression = strapStackExpr(names, i, band, stackGap,
                                                 I.x + I.w / 2);
            if (r.opacity !== undefined) fade(L, r.opacity);
        }
    }

    /**
     * Position expression for one run of a STACKED strap: the runs are measured
     * and centred on the plate as a single block, rather than each being pinned
     * to its own y.
     *
     * Pinning is what card 1 does and it is right there — the given names and
     * the surname are both always one line, so fixed centres and a centred
     * block are the same picture. Card 2's place line is allowed two, and a
     * pinned pair only ever grows DOWNWARD: every one of the twelve works
     * currently wraps, so the block sat about 4 px below the middle of the
     * plate with 9 px under it against 17 px over it, and read as crowding the
     * map rather than sitting in its field.
     *
     * `stackGap` is the gap between the measured ink of one run and the next,
     * so it means the same thing whether the place takes one line or two — the
     * whole block just re-centres, the way an omitted fact re-centres the fact
     * list. It is 13 px because that is what the pinned centres worked out to
     * for a two-line place, so the spacing a viewer already knows is preserved
     * and only the drift is corrected.
     *
     * Every run reads every run's sourceRect, including its own. That is safe
     * rather than circular: sourceRectAtTime is measured in layer space and
     * does not depend on any layer's position.
     */
    function strapStackExpr(names, index, band, gap, cx) {
        var quoted = [];
        for (var i = 0; i < names.length; i++) quoted.push(q(names[i]));
        var NL = "\n";
        return 'var G = ' + gap + ';' + NL +
               'var N = [' + quoted.join(", ") + '];' + NL +
               'var H = [], T = 0;' + NL +
               'for (var i = 0; i < N.length; i++) {' + NL +
               '  H[i] = thisComp.layer(N[i]).sourceRectAtTime(time, false).height;' + NL +
               '  T += H[i] + (i ? G : 0);' + NL +
               '}' + NL +
               'var top = ' + band.mid + ' - T / 2;' + NL +
               'for (var j = 0; j < ' + index + '; j++) top += H[j] + G;' + NL +
               'var me = thisLayer.sourceRectAtTime(time, false);' + NL +
               '[' + cx + ', top + H[' + index + '] / 2 - (me.top + me.height / 2)];';
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
              opacity: 76, text: "GIVEN NAMES", upper: true,
              body: 'D.composer.name.split(" ").slice(0, -1).join(" ")',
              steps: [{ size: T.given }, { over: 18, size: 17 }] },
            { name: "SURNAME", size: T.surname, tracking: 20, centreY: FB.strap.y + 52,
              text: "SURNAME", upper: true, bold: true,
              body: '(D.composer.surname || D.composer.name.split(" ").pop())',
              steps: [{ size: T.surname }, { over: 12, size: 40 },
                      { over: 15, size: 34 }, { over: 19, size: 26 }] }
        ]);

        // Same weight as the STAT dividers between the columns, so the three
        // stats read as one ruled table. They stay at full cream while the
        // dividers sit back at 45%: these two close the band, the dividers
        // only subdivide it.
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

    /**
     * The card's answer to "where was this written": city and polity as one
     * address. Either half can be missing — a work with no `country_then` still
     * prints its city, and drops the comma with it.
     *
     * When it is too long for one line the string breaks ITSELF, at the comma,
     * so the polity starts the second line. Left to wrap on its own AE breaks
     * wherever the box runs out — "VIENNA, ARCHDUCHY OF / AUSTRIA" — which
     * splits the country's name across two lines and reads as two facts again,
     * which is the thing this line exists to stop.
     */
    /**
     * How the place line shrinks, keyed on its LONGEST line. One definition,
     * because api.measurePlaces has to measure the same steps buildCardBack
     * draws — they were duplicated for one build and the copy went stale the
     * moment the caps face changed, which is how "ARCHDUCHY OF AUSTRIA" lost
     * "AUSTRIA" off the bottom of its box.
     *
     * The numbers are for Trajan Pro 3, which is appreciably wider than
     * Cambria. Re-measure with SOTD.measurePlaces() after ANY change to
     * CFG.font.capsBold or the strap's box, and read the `lines` column: the
     * box holds two, and a third is clipped rather than overflowing.
     */
    // Thresholds are the LONGEST line, not the whole string, and they were
    // measured against the real face — see api.measurePlaces. The base size is
    // 24 rather than the old 40, so most works never step at all: only an
    // address whose longest line runs past ~25 characters comes down.
    // The first threshold is 21 and not something rounder because it was
    // measured, and because nothing in the current twelve tests it: their
    // longest lines are 12–20 characters or 26, with nothing in between. At
    // 24 px a 20-character line already measures 350 px of the 392 px box, so
    // 22 would sail past the edge — and the overflow would be invisible until
    // some future work happened to land there.
    var PLACE_STEPS = [{ size: 24 }, { over: 21, size: 21 },
                       { over: 27, size: 19 }, { over: 32, size: 17 }];

    var PLACE_LINE =
        '(function () {\n' +
        '  var P = D.composition.place, C = D.composition.country_then;\n' +
        '  var one = [P, C].filter(function (s) { return s; }).join(", ");\n' +
        '  return (P && C && one.length > 16) ? (P + ",\\r" + C) : one;\n' +
        '})()';

    function buildCardBack(slug, mapComp, work, worksFolder) {
        var c = makeComp("CARD BACK · " + slug, CFG.card.w, CFG.card.h,
                         CFG.reel.dur, worksFolder);
        var p = CFG.mapPanel, T = CFG.type;
        var here = !!work.map.has_place;

        cardGround(c);

        // Card 2 is the fact card: where it was written, then a list of
        // labelled facts. The year and the composer are card 1's job, so the
        // place gets the strap.
        //
        // City and polity used to be two runs — the place in the strap, the
        // country in italics on its own band under it. Nothing said what the
        // pair WAS, and stacked like that they read as two unrelated facts
        // rather than one address. So they are one string now, "Vienna,
        // Archduchy of Austria", under a heading set exactly like OCCASION and
        // LISTEN OUT FOR at the bottom of the same card: same face, same 18 px,
        // same 200 tracking, same 78% — three headings, one system.
        //
        // That string is long, and it is allowed TWO lines. `boxH` is 62, which
        // holds two lines at any size the steps can choose (24 × 1.2 × 2 = 58);
        // a third line would be clipped below the box rather than overflow it,
        // so the steps have to keep it to two. They were measured, not guessed
        // — see api.measurePlaces.
        // Stacked, not pinned: the heading and the address are centred on the
        // plate as one measured block, so a place that wraps to two lines grows
        // in both directions instead of only down into the map. Card 1's strap
        // stays pinned — both of its runs are always one line, so there is
        // nothing for a stack to fix. See strapStackExpr and CFG.back.strapGap.
        cardStrap(c, BB.strap, [
            { name: "PLACE label", size: T.placeLabel, tracking: 200,
              opacity: 78, text: "PLACE OF COMPOSITION" },
            { name: "PLACE", size: T.place, tracking: 20,
              boxH: 62, bold: true, upper: true, text: "PLACE",
              body: PLACE_LINE,
              // Thresholds are the LONGEST line, not the whole string.
              steps: PLACE_STEPS }
        ], CFG.back.strapGap);

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

        buildFactList(c);

        cardChrome(c);
        addDataLayer(c, slug);
        return c;
    }

    /**
     * The bottom of card 2: a list of labelled facts, stacked.
     *
     * Each fact is ONE text layer carrying two styled ranges — the label in
     * Trajan caps, then the fact itself in Cambria sentence case, continuing on
     * the same line and wrapping flush under it. That is only possible because
     * the expression Text Style API takes a character range: `setFont(f, 0, n)`
     * styles the first n characters and leaves the rest alone. Two layers could
     * not do it; a run-in heading is one paragraph, and a second box cannot
     * begin partway along another box's first line.
     *
     * The range API sets a fill colour but has no opacity, so the label's 78%
     * is a mixed colour (CFG.col.dimLabel) rather than a faded layer.
     *
     * Stacking is a chain: each fact sits under the measured bottom of the one
     * above it, so a wrapped fact pushes the rest down and an EMPTY fact costs
     * nothing at all — its rect is zero-high, the gap is skipped, and the list
     * closes up. There is no divider rule between them; the labels do that work,
     * and the two rules the old design used were worth about 40 px.
     *
     * These are the only paragraphs on either card and they are the first thing
     * to go unreadable on a phone. They do not step down — the size is fixed —
     * so length is a real constraint: about 80 characters per fact, and the four
     * of them together must fit CFG.back.slab. Longer, and the last one is
     * clipped below the slab rather than resized.
     */
    function buildFactList(c) {
        var S = BB.slab, T = CFG.type, F = CFG.fact;
        var textX = I.x + F.pad, textW = I.w - F.pad * 2;
        // The ink panel the facts sit on. Fixed, unlike the old story slab that
        // grew and shrank: the facts centre themselves inside it instead.
        addRect(c, {
            name: "FACT slab", topLeft: [I.x, S.y], size: [I.w, S.h],
            fill: CFG.col.ink
        });

        var prev = null;
        var names = [];
        for (var n = 0; n < CFG.facts.length; n++) {
            names.push('"FACT ' + (n + 1) + ' ' + CFG.facts[n].label + '"');
        }

        // Centre the stack in the slab rather than hanging it from the top, so
        // a work with nothing researched for one of the facts closes up around
        // the hole instead of leaving it at the bottom. Summing the others'
        // heights is safe: sourceRectAtTime measures a text layer in its OWN
        // space, so reading every layer's rect from the first layer's position
        // cannot loop back on itself.
        var stackTop =
            'var names = [' + names.join(", ") + '];\n' +
            'var total = 0, shown = 0;\n' +
            'for (var i = 0; i < names.length; i++) {\n' +
            '  var h = thisComp.layer(names[i]).sourceRectAtTime(time, false).height;\n' +
            '  if (h > 1) { total += h; shown++; }\n' +
            '}\n' +
            'if (shown > 1) total += ' + F.gap + ' * (shown - 1);\n' +
            'var target = ' + S.y + ' + Math.max(' + F.padTop + ', (' + S.h + ' - total) / 2);\n';

        for (var i = 0; i < CFG.facts.length; i++) {
            var f = CFG.facts[i];
            var name = "FACT " + (i + 1) + " " + f.label;

            // The box is the height of the whole slab so a long fact can wrap
            // as far as it needs; what keeps the list tidy is the measured
            // stacking below, not the box.
            var L = addText(c, poster({
                name: name, box: [textW, S.h], topLeft: [textX, S.y],
                font: CFG.font.serif, size: T.factBody,
                leading: T.factBody * 1.28,
                justify: ParagraphJustification.LEFT_JUSTIFY,
                text: f.label + " " + f.key,
                expr: factExpr(f)
            }));

            // Sit the TEXT's top edge at `target`, not the box's: box text is
            // top-aligned inside its box but the box is centred on the layer
            // position, so everything here is measured off sourceRectAtTime.
            // An empty layer measures zero-high, which makes its own bottom
            // equal to its target and passes the position straight down the
            // chain to the next fact.
            var target = prev
                ? ('var p = thisComp.layer("' + prev + '");\n' +
                   'var pr = p.sourceRectAtTime(time, false);\n' +
                   'var pTop = p.transform.position[1] + pr.top;\n' +
                   'var target = pTop + pr.height + (pr.height > 1 ? ' + F.gap + ' : 0);\n')
                : stackTop;

            L.property("ADBE Transform Group").property("ADBE Position").expression =
                target +
                'var r = thisLayer.sourceRectAtTime(time, false);\n' +
                '[' + (textX + textW / 2) + ', target - r.top];';

            prev = name;
        }
    }

    /**
     * One fact's sourceText: "LABEL value", with the label styled as a range.
     *
     * Returns the empty string when the work has no value for this fact, which
     * is what makes the layer measure zero-high and drop out of the stack.
     */
    function factExpr(f) {
        // A `labelKey` fact reads its heading from the work too. The label is
        // measured at RUN time (`n = lab.length`), not baked in, so a longer
        // override styles the right number of characters — the whole trick here
        // is that the caps range is the first n characters of the string.
        var override = f.labelKey
            ? ('try {\n' +
               '  var lx = D.facts.' + f.labelKey + ';\n' +
               '  if (lx !== null && lx !== undefined && lx !== "") lab = lx.toString();\n' +
               '} catch (e) {}\n')
            : '';
        return bindPrelude() +
            'var v = "";\n' +
            'try {\n' +
            '  var x = D.facts.' + f.key + ';\n' +
            '  if (x !== null && x !== undefined) v = x.toString();\n' +
            '} catch (e) {}\n' +
            'var lab = ' + q(f.label) + ';\n' +
            override +
            'lab = lab + " ";\n' +
            'var st;\n' +
            'if (v === "") {\n' +
            '  st = text.sourceText.style.setText("");\n' +
            '} else {\n' +
            '  var n = lab.length;\n' +
            '  st = text.sourceText.style.setText(lab + v)\n' +
            '    .setFont(' + q(CFG.font.serif) + ').setFontSize(' + CFG.type.factBody + ')\n' +
            '    .setLeading(' + (CFG.type.factBody * 1.28) + ')\n' +
            '    .setFont(' + q(CFG.font.caps) + ', 0, n)\n' +
            '    .setFontSize(' + CFG.type.factLabel + ', 0, n)\n' +
            '    .setTracking(200, 0, n)\n' +
            '    .setFillColor([' + CFG.col.dimLabel.join(", ") + '], 0, n);\n' +
            '}\n' +
            'st;';
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

    // --------------------------------------------------------- captions comp

    /**
     * The subtitles, one comp, one layer per line.
     *
     * The lines and their times come from `video.captions` in the work JSON,
     * which `take_align.py` derives from the recording. Nothing is typed here
     * and nothing is keyframed: a caption is a layer with an in point and an
     * out point, so re-cutting the take and rebuilding replaces the lot.
     *
     * The text is the *script*, not what the recogniser heard. See
     * `take_align.py` — the recogniser supplies times and nothing else.
     */
    function buildCaptions(slug, work, dur, worksFolder) {
        var R = CFG.reel, K = CFG.caption, V = CFG.overlay;
        var caps = (work.video && work.video.captions) || [];
        var c = makeComp("CAPTIONS · " + slug, R.w, R.h, dur, worksFolder);
        // Built even when empty, so the reel always has the layer to point at
        // and a work with no take yet still assembles.
        for (var i = 0; i < caps.length; i++) {
            var cap = caps[i];
            // Numbered, not named after the line: the plate finds its text by
            // name from inside an expression, and caption text is full of
            // apostrophes and commas.
            var tName = "cap " + (i + 1);
            var T = addText(c, {
                name:    tName,
                text:    cap.text,
                font:    CFG.font.serif,
                size:    K.size,
                leading: K.leading,
                color:   CFG.col.cream,
                justify: ParagraphJustification.CENTER_JUSTIFY,
                box:     K.box,
                topLeft: [V.x - K.box[0] / 2, K.centerY - K.box[1] / 2],
                centerY: K.centerY
            });

            // The plate is measured to the ink, not to the text box, so a
            // three-word line gets a three-word plate. Both properties read the
            // same sourceRectAtTime, so they cannot disagree about where the
            // words are.
            var ref = 'var T = thisComp.layer(' + q(tName) + ');\n' +
                      'var r = T.sourceRectAtTime(time, false);\n';
            var P = addRect(c, {
                name:    "plate " + (i + 1),
                size:    [K.box[0], K.box[1]],
                topLeft: [V.x - K.box[0] / 2, K.centerY - K.box[1] / 2],
                round:   K.plateRound,
                fill:    CFG.col.ink,
                fillOpacity: K.plateOpacity
            });
            P.property("ADBE Root Vectors Group").property("rect")
             .property("ADBE Vectors Group").property("ADBE Vector Shape - Rect")
             .property("ADBE Vector Rect Size").expression =
                ref + '[r.width + ' + (K.platePad[0] * 2) + ', r.height + ' +
                (K.platePad[1] * 2) + '];';
            P.property("ADBE Transform Group").property("ADBE Position").expression =
                ref + 'T.toComp([r.left + r.width / 2, r.top + r.height / 2]);';
            // addShape/addBoxText both insert at the top, so the plate lands
            // over its own text. Put it back underneath.
            P.moveAfter(T);

            T.inPoint = cap.t;
            T.outPoint = cap.t + cap.d;
            P.inPoint = cap.t;
            P.outPoint = cap.t + cap.d;
        }
        return c;
    }

    // ------------------------------------------------------------- reel comp

    /**
     * Guide rectangles for Instagram's furniture. Not rendered — but the whole
     * layout is pinned to them, so being able to see them in the viewer is the
     * difference between measuring and guessing.
     */
    function addGuideBox(comp, name, topLeft, size, colour) {
        var L = comp.layers.addShape();
        L.name = name;
        L.guideLayer = true;
        var g = L.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        var vs = g.property("ADBE Vectors Group");
        var r = vs.addProperty("ADBE Vector Shape - Rect");
        r.property("ADBE Vector Rect Size").setValue(size);
        var st = vs.addProperty("ADBE Vector Graphic - Stroke");
        st.property("ADBE Vector Stroke Color").setValue(colour.concat([1]).slice(0, 4));
        st.property("ADBE Vector Stroke Width").setValue(2);
        L.position.setValue([topLeft[0] + size[0] / 2, topLeft[1] + size[1] / 2]);
        return L;
    }

    function buildReel(slug, work, frontComp, backComp, worksFolder) {
        var R = CFG.reel, V = CFG.overlay, S = CFG.safe, K = CFG.caption;
        var vid = work.video || {};
        var tim = vid.timings || {};

        // The reel is as long as the take. Only a work with no recording yet
        // falls back to the nominal 30 seconds.
        var dur = vid.duration ? Math.ceil(vid.duration * R.fps) / R.fps : R.dur;
        var revealStart = (tim.revealStart === undefined) ? CFG.reveal.start : tim.revealStart;
        var revealDur   = (tim.revealDuration === undefined) ? CFG.reveal.duration : tim.revealDuration;
        var turnAt      = (tim.turnAt === undefined) ? CFG.reveal.turnAt : tim.turnAt;
        var turnDur     = (tim.turnDuration === undefined) ? CFG.reveal.turnDuration : tim.turnDuration;

        var c = makeComp("SOTD Reel · " + slug, R.w, R.h, dur, worksFolder);
        c.bgColor = CFG.col.bg;

        var bg = c.layers.addSolid(CFG.col.bg, "BG", R.w, R.h, 1, dur);
        bg.locked = true;

        // The take, full-bleed behind everything. Scaled to cover rather than
        // to fit: a letterboxed talking head inside a vertical frame is the one
        // thing this layout cannot look like.
        //
        // `video.framing` reframes the shot when the card lands on the face.
        // The card cannot move — it is the same rectangle in every reel of the
        // series — so the person moves instead: `zoom` multiplies cover and
        // `x`/`y` place the centre, both in the reel's own pixels. It lives on
        // the work rather than in CFG because it is a fact about one take's
        // headroom, not about the layout.
        if (vid.take) {
            var takeItem = importFileAs(CFG.root + "/" + vid.take, "take · " + slug,
                                        folder(CFG.folders.assets));
            if (takeItem) {
                var VL = c.layers.add(takeItem);
                VL.name = "VIDEO · take";
                var fr = vid.framing || {};
                var zoom = (fr.zoom === undefined) ? 1 : fr.zoom;
                var cover = Math.max(R.w / takeItem.width, R.h / takeItem.height) * 100 * zoom;
                var VT = VL.property("ADBE Transform Group");
                VT.property("ADBE Scale").setValue([cover, cover]);
                VT.property("ADBE Position").setValue([
                    (fr.x === undefined) ? R.w / 2 : fr.x,
                    (fr.y === undefined) ? R.h / 2 : fr.y]);
                VL.startTime = 0;
            }
        }

        var safeW = R.w - S.left - S.right, safeH = R.h - S.top - S.bottom;
        addGuideBox(c, "SAFE — Instagram furniture", [S.left, S.top], [safeW, safeH],
                    [0.35, 0.33, 0.30]);
        addGuideBox(c, "SAFE — caption band",
                    [V.x - K.box[0] / 2, K.centerY - K.box[1] / 2], K.box,
                    [0.30, 0.28, 0.26]);

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

        // Seeded from the work's own timings when it has a take: the four
        // numbers come out of the recording, not out of CFG. They are still
        // sliders, so a judgement call is a drag rather than a re-run.
        var ctrl = c.layers.addNull(dur);
        ctrl.name = "CTRL";
        ctrl.guideLayer = true;
        slider(ctrl, "Reveal Start", revealStart);
        slider(ctrl, "Reveal Duration", revealDur);
        slider(ctrl, "Turn At", turnAt);
        slider(ctrl, "Turn Duration", turnDur);
        slider(ctrl, "Overlay X", V.x);
        slider(ctrl, "Overlay Y", V.y);
        slider(ctrl, "Overlay Scale", V.scale);

        var rig = c.layers.addNull(dur);
        rig.name = "RIG";
        rig.threeDLayer = true;
        rig.guideLayer = true;
        rig.property("ADBE Transform Group").property("ADBE Position").expression =
            'var C = thisComp.layer("CTRL");\n' +
            '[C.effect("Overlay X")("Slider"), C.effect("Overlay Y")("Slider"), 0];';
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
            // Both faces take the same anchor, or they would not read as one
            // card being turned over. The x half must stay at the card's
            // horizontal centre: it is the axis the flip spins about.
            CT.property("ADBE Anchor Point")
              .setValue([V.anchor[0], V.anchor[1], 0]);
            var sh = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sh.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
            sh.property("ADBE Drop Shadow-0002").setValue(165);   // opacity
            sh.property("ADBE Drop Shadow-0004").setValue(16);    // distance
            sh.property("ADBE Drop Shadow-0005").setValue(32);    // softness
            return L;
        }

        // CARD 1 — the details. Flips in from edge-on, then turns away.
        var one = placeCard(frontComp, "CARD 1 · details");
        // The card comps are built at the nominal length; the reel is as long
        // as the take. Trim rather than leave a layer hanging past the end.
        one.outPoint = c.duration;
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
                { name: "SFX · card 1 in", at: revealStart },
                { name: "SFX · turn over", at: turnAt }
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

        // Captions last, so they sit above the cards: a line of type that
        // disappears behind a turning card is worse than no line at all.
        var capComp = buildCaptions(slug, work, dur, worksFolder);
        var CL = c.layers.add(capComp);
        CL.name = "CAPTIONS";
        CL.moveToBeginning();

        return c;
    }

    // ------------------------------------------------------------------- api

    var api = {};
    api.CFG = CFG;

    /**
     * Does every font in CFG.font actually exist on this machine?
     *
     * This is here because it already went wrong once and shipped. Trajan Pro 3
     * stopped being activated, and AE did not error, warn, or log: it resolved
     * TrajanPro3-Regular to a placeholder family and drew a sans instead. On a
     * caps-only face the tell was lowercase letters in a render — nothing in
     * the DOM said anything was wrong — so a week of cards went out with the
     * wrong typography on the loudest line of both faces.
     *
     * The test that WORKS is `app.fonts` and the FontObject's `isSubstitute`.
     * Two plausible tests do not, and both were tried here first:
     *
     *  - Setting `td.font` and reading it back. AE echoes the name you asked
     *    for, verbatim, even for "NoSuchFontAtAll-Regular". Always passes.
     *  - `getFontsByPostScriptName` returning a hit. AE fabricates a
     *    placeholder FontObject for a name it has never seen, so this also
     *    always passes — and `fontFamily` on it is just your string parsed,
     *    which is why the old "is the family name spaced?" tell was so fragile.
     *
     * `isSubstitute` says so outright. A real font also reports a `location`
     * you can look at; the placeholder points into Adobe's livetype cache.
     * Returns one row per font; `ok` false on any of them means do not build.
     */
    api.fontCheck = function () {
        var out = [];
        // Every face the design actually asks AE for. CFG.mapLabel.font is in
        // here because it is allowed to differ from CFG.font.caps, and a face
        // that is only ever used inside the map is exactly the one a silent
        // substitution would survive longest in — it is baked, so it stops
        // being re-rendered as soon as the work is frozen.
        var faces = {};
        for (var k in CFG.font)
            if (CFG.font.hasOwnProperty(k)) faces[k] = CFG.font[k];
        if (CFG.mapLabel.font) faces["mapLabel"] = CFG.mapLabel.font;

        for (var key in faces) {
            if (!faces.hasOwnProperty(key)) continue;
            var want = faces[key], row = { key: key, want: want };
            var hits = app.fonts.getFontsByPostScriptName(want);   // see fontResolves
            if (!hits || !hits.length) {
                row.ok = false;
                row.why = "no such font";
            } else {
                var f = hits[0];
                row.family = f.familyName;
                row.style = f.styleName;
                row.location = String(f.location);
                row.ok = !f.isSubstitute;
                if (!row.ok) row.why = "substituted";
            }
            out.push(row);
        }
        return out;
    };

    /** Throw with a readable list if any font in CFG.font is being substituted. */
    function assertFonts() {
        var rows = api.fontCheck(), bad = [];
        for (var i = 0; i < rows.length; i++) {
            if (!rows[i].ok)
                bad.push(rows[i].key + " (" + rows[i].want + "): " + rows[i].why);
        }
        if (bad.length)
            throw new Error("Font not installed, AE would substitute silently — " +
                            bad.join("; ") + ". Activate it and restart AE; " +
                            "do not render until SOTD.fontCheck() is clean.");
    }

    /**
     * What card 2's place line actually measures, per work, at the size its
     * steps pick for it.
     *
     * Estimating this is how a digit got clipped once before: AE wraps box text
     * on ADVANCE width, but sourceRectAtTime reports INK width, so a string that
     * measures inside the box can still wrap.
     *
     * And measuring in the REAL box cannot detect the failure either, which is
     * the subtle part and cost a bad build: a third line does not overflow the
     * box, it is clipped by it, so sourceRectAtTime returns a height that still
     * fits and a line count that still says two. The overflow is invisible to
     * exactly the measurement you would reach for.
     *
     * So the probe uses a box of the real WIDTH but a huge height, where the
     * third line has somewhere to go and therefore shows up. `lines` is then
     * the true count and `fits` compares against the real 84 px.
     */
    api.measurePlaces = function (slugs) {
        slugs = slugs || CFG.works;
        var boxW = I.w - 20, boxH = 84, tallH = 600;
        var steps = PLACE_STEPS;
        var probe = app.project.items.addComp("__placeprobe", 800, 700, 1, 1, 25);
        var out = [];
        try {
            for (var i = 0; i < slugs.length; i++) {
                var w = api.readWork(slugs[i]);
                var P = w.composition.place, C = w.composition.country_then;
                var one = [];
                if (P) one.push(P);
                if (C) one.push(C);
                one = one.join(", ");
                var t = ((P && C && one.length > 16) ? (P + ",\r" + C) : one)
                        .toUpperCase();

                var ln = t.split("\r"), n = 0;
                for (var k = 0; k < ln.length; k++)
                    if (ln[k].length > n) n = ln[k].length;
                var size = steps[0].size;
                for (var s = 1; s < steps.length; s++)
                    if (n > steps[s].over) size = steps[s].size;

                // Real width, huge height — see above.
                var L = probe.layers.addBoxText([boxW, tallH], t);
                var P = L.property("ADBE Text Properties").property("ADBE Text Document");
                var td = P.value;
                td.font = CFG.font.capsBold;   // same face as the strap run
                td.fontSize = size;
                td.tracking = 20;
                td.autoLeading = false;
                td.leading = size * 1.2;
                td.boxTextSize = [boxW, tallH];
                P.setValue(td);

                var r = L.sourceRectAtTime(0, false);
                var lines = Math.round(r.height / (size * 1.2));
                out.push({
                    slug: slugs[i], text: t, longest: n, size: size,
                    inkW: Math.round(r.width), boxW: boxW,
                    lines: lines, height: Math.round(r.height),
                    fits: (lines <= 2 && r.height <= boxH)
                });
            }
        } finally {
            probe.remove();
        }
        return out;
    };

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
        assertFonts();
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
        var reel     = buildReel(slug, work, front, back, worksF);
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

    // ---------------------------------------------------------------- render

    /**
     * Render the reel to an MP4 Instagram will take.
     *
     * H.264 at 15 Mbps, which is inside Instagram's ceiling and well past the
     * point where its own re-encode is the limiting factor. The file lands in
     * `out/<slug>.ae.mp4`, which is not tracked — it is regenerable from the
     * project and the take, like every other binary here. One more step,
     * `scripts/reel_master.py`, sets the loudness and gives you the file to
     * post.
     *
     * This blocks After Effects until it finishes. A 27-second reel is a couple
     * of minutes; call it with a long timeout and do not touch AE meanwhile.
     */
    api.renderReel = function (slug, opts) {
        opts = opts || {};
        var name = "SOTD Reel · " + slug;
        var comp = findItem(name, CompItem);
        if (!comp) throw new Error("No reel comp for " + slug + " — build it first");

        var rq = app.project.renderQueue;
        // Anything already queued for this comp is a previous attempt. Leaving
        // it would render the same file twice and race for the handle.
        for (var i = rq.numItems; i >= 1; i--) {
            var it = rq.item(i);
            if (it.comp === comp && it.status !== RQItemStatus.DONE) it.remove();
        }

        var dir = new Folder(CFG.root + "/out");
        if (!dir.exists) dir.create();
        // ".ae.mp4" and not ".mp4": this is the render, not the upload.
        // scripts/reel_master.py normalises its audio into out/<slug>.mp4,
        // and giving the plain name to the file you actually post means you
        // cannot post the un-normalised one by reaching for the obvious file.
        var out = new File(dir.fsName + "/" + slug + ".ae.mp4");
        if (out.exists) out.remove();

        var item = rq.items.add(comp);
        item.applyTemplate("Best Settings");
        var om = item.outputModule(1);
        om.applyTemplate(opts.template || "H.264 - Match Render Settings - 15 Mbps");
        om.file = out;

        if (opts.queueOnly) return { queued: out.fsName, duration: comp.duration };

        rq.render();
        var done = item.status === RQItemStatus.DONE;
        return { rendered: done, file: out.fsName, exists: out.exists,
                 duration: comp.duration, status: String(item.status) };
    };

    // ------------------------------------------------------------------- map

    /**
     * What GEOlayers calls a drawn feature whose geojson NAME is null — and it
     * calls every one of them that, thirty-nine of them in the 1815 snapshot.
     * So this is the one group name that must never be used to target a
     * country. map_focus.py refuses to write it; this refuses to act on it.
     */
    var UNNAMED_GROUP = "Feature";

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

    /**
     * The name of the shape group to highlight, or "" for none.
     *
     * GEOlayers names every drawn group verbatim from the geojson `NAME`, so
     * this is a plain string match — but two things make it worth a function.
     * A feature with no NAME draws as a group called "Feature", and *every*
     * unnamed feature shares that name, so matching it would light up thirty
     * or forty unrelated polities at once. And the name has to come from
     * map_focus.py reading the same geojson the map was drawn from; anything
     * hand-typed is a guess at the dataset's spelling.
     */
    function focusName(work) {
        var f = work.map && work.map.focus;
        if (!f || !f.name) return "";
        var name = String(f.name);
        if (name === UNNAMED_GROUP || !name.replace(/^\s+|\s+$/g, "")) return "";
        return name;
    }

    /** Restyle the drawn borders, pick out the focus country, aim at the city. */
    api.mapFinish = function (slug) {
        var work = api.readWork(slug);
        var c = mapcomp();
        var layers = drawnLayers(c);
        var groups = 0, hit = 0;
        var K = CFG.mapInk, F = K.focus;

        // fitViewAtTime zooms by rescaling the mapcomp's anchor layer, which
        // scales the border strokes with it. Scale the width the other way so
        // borders land at the same apparent weight whatever the zoom.
        var span = work.map.half_span_lon || 6;
        var strokeWidth = K.strokeWidth * (span / 6);

        var focus = focusName(work);

        for (var n = 0; n < layers.length; n++) {
            var contents = layers[n].property("ADBE Root Vectors Group");
            for (var g = 1; g <= contents.numProperties; g++) {
                var group = contents.property(g);
                var vg = group.property("ADBE Vectors Group");
                if (!vg) continue;
                // A polity split across several features — Prussia is four in
                // 1815 — is several groups under one name, and all of them
                // have to light up or the country comes out in pieces.
                var isFocus = (focus !== "" && group.name === focus);
                if (isFocus) hit++;

                var fill = null, stroke = null;
                for (var v = 1; v <= vg.numProperties; v++) {
                    var pr = vg.property(v);
                    if (pr.matchName === "ADBE Vector Graphic - Fill") fill = pr;
                    if (pr.matchName === "ADBE Vector Graphic - Stroke") stroke = pr;
                }
                // Drawn features default to opaque white, invisible on this
                // basemap. Parchment wash plus a dark warm border — and for the
                // one country the work belongs to, a near-white wash instead,
                // which is a difference in value rather than in hue and so
                // survives the card's duotone. See CFG.mapInk.
                if (fill) {
                    fill.property("ADBE Vector Fill Color")
                        .setValue((isFocus ? F.fill : K.fill).concat([1]));
                    fill.property("ADBE Vector Fill Opacity")
                        .setValue(isFocus ? F.fillOpacity : K.fillOpacity);
                }
                if (!stroke) stroke = vg.addProperty("ADBE Vector Graphic - Stroke");
                stroke.property("ADBE Vector Stroke Color")
                      .setValue((isFocus ? F.stroke : K.stroke).concat([1]));
                stroke.property("ADBE Vector Stroke Width")
                      .setValue(strokeWidth * (isFocus ? F.strokeScale : 1));
                stroke.property("ADBE Vector Stroke Opacity")
                      .setValue(isFocus ? F.strokeOpacity : K.strokeOpacity);
                groups++;
            }
        }

        var view = null;
        if (work.map.has_place) {
            view = bboxFor(work.composition.lon, work.composition.lat,
                           work.map.half_span_lon || 6);
            geolayers3.fitViewAtTime(CFG.mapcomp, view);
        }

        // The count is the check. map_focus.py already counted how many
        // features carry this name, so the two numbers have to agree — a
        // highlight that hit nothing, or hit half a country, is otherwise
        // invisible until somebody looks at a finished render.
        var want = (work.map.focus && work.map.focus.groups) || 0;
        var declared = (work.map.focus && work.map.focus.name) || "";
        var report = { name: focus, expected: want, matched: hit,
                       ok: (focus !== "" && hit === want && hit > 0) };
        if (focus === "" && declared === UNNAMED_GROUP)
            report.warning = "this work's focus is '" + UNNAMED_GROUP + "', which "
                           + "every unnamed polity draws as — refused rather than "
                           + "highlighting the whole continent. Name the polity by "
                           + "hand in map.focus.name, or leave it empty.";
        else if (focus === "")
            report.warning = "no focus country on this work — run "
                           + "scripts/map_focus.py " + slug;
        else if (hit === 0)
            report.warning = "focus '" + focus + "' matched no drawn group; the "
                           + "geojson drawn into the mapcomp is probably not this "
                           + "work's. Re-run SOTD.mapDraw(\"" + slug + "\").";
        else if (hit !== want)
            report.warning = "focus '" + focus + "' matched " + hit + " group(s), "
                           + "expected " + want + ". Re-run scripts/map_focus.py "
                           + slug + " — the work and the geojson disagree.";

        return { restyledGroups: groups, layers: layers.length, bbox: view,
                 focus: report,
                 next: "SOTD.mapFinalize() for full-resolution tiles" };
    };

    // ------------------------------------------------------------ map: label

    /**
     * The country's name, printed on the map as a GEOlayers label.
     *
     * GEOlayers already solves the hard parts, and it is worth knowing which:
     * the label layer lands in the CONTAINING comp carrying a Mercator position
     * expression driven by `Latitude`/`Longitude` effects, so it tracks its
     * geographic point through the whole move; and a `Scale with Map` checkbox
     * decides whether it grows with the zoom. All this does is create one,
     * point it at the anchor map_focus.py computed, and dress it in the card's
     * type instead of the stock Verdana.
     *
     * The label is inside the mapcomp's world, so it is **baked** — a work
     * frozen before this existed has no label until it is re-baked, and
     * re-wording one is a re-bake, not a rebuild.
     */

    /** Every label GEOlayers has put on the mapcomp, and its source comp. */
    function clearMapLabels() {
        var removed = 0;
        var layers = geolayers3.getLabelLayersOfMapcomp(mapcomp());
        for (var i = 0; i < layers.length; i++) {
            var src = layers[i].source;
            layers[i].remove();
            // The per-label comp is a duplicate of the template made just for
            // this label, so it goes with it rather than accumulating.
            try { if (src && src.usedIn.length === 0) src.remove(); } catch (e) {}
            removed++;
        }
        return removed;
    }

    /**
     * Break a long name onto two lines, at the space nearest the middle.
     *
     * A one-line "HABSBURG MONARCHY" is 840 px of a 1000 px template, and at
     * the end of the move that is most of the map's width — it runs off both
     * sides of a 412 px panel whatever the anchor does. Two lines roughly halve
     * it, which is what makes a readable size and an on-screen label possible
     * at the same time. Single words are left alone; nothing can help them.
     */
    function wrapLabel(caps, maxChars) {
        if (caps.length <= maxChars) return caps;
        var mid = Math.floor(caps.length / 2), best = -1;
        for (var i = 0; i < caps.length; i++) {
            if (caps.charAt(i) !== " ") continue;
            if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
        }
        if (best < 0) return caps;
        return caps.substring(0, best) + "\r" + caps.substring(best + 1);
    }

    /**
     * Style one label in the card's type, the way the template expects.
     *
     * The template is built to be restyled and it is worth knowing how, because
     * guessing here cost a rewrite. Everything visible is parented to a null
     * called SCALE, the two text layers already carry continuous rasterisation,
     * and the colour layers are swatch comps blown up to 1,000,000% so they can
     * never run out of coverage. So the supported moves are: set the type, and
     * scale the SCALE null. Nothing needs rebuilding.
     */
    function styleLabel(labelComp, text) {
        var M = CFG.mapLabel;
        var caps = wrapLabel(String(text).toUpperCase(), M.wrapOver);
        var name = null, mask = null, scaleNull = null;
        for (var i = 1; i <= labelComp.numLayers; i++) {
            var L = labelComp.layer(i);
            if (L.name === "Feature Name") name = L;
            if (L.name === "Textlength mask") mask = L;
            if (L.name === "SCALE") scaleNull = L;
            // A region label wants no pointer tail, and this design wants no
            // plate. Both are drawn as a coloured layer matted by a hidden
            // shape layer, so switching off the pair is what removes them —
            // a disabled matte layer still mattes.
            if (/Pointer/.test(L.name)) { L.locked = false; L.enabled = false; }
            if (!M.plate && /Background/.test(L.name)) {
                L.locked = false;
                L.enabled = false;
            }
        }
        if (!name) return { styled: false, reason: "no 'Feature Name' layer" };

        function type(layer, size) {
            layer.locked = false;
            var P = layer.property("ADBE Text Properties").property("ADBE Text Document");
            var td = P.value;
            td.font = M.font || CFG.font.caps;
            td.fontSize = size;
            td.tracking = M.tracking;
            // Leading has to follow the size. The template's is set for its own
            // 35 pt, so two lines at anything larger overlap each other — the
            // same trap as the card's shrink steps, in the other direction.
            td.autoLeading = false;
            td.leading = size * M.leading;
            td.text = caps;
            P.setValue(td);
            return td;
        }

        var size = M.size;
        var td = type(name, size);
        var room = labelComp.width - M.fitMargin;
        var w = name.sourceRectAtTime(0, false).width;
        if (w > room) {
            size = Math.max(M.minSize, Math.floor(size * room / w));
            td = type(name, size);
            w = name.sourceRectAtTime(0, false).width;
        }
        // The plate is cut from this layer, so it has to carry the same type or
        // it is sized for a different string. Its own sourceText is expression-
        // linked to Feature Name, so only the metrics matter here.
        if (mask) type(mask, size);

        return { styled: true, size: size, lines: caps.split("\r").length,
                 widthPx: Math.round(w), roomPx: room, clipped: w > room,
                 // A font that is not installed substitutes rather than errors.
                 // This used to ask whether the family name had a space in it,
                 // which was only ever a proxy for "Trajan Pro 3" and reports a
                 // false alarm for any genuine one-word family — Cambria among
                 // them. api.fontCheck asks AE outright.
                 fontFamily: td.fontFamily,
                 fontOk: fontResolves(M.font || CFG.font.caps) };
    }

    /**
     * Paint GEOlayers' shared LabelColors comp in the card's palette.
     *
     * It is a 200x100 grid of swatches — Background, Text, Pointer, Anchor
     * Point — that every label samples one cell of through a track matte, which
     * makes it the single place a label's colours live. Shared across labels by
     * design, which suits a project with one house palette.
     */
    function styleLabelColors() {
        var comp = findItem("LabelColors", CompItem);
        if (!comp) return { styled: false, reason: "no LabelColors comp" };
        var M = CFG.mapLabel;
        // Only "Text" is actually on screen — the other three are the plate,
        // the pointer tail and the anchor dot, all switched off. Painted the
        // same colour anyway, so turning one back on cannot surprise anyone.
        var want = { "Background": M.color, "Text": M.color,
                     "Pointer": M.color, "Anchor Point": M.color };
        var done = [], missed = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            var key = L.name.replace(/ 2$/, "");
            if (!want[key]) continue;
            L.locked = false;
            // Shape layers, not solids, so the colour is a fill inside a vector
            // group — reached the way mapFinish reaches the border fills.
            var hit = 0;
            var root = L.property("ADBE Root Vectors Group");
            for (var g = 1; g <= root.numProperties; g++) {
                var vg = root.property(g).property("ADBE Vectors Group");
                if (!vg) continue;
                for (var v = 1; v <= vg.numProperties; v++) {
                    var pr = vg.property(v);
                    if (pr.matchName !== "ADBE Vector Graphic - Fill") continue;
                    pr.property("ADBE Vector Fill Color").setValue(want[key].concat([1]));
                    hit++;
                }
            }
            (hit ? done : missed).push(L.name);
        }
        return { styled: done.length > 0, swatches: done, missed: missed };
    }

    /**
     * Put this work's country label on the map. Run it after mapFinish (which
     * decides what is highlighted) and before the bake.
     */
    api.mapLabel = function (slug) {
        var work = api.readWork(slug);
        var focus = (work.map && work.map.focus) || {};
        var cleared = clearMapLabels();

        var text = focus.label || "";
        if (!text)
            return { labelled: false, cleared: cleared,
                     warning: "this work has no map.focus.label — run "
                            + "scripts/map_focus.py " + slug };

        var anchor = focus.anchor;
        if (!anchor || anchor.lon === undefined)
            return { labelled: false, cleared: cleared,
                     warning: "no map.focus.anchor — re-run scripts/map_focus.py "
                            + slug + " to compute where on the territory it sits" };

        var mc = mapcomp();
        var tpl = findItem(CFG.mapLabel.template, CompItem);
        if (!tpl) throw new Error("No label template comp named '"
                                  + CFG.mapLabel.template + "'");

        // The documented public call: geolayers3.addLabel(comp, templateComp,
        // labelData), where labelData wants lat/lon plus whatever string
        // properties the template asks for. The internal hostInterface.addLabel
        // does the same job through a much longer argument list — this is the
        // supported path and needs no ids.
        geolayers3.addLabel(mc, tpl, { lat: anchor.lat, lon: anchor.lon,
                                       name: text });

        var layers = geolayers3.getLabelLayersOfMapcomp(mc);
        if (!layers.length)
            return { labelled: false, warning: "addLabel returned but no label "
                                             + "layer appeared" };
        var L = layers[layers.length - 1];

        var type = styleLabel(L.source, text);
        var colors = styleLabelColors();

        // The native lock: GEOlayers' own Scale expression multiplies the label
        // by the map's scale when this is on, so the label is fixed to the land
        // rather than merely near it. `size` above sets how big that is.
        var fx = L.property("ADBE Effect Parade");
        fx.property("Scale with Map").property(1).setValue(1);
        var S = L.property("ADBE Transform Group").property("ADBE Scale");
        // setValue only — GEOlayers' own expression IS the lock, and it reads
        // this as its `value` and multiplies by the map's scale. Clearing the
        // expression first (the obvious thing to do before setting a value)
        // deletes the mechanism and leaves a label that sits in the right place
        // at a constant size, which looks close enough to right to be missed.
        //
        // The multiplier is not 1.0 anywhere predictable: GEOlayers bakes a
        // `scaleFactor` into the expression when the label is created, from
        // whatever view the comp happened to be sitting on. So rather than
        // guess a base, probe it — set 100, read what the expression makes of
        // that at the end of the move, and solve for the base that lands on the
        // size we actually want there.
        S.setValue([100, 100, 100]);
        if (!S.expressionEnabled)
            throw new Error("the label's Scale expression is gone — 'Scale with "
                          + "Map' has nothing to act on and the label will not "
                          + "track the zoom");
        var atEnd = S.valueAtTime(zoomEnd(), false)[0];
        var atStart = S.valueAtTime(zoomStart(), false)[0];
        var base = CFG.mapLabel.endScale * 100 / atEnd;
        S.setValue([base, base, 100]);

        return { labelled: true, text: String(text).toUpperCase(),
                 anchor: [anchor.lon, anchor.lat], anchorFit: anchor.fit,
                 cleared: cleared, type: type, colors: colors,
                 scaleWithMap: true, endScale: CFG.mapLabel.endScale,
                 scaleAtStart: Math.round(base * atStart / 100),
                 scaleAtEnd: Math.round(base * atEnd / 100),
                 next: "bake it: freezeMapRender then freezeMapAttach" };
    };

    /**
     * What the focus name would match, without changing anything.
     *
     * Worth running before a draw is committed to: it reports the near-misses
     * too, which is how a dataset spelling drift ("Austria Hungary" becoming
     * "Austria-Hungary" in a later snapshot) shows up as a diagnosis instead of
     * as a country that quietly failed to light up.
     */
    api.mapFocusCheck = function (slug) {
        var work = api.readWork(slug);
        var focus = focusName(work);
        var layers = drawnLayers(mapcomp());
        var exact = 0, near = [], all = 0;
        var key = focus.toLowerCase().replace(/[^a-z0-9]/g, "");

        for (var n = 0; n < layers.length; n++) {
            var contents = layers[n].property("ADBE Root Vectors Group");
            for (var g = 1; g <= contents.numProperties; g++) {
                var name = contents.property(g).name;
                all++;
                if (focus === "") continue;
                if (name === focus) exact++;
                else if (key && name.toLowerCase().replace(/[^a-z0-9]/g, "") === key)
                    near.push(name);
            }
        }
        return { slug: slug, name: focus,
                 declared: (work.map.focus && work.map.focus.name) || "",
                 match: (work.map.focus && work.map.focus.match) || "",
                 expected: (work.map.focus && work.map.focus.groups) || 0,
                 exact: exact, nearMisses: near, groupsInComp: all,
                 ok: focus !== "" && exact > 0 };
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
     * finalize DOES follow the keyframes — demonstrated, not deduced: once the
     * move was real, one call fetched 21 tiles spanning zoom 3, 4 and 5. Its
     * options default to {onlyCurrentFrame:false, previewQuality:false,
     * onlyWorkArea:false, purgeImageryCache:false}.
     *
     * The notes long said the opposite, from runs where the keyframes were on
     * MapPivot and therefore inert: finalize was correctly finalizing the one
     * static view that existed. Don't reason about this from preference names
     * either — finalizationBaseSampleRate drives LABEL sampling, not imagery.
     * Watch the tile cache instead.
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
            // Pin, label and duotone stay live on top of the bake rather than
            // being burnt into it: the tint is bound to the work, and baking it
            // in would tint the frames twice on the next rebuild. The country
            // label is on this list for a second reason — it is bound to the
            // work JSON, and a baked-in copy could not be re-worded without a
            // re-render, which is the whole reason it lives outside the map.
            else if (/^PIN |^DUOTONE |^MAP label/.test(L.name)) hide.push(L);
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
