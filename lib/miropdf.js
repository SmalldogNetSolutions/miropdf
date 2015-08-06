#!/usr/bin/env nodejs
var PDFDocument = require("pdfkit"),
	PNG = require("pngjs").PNG,
	request = require("request"),
	rappar = require("./rappar.js"),
	svgo = new (require("svgo"))(),
	util = require("util"),
	URL = require("url"),
	fs = require("fs");
	
var debug = false;

// throw new Error();

var timeout = setTimeout(function() {
	die("No input to sdin.");
}, 500);

var pipedInput = fs.readFileSync('/dev/stdin', {
	encoding: "utf-8"
});

clearTimeout(timeout);
try {
	setTimeout(function() { //let rest of script load
		var json;
		try {
			json = JSON.parse(pipedInput);
		} catch (e) {
			die("Invalid input JSON:\n" + e);
		}
			// throw new Error();
		run(json);
	}, 200);
} catch (e) {
	die("Runtime error: " + e);
}


// process.stdin.setEncoding("utf8");
// process.stdin.on("readable", function() {
// 	var chunk = process.stdin.read();
// 	if (chunk) {
// 		clearTimeout(timeout);
// 		var json;
// 		try {
// 			json = JSON.parse(chunk);
// 		} catch (e) {
// 			console.log(chunk);
// 			die("Invalid input JSON:\n" + e);
// 		}
// 		try {
// 			run(json);
// 		} catch (e) {
// 			die("Runtime error: " + e.stack);
// 		}
// 	}
// });

var drawManager = new DrawManager();

