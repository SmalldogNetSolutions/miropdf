#!/usr/bin/env node
var PDFDocument = require("pdfkit"),
	PNG = require("pngjs").PNG,
	request = require("request"),
	rappar = require("./rappar.js"),
	svgo = new (require("svgo"))(),
	util = require("util"),
	fs = require("fs");

var timeout = setTimeout(function() {
	die("No input to sdin.", 3);
}, 100);

process.stdin.setEncoding("utf8");

process.stdin.on("readable", function() {
	var chunk = process.stdin.read();
	if (chunk) {
		clearTimeout(timeout);
		var json;
		try {
			json = JSON.parse(chunk);
		} catch (e) {
			die("Invalid input JSON:\n" + e, 3);
		}
		try {
			run(json);
		} catch (e) {
			die("Runtime error:\n" + e + "\n\n" + e.stack, 4);
		}
	}
});

var drawManager = new DrawManager();

var styleManager = new (function() {
	var defaults = {
		font: "Helvetica",
		font_size: 12,
		color: "#000",
		background_color: "#fff",
	};
	this.getDefaults = function() {
		return defaults;
	}
	this.updateDefaults = function(news) {
		Object.keys(news).forEach(function(key) {
			defaults[key] = news[key];
		});
	}
	this.extendStyle = function(orig, cascade) {
		var child = {};
		Object.keys(cascade).forEach(function(key) {
			child[key] = cascade[key];
		});
		Object.keys(defaults).forEach(function(key) {
			if (!child.hasOwnProperty(key)) child[key] = defaults[key];
		});
		return child;
	}
	this.extendDefaults = function(cascade) {
		return this.extendStyle(defaults, cascade);
	}
})();

