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
		{
			# tables 
			object_type => 'table',
			item_display => 'div', # by default tables are divs, if item_display is 
				# span then stuff would float to the right of the table (this might be really hard
				# do dont spend much time on this yet)
			content => {
				table => {
					width => '100%', # required, either percent or points (i.e. 72 points = 1 inch)
					# padding can be either all sides, or left, right, top bottom, just like object
					# padding above, which maybe should be called margin...na.
					padding => 2, # default padding on all cells is 2
					# padding_left => 1,
					# padding_right => 3,
					# padding_top => 4,
					# padding_bottom => 5,
					align => 'left', # everything (title, thead, and tbody) defaults here
					font => 'Helvetica', # or default to engine/page
					font_size => 12, # or default
					color => '#000', # or default
					background_color => '#fff', # or default
					title => { # if title is not defined, there is no title to display
						content => 'Activity Detail',
						align => 'left', # or right or center
						font => 'Helvetica', # or default to engine/page
						font_size => 12, # or default
						color => '#000', # or default
						background_color => '#fff', # or default
						},
					thead => { # applies to <th> type cells
						align => 'left', # default is left text align
						show => 1, # show the column headers, pulled from column detail below
						font => 'Helvetica', # or default to engine/page
						font_size => 12, # or default
						color => '#000', # or default
						background_color => '#fff', # or default
						padding => 1, # override default padding
					},
					tbody => { # applies to <td> type cells
						align => 'left', # default is left text align
						font => 'Helvetica', # or default to engine/page
						font_size => 12, # or default
						color => '#000', # or default
						background_color => '#fff', # or default
						padding => 1, # override default padding
					},
					columns => [
						# the order of the columns determins how they should be displayed
						# required fields are k and width (percent of total table width)
						{ k => 'post_date', name => 'Date', width => '10%', },
						{ k => 'account_name', name => 'Account', width => '20%', },
						{ k => 'description', name => 'Description', width => '60%', },
						# column options are align, font, font_size, color, background_color to 
						# override thead defaults
						{ k => 'amount', name => 'Amount', align => 'right', width => '10%', },
						],
					},
				data => [
					# these are the table data rows
					{ 	
						amount => '100.00',
						post_date => '2014-01-01 ',
						account_name => 'Contributions',
						description => 'Check-Bowels Household',
						# _opts are where we can override tbody settings in table above
						# for the entire row or a single key in that row
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
						account_name => 'Distributions',
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