var StyleManager = new (function() {
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
			if (key.indexOf("~") == 0) delete child[key];
			else child[key] = cascade[key];
		});
		Object.keys(orig).forEach(function(key) {
			if (!child.hasOwnProperty(key)) child[key] = orig[key];
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
			// pages: null,
		},
		footer: {
			height: 0,
			// pages: null,
		},
		left_sidebar: {
			width: 0,
			// pages: null,
		},
		right_sidebar: {
			width: 0,
		}
	};
	this.pipe = function(out) {
		doc.pipe(out);
		doc.end();
	}
	this.writeToPath = function(path) {
		doc.pipe(fs.createWriteStream(path));
		doc.end();
	}
	this.updatePageLayout = function(newLayout) {
		Object.keys(newLayout).forEach(function(key) {
			if (newLayout[key]) {
				pageLayout[key] = newLayout[key];
			}
		});
	}
	this.newPage = function() {
		if (typeof doc == "undefined") doc = new PDFDocument(toPDFKitLayout())
		else doc.addPage(toPDFKitLayout());
		pageCount++;
		return doc;
	}
	this.getCurPage = function() {
		return doc;
	}
	this.getCurPageNum = function() {
		return pageCount;
	}
	this.hasRegion = function(region) {
		return region == "body" || (pageLayout[region] && (pageLayout[region].height || pageLayout[region].width));
		// && (pageCount == 1 && pageLayout[region].pages.indexOf("first") >= 0);
	}
	this.getBBForRegion = function(region) {
		var bb, dim = pageDimensions();
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
				// console.log("Weird region: " + region);
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
			// bufferPages: true,
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
	var self = this;
	if (typeof _xorbb == "object") {
		this.x = _xorbb.x; this.y = _xorbb.y; this.width = _xorbb.width; this.height = _xorbb.height;
	} else {
		this.x = _xorbb; this.y = _y; this.width = _width; this.height = _height;
	}
	var bbs = [];
	this.addBB = function(bb) {
		var c = bb;
		if (!Array.isArray(c)) c = [ c ];
		bbs = bbs.concat(c);
	}
	this.getBBs = function() {
		return bbs;
	}
	var todraw = [];
	this.getWRectsForVLine = function(y, height, optExtras) {
		var fullWidthRect = new BB(this.x, y, this.width, height);

		var rects = bbs;

		if (optExtras) {
			rects = bbs.slice().concat(optExtras);
		}

		var intersectingBBs = [];
		rects.forEach(function(bb) {
			var sect = self.getIntersection(bb, fullWidthRect);
			if (sect.height) intersectingBBs.push(bb);
		});

		var wRects = [ fullWidthRect ];
		for (var i = 0; i < intersectingBBs.length; ++i) {
			var curI = intersectingBBs[i];
			for (var j = 0; j < wRects.length; ++j) {
				var curW = wRects[j];
				var sect = self.getIntersection(curW, curI);
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
		var self = this;
		x = x || 0;
		var maxy = this.y;
		bbs.forEach(function(bb) {
			if (bb.x - self.x <= x && x <= bb.x - self.x + bb.width && bb.y + bb.height > maxy) {
				maxy = bb.y + bb.height;
			}
		})
		return maxy;
	}
	this.getIntersection = function getIntersection(a, b) {
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

function die(e) {
	console.trace();
	throw new Error(e);
	process.exit(1);
}

function run(json) {

	if (typeof json["default"] == "object") {
		StyleManager.updateDefaults(json["default"]);
	}
	drawManager.json = json;
	PDFManager.updatePageLayout({
		size: json.page.size,
		layout: json.page.layout,
		margin_top: json.page.margin_top,
		margin_right: json.page.margin_right,
		margin_bottom: json.page.margin_bottom,
		margin_left: json.page.margin_left,
		header: json.page.header,
		footer: json.page.footer,
		right_sidebar: json.page.right_sidebar,
		left_sidebar: json.page.left_sidebar,
	});
	PDFManager.updatePageLayout(json);
	PDFManager.newPage();

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

	drawManager.json = json;
	drawManager.drawMarginRegions(function marginsDrawn() {
		drawManager.drawBody(function bodyDrawn() {
			debug && console.log("writeout");
			PDFManager.writeToPath(json.output_file);
		});
	});
}

function drawItems(items, cfg) {
	//cfg: clip (t/f), parentbb, parentstyle, overflow (t/f)
	cfg.clearY = cfg.parentBB.y;

	cfg.getNextPos = function(width, height) {
		var origBBs = this.parentBB.getBBs();
		var bbs = [];

		origBBs.forEach(function(bb) {
			if (bb.y + bb.height >= cfg.clearY) bbs.push(bb);
		});

		if (bbs[0]) bbs.unshift(new BB(bbs[0].x + bbs[0].width, bbs[0].y, 1e-6, 1e-6));
		else bbs.unshift(new BB(this.parentBB.x, cfg.clearY, 1e-6, 1e-6));

		bbs = bbs.sort(function(a, b) { 
			//sort descending y, then ascending x, just in case
			if (a.y == b.y) return a.x - b.x;
			else return b.y - a.y;
		});

		var cury = this.parentBB.y + this.parentBB.height, curx = this.parentBB.x;
		var possRect = this.parentBB.getWRectsForVLine(cury, height || 1)[0];
		for (var i = 0; i < bbs.length; ++i) {
			var bb = bbs[i];
			var y = bb.y + bb.height;
			possRect = this.parentBB.getWRectsForVLine(y, height || 1)[0];
			if (possRect && possRect.width >= width) {
				returnRect = possRect;
				cury = y;
				if (possRect.x > curx) curx = possRect.x;
			} else {
				break;
			}
		}

		var ySelBB = new BB(curx, cfg.clearY, width, y - cfg.clearY);

		var cury = cfg.clearY;
		bbs.forEach(function(bb) {
			var sect = cfg.parentBB.getIntersection(bb, ySelBB);
			if (sect.width) {
				var y = bb.y + bb.height;
				if (y > cury) {
					cury = y;
				}
			}
		});

		var pos = {
			x: curx,
			y: cury,
			bounds: new BB(curx, cury, width, height)
		};

		//cfg.pdf.rect(pos.x, pos.y, 3, 3).stroke("red");

		return pos;
	}

	cfg.getDrawOutlineBBs = function (bb, style) {
		// make padding object
		var padding = {
			left: style.padding || style.padding_left || 0,
			right: style.padding || style.padding_right || 0,
			top: style.padding || style.padding_top || 0,
			bottom: style.padding || style.padding_bottom || 0
		};
		// make border
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

		if (bb.width < 0) {
			outlineDim.width = -Math.max(-1, bb.width) * this.parentBB.width;
		}
		
		if (style.clear == "1") {
			var y = this.parentBB.maxYForRelX(0);
			var pos = {
				x: this.parentBB.x,
				y: y,
				bounds: new BB(this.parentBB.x, y, outlineDim.width, outlineDim.height)
			};
			cfg.clearY = y;
		} else {
			var pos = this.getNextPos(outlineDim.width, outlineDim.height);
		}
/*
		if (bb.height < 0) {
			outlineDim.height = -Math.max(-1, bb.height) * this.parentBB.height;
		}
*/

		// if fits next to spans, put it there
		// cfg.cursorY needs to be constantly updated after each item/bb drawn.
	
		var outline = new BB(pos.bounds.x, pos.bounds.y, outlineDim.width, outlineDim.height);
		
		if (outline.y + outline.height > this.parentBB.y + this.parentBB.height && this.region == "body") {
			// cfg.reqNewPage();
			outline.y = this.parentBB.y;
			outline.x = this.parentBB.x;
		}
		
		var bg = new BB(outline);
		var draw = new BB(outline.x + padding.left, outline.y + padding.top, bb.width, bb.height);
		// if display_style == div, extend width
		if (!style.item_display || style.item_display == "div") {
			outline.width = this.parentBB.x + this.parentBB.width - pos.x;
		}
		if (bb.width < 0) {
			draw.width = outline.width - padding.left - padding.right;
		}
		
		//align
		if (style.align == "right") {
			draw.x = outline.x + outline.width - draw.width - padding.right;
		} else if (style.align == "center") {
			draw.x = outline.x + outline.width / 2 - draw.width / 2;
		}
		
		// calculate drawBB by offsetting
		return {
			outline: outline,
			draw: draw,
			bg: bg
		};
	}
	
	cfg.reqNewPage = function(doneFn) {
		// debug && this.parentBB.draw(this.pdf);
		if (this.region != "body") {
			doneFn();
			return;
		}

		this.pdf = PDFManager.newPage();
		drawManager.drawMarginRegions(function() {
			// drawManager.drawBody(function() {
				doneFn();
			// });
		});
		// this.parentBB = new MBB(PDFManager.getBBForRegion("body"));
	};

	cfg.parseWidth = function(widthStr) {
		if (widthStr.indexOf("%") > 0) {
			return -(parseInt(widthStr, 10) / 100);
		} else {
			return parseInt(widthStr, 10);
		}
	}

	var index = 0;
	cfg.itemDrawn = function(itembbs) {
		if (itembbs) {
			this.parentBB.addBB(itembbs);
		}

		if (index >= items.length) {
			this.done();
			return;
		}
		draw();
	}

	if (items.length > 0) {
		draw();
	} else {
		cfg.done();
	}
	function draw() {
		var cur = items[index++];
		debug && console.log(cur);
		drawManager.drawItem(cur, cfg);
	}
}

function DrawManager() { this.imgCache = {} };

DrawManager.prototype.pushImgCache = function(key, img) {
	this.imgCache[key] = img;
}

DrawManager.prototype.getCachedImg = function(key) {
	return this.imgCache[key];
}

DrawManager.prototype.clearImgCache = function(key) {
	if (key) {
		delete this.imgCache[key];
	} else {
		this.imgCache = {};
	}
}

DrawManager.prototype.pushLocalCache = function(url, data) {
	var fileName = "/tmp/" + encodeURIComponent(url);
	try {
		fs.writeFileSync(fileName, data);
	} catch(e) {}
}

DrawManager.prototype.tryLoadLocalCache = function(url) {
	var fileName = "/tmp/" + encodeURIComponent(url);
	try {
		var stats = fs.lstatSync(fileName);

		if (stats.isFile()) {
			return fs.readFileSync(fileName, {
				encoding: "utf-8"
			});
		}
	} catch(e) {}
}

DrawManager.prototype.bgAndBorder = function(bb, style, cfg) {
	if (style.background_color && style.background_color != StyleManager.getDefaults().background_color) {
// 		cfg.pdf.rect(bb.x, bb.y, bb.width, bb.height).fill(style.background_color);
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
		case "table": return this.drawTable(item, cfg);
		case "hline": return this.drawHLine(item, cfg);
		case "vline": return this.drawVLine(item, cfg);
		case "svg": return this.drawSVG(item, cfg);
		case "png": return this.drawPNG(item, cfg);
		case "pagebreak": return this.pageBreak(item, cfg);
		default:
			// console.log("Odd object type! " + item.object_type);
			cfg.itemDrawn();
	}
}

DrawManager.prototype.drawBody = function(doneFn) {
	this.drawRegion("body", doneFn);
}

DrawManager.prototype.drawMarginRegions = function(doneFn) {
	// debug && this.parentBB.draw(this.pdf);

	var regions = [ "header", "footer", "left_sidebar", "right_sidebar" ];

	(function drawRegionAsync(regionIndex) {
		// throw new Error();
		drawManager.drawRegion(regions[regionIndex], function() {
			if (regionIndex >= regions.length - 1) {
				doneFn();
			} else {
				drawRegionAsync(regionIndex + 1);
			}
		})
	}.bind(this))(0);
}

DrawManager.prototype.drawRegion = function(region, doneFn) {
	// debug && this.parentBB.draw(this.pdf);

	if (PDFManager.hasRegion(region)) {
		var regionJSON, style;
		if (region == "body") {
			regionJSON = this.json;
			style = StyleManager.getDefaults();
		} else {
			regionJSON = this.json.page[region];
			style = StyleManager.extendDefaults(
						StyleManager.extendStyle(regionJSON,
							{ items: null, height: null, width: null, }));
		}

		var regionBB = new MBB(PDFManager.getBBForRegion(region));
		// PDFManager.getCurPage().rect(regionBB.x, regionBB.y, regionBB.width, regionBB.height).strokeColor("blue").stroke();
		
		drawItems(regionJSON.items, {
			pdf: PDFManager.getCurPage(),
			parentBB: regionBB,
			parentStyle: style,
			region: region,
			done: doneFn,
		});
	} else {
		// console.log(region);
		doneFn();
	}
}

DrawManager.prototype.pageBreak = function(item, cfg) {
	cfg.reqNewPage(function() {
		cfg.itemDrawn();
	});
}

DrawManager.prototype.drawHLine = function(item, cfg) {
	if (!item.line_length) item.display_style = "div";
	var style = StyleManager.extendStyle(cfg.parentStyle, item);

	var bb = new BB(0, 0, item.line_length || -1, style.line_width || 1);
	var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw;
	this.bgAndBorder(dobbs.bg, style, cfg);
	cfg.pdf.lineWidth(style.line_width || 1).strokeColor(style.color).moveTo(draw.x, draw.y + item.line_width / 2).lineTo(draw.x + (item.line_length || draw.width), draw.y + item.line_width / 2).stroke();
	
	cfg.itemDrawn(dobbs.outline);
}

DrawManager.prototype.drawVLine = function(item, cfg) {
	var style = StyleManager.extendStyle(cfg.parentStyle, item);

	var bb = new BB(0, 0, style.line_width || 1, item.line_length || -1);
	var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw;
	this.bgAndBorder(dobbs.bg, style, cfg);
	cfg.pdf.lineWidth(style.line_width || 1).strokeColor(style.color).moveTo(draw.x + item.line_width / 2, draw.y).lineTo(draw.x + item.line_width / 2, draw.y + (item.line_length || draw.width)).stroke();
	
	cfg.itemDrawn(dobbs.outline);
}

DrawManager.prototype.drawSVG = function(item, cfg) {
	var style = StyleManager.extendStyle(cfg.parentStyle, item),
		self = this;

	var cachedImg;
	try {
		cachedImg = this.getCachedImg(item.content.path || item.content.url);

		if (cachedImg) {
			renderSVG(cachedImg);
		} else if (item.content.path) {
			renderSVG(fs.readFileSync(item.content.path, "utf-8"));
		} else if (item.content.url) {
			var localCache = this.tryLoadLocalCache(item.content.url);
			if (localCache) {
				renderSVG(localCache);
			} else {
				var stream = request.get(item.content.url);
				var data = "";
				stream.on("data", function(chunk) {
					if (chunk) data += chunk;
				});
				stream.on("end", function(chunk) {
					if (chunk) data += chunk;
					self.pushLocalCache(item.content.url, data);

					renderSVG(data);
				});
			}
		} else {
			cfg.itemDrawn();
		}
	} catch(e) {
		if (debug) {
			console.error("Error loading SVG file " + (item.content.path || item.content.url));
			console.error(e);
		}
		cfg.itemDrawn();
	}

	function renderSVG(svg) {
		if (!cachedImg) {
			self.pushImgCache(item.content.path || item.content.url, svg);
		}

		var finalRect;
		try {
			svgo.optimize(svg, function(mind) {
				// max_width, max_height required

				var mw = item.max_width, mh = item.max_height;
//				mw = cfg.parseWidth(item.width);
//				if (mw < 0) mw *= -cfg.parentBB.width;
				
				var projectedWidth = mw,
					projectedHeight = mw / mind.info.width * mind.info.height;
				if (projectedHeight > mh) {
					projectedHeight = mh;
					projectedWidth = mh / mind.info.height * mind.info.width;
				}
				
				var width = projectedWidth, height = projectedHeight;
				var scaleFactor = width / mind.info.width;

				var bb = new BB(0, 0, width, height);
				var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw;
				finalRect = dobbs.outline;
// 				self.bgAndBorder(dobbs.bg, style, cfg);
				cfg.pdf.save();

				cfg.pdf.translate(draw.x, draw.y);
				cfg.pdf.scale(scaleFactor);
				
				var parts = rappar(svg);
				parts.some(function(part, i) {
					cfg.pdf.save();
					if (part.type == "path") {
						cfg.pdf.path(part.path);

						if (part["stroke-width"]) cfg.pdf.lineWidth(part["stroke-width"]);
						cfg.pdf.strokeColor(part.stroke).fillColor(part.fill).opacity(part.opacity || 1);

						if (part.fill != "none" && part.stroke != "none") {
							cfg.pdf.fillAndStroke(part.fill, part.stroke);
						} else {
							if (part.fill != "none") cfg.pdf.fill(part.fill);
							if (part.stroke != "none") cfg.pdf.stroke(part.stroke);
						}
					} else if (part.type == "rect") {
						if (part["stroke-width"]) cfg.pdf.lineWidth(part["stroke-width"]);
						cfg.pdf.strokeColor(part.stroke).fillColor(part.fill).rect(part.x, part.y, part.width, part.height)
					}
					// else if (part.type == "text") {
					// 	var rotateR = /r(-?[0-9]\d*(?:\.\d+)?),?(-?[0-9]\d*(?:\.\d+)?)?,?(-?[0-9]\d*(?:\.\d+)?)?/.exec(part.transform),
					// 		translateR = /t(-?[0-9]\d*(?:\.\d+)?),(-?[0-9]\d*(?:\.\d+)?)/.exec(part.transform),
					// 		scaleR = /s(-?[0-9]\d*(?:\.\d+)?),(-?[0-9]\d*(?:\.\d+)?),?(-?[0-9]\d*(?:\.\d+)?)?,?(-?[0-9]\d*(?:\.\d+)?)?/.exec(part.transform);

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
			});
		} catch(e) {
			console.log(e);
		} finally {
			cfg.itemDrawn(finalRect);
		}
	}
}

DrawManager.prototype.drawPNG = function(item, cfg) {
	var style = StyleManager.extendStyle(cfg.parentStyle, item);
	var self = this;
	
	var bufs = [];
	var img = { meta: {} };

	var cachedImg = this.getCachedImg(item.content.path || item.content.url);
	if (cachedImg) {
		img = cachedImg;
		renderPNG();
		return;
	}

	var rstream;
	if (item.content.path) {
		rstream = fs.createReadStream(item.content.path);
	} else if (item.content.url) {
		rstream = request.get(item.content.url);
	} else {
		// console.log("No url/path specified for png. " + item);
	}

	rstream.on("data", function(chunk) {
		if (chunk) bufs.push(chunk);
	}).on("end", function() {
		img.buf = Buffer.concat(bufs);
		tryRender();
	});

	rstream.pipe(new PNG({
		filterType: 4
	})).on("parsed", function() {
		img.meta.width = this.width, img.meta.height = this.height;
		tryRender();
	});

	var c = 0;
	function tryRender() {
		if (++c == 2) renderPNG();
	}

	function renderPNG() {
		if (!cachedImg) this.pushImgCache(item.content.path || item.content.url, img);

		var finalRect;
		try {
			var height = img.meta.height,
				width = img.meta.width;
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
			var dobbs = cfg.getDrawOutlineBBs(bb, style), draw = dobbs.draw, finalRect = dobbs.outline;	

			cfg.pdf.image(img.buf, draw.x, draw.y, {
				width: width,
				height: height
			});
		} catch(e) {
			if (debug) {
				console.error("PNG drawing failed for " + (item.content.path || item.content.url));
				console.error(e);
			}
		} finally {
			cfg.itemDrawn(finalRect);
		}
	}
}

DrawManager.prototype.genTextQueue = function(text, startbb, xOffset, style, cfg, flushFn, doneFn) {
	//set font height before falling
	xOffset = xOffset || 0;
	var lineHeight = style.line_height || style.font_size || cfg.pdf.currentLineHeight();
	var spaceWidth = cfg.pdf.widthOfString(" "), queue = [], bbs = [];
	var paragraphs = String(text).split(/\n/g), y = 0, curRect = startbb;
	var startY = curRect ? curRect.y : 0;

	(function paragraphLoop(i) {
	// for (var i = 0; i < paragraphs.length; ++i) {
		if (i >= paragraphs.length) {
			debug && console.log("paragraphLoopDone");
			doneFn();
			return;
		}
		var paragraph = paragraphs[i];
		//bb for current line
		if (!curRect) {
			if (style.width) {
				//should only happen on the first, so I can use getDrawOutlineBBs to put me in the right spot
				//then rely on the else below to catch all the rest
				var bb = new BB(0, 0, cfg.parseWidth(style.width), lineHeight);
				var dobbs = cfg.getDrawOutlineBBs(bb, style);
				curRect = dobbs.outline;
				curRect.height = lineHeight;
			} else {
				curRect = getSmartLineBB();
				//# right?
			}
			startY = curRect.y;
		} else if (style.item_display == "smart_wrap") {
			if (!style.width) curRect = getSmartLineBB();
		} else {
			curRect = new BB(curRect);
			curRect.height = style.line_height || style.font_size || cfg.pdf.currentLineHeight();
			curRect.y = startY + y;
		}

		if (!style.ignoreNewPage
			&& curRect.y + curRect.height > cfg.parentBB.y + cfg.parentBB.height) {
			cfg.reqNewPage(function() {
				flushFn && flushFn(queue);
				startY = curRect.y = cfg.parentBB.y;
				y = 0;

				buildQueue(function queueBuilt() {
					paragraphLoop(i + 1);
				});
			});
		} else {
			buildQueue(function queueBuilt() {
				flushFn && flushFn(queue);
				paragraphLoop(i + 1);
			});
		}

		function buildQueue(queueBuilt) {
			var buffer = "", w = 0;
			var words = paragraph.split(/\s+/g);
			debug && console.log("buildingQueue");
			(function forWord(i) {
				if (i >= words.length) {
					if (buffer) { //last or only line in paragraph
						y += queueLine(buffer, curRect, xOffset, true, i == paragraphs.length - 1);
					}
					debug && console.log("queueBuilt");
					queueBuilt();
					return;
				}
				debug && console.log("forWord", i, words.length)
				var word = words[i];

				var ww = cfg.pdf.fontSize(style.font_size || 0).widthOfString(word) + spaceWidth;

				if (w + ww > curRect.width - xOffset) {

					y += queueLine(buffer, curRect, xOffset);

					if (style.item_display == "smart_wrap" && !style.width) {
						curRect = getSmartLineBB();
					} else {
						curRect = new BB(curRect);
						curRect.y = startY + y;
					}
					if (curRect.y + curRect.height > cfg.parentBB.y + cfg.parentBB.height) {
						flushFn && flushFn(queue);
						cfg.reqNewPage(function() {
							startY = curRect.y = cfg.parentBB.y;
							y = 0;
							forWord(i + 1);
						});
					} else {
						buffer = word + " ";
						w = ww;
						forWord(i + 1);
					}
				} else {
					buffer += word + " ";
					w += ww;
					forWord(i + 1);
				}
			})(0);
		}

		function getSmartLineBB() {
			var bbs = cfg.parentBB.getBBs().slice();

			var rects = [];
			queue.forEach(function(line) {
				rects.push(line.rect);
				bbs.push(line.rect);
			});

			bbs = bbs.sort(function(a, b) {
				return a.y - b.y;
			});
			bbs.unshift(new BB(cfg.parentBB.x, cfg.clearY, 0, 0));

			for (var i = 0; i < bbs.length; ++i) {
				var bb = bbs[i];
				if (bb.y + bb.height >= cfg.clearY) {
					var poss = cfg.parentBB.getWRectsForVLine(bb.y + bb.height, lineHeight, rects);
					if (poss[0] && poss[0].width) return poss[0]; 
				}
			}
			return null;
		}
	// }
	})(0);

	//add current line to queue with formatting data, return height
	function queueLine(text, rect, xOffset, paragaphEnd, last) {
		var wordSpacing = 0, renderwidth = rect.width, align = style.align || "left", text = text.trim();
		if (align == "justify" && !paragaphEnd) {
			var words = text.trim().split(/\s+/g);
			var twidth = cfg.pdf.widthOfString(words.join(""));

			align = "left";
			var wordSpacing = Math.max(0, (rect.width - xOffset - twidth) / Math.max(1, words.length - 1) - spaceWidth);
			renderwidth = 1E5;
		}

		var height = rect.height + style.font_size / 7;
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
			font: style.font,
			rect: new BB(rect.x, rect.y, rect.width, height),
			wordSpacing: wordSpacing
		});

		return height;
	}
}

DrawManager.prototype.drawTextQueue = function(queue, cfg, style, reportBBs) {
	var bbs = [];
/*
	if (style.item_display != "smart_wrap" && style.border_width && style.border) {
		cfg.pdf.rect(queue[0].rect.x, queue[0].rect.y, queue[0].rect.width, queue[queue.length - 1].rect.y - queue[0].rect.y + queue[queue.length - 1].rect.height).lineWidth(style.border_width).stroke(style.border_color);
	}
*/
/*
	if (style.item_display != "smart_wrap" && style.background_color) {
		cfg.pdf.rect(queue[0].rect.x, queue[0].rect.y, queue[0].rect.width, queue[queue.length - 1].rect.y - queue[0].rect.y + queue[queue.length - 1].rect.height).fill(style.background_color);
	}
*/
	queue.forEach(function(line) {
		if (!line.drawn) {
			bbs.push(line.rect);
			cfg.pdf.fontSize(style.font_size).font(line.font).fillColor(style.color).text(line.text.trim(), line.rect.x + (style.padding || style.padding_left || 0), line.rect.y + line.top, {
				width: line.renderwidth,
				align: line.align,
				wordSpacing: line.wordSpacing
			});
			line.drawn = true;
		}
	});
	reportBBs && reportBBs(bbs);
}

DrawManager.prototype.drawText = function(item, cfg) {
	var style = StyleManager.extendStyle(cfg.parentStyle, item), self = this;

	var xOffset = style.padding ? style.padding * 2 : ((style.padding_left || 0) + (style.padding_right || 0));
	xOffset += style.border_width * 2 || 0;

	cfg.pdf.fontSize(style.font_size).font(style.font);
	// var contentVars = item.content.match(/#\{(.+?)}/g);
	// if (contentVars) {
	// 	contentVars.forEach(function(varName) {
	// 		var varVal;
	// 		switch(varName) {
	// 			case "page_num": return this.pdf.getPageName;
	// 		}
	// 		if (typeof varVal != "undefined") {
	// 			item.content = item.content.replace("#{" + varName + "}", varVal);
	// 		}
	// 	});
	// }

	var content = item.content.replace(/#\{(.+?)}/g, function(match, varName) {
		switch(varName) {
			case "pagenum": return PDFManager.getCurPageNum();
		}
	});

	this.genTextQueue(content, null, xOffset, style, cfg, function done(queue) {
		self.drawTextQueue(queue, cfg, style, function(lastBBs) {
			cfg.parentBB.addBB(lastBBs);
		});
	}, function() {
		cfg.itemDrawn && cfg.itemDrawn();
	});
}

DrawManager.prototype.drawTable = function(item, cfg) {
	var self = this;

	var tableStyle = StyleManager.extendStyle(
		StyleManager.extendDefaults(item),
			{ content: null });
	tableStyle = StyleManager.extendStyle(tableStyle, item.content.table);

	var tableWidth = cfg.parseWidth(item.content.table.width);
	if (tableWidth < 0) tableWidth *= -cfg.parentBB.width;

	var oBB = new BB(cfg.parentBB.x, cfg.parentBB.y, tableWidth, 0);
	var dobbs = cfg.getDrawOutlineBBs(oBB, tableStyle);

	var cellStyle = StyleManager.extendStyle(tableStyle, { padding: null, padding_top: null, padding_bottom: null, padding_right: null, padding_left: null });
	//data
	var colData = item.content.table.columns || [],
		thead = StyleManager.extendStyle(cellStyle, item.content.table.thead || {}),
		tbody = StyleManager.extendStyle(cellStyle, item.content.table.tbody || {}),
		title = StyleManager.extendStyle(cellStyle, item.content.table.title || {});
	
	var cp = cellStyle.hasOwnProperty("cell_padding") ? tableStyle.cell_padding : 2;	
	
	var rows = [];
	
	colData.forEach(function(col) {
		var row = [];
		if (item.content.table.thead && item.content.table.thead.show == "1") {
			row.push({
				content: col.name
			});
		}
		item.content.data.forEach(function(datum) {
			row.push({
				content: datum[col.k] || ""
			});
		})
		rows.push(row);
	});


	//style
	rows.forEach(function(row, i) {
		row.forEach(function(cell, j) {
			var style = {};
			if (colData[i].thead == "1" || (thead.show == "1" && j == 0)) {
				style = StyleManager.extendStyle(cellStyle, thead);
			} else {
				style = StyleManager.extendStyle(style, tbody);
			}

			style = StyleManager.extendStyle(style, colData[i]);

			if (row._opts) {
				if (row._opts._all) {
					style = StyleManager.extendStyle(style, row._opts._all);
				}
				if (row._opts[colData[i].k]) {
					StyleManager.extendStyle(style, row._opts[colData[i].k]);
				}
			}

			style = StyleManager.extendStyle(style, { width: null, ignoreNewPage: true });

			cell.style = style;
		});
	});
	
	//width + update oBB
	if (item.content.table.orientation == "horizontal") {
		rows.forEach(function(row, i) {
			var cells = row.length;
			if (thead.show == "1") cells--;
			var theadwidth = -cfg.parseWidth(thead.h_width) * tableWidth;
			row.forEach(function(cell, j) {
				if (thead.show == "1" && j == 0) {
					cell.width = -cfg.parseWidth(thead.h_width) * tableWidth;
				} else {
					cell.width = (tableWidth - theadwidth) / cells;
				}
			});
		});
	} else {
		rows.forEach(function(row, i) {
			row.forEach(function(cell, j) {
				cell.width = -cfg.parseWidth(colData[i].width) * tableWidth;
			});
		});
	}
	
	//compose
	if (item.content.table.orientation != "horizontal") {
		var cols = new Array();
		rows[0].forEach(function() {
			cols.push([]);
		})

		rows.forEach(function(row, i){
			row.forEach(function(cell, j) {
				cols[j][i] = cell;
			})
		})
		rows = cols;
	}

	//predraw
	var oBB = dobbs.draw;
	oBB.y -= (tableStyle.padding || tableStyle.padding_top || 0);
	var x = oBB.x, y = oBB.y + (tableStyle.padding || tableStyle.padding_top || 0);

	drawTitle(function titleDrawn() {
		genRowQueues(function() {
			valignRows();
			flush();
			cfg.itemDrawn();
		});
	});

	//title
	function drawTitle(titleDrawn, continued) {
		if (title) {
			var bb = new BB(x + cp, y + cp, tableWidth - cp * 2, title.font_size - cp * 2);
			if (continued) title.content += " cont.";

			self.genTextQueue(title.content, bb, 0, title, cfg, function(queue, done) {
				self.drawTextQueue(queue, cfg, title);
			}, function() {
				y += title.font_size * 9 / 7;
				titleDrawn();
			});
		}
	}

	//body
	function genRowQueues(rowQueuesDone) {
		(function outerRowLoop(i) {
			// for (var i = 0; i < rows.length; ++i) {
			if (i >= rows.length) {
				rowQueuesDone();
				return;
			}
			debug && console.log("outerRowLoop");

			var curRow = rows[i];
			x = oBB.x;
			var maxHeight = 0;

			genTextQueues(function textQueuesDone() {
				debug && console.log("textQueuesDone");
				y += maxHeight + cp * 2;
				oBB.height = y - oBB.y + (tableStyle.padding || tableStyle.padding_bottom || 0);
				debug && console.log("checking page");
				checkNewPage(function() {
					debug && console.log("page checked");
					outerRowLoop(i + 1);
				});
			});

			function genTextQueues(textQueuesDone) {
				// row.forEach(function(cell, j) {
				(function innerRowLoop(j) {
					if (j >= curRow.length) {
						textQueuesDone(maxHeight);
						return;
					}
					var cell = curRow[j];

					var bb = new BB(x + cp, y + cp, cell.width - cp * 2, cell.style.font_size);
					// cfg.pdf.rect(bb.x, bb.y, bb.width, bb.height).lineWidth(1).stroke("black");

					x += cell.width;

					debug && console.log("startingTextQueueGen");
					self.genTextQueue(cell.content, bb, 0, cell.style, cfg, function(queue, done) {
						debug && console.log("genTextQueueFlushed");
						// cfg.pdf.rect(titleCell.x, titleCell.y, titleCell.width, titleHeight).lineWidth(1).stroke("black");
						if (cell.style.clip == "1") queue = queue.slice(0, 1);
						cell.textQueue = queue;
						cell.height = 0;
						queue.forEach(function (tobj) {
							cell.height += tobj.rect.height;
						});
						if (cell.height > maxHeight) maxHeight = cell.height;
					}, function() {
						debug && console.log("genTextQueueDone");
						innerRowLoop(j + 1);
					});
					
				})(0);
				// });
			}

			function checkNewPage(pageMadeOrNot) {
				// console.log(y, cfg.parentBB);
				if (y > cfg.parentBB.y + cfg.parentBB.height
					&& rows.length - i - 1 > 0) {
					flush();
					cfg.reqNewPage(function() {
						//copy outer bb, move to top of page but keep x pos
						oBB = new BB(oBB);
						x = oBB.x;
						y = cfg.parentBB.y;
						oBB.y = y;
						
						drawTitle(function() {
							if (item.content.table.orientation != "horizontal" && item.content.table.thead.show == "1") {
								var headerRow = curRow.slice();
								headerRow.forEach(function(cell, i) {
									cell.style = StyleManager.extendStyle(thead, colData[i]);
									cell.content = colData[i].name;
									delete cell.drawn;
								})
												
								rows.splice(i, 0, headerRow);
							}
							pageMadeOrNot();
						}, true);
						
						
						// var diff = 0;
						// curRow.forEach(function(cell, j) {
						// 	if (j == 0) diff = cell.textQueue[0].rect.y - y;
						// 	cell.textQueue.forEach(function(line) {
						// 		// line.rect.y -= diff;
						// 	})
						// })
					});
				} else {
					pageMadeOrNot();
				}
			}
		})(0)
	}

	function valignRows() {
		rows.forEach(function(row, i) {
			var maxHeight = 0;
			row.forEach(function(cell) {
				if (cell.height > maxHeight) {
					maxHeight = cell.height;
				}
			})
			row.forEach(function(cell) {
				var d = 0;
				if (cell.style.valign == "top") {
					//already there
				} else if (cell.style.valign == "bottom") {
					d = maxHeight - cell.height;
				} else {
					d = (maxHeight - cell.height) / 2;
				}
				cell.textQueue.forEach(function(tobj) {
					tobj.rect.y += d;
				})
			})
		})
	}

	function flush() {
		var bbs = [];
		//draw
		rows.forEach(function(row) {
			row.forEach(function(cell) {
				if (cell.textQueue && !cell.drawn) {
					cell.textQueue.forEach(function(tq) {
						bbs.push(tq.rect);
					})
					self.drawTextQueue(cell.textQueue, cfg, cell.style);
					cell.drawn = true;
				}
			})
		})
// 		cfg.parentBB.addBB(bbs);
		cfg.parentBB.addBB(oBB);
	}
}