var PDFManager = new (function() {
	var doc, pageCount = 0;
	var pageLayout = {
		size: [ 8.5 * 72, 11 * 72 ],
		layout: "portrait",
		margin_top: 0,
		margin_right: 0,
		margin_bottom: 0,
		margin_left: 0,
		header: {
			height: 0,
			pages: null,
		},
		footer: {
			height: 0,
			pages: null,
		},
		left_sidebar: {
			width: 0,
			pages: null,
		},
		right_sidebar: {
			width: 0,
			pages: null,
		}
	};
	this.writeToPath = function(path) {
		doc.pipe(fs.createWriteStream(path));
		doc.end();
	}
	this.updatePageLayout = function(newLayout) {
		Object.keys(newLayout).forEach(function(key) {
			pageLayout[key] = newLayout[key];
		})
	}
	this.newPage = function() {
		if (typeof doc == "undefined") doc = new PDFDocument(toPDFKitLayout())
		else doc.addPage(toPDFKitLayout());
		pageCount++;
		return doc;
	}
	this.hasRegion = function(region) {
		return !pageLayout[region].pages || (pageCount == 1 && pageLayout[region].pages.indexOf("first") >= 0);
	}
	this.getBBForRegion = function(region) {
		var dim = pageDimensions(), bb;
		switch (region) {
			case "header":
				bb = {
					x: pageLayout.margin_left,
					y: pageLayout.margin_top,
					width: dim.width - pageLayout.margin_left - pageLayout.margin_right,
					height: pageLayout.header.height
				};
				if (!this.hasRegion("header")) bb.height = 0;
				break;
			case "footer":
				bb = {
					x: pageLayout.margin_left,
					y: dim.height - pageLayout.margin_bottom - pageLayout.footer.height,
					width: dim.width - pageLayout.margin_left - pageLayout.margin_right,
					height: pageLayout.footer.height
				};
				if (!this.hasRegion("footer")) {
					bb.height = 0;
					bb.y += pageLayout.footer.height;
				}
				break;
			case "right_sidebar":
				bb = {
					x: dim.width - pageLayout.margin_right - pageLayout.right_sidebar.width,
					y: pageLayout.margin_top + pageLayout.header.height,
					width: pageLayout.right_sidebar.width,
					height: dim.height - pageLayout.margin_top - pageLayout.margin_bottom - pageLayout.header.height - pageLayout.footer.height
				};
				if (!this.hasRegion("right_sidebar")) {
					bb.width = 0;
					bb.x += pageLayout.right_sidebar.width;
				}
				if (!this.hasRegion("header")) {
					bb.y -= pageLayout.header.height;
					bb.height += pageLayout.header.height;
				}
				if (!this.hasRegion("footer")) bb.height += pageLayout.footer.height;
				break;
			case "left_sidebar":
				bb = {
					x: pageLayout.margin_left,
					y: pageLayout.margin_top + pageLayout.header.height,
					width: pageLayout.left_sidebar.width,
					height: dim.height - pageLayout.margin_top - pageLayout.margin_bottom - pageLayout.header.height - pageLayout.footer.height
				}
				if (!this.hasRegion("left_sidebar")) bb.width = 0;
				if (!this.hasRegion("header")) {
					bb.y -= pageLayout.header.height;
					bb.height += pageLayout.header.height;
				}
				if (!this.hasRegion("footer")) bb.height += pageLayout.footer.height;
				break;
			case "body":
				bb = {
					x: pageLayout.margin_left + pageLayout.left_sidebar.width,
					y: pageLayout.margin_top + pageLayout.header.height,
					width: dim.width - pageLayout.left_sidebar.width - pageLayout.right_sidebar.width - pageLayout.margin_left - pageLayout.margin_right,
					height: dim.height - pageLayout.margin_top - pageLayout.margin_bottom - pageLayout.header.height - pageLayout.footer.height
				};
				if (!this.hasRegion("right_sidebar")) bb.width += pageLayout.right_sidebar.width;
				if (!this.hasRegion("header")) {
					bb.y -= pageLayout.header.height;
					bb.height += pageLayout.header.height;
				}
				if (!this.hasRegion("footer")) bb.height += pageLayout.footer.height;
				if (!this.hasRegion("left_sidebar")) {
					bb.x -= pageLayout.left_sidebar.width;
					bb.width += pageLayout.left_sidebar.width;
				}
				break;
			default:
				console.log("Weird region: " + region);
				break;
		}
		return bb;
	}
	function pageDimensions() {
		var size = pageLayout.size;
		if (pageLayout.layout == "portrait") {
			return {
				height: Math.max(size[0], size[1]),
				width: Math.min(size[0], size[1])
			}
		} else if (pageLayout.layout == "landscape") {
			return {
				height: Math.min(size[0], size[1]),
				width: Math.max(size[0], size[1])
			}
		} else {
			return size;
		}
	}
	function toPDFKitLayout() {
		return {
			size: pageLayout.size,
			layout: pageLayout.layout,
			margin: 0,
			// margins: {
			// 	top: pageLayout.margin_top,
			// 	right: pageLayout.margin_right,
			// 	bottom: pageLayout.margin_bottom,
			// 	left: pageLayout.margin_left
			// }
		};
	}
})();

function BB(_xorbb, _y, _width, _height) {
	if (typeof _xorbb == "object") {
		this.x = _xorbb.x; this.y = _xorbb.y; this.width = _xorbb.width; this.height = _xorbb.height;
	} else {
		this.x = _xorbb; this.y = _y; this.width = _width; this.height = _height;
	}
}

