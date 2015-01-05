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
		items => [
			# common drawing item stuff see examples in items below
			],
		},
	footer => { # (optional)
		height => 72, # (required)
		# width => always page width minus left and right margins
		items => [],
		},
	left_sidebar => { # (optional)
		width => 72, # (required)
		#height => always page height minus page top and bottom margins and 
		items => [],
		},
	right_sidebar => { # (optional)
		width => 72, # (required)
		#height => always page height minus page top and bottom margins and 
		# header and footer height if defined
		items => [],
		},
	default => { # to override the normal engine defaults, but for the document
		font => 'Helvetica', # engine default should be Helvetica
		font_size => 12, # engine default should be 12
		color => '#000', # engine default should be black #000
		background_color => '#fff', # engine default should be white #fff
		align => 'left',
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
			#clear => 1, # start over on far left, bottom of last elements
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
			width => '10%', # width in percent or points
			line_width => 2,
			line_length => 100, # (required for vertical line)
			padding_left => 3,
			padding_right => 10, 
		},
		{
			object_type => 'text',
			item_display => 'smartwrap', # this can be span, div or smartwrap, but smartwrap
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
			height => 100, # if just height provided, scale width
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
		{
			# tables 
			object_type => 'table',
			font => 'Times', # default style to apply down to the table
			align => 'left', # default to left
			valign => 'center', # default to center (only for table cells)
			item_display => 'div', # by default tables are divs, if item_display is 
				# span then stuff would float to the right of the table (this might be really hard
				# do dont spend much time on this yet)
			content => {
				table => {
					title => {
						content => 'Activity Detail',
						font_size => 14,
						font => 'Helvetica-Bold',
						align => 'left', 
						},
					width => '100%', # required, either percent or points (i.e. 72 points = 1 inch)
					orientation => 'horizontal', # default to vertical
					data_header_field => 'account_name' # if present, include subheader with value for each field
					data_header_position => 'top' # top/bottom, left/right, both
					thead => {
						show => 1, # show the column headers, pulled from column detail below
						font => 'Helvetica', # or default to engine/page
						clip => 1, # clip data rows to width, do not autowrap
						h_width => '10%', # width for horizontal table (optional),
						font_size => 12, # or default
						color => '#000', # or default
						background_color => '#fff', # or default
					},
					tbody => {
						font => 'Helvetica', # or default to engine/page
						font_size => 12, # or default
						color => '#000', # or default
						background_color => '#fff', # or default
					},
					columns => [
						# the order of the columns determins how they should be displayed
						# required fields are k and width (percent of total table width)
						# thead means format data columns using thead attributes
						# for horizontal tables, width is not relevant (see h_width in thead)
						# also align is not relevant for now, default to align left for everything
						{ k => 'post_date', name => 'Date', width => '20%', thead => 1, },
						{ k => 'account_name', name => 'Account', width => '20%', },
						{ k => 'description', name => 'Description', width => '40%', },
						# column options are align, font, font_size, color, background_color to 
						# override thead defaults
						{ k => 'amount', name => 'Amount', align => 'right', width => '20%', },
						],
					},
				data => [
					# these are the table data rows
					{ 	
						amount => '100.00',
						post_date => '2014-01-01 ',
						accont_name => 'Contributions',
						description => 'Check-Bowels Household',
						# _opts are where we can override tbody settings in table above
						# for the entire row or a single key
						_opts => {
							_all => { # means all rows
								font => 'Helvetica', 
								font_size => 12, 
								color => '#000', 
								background_color => '#fff',
							},
							amount => { # apply after any _all stuff
								font_size => 24, 
							},
						},
					},
					{ 	
						amount => '-1,200.00',
						accont_name => 'Distributions',
						post_date => '2014-01-01 ',
						description => 'Community Resource Center Grant Distributon',
					},
					# some rows might not have all the keys
					{ 	
						amount => '-1,200.00',
						description => 'Community Resource Center Grant Distributon',
					},
					],
				},
		},
		],
};

my $json_text = to_json($jdata, { ascii => 1, pretty => 1 });

print "$json_text\n";
