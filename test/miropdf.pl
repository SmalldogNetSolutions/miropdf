#! /usr/bin/perl

use strict;
use JSON;

my $jdata = {
	# all units are in points (72 point per inch)
	page => { # (required)
		size => [612,792], # 8.5/11 in points
		layout => 'portrait',
		margin_top => 36, # .5 inches
		margin_right => 36,
		margin_bottom => 36,
		margin_left => 36,
		},
	header => { # (optional) 
		height => 72, # (required) 
		# width => always page width minus left and right margins
		# if this is blank it means we want this thing on all pages
		# otherwise we can specify only on the first, last or both first and last
		pages => ['first','last'], 
		items => [
			# common drawing item stuff see examples in items below
			],
		},
	footer => { # (optional)
		height => 72, # (required)
		# width => always page width minus left and right margins
		pages => ['first','last'],
		items => [],
		},
	left_sidebar => { # (optional)
		width => 72, # (required)
		#height => always page height minus page top and bottom margins and 
		# header and footer height if defined
		pages => ['first','last'], 
		items => [],
		},
	right_sidebar => { # (optional)
		width => 72, # (required)
		pages => ['first','last'],
		#height => always page height minus page top and bottom margins and 
		# header and footer height if defined
		items => [],
		},
	default => { # to override the normal engine defaults, but for the document
		font => 'Helvetica', # engine default should be Helvetica
		font_size => 12, # engine default should be 12
		color => '#000', # engine default should be black #000
		background_color => '#fff', # engine default should be white #fff
		# what else should we default?
		},
	items => [
		# in order that things should be created, starting in the body of the 
		# first page after page margins, header, footer, left and right sidebards have been calculated
		# we when run out of room, we start another page.
		{
			object_type => 'text',
			item_display => 'div', # (default) by default everything acts like a div
			content => 'Smalldog Net Solutions',
			font => 'Helvetica',
			font_size => 36,
			color => '#fff',
			background_color => '#555',
			border => 1, # on all sides
			border_width => 2,
			border_color => '#000',
			line_height => 40,
			align => 'center',
			padding => 3, # on all sides
		},
		{
			object_type => 'hline', # horizontal line
			item_display => 'div', # by default everything acts like a div
			color => '#333',
			line_width => 2,
			line_length => 200, # if blank, will go the full width of the available drawing area
			padding_bottom => 3,
		},
		{
			object_type => 'vline', # vertical line
			item_display => 'span', # by default everything acts like a div
			line_width => 2,
			line_length => 100, # (required for vertical line)
			padding_left => 3,
			padding_right => 10, 
		},
		{
			object_type => 'text',
			content => 'Text to the right of the vertical line',
			align => 'left', # text always defaults to left
		},
		{
			object_type => 'svg',
			content => {
				# either a local file path or a url is required
				path => "/tmp/smalldog_logo.svg",
				#url => "https://smalldognetstatic.s3.amazonaws.com/logo/smalldog_logo.svg",
				},
			# one or the other of width or height required
			# but not both (we don't want to squash things)
			height => 144, # if just height provided, scale width
			#width => 144, # if just width provided, scale height
		},
		{
			object_type => 'png',
			content => {
				# either a local file path or a url is required
				#path => "/tmp/smalldog_logo.png",
				url => "https://smalldognet.com/logo.png",
				},
			# one or the other of width or height OPTIONAL if you want to scale the PNG
			# but not both (we don't want to squash things)
			#height => 144, # if just height provided, scale width
			width => 144, # if just width provided, scale height
		},
		],
};

my $json_text = to_json($jdata, { ascii => 1, pretty => 1 });

print "$json_text\n";