function MBB(_xorbb, _y, _width, _height) {
	if (typeof _xorbb == "object") {
		this.x = _xorbb.x; this.y = _xorbb.y; this.width = _xorbb.width; this.height = _xorbb.height;
	} else {
		this.x = _xorbb; this.y = _y; this.width = _width; this.height = _height;
	}
	var bbs = [];
	this.addBB = function(bb) {
		bbs.push(bb);
	}
	var todraw = [];
	this.getWRectsForVLine = function(y, height) {
		var fullWidthRect = new BB(this.x, y, this.width, height);

		var intersectingBBs = [];
		bbs.forEach(function(bb) {
			var sect = getIntersection(bb, fullWidthRect);
			if (sect.height) intersectingBBs.push(bb);
		});

		var wRects = [ fullWidthRect ];
		for (var i = 0; i < intersectingBBs.length; ++i) {
			var curI = intersectingBBs[i];
			for (var j = 0; j < wRects.length; ++j) {
				var curW = wRects[j];
				var sect = getIntersection(curW, curI);
				if (sect.width) {
					var lW = new BB(curW.x, curW.y, sect.x - curW.x, curW.height),
						rW = new BB(sect.x + sect.width, curW.y, curW.x + curW.width - (sect.x + sect.width), curW.height);
					if (lW.width) wRects.push(lW);
					if (rW.width) wRects.push(rW);
					if (lW.width || rW.width) {
						wRects.splice(j, 1);
						j = 0;
					} else if (curI.width == curW.width) {
						wRects.splice(j, 1);
					}
				}
			}
		}
		return wRects;
	}
	this.maxYForRelX = function(x) {
		x = x || 0;
		var maxy = 0;
		bbs.forEach(function(bb) {
			if (bb.x - this.x <= x && x <= bb.x - this.x + width && bb.y + bb.height > maxy) {
				maxy = bb.y + bb.height;
			}
		})
		return maxy;
	}
	function getIntersection(a, b) {
		var x1 = Math.max(a.x, b.x),
			y1 = Math.max(a.y, b.y),
			x2 = Math.min(a.x + a.width, b.x + b.width),
			y2 = Math.min(a.y + a.height, b.y + b.height);
		var w = Math.max(0, x2 - x1), h = Math.max(0, y2 - y1);
		return new BB(x1, y1, w, h);
	}
	this.draw = function(pdf) {
		pdf.lineWidth(1);
		pdf.rect(this.x, this.y, this.width, this.height).stroke("orange");
		pdf.lineWidth(1);
		bbs.forEach(function(bb) {
			pdf.rect(bb.x, bb.y, bb.width, bb.height).stroke("blue");
		});
		todraw.forEach(function(bb){ 
			pdf.rect(bb.x, bb.y, bb.width, bb.height).stroke("green");			
		});
	}
}

function die(e, code) {
	code = code || 2;
	console.log(JSON.stringify({
		message: e,
		code: code
	}));
	process.exit(code);
}

function run(json) {
	//console.log(json);
	if (typeof json["default"] == "object") {
		styleManager.updateDefaults(json["default"]);
	}
	if (typeof json.page == "object") {
		PDFManager.updatePageLayout({
			size: json.page.size,
			layout: json.page.layout,
			margin_top: json.page.margin_top,
			margin_right: json.page.margin_right,
			margin_bottom: json.page.margin_bottom,
			margin_left: json.page.margin_left,
		})
	} else {
		die("Required json.page not found.", 4);
	}
	if (typeof json.header == "object") {
		PDFManager.updatePageLayout({
			header: {
				height: json.header.height,
				pages: json.header.pages
			}
		})
	}
	if (typeof json.footer == "object") {
		PDFManager.updatePageLayout({
			footer: {
				height: json.footer.height,
				pages: json.footer.pages
			}
		})
	}
	if (typeof json.left_sidebar == "object") {
		PDFManager.updatePageLayout({
			left_sidebar: {
				width: json.left_sidebar.width,
				pages: json.left_sidebar.pages
			}
		})
	}
	if (typeof json.right_sidebar == "object") {
		PDFManager.updatePageLayout({
			right_sidebar: {
				width: json.right_sidebar.width,
				pages: json.right_sidebar.pages
			}
		})
	}
	var pdf = PDFManager.newPage();

	// var bb = PDFManager.getBBForRegion("header");
	// pdf.rect(bb.x, bb.y, bb.width, bb.height).fillOpacity(0.3).fill("red");
	// bb = PDFManager.getBBForRegion("footer");
	// pdf.rect(bb.x, bb.y, bb.width, bb.height).fillOpacity(0.3).fill("blue");
	// bb = PDFManager.getBBForRegion("left_sidebar");
	// pdf.rect(bb.x, bb.y, bb.width, bb.height).fillOpacity(0.3).fill("green");
	// bb = PDFManager.getBBForRegion("right_sidebar");
	// pdf.rect(bb.x, bb.y, bb.width, bb.height).fillOpacity(0.3).fill("green");
	// bb = PDFManager.getBBForRegion("body");
	// pdf.rect(bb.x, bb.y, bb.width, bb.height).fillOpacity(0.3).fill("orange");
	
	var bodyBB = new MBB(PDFManager.getBBForRegion("body"));

	drawItems(json.items, {
		pdf: pdf,
		parentBB: bodyBB,
		parentStyle: styleManager.getDefaults(),
		done: function() {
			// bodyBB.draw(pdf);
			PDFManager.writeToPath("./out.pdf");
			console.log("Wrote pdf.");
		}
	});


	// var mbb = new MBB(0, 0, 612, 792);
	// mbb.addBB(new BB(0, 0, 100, 100));
	// mbb.addBB(new BB(330, 30, 70, 50));
	// mbb.addBB(new BB(400, 20, 100, 100));
	// mbb.addBB(new BB(200, 590, 200, 300));

	// for (var y = 0; y < 792; y += 18) {
	// 	var bbs = mbb.getWRectsForVLine(y, 18);
	// 	bbs.forEach(function(bb) {
	// 		pdf.rect(bb.x, bb.y, bb.width, bb.height).stroke("red");
	// 	});
	// }

	// mbb.draw(pdf);
}

