#!/usr/bin/env nodejs
var PDFDocument = require("pdfkit"),
	PNG = require("pngjs").PNG,
	request = require("request"),
	rappar = require("./rappar.js"),
	svgo = new (require("svgo"))(),
	util = require("util"),
	URL = require("url"),
	fs = require("fs"),
	http = require("http");
	
var debug = false;
// debug = true;
var PORT = 6476;

var queue = [],
	jobActive = false;
function queueJob(outPath, docs, done) {
	queue.push({
		outPath: outPath,
		docs: docs,
		done: done
	});
	handleQueue();
}
function handleQueue() {
	// trace();
	if (!jobActive) {
		var next = queue.shift();
		if (next) {
			jobActive = true;
			run(next.outPath, next.docs, function() {
				next.done();
				jobActive = false;
				handleQueue();
			});
		}
	}
}

function trace(msg, id) {
	altLog(msg, id, console.trace);
}

function error(msg, id) {
	altLog(msg, id, console.error);
}

function log(msg, id) {
	altLog(msg, id, console.log);
}

function altLog(msg, id, handle) {
	var logStr = "[" + (new Date()).toUTCString() + "]";
	if (id) {
		logStr += " [id: " + +(Date.now()) + "]";
	}
	logStr += "\n\t" + msg;

	handle(logStr);
}

function die(e, exit) {
	exit = exit || false;
	// if (res) {
	// 	var err = e instanceof Error ? e : new Error(e);
	// 	res.end({
	// 		success: 0,
	// 		error: e + "\n" + e.stack;
	// 	});
	// }
	trace();
	if (exit) throw new Error(e); // ###
	else error(e);

	jobActive = false;
	// handleQueue();
}

var server = http.createServer(function(req, res) {
	var responseJSON = {
		success: 0,
	};

	if (req.method == "POST") {
		var body = "";
		req.on("data", function(data) {
			body += data;
		});
		req.on("end", function(data) {
			res.writeHead(200, {"Content-Type": "application/json"});
			try {
				if (data) body += data;
				var outerJSON;
				try {
					outerJSON = JSON.parse(body);
				} catch (e) {
					res.end(JSON.stringify({
						success: 0,
						error: "Invalid input json:\n" + body + "\t(length " + body.length + ")\n" + e,
					}));
					// die("Invalid input json:\n" + body + " (length " + body.length + ")\n" + e);
					return;
				}
				
				var docs = outerJSON.docs || [ outerJSON ],
					output_file = outerJSON.output_file;
				
				run(output_file, docs, function() {
					var stats = fs.lstatSync(outerJSON.output_file);
					if (stats.isFile()) {
						res.end(JSON.stringify({
							success: 1,
							output_file: outerJSON.output_file,
						}));
					} else {
						res.end(JSON.stringify({
							success: 0,
							error: "Something went wrong! No output file: " + outerJSON.output_file,
						}));
						die("No output file: " + outerJSON.output_file);
					}
				});

			} catch(e) {
				res.end(JSON.stringify({
					success: 0,
					error: e + "\n" + e.stack,
				}));
				die(e);
			}
		});
	} else {
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end({
			success: 0,
			error: "Not a POST request."
		});
		var e = new Error("Not a post request.");
		die(e);
	}
});

server.listen(PORT, '127.0.0.1');
log("Listening on port " + PORT);

function run(outPath, pdfList, done) {

	if (!Array.isArray(pdfList)) {
		pdfList = [ pdfList ];
	}

	var wrapper = new PDFWrapper();

	wrapper.begin(outPath);
	(function pdfLoop(i) {
		var curJSON = pdfList[i];
		if (i >= pdfList.length) {
			wrapper.finish(function() {
				done();
			});
			return;
		}
		wrapper.render(curJSON, function() {
			pdfLoop(i + 1);
		})
	})(0);
}

var origDefaults = defaults = {
	font: "Helvetica",
	font_size: 12,
	color: "#000",
	background_color: "#fff",
};

