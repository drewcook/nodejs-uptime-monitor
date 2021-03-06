/**
 * Primary file for the HTTP Server
 */
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { StringDecoder } = require('string_decoder')
const url = require('url')
const util = require('util')
const config = require('./config')
const handlers = require('./handlers')
const helpers = require('./helpers')

const debug = util.debuglog('server')

// Define a router for incoming requests to be routed to different request handlers based on the request path
const router = {
	// Web app GUI routes
	'': handlers.html.index,
	'account/create': handlers.html.accountCreate,
	'account/edit': handlers.html.accountEdit,
	'account/deleted': handlers.html.accountDeleted,
	'session/create': handlers.html.sessionCreate,
	'session/deleted': handlers.html.sessionDeleted,
	'checks/all': handlers.html.checksList,
	'checks/create': handlers.html.checksCreate,
	'checks/edit': handlers.html.checksEdit,
	// REST API routes
	ping: handlers.api.ping,
	error: handlers.api.error,
	'api/users': handlers.api.users,
	'api/tokens': handlers.api.tokens,
	'api/checks': handlers.api.checks,
	// Static assets
	'favicon.ico': handlers.html.favicon,
	public: handlers.html.public,
}

// The server should respond to all requests with a string
// We reuse logic in unifiedServer so that we can apply it to both HTTP and HTTPS servers
const unifiedServer = (req, res) => {
	// Get url and parse it with query strings data
	const parsedUrl = url.parse(req.url, true)
	// Get path from the url, trim out all forward slashes
	const path = parsedUrl.pathname.replace(/^\/+|\/+$/g, '')
	// Get the HTTP request method
	const method = req.method.toLowerCase()
	// Get the query strings
	const qs = parsedUrl.query
	// Get the HTTP headers
	const { headers } = req
	// Get the payload if there is any
	// Use string decoder to capture stream data as UTF-8 characters and append into a buffer as it streams in
	const decoder = new StringDecoder('utf-8')
	let buffer = ''
	req.on('data', data => {
		buffer += decoder.write(data)
	})
	req.on('end', () => {
		buffer += decoder.end()

		// Route the request to the appropriate handler
		let handler = typeof router[path] !== 'undefined' ? router[path] : handlers.notFound

		// If request is within public directory, use the public handler instead
		handler = path.includes('public/') ? handlers.html.public : handler

		// Construct payload to send
		const payload = helpers.parseJsonStringToObject(buffer)
		const data = {
			path,
			qs,
			method,
			headers,
			payload,
		}

		// Our generic handler to use
		// Route the request to the handler specified in the server
		// Catch any errors that we throw throughout our route handlers and prevent crashing the app
		try {
			handler(data, (statusCode, payload, contentType) => {
				server.processHandlerRespone(res, method, path, statusCode, payload, contentType)
			})
		} catch (e) {
			debug(e)
			server.processHandlerRespone(
				res,
				method,
				path,
				500,
				{ error: 'An unknown error has occurred' },
				'json',
			)
		}
	})
}

// Instantiate the servers
const server = {
	router,
	httpServer: http.createServer(unifiedServer),
	httpsServer: https.createServer(
		{
			key: fs.readFileSync(path.join(__dirname, '/../https/key.pem')),
			cert: fs.readFileSync(path.join(__dirname, '/../https/cert.pem')),
		},
		unifiedServer,
	),
	init: () => {
		// Start up the HTTP server in any case
		server.httpServer.listen(config.httpPort, () => {
			// Send to console, in blue
			console.log(
				'\x1b[36m%s\x1b[0m',
				`HTTP server is listening on port ${config.httpPort} in ${config.name} mode...`,
			)
		})

		// Start up the HTTPS server during development
		// Heroku's load balancers send the app plain (non-SSL) traffic, so ignore HTTPS for Heroku deploys
		if (process.env.NODE_ENV !== 'production') {
			server.httpsServer.listen(config.httpsPort, () => {
				// Send to console, in purple
				console.log(
					'\x1b[35m%s\x1b[0m',
					`HTTPS server is listening on port ${config.httpsPort} in ${config.name} mode...`,
				)
			})
		}
	},
	// Process the response from the handler
	processHandlerRespone: (res, method, path, statusCode, payload, contentType) => {
		// Determine the content type, default to JSON (allow to support any, for example serving HTML pages)
		const reqContentType = typeof contentType === 'string' ? contentType : 'json'

		// Use the status code called back by the handler or default to 200
		const resStatus = typeof statusCode === 'number' ? statusCode : 200

		// Construct and send the response,using both generic and content type specific config
		// Use the payload called back by the handler or use empty defaults
		// Content-specific config
		let resPayload = ''
		if (reqContentType === 'json') {
			res.setHeader('Content-Type', `application/json`)
			resPayload = typeof payload === 'object' ? payload : {}
			resPayload = JSON.stringify(resPayload)
		}
		if (reqContentType === 'html') {
			res.setHeader('Content-Type', `text/html`)
			resPayload = typeof payload === 'string' ? payload : ''
		}
		if (reqContentType === 'favicon') {
			res.setHeader('Content-Type', `image/x-icon`)
			resPayload = typeof payload !== 'undefined' ? payload : ''
		}
		if (reqContentType === 'css') {
			res.setHeader('Content-Type', `text/css`)
			resPayload = typeof payload !== 'undefined' ? payload : ''
		}
		if (reqContentType === 'png') {
			res.setHeader('Content-Type', `image/png`)
			resPayload = typeof payload !== 'undefined' ? payload : ''
		}
		if (reqContentType === 'jpg') {
			res.setHeader('Content-Type', `image/jpeg`)
			resPayload = typeof payload !== 'undefined' ? payload : ''
		}
		if (reqContentType === 'plain') {
			res.setHeader('Content-Type', `text/plain`)
			resPayload = typeof payload !== 'undefined' ? payload : ''
		}
		// Generic config
		res.writeHead(resStatus)
		res.end(resPayload)

		// Log the request path
		// If the response is 200, print green, otherwise print red
		if (resStatus === 200) {
			debug(
				'\x1b[32m%s\x1b[0m',
				`A ${method.toUpperCase()} request was made to ${path} - ${resStatus}`,
			)
		} else {
			debug(
				'\x1b[31m%s\x1b[0m',
				`A ${method.toUpperCase()} request was made to ${path} - ${resStatus}`,
			)
		}
	},
}

module.exports = server