function drawItems(items, cfg) {
	//cfg: clip (t/f), parentbb, parentstyle, overflow (t/f)
	var pbb = cfg.parentBB;
	cfg.cursorY = pbb.y;

	cfg.getDrawOutlineBBs = function (bb, style) {
		// make padding object
		var padding = {
			left: style.padding || style.padding_left || 0,
			right: style.padding || style.padding_right || 0,
			top: style.padding || style.padding_top || 0,
			bottom: style.padding || style.padding_bottom || 0
		};
		// make border object
		var border = {
			left: (style.border || style.border_left) ? style.border_width || 0 : 0,
			right: (style.border || style.border_right) ? style.border_width || 0 : 0,
			top: (style.border || style.border_top) ? style.border_width || 0 : 0,
			bottom: (style.border || style.border_bottom) ? style.border_width || 0 : 0,
		};
		// calculate outline box
		var outlineDim = {
			width: bb.width + padding.left + padding.right + border.left + border.right,
			height: bb.height + padding.top + padding.bottom + border.top + border.bottom
		};
		// if fits next to spans, put it there
		var outline;
		// cfg.cursorY needs to be updated after each render.
		var curRects = pbb.getWRectsForVLine(cfg.cursorY, outlineDim.height);
		if (curRects && curRects[0].width >= outlineDim.width) {
			outline = new BB(curRects[0].x, curRects[0].y, outlineDim.width, outlineDim.height);
		// otherwise, stick it at the end
		} else {
			var y = pbb.maxYForRelX(0);
			curRects = pbb.getWRectsForVLine(y, outlineDim.height);
			outline = new BB(0, y, outlineDim.width, outlineDim.height);
		}
		var bg = new BB(outline);
		// if display_style == div, extend width
		if (!style.item_display || style.item_display == "div" || bb.width == -1) {
			outline.width = curRects[0].width;
		}
		// calculate drawBB by offsetting
		var draw = new BB(outline.x + padding.left, outline.y + padding.top, bb.width, bb.height);
		return {
			outline: outline,
			draw: draw,
			bg: bg
		};
	}

	var index = 0;
	cfg.itemDrawn = function(itembbs) {
		if (itembbs) {
			if (!Array.isArray(itembbs)) itembbs = [ itembbs ];
			var maxbb;
			itembbs.forEach(function(bb) {
				pbb.addBB(bb);
				if (!maxbb || bb.y > maxbb.y || (bb.y == maxbb.y && bb.x > maxbb.x)) {
					maxbb = bb;
				}
			});
			if (maxbb) {
				var wRects = pbb.getWRectsForVLine(maxbb.y, 1);
				if (wRects.length) {
					cfg.cursorY = wRects[0].y;
					// wRects.forEach(function(bb){ 
					// 	cfg.pdf.rect(bb.x, bb.y, bb.width, bb.height).stroke("red");			
					// });
				} else {
					cfg.cursorY = maxbb.y + maxbb.height;
				}
			} else {
				console.log("No maxbb. Que pasó?");
			}
		}
		console.log(index, items.length);
		if (index >= items.length) {
			cfg.done();
			return;
		}
		drawManager.drawItem(items[index++], cfg);
	}

	if (items.length > 0) {
		drawManager.drawItem(items[index++], cfg);
	} else {
		cfg.done();
	}
}

