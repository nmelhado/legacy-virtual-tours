/*
	krpano radar plugin
	1.18.1
*/

var krpanoplugin = function()
{
	var local = this;

	// krpano/plugin interface
	var krpano        = null;
	var plugin        = null;
	var device        = null;
	var browserevents = null;

	// svg
	var radarsvg    = null;
	var radarsize   = 256;
	var radarsize_x = 256;
	var radarsize_y = 256;

	// local getter/setter variables
	var heading       = 0.0;
	var headingoffset = 90.0;
	var invert        = false;
	var fillcolor     = 0xFFFFFF;
	var linecolor     = 0xFFFFFF;
	var fillalpha     = 0.5;
	var linealpha     = 0.3;
	var linewidth     = 0.0;

	// internals
	var dragging       = false;
	var startdrag      = false;
	var startangle     = null;
	var needupdate     = true;
	var updateinterval = null;
	var last_dom_size  = -1;
	var last_hlookat   = 0;
	var last_hfov      = 0;


	// helper - string to Boolean
	function BOOLEAN(value)
	{
		return ("yesontrue1".indexOf( String(value).toLowerCase() ) >= 0);
	}


	// registerplugin - startup point for the plugin
	local.registerplugin = function(krpanointerface, pluginpath, pluginobject)
	{
		krpano = krpanointerface;
		plugin = pluginobject;

		// verify krpano version
		if (krpano.version < "1.18")
		{
			// show error
			krpano.trace(3, "Radar Plugin - too old krpano version (min. 1.18)");

			krpano = null;
			plugin = null;

			return;
		}

		device = krpano.device;
		browserevents = device.browser.events;

		// register attributes with their type and default value
		plugin.registerattribute("heading",       0.0,      function(v){ heading       = Number(v);   needupdate=true; }, function(){ return heading;       });
		plugin.registerattribute("headingoffset", 90.0,     function(v){ headingoffset = Number(v);   needupdate=true; }, function(){ return headingoffset; });
		plugin.registerattribute("invert",        false,    function(v){ invert        = BOOLEAN(v);  needupdate=true; }, function(){ return invert;        });
		plugin.registerattribute("fillcolor",     0xFFFFFF, function(v){ fillcolor     = parseInt(v); needupdate=true; }, function(){ return fillcolor;     });
		plugin.registerattribute("linecolor",     0xFFFFFF, function(v){ linecolor     = parseInt(v); needupdate=true; }, function(){ return linecolor;     });
		plugin.registerattribute("fillalpha",     0.5,      function(v){ fillalpha     = Number(v);   needupdate=true; }, function(){ return fillalpha;     });
		plugin.registerattribute("linealpha",     0.3,      function(v){ linealpha     = Number(v);   needupdate=true; }, function(){ return linealpha;     });
		plugin.registerattribute("linewidth",     0.0,      function(v){ linewidth     = Number(v);   needupdate=true; }, function(){ return linewidth;     });

		// set the size of the content
		plugin.registercontentsize(radarsize,radarsize);

		// create the SVG
		radarsvg = createSVG(radarsize,radarsize);

		// assign the krpano internal plugin events directly to the svg object
		plugin._assignEvents(radarsvg.path);

		// add the internal 'kobject' object for the correct event processing
		radarsvg.path.kobject = plugin;

		// no events at the 'container' element
		plugin.sprite.style.pointerEvents = "none";

		// add to the DOM
		plugin.sprite.appendChild(radarsvg.svg);

		// add mouse and touch events for controlling
		if (browserevents.mouse)
			radarsvg.path.addEventListener("mousedown", svg_mouse_down, true);

		if (browserevents.touch)
			radarsvg.path.addEventListener(browserevents.touchstart, svg_mouse_down, true);

		// start the update handling (update 30 times per second)
		updateinterval = setInterval(updatehandler, 1000.0 / 30.0);
	}


	// unloadplugin - will be called from krpano when the plugin will be removed
	local.unloadplugin = function()
	{
		if (krpano && plugin)
		{
			clearInterval(updateinterval);

			try
			{
				radarsvg.path.kobject = null;
				plugin.sprite.removeChild(radarsvg.svg);
			}
			catch(e)
			{
			}

			plugin = null;
			krpano = null;
		}
	}


	// plugin resizing - get new size
	local.onresize = function(w,h)
	{
		radarsize_x = w;
		radarsize_y = h;
		radarsize = Math.max(w,h);

		needupdate = true;
		updatehandler();

		// scale unproportionally by CSS transforms
		radarsvg.path.style[device.browser.css.transform] = "scale("+(w/radarsize).toFixed(6)+","+(h/radarsize).toFixed(6)+")";

		return false;
	}


	function createSVG(pixelWidth, pixelHeight)
	{
		// svg namespace
		var ns = "http://www.w3.org/2000/svg";

		var svg = document.createElementNS(ns, "svg");
		svg.setAttribute("width",  pixelWidth);
		svg.setAttribute("height", pixelHeight);

		svg.style.position = "absolute";
		svg.style.left   = 0 + "px";
		svg.style.top    = 0 + "px";
		//svg.style.border = "1px solid red";		// DEBUG

		var path = document.createElementNS(ns, "path");

		svg.appendChild(path);

		var drawer = {};
		drawer.svg = svg;
		drawer.path = path;

		function rgbcolor(cc)
		{
			return "rgb("+((cc>>16)&255)+","+((cc>>8)&255)+","+(cc&255)+")";
		}

		drawer.setstyle = function(linecolor, linewidth, linealpha, fillcolor, fillalpha)
		{
			path.setAttribute("stroke",         rgbcolor(linecolor));
			path.setAttribute("stroke-width",   linewidth);
			path.setAttribute("stroke-opacity", linealpha);
			path.setAttribute("fill",           rgbcolor(fillcolor));
			path.setAttribute("fill-opacity",   fillalpha);
		}

		drawer.drawpie = function(cx,cy,r,von,bis)
		{
			var t1,t2;
			var d = "";

			// correct wrong order
			if (von > bis)
			{
				t1 = bis;
				bis = von;
				von = t1;
			}

			// remap to rad
			von = von*Math.PI/180;
			bis = bis*Math.PI/180;

			// calc range and center
			t2 = (bis-von);
			t1 = (von+bis)/2;

			// draw mode
			var drawmode = (t2 > Math.PI) ? 1 : 0;

			// check range
			if (t2 >= 2*Math.PI)
				t2 = 2*Math.PI - 0.01;

			// re-center
			von = t1 - t2/2;
			bis = t1 + t2/2;

			// calc edges
			var x1 = cx + r*Math.sin(von);
			var y1 = cy - r*Math.cos(von);
			var x2 = cx + r*Math.sin(bis);
			var y2 = cy - r*Math.cos(bis);

			// draw command
			d =  "M "+cx+","+cy+" L "+x1+","+y1+" A "+r+","+r+" 0 "+drawmode+" 1 "+x2+","+y2+" Z";

			path.setAttribute("d", d);
		}

		return drawer;
	}


	function svg_mouse_down(msevent)
	{
		startdrag = true;
		dragging = true;

		svg_mouse_move(msevent);

		if (browserevents.mouse)
		{
			window.addEventListener("mousemove", svg_mouse_move, true);
			window.addEventListener("mouseup",   svg_mouse_up,   true);
		}

		if (browserevents.touch)
		{
			window.addEventListener(browserevents.touchmove,   svg_mouse_move, true);
			window.addEventListener(browserevents.touchcancel, svg_mouse_up,   true);
			window.addEventListener(browserevents.touchend,    svg_mouse_up,   true);
		}
	}


	function svg_mouse_up(msevent)
	{
		dragging = false;

		if (browserevents.mouse)
		{
			window.removeEventListener("mousemove", svg_mouse_move, true);
			window.removeEventListener("mouseup",   svg_mouse_up,   true);
		}

		if (browserevents.touch)
		{
			window.removeEventListener(browserevents.touchmove,   svg_mouse_move, true);
			window.removeEventListener(browserevents.touchcancel, svg_mouse_up,   true);
			window.removeEventListener(browserevents.touchend,    svg_mouse_up,   true);
		}
	}


	function svg_mouse_block_default(msevent)
	{
		if (msevent)
		{
			msevent.preventDefault();
			msevent.stopImmediatePropagation();
			msevent.stopPropagation();
		}
	}


	function svg_mouse_move(msevent)
	{
		if (krpano == null)
		{
			// the plugin got removed during dragging => remove events and stop
			svg_mouse_up(msevent);
			return;
		}

		if (radarsvg == null)
			return;

		svg_mouse_block_default(msevent);

		var dx;
		var dy;
		var angle;

		var ms = {x:0, y:0};

		var rect = radarsvg.svg.parentNode.getBoundingClientRect();

		if (browserevents.touch)
		{
			var touch_events = msevent.changedTouches ? msevent.changedTouches : [msevent];

			if (touch_events.length > 0)
			{
				var touch_event = touch_events[0];
				ms.x = Math.round(touch_event.clientX - rect.left);
				ms.y = Math.round(touch_event.clientY - rect.top);
			}
		}
		else
		{
			ms.x = Math.round(msevent.clientX - rect.left);
			ms.y = Math.round(msevent.clientY - rect.top);
		}

		dx = ms.x - (0.5 * radarsize_x * krpano.stagescale);
		dy = ms.y - (0.5 * radarsize_y * krpano.stagescale);

		angle = Math.atan2(dy,dx) * 180.0 / Math.PI;
		angle -= heading;

		if (startdrag == true)
		{
			startangle = angle - Number( krpano.view.hlookat );

			startdrag = false;
		}
		else
		{
			var hlookattemp = angle - startangle;

			// make it in range -180 to +180
			while (hlookattemp > +180)	hlookattemp -= 360;
			while (hlookattemp < -180)	hlookattemp += 360;

			krpano.view.hlookat = hlookattemp;
		}

		needupdate = true;
	}


	// update handling - check for changes and redraw when necessary
	function updatehandler()
	{
		var radarrange = (radarsize / 2) * krpano.stagescale;

		if (radarrange > 2000)
			radarrange = 2000;

		var render_size = Math.ceil(2*radarrange);
		var dom_size = 2 + linewidth*2 + render_size;
		if (dom_size != last_dom_size)
		{
			last_dom_size = dom_size;

			var svg = radarsvg.svg;
			svg.setAttribute("width",  dom_size);
			svg.setAttribute("height", dom_size);
			svg.style.left = ((render_size - dom_size)>>1) + "px";
			svg.style.top  = ((render_size - dom_size)>>1) + "px";

			needupdate = true;
		}

		// calculate cone offset and size
		var hlookat = (heading + headingoffset - 0 + krpano.view.hlookat);
		var hfov    = krpano.view.hfov;

		if (invert)
		{
			hfov = -hfov;
		}

		if (plugin && plugin.sprite)
			plugin.sprite.style.pointerEvents = "none";

		var pathstyle = radarsvg.path.style;
		
		// update the enabled and handcursor settings
		pathstyle.pointerEvents = plugin.enabled    ? "visiblePainted" : "none";
		pathstyle.cursor        = plugin.handcursor ? "pointer"        : "default";

		// has changed?
		if (Math.abs(hlookat-last_hlookat) > 0.01 || Math.abs(hfov-last_hfov) > 0.02)
		{
			last_hlookat = hlookat;
			last_hfov    = hfov;

			needupdate = true;
		}

		if (needupdate)
		{
			needupdate = false;

			radarsvg.setstyle(linecolor, linewidth, linealpha, fillcolor, fillalpha);
			radarsvg.drawpie(dom_size/2-0.5, dom_size/2-0.5, radarrange, hlookat - hfov*0.5, hlookat + hfov*0.5);
		}
	}
}