function StyleManager() {
	var defaults = {};
	this.getDefaults = function() {
		return defaults;
	}
	this.resetDefaults = function() {
		defaults = {};
		this.updateDefaults(origDefaults);
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
	this.resetDefaults();
}

var PDFWrapper = function() {
	var doc, pdfArtist, outPath, ws,
		pageCount = 1,
		absPageCount = 1,
		docCount = 0,
		id = (+Date.now());
	var internalSVGContainers = {};

	var styleManager = new StyleManager();

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
	this.begin = function(path) {
		outPath = path;

		doc = new PDFDocument(this._toPDFKitLayout());
		ws = fs.createWriteStream(outPath);
		doc.pipe(ws);

		// log(doc.page);
	}
	this.finish = function(done) {
		log("Writing file " + outPath, id);

		Object.keys(internalSVGContainers).forEach(function(key) {
       		internalSVGContainers[key].ref.end();
		})
		
		ws.on("finish", function() {
			done();
		});
		doc.end();
	}
	this.render = function(json, done) {
		this.resetDoc();

		pdfArtist = new PDFArtist(this, json, styleManager, id);

		if (typeof json["default"] == "object") {
			styleManager.updateDefaults(json["default"]);
		}

		this.updatePageLayout({
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
		this.updatePageLayout(json);

		docCount++;
		pdfArtist.drawMarginRegions(function() {
			pdfArtist.drawBody(function() {
				if (docCount == 1) absPageCount++;
				done();
			});
		});
	}
	this.resetDoc = function() {
		if (docCount >= 1) this.addPage();
		pageCount = 1;
		pdfArtist = null;
		pageLayout = {
			size: [ 8.5 * 72, 11 * 72 ],
			layout: "portrait",
			margin_top: 0,
			margin_right: 0,
			margin_bottom: 0,
			margin_left: 0,
			header: {
				height: 0,
			},
			footer: {
				height: 0,
			},
			left_sidebar: {
				width: 0,
			},
			right_sidebar: {
				width: 0,
			},
		};
	}
	this.updatePageLayout = function(newLayout) {
		Object.keys(newLayout).forEach(function(key) {
			if (newLayout[key]) {
				pageLayout[key] = newLayout[key];
			}
		});
	}
	this.addPage = function() {
		doc.addPage(this._toPDFKitLayout());

		pageCount++;
		absPageCount++;
	}
	this.getCurPage = function() {
		return doc;
	}
	this.getCurPageNum = function() {
		return pageCount;
	}
	this.getAbsPageNum = function() {
		return absPageCount;
	}

	this.pushSVGContainer = function(key, ref, width, height) {
		var resources = doc.ref({
       		ProcSet: [ "PDF", "Text", "ImageB", "ImageC", "ImageI" ]
       	});
		ref.data["Resources"] = resources;
		resources.end();

		var fmName = "Fm" + Object.keys(internalSVGContainers).length;

		internalSVGContainers[key] = {
			fmName: fmName,
			ref: ref,
			width: width,
			height: height
		};

		return internalSVGContainers[key];
	}
	this.getSVGContainer = function(key) {
		return internalSVGContainers[key];
	}

	this.hasRegion = function(region) {
		return region == "body" || (pageLayout[region] && (pageLayout[region].height || pageLayout[region].width));
		// && (pageCount == 1 && pageLayout[region].pages.indexOf("first") >= 0);
	}
	this.getBBForRegion = function(region) {
		var bb, dim = this._pageDimensions();
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
				// log("Weird region: " + region);
				break;
		}
		return bb;
	}
	this._pageDimensions = function() {
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
	this._toPDFKitLayout = function() {
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
}

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

function PDFArtist(pdfWrapper, json, styleManager, id) {
	this.imgCache = {};
	this.pdfWrapper = pdfWrapper;
	this.json = json;
	this.styleManager = styleManager;
	this.id = id;
}

PDFArtist.prototype.pushImgCache = function(key, img) {
	this.imgCache[key] = img;
}

PDFArtist.prototype.getCachedImg = function(key) {
	return this.imgCache[key];
}

PDFArtist.prototype.clearImgCache = function(key) {
	if (key) {
		delete this.imgCache[key];
	} else {
		this.imgCache = {};
	}
}

PDFArtist.prototype.pushLocalCache = function(url, data) {
	var fileName = "/tmp/" + encodeURIComponent(url);
	try {
		fs.writeFileSync(fileName, data);
	} catch(e) {}
}

PDFArtist.prototype.tryLoadLocalCache = function(url) {
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

PDFArtist.prototype.drawItems = function(items, cfg) {
	var self = this;
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

	cfg.getDrawOutlineBBs = function (bb, style, done) {
		var cfgSelf = this;
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

		// if (bb.height < 0) {
		// 	outlineDim.height = -Math.max(-1, bb.height) * this.parentBB.height;
		// }

			// if fits next to spans, put it there		
		var outline = new BB(pos.bounds.x, pos.bounds.y, outlineDim.width, outlineDim.height);
		
		if (outline.y + outline.height > this.parentBB.y + this.parentBB.height && this.region == "body") {
			cfg.reqNewPage(function() {
				outline.y = cfgSelf.parentBB.y;
				outline.x = cfgSelf.parentBB.x;
				returnBBs();
			});
		} else {
			returnBBs();
		}
			
		function returnBBs() {

			var bg = new BB(outline);
			var draw = new BB(outline.x + padding.left, outline.y + padding.top, bb.width, bb.height);
			// if display_style == div, extend width
			if (!style.item_display || style.item_display == "div") {
				outline.width = cfgSelf.parentBB.x + cfgSelf.parentBB.width - pos.x;
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
			done({
				outline: outline,
				draw: draw,
				bg: bg
			});
		}

	}
	
	cfg.reqNewPage = function(doneFn) {
		// debug && this.parentBB.draw(this.pdf);
		if (this.region != "body") {
			doneFn();
			return;
		}

		self.pdfWrapper.addPage();
		self.drawMarginRegions(function() {
			// self.drawBody(function() {
				doneFn();
			// });
		});
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
		debug && log(cur, self.id);
		setImmediate(function() {
			self.drawItem(cur, cfg);
		})
	}
}

PDFArtist.prototype.bgAndBorder = function(bb, style, cfg) {
	if (style.background_color && style.background_color != this.styleManager.getDefaults().background_color) {
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

PDFArtist.prototype.drawItem = function(item, cfg) {
	switch (item.object_type) {
		case "text": return this.drawText(item, cfg);
		case "table": return this.drawTable(item, cfg);
		case "hline": return this.drawHLine(item, cfg);
		case "vline": return this.drawVLine(item, cfg);
		case "svg": return this.drawSVG(item, cfg);
		case "png": return this.drawPNG(item, cfg);
		case "pagebreak": return this.pageBreak(item, cfg);
		default:
			log("Odd object type! " + item.object_type, this.id);
			cfg.itemDrawn();
	}
}

PDFArtist.prototype.drawBody = function(doneFn) {
	this.drawRegion("body", doneFn);
}

PDFArtist.prototype.drawMarginRegions = function(doneFn) {
	// debug && this.parentBB.draw(this.pdf);
	var self = this;

	var regions = [ "header", "footer", "left_sidebar", "right_sidebar" ];

	(function regionLoop(regionIndex) {
		// throw new Error();
		self.drawRegion(regions[regionIndex], function() {
			if (regionIndex >= regions.length - 1) {
				doneFn();
			} else {
				regionLoop(regionIndex + 1);
			}
		})
	})(0);
}

PDFArtist.prototype.drawRegion = function(region, doneFn) {
	// debug && this.parentBB.draw(this.pdf);

	if (this.pdfWrapper.hasRegion(region)) {
		var regionJSON, style;
		if (region == "body") {
			regionJSON = this.json;
			style = this.styleManager.getDefaults();
		} else {
			regionJSON = this.json.page[region];
			style = this.styleManager.extendDefaults(
						this.styleManager.extendStyle(regionJSON,
							{ items: null, height: null, width: null, }));
		}
		if (!regionJSON) {
			doneFn();
			return;
		}

		var regionBB = new MBB(this.pdfWrapper.getBBForRegion(region));
		// this.pdfWrapper.getCurPage().rect(regionBB.x, regionBB.y, regionBB.width, regionBB.height).strokeColor("blue").stroke();
		
		this.drawItems(regionJSON.items, {
			pdf: this.pdfWrapper.getCurPage(),
			parentBB: regionBB,
			parentStyle: style,
			region: region,
			done: doneFn,
		});
	} else {
		// log(region, this.id);
		doneFn();
	}
}

PDFArtist.prototype.pageBreak = function(item, cfg) {
	cfg.reqNewPage(function() {
		cfg.itemDrawn();
	});
}

PDFArtist.prototype.drawHLine = function(item, cfg) {
	var self = this;

	if (!item.line_length) item.display_style = "div";
	var style = this.styleManager.extendStyle(cfg.parentStyle, item);

	var bb = new BB(0, 0, item.line_length || -1, style.line_width || 1);
	cfg.getDrawOutlineBBs(bb, style, function(dobbs) {
		var draw = dobbs.draw;
		self.bgAndBorder(dobbs.bg, style, cfg);
		cfg.pdf.lineWidth(style.line_width || 1)
			.strokeColor(style.color)
			.moveTo(draw.x, draw.y + item.line_width / 2)
			.lineTo(draw.x + (item.line_length || draw.width), draw.y + item.line_width / 2)
			.stroke();
		
		cfg.itemDrawn(dobbs.outline);
	})
}

PDFArtist.prototype.drawVLine = function(item, cfg) {
	var self = this;
	var style = this.styleManager.extendStyle(cfg.parentStyle, item);

	cfg.getDrawOutlineBBs(bb, style, function(dobbs) {
		var draw = dobbs.draw;
		self.bgAndBorder(dobbs.bg, style, cfg);
		cfg.pdf.lineWidth(style.line_width || 1)
			.strokeColor(style.color)
			.moveTo(draw.x + item.line_width / 2, draw.y)
			.lineTo(draw.x + item.line_width / 2, draw.y + (item.line_length || draw.width))
			.stroke();
		
		cfg.itemDrawn(dobbs.outline);
	})
}

PDFArtist.prototype.drawSVG = function(item, cfg) {
	var style = this.styleManager.extendStyle(cfg.parentStyle, item),
		self = this;

	var oldAdd = cfg.pdf.addContent;

	var xobjContainer = this.pdfWrapper.getSVGContainer(item.content.path || item.content.url);
	// xobjContainer = null;
	if (xobjContainer) {
		writeSVG(xobjContainer);
	} else {
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
			}
		} catch(e) {
			if (debug) {
				error("Error loading SVG file " + (item.content.path || item.content.url), self.id);
				error(e, self.id);
			}
			cfg.itemDrawn();
		}
	}

	function renderSVG(svg) {
		if (!cachedImg) {
			self.pushImgCache(item.content.path || item.content.url, svg);
		}

		var xobjectRef = cfg.pdf.ref({
			Type: "XObject",
			Subtype: "Form",
		});

		var finalRect;
		try {
			svgo.optimize(svg, function(mind) {
				// max_width, max_height required

				cfg.pdf.addContent = function(content) {
					xobjectRef.write(content);
					return cfg.pdf;
				}
				
				var parts = rappar(svg);
				parts.some(function(part, i) {
					cfg.pdf.save();
					if (part.type == "path") {
						cfg.pdf.path(part.path);

						if (part["stroke-width"]) cfg.pdf.lineWidth(part["stroke-width"]);
						cfg.pdf.strokeColor(part.stroke)
							.fillColor(part.fill).opacity(part.opacity || 1);

						if (part.fill != "none" && part.stroke != "none") {
							cfg.pdf.fillAndStroke(part.fill, part.stroke);
						} else {
							if (part.fill != "none") cfg.pdf.fill(part.fill);
							if (part.stroke != "none") cfg.pdf.stroke(part.stroke);
						}
					} else if (part.type == "rect") {
						if (part["stroke-width"]) cfg.pdf.lineWidth(part["stroke-width"]);
						cfg.pdf.strokeColor(part.stroke)
							.fillColor(part.fill)
							.rect(part.x, part.y, part.width, part.height)
					}
					cfg.pdf.restore();
				});
				cfg.pdf.addContent = oldAdd;

				var width = parseInt(mind.info.width, 10), height = parseInt(mind.info.height, 10);
				xobjectRef.data["BBox"] = [ 0, 0, width, height];

				var container = self.pdfWrapper.pushSVGContainer(item.content.path || item.content.url,
								xobjectRef,
								width,
								height);

				writeSVG(container);
			});
		} catch(e) {
			// if (debug) {
				error("Error drawing SVG file " + (item.content.path || item.content.url), self.id);
				error(e, self.id);
			// }
			cfg.pdf.addContent = oldAdd;
			cfg.itemDrawn();
		}
	}

	function writeSVG(container) {
		// var container = this.pdfWrapper.pushSVGContainer(item.content.path || item.content.url, xobjectRef, svgWidth, svgHeight);

		cfg.pdf.page.xobjects[container.fmName] = container.ref;

		//constrain within [ 0, max_width ]
		var width = item.max_width,
			height = item.max_width / container.width * container.height;

		//constrain within [ 0, max_height ]
		if (height > item.max_height) {
			height = item.max_height;
			width = item.max_height / container.height * container.width;
		}

		var scaleFactor = width / container.width;

		var bb = new BB(0, 0, width, height);
		cfg.getDrawOutlineBBs(bb, style, function(dobbs) {
			var draw = dobbs.draw;
			cfg.pdf.save();

				cfg.pdf.translate(draw.x, draw.y);
				cfg.pdf.scale(scaleFactor);
				
				cfg.pdf.addContent("/" + container.fmName + " Do");

			cfg.pdf.restore();

			cfg.itemDrawn(dobbs.outline);
		});
	}
}

PDFArtist.prototype.drawPNG = function(item, cfg) {
	var style = this.styleManager.extendStyle(cfg.parentStyle, item);
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
		// log("No url/path specified for png. " + item, self.id);
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
			cfg.getDrawOutlineBBs(bb, style, function(dobbs) {
				var draw = dobbs.draw, finalRect = dobbs.outline;	

				cfg.pdf.image(img.buf, draw.x, draw.y, {
					width: width,
					height: height
				});
				cfg.itemDrawn(finalRect);
			})
		} catch(e) {
			if (debug) {
				error("PNG drawing failed for " + (item.content.path || item.content.url), self.id);
				error(e, self.id);
			}
			cfg.itemDrawn(finalRect);
		}
	}
}

PDFArtist.prototype.genTextQueue = function(text, startbb, xOffset, style, cfg, flushFn, doneFn) {
	var self = this;

	//set font height before falling
	xOffset = xOffset || 0;
	var lineHeight = style.line_height || style.font_size || cfg.pdf.currentLineHeight();
	var spaceWidth = cfg.pdf.widthOfString(" "), queue = [], bbs = [];
	var paragraphs = String(text).split(/\n/g), y = 0, curRect = startbb;
	var startY = curRect ? curRect.y : 0;

	(function paragraphLoop(i) {
	// for (var i = 0; i < paragraphs.length; ++i) {
		if (i >= paragraphs.length) {
			debug && log("paragraphLoopDone", self.id);
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
				cfg.getDrawOutlineBBs(bb, style, function(dobbs) {
					curRect = dobbs.outline;
					curRect.height = lineHeight;
					startY = curRect.y;
					buildQueues();
				});
			} else {
				curRect = getSmartLineBB();
				//# right?
				startY = curRect.y;
				buildQueues();
			}
			startY = curRect.y;
		} else if (style.item_display == "smart_wrap") {
			if (!style.width) curRect = getSmartLineBB();
			buildQueues();
		} else {
			curRect = new BB(curRect);
			curRect.height = style.line_height || style.font_size || cfg.pdf.currentLineHeight();
			curRect.y = startY + y;
			buildQueues();
		}

		function buildQueues() {
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
		}


		function buildQueue(queueBuilt) {
			var buffer = "", w = 0;
			var words = paragraph.split(/\s+/g);
			debug && log("buildingQueue", self.id);
			(function forWord(i) {
				if (i >= words.length) {
					if (buffer) { //last or only line in paragraph
						y += queueLine(buffer, curRect, xOffset, true, i == paragraphs.length - 1);
					}
					debug && log("queueBuilt", self.id);
					queueBuilt();
					return;
				}
				debug && log("forWord " + i + " " + words.length, self.id);
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

PDFArtist.prototype.drawTextQueue = function(queue, cfg, style, reportBBs) {
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

PDFArtist.prototype.drawText = function(item, cfg) {
	var style = this.styleManager.extendStyle(cfg.parentStyle, item), self = this;

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
			case "pagenum": return self.pdfWrapper.getCurPageNum();
			case "abspagenum": return self.pdfWrapper.getAbsPageNum();
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

PDFArtist.prototype.drawTable = function(item, cfg) {
	var self = this;

	var tableStyle = this.styleManager.extendStyle(
		this.styleManager.extendDefaults(item),
			{ content: null });
	tableStyle = this.styleManager.extendStyle(tableStyle, item.content.table);

	var tableWidth = cfg.parseWidth(item.content.table.width);
	if (tableWidth < 0) tableWidth *= -cfg.parentBB.width;

	var cellStyle = this.styleManager.extendStyle(tableStyle, { padding: null, padding_top: null, padding_bottom: null, padding_right: null, padding_left: null });
	//data
	var colData = item.content.table.columns || [],
		thead = this.styleManager.extendStyle(cellStyle, item.content.table.thead || {}),
		tbody = this.styleManager.extendStyle(cellStyle, item.content.table.tbody || {}),
		title = this.styleManager.extendStyle(cellStyle, item.content.table.title || {});
	
	var cp = cellStyle.hasOwnProperty("cell_padding") ? tableStyle.cell_padding : 2;	
	
	var rows = [];

	var oBB = new BB(cfg.parentBB.x, cfg.parentBB.y, tableWidth, 0),
		x, y;

	cfg.getDrawOutlineBBs(oBB, tableStyle, function(dobbs) {
		
		oBB = dobbs.draw;
		oBB.y -= (tableStyle.padding || tableStyle.padding_top || 0);

		x = oBB.x;
		y = oBB.y + (tableStyle.padding || tableStyle.padding_top || 0);

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
					style = self.styleManager.extendStyle(cellStyle, thead);
				} else {
					style = self.styleManager.extendStyle(style, tbody);
				}

				style = self.styleManager.extendStyle(style, colData[i]);

				if (row._opts) {
					if (row._opts._all) {
						style = self.styleManager.extendStyle(style, row._opts._all);
					}
					if (row._opts[colData[i].k]) {
						self.styleManager.extendStyle(style, row._opts[colData[i].k]);
					}
				}

				style = self.styleManager.extendStyle(style, { width: null, ignoreNewPage: true });

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

		drawTitle(function titleDrawn() {
			genRowQueues(function() {
				valignRows();
				flush();
				cfg.itemDrawn();
			});
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
			debug && log("outerRowLoop");

			var curRow = rows[i];
			x = oBB.x;
			var maxHeight = 0;

			genTextQueues(function textQueuesDone() {
				debug && log("textQueuesDone", self.id);
				y += maxHeight + cp * 2;
				oBB.height = y - oBB.y + (tableStyle.padding || tableStyle.padding_bottom || 0);
				debug && log("checking page", self.id);
				checkNewPage(function() {
					debug && log("page checked", self.id);
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

					debug && log("startingTextQueueGen", self.id);
					self.genTextQueue(cell.content, bb, 0, cell.style, cfg, function(queue, done) {
						debug && log("genTextQueueFlushed", self.id);
						// cfg.pdf.rect(titleCell.x, titleCell.y, titleCell.width, titleHeight).lineWidth(1).stroke("black");
						if (cell.style.clip == "1") queue = queue.slice(0, 1);
						cell.textQueue = queue;
						cell.height = 0;
						queue.forEach(function (tobj) {
							cell.height += tobj.rect.height;
						});
						if (cell.height > maxHeight) maxHeight = cell.height;
					}, function() {
						debug && log("genTextQueueDone", self.id);
						innerRowLoop(j + 1);
					});
					
				})(0);
				// });
			}

			function checkNewPage(pageMadeOrNot) {
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
									cell.style = self.styleManager.extendStyle(thead, colData[i]);
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