function DrawManager() {}

DrawManager.prototype.bgAndBorder = function(bb, style, cfg) {
	if (style.background_color && style.background_color != styleManager.getDefaults().background_color) {
		cfg.pdf.rect(bb.x, bb.y, bb.width, bb.height).fill(style.background_color);
	}
	if (style.border_width && style.border_width > 0) {
		var color = style.border_color || "black";
		if (style.border) {
			cfg.pdf.rect(bb.x, bb.y, bb.width, bb.height).stroke(color);
		}
		//#return
	}
}

DrawManager.prototype.drawItem = function(item, cfg) {
	switch (item.object_type) {
		case "text": return this.drawText(item, cfg);
		case "hline": return this.drawHLine(item, cfg);
		case "vline": return this.drawVLine(item, cfg);
		case "svg": return this.drawSVG(item, cfg);
		case "png": return this.drawPNG(item, cfg);
		default:
			console.log("Odd object type! " + item.object_type);
			cfg.itemDrawn();
	}
}

DrawManager.prototype.drawHLine = function(item, cfg) {
	if (!item.line_length) item.display_style = "div";
	var style = styleManager.extendStyle(cfg.parentStyle, item);

	var bb = new BB(0, 0, item.line_length || -1, style.line_width || 1);
	var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw;
	this.bgAndBorder(dobbs.bg, style, cfg);
	cfg.pdf.lineWidth(style.line_width || 1).strokeColor(style.color).moveTo(draw.x, draw.y + item.line_width / 2).lineTo(draw.x + (item.line_length || draw.width), draw.y + item.line_width / 2).stroke();
	
	cfg.itemDrawn(dobbs.outline);
}

DrawManager.prototype.drawVLine = function(item, cfg) {
	var style = styleManager.extendStyle(cfg.parentStyle, item);

	var bb = new BB(0, 0, style.line_width || 1, item.line_length || -1);
	var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw;
	this.bgAndBorder(dobbs.bg, style, cfg);
	cfg.pdf.lineWidth(style.line_width || 1).strokeColor(style.color).moveTo(draw.x + item.line_width / 2, draw.y).lineTo(draw.x + item.line_width / 2, draw.y + (item.line_length || draw.width)).stroke();
	
	cfg.itemDrawn(dobbs.outline);
}

DrawManager.prototype.drawSVG = function(item, cfg) {
	var style = styleManager.extendStyle(cfg.parentStyle, item),
		self = this;

	if (item.content.path) {
		renderSVG(fs.readFileSync(item.content.path, "utf-8"));
	} else if (item.content.url) {
		var stream = request.get(item.content.url);
		var data = "";
		stream.on("data", function(chunk) {
			if (chunk) data += chunk;
		});
		stream.on("end", function(chunk) {
			if (chunk) data += chunk;
			renderSVG(data);
		});
	}

	function renderSVG(svg) {
		svgo.optimize(svg, function (mind) {
			var height = mind.info.height,
				width = mind.info.width;
			if (item.height && item.width) {
				height = item.height;
				width = item.width;
			} else if (item.height) {
				width = item.height / height * width;
				height = item.height;
			} else if (item.width) {
				height = item.width / width * height;
				width = item.width;
			}

			var bb = new BB(0, 0, width, height);
			var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw;		
			self.bgAndBorder(dobbs.bg, style, cfg);
			cfg.pdf.save();

			cfg.pdf.translate(draw.x, draw.y);
			cfg.pdf.scale(width / mind.info.width, height / mind.info.height);
			
			var parts = rappar(mind.data);
			parts.forEach(function(part) {
				cfg.pdf.save();
				if (part.type == "path") {
					cfg.pdf.path(part.path);

					if (part["stroke-width"]) cfg.pdf.lineWidth(part["stroke-width"]);
					cfg.pdf.strokeColor(part.stroke).fillColor(part.fill);

					if (part.fill != "none" && part.stroke != "none") {
						cfg.pdf.fillAndStroke(part.fill, part.stroke);
					} else {
						if (part.fill != "none") cfg.pdf.fill(part.fill);
						if (part.stroke != "none") cfg.pdf.stroke(part.stroke);
					}
				}
				// else if (part.type == "text") {
				// 	var rotateR = /r(-?[0-9]\d*(?:\.\d+)?),?(-?[0-9]\d*(?:\.\d+)?)?,?(-?[0-9]\d*(?:\.\d+)?)?/.exec(part.transform),
				// 		translateR = /t(-?[0-9]\d*(?:\.\d+)?),(-?[0-9]\d*(?:\.\d+)?)/.exec(part.transform),
				// 		scaleR = /s(-?[0-9]\d*(?:\.\d+)?),(-?[0-9]\d*(?:\.\d+)?),?(-?[0-9]\d*(?:\.\d+)?)?,?(-?[0-9]\d*(?:\.\d+)?)?/.exec(part.transform)

				// 	if (translateR) {
				// 		cfg.pdf.translate(Number(translateR[1]), (Number(translateR[2]) - part["font-size"]));
				// 	}
				// 	if (scaleR) {
				// 		cfg.pdf.translate(Number(scaleR[1]), Number(scaleR[2]), {
				// 			origin: [ scaleR[3] ? Number(scaleR[3]) : 0, scaleR[4] ? Number(scaleR[4]) : 0 ]
				// 		});
				// 	}
				// 	if (rotateR) {
				// 		cfg.pdf.rotate(Number(rotateR[1]), {
				// 			origin: [ rotateR[2] ? Number(rotateR[2]) : 0, rotateR[3] ? Number(rotateR[3]) : 0 ]
				// 		});
				// 	}
				// 	cfg.pdf.fontSize(part["font-size"]);
				// 	cfg.pdf.fillColor(part.fill).font("/Library/Fonts/GillSans.ttc", "GillSans-Light").text(part.text, 0, 0, {
				// 		width: Number.MAX_VALUE
				// 	});
				// }
				cfg.pdf.restore();
			});
			cfg.pdf.restore();

			cfg.itemDrawn(dobbs.outline);
		});
	}
}

DrawManager.prototype.drawPNG = function(item, cfg) {
	var style = styleManager.extendStyle(cfg.parentStyle, item);

	var rstream;
	if (item.content.path) {
		rstream = fs.createReadStream(item.content.path);
	} else if (item.content.url) {
		rstream = request.get(item.content.url);
	} else {
		console.log("No url/path specified for png. " + item);
	}

	var owidth, oheight;
	var c = 0;
	var bufs = [], buf;
	rstream.on("data", function(chunk) {
		if (chunk) bufs.push(chunk);
	}).on("end", function() {
		buf = Buffer.concat(bufs);
		tryRender();
	});
	rstream.pipe(new PNG({
		filterType: 4
	})).on("parsed", function() {
		owidth = this.width, oheight = this.height;
		tryRender();
	});
	function tryRender() {
		if (++c == 2) renderPNG();
	}

	function renderPNG() {
		var height = oheight,
			width = owidth;
		if (item.width && item.height) {
			height = item.height;
			width = item.width;
		} else if (item.height) {
			width = item.height / height * width;
			height = item.height;
		} else if (item.width) {
			height = item.width / width * height;
			width = item.width;
		}
		var bb = new BB(0, 0, width, height);
		var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw;	
		cfg.pdf.image(buf, draw.x, draw.y, {
			width: width,
			height: height
		});

		cfg.itemDrawn(dobbs.outline);
	}
}

DrawManager.prototype.drawText = function(item, cfg) {
	var style = styleManager.extendStyle(cfg.parentStyle, item);
	//need to figure out div/span
	cfg.pdf.fontSize(style.font_size);

	var xOffset = style.padding ? style.padding * 2 : ((style.padding_left || 0) + (style.padding_right || 0));
	xOffset += style.border_width * 2 || 0;
	var text = item.content;
	var spaceWidth = cfg.pdf.widthOfString(" "), queue = [], bbs = [];

	var paragraphs = text.split(/\n/g), y = 0, curRect;
	for (var i = 0; i < paragraphs.length; ++i) {
		var paragraph = paragraphs[i];
		if (style.smart_wrap || !curRect)
			curRect = cfg.parentBB.getWRectsForVLine(cfg.cursorY + y, style.line_height || style.font_size)[0];
		else {
			curRect = new BB(curRect);
			curRect.y = cfg.cursorY + y;
		}
		var buffer = "", w = 0;

		var words = paragraph.split(/\s+/g);
		words.some(function(word, i) {
			var ww = cfg.pdf.widthOfString(word) + spaceWidth;
			if (w + ww > curRect.width - xOffset) {
				y += queueLine(buffer, curRect, xOffset);
				if (style.smart_wrap)
					curRect = cfg.parentBB.getWRectsForVLine(cfg.cursorY + y, style.line_height || style.font_size)[0];
				else {
					curRect = new BB(curRect);
					curRect.y = cfg.cursorY + y;
				}
				buffer = word + " ";
				w = ww;
			} else {
				buffer += word + " ";
				w += ww;
			}
		});

		if (buffer) { //last or only line in paragraph
			y += queueLine(buffer, curRect, xOffset, true, i == paragraphs.length - 1);
		}
	}
	cfg.itemDrawn(flushQueue());

	function queueLine(text, rect, xOffset, paragaphEnd, last) {
		var wordSpacing = 0, renderwidth = rect.width, align = style.align;
		if (style.align == "justify" && !paragaphEnd) {
			var words = text.trim().split(/\s+/g);
			var twidth = cfg.pdf.widthOfString(words.join(""));

			align = "left";
			var wordSpacing = Math.max(0, (rect.width - xOffset - twidth) / Math.max(1, words.length - 1) - spaceWidth);
			renderwidth = 1E5;
		}

		var height = rect.height;
		var top = 0;
		if (queue.length == 0) {
			top = style.padding || style.padding_top || 0;
			height += top;
		}
		if (last) height += style.padding || style.padding_bottom || 0;

		queue.push({
			top: top,
			renderwidth: renderwidth,
			align: align,
			text: text,
			rect: new BB(rect.x, rect.y, rect.width, height),
			wordSpacing: wordSpacing
		});

		return height;
	}

	//background rendering might get complicated...
	function flushQueue() {
		var bbs = [];
		var drawRect = cfg.pdf.rect(queue[0].rect.x, queue[0].rect.y, queue[0].rect.width, queue[queue.length - 1].rect.y - queue[0].rect.y + queue[queue.length - 1].rect.height);
		if (!style.smart_wrap && style.border_width && style.border) {
			drawRect.lineWidth(style.border_width).stroke(style.border_color);
		}
		if (!style.smart_wrap && style.background_color) {
			cfg.pdf.rect(queue[0].rect.x, queue[0].rect.y, queue[0].rect.width, queue[queue.length - 1].rect.y - queue[0].rect.y + queue[queue.length - 1].rect.height).fill(style.background_color);
		}
		console.log(queue);
		queue.forEach(function(line) {
			bbs.push(line.rect);
			cfg.pdf.fillColor(style.color).text(line.text.trim(), line.rect.x + (style.padding || style.padding_left || 0), line.rect.y + line.top, {
				width: line.renderwidth,
				align: line.align,
				wordSpacing: line.wordSpacing
			});
		});
		queue = [];
		console.log(style);
		return bbs;
	}
